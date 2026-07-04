import { Airport } from './airport.model';

/**
 * A seed flight route between two airports. Aircraft are generated along these
 * routes by the client-side simulator (no external aviation feed).
 */
export interface FlightRoute {
  /** Stable identifier, e.g. 'HYD-BLR'. */
  id: string;
  /** Departure airport. */
  source: Airport;
  /** Arrival airport. */
  destination: Airport;
}
