/**
 * A rotatable aircraft marker built on google.maps.OverlayView, with a Flight
 * Radar-style hover card.
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
 * DOM layout (why it's two nested elements):
 *   container  ← positioned at the aircraft coordinate, NEVER rotated
 *     ├─ img   ← the plane badge; THIS is what we rotate to the heading
 *     └─ card  ← the hover info card; stays upright because it's a sibling of
 *                the rotated img, not a child of it
 * If the card lived inside the rotated element it would spin with the plane, so
 * rotation is applied to the img alone.
 *
 * The class is created lazily by createAircraftMarker() because
 * `google.maps.OverlayView` only exists after the Maps JS API has loaded;
 * referencing it at module-eval time would throw.
 */

/** Static, per-flight identity shown in the hover card (doesn't change). */
export interface AircraftCardInfo {
  /** Call sign / flight number, e.g. '6E-201'. */
  flightCode: string;
  /** Aircraft type, e.g. 'Airbus A320neo'. */
  aircraftType: string;
  /** URL of the aircraft photo (served from public/). */
  photoUrl: string;
  /** Origin city name, e.g. 'Hyderabad'. */
  originCity: string;
  /** Destination city name, e.g. 'Bengaluru'. */
  destinationCity: string;
}

/** Live values shown in the hover card; refreshed on every position update. */
export interface AircraftLiveStats {
  /** Current altitude in feet. */
  altitudeFt: number;
  /** Current ground speed in knots. */
  speedKts: number;
  /** Leg completion, 0 → 1, driving the progress bar. */
  progress: number;
}

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
  /** Details rendered in the hover card. */
  card: AircraftCardInfo;
  /** Optional click handler. When provided, the marker becomes clickable. */
  onClick?: () => void;
}

/** The minimal control surface the map component uses to drive a marker. */
export interface AircraftMarker {
  /**
   * Move/rotate/resize the marker and refresh its live hover-card stats.
   * `sizePx` is the current rendered diameter (varies with altitude).
   */
  update(
    position: google.maps.LatLngLiteral,
    heading: number,
    stats: AircraftLiveStats,
    sizePx: number,
  ): void;
  /** Mark this aircraft as the selected one (renders it in the hot red). */
  setSelected(selected: boolean): void;
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
    private img?: HTMLImageElement;
    private card?: HTMLDivElement;
    /** Live card fields updated each frame while hovered. */
    private altValueEl?: HTMLElement;
    private speedValueEl?: HTMLElement;
    private progressFillEl?: HTMLElement;
    /** Latest stats, so entering hover can render immediately. */
    private stats?: AircraftLiveStats;
    private hovered = false;
    private selected = false;
    /** Current rendered diameter (px); driven by altitude, updated per frame. */
    private currentSizePx: number;

    constructor(
      private position: google.maps.LatLngLiteral,
      private heading: number,
      private readonly options: AircraftMarkerOptions,
    ) {
      super();
      this.currentSizePx = options.sizePx;
    }

    update(
      position: google.maps.LatLngLiteral,
      heading: number,
      stats: AircraftLiveStats,
      sizePx: number,
    ): void {
      this.position = position;
      this.heading = heading;
      this.stats = stats;
      this.currentSizePx = sizePx;
      // Only touch the (potentially hidden) card DOM when it's actually shown.
      if (this.hovered) {
        this.renderCardStats();
      }
      // Reposition/rotate/resize immediately (also called by the API on pan/zoom).
      this.draw();
    }

    override onAdd(): void {
      const container = document.createElement('div');
      container.className = 'aircraft-marker';
      container.style.position = 'absolute';
      container.style.width = `${this.options.sizePx}px`;
      container.style.height = `${this.options.sizePx}px`;
      // Capture hover/click on the plane itself.
      container.style.pointerEvents = 'auto';
      container.style.cursor = this.options.onClick ? 'pointer' : 'default';

      const img = this.buildImg();
      const card = this.buildCard();
      container.append(img, card);

      // Show the card on hover and tint the plane; hide/untint on leave.
      container.addEventListener('mouseenter', () => this.setHovered(true));
      container.addEventListener('mouseleave', () => this.setHovered(false));
      if (this.options.onClick) {
        container.addEventListener('click', (event) => {
          // Stop the click reaching the map (which would clear the selection).
          event.stopPropagation();
          this.options.onClick?.();
        });
      }

      this.container = container;
      this.img = img;
      this.card = card;

      // overlayMouseTarget is the pane that receives DOM pointer events, which
      // both the hover and click behaviour need.
      this.getPanes()?.overlayMouseTarget.appendChild(container);
    }

    /** The rotatable plane badge. */
    private buildImg(): HTMLImageElement {
      const img = document.createElement('img');
      img.className = 'aircraft-marker__img';
      img.src = this.options.iconUrl;
      img.alt = '';
      img.draggable = false;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.display = 'block';
      return img;
    }

    /** Build the hover card DOM once; live fields are filled in each frame. */
    private buildCard(): HTMLDivElement {
      const { card } = this.options;

      const el = document.createElement('div');
      el.className = 'aircraft-marker__card';

      const photo = document.createElement('img');
      photo.className = 'aircraft-card__photo';
      photo.src = card.photoUrl;
      photo.alt = `${card.aircraftType} aircraft`;
      photo.draggable = false;
      // A missing photo file shouldn't show a broken-image icon — hide it.
      photo.addEventListener('error', () => {
        photo.style.display = 'none';
      });

      const body = document.createElement('div');
      body.className = 'aircraft-card__body';

      // Header: flight code + aircraft type badge.
      const head = document.createElement('div');
      head.className = 'aircraft-card__head';
      const code = document.createElement('span');
      code.className = 'aircraft-card__code';
      code.textContent = card.flightCode;
      const type = document.createElement('span');
      type.className = 'aircraft-card__type';
      type.textContent = card.aircraftType;
      head.append(code, type);

      // Route: origin → destination cities.
      const route = document.createElement('div');
      route.className = 'aircraft-card__route';
      route.textContent = `${card.originCity} to ${card.destinationCity}`;

      // Progress bar.
      const track = document.createElement('div');
      track.className = 'aircraft-card__progress';
      const fill = document.createElement('div');
      fill.className = 'aircraft-card__progress-fill';
      track.appendChild(fill);

      // Stats line: altitude · speed.
      const stats = document.createElement('div');
      stats.className = 'aircraft-card__stats';
      const alt = document.createElement('span');
      const sep = document.createElement('span');
      sep.className = 'aircraft-card__dot';
      sep.textContent = '·';
      const spd = document.createElement('span');
      stats.append(alt, sep, spd);

      body.append(head, route, track, stats);
      el.append(photo, body);

      this.altValueEl = alt;
      this.speedValueEl = spd;
      this.progressFillEl = fill;
      return el;
    }

    setSelected(selected: boolean): void {
      this.selected = selected;
      this.applyHotState();
    }

    private setHovered(hovered: boolean): void {
      this.hovered = hovered;
      // Card only appears on hover; the red tint applies for hover OR selection.
      this.card?.classList.toggle('aircraft-marker__card--visible', hovered);
      this.applyHotState();
      if (hovered) {
        this.renderCardStats();
      }
    }

    /** The plane badge shows the red "hot" tint when hovered or selected. */
    private applyHotState(): void {
      this.img?.classList.toggle(
        'aircraft-marker__img--hot',
        this.hovered || this.selected,
      );
    }

    /** Push the latest live stats into the card fields. */
    private renderCardStats(): void {
      if (!this.stats) {
        return;
      }
      if (this.altValueEl) {
        this.altValueEl.textContent = `${Math.round(
          this.stats.altitudeFt,
        ).toLocaleString('en-US')} ft`;
      }
      if (this.speedValueEl) {
        this.speedValueEl.textContent = `${Math.round(this.stats.speedKts)} kts`;
      }
      if (this.progressFillEl) {
        const pct = Math.max(0, Math.min(1, this.stats.progress)) * 100;
        this.progressFillEl.style.width = `${pct}%`;
      }
    }

    override draw(): void {
      const projection = this.getProjection();
      if (!this.container || !this.img || !projection) {
        return;
      }
      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(this.position),
      );
      if (!point) {
        return;
      }
      const size = this.currentSizePx;
      const half = size / 2;
      // Resize the marker (altitude-driven) and position it so the badge centre
      // sits on the coordinate...
      this.container.style.width = `${size}px`;
      this.container.style.height = `${size}px`;
      this.container.style.left = `${point.x - half}px`;
      this.container.style.top = `${point.y - half}px`;
      // ...then rotate the plane image alone (the card stays upright).
      this.img.style.transform = `rotate(${
        this.heading + this.options.rotationOffsetDeg
      }deg)`;
    }

    override onRemove(): void {
      this.container?.remove();
      this.container = undefined;
      this.img = undefined;
      this.card = undefined;
      this.altValueEl = undefined;
      this.speedValueEl = undefined;
      this.progressFillEl = undefined;
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
