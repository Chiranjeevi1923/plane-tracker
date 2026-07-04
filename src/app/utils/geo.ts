/**
 * Pure geospatial helpers for the flight simulation.
 *
 * Kept side-effect free and framework-agnostic so they're trivially testable
 * and reusable. All angles are in decimal degrees unless noted; distances are
 * in nautical miles (nm) to match aviation `speed` in knots (nm/hour).
 */

/** Earth's mean radius in nautical miles. */
const EARTH_RADIUS_NM = 3440.065;

/** A minimal lat/lng shape (both Airport and Aircraft satisfy it). */
export interface LatLng {
  latitude: number;
  longitude: number;
}

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Linear interpolation between `a` and `b` at fraction `t` (0..1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Position `t` (0..1) of the way from `from` to `to`, interpolated linearly in
 * lat/lng space. Fine for short routes on a Mercator map; long-haul would want
 * great-circle (slerp) interpolation instead.
 */
export function interpolatePosition(from: LatLng, to: LatLng, t: number): LatLng {
  return {
    latitude: lerp(from.latitude, to.latitude, t),
    longitude: lerp(from.longitude, to.longitude, t),
  };
}

/**
 * Initial great-circle bearing from `from` to `to`, in compass degrees
 * (0–359, 0 = North, increasing clockwise). Uses atan2 so the quadrant is
 * always correct.
 */
export function bearing(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Great-circle distance between two points in nautical miles (haversine).
 * Used to convert `speed` (knots) into progress along a route per tick.
 */
export function haversineDistanceNm(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}
