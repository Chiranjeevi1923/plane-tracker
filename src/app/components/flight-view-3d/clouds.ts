import * as THREE from 'three';
import { MapTheme } from '../../services/map-theme.service';

/**
 * Cheap billboard clouds for the 3D flight view: a handful of THREE.Sprites that
 * share one procedurally-drawn soft cloud texture, scattered around the aircraft
 * and slowly drifting on the "wind". Semi-transparent, no dependencies, low cost.
 */

const CLOUD_COUNT = 24;
/** XZ scatter radius (clouds wrap back when they drift past this). */
const AREA_RADIUS = 130;
/** Altitude band the clouds occupy (around the plane at y = 0). */
const Y_MIN = -6;
const Y_MAX = 12;

export interface Clouds {
  group: THREE.Group;
  /**
   * Move the clouds by `velocity` (world units/sec) for `dt` seconds, wrapping
   * them back through the disc so they stream endlessly. Pass the flight's
   * backward velocity to make clouds sweep past the plane.
   */
  update: (dt: number, velocity: THREE.Vector3) => void;
  /** Swap cloud tint/opacity for the theme. */
  recolor: (theme: MapTheme) => void;
  /** Free the shared texture + material. */
  dispose: () => void;
}

/** Draw a few overlapping soft blobs into a canvas → one puffy cloud texture. */
function makeCloudTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const blobs = [
    { x: 0.5, y: 0.52, r: 0.34 },
    { x: 0.34, y: 0.56, r: 0.26 },
    { x: 0.66, y: 0.56, r: 0.26 },
    { x: 0.5, y: 0.44, r: 0.28 },
    { x: 0.44, y: 0.62, r: 0.2 },
    { x: 0.6, y: 0.62, r: 0.2 },
  ];
  for (const b of blobs) {
    const cx = b.x * size;
    const cy = b.y * size;
    const r = b.r * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createClouds(theme: MapTheme): Clouds {
  const texture = makeCloudTexture();
  // One shared material keeps recolor/dispose trivial; variety comes from the
  // per-sprite position/scale/flip below.
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.4,
  });

  const group = new THREE.Group();
  const sprites: THREE.Sprite[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  for (let i = 0; i < CLOUD_COUNT; i++) {
    const sprite = new THREE.Sprite(material);
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * AREA_RADIUS; // even area distribution
    sprite.position.set(
      Math.cos(angle) * radius,
      rand(Y_MIN, Y_MAX),
      Math.sin(angle) * radius,
    );
    const w = rand(22, 50);
    // Wider than tall, randomly flipped for a little variety.
    sprite.scale.set(Math.random() < 0.5 ? -w : w, w * 0.55, 1);
    sprites.push(sprite);
    group.add(sprite);
  }

  const dir = new THREE.Vector3(); // scratch, reused each frame
  const update = (dt: number, velocity: THREE.Vector3): void => {
    const speed = velocity.length();
    const canWrap = speed > 1e-4;
    if (canWrap) {
      dir.copy(velocity).multiplyScalar(1 / speed);
    }
    for (const sprite of sprites) {
      sprite.position.addScaledVector(velocity, dt);
      // Once a cloud drifts past the disc, wrap it to the far side (opposite the
      // motion) so clouds keep sweeping through.
      if (
        canWrap &&
        Math.hypot(sprite.position.x, sprite.position.z) > AREA_RADIUS
      ) {
        sprite.position.addScaledVector(dir, -2 * AREA_RADIUS);
      }
    }
  };

  const recolor = (t: MapTheme): void => {
    if (t === 'day') {
      material.color.set('#ffffff');
      material.opacity = 0.42;
    } else {
      material.color.set('#9fb0c2');
      material.opacity = 0.22;
    }
  };

  const dispose = (): void => {
    material.dispose();
    texture.dispose();
  };

  recolor(theme);
  return { group, update, recolor, dispose };
}
