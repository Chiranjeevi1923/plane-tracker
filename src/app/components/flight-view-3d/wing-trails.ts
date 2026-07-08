import * as THREE from 'three';

/**
 * Wind-streak trails off the wings' trailing edges for the 3D flight view.
 *
 * The aircraft is stationary at the origin (the world scrolls past it), so
 * "speed" is conveyed by thin vapor streaks streaming backward from the wings:
 * long cross-billboarded quads mapped with a seamless canvas texture of faded
 * white streaks, whose V offset scrolls tailward every frame. Scroll rate and
 * opacity scale with the aircraft's speed, so faster flights visibly rip
 * through the air harder.
 *
 * Coordinate frame: built in the bank group's local space (nose = +Z, wings =
 * ±X), so the trails yaw with the heading AND roll with the banking.
 */

/** Speed (kts) at which the effect runs at its base intensity. */
const REFERENCE_SPEED_KTS = 2000;
/** Texture scroll rate (UV repeats/sec) at the reference speed. */
const SCROLL_SPEED = 1.6;
/** Trail opacity at the reference speed (scaled by the live speed factor). */
const BASE_OPACITY = 0.55;

/**
 * Streak emitters along each wing's trailing edge, mirrored to ±X. Positions
 * are tuned for the bundled A380-style OBJ (scaled to ~8 world units): the
 * outermost emitter sits at the wingtip with the longest trail, inner ones are
 * shorter/fainter. Tune x/z if a future model's wings sit elsewhere.
 */
interface EmitterSpec {
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  opacity: number; // relative to the material's live opacity (0..1 multiplier)
}

const EMITTERS: EmitterSpec[] = [
  { x: 3.6, y: 0, z: -1.8, length: 11, width: 0.3, opacity: 1.0 }, // wingtip
  { x: 2.6, y: 0, z: -1.4, length: 8, width: 0.24, opacity: 0.7 },
  { x: 1.6, y: 0, z: -1.0, length: 6, width: 0.2, opacity: 0.5 },
];

export interface WingTrails {
  group: THREE.Group;
  /** Advance the streak scroll; call once per frame with the live speed. */
  update: (dt: number, speedKts: number) => void;
  /** Free the GPU resources this module created (texture/geometry/materials). */
  dispose: () => void;
}

/**
 * Seamless streak texture: vertical white lines, each fading out along its
 * length (motion-blur look). Every line is drawn twice, offset by the canvas
 * height, so the texture wraps vertically without a visible seam while
 * scrolling.
 */
function createStreakTexture(): THREE.CanvasTexture {
  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Extremely unlikely; the material then renders untextured (soft white).
    console.error('[WingTrails] 2D canvas unavailable; streak texture skipped.');
    return new THREE.CanvasTexture(canvas);
  }

  ctx.clearRect(0, 0, width, height);
  const streaks = 26;
  for (let i = 0; i < streaks; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const len = 40 + Math.random() * 110;
    const alpha = 0.25 + Math.random() * 0.5;
    ctx.lineWidth = 1 + Math.random() * 2;
    // Bright head fading to nothing along the streak (reads as motion).
    for (const offset of [0, -height, height]) {
      const gradient = ctx.createLinearGradient(x, y + offset, x, y + offset + len);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(x, y + offset);
      ctx.lineTo(x, y + offset + len);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function createWingTrails(): WingTrails {
  const group = new THREE.Group();
  const texture = createStreakTexture();

  const geometries: THREE.BufferGeometry[] = [];
  const materials: { material: THREE.MeshBasicMaterial; base: number }[] = [];

  for (const spec of EMITTERS) {
    // One material per emitter so inner trails can stay fainter; they all
    // share the single scrolling texture.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false, // translucent: don't punch holes in things behind
      side: THREE.DoubleSide,
    });
    materials.push({ material, base: spec.opacity });

    // Quad along -Z (tail direction): PlaneGeometry is XY; rotateX(-90°) maps
    // +Y (texture V) onto -Z so the streaks run down the trail.
    const flat = new THREE.PlaneGeometry(spec.width, spec.length);
    flat.rotateX(-Math.PI / 2);
    // Crossed vertical copy so the trail is visible from any camera angle.
    const upright = flat.clone().rotateZ(Math.PI / 2);
    geometries.push(flat, upright);

    for (const side of [1, -1]) {
      for (const geometry of [flat, upright]) {
        const mesh = new THREE.Mesh(geometry, material);
        // Head of the trail at the trailing edge, extending toward the tail.
        mesh.position.set(side * spec.x, spec.y, spec.z - spec.length / 2);
        mesh.renderOrder = 2; // draw after opaque scene (translucent overlay)
        group.add(mesh);
      }
    }
  }

  const update = (dt: number, speedKts: number): void => {
    const factor = THREE.MathUtils.clamp(
      speedKts / REFERENCE_SPEED_KTS,
      0.25,
      2,
    );
    // Scroll toward the tail; negate SCROLL_SPEED if the flow looks reversed.
    texture.offset.y += SCROLL_SPEED * factor * dt;
    for (const { material, base } of materials) {
      material.opacity = Math.min(1, BASE_OPACITY * factor) * base;
    }
  };

  const dispose = (): void => {
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const { material } of materials) {
      material.dispose();
    }
    texture.dispose();
  };

  return { group, update, dispose };
}
