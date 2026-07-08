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
  // International airports used by the intercontinental demo routes below.
  JFK: { code: 'JFK', name: 'John F. Kennedy Intl', city: 'New York', latitude: 40.6413, longitude: -73.7781 },
  LHR: { code: 'LHR', name: 'Heathrow', city: 'London', latitude: 51.4700, longitude: -0.4543 },
  CDG: { code: 'CDG', name: 'Charles de Gaulle', city: 'Paris', latitude: 49.0097, longitude: 2.5479 },
  NRT: { code: 'NRT', name: 'Narita Intl', city: 'Tokyo', latitude: 35.7767, longitude: 140.3189 },
  SYD: { code: 'SYD', name: 'Kingsford Smith', city: 'Sydney', latitude: -33.9399, longitude: 151.1753 },
  CPT: { code: 'CPT', name: 'Cape Town Intl', city: 'Cape Town', latitude: -33.9700, longitude: 18.6017 },
  SIN: { code: 'SIN', name: 'Changi', city: 'Singapore', latitude: 1.3644, longitude: 103.9915 },
  GRU: { code: 'GRU', name: 'Guarulhos Intl', city: 'Sao Paulo', latitude: -23.4356, longitude: -46.4731 },
  YYZ: { code: 'YYZ', name: 'Pearson Intl', city: 'Toronto', latitude: 43.6777, longitude: -79.6248 },
  DXB: { code: 'DXB', name: 'Dubai Intl', city: 'Dubai', latitude: 25.2532, longitude: 55.3657 },
  // Additional airports for the second batch of intercontinental routes.
  LAX: { code: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', latitude: 33.9416, longitude: -118.4085 },
  FRA: { code: 'FRA', name: 'Frankfurt Intl', city: 'Frankfurt', latitude: 50.0379, longitude: 8.5622 },
  HKG: { code: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong', latitude: 22.3080, longitude: 113.9185 },
  IST: { code: 'IST', name: 'Istanbul Airport', city: 'Istanbul', latitude: 41.2753, longitude: 28.7519 },
  ICN: { code: 'ICN', name: 'Incheon Intl', city: 'Seoul', latitude: 37.4602, longitude: 126.4407 },
  JNB: { code: 'JNB', name: 'O. R. Tambo Intl', city: 'Johannesburg', latitude: -26.1392, longitude: 28.2460 },
  EZE: { code: 'EZE', name: 'Ministro Pistarini Intl', city: 'Buenos Aires', latitude: -34.8222, longitude: -58.5358 },
};

/**
 * Seed routes. The first three are the original domestic Indian legs; the rest
 * are intercontinental routes spanning different continents (added for a denser,
 * more global demo). Each `source`/`destination` references an entry in AIRPORTS.
 */
export const ROUTES: FlightRoute[] = [
  { id: 'HYD-BLR', source: AIRPORTS['HYD'], destination: AIRPORTS['BLR'] },
  { id: 'DEL-BOM', source: AIRPORTS['DEL'], destination: AIRPORTS['BOM'] },
  { id: 'MAA-CCU', source: AIRPORTS['MAA'], destination: AIRPORTS['CCU'] },
  // Intercontinental routes (random country-to-country across continents).
  { id: 'JFK-LHR', source: AIRPORTS['JFK'], destination: AIRPORTS['LHR'] }, // N. America → Europe
  { id: 'DXB-SIN', source: AIRPORTS['DXB'], destination: AIRPORTS['SIN'] }, // Asia → Asia
  { id: 'CDG-GRU', source: AIRPORTS['CDG'], destination: AIRPORTS['GRU'] }, // Europe → S. America
  { id: 'NRT-SYD', source: AIRPORTS['NRT'], destination: AIRPORTS['SYD'] }, // Asia → Oceania
  { id: 'LHR-YYZ', source: AIRPORTS['LHR'], destination: AIRPORTS['YYZ'] }, // Europe → N. America
  { id: 'SIN-CPT', source: AIRPORTS['SIN'], destination: AIRPORTS['CPT'] }, // Asia → Africa
  { id: 'GRU-JFK', source: AIRPORTS['GRU'], destination: AIRPORTS['JFK'] }, // S. America → N. America
  { id: 'SYD-DXB', source: AIRPORTS['SYD'], destination: AIRPORTS['DXB'] }, // Oceania → Asia
  { id: 'CPT-CDG', source: AIRPORTS['CPT'], destination: AIRPORTS['CDG'] }, // Africa → Europe
  { id: 'YYZ-NRT', source: AIRPORTS['YYZ'], destination: AIRPORTS['NRT'] }, // N. America → Asia
  // Second batch of intercontinental routes.
  { id: 'LAX-HKG', source: AIRPORTS['LAX'], destination: AIRPORTS['HKG'] }, // N. America → Asia
  { id: 'FRA-EZE', source: AIRPORTS['FRA'], destination: AIRPORTS['EZE'] }, // Europe → S. America
  { id: 'IST-ICN', source: AIRPORTS['IST'], destination: AIRPORTS['ICN'] }, // Europe → Asia
  { id: 'JNB-DXB', source: AIRPORTS['JNB'], destination: AIRPORTS['DXB'] }, // Africa → Asia
  { id: 'ICN-LAX', source: AIRPORTS['ICN'], destination: AIRPORTS['LAX'] }, // Asia → N. America
  { id: 'EZE-JNB', source: AIRPORTS['EZE'], destination: AIRPORTS['JNB'] }, // S. America → Africa
  { id: 'HKG-FRA', source: AIRPORTS['HKG'], destination: AIRPORTS['FRA'] }, // Asia → Europe
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

/**
 * Seeded flights. The first three are the original domestic aircraft; the rest
 * are 10 intercontinental flights.
 *
 * IMPORTANT — flightId vs photo: `flightId` MUST be unique. The map keys every
 * marker by it (map.component.ts), and selection/info-panel/route lookups all
 * `.find(... flightId ===)`, so duplicate ids would collapse multiple aircraft
 * onto one marker. The "only 3 aircraft images" constraint is handled by the
 * separate `photo` field instead: each new flight has its own unique id but
 * reuses one of the three existing images (cycled 6E-201 / AI-505 / UK-777).
 */
export const SEED_FLIGHTS: FlightSeed[] = [
  { flightId: '6E-201', airline: 'IndiGo', aircraft: 'Airbus A320neo', routeId: 'HYD-BLR', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'AI-505', airline: 'Air India', aircraft: 'Boeing 737-800', routeId: 'DEL-BOM', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'UK-777', airline: 'Vistara', aircraft: 'Airbus A321', routeId: 'MAA-CCU', photo: 'aircraft/UK-777.jpg' },
  // Intercontinental flights — unique ids, images reused from the three above.
  { flightId: 'BA-178', airline: 'British Airways', aircraft: 'Boeing 777-300ER', routeId: 'JFK-LHR', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'EK-354', airline: 'Emirates', aircraft: 'Airbus A380-800', routeId: 'DXB-SIN', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'AF-456', airline: 'Air France', aircraft: 'Boeing 777-300ER', routeId: 'CDG-GRU', photo: 'aircraft/UK-777.jpg' },
  { flightId: 'QF-26', airline: 'Qantas', aircraft: 'Boeing 787-9', routeId: 'NRT-SYD', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'AC-857', airline: 'Air Canada', aircraft: 'Boeing 787-9', routeId: 'LHR-YYZ', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'SQ-478', airline: 'Singapore Airlines', aircraft: 'Airbus A350-900', routeId: 'SIN-CPT', photo: 'aircraft/UK-777.jpg' },
  { flightId: 'UA-149', airline: 'United Airlines', aircraft: 'Boeing 767-300ER', routeId: 'GRU-JFK', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'EK-415', airline: 'Emirates', aircraft: 'Airbus A380-800', routeId: 'SYD-DXB', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'AF-995', airline: 'Air France', aircraft: 'Airbus A350-900', routeId: 'CPT-CDG', photo: 'aircraft/UK-777.jpg' },
  { flightId: 'NH-6', airline: 'ANA', aircraft: 'Boeing 787-9', routeId: 'YYZ-NRT', photo: 'aircraft/6E-201.jpg' },
  // Second batch — unique ids, images still reused from the three.
  { flightId: 'CX-880', airline: 'Cathay Pacific', aircraft: 'Boeing 777-300ER', routeId: 'LAX-HKG', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'LH-510', airline: 'Lufthansa', aircraft: 'Airbus A340-600', routeId: 'FRA-EZE', photo: 'aircraft/UK-777.jpg' },
  { flightId: 'TK-90', airline: 'Turkish Airlines', aircraft: 'Boeing 777-300ER', routeId: 'IST-ICN', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'EK-763', airline: 'Emirates', aircraft: 'Boeing 777-300ER', routeId: 'JNB-DXB', photo: 'aircraft/AI-505.jpg' },
  { flightId: 'KE-11', airline: 'Korean Air', aircraft: 'Boeing 747-8i', routeId: 'ICN-LAX', photo: 'aircraft/UK-777.jpg' },
  { flightId: 'SA-54', airline: 'South African Airways', aircraft: 'Airbus A330-300', routeId: 'EZE-JNB', photo: 'aircraft/6E-201.jpg' },
  { flightId: 'LH-796', airline: 'Lufthansa', aircraft: 'Airbus A350-900', routeId: 'HKG-FRA', photo: 'aircraft/AI-505.jpg' },
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
