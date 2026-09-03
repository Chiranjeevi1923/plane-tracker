import * as THREE from 'three';
import { MapTheme } from '../../services/map-theme.service';
import {
  clampTile,
  elevationTileUrl,
  imageryTileUrl,
  lonLatToTileFrac,
  terrariumToMetres,
  tileSizeMetres,
  wrapTile,
} from '../../utils/tiles';

/**
 * Real-world tile terrain for the 3D flight view — a drop-in replacement for the
 * procedural fbm terrain, keeping the same "aircraft fixed at the origin, world
 * streams past" model but sourcing the world from FREE, keyless open tiles:
 *
 *   - Imagery: Esri "World Imagery" satellite tiles (draped as the colour).
 *   - Elevation: AWS Terrain Tiles (Terrarium PNG) displacing the mesh (the shape).
 *
 * A fixed N×N pool of tile meshes surrounds the aircraft. Each tile is a
 * subdivided plane displaced on the GPU by its heightmap (sampled in the vertex
 * shader, exactly the onBeforeCompile technique the old procedural terrain used —
 * only the height source changes from fbm noise to a real elevation texture).
 * `setView(lat, lon, alt)` positions the grid from the aircraft's true position
 * each frame and re-fetches only the new edge tiles when it crosses a boundary,
 * so it scrolls endlessly with no per-frame allocation.
 *
 * WORLD FRAME: north = +Z, geographic east = −X. The −X for east is deliberate —
 * it matches the existing aircraft-model / chase-camera yaw convention in the
 * component (nose forward is (sin(−heading), cos(−heading))) so that flying along
 * the heading streams the map the right way and turns rotate the ground
 * correctly. A side effect is that the satellite imagery reads mirrored east-west
 * (imperceptible at this zoom — no readable labels, just terrain and fields). To
 * make it geographically exact instead, mirror both textures in X
 * (`repeat.x = -1; offset.x = 1`) and sample the CPU height buffer at `1 - rx`.
 *
 * No API key, no billing — see CLAUDE.md's no-billing constraint. Attribution is
 * rendered as a persistent credit line in the component template.
 */

/** Zoom level: a z10 tile is ~35–38 km on the ground over India — a 5×5 grid ≈ 180 km. */
export const TILE_ZOOM = 10;
/** Grid radius in tiles from the centre (2 → a 5×5 grid). */
const GRID_RADIUS = 2;
/** Vertex subdivision per tile edge (heightmaps are 256px; 96 samples them well). */
const TILE_SEGMENTS = 96;
/** World units per tile edge. 5 tiles → a 400-unit grid; the outer ring fades into fog. */
const TILE_UNITS = 80;
/** Height relief multiplier over the true horizontal scale (drama vs. realism knob). */
const VERTICAL_EXAGGERATION = 3;
/** Clamp for how far (world units) the aircraft floats above local ground. */
const MIN_CAM_AGL_UNITS = 8;
/** Cap so cruising at 35,000 ft keeps the terrain framed rather than tiny + far below. */
const MAX_CAM_AGL_UNITS = 32;
/** Feet → metres. */
const FT_TO_M = 0.3048;
/** Heightmap resolution (Terrarium tiles are 256×256). */
const HEIGHT_PX = 256;

/** Y the terrain group sits at before any heightmap has loaded (matches the old look). */
export const TERRAIN_BASE_Y = -20;

/** Day/night terrain tints — imagery stays true-colour by day, cools + dims at night. */
const TINT_DAY = new THREE.Color('#ffffff');
const TINT_NIGHT = new THREE.Color('#6a7686');
/** Flat colour shown on a tile whose imagery failed to load (per theme). */
const FLAT_DAY = new THREE.Color('#b7ae98');
const FLAT_NIGHT = new THREE.Color('#2b3038');

export interface TileTerrain {
  /** Root object to add to the scene; holds the whole tile grid. */
  group: THREE.Group;
  /** Swap day/night tint (imagery stays photographic; night just cools + dims). */
  recolor: (theme: MapTheme) => void;
  /**
   * Anchor the grid to the aircraft's real geographic position and altitude.
   * Call every frame: it repositions the tiles smoothly and, on tile-boundary
   * crossings, recycles the pool and fetches the new edge tiles.
   */
  setView: (lat: number, lon: number, altitudeFt: number) => void;
  /** Free every geometry, material and texture (tile pool + placeholders). */
  dispose: () => void;
}

/** Per-slot record in the fixed tile pool. Meshes are reused; textures churn. */
interface Tile {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  uElevScale: { value: number };
  uTint: { value: THREE.Color };
  uHeightMap: { value: THREE.Texture };
  /** Slippy-tile coords this slot currently shows (unwrapped, for continuity). */
  tileX: number;
  tileY: number;
  imageryTex: THREE.Texture | null;
  heightTex: THREE.Texture | null;
  /** Decoded elevation (metres), row 0 = north — for the CPU under-aircraft sample. */
  heightBuf: Float32Array | null;
  /** Bumped per (re)assignment so stale async loads can be ignored. */
  imageryToken: number;
  heightToken: number;
  /** True while showing the flat-colour fallback because imagery failed. */
  imageryFailed: boolean;
}

/** Build the 1×1 placeholder textures shared by every tile until real ones arrive. */
function makePlaceholders(): { imagery: THREE.DataTexture; height: THREE.DataTexture } {
  // Neutral grey imagery.
  const imagery = new THREE.DataTexture(
    new Uint8Array([120, 130, 120, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  imagery.colorSpace = THREE.SRGBColorSpace;
  imagery.needsUpdate = true;

  // Terrarium value 32768 (R=128) decodes to exactly 0 m → flat sea level.
  const height = new THREE.DataTexture(
    new Uint8Array([128, 0, 0, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  height.needsUpdate = true; // DataTexture defaults: Nearest filter, NoColorSpace — exactly right.

  return { imagery, height };
}

/**
 * Patch a MeshStandardMaterial to displace vertices by a Terrarium heightmap and
 * tint the imagery. The heightmap is sampled RAW (Nearest filter, no colour-space
 * decode) so the packed bytes survive; elevation is decoded in-shader. Normals
 * are recomputed from neighbouring height samples and passed to the fragment
 * stage (same approach as the old procedural terrain).
 */
function patchMaterial(
  material: THREE.MeshStandardMaterial,
  uElevScale: { value: number },
  uTint: { value: THREE.Color },
  uHeightMap: { value: THREE.Texture },
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uElevScale'] = uElevScale;
    shader.uniforms['uTint'] = uTint;
    shader.uniforms['uHeightMap'] = uHeightMap;

    shader.vertexShader =
      `
      uniform sampler2D uHeightMap;
      uniform float uElevScale;
      varying vec3 vTileNormal;

      // Decode Terrarium RGB (raw 0..1 bytes) → elevation in metres.
      float sampleElevM(vec2 uvh) {
        vec3 e = texture2D(uHeightMap, uvh).rgb * 255.0;
        return (e.r * 256.0 + e.g + e.b / 256.0) - 32768.0;
      }
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float elevM = sampleElevM(uv);
      transformed.y += elevM * uElevScale;

      // Analytic normal from the four neighbouring height texels (the GPU
      // displacement doesn't update normals on its own). Derived for a
      // PlaneGeometry rotated flat: n = (hL-hR, 2·texel·tileUnits, hU-hD).
      float texel = 1.0 / ${HEIGHT_PX.toFixed(1)};
      float hL = sampleElevM(uv - vec2(texel, 0.0)) * uElevScale;
      float hR = sampleElevM(uv + vec2(texel, 0.0)) * uElevScale;
      float hD = sampleElevM(uv - vec2(0.0, texel)) * uElevScale;
      float hU = sampleElevM(uv + vec2(0.0, texel)) * uElevScale;
      float span = 2.0 * texel * ${TILE_UNITS.toFixed(1)};
      vTileNormal = normalize(vec3(hL - hR, span, hU - hD));
      `,
    );

    shader.fragmentShader =
      `
      uniform vec3 uTint;
      varying vec3 vTileNormal;
    ` + shader.fragmentShader;

    // Tint the (photographic) imagery — day = identity, night = cool dim.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      diffuseColor.rgb *= uTint;
      `,
    );

    // Drive lighting from the recomputed terrain normal. The mesh is unrotated
    // (only the geometry was pre-rotated), so the rigid viewMatrix rotation maps
    // the world-space normal into the view space the lighting chunks expect.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `
      #include <normal_fragment_begin>
      normal = normalize(mat3(viewMatrix) * normalize(vTileNormal));
      `,
    );
  };
}

export function createTileTerrain(
  theme: MapTheme,
  renderer: THREE.WebGLRenderer,
): TileTerrain {
  const group = new THREE.Group();
  const { imagery: placeholderImagery, height: placeholderHeight } =
    makePlaceholders();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const imageryLoader = new THREE.TextureLoader(); // crossOrigin defaults to 'anonymous'

  // Shared elevation scale (world units per metre of height); recomputed when the
  // aircraft's latitude band changes. Same value drives the shader displacement
  // and the CPU group-Y maths, so they stay in lockstep.
  let elevScale = (TILE_UNITS / tileSizeMetres(0, TILE_ZOOM)) * VERTICAL_EXAGGERATION;

  const tintColor = theme === 'day' ? TINT_DAY.clone() : TINT_NIGHT.clone();
  let currentTheme: MapTheme = theme;

  // --- Build the fixed tile pool -------------------------------------------
  const tiles: Tile[] = [];
  for (let i = 0; i < (GRID_RADIUS * 2 + 1) ** 2; i++) {
    const geometry = new THREE.PlaneGeometry(
      TILE_UNITS,
      TILE_UNITS,
      TILE_SEGMENTS,
      TILE_SEGMENTS,
    );
    geometry.rotateX(-Math.PI / 2); // lie flat: +Y is up, uv still spans the tile

    const material = new THREE.MeshStandardMaterial({
      map: placeholderImagery, // keeps USE_UV on so the shader's `uv` stays declared
      roughness: 1,
      metalness: 0,
    });

    const uElevScale = { value: elevScale };
    const uTint = { value: tintColor };
    const uHeightMap = { value: placeholderHeight as THREE.Texture };
    patchMaterial(material, uElevScale, uTint, uHeightMap);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // tiles are repositioned every frame; skip stale culling
    group.add(mesh);

    tiles.push({
      mesh,
      material,
      uElevScale,
      uTint,
      uHeightMap,
      tileX: Number.NaN,
      tileY: Number.NaN,
      imageryTex: null,
      heightTex: null,
      heightBuf: null,
      imageryToken: 0,
      heightToken: 0,
      imageryFailed: false,
    });
  }

  let centerX = Number.NaN;
  let centerY = Number.NaN;

  const disposeTexture = (tex: THREE.Texture | null): void => {
    if (tex && tex !== placeholderImagery && tex !== placeholderHeight) {
      tex.dispose();
    }
  };

  /** Draw an elevation image to a canvas and decode it to metres (row 0 = north). */
  const decodeHeights = (img: HTMLImageElement): Float32Array | null => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = HEIGHT_PX;
      canvas.height = HEIGHT_PX;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return null;
      }
      ctx.drawImage(img, 0, 0, HEIGHT_PX, HEIGHT_PX);
      const data = ctx.getImageData(0, 0, HEIGHT_PX, HEIGHT_PX).data;
      const buf = new Float32Array(HEIGHT_PX * HEIGHT_PX);
      for (let p = 0; p < buf.length; p++) {
        const i = p * 4;
        buf[p] = terrariumToMetres(data[i], data[i + 1], data[i + 2]);
      }
      return buf;
    } catch (err) {
      // Tainted canvas (CORS) or decode failure — fall back to flat, never throw.
      console.error('[TileTerrain] elevation decode failed — tile stays flat.', err);
      return null;
    }
  };

  const loadImagery = (tile: Tile): void => {
    const token = ++tile.imageryToken;
    const url = imageryTileUrl(
      wrapTile(tile.tileX, TILE_ZOOM),
      clampTile(tile.tileY, TILE_ZOOM),
      TILE_ZOOM,
    );
    imageryLoader.load(
      url,
      (tex) => {
        if (tile.imageryToken !== token) {
          tex.dispose(); // a newer assignment already superseded this slot
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false; // uv(0,0) = top-left = tile's NW corner
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = Math.min(8, maxAnisotropy);
        tex.needsUpdate = true;
        disposeTexture(tile.imageryTex);
        tile.imageryTex = tex;
        tile.material.map = tex;
        tile.material.color.set('#ffffff');
        tile.material.needsUpdate = true;
        tile.imageryFailed = false;
      },
      undefined,
      () => {
        if (tile.imageryToken !== token) {
          return;
        }
        console.error(
          `[TileTerrain] imagery z${TILE_ZOOM}/${tile.tileX}/${tile.tileY} failed — flat patch.`,
        );
        tile.imageryFailed = true;
        tile.material.map = placeholderImagery;
        tile.material.color.copy(currentTheme === 'day' ? FLAT_DAY : FLAT_NIGHT);
        tile.material.needsUpdate = true;
      },
    );
  };

  const loadHeight = (tile: Tile): void => {
    const token = ++tile.heightToken;
    const url = elevationTileUrl(
      wrapTile(tile.tileX, TILE_ZOOM),
      clampTile(tile.tileY, TILE_ZOOM),
      TILE_ZOOM,
    );
    const img = new Image();
    img.crossOrigin = 'anonymous'; // required for both the GPU texture and canvas read-back
    img.onload = () => {
      if (tile.heightToken !== token) {
        return;
      }
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter; // never interpolate packed height bytes
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.NoColorSpace; // raw bytes, no sRGB decode
      tex.flipY = false; // match imagery + the canvas decode orientation
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      disposeTexture(tile.heightTex);
      tile.heightTex = tex;
      tile.uHeightMap.value = tex;
      tile.heightBuf = decodeHeights(img);
    };
    img.onerror = () => {
      if (tile.heightToken !== token) {
        return;
      }
      console.error(
        `[TileTerrain] elevation z${TILE_ZOOM}/${tile.tileX}/${tile.tileY} failed — tile stays flat.`,
      );
    };
    img.src = url;
  };

  /**
   * Recycle the pool for a new centre tile: keep any slot whose coords are still
   * inside the window, and reassign the rest to the newly-exposed coords,
   * nearest-first. Only the new edge tiles trigger fetches.
   */
  const assignTiles = (cx: number, cy: number): void => {
    // Every (tileX, tileY) the new window needs.
    const needed: { x: number; y: number }[] = [];
    for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
      for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
        needed.push({ x: cx + i, y: cy + j });
      }
    }

    const claimed = new Array<boolean>(tiles.length).fill(false);
    const stillNeeded: { x: number; y: number }[] = [];

    // Keep slots already showing a needed coord.
    for (const want of needed) {
      const idx = tiles.findIndex(
        (t, k) => !claimed[k] && t.tileX === want.x && t.tileY === want.y,
      );
      if (idx >= 0) {
        claimed[idx] = true;
      } else {
        stillNeeded.push(want);
      }
    }

    // Nearest-first so the ground under the aircraft resolves before the edges.
    stillNeeded.sort(
      (a, b) =>
        Math.max(Math.abs(a.x - cx), Math.abs(a.y - cy)) -
        Math.max(Math.abs(b.x - cx), Math.abs(b.y - cy)),
    );

    // Reassign the unclaimed slots to the remaining coords and (re)fetch them.
    let free = 0;
    for (const want of stillNeeded) {
      while (free < tiles.length && claimed[free]) {
        free++;
      }
      const tile = tiles[free];
      claimed[free] = true;
      tile.tileX = want.x;
      tile.tileY = want.y;
      tile.heightBuf = null;
      tile.uHeightMap.value = placeholderHeight;
      loadImagery(tile);
      loadHeight(tile);
    }
  };

  /** Bilinear elevation (metres) under the aircraft from the centre tile's buffer. */
  const groundElevMetres = (rx: number, ry: number): number => {
    const centre = tiles.find((t) => t.tileX === centerX && t.tileY === centerY);
    if (!centre?.heightBuf) {
      return 0;
    }
    const buf = centre.heightBuf;
    const fx = Math.max(0, Math.min(1, rx)) * (HEIGHT_PX - 1);
    const fy = Math.max(0, Math.min(1, ry)) * (HEIGHT_PX - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, HEIGHT_PX - 1);
    const y1 = Math.min(y0 + 1, HEIGHT_PX - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const v00 = buf[y0 * HEIGHT_PX + x0];
    const v10 = buf[y0 * HEIGHT_PX + x1];
    const v01 = buf[y1 * HEIGHT_PX + x0];
    const v11 = buf[y1 * HEIGHT_PX + x1];
    return (
      v00 * (1 - tx) * (1 - ty) +
      v10 * tx * (1 - ty) +
      v01 * (1 - tx) * ty +
      v11 * tx * ty
    );
  };

  const setView = (lat: number, lon: number, altitudeFt: number): void => {
    const frac = lonLatToTileFrac(lon, lat, TILE_ZOOM);
    const cx = Math.floor(frac.x);
    const cy = Math.floor(frac.y);

    if (cx !== centerX || cy !== centerY) {
      centerX = cx;
      centerY = cy;
      // Tile size (and thus world scale) drifts with latitude — refresh it and
      // push the new value to every tile's shader uniform.
      elevScale =
        (TILE_UNITS / tileSizeMetres(lat, TILE_ZOOM)) * VERTICAL_EXAGGERATION;
      for (const tile of tiles) {
        tile.uElevScale.value = elevScale;
      }
      assignTiles(cx, cy);
    }

    // Reposition every tile continuously from the fractional position (smooth
    // between boundary crossings). World frame: north = +Z, geographic east = −X.
    for (const tile of tiles) {
      const dtx = tile.tileX + 0.5 - frac.x;
      const dty = tile.tileY + 0.5 - frac.y;
      tile.mesh.position.x = -dtx * TILE_UNITS;
      tile.mesh.position.z = -dty * TILE_UNITS;
    }

    // Drop the whole group so the ground under the aircraft sits the right AGL
    // below the origin. Folding −groundElev·scale into group.y lets the shader
    // displace by ABSOLUTE elevation with no per-frame uniform update.
    const groundElevM = groundElevMetres(frac.x - cx, frac.y - cy);
    const realAglM = Math.max(0, altitudeFt * FT_TO_M - groundElevM);
    const camAglUnits = THREE.MathUtils.clamp(
      realAglM * elevScale,
      MIN_CAM_AGL_UNITS,
      MAX_CAM_AGL_UNITS,
    );
    group.position.y = -groundElevM * elevScale - camAglUnits;
  };

  const recolor = (t: MapTheme): void => {
    currentTheme = t;
    tintColor.copy(t === 'day' ? TINT_DAY : TINT_NIGHT);
    // Re-tone any tiles currently showing the imagery-failure flat colour.
    for (const tile of tiles) {
      if (tile.imageryFailed) {
        tile.material.color.copy(t === 'day' ? FLAT_DAY : FLAT_NIGHT);
      }
    }
  };

  const dispose = (): void => {
    for (const tile of tiles) {
      tile.mesh.geometry.dispose();
      tile.material.dispose();
      disposeTexture(tile.imageryTex);
      disposeTexture(tile.heightTex);
    }
    placeholderImagery.dispose();
    placeholderHeight.dispose();
  };

  group.position.y = TERRAIN_BASE_Y; // transient; setView overrides on the first frame
  return { group, recolor, setView, dispose };
}
