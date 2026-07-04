import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { GoogleMap } from '@angular/google-maps';
import { Aircraft } from '../../models/aircraft.model';
import { FlightSimulatorService } from '../../services/flight-simulator.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { MapThemeService } from '../../services/map-theme.service';
import {
  AircraftMarker,
  createAircraftMarker,
} from './aircraft-marker.overlay';
import { MAP_STYLES } from './map-styles';

/** Rendered diameter of the aircraft marker badge (px). */
const MARKER_SIZE_PX = 40;
/**
 * Degrees added to each aircraft's heading before rotating the badge. Set this
 * if the plane in flight.svg doesn't already point "up" (north) at 0°.
 */
const MARKER_ROTATION_OFFSET_DEG = 0;

/**
 * Displays the Google Map that aircraft will eventually be plotted on.
 *
 * The map is rendered only after the Google Maps JS API has loaded (via
 * GoogleMapsLoaderService). While loading we show a status message, and on
 * failure we show the error instead of a blank container — so a missing API
 * key or network problem is obvious rather than silent.
 */
@Component({
  selector: 'app-map',
  standalone: true,
  imports: [GoogleMap],
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements OnInit, OnDestroy {
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mapTheme = inject(MapThemeService);
  private readonly simulator = inject(FlightSimulatorService);
  private readonly zone = inject(NgZone);

  /** The underlying map instance, captured once it initializes. */
  private map?: google.maps.Map;

  /**
   * Aircraft markers keyed by flightId. These are custom OverlayView instances
   * (rotatable), managed imperatively — not via the template — so they can't be
   * declarative <map-marker>s.
   */
  private readonly markers = new Map<string, AircraftMarker>();

  /** Handle for the animation loop so we can cancel it on destroy. */
  private animationFrameId?: number;

  /** True once the Maps JS API has loaded and <google-map> can render. */
  mapReady = false;
  /** Populated if the API fails to load; shown to the user. */
  loadError: string | null = null;

  constructor() {
    // Re-apply map styles whenever the shared day/night theme changes. The
    // effect also runs once on creation; it no-ops until the map exists, and
    // onMapInitialized applies the current theme as soon as it does.
    effect(() => {
      const theme = this.mapTheme.theme();
      this.map?.setOptions({ styles: MAP_STYLES[theme] });
    });
  }

  /**
   * Bounds of the whole world map. ~85.05° is the latitude edge of the Web
   * Mercator projection Google Maps uses; full longitude (-180..180) is the
   * whole east/west span. Reused for both the initial auto-fit and the drag
   * restriction so the two can never drift out of sync.
   */
  private readonly worldBounds: google.maps.LatLngBoundsLiteral = {
    north: 85,
    south: -60,
    west: -180,
    east: 180,
  };

  /**
   * Fallback initial view (equator × prime meridian). The real framing is set
   * by fitBounds() in onMapInitialized once the map's pixel size is known.
   */
  readonly center: google.maps.LatLngLiteral = { lat: 0, lng: 0 };
  readonly zoom = 0;

  /**
   * Map behaviour options. Zoom controls are explicitly enabled (the "+ / -"
   * buttons); other default UI is kept minimal for a cleaner tracking view.
   */
  readonly mapOptions: google.maps.MapOptions = {
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    // Slow down / smooth out scroll-wheel zoom. The Maps API has no direct
    // zoom-speed option; enabling fractional zoom lets the map settle on
    // non-integer levels, so each wheel step is a smaller, smoother increment
    // instead of snapping a whole level at a time.
    isFractionalZoomEnabled: true,
    // Floor low enough that fitBounds() can zoom out to frame the whole world;
    // `strictBounds` still prevents any grey void. Upper bound keeps detail useful.
    minZoom: 2,
    maxZoom: 12,
    // Stop the map from dragging past the edges of the world into the grey void
    // beyond the poles. `strictBounds` keeps the *entire viewport* inside these
    // bounds (not just the centre), so the map always fills the view vertically.
    restriction: {
      latLngBounds: this.worldBounds,
      strictBounds: true,
    },
  };

  /**
   * Fired once the underlying google.maps.Map exists. We fit the whole world
   * into the panel so the entire map is visible regardless of the container's
   * size or aspect ratio — fitBounds recomputes center + zoom to frame these
   * bounds exactly. Padding 0 avoids leaving a grey margin around the world.
   */
  onMapInitialized(map: google.maps.Map): void {
    // Capture the instance so the theme effect can restyle it on toggle.
    this.map = map;
    map.fitBounds(this.worldBounds, 1);
    // Apply whatever theme is currently selected (defaults to day).
    map.setOptions({ styles: MAP_STYLES[this.mapTheme.theme()] });

    // Drive the markers from an animation-frame loop, outside Angular so we
    // don't run change detection ~60×/sec. Each frame we sample the simulator
    // at the current time and move the marker DOM directly — smooth motion,
    // no per-frame CD.
    this.zone.runOutsideAngular(() => {
      const animate = () => {
        this.syncAircraftMarkers(this.simulator.sample(Date.now()));
        this.animationFrameId = requestAnimationFrame(animate);
      };
      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Reconcile the on-map markers with the current fleet: update existing
   * aircraft, create markers for new ones, and remove markers for any that are
   * gone. Keyed by flightId so each plane keeps its own marker across ticks.
   */
  private syncAircraftMarkers(fleet: Aircraft[]): void {
    if (!this.map) {
      return;
    }

    const present = new Set<string>();
    for (const plane of fleet) {
      present.add(plane.flightId);
      const position: google.maps.LatLngLiteral = {
        lat: plane.latitude,
        lng: plane.longitude,
      };

      const existing = this.markers.get(plane.flightId);
      if (existing) {
        existing.update(position, plane.heading);
      } else {
        const marker = createAircraftMarker(position, plane.heading, {
          iconUrl: 'markers/flight.svg',
          sizePx: MARKER_SIZE_PX,
          rotationOffsetDeg: MARKER_ROTATION_OFFSET_DEG,
        });
        marker.setMap(this.map);
        this.markers.set(plane.flightId, marker);
      }
    }

    // Drop markers for flights no longer in the fleet.
    for (const [flightId, marker] of this.markers) {
      if (!present.has(flightId)) {
        marker.setMap(null);
        this.markers.delete(flightId);
      }
    }
  }

  ngOnInit(): void {
    this.mapsLoader
      .load()
      .then(() => {
        this.mapReady = true;
        // OnPush + async resolution: trigger change detection manually.
        this.cdr.markForCheck();
      })
      .catch((error: unknown) => {
        this.loadError =
          error instanceof Error ? error.message : 'Failed to load the map.';
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    // Stop the animation loop and detach all overlays so nothing leaks if the
    // component is torn down.
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
    }
    for (const marker of this.markers.values()) {
      marker.setMap(null);
    }
    this.markers.clear();
  }
}
