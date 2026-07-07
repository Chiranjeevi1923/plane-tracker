import { Routes } from '@angular/router';

/**
 * The 2D map + header live permanently in AppComponent (outside the router
 * outlet) so their state survives navigation. The outlet is used only to overlay
 * the full-screen 3D flight view on its own route, which lazy-loads Three.js.
 */
export const routes: Routes = [
  {
    path: '3d-view/:flightId',
    loadComponent: () =>
      import('./components/flight-view-3d/flight-view-3d.component').then(
        (m) => m.FlightView3dComponent,
      ),
  },
  // Empty root renders nothing in the outlet (the map shows underneath).
  { path: '', children: [] },
  { path: '**', redirectTo: '' },
];
