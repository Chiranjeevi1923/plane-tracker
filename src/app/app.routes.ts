import { Routes } from '@angular/router';

/**
 * The 2D map + header live permanently in AppComponent (outside the router
 * outlet) so their state survives navigation. The outlet is used only to overlay
 * the full-screen 3D flight view on its own route, which lazy-loads Three.js.
 *
 * URL scheme:
 *   /                       first visit → map fits the whole world
 *   /{lat},{lng}/{zoom}     FlightRadar24-style shareable map view
 *                           (e.g. /20.2345,-13.9012/11.5) — MapComponent
 *                           reads it on init and writes it back on `idle`
 *                           (i.e. after every pan/zoom settles)
 *   /3d-view/:flightId      full-screen 3D overlay for one aircraft
 *
 * Route order matters: the 3D view is matched FIRST so its two-segment URL
 * doesn't fall into the generic `:coords/:zoom` pattern below. If a URL like
 * `/foo/bar` matches `:coords/:zoom` but doesn't parse as coords, MapComponent
 * simply falls back to fitBounds and overwrites the URL on the first idle.
 */
export const routes: Routes = [
  {
    path: '3d-view/:flightId',
    loadComponent: () =>
      import('./components/flight-view-3d/flight-view-3d.component').then(
        (m) => m.FlightView3dComponent,
      ),
  },
  // Map view URL — no component in the outlet; the map lives in AppComponent
  // and reads the URL directly.
  { path: ':coords/:zoom', children: [] },
  // Empty root renders nothing in the outlet (the map shows underneath).
  { path: '', children: [] },
  { path: '**', redirectTo: '' },
];
