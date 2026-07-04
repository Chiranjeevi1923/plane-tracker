/**
 * A rotatable aircraft marker built on google.maps.OverlayView.
 *
 * Why an OverlayView instead of a Marker:
 *  - Google's Marker can only rotate a `Symbol` (a single SVG *path*), not an
 *    image/URL icon — and our badge (public/markers/flight.svg) is a rich,
 *    multi-path SVG.
 *  - AdvancedMarker could rotate DOM content, but it needs a Map ID, which
 *    disables the JS `styles` array we use for night mode.
 * An OverlayView renders our own DOM element (an <img>) that we position at the
 * aircraft's coordinate and rotate with a CSS transform — no Map ID required,
 * so night mode keeps working.
 *
 * The class is created lazily by createAircraftMarker() because
 * `google.maps.OverlayView` only exists after the Maps JS API has loaded;
 * referencing it at module-eval time would throw.
 */

export interface AircraftMarkerOptions {
  /** URL of the badge SVG (served from public/, e.g. 'markers/flight.svg'). */
  iconUrl: string;
  /** Rendered diameter in pixels. */
  sizePx: number;
  /**
   * Degrees added to the heading before rotating, to correct for an icon whose
   * nose isn't already pointing "up" (north) at 0°. Use 0 if it points north.
   */
  rotationOffsetDeg: number;
}

/** The minimal control surface the map component uses to drive a marker. */
export interface AircraftMarker {
  /** Move/rotate the marker to a new position and heading. */
  update(position: google.maps.LatLngLiteral, heading: number): void;
  /** Attach (map) or detach (null) the marker from the map. */
  setMap(map: google.maps.Map | null): void;
}

/** Cached constructor, built on first use (after the Maps API is available). */
let overlayCtor:
  | (new (
      position: google.maps.LatLngLiteral,
      heading: number,
      options: AircraftMarkerOptions,
    ) => AircraftMarker)
  | null = null;

function buildOverlayCtor() {
  return class AircraftMarkerOverlay
    extends google.maps.OverlayView
    implements AircraftMarker
  {
    private container?: HTMLDivElement;

    constructor(
      private position: google.maps.LatLngLiteral,
      private heading: number,
      private readonly options: AircraftMarkerOptions,
    ) {
      super();
    }

    update(position: google.maps.LatLngLiteral, heading: number): void {
      this.position = position;
      this.heading = heading;
      // Reposition/rotate immediately (also called by the API on pan/zoom).
      this.draw();
    }

    override onAdd(): void {
      const { sizePx, iconUrl } = this.options;

      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.width = `${sizePx}px`;
      container.style.height = `${sizePx}px`;
      container.style.pointerEvents = 'none';
      container.style.willChange = 'transform';

      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = '';
      img.draggable = false;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.display = 'block';
      container.appendChild(img);

      this.container = container;
      // overlayLayer: non-interactive image layer (we don't need mouse events).
      this.getPanes()?.overlayLayer.appendChild(container);
    }

    override draw(): void {
      const projection = this.getProjection();
      if (!this.container || !projection) {
        return;
      }
      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position),
      );
      if (!point) {
        return;
      }
      const half = this.options.sizePx / 2;
      // Position so the badge centre sits on the aircraft coordinate, then
      // rotate about that centre to the heading.
      this.container.style.left = `${point.x - half}px`;
      this.container.style.top = `${point.y - half}px`;
      this.container.style.transform = `rotate(${
        this.heading + this.options.rotationOffsetDeg
      }deg)`;
    }

    override onRemove(): void {
      this.container?.remove();
      this.container = undefined;
    }
  };
}

/**
 * Create an aircraft marker. Must be called after the Google Maps JS API has
 * loaded (i.e. once the map exists).
 */
export function createAircraftMarker(
  position: google.maps.LatLngLiteral,
  heading: number,
  options: AircraftMarkerOptions,
): AircraftMarker {
  overlayCtor ??= buildOverlayCtor();
  return new overlayCtor(position, heading, options);
}
