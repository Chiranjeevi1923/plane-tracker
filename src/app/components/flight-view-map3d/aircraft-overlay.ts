import * as THREE from 'three';

/**
 * Google Maps WebGLOverlayView that renders a Three.js aircraft into the map's
 * OWN WebGL context, so the plane shares Google's depth buffer (real 3D buildings
 * occlude it) and is anchored to a true lat/lng/altitude.
 *
 * This is the "Google owns the render loop" model: the overlay hands us the GL
 * context (onContextRestored) and, each frame, the projection matrix for a chosen
 * anchor (onDraw). We keep the aircraft at the scene origin and re-anchor to its
 * live position every frame; the map camera itself is choreographed separately by
 * the component (map.moveCamera) to follow the plane.
 *
 * The class is defined inside a factory because it extends
 * `google.maps.WebGLOverlayView`, which only exists at runtime AFTER the Maps API
 * has loaded — referencing it at module-eval time would throw.
 */

/** Anchor frame from fromLatLngAltitude is +x east, +y north, +z up. */
export interface AircraftOverlay {
  /** The google.maps overlay; call setMap(map) / setMap(null). */
  overlay: google.maps.WebGLOverlayView;
  /** Add the loaded aircraft model (called once the OBJ resolves). */
  setModel: (model: THREE.Object3D) => void;
  /** Update the anchor + heading for the next redraw. */
  setAircraft: (lat: number, lng: number, altitudeM: number, headingDeg: number) => void;
  /** Ask the map to repaint (drives the animation while the plane moves). */
  requestRedraw: () => void;
  /** Free the renderer + scene resources. */
  dispose: () => void;
}

export function createAircraftOverlay(): AircraftOverlay {
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;

  // Heading pivot: nose points +y (north) at heading 0; rotate about +z (up).
  const headingGroup = new THREE.Group();
  let pendingModel: THREE.Object3D | undefined;

  // Live anchor, updated each frame before requestRedraw.
  const anchor = { lat: 0, lng: 0, altitude: 0 };

  const overlay = new google.maps.WebGLOverlayView();

  overlay.onAdd = () => {
    scene = new THREE.Scene();
    // Lights roughly match daylight; Google's basemap already carries its own
    // shading, so keep this soft to avoid a harshly-lit model over a flat map.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 2.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(0.5, -1, 0.5); // from the south-ish, above
    scene.add(sun);
    scene.add(headingGroup);
    if (pendingModel) {
      headingGroup.add(pendingModel);
      pendingModel = undefined;
    }
  };

  overlay.onContextRestored = ({ gl }) => {
    renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      ...gl.getContextAttributes(),
    });
    // The map already cleared/drew the basemap; we render on top without wiping it.
    renderer.autoClear = false;
    camera = new THREE.PerspectiveCamera();
  };

  overlay.onDraw = ({ gl, transformer }) => {
    if (!renderer || !scene || !camera) {
      return;
    }
    // Projection matrix that places scene-origin at the anchor lat/lng/altitude.
    const matrix = transformer.fromLatLngAltitude({
      lat: anchor.lat,
      lng: anchor.lng,
      altitude: anchor.altitude,
    });
    camera.projectionMatrix.fromArray(matrix);

    renderer.render(scene, camera);
    // Hand the GL state back to Google exactly as we found it.
    renderer.resetState();
    // Keep three's cached bindings from going stale against the shared context.
    gl.useProgram(null);
  };

  overlay.onContextLost = () => {
    renderer?.dispose();
    renderer = undefined;
  };

  overlay.onRemove = () => {
    scene = undefined;
    camera = undefined;
  };

  const setModel = (model: THREE.Object3D): void => {
    if (scene) {
      headingGroup.add(model);
    } else {
      pendingModel = model; // onAdd hasn't run yet; attach when it does
    }
  };

  const setAircraft = (
    lat: number,
    lng: number,
    altitudeM: number,
    headingDeg: number,
  ): void => {
    anchor.lat = lat;
    anchor.lng = lng;
    anchor.altitude = altitudeM;
    // Compass heading (CW from north) → rotation about +z. R_z(-heading) maps the
    // +y nose to the correct compass direction (east at heading 90, etc.).
    headingGroup.rotation.z = THREE.MathUtils.degToRad(-headingDeg);
  };

  const requestRedraw = (): void => overlay.requestRedraw();

  const dispose = (): void => {
    renderer?.dispose();
    renderer = undefined;
    scene = undefined;
    camera = undefined;
  };

  return { overlay, setModel, setAircraft, requestRedraw, dispose };
}
