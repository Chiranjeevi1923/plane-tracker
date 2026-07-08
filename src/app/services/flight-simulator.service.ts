import { Injectable } from '@angular/core';
import { Aircraft } from '../models/aircraft.model';
import { FlightRoute } from '../models/flight-route.model';
import { FlightSeed, ROUTES, SEED_FLIGHTS } from '../data/seed-data';
import { bearing, haversineDistanceNm, interpolatePosition } from '../utils/geo';

/** Cruise profile. Each flight gets a random speed in this range. */
const MIN_SPEED_KTS = 2000;
const MAX_SPEED_KTS = 3500;
const CRUISE_ALTITUDE_FT = 35000;
/** Fractions of the route spent climbing / descending (rest is cruise). */
const CLIMB_FRACTION = 0.15;
const DESCENT_FRACTION = 0.15;

const MS_PER_HOUR = 3_600_000;

/**
 * Per-flight configuration. Note there is NO mutable "progress" here: position
 * is a pure function of wall-clock time, so we can sample it at any framerate
 * without accumulating drift. That's what makes rendering smooth (sample every
 * animation frame) while the data still represents a 1 update/sec feed.
 */
interface FlightConfig {
  seed: FlightSeed;
  route: FlightRoute;
  /** Route length (nm), precomputed to convert speed → progress. */
  distanceNm: number;
  /** This flight's cruise speed (knots), randomised per flight. */
  speedKts: number;
  /** Epoch ms when this flight departed its source (may be in the past). */
  startTimeMs: number;
}

/**
 * Client-side flight simulator (Flavor B — computed, time-based).
 *
 * Positions/headings are derived mathematically from the seed route endpoints
 * as a continuous function of time (no external feed, no backend). `sample(now)`
 * returns the whole fleet's live state at an instant; callers can sample it as
 * often as they like (e.g. once per animation frame) for smooth motion. The
 * emitted `Aircraft` shape matches the future Kafka `flight-position` payload.
 */
@Injectable({ providedIn: 'root' })
export class FlightSimulatorService {
  private readonly flights: FlightConfig[] = this.initFlights();

  /** Live state of every aircraft at time `nowMs` (epoch ms). */
  sample(nowMs: number): Aircraft[] {
    return this.flights.map((flight) => this.sampleFlight(flight, nowMs));
  }

  /** Build per-flight config from the seeds, resolving each route once. */
  private initFlights(): FlightConfig[] {
    const now = Date.now();
    const configs: FlightConfig[] = [];

    for (const seed of SEED_FLIGHTS) {
      const route = ROUTES.find((r) => r.id === seed.routeId);
      if (!route) {
        // Guard: a bad seed shouldn't break the fleet — skip and log.
        console.error(
          `[FlightSimulator] Route '${seed.routeId}' not found for flight ` +
            `${seed.flightId}; skipping this flight.`,
        );
        continue;
      }

      const distanceNm = haversineDistanceNm(route.source, route.destination);
      const speedKts =
        MIN_SPEED_KTS + Math.random() * (MAX_SPEED_KTS - MIN_SPEED_KTS);
      // Random head-start (0..one full leg) so aircraft aren't bunched at the
      // source when the app loads.
      const legDurationHours = distanceNm / speedKts;
      const headStartMs = Math.random() * legDurationHours * MS_PER_HOUR;

      configs.push({
        seed,
        route,
        distanceNm,
        speedKts,
        startTimeMs: now - headStartMs,
      });
    }

    return configs;
  }

  /** Compute one aircraft's live record at time `nowMs`. */
  private sampleFlight(flight: FlightConfig, nowMs: number): Aircraft {
    const { seed, route, distanceNm, speedKts, startTimeMs } = flight;

    const elapsedHours = (nowMs - startTimeMs) / MS_PER_HOUR;
    const traveledNm = speedKts * elapsedHours;
    // Continuous looping: wrap distance travelled back to the start of the leg.
    const legIndex = Math.floor(traveledNm / distanceNm);
    const progress = (traveledNm % distanceNm) / distanceNm;

    const position = interpolatePosition(route.source, route.destination, progress);
    // Departure of the current leg (each loop is a fresh departure).
    const legStartMs =
      startTimeMs + legIndex * (distanceNm / speedKts) * MS_PER_HOUR;

    return {
      flightId: seed.flightId,
      airline: seed.airline,
      aircraft: seed.aircraft,
      source: route.source.code,
      destination: route.destination.code,
      latitude: position.latitude,
      longitude: position.longitude,
      altitude: this.altitudeAt(progress),
      // Heading from the live position toward the destination, so it stays
      // correct even if routes later become curved.
      heading: bearing(position, route.destination),
      speed: Math.round(speedKts),
      progress,
      departure: new Date(legStartMs).toISOString(),
      // ETA intentionally deferred for now (Phase 2 scope) — filled in later.
      eta: '',
    };
  }

  /**
   * Simplified vertical profile: linear climb over the first CLIMB_FRACTION,
   * cruise in the middle, linear descent over the last DESCENT_FRACTION.
   */
  private altitudeAt(progress: number): number {
    if (progress < CLIMB_FRACTION) {
      return Math.round(CRUISE_ALTITUDE_FT * (progress / CLIMB_FRACTION));
    }
    if (progress > 1 - DESCENT_FRACTION) {
      return Math.round(CRUISE_ALTITUDE_FT * ((1 - progress) / DESCENT_FRACTION));
    }
    return CRUISE_ALTITUDE_FT;
  }
}
