import * as THREE from 'three';
import { MapTheme } from '../../services/map-theme.service';

/**
 * Night-sky starfield for the 3D flight view.
 *
 * Two THREE.Points layers (many dim stars + a few bright ones) scattered on a
 * large hemisphere around the scene. World-fixed — the sky doesn't yaw with
 * the aircraft or scroll with the terrain, matching the fixed background
 * colour. Only visible in the night theme; `setTheme` flips visibility.
 *
 * The material opts out of fog (the scene fog ends at ~160 units, far closer
 * than the star dome) and uses pixel-sized, non-attenuated points so stars
 * stay crisp at any camera distance. Terrain/model still occlude them via the
 * normal depth test.
 */

/** Radius of the star dome (well outside the fog, inside the camera far). */
const DOME_RADIUS = 900;
/** Keep stars this far above the horizon (fraction of radius). */
const MIN_ELEVATION = 0.04;

/** Star layers: count, pixel size, and brightness range. */
const LAYERS = [
  { count: 700, size: 1.6, minLum: 0.35, maxLum: 0.7 }, // dim background field
  { count: 120, size: 2.8, minLum: 0.7, maxLum: 1.0 }, // bright standouts
];

/** Subtle star tints (mostly white, a few cool blue / warm yellow). */
const STAR_TINTS = ['#ffffff', '#ffffff', '#ffffff', '#cfe0ff', '#ffe9c4'];

export interface Stars {
  group: THREE.Group;
  /** Show at night, hide by day. */
  setTheme: (theme: MapTheme) => void;
  /** Free the geometries/materials (Points aren't covered by mesh traversal). */
  dispose: () => void;
}

export function createStars(theme: MapTheme): Stars {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.PointsMaterial[] = [];

  const color = new THREE.Color();
  for (const layer of LAYERS) {
    const positions = new Float32Array(layer.count * 3);
    const colors = new Float32Array(layer.count * 3);

    for (let i = 0; i < layer.count; i++) {
      // Uniform random direction on the upper hemisphere (above the horizon).
      const y = MIN_ELEVATION + Math.random() * (1 - MIN_ELEVATION);
      const azimuth = Math.random() * Math.PI * 2;
      const horizontal = Math.sqrt(1 - y * y);
      positions[i * 3] = Math.cos(azimuth) * horizontal * DOME_RADIUS;
      positions[i * 3 + 1] = y * DOME_RADIUS;
      positions[i * 3 + 2] = Math.sin(azimuth) * horizontal * DOME_RADIUS;

      const luminance =
        layer.minLum + Math.random() * (layer.maxLum - layer.minLum);
      color
        .set(STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)])
        .multiplyScalar(luminance);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);

    const material = new THREE.PointsMaterial({
      size: layer.size,
      sizeAttenuation: false, // constant pixel size — reads as distant stars
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      fog: false, // the dome sits far beyond the scene fog's far distance
    });
    materials.push(material);

    group.add(new THREE.Points(geometry, material));
  }

  const setTheme = (t: MapTheme): void => {
    group.visible = t === 'night';
  };

  const dispose = (): void => {
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const material of materials) {
      material.dispose();
    }
  };

  setTheme(theme);
  return { group, setTheme, dispose };
}
