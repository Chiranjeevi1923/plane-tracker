import type { MapTheme } from '../../services/map-theme.service';

/**
 * Google Maps style definitions per theme, applied via
 * `map.setOptions({ styles })`.
 *
 * `day` is a muted-colourful map: real hues (green land, blue water, green
 * parks) toned down by a light global "grey wash" (a gentle desaturate + slight
 * darken applied to all geometry). This keeps the map lively without letting it
 * compete with the aircraft markers — the amber-tinted, shadowed planes still
 * read clearly against the softened colours. `night` is the standard dark style.
 *
 * Detail (POI icons + labels) is hidden when zoomed out and revealed past
 * LABEL_ZOOM_THRESHOLD (see mapStyleFor) so the world view stays clean and the
 * planes are easy to spot.
 *
 * Note: these `styles` only take effect on a raster map (i.e. a map without a
 * `mapId`). If a Map ID is ever added, styling must move to cloud-based styling.
 */

/** At/above this zoom, POI icons and labels are shown; below it they're hidden. */
export const LABEL_ZOOM_THRESHOLD = 7;

/** Muted-colourful day map: real hues under a light grey wash. */
const DAY_STYLE: google.maps.MapTypeStyle[] = [
  // Global "grey wash": a gentle desaturate + slight darken over all geometry.
  // Much softer than a full greyscale so the hues below survive — this is the
  // grey overlay that keeps the map from overpowering the plane markers.
  { elementType: 'geometry', stylers: [{ saturation: -22 }, { lightness: -4 }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a5560' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f2f4f5' }] },
  // Colourful-but-muted base features.
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#d7dfc9' }] }, // soft sage land
  { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ color: '#cdd8bd' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a6c6dd' }] }, // muted sea blue
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#cdd6c4' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#b6cea6' }] }, // green parks
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e7eae2' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#d8ddd2' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#ecdfc4' }] }, // subtle warm highways
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e0d3b4' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#b3bda8' }] },
];

/** Standard dark night map. */
const NIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

/**
 * Always applied: keep only the labels we want — country, state (province) and
 * city (locality) names, plus airport names — and hide the rest (POI, road
 * numbers/names, transit, neighbourhood/land-parcel labels) so the map isn't a
 * wall of text.
 */
const DECLUTTER_LABELS: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  // ...but keep airports (icon + name), which the user does want.
  {
    featureType: 'transit.station.airport',
    elementType: 'labels',
    stylers: [{ visibility: 'on' }],
  },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
];

/**
 * Appended when zoomed out past LABEL_ZOOM_THRESHOLD: hides *all* remaining
 * labels (country/state/city/airport) so the small-scale world view is a clean
 * canvas.
 */
const HIDE_DETAIL: google.maps.MapTypeStyle[] = [
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

const BASE_STYLE: Record<MapTheme, google.maps.MapTypeStyle[]> = {
  day: DAY_STYLE,
  night: NIGHT_STYLE,
};

/**
 * Resolve the map style for a given theme and zoom. Labels/icons are only shown
 * once zoomed in to LABEL_ZOOM_THRESHOLD; below that they're hidden.
 */
export function mapStyleFor(
  theme: MapTheme,
  zoom: number,
): google.maps.MapTypeStyle[] {
  // Base theme + the always-on label declutter (country/state/city/airport only).
  const base = [...BASE_STYLE[theme], ...DECLUTTER_LABELS];
  return zoom >= LABEL_ZOOM_THRESHOLD ? base : [...base, ...HIDE_DETAIL];
}
