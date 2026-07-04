import { Airport } from '../models/airport.model';
import { FlightRoute } from '../models/flight-route.model';

/**
 * Static seed data for the client-side flight simulation. Three domestic Indian
 * routes with one aircraft each (see CLAUDE.md → Simulation data / Target scale:
 * 3 aircraft, 1 update/second). No external API — everything is generated
 * mathematically by the simulator from this data.
 */

/** Airports used by the seed routes, keyed by IATA code. */
export const AIRPORTS: Record<string, Airport> = {
  HYD: { code: 'HYD', name: 'Rajiv Gandhi Intl', city: 'Hyderabad', latitude: 17.2403, longitude: 78.4294 },
  BLR: { code: 'BLR', name: 'Kempegowda Intl', city: 'Bengaluru', latitude: 13.1986, longitude: 77.7066 },
  DEL: { code: 'DEL', name: 'Indira Gandhi Intl', city: 'Delhi', latitude: 28.5562, longitude: 77.1000 },
  BOM: { code: 'BOM', name: 'Chhatrapati Shivaji Intl', city: 'Mumbai', latitude: 19.0896, longitude: 72.8656 },
  MAA: { code: 'MAA', name: 'Chennai Intl', city: 'Chennai', latitude: 12.9941, longitude: 80.1709 },
  CCU: { code: 'CCU', name: 'Netaji Subhas Chandra Bose Intl', city: 'Kolkata', latitude: 22.6547, longitude: 88.4467 },
};

/** The three seed routes. */
export const ROUTES: FlightRoute[] = [
  { id: 'HYD-BLR', source: AIRPORTS['HYD'], destination: AIRPORTS['BLR'] },
  { id: 'DEL-BOM', source: AIRPORTS['DEL'], destination: AIRPORTS['BOM'] },
  { id: 'MAA-CCU', source: AIRPORTS['MAA'], destination: AIRPORTS['CCU'] },
];

/**
 * The static identity of a seeded flight. The simulator turns each seed into a
 * live `Aircraft` (adding position, heading, speed, timestamps) — this split
 * mirrors the future `flight-created` (identity) vs `flight-position` (live)
 * event separation.
 */
export interface FlightSeed {
  flightId: string;
  airline: string;
  aircraft: string;
  /** Which route this flight flies (references ROUTES[].id). */
  routeId: string;
}

/** One seeded flight per route (3 aircraft total). */
export const SEED_FLIGHTS: FlightSeed[] = [
  { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'HYD-BLR' },
  { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'DEL-BOM' },
  { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'MAA-CCU' },
];
