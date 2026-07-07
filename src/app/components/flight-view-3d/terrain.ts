import * as THREE from 'three';
import { MapTheme } from '../../services/map-theme.service';

/**
 * Procedural terrain for the 3D flight view.
 *
 * A high-subdivision plane is displaced on the GPU (fbm simplex noise in the
 * vertex shader) with analytically recomputed normals, then textured
 * procedurally in the fragment shader by BOTH elevation and slope: biome bands
 * by height, plus rock forced onto steep faces (and snow kept off cliffs). No
 * image textures; the standard material's lighting/fog stay intact. Day/night is
 * a uniform swap via `recolor`.
 */

/** Peak displacement (world units) applied to the terrain. */
const MAX_HEIGHT = 14;

/** Y position for the terrain mesh so its peaks sit below the aircraft. */
export const TERRAIN_Y = -20;

/** Biome colours (water/sand/grass/rock/snow) per theme. */
interface BiomeColors {
  water: string;
  sand: string;
  grass: string;
  rock: string;
  snow: string;
}

const BIOME_DAY: BiomeColors = {
  water: '#19465a',
  sand: '#635d47',
  grass: '#274e1c',
  rock: '#5d635d',
  snow: '#ffffff',
};

const BIOME_NIGHT: BiomeColors = {
  water: '#0a2230',
  sand: '#3d3a2c',
  grass: '#20351a',
  rock: '#3f4346',
  snow: '#aeb6bd',
};

export interface Terrain {
  mesh: THREE.Mesh;
  /** Recolour the terrain for a theme (swaps the biome uniforms). */
  recolor: (theme: MapTheme) => void;
  /**
   * Scroll the noise sample offset (world units). Advancing this along the
   * flight direction makes the terrain flow past the (stationary) plane — an
   * infinite scroll with no geometry regeneration.
   */
  setOffset: (x: number, z: number) => void;
}

/** Plane size / subdivision. The grid step drives the anti-flicker snapping. */
const SIZE = 400;
const SEGMENTS = 512;
const GRID_STEP = SIZE / SEGMENTS;

export function createTerrain(theme: MapTheme): Terrain {
  // High subdivision so the vertex displacement produces smooth hills.
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.05,
  });

  // Same uniform objects are injected into the compiled shader, so mutating
  // their .value (recolor) updates the material live.
  const uniforms = {
    uColorWater: { value: new THREE.Color() },
    uColorSand: { value: new THREE.Color() },
    uColorGrass: { value: new THREE.Color() },
    uColorRock: { value: new THREE.Color() },
    uColorSnow: { value: new THREE.Color() },
    uOffset: { value: new THREE.Vector2(0, 0) },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };

    // --- Vertex: noise + fbm, displacement, analytic normal, varyings ---
    shader.vertexShader =
      `
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+10.0)*x); }
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                                + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                                dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }
      float fbm(vec2 pos) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 0.02;
        for (int i = 0; i < 5; i++) {
          value += amplitude * snoise(pos * frequency);
          frequency *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }
      uniform vec2 uOffset;
      varying float vElevation;
      varying vec3 vWorldNormal;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float heightMultiplier = ${MAX_HEIGHT.toFixed(1)};
      vec2 samplePos = position.xz + uOffset;
      float elevation = fbm(samplePos) * heightMultiplier;
      vElevation = elevation;
      transformed.y += elevation;

      // Recompute the normal from neighbouring samples (GPU displacement doesn't).
      float offset = 0.1;
      float elevationX = fbm(samplePos + vec2(offset, 0.0)) * heightMultiplier;
      float elevationZ = fbm(samplePos + vec2(0.0, offset)) * heightMultiplier;
      vec3 tangent = normalize(vec3(offset, elevationX - elevation, 0.0));
      vec3 bitangent = normalize(vec3(0.0, elevationZ - elevation, offset));
      objectNormal = normalize(cross(bitangent, tangent));
      vWorldNormal = objectNormal; // terrain mesh has no rotation → object ≈ world
      `,
    );

    // --- Fragment: biome colour by elevation AND slope ---
    shader.fragmentShader =
      `
      uniform vec3 uColorWater;
      uniform vec3 uColorSand;
      uniform vec3 uColorGrass;
      uniform vec3 uColorRock;
      uniform vec3 uColorSnow;
      varying float vElevation;
      varying vec3 vWorldNormal;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      vec3 color = uColorWater;
      float h = ${MAX_HEIGHT.toFixed(1)};

      // Height-based biome bands.
      color = mix(color, uColorSand,  smoothstep(0.0,      h * 0.06, vElevation));
      color = mix(color, uColorGrass, smoothstep(h * 0.05, h * 0.26, vElevation));
      color = mix(color, uColorRock,  smoothstep(h * 0.23, h * 0.60, vElevation));

      // Slope (0 = flat, 1 = vertical).
      float slope = clamp(1.0 - vWorldNormal.y, 0.0, 1.0);

      // Snow only on high AND flat ground (kept off cliffs).
      float snow = smoothstep(h * 0.53, h * 0.83, vElevation)
                 * (1.0 - smoothstep(0.20, 0.50, slope));
      color = mix(color, uColorSnow, snow);

      // Steep faces read as rock regardless of height (overrides snow/grass).
      color = mix(color, uColorRock, smoothstep(0.35, 0.60, slope));

      diffuseColor.rgb = color;
      `,
    );
  };

  const mesh = new THREE.Mesh(geometry, material);

  const recolor = (t: MapTheme): void => {
    const b = t === 'day' ? BIOME_DAY : BIOME_NIGHT;
    uniforms.uColorWater.value.set(b.water);
    uniforms.uColorSand.value.set(b.sand);
    uniforms.uColorGrass.value.set(b.grass);
    uniforms.uColorRock.value.set(b.rock);
    uniforms.uColorSnow.value.set(b.snow);
  };

  const setOffset = (x: number, z: number): void => {
    // Anti-flicker: sample the noise only at whole grid steps, so each vertex
    // always lands on the same sample points (heights hand off vertex→vertex
    // instead of wobbling), and slide the mesh by the sub-cell remainder for
    // smooth motion. Without this, per-frame resampling shimmers.
    const snappedX = Math.floor(x / GRID_STEP) * GRID_STEP;
    const snappedZ = Math.floor(z / GRID_STEP) * GRID_STEP;
    uniforms.uOffset.value.set(snappedX, snappedZ);
    mesh.position.x = snappedX - x; // ∈ (-GRID_STEP, 0]
    mesh.position.z = snappedZ - z;
  };

  recolor(theme);
  return { mesh, recolor, setOffset };
}
