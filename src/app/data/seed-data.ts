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
  // JFK: { code: 'JFK', name: 'John F. Kennedy Intl', city: 'New York', latitude: 40.6413, longitude: -73.7781 },
  // LHR: { code: 'LHR', name: 'Heathrow', city: 'London', latitude: 51.4700, longitude: -0.4543 },
  // CDG: { code: 'CDG', name: 'Charles de Gaulle', city: 'Paris', latitude: 49.0097, longitude: 2.5479 },
  // NRT: { code: 'NRT', name: 'Narita Intl', city: 'Tokyo', latitude: 35.7767, longitude: 140.3189 },
  // SYD: { code: 'SYD', name: 'Kingsford Smith', city: 'Sydney', latitude: -33.9399, longitude: 151.1753 },
  // CPT: { code: 'CPT', name: 'Cape Town Intl', city: 'Cape Town', latitude: -33.9700, longitude: 18.6017 },
  // SIN: { code: 'SIN', name: 'Changi', city: 'Singapore', latitude: 1.3644, longitude: 103.9915 },
  // GRU: { code: 'GRU', name: 'Guarulhos Intl', city: 'Sao Paulo', latitude: -23.4356, longitude: -46.4731 },
  // YYZ: { code: 'YYZ', name: 'Pearson Intl', city: 'Toronto', latitude: 43.6777, longitude: -79.6248 },
  // DXB: { code: 'DXB', name: 'Dubai Intl', city: 'Dubai', latitude: 25.2532, longitude: 55.3657 },
};

/** The three seed routes. */
export const ROUTES: FlightRoute[] = [
  { id: 'HYD-BLR', source: AIRPORTS['HYD'], destination: AIRPORTS['BLR'] },
  { id: 'DEL-BOM', source: AIRPORTS['DEL'], destination: AIRPORTS['BOM'] },
  { id: 'MAA-CCU', source: AIRPORTS['MAA'], destination: AIRPORTS['CCU'] },
  // { id: 'HYD-JFK', source: AIRPORTS['HYD'], destination: AIRPORTS['JFK'] },
  // { id: 'BLR-LHR', source: AIRPORTS['BLR'], destination: AIRPORTS['LHR'] },
  // { id: 'DEL-CDG', source: AIRPORTS['DEL'], destination: AIRPORTS['CDG'] },
  // { id: 'BOM-NRT', source: AIRPORTS['BOM'], destination: AIRPORTS['NRT'] },
  // { id: 'MAA-SYD', source: AIRPORTS['MAA'], destination: AIRPORTS['SYD'] },
  // { id: 'CCU-CPT', source: AIRPORTS['CCU'], destination: AIRPORTS['CPT'] },
  // { id: 'JFK-SIN', source: AIRPORTS['JFK'], destination: AIRPORTS['SIN'] },
  // { id: 'LHR-GRU', source: AIRPORTS['LHR'], destination: AIRPORTS['GRU'] },
  // { id: 'CDG-YYZ', source: AIRPORTS['CDG'], destination: AIRPORTS['YYZ'] },
  // { id: 'NRT-DXB', source: AIRPORTS['NRT'], destination: AIRPORTS['DXB'] },
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
  /**
   * Aircraft photo shown in the hover card, served from `public/`. Static
   * identity data (would ride on `flight-created`, not `flight-position`), so
   * it lives on the seed rather than the live `Aircraft` record.
   */
  photo: string;
}

/** One seeded flight per route (3 aircraft total). */
export const SEED_FLIGHTS: FlightSeed[] = [
  { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'HYD-BLR', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'DEL-BOM', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'MAA-CCU', photo: 'aircraft/UK-777.jpg' },
  // { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'HYD-JFK', photo: 'aircraft/6E-201.jpg' },
  // { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'BLR-LHR', photo: 'aircraft/AI-505.jpg' },
  // { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'DEL-CDG', photo: 'aircraft/UK-777.jpg' },
  // { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'BOM-NRT', photo: 'aircraft/6E-201.jpg' },
  // { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'MAA-SYD', photo: 'aircraft/AI-505.jpg' },
  // { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'CCU-CPT', photo: 'aircraft/UK-777.jpg' },
  // { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'JFK-SIN', photo: 'aircraft/6E-201.jpg' },
  // { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'LHR-GRU', photo: 'aircraft/AI-505.jpg' },
  // { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'CDG-YYZ', photo: 'aircraft/UK-777.jpg' },
  // { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'NRT-DXB', photo: 'aircraft/6E-201.jpg' },
];

/**
 * Resolve an IATA airport code to its city name for display (e.g. 'HYD' →
 * 'Hyderabad'). Falls back to the code itself if it isn't a seeded airport, so
 * the UI never shows a blank. In a live system this lookup would come from an
 * airports reference service; here it's the static seed map.
 */
export function cityForAirport(code: string): string {
  return AIRPORTS[code]?.city ?? code;
}
