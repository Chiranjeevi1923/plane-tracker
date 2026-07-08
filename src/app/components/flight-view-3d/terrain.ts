import * as THREE from 'three';
import { MapTheme } from '../../services/map-theme.service';

/**
 * Procedural terrain for the 3D flight view.
 *
 * A high-subdivision plane is displaced on the GPU (fbm simplex noise in the
 * vertex shader) with analytically recomputed normals, then textured in the
 * fragment shader by BOTH elevation and slope: biome bands by height, plus rock
 * forced onto steep faces (and snow kept off cliffs). Each biome samples a
 * tiling CC0 photo texture + normal map (public/textures/terrain/, see
 * CREDITS.md) — "texture splatting" — so the surface reads as real earth rather
 * than flat colours. The standard material's lighting/fog stay intact.
 *
 * Day/night is a uniform swap via `recolor`: the biome colours act as tints
 * multiplied over the textures (≈white by day so the photos show true, dark by
 * night), so the theme toggle works unchanged.
 */

/** Peak displacement (world units) applied to the terrain. */
const MAX_HEIGHT = 14;

/** Y position for the terrain mesh so its peaks sit below the aircraft. */
export const TERRAIN_Y = -20;

/**
 * Biome tints per theme, multiplied over the photo textures. No water biome —
 * the noise is signed, so a "below zero = water" band would flood half the
 * terrain; valleys are dry sand/scrub instead. Day tints are near-white so the
 * textures show their true colours; night tints are dark so the whole terrain
 * dims with the theme.
 */
interface BiomeColors {
  sand: string;
  grass: string;
  rock: string;
  snow: string;
}

const BIOME_DAY: BiomeColors = {
  sand: '#f0e8d8',
  grass: '#e5eadf',
  rock: '#eaeaea',
  snow: '#ffffff',
};

const BIOME_NIGHT: BiomeColors = {
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

/**
 * Texture tiling frequency: UVs are world XZ × this, so each texture repeats
 * every 1/TEX_SCALE (=12.5) world units. Tune for detail vs visible repetition.
 */
const TEX_SCALE = 0.08;

/** Base path for the biome texture sets (served from public/). */
const TEX_PATH = 'textures/terrain';

/**
 * Load one tiling terrain texture. Repeat-wrapped because the scrolling UVs
 * grow without bound; diffuse maps are sRGB (normal maps stay linear data).
 * A failed load logs and leaves the default (black) texture — the terrain
 * still renders, just dark in that biome, rather than breaking the scene.
 */
function loadTerrainTexture(loader: THREE.TextureLoader, file: string, srgb: boolean): THREE.Texture {
  const url = `${TEX_PATH}/${file}`;
  const texture = loader.load(url, undefined, undefined, () => {
    console.error(`[Terrain] Failed to load texture '${url}' — that biome will render dark.`);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (srgb) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  // Sharper at the grazing angles the chase/cockpit cameras see the ground at.
  texture.anisotropy = 8;
  return texture;
}

export function createTerrain(theme: MapTheme): Terrain {
  // High subdivision so the vertex displacement produces smooth hills.
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0.05,
  });

  // Biome photo textures + normal maps (CC0, see public/textures/terrain/).
  const loader = new THREE.TextureLoader();
  const diff = (file: string) => loadTerrainTexture(loader, file, true);
  const nor = (file: string) => loadTerrainTexture(loader, file, false);

  // Same uniform objects are injected into the compiled shader, so mutating
  // their .value (recolor) updates the material live.
  const uniforms = {
    uColorSand: { value: new THREE.Color() },
    uColorGrass: { value: new THREE.Color() },
    uColorRock: { value: new THREE.Color() },
    uColorSnow: { value: new THREE.Color() },
    uOffset: { value: new THREE.Vector2(0, 0) },
    uTexScale: { value: TEX_SCALE },
    uSandMap: { value: diff('sand_diff.jpg') },
    uSandNor: { value: nor('sand_nor.jpg') },
    uGrassMap: { value: diff('grass_diff.jpg') },
    uGrassNor: { value: nor('grass_nor.jpg') },
    uRockMap: { value: diff('rock_diff.jpg') },
    uRockNor: { value: nor('rock_nor.jpg') },
    uSnowMap: { value: diff('snow_diff.jpg') },
    uSnowNor: { value: nor('snow_nor.jpg') },
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
      uniform float uTexScale;
      varying float vElevation;
      varying vec3 vWorldNormal;
      varying vec2 vTexUv;
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

      // Texture UVs in the same scrolling sample space as the noise, so the
      // photo detail stays glued to the hills as the world flows past (the
      // snap/slide in setOffset compensates exactly as it does for heights).
      vTexUv = samplePos * uTexScale;

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

    // --- Fragment: biome splatting (photo textures) by elevation AND slope ---
    shader.fragmentShader =
      `
      uniform vec3 uColorSand;
      uniform vec3 uColorGrass;
      uniform vec3 uColorRock;
      uniform vec3 uColorSnow;
      uniform sampler2D uSandMap;
      uniform sampler2D uSandNor;
      uniform sampler2D uGrassMap;
      uniform sampler2D uGrassNor;
      uniform sampler2D uRockMap;
      uniform sampler2D uRockNor;
      uniform sampler2D uSnowMap;
      uniform sampler2D uSnowNor;
      varying float vElevation;
      varying vec3 vWorldNormal;
      varying vec2 vTexUv;
    ` + shader.fragmentShader;

    // Biome weights (same bands as the original flat-colour version), then
    // blend the tinted photo textures with them. NOTE: <color_fragment> runs
    // before <normal_fragment_begin> in the standard shader, so the weights
    // declared here are still in scope for the normal-map blend below.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float h = ${MAX_HEIGHT.toFixed(1)};

      // Height-based biome weights. Elevation is SIGNED (fbm noise ≈ ±0.6h
      // typically), so the bands span the negative range too: sandy valley
      // floors → grass on the low/mid ground → rock → snow on the peaks.
      float wGrass = smoothstep(-h * 0.35, -h * 0.08, vElevation);
      float wRock  = smoothstep( h * 0.18,  h * 0.45, vElevation);

      // Slope (0 = flat, 1 = vertical).
      float slope = clamp(1.0 - vWorldNormal.y, 0.0, 1.0);

      // Snow on high ground, kept off the steepest cliffs. Threshold sits
      // within the typical fbm peak range so summits actually get capped.
      float wSnow = smoothstep(h * 0.32, h * 0.55, vElevation)
                  * (1.0 - smoothstep(0.30, 0.60, slope));

      // Steep faces read as rock regardless of height (overrides snow/grass).
      float wSlopeRock = smoothstep(0.35, 0.60, slope);

      // Tinted photo textures per biome (sRGB maps decode to linear on sample;
      // the tints are the theme's day/night dimmer).
      vec3 sandC  = texture2D(uSandMap,  vTexUv).rgb * uColorSand;
      vec3 grassC = texture2D(uGrassMap, vTexUv).rgb * uColorGrass;
      vec3 rockC  = texture2D(uRockMap,  vTexUv).rgb * uColorRock;
      vec3 snowC  = texture2D(uSnowMap,  vTexUv).rgb * uColorSnow;

      // Dry sandy valleys as the base — no water biome (see BiomeColors note).
      vec3 color = sandC;
      color = mix(color, grassC, wGrass);
      color = mix(color, rockC,  wRock);
      color = mix(color, snowC,  wSnow);
      color = mix(color, rockC,  wSlopeRock);

      diffuseColor.rgb = color;
      `,
    );

    // Perturb the analytic terrain normal with the biome normal maps, blended
    // with the same weights as the colours, so lighting picks up rock cracks,
    // grass clumps and snow drifts. UVs are world-XZ aligned, which makes the
    // tangent basis trivial (T ≈ +X, B ≈ +Z) — no tangent attributes needed.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `
      #include <normal_fragment_begin>
      vec3 tsn = texture2D(uSandNor, vTexUv).xyz * 2.0 - 1.0; // valley base
      tsn = mix(tsn, texture2D(uGrassNor, vTexUv).xyz * 2.0 - 1.0, wGrass);
      tsn = mix(tsn, texture2D(uRockNor,  vTexUv).xyz * 2.0 - 1.0, wRock);
      tsn = mix(tsn, texture2D(uSnowNor,  vTexUv).xyz * 2.0 - 1.0, wSnow);
      tsn = mix(tsn, texture2D(uRockNor,  vTexUv).xyz * 2.0 - 1.0, wSlopeRock);
      tsn = normalize(tsn);

      vec3 wN = normalize(vWorldNormal);
      vec3 wT = normalize(cross(wN, vec3(0.0, 0.0, 1.0))); // ≈ +X
      vec3 wB = cross(wT, wN);                             // ≈ +Z
      vec3 bumped = normalize(wT * tsn.x + wB * tsn.y + wN * tsn.z);

      // The mesh is unrotated/unscaled (object ≈ world), so the rigid
      // viewMatrix rotation maps the bumped normal into view space, which is
      // what the lighting chunks expect in 'normal'.
      normal = normalize(mat3(viewMatrix) * bumped);
      `,
    );
  };

  const mesh = new THREE.Mesh(geometry, material);

  const recolor = (t: MapTheme): void => {
    const b = t === 'day' ? BIOME_DAY : BIOME_NIGHT;
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
