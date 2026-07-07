import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { GoogleMap } from '@angular/google-maps';
import { interval } from 'rxjs';
import {
  AircraftInfoPanelComponent,
  FlightPanelInfo,
  PanelAction,
} from '../aircraft-info-panel/aircraft-info-panel.component';
import { Aircraft } from '../../models/aircraft.model';
import { AIRPORTS, cityForAirport, SEED_FLIGHTS } from '../../data/seed-data';
import { FlightSimulatorService } from '../../services/flight-simulator.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { MapThemeService } from '../../services/map-theme.service';
import {
  AircraftCardInfo,
  AircraftLiveStats,
  AircraftMarker,
  createAircraftMarker,
} from './aircraft-marker.overlay';
import { LABEL_ZOOM_THRESHOLD, mapStyleFor } from './map-styles';

/**
 * Aircraft marker diameter (px) scales with altitude — bigger when higher (a
 * rough sense of "closer to the viewer"), smaller near the ground. MIN is a
 * little smaller than the old flat 40px.
 */
const MARKER_MIN_SIZE_PX = 30;
const MARKER_MAX_SIZE_PX = 52;
/** Altitude (ft) mapped to MARKER_MAX_SIZE_PX (≈ the simulator's cruise alt). */
const MARKER_MAX_ALTITUDE_FT = 35000;
/**
 * Degrees added to each aircraft's heading before rotating the badge. Set this
 * if the plane in flight.svg doesn't already point "up" (north) at 0°.
 */
const MARKER_ROTATION_OFFSET_DEG = 0;

/** Marker size for a given altitude, clamped between MIN and MAX. */
function markerSizeForAltitude(altitudeFt: number): number {
  const t = Math.min(1, Math.max(0, altitudeFt / MARKER_MAX_ALTITUDE_FT));
  return Math.round(
    MARKER_MIN_SIZE_PX + t * (MARKER_MAX_SIZE_PX - MARKER_MIN_SIZE_PX),
  );
}

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
  imports: [GoogleMap, AircraftInfoPanelComponent],
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
  private readonly router = inject(Router);

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

  /** Last applied style bucket ("theme:labelsVisible") to skip redundant restyles. */
  private lastStyleKey = '';

  /**
   * Route overlays for the selected flight (toggled by the panel's Route
   * action): a solid line origin→plane (flown), a dashed line plane→destination
   * (remaining), plus a marker at each airport. Created lazily once the map
   * exists; shown/hidden via setMap.
   */
  private readonly routeActive = signal(false);
  /** True while "follow mode" keeps the map centred on the selected plane. */
  private readonly followActive = signal(false);
  private solidLine?: google.maps.Polyline;
  private dashedLine?: google.maps.Polyline;
  private originMarker?: google.maps.Marker;
  private destMarker?: google.maps.Marker;

  /** flightId of the currently selected aircraft (drives the info panel). */
  private readonly selectedFlightId = signal<string | null>(null);

  /**
   * ~2 Hz clock. The markers animate at 60 fps outside Angular; the info panel
   * only needs occasional text updates, so this drives `selectedAircraft`
   * without pulling the whole animation into change detection.
   */
  private readonly clock = toSignal(interval(500), { initialValue: 0 });

  /** Live data for the selected aircraft, or null when none is selected. */
  readonly selectedAircraft = computed<Aircraft | null>(() => {
    this.clock(); // refresh periodically while the panel is open
    const flightId = this.selectedFlightId();
    if (!flightId) {
      return null;
    }
    return (
      this.simulator
        .sample(Date.now())
        .find((plane) => plane.flightId === flightId) ?? null
    );
  });

  /** View model for the details panel, derived from the selected aircraft. */
  readonly selectedFlightInfo = computed<FlightPanelInfo | null>(() => {
    const plane = this.selectedAircraft();
    return plane ? this.panelInfoFor(plane) : null;
  });

  /** Action-bar buttons currently active (highlighted in the panel). */
  readonly activeActions = computed<PanelAction[]>(() => {
    const active: PanelAction[] = [];
    if (this.routeActive()) {
      active.push('route');
    }
    if (this.followActive()) {
      active.push('follow');
    }
    return active;
  });

  /** True once the Maps JS API has loaded and <google-map> can render. */
  mapReady = false;
  /** Populated if the API fails to load; shown to the user. */
  loadError: string | null = null;

  constructor() {
    // Re-apply map styles whenever the shared day/night theme changes. The
    // effect also runs once on creation; it no-ops until the map exists, and
    // onMapInitialized applies the current theme as soon as it does.
    effect(() => {
      // Track the theme so this re-runs on toggle; applyMapStyle picks the
      // correct style for the current theme + zoom.
      this.mapTheme.theme();
      this.applyMapStyle();
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
    maxZoom: 18,
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
    // Apply the muted/grey style for the current theme + zoom.
    this.applyMapStyle();

    // Re-apply when zoom crosses the label threshold (applyMapStyle no-ops
    // otherwise, so frequent fractional-zoom events stay cheap).
    map.addListener('zoom_changed', () => this.applyMapStyle());

    // Clicking empty map (not a marker) clears the selection / closes the panel.
    map.addListener('click', () => this.zone.run(() => this.clearSelection()));

    // Drive the markers from an animation-frame loop, outside Angular so we
    // don't run change detection ~60×/sec. Each frame we sample the simulator
    // at the current time and move the marker DOM directly — smooth motion,
    // no per-frame CD.
    this.zone.runOutsideAngular(() => {
      const animate = () => {
        const fleet = this.simulator.sample(Date.now());
        this.syncAircraftMarkers(fleet);
        this.updateRoute(fleet);
        this.updateFollow(fleet);
        this.animationFrameId = requestAnimationFrame(animate);
      };
      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  /**
   * Apply the map style for the current theme + zoom. Only calls setOptions when
   * the effective style actually changes (theme flip, or zoom crossing the label
   * threshold), so the frequent fractional-zoom events don't thrash the map.
   */
  private applyMapStyle(): void {
    if (!this.map) {
      return;
    }
    const theme = this.mapTheme.theme();
    const zoom = this.map.getZoom() ?? this.zoom;
    const labelsVisible = zoom >= LABEL_ZOOM_THRESHOLD;
    const key = `${theme}:${labelsVisible}`;
    if (key === this.lastStyleKey) {
      return;
    }
    this.lastStyleKey = key;
    this.map.setOptions({ styles: mapStyleFor(theme, zoom) });
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

    const selectedId = this.selectedFlightId();
    const present = new Set<string>();
    for (const plane of fleet) {
      present.add(plane.flightId);
      const position: google.maps.LatLngLiteral = {
        lat: plane.latitude,
        lng: plane.longitude,
      };
      // Live values that change each tick and drive the hover card.
      const stats: AircraftLiveStats = {
        altitudeFt: plane.altitude,
        speedKts: plane.speed,
        progress: plane.progress,
      };
      // Marker grows with altitude, shrinks near the ground.
      const sizePx = markerSizeForAltitude(plane.altitude);

      let marker = this.markers.get(plane.flightId);
      if (!marker) {
        const flightId = plane.flightId;
        marker = createAircraftMarker(position, plane.heading, {
          iconUrl: 'markers/flight.svg',
          sizePx,
          rotationOffsetDeg: MARKER_ROTATION_OFFSET_DEG,
          card: this.cardInfoFor(plane),
          // Runs outside Angular (rAF loop), so re-enter the zone to update state.
          onClick: () =>
            this.zone.run(() => {
              // Switching flights drops the previous flight's route/follow modes.
              if (this.selectedFlightId() !== flightId) {
                this.resetFlightModes();
              }
              this.selectedFlightId.set(flightId);
            }),
        });
        marker.setMap(this.map);
        this.markers.set(flightId, marker);
      }
      marker.update(position, plane.heading, stats, sizePx);
      // Highlight the selected aircraft red (matches the panel that describes it).
      marker.setSelected(plane.flightId === selectedId);
    }

    // Drop markers for flights no longer in the fleet.
    for (const [flightId, marker] of this.markers) {
      if (!present.has(flightId)) {
        marker.setMap(null);
        this.markers.delete(flightId);
      }
    }
  }

  /**
   * Build the static hover-card details for a flight. The photo is identity
   * data (not on the live `Aircraft` record), so it's looked up from the seed;
   * city names are resolved from the airport codes the aircraft carries.
   */
  private cardInfoFor(plane: Aircraft): AircraftCardInfo {
    const photoUrl =
      SEED_FLIGHTS.find((seed) => seed.flightId === plane.flightId)?.photo ?? '';
    return {
      flightCode: plane.flightId,
      aircraftType: plane.aircraft,
      photoUrl,
      originCity: cityForAirport(plane.source),
      destinationCity: cityForAirport(plane.destination),
    };
  }

  /**
   * Build the details-panel view model for a flight: identity + airport names
   * (from the seed/airport reference) plus the live position values.
   */
  private panelInfoFor(plane: Aircraft): FlightPanelInfo {
    const seed = SEED_FLIGHTS.find((s) => s.flightId === plane.flightId);
    const origin = AIRPORTS[plane.source];
    const destination = AIRPORTS[plane.destination];
    return {
      flightCode: plane.flightId,
      airline: plane.airline,
      aircraftType: plane.aircraft,
      photoUrl: seed?.photo ?? '',
      origin: {
        code: plane.source,
        city: cityForAirport(plane.source),
        airport: origin?.name ?? '',
      },
      destination: {
        code: plane.destination,
        city: cityForAirport(plane.destination),
        airport: destination?.name ?? '',
      },
      progress: plane.progress,
      altitudeFt: plane.altitude,
      speedKts: plane.speed,
      headingDeg: plane.heading,
    };
  }

  /** Handle an action-bar button from the panel. */
  onPanelAction(action: PanelAction): void {
    if (action === 'follow') {
      this.toggleFollow();
      return;
    }
    if (action === 'route') {
      this.toggleRoute();
      return;
    }
    if (action === 'onboard') {
      // Navigate to the standalone 3D flight view for the selected aircraft.
      const flightId = this.selectedFlightId();
      if (flightId) {
        this.router.navigate(['/3d-view', flightId]);
      }
    }
  }

  /** Toggle follow mode — keep the map centred on the selected plane. */
  private toggleFollow(): void {
    if (!this.selectedAircraft() || !this.map) {
      return;
    }
    this.followActive.set(!this.followActive());
  }

  /** Keep the map centred on the selected plane while follow mode is on. */
  private updateFollow(fleet: Aircraft[]): void {
    if (!this.followActive() || !this.map) {
      return;
    }
    const flightId = this.selectedFlightId();
    const plane = flightId
      ? fleet.find((p) => p.flightId === flightId)
      : undefined;
    if (plane) {
      this.map.setCenter({ lat: plane.latitude, lng: plane.longitude });
    }
  }

  /** Toggle the flown/remaining route overlay for the selected flight. */
  private toggleRoute(): void {
    if (this.routeActive()) {
      this.hideRoute();
      return;
    }
    const plane = this.selectedAircraft();
    if (plane) {
      this.showRouteFor(plane);
    }
  }

  /** Clear per-flight modes (route + follow) when selection changes or clears. */
  private resetFlightModes(): void {
    this.hideRoute();
    this.followActive.set(false);
  }

  /**
   * Show the route for a flight: solid line origin→plane, dashed plane→dest,
   * airport markers at each end, then fit the whole route into the viewport
   * (padded on the left so it clears the details panel).
   */
  private showRouteFor(plane: Aircraft): void {
    const origin = AIRPORTS[plane.source];
    const destination = AIRPORTS[plane.destination];
    if (!origin || !destination || !this.map) {
      return;
    }

    this.ensureRouteObjects();
    const originPos = { lat: origin.latitude, lng: origin.longitude };
    const destPos = { lat: destination.latitude, lng: destination.longitude };

    this.originMarker!.setPosition(originPos);
    this.originMarker!.setTitle(origin.name);
    this.destMarker!.setPosition(destPos);
    this.destMarker!.setTitle(destination.name);

    for (const obj of [
      this.solidLine,
      this.dashedLine,
      this.originMarker,
      this.destMarker,
    ]) {
      obj?.setMap(this.map);
    }
    this.routeActive.set(true);
    this.updateRoute([plane]); // draw the initial split immediately

    // Fit origin + plane + destination into view; extra left padding keeps the
    // route clear of the details panel on the left edge.
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(originPos);
    bounds.extend({ lat: plane.latitude, lng: plane.longitude });
    bounds.extend(destPos);
    this.map.fitBounds(bounds, { top: 90, right: 60, bottom: 60, left: 380 });
  }

  /** Update the flown/remaining split each frame while the route is shown. */
  private updateRoute(fleet: Aircraft[]): void {
    if (!this.routeActive() || !this.solidLine || !this.dashedLine) {
      return;
    }
    const flightId = this.selectedFlightId();
    const plane = flightId
      ? fleet.find((p) => p.flightId === flightId)
      : undefined;
    if (!plane) {
      return;
    }
    const origin = AIRPORTS[plane.source];
    const destination = AIRPORTS[plane.destination];
    if (!origin || !destination) {
      return;
    }
    const planePos = { lat: plane.latitude, lng: plane.longitude };
    this.solidLine.setPath([
      { lat: origin.latitude, lng: origin.longitude },
      planePos,
    ]);
    this.dashedLine.setPath([
      planePos,
      { lat: destination.latitude, lng: destination.longitude },
    ]);
  }

  /** Detach the route overlays (keeps the objects for reuse). */
  private hideRoute(): void {
    for (const obj of [
      this.solidLine,
      this.dashedLine,
      this.originMarker,
      this.destMarker,
    ]) {
      obj?.setMap(null);
    }
    this.routeActive.set(false);
  }

  /** Lazily create the route polylines + airport markers (needs google.maps). */
  private ensureRouteObjects(): void {
    if (this.solidLine) {
      return;
    }
    // Literal hex (map canvas can't read the CSS `--color-accent` token — keep
    // in sync with it).
    const ACCENT = '#38bdf8';

    this.solidLine = new google.maps.Polyline({
      strokeColor: ACCENT,
      strokeOpacity: 1,
      strokeWeight: 3,
      // Follow the great circle (curved) rather than a straight screen line —
      // more realistic, and noticeable on longer routes.
      geodesic: true,
      zIndex: 3,
    });

    // Dashed line: hide the stroke and repeat a short line symbol along it.
    const dash: google.maps.Symbol = {
      path: 'M 0,-1 0,1',
      strokeColor: ACCENT,
      strokeOpacity: 1,
      strokeWeight: 3,
      scale: 3,
    };
    this.dashedLine = new google.maps.Polyline({
      strokeOpacity: 0,
      geodesic: true,
      icons: [{ icon: dash, offset: '0', repeat: '14px' }],
      zIndex: 3,
    });

    // Airport pin PNGs (public/markers). They're portrait pins (1070×1200) with
    // the tip at the bottom centre, so anchor there — the tip sits on the airport.
    const pinHeight = 30;
    const pinWidth = Math.round((pinHeight * 1070) / 1200);
    const pinIcon = (url: string): google.maps.Icon => ({
      url,
      scaledSize: new google.maps.Size(pinWidth, pinHeight),
      anchor: new google.maps.Point(pinWidth / 2, pinHeight),
    });
    this.originMarker = new google.maps.Marker({
      icon: pinIcon('markers/source.png'),
      zIndex: 4,
    });
    this.destMarker = new google.maps.Marker({
      icon: pinIcon('markers/destination.png'),
      zIndex: 4,
    });
  }

  /** Close the info panel / clear the selected aircraft (and its route/follow). */
  clearSelection(): void {
    this.resetFlightModes();
    this.selectedFlightId.set(null);
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
    this.resetFlightModes();
  }
}
