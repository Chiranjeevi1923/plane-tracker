/**
 * Environment template — SAFE TO COMMIT (no real key).
 *
 * Setup:
 *   1. Copy this file to `environment.ts` (and `environment.prod.ts` for prod builds).
 *   2. Paste your Google Maps JavaScript API key into `googleMapsApiKey`.
 *
 * `environment.ts` / `environment.prod.ts` are gitignored so the real key is
 * never committed. See CLAUDE.md → "Google Maps setup".
 */
export const environment = {
  production: false,
  // Google Maps JavaScript API key. Leave empty here; set the real value in
  // the gitignored environment.ts. An empty key means the map will fail to load
  // and the loader service will surface a clear error.
  googleMapsApiKey: '',
};
