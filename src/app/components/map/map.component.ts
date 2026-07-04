import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  inject,
  OnInit,
} from '@angular/core';
import { GoogleMap } from '@angular/google-maps';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { MapThemeService } from '../../services/map-theme.service';
import { MAP_STYLES } from './map-styles';

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
export class MapComponent implements OnInit {
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly mapTheme = inject(MapThemeService);

  /** The underlying map instance, captured once it initializes. */
  private map?: google.maps.Map;

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
}
