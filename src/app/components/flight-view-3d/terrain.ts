import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { MapTheme } from '../../services/map-theme.service';

/**
 * Procedural terrain for the 3D flight view.
 *
 * SHAPE is generated once on the CPU (simplex-noise displaced plane, smooth
 * normals). The SURFACE is textured procedurally on the GPU: a MeshStandardMaterial
 * patched via onBeforeCompile computes the albedo in GLSL from elevation + slope +
 * simplex noise (biome bands broken up by noise, slope-based rock on cliffs, snow
 * that avoids steep faces, subtle mottling). No image textures, and the standard
 * material's lighting/fog/shadows are preserved. Day/night is just a uniform swap.
 */

/** World size of the (square) terrain and its subdivision. */
const TERRAIN_SIZE = 400;
const SEGMENTS = 200;
/** Peak height (world units) above the terrain's base. */
const MAX_HEIGHT = 14;
/** Noise shape: low base frequency = broad rolling hills. */
const BASE_FREQUENCY = 0.006;
const OCTAVES = 4;
const PERSISTENCE = 0.2; // amplitude falloff per octave
const LACUNARITY = 2.0; // frequency growth per octave
/** Normalized height below which the surface is flattened into water. */
const SEA_LEVEL = 0.34;

/** Y position for the terrain mesh so its peaks sit well below the aircraft. */
export const TERRAIN_Y = -20;

/** Flat biome colours for the procedural texture, per theme. */
interface Palette {
  water: number;
  sand: number;
  grass: number;
  rock: number;
  snow: number;
}

const DAY_PALETTE: Palette = {
  water: 0x3f6f9e,
  sand: 0xd8caa0,
  grass: 0x6fa15a,
  rock: 0x8a7d6b,
  snow: 0xf2f4f6,
};

const NIGHT_PALETTE: Palette = {
  water: 0x15314a,
  sand: 0x2f3444,
  grass: 0x25402b,
  rock: 0x39373f,
  snow: 0x8892a0,
};

/** Small deterministic PRNG so the terrain is identical on every load. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ian McEwan / Ashima Arts 2D simplex noise (public domain), for the GPU. */
const GLSL_SIMPLEX = /* glsl */ `
vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
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
}`;

/** Procedural biome colour from elevation + slope + noise. */
const GLSL_TERRAIN_COLOR = /* glsl */ `
vec3 terrainColor(){
  float e = vElevation; // 0..1 normalized elevation
  float nBig = snoise(vWorldPos.xz * uNoiseScale);
  float nFine = snoise(vWorldPos.xz * uNoiseScale * 5.0);
  // Jitter the band edges with noise so biomes aren't clean rings.
  float eN = clamp(e + nBig * uNoiseAmount, 0.0, 1.0);

  vec3 col = uWater;
  col = mix(col, uSand,  smoothstep(uSeaLevel, uSeaLevel + 0.03, eN));
  col = mix(col, uGrass, smoothstep(0.42, 0.50, eN));
  col = mix(col, uRock,  smoothstep(0.66, 0.80, eN));
  col = mix(col, uSnow,  smoothstep(0.86, 0.93, eN));

  // Steep land is rocky regardless of elevation (also stops snow on cliffs).
  float slope = clamp(1.0 - vWorldNormal.y, 0.0, 1.0);
  float rockiness = smoothstep(0.35, 0.62, slope) * step(uSeaLevel, e);
  col = mix(col, uRock, rockiness);

  // Subtle fine mottling.
  col *= 0.88 + 0.18 * (nFine * 0.5 + 0.5);
  return col;
}`;

export interface Terrain {
  mesh: THREE.Mesh;
  /** Recolour the terrain for a theme (just swaps shader uniforms). */
  recolor: (theme: MapTheme) => void;
}

// export function createTerrain(theme: MapTheme): Terrain {
//   const geometry = new THREE.PlaneGeometry(
//     TERRAIN_SIZE,
//     TERRAIN_SIZE,
//     SEGMENTS,
//     SEGMENTS,
//   );
//   geometry.rotateX(-Math.PI / 2); // lay flat (XZ plane, height on Y)

//   const noise2D = createNoise2D(mulberry32(1337));
//   const position = geometry.attributes['position'] as THREE.BufferAttribute;
//   const count = position.count;

//   // Pass 1: fractal (fbm) height per vertex, tracking min/max to normalize.
//   const raw = new Float32Array(count);
//   let min = Infinity;
//   let max = -Infinity;
//   for (let i = 0; i < count; i++) {
//     const x = position.getX(i);
//     const z = position.getZ(i);
//     let amplitude = 1;
//     let frequency = BASE_FREQUENCY;
//     let sum = 0;
//     let ampSum = 0;
//     for (let o = 0; o < OCTAVES; o++) {
//       sum += amplitude * noise2D(x * frequency, z * frequency);
//       ampSum += amplitude;
//       amplitude *= PERSISTENCE;
//       frequency *= LACUNARITY;
//     }
//     raw[i] = sum / ampSum; // -1..1
//     if (raw[i] < min) min = raw[i];
//     if (raw[i] > max) max = raw[i];
//   }

//   // Pass 2: normalize to 0..1, flatten water, displace, keep elevation attribute.
//   const elevation = new Float32Array(count);
//   const span = Math.max(1e-6, max - min);
//   for (let i = 0; i < count; i++) {
//     const t = (raw[i] - min) / span;
//     elevation[i] = t;
//     position.setY(i, Math.max(t, SEA_LEVEL) * MAX_HEIGHT); // flat water below sea
//   }
//   position.needsUpdate = true;
//   geometry.computeVertexNormals(); // smooth shading
//   geometry.setAttribute('aElevation', new THREE.BufferAttribute(elevation, 1));

//   // Shared uniforms — the same objects are injected into the compiled shader, so
//   // mutating their values (recolor) updates the material live.
//   const uniforms = {
//     uWater: { value: new THREE.Color() },
//     uSand: { value: new THREE.Color() },
//     uGrass: { value: new THREE.Color() },
//     uRock: { value: new THREE.Color() },
//     uSnow: { value: new THREE.Color() },
//     uSeaLevel: { value: SEA_LEVEL },
//     uNoiseScale: { value: 0.04 },
//     uNoiseAmount: { value: 0.05 },
//   };

//   const material = new THREE.MeshStandardMaterial({
//     roughness: 0.95,
//     metalness: 0,
//   });
//   material.onBeforeCompile = (shader) => {
//     Object.assign(shader.uniforms, uniforms);

//     shader.vertexShader =
//       `
//       attribute float aElevation;
//       varying float vElevation;
//       varying vec3 vWorldPos;
//       varying vec3 vWorldNormal;
//     ` +
//       shader.vertexShader
//         .replace(
//           '#include <beginnormal_vertex>',
//           `#include <beginnormal_vertex>
//            vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
//         )
//         .replace(
//           '#include <begin_vertex>',
//           `#include <begin_vertex>
//            vElevation = aElevation;
//            vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
//         );

//     shader.fragmentShader =
//       `
//       varying float vElevation;
//       varying vec3 vWorldPos;
//       varying vec3 vWorldNormal;
//       uniform vec3 uWater; uniform vec3 uSand; uniform vec3 uGrass;
//       uniform vec3 uRock;  uniform vec3 uSnow;
//       uniform float uSeaLevel; uniform float uNoiseScale; uniform float uNoiseAmount;
//       ${GLSL_SIMPLEX}
//       ${GLSL_TERRAIN_COLOR}
//     ` +
//       shader.fragmentShader.replace(
//         '#include <color_fragment>',
//         'diffuseColor.rgb = terrainColor();',
//       );
//   };

//   const mesh = new THREE.Mesh(geometry, material);

//   const recolor = (t: MapTheme): void => {
//     const p = t === 'day' ? DAY_PALETTE : NIGHT_PALETTE;
//     uniforms.uWater.value.set(p.water);
//     uniforms.uSand.value.set(p.sand);
//     uniforms.uGrass.value.set(p.grass);
//     uniforms.uRock.value.set(p.rock);
//     uniforms.uSnow.value.set(p.snow);
//   };

//   recolor(theme);
//   return { mesh, recolor };
// }

export function createTerrain(theme: MapTheme): Terrain {
  // 1. High subdivision is required for realistic vertex displacement
  const geometry = new THREE.PlaneGeometry(400, 400, 512, 512);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.05,
  });

  const uniforms = {
    uTime: { value: 0 },
    uColorWater: { value: new THREE.Color('#123b4e') },  // Deep valley water
    uColorGrass: { value: new THREE.Color('#3e742f') },  // Dark lower forest
    uColorSand: { value: new THREE.Color('#8b7f55') },   // Lighter mid-slope
    uColorRock: { value: new THREE.Color('#8b8f8e') },   // Grey mountain peaks
    uColorSnow: { value: new THREE.Color('#ffffff') },   // Optional snowy tips
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...uniforms };

    // 1. Inject Simplex Noise, fBM, and Normal Calculation functions
    shader.vertexShader = `
      // --- Ashima Arts 2D Simplex Noise ---
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+10.0)*x); }
      
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      // --- Fractal Brownian Motion ---
      float fbm(vec2 pos) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 0.02;
          for(int i = 0; i < 5; i++) {
              value += amplitude * snoise(pos * frequency);
              frequency *= 2.0;
              amplitude *= 0.5;
          }
          return value;
      }
      
      varying float vElevation;
    ` + shader.vertexShader;

    // 2. Displace vertices and recalculate normals for shadows
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      
      // Inject the TypeScript MAX_HEIGHT constant dynamically
      float heightMultiplier = ${MAX_HEIGHT.toFixed(1)};
      float elevation = fbm(position.xz) * heightMultiplier;
      vElevation = elevation;
      transformed.y += elevation;
      
      float offset = 0.1;
      float elevationX = fbm(position.xz + vec2(offset, 0.0)) * heightMultiplier;
      float elevationZ = fbm(position.xz + vec2(0.0, offset)) * heightMultiplier;
      
      vec3 tangent = normalize(vec3(offset, elevationX - elevation, 0.0));
      vec3 bitangent = normalize(vec3(0.0, elevationZ - elevation, offset));
      
      objectNormal = normalize(cross(bitangent, tangent));
      `
    );

    // 3. Inject Biome Color Splatting in Fragment Shader
    shader.fragmentShader = `
      uniform vec3 uColorWater;
      uniform vec3 uColorSand;
      uniform vec3 uColorGrass;
      uniform vec3 uColorRock;
      uniform vec3 uColorSnow;
      varying float vElevation;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      
      vec3 color = uColorWater;
      float h = ${MAX_HEIGHT.toFixed(1)};
      
      // Colors mapped proportionally to MAX_HEIGHT so biomes don't disappear when height changes
      color = mix(color, uColorSand, smoothstep(0.0, h * 0.06, vElevation));
      color = mix(color, uColorGrass, smoothstep(h * 0.05, h * 0.26, vElevation));
      color = mix(color, uColorRock, smoothstep(h * 0.23, h * 0.60, vElevation));
      color = mix(color, uColorSnow, smoothstep(h * 0.53, h * 0.83, vElevation));
      
      diffuseColor.rgb = color;
      `
    );
  };

  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    recolor: (newTheme: MapTheme) => {
      // Logic to darken the biome uniforms slightly if newTheme === 'night'
    }
  };
}
