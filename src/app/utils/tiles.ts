/**
 * Web Mercator (EPSG:3857) slippy-tile helpers for the real-world 3D terrain.
 *
 * Kept pure and framework-agnostic (like geo.ts) so it's trivially testable.
 * NOTE this is a DIFFERENT coordinate system from geo.ts: geo.ts is the aviation
 * domain (nautical miles, great-circle, compass bearing on a sphere), whereas
 * these functions live in the map-tile pyramid (metres, power-of-two zoom grid).
 * They intentionally don't share code.
 *
 * Tile addressing is the standard OSM/Google "slippy map" scheme: at zoom `z`
 * the world is a 2^z × 2^z grid of 256px tiles, x increasing east, y increasing
 * south, with (0,0) at the north-west corner (lon -180, lat +85.05).
 */

/** Tile edge in pixels for the sources we use (Esri imagery, AWS terrarium). */
export const TILE_PIXELS = 256;

/** Earth circumference at the equator in metres (2π · 6378137). */
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Fractional slippy-tile coordinates (whole part = tile index, frac = position within). */
export interface TileFrac {
  x: number;
  y: number;
}

/**
 * Longitude/latitude (degrees) → fractional slippy-tile coordinates at zoom `z`.
 * Standard Web Mercator projection; latitude is clamped by the caller's data
 * (valid Mercator range is ±85.05°, well outside any flight route here).
 */
export function lonLatToTileFrac(lon: number, lat: number, z: number): TileFrac {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export interface LonLat {
  lon: number;
  lat: number;
}

/** Inverse of {@link lonLatToTileFrac}: fractional tile coords → lon/lat degrees. */
export function tileToLonLat(x: number, y: number, z: number): LonLat {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const m = Math.PI - (2 * Math.PI * y) / n;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m)));
  return { lon, lat };
}

/**
 * Ground span (metres) of one tile edge at latitude `lat`, zoom `z`. Mercator
 * tiles shrink toward the poles by cos(lat), so this is latitude-dependent — the
 * terrain module uses it to convert tile size into world units.
 */
export function tileSizeMetres(lat: number, z: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/**
 * Decode a Terrarium-encoded RGB triplet (each channel 0–255) to elevation in
 * metres. Terrarium packs a 16-bit height with 1/256 m sub-precision:
 *   elevation = R·256 + G + B/256 − 32768
 * (the −32768 bias lets the format represent ocean floor below sea level).
 */
export function terrariumToMetres(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Wrap a tile index into the valid [0, 2^z) range. Longitude wraps the globe, so
 * a tile x just past the antimeridian maps back to the other edge. (The flight
 * routes here are nowhere near it, but URL building stays correct regardless.)
 */
export function wrapTile(v: number, z: number): number {
  const n = 2 ** z;
  return ((v % n) + n) % n;
}

/** Clamp a tile index to [0, 2^z − 1] — used for the y axis, which does not wrap. */
export function clampTile(v: number, z: number): number {
  return Math.max(0, Math.min(2 ** z - 1, v));
}

/**
 * Esri "World Imagery" tile URL — keyless, no billing, CORS-enabled. Note the
 * path order is {z}/{y}/{x} (ArcGIS convention), not {z}/{x}/{y}.
 * Attribution required: © Esri, Maxar, Earthstar Geographics.
 */
export function imageryTileUrl(x: number, y: number, z: number): string {
  return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * AWS Terrain Tiles (Mapzen/Tilezen terrarium PNG) elevation URL — keyless, no
 * billing, CORS-enabled. Path order is {z}/{x}/{y}. Decode with
 * {@link terrariumToMetres}. Attribution: AWS Terrain Tiles / Mapzen.
 */
export function elevationTileUrl(x: number, y: number, z: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}
