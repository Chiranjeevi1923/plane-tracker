import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { interval } from 'rxjs';
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Aircraft } from '../../models/aircraft.model';
import { FlightSimulatorService } from '../../services/flight-simulator.service';
import { GoogleMapsLoaderService } from '../../services/google-maps-loader.service';
import { destinationPoint } from '../../utils/geo';
import { AircraftOverlay, createAircraftOverlay } from './aircraft-overlay';

/**
 * PROTOTYPE — Google vector 3D flight view (route: /map3d-view/:flightId).
 *
 * Renders the aircraft into Google's own vector basemap (stylized 3D buildings)
 * via a WebGLOverlayView, anchored to its REAL lat/lng/altitude. Google owns the
 * camera and render loop, so instead of our own OrbitControls/chase rig we
 * choreograph Google's camera (map.moveCamera) to auto-follow the plane, dropping
 * lower and zooming in near the ground so takeoff/landing read realistically —
 * the plane's height above ground comes straight from the altitude profile.
 *
 * Uses Map.DEMO_MAP_ID, so no billing account is needed (see CLAUDE.md). This is
 * a standalone comparison prototype; the open-tiles terrain view is unchanged.
 */

const MODEL_OBJ_URL = 'models/aircraft.obj';
const MODEL_MTL_URL = 'models/aircraft.mtl';
/** Real-world model size (metres) so it scales correctly against buildings. */
const MODEL_SIZE_M = 60;
/**
 * Model orientation in the overlay's frame (+x east, +y north, +z up). The OBJ is
 * authored Z-up with its nose along +X, so a +90° turn about up points the nose
 * north (heading 0); the overlay then yaws it by the live heading. Flip these if a
 * future model sits nose-down or points the wrong way.
 */
const MODEL_NOSE_OFFSET_DEG = 90;
const MODEL_TILT_OFFSET_DEG = 0;

/** Feet → metres. */
const FT_TO_M = 0.3048;
/**
 * Displayed-altitude cap (metres). Google vector buildings are a near-ground
 * feature and a plane at true cruise (~10.7 km) sits far above the viewport, so
 * we cap the height fed to BOTH the model and the camera. The plane then always
 * stays framed over the city as a low flyover; real takeoff/landing height still
 * plays out below the cap. Raise it for more altitude realism (plane leaves frame
 * sooner), or set it very high to see the true-altitude behaviour.
 */
const MAX_DISPLAY_ALT_M = 400;
/** Aim the camera this × displayed-altitude metres ahead of the plane, so it frames rather than tops the view. */
const CAM_FORWARD_FACTOR = 1.2;
/**
 * Camera zoom/tilt on the runway vs. at the altitude cap. Zoom stays ≥16 so 3D
 * buildings keep rendering and tilt stays permitted the whole time (vector maps
 * only allow tilt when zoomed in).
 */
const NEAR_ZOOM = 18;
const FAR_ZOOM = 16.2;
const NEAR_TILT_DEG = 67;
const FAR_TILT_DEG = 62;

/**
 * Slowed simulator clock so the near-ground takeoff/landing phases are watchable
 * (see the tile view for the same technique). sample() is a pure function of the
 * timestamp, so this never touches the shared service or the 2D map. 0.08 → the
 * short climb/descent segments last long enough to actually see.
 */
const VISUAL_TIME_SCALE = 0.08;

type ViewState = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-flight-view-map3d',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './flight-view-map3d.component.html',
  styleUrl: './flight-view-map3d.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlightViewMap3dComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly simulator = inject(FlightSimulatorService);
  private readonly mapsLoader = inject(GoogleMapsLoaderService);
  private readonly zone = inject(NgZone);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  private readonly mapRef =
    viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  readonly flightId = this.route.snapshot.paramMap.get('flightId') ?? '';

  /** ~2 Hz clock for the HUD (the map renders on its own). */
  private readonly clock = toSignal(interval(500), { initialValue: 0 });
  readonly flight = computed<Aircraft | null>(() => {
    this.clock();
    if (!this.flightId) {
      return null;
    }
    return (
      this.simulator
        .sample(this.simClock())
        .find((plane) => plane.flightId === this.flightId) ?? null
    );
  });

  readonly viewState = signal<ViewState>('loading');
  /** Specific error copy (vector unsupported, key issue); '' → fall back to defaults. */
  readonly errorMessage = signal<string>('');

  private map?: google.maps.Map;
  private aircraftOverlay?: AircraftOverlay;
  private frameId?: number;
  private readonly viewT0 = Date.now();

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.mapsLoader
        .load()
        .then(() => this.initScene())
        .catch((error: unknown) => {
          console.error('[FlightViewMap3d] Google Maps failed to load.', error);
          this.zone.run(() => this.viewState.set('error'));
        });
    });
  }

  ngOnDestroy(): void {
    if (this.frameId !== undefined) {
      cancelAnimationFrame(this.frameId);
    }
    this.aircraftOverlay?.overlay.setMap(null);
    this.aircraftOverlay?.dispose();
    this.map = undefined;
  }

  back(): void {
    this.router.navigate(['/']);
  }

  private simClock(): number {
    return this.viewT0 + (Date.now() - this.viewT0) * VISUAL_TIME_SCALE;
  }

  private initScene(): void {
    const initial = this.sampleFlight();
    if (!initial) {
      // Unknown flight id — show the "not found" HUD, skip the map.
      this.zone.run(() => this.viewState.set('error'));
      return;
    }

    this.map = new google.maps.Map(this.mapRef().nativeElement, {
      center: { lat: initial.latitude, lng: initial.longitude },
      zoom: NEAR_ZOOM,
      heading: initial.heading,
      tilt: NEAR_TILT_DEG,
      // Vector map (3D buildings) with no billing account required. DEMO_MAP_ID
      // alone can still resolve to raster, so force VECTOR explicitly — that's
      // what WebGLOverlayView requires.
      mapId: 'DEMO_MAP_ID',
      renderingType: google.maps.RenderingType.VECTOR,
      // Pure auto-follow: the camera is driven by moveCamera, not the user.
      disableDefaultUI: true,
      gestureHandling: 'none',
      keyboardShortcuts: false,
    });

    // Rendering type resolves asynchronously; only attach the overlay once the
    // map confirms it's vector, and report cleanly if the device can't do it.
    this.whenVectorReady(() => this.startOverlay());
  }

  /**
   * Run `onVector` once the map is confirmed vector. If it resolves to raster
   * (no WebGL vector support on this device/browser), show a clear error instead
   * of letting WebGLOverlayView throw "not a vector map".
   */
  private whenVectorReady(onVector: () => void): void {
    if (!this.map) {
      return;
    }
    const RenderingType = google.maps.RenderingType;
    const check = (): boolean => {
      const type = this.map!.getRenderingType();
      if (type === RenderingType.VECTOR) {
        onVector();
        return true;
      }
      if (type === RenderingType.RASTER) {
        this.zone.run(() => {
          this.errorMessage.set(
            "This browser or device can't render Google's vector maps (WebGL), " +
              'which the 3D buildings view requires. Try the tile 3D view instead.',
          );
          this.viewState.set('error');
        });
        return true;
      }
      return false; // UNINITIALIZED — wait for renderingtype_changed
    };
    if (check()) {
      return;
    }
    const listener = this.map.addListener('renderingtype_changed', () => {
      if (check()) {
        google.maps.event.removeListener(listener);
      }
    });
  }

  private startOverlay(): void {
    if (!this.map) {
      return;
    }
    this.aircraftOverlay = createAircraftOverlay();
    this.aircraftOverlay.overlay.setMap(this.map);
    this.loadModel();

    const animate = (): void => {
      const plane = this.sampleFlight();
      if (plane && this.map && this.aircraftOverlay) {
        // Cap the displayed height so the plane stays framed over the buildings.
        const displayAltM = Math.min(plane.altitude * FT_TO_M, MAX_DISPLAY_ALT_M);
        this.followCamera(plane, displayAltM);
        this.aircraftOverlay.setAircraft(
          plane.latitude,
          plane.longitude,
          displayAltM,
          plane.heading,
        );
        this.aircraftOverlay.requestRedraw();
      }
      this.frameId = requestAnimationFrame(animate);
    };
    this.frameId = requestAnimationFrame(animate);
  }

  private sampleFlight(): Aircraft | undefined {
    if (!this.flightId) {
      return undefined;
    }
    return this.simulator
      .sample(this.simClock())
      .find((p) => p.flightId === this.flightId);
  }

  /**
   * Auto-follow: aim Google's camera a short distance ahead of the aircraft along
   * its heading (so the plane sits framed rather than off the top), tilted and
   * zoomed into the buildings band throughout. Near the runway it drops lower and
   * zooms in; toward the altitude cap it eases back — but always stays tilted and
   * close enough for 3D buildings.
   */
  private followCamera(plane: Aircraft, displayAltM: number): void {
    if (!this.map) {
      return;
    }
    const t = displayAltM / MAX_DISPLAY_ALT_M; // 0 on the ground → 1 at the cap
    const ahead = destinationPoint(
      { latitude: plane.latitude, longitude: plane.longitude },
      plane.heading,
      displayAltM * CAM_FORWARD_FACTOR,
    );
    this.map.moveCamera({
      center: { lat: ahead.latitude, lng: ahead.longitude },
      heading: plane.heading,
      zoom: THREE.MathUtils.lerp(NEAR_ZOOM, FAR_ZOOM, t),
      tilt: THREE.MathUtils.lerp(NEAR_TILT_DEG, FAR_TILT_DEG, t),
    });
  }

  /** Load the OBJ (with its MTL if present), orient + scale it, hand to the overlay. */
  private loadModel(): void {
    const place = (obj: THREE.Group): void => {
      // Centre + scale to a real-world size (metres) via its bounding box.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = MODEL_SIZE_M / maxDim;
      obj.scale.setScalar(scale);
      obj.position.copy(center.multiplyScalar(-scale));

      // Up-axis fix (usually none — the OBJ is already Z-up like the overlay).
      const tilt = new THREE.Group();
      tilt.rotation.x = THREE.MathUtils.degToRad(MODEL_TILT_OFFSET_DEG);
      tilt.add(obj);

      // Point the nose to north (+y) at heading 0; the overlay yaws it live.
      const orient = new THREE.Group();
      orient.rotation.z = THREE.MathUtils.degToRad(MODEL_NOSE_OFFSET_DEG);
      orient.add(tilt);

      this.aircraftOverlay?.setModel(orient);
      this.zone.run(() => this.viewState.set('ready'));
    };

    const onError = (): void =>
      this.zone.run(() => this.viewState.set('error'));

    const objLoader = new OBJLoader();
    new MTLLoader().load(
      MODEL_MTL_URL,
      (materials) => {
        materials.preload();
        objLoader.setMaterials(materials);
        objLoader.load(MODEL_OBJ_URL, place, undefined, onError);
      },
      undefined,
      () => {
        // No MTL — load the OBJ with a default material.
        objLoader.load(
          MODEL_OBJ_URL,
          (obj) => {
            obj.traverse((child) => {
              const mesh = child as THREE.Mesh;
              if (mesh.isMesh) {
                mesh.material = new THREE.MeshStandardMaterial({
                  color: 0xdfe6ee,
                  metalness: 0.25,
                  roughness: 0.6,
                });
              }
            });
            place(obj);
          },
          undefined,
          onError,
        );
      },
    );
  }
}
