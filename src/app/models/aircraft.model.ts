/**
 * A single aircraft's live record — the shape streamed on every position
 * update. This mirrors the future Kafka `flight-position` payload exactly, so
 * the UI can later switch from the client-side simulator to a live feed with no
 * change to models or rendering.
 *
 * Field list matches the project spec (see CLAUDE.md → Simulation data).
 */
export interface Aircraft {
  /** Unique flight identifier / call sign, e.g. '6E-201'. */
  flightId: string;
  /** Operating airline, e.g. 'IndiGo'. */
  airline: string;
  /** Aircraft type, e.g. 'Airbus A320neo'. */
  aircraft: string;
  /** Source airport IATA code. */
  source: string;
  /** Destination airport IATA code. */
  destination: string;
  /** Current latitude in decimal degrees. */
  latitude: number;
  /** Current longitude in decimal degrees. */
  longitude: number;
  /** Current altitude in feet. */
  altitude: number;
  /** Current heading in degrees (0–359, 0 = north, clockwise). */
  heading: number;
  /** Current ground speed in knots. */
  speed: number;
  /**
   * Fraction of the current leg completed, 0 (just departed) → 1 (arriving).
   * Derived from distance travelled; drives the flight-progress bar in the UI.
   * Real position feeds commonly carry a percent-complete alongside lat/long,
   * so this stays faithful to the future `flight-position` payload.
   */
  progress: number;
  /** Departure time (ISO 8601 timestamp). */
  departure: string;
  /** Estimated time of arrival (ISO 8601 timestamp). */
  eta: string;
}
