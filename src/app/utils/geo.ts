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
 * Position `t` (0..1) of the way from `from` to `to`, interpolated along the
 * great circle (spherical slerp) — the actual shortest path over the globe.
 *
 * Why not linear lat/lng lerp: the route polylines are drawn `geodesic: true`
 * (great-circle arcs), so a linearly-interpolated plane would drift off its own
 * drawn path on long-haul legs. Linear longitude lerp also takes the "long way"
 * across the antimeridian (e.g. Seoul→LA would arc across Europe instead of the
 * Pacific). Slerp matches the drawn route and crosses the antimeridian
 * correctly. It also keeps the direction of travel consistent with
 * `bearing()` (great-circle), so the marker's nose stays aligned with its
 * actual motion — Mercator is conformal, so the compass bearing equals the
 * on-screen path tangent.
 *
 * Standard great-circle interpolation: convert both endpoints to 3D unit
 * vectors, blend them with the slerp weights, then convert back to lat/lng.
 */
export function interpolatePosition(from: LatLng, to: LatLng, t: number): LatLng {
  const lat1 = toRadians(from.latitude);
  const lon1 = toRadians(from.longitude);
  const lat2 = toRadians(to.latitude);
  const lon2 = toRadians(to.longitude);

  // Central angle (angular distance) between the two points, via haversine.
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const delta = 2 * Math.asin(Math.min(1, Math.sqrt(a)));

  // Coincident (or effectively coincident) endpoints: nothing to interpolate,
  // and dividing by sin(delta) below would blow up.
  if (delta < 1e-9) {
    return { latitude: from.latitude, longitude: from.longitude };
  }

  const sinDelta = Math.sin(delta);
  const wFrom = Math.sin((1 - t) * delta) / sinDelta;
  const wTo = Math.sin(t * delta) / sinDelta;

  // Blend as 3D unit vectors, then convert back to lat/lng with atan2 (which
  // also resolves the correct longitude across the antimeridian).
  const x =
    wFrom * Math.cos(lat1) * Math.cos(lon1) +
    wTo * Math.cos(lat2) * Math.cos(lon2);
  const y =
    wFrom * Math.cos(lat1) * Math.sin(lon1) +
    wTo * Math.cos(lat2) * Math.sin(lon2);
  const z = wFrom * Math.sin(lat1) + wTo * Math.sin(lat2);

  return {
    latitude: toDegrees(Math.atan2(z, Math.hypot(x, y))),
    longitude: toDegrees(Math.atan2(y, x)),
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
