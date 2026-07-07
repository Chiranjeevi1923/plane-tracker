import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Aircraft } from '../../models/aircraft.model';
import { FlightSimulatorService } from '../../services/flight-simulator.service';
import { MapTheme, MapThemeService } from '../../services/map-theme.service';
import { Clouds, createClouds } from './clouds';
import { createTerrain, Terrain, TERRAIN_Y } from './terrain';
import { RadioService } from '../../services/radio.service';

/**
 * Model asset (served from public/). Provide the .obj here; the matching .mtl is
 * loaded if present, otherwise a default material is applied. Adjust the names
 * to match the files you drop into public/models/.
 */
const MODEL_OBJ_URL = 'models/aircraft.obj';
const MODEL_MTL_URL = 'models/aircraft.mtl';
/** Largest model dimension is scaled to this many world units. */
const MODEL_TARGET_SIZE = 8;
/** Degrees added to the heading if the model's nose isn't aligned to it. */
const MODEL_YAW_OFFSET_DEG = 0;
/**
 * Up-axis correction, applied before centring/scaling. This OBJ is authored
 * Z-up (typical Blender/3ds Max export) while Three.js is Y-up, so without it
 * the fuselage stands vertical. Flip to +90 if a future model tips the other way.
 */
const MODEL_PITCH_OFFSET_DEG = -90;
/**
 * Fixed yaw applied to the model (independent of the heading + chase) so its
 * nose lines up with the chase-behind direction. Negative = clockwise viewed
 * from above; flip the sign if it rotates the wrong way.
 */
const MODEL_NOSE_YAW_DEG = -90;

/** Third-person chase camera (behind + above the aircraft). */
const CHASE_DISTANCE = 18;
const CHASE_HEIGHT = 6;
/** Rotate the chase around the plane if it starts in front instead of behind. */
const CHASE_YAW_OFFSET_DEG = 0;
/** How quickly the camera eases behind the plane before the user takes over. */
const CHASE_LERP = 0.06;

/**
 * World-scroll ("moving plane" illusion): the plane stays at the origin while
 * the terrain + clouds sweep past it. Rate scales with the plane's speed
 * relative to REFERENCE_SPEED_KTS.
 */
const REFERENCE_SPEED_KTS = 2000;
const TERRAIN_SCROLL_UNITS = 16; // world units/sec at the reference speed
const CLOUD_SCROLL_UNITS = 8; // slower than the ground → parallax depth
/** Rotate the scroll direction if the world flows the wrong way (try ±90/180). */
const FLOW_YAW_OFFSET_DEG = 0;

/**
 * Occasional banking (roll about the fuselage): mostly level, but every few
 * seconds the plane may ease into a gentle bank, hold it, then level out.
 */
const BANK_MIN_DEG = 8;
const BANK_MAX_DEG = 18;
/** Chance that, when the schedule fires while level, a bank actually starts. */
const BANK_CHANCE = 0.6;
/** How long (ms) each state (banked / level) holds before rescheduling. */
const BANK_HOLD_MIN_MS = 4000;
const BANK_HOLD_MAX_MS = 10000;
/** Fly straight this long at the start before the first possible bank. */
const BANK_STRAIGHT_START_MS = 5000;
/** Easing rate toward the target roll (per second). */
const BANK_EASE = 1.5;

type ModelState = 'loading' | 'ready' | 'error';

/**
 * Standalone 3D flight view (route: /3d-view/:flightId). Renders the aircraft
 * model in a Three.js scene with a free-orbit camera, driven by the same live
 * simulator data as the 2D map. Self-contained — no Google 3D / billing.
 */
@Component({
  selector: 'app-flight-view-3d',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './flight-view-3d.component.html',
  styleUrl: './flight-view-3d.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlightView3dComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly simulator = inject(FlightSimulatorService);
  private readonly mapTheme = inject(MapThemeService);
  private readonly radio = inject(RadioService);
  private readonly zone = inject(NgZone);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** Flight id from the route. */
  readonly flightId = this.route.snapshot.paramMap.get('flightId') ?? '';

  /** ~2 Hz clock so the HUD text refreshes (the 3D scene renders at 60 fps). */
  private readonly clock = toSignal(interval(500), { initialValue: 0 });
  /** Live record for this flight (null if the id isn't in the fleet). */
  readonly flight = computed<Aircraft | null>(() => {
    this.clock();
    if (!this.flightId) {
      return null;
    }
    return (
      this.simulator
        .sample(Date.now())
        .find((plane) => plane.flightId === this.flightId) ?? null
    );
  });

  readonly modelState = signal<ModelState>('loading');
  /** Radio chatter is off by default; the top-right toggle unmutes it. */
  readonly muted = signal(true);

  // Three.js objects.
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private model?: THREE.Group; // pivot group; rotated to heading
  private terrain?: Terrain;
  private clouds?: Clouds;
  private hemi?: THREE.HemisphereLight;
  private sun?: THREE.DirectionalLight;
  private frameId?: number;
  private resizeObserver?: ResizeObserver;
  private readonly threeClock = new THREE.Clock();
  /** Chase follows the plane until the user first orbits, then hands over. */
  private chaseEnabled = true;
  private readonly desiredCamPos = new THREE.Vector3();
  /** Accumulated terrain noise offset + a scratch cloud velocity (scroll effect). */
  private readonly noiseOffset = new THREE.Vector2();
  private readonly cloudVelocity = new THREE.Vector3();
  /** Occasional-bank state (roll applied to bankGroup, nested in the pivot). */
  private bankGroup?: THREE.Group;
  private bankAngle = 0;
  private bankTarget = 0;
  private nextBankChangeAtMs = 0;

  constructor() {
    // Keep the scene's sky/ground/lights in sync with the day/night theme.
    effect(() => this.applyTheme(this.mapTheme.theme()));
  }

  ngAfterViewInit(): void {
    // All Three.js work (setup + render loop) runs outside Angular to avoid
    // triggering change detection on every frame.
    this.zone.runOutsideAngular(() => this.initScene());
  }

  /**
   * Toggle radio chatter. Unmuting is a valid user gesture, so it can start the
   * AudioContext; muting stops the chatter. Defaults to muted.
   */
  toggleAudio(): void {
    const nextMuted = !this.muted();
    this.muted.set(nextMuted);
    if (nextMuted) {
      this.radio.disableRadio();
    } else {
      this.radio.enableRadio(this.flightId);
    }
  }

  ngOnDestroy(): void {
    if (this.frameId !== undefined) {
      cancelAnimationFrame(this.frameId);
    }
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.scene?.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose());
        } else {
          material?.dispose();
        }
      }
    });
    this.clouds?.dispose();
    this.renderer?.dispose();
    // Radio chatter belongs to the 3D view — silence it when leaving.
    this.radio.disableRadio();
  }

  /** Return to the 2D map. */
  back(): void {
    this.router.navigate(['/']);
  }

  private initScene(): void {
    const canvas = this.canvasRef().nativeElement;
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 40, 160);

    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    // Start behind + above the aircraft (third-person); the chase loop keeps it there.
    this.camera.position.set(0, CHASE_HEIGHT, -CHASE_DISTANCE);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(14, 22, 10);
    this.scene.add(this.sun);

    // Procedural rolling-hills terrain below the aircraft.
    this.terrain = createTerrain(this.mapTheme.theme());
    this.terrain.mesh.position.y = TERRAIN_Y;
    this.scene.add(this.terrain.mesh);

    // Drifting billboard clouds for atmosphere.
    this.clouds = createClouds(this.mapTheme.theme());
    this.scene.add(this.clouds.group);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 70;
    this.controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground
    this.controls.target.set(0, 0, 0);
    // The moment the user grabs the camera, stop chasing and hand over control.
    this.controls.addEventListener('start', () => (this.chaseEnabled = false));

    this.applyTheme(this.mapTheme.theme());
    this.loadModel();

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.host);

    const animate = () => {
      // One delta per frame (clamped so a background tab doesn't teleport things).
      const dt = Math.min(this.threeClock.getDelta(), 0.1);
      let speedKts = 0;
      if (this.model && this.flightId) {
        const plane = this.simulator
          .sample(Date.now())
          .find((p) => p.flightId === this.flightId);
        if (plane) {
          // Heading is compass degrees (CW from north); Three yaw is CCW.
          this.model.rotation.y = THREE.MathUtils.degToRad(
            MODEL_YAW_OFFSET_DEG - plane.heading,
          );
          speedKts = plane.speed;
        }
      }
      this.updateWorldScroll(dt, speedKts);
      this.updateBank(dt);
      this.updateChaseCamera();
      this.controls?.update();
      this.renderer!.render(this.scene!, this.camera!);
      this.frameId = requestAnimationFrame(animate);
    };
    this.frameId = requestAnimationFrame(animate);
  }

  /** Load the OBJ (with its MTL if available), then centre + scale it. */
  private loadModel(): void {
    const objLoader = new OBJLoader();

    const place = (obj: THREE.Group): void => {
      // Correct the up-axis first so the bounding box below measures the model
      // in its final orientation.
      obj.rotation.x = THREE.MathUtils.degToRad(MODEL_PITCH_OFFSET_DEG);
      obj.updateMatrixWorld(true);

      // Centre the model at the pivot origin and scale to a consistent size,
      // regardless of the model's native units.
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = MODEL_TARGET_SIZE / maxDim;
      obj.scale.setScalar(scale);
      obj.position.copy(center.multiplyScalar(-scale));

      // Fixed nose-alignment yaw, applied on an inner group so it rotates the
      // model WITHOUT moving the chase camera (which reads the pivot's yaw).
      const oriented = new THREE.Group();
      oriented.rotation.y = THREE.MathUtils.degToRad(MODEL_NOSE_YAW_DEG);
      oriented.add(obj);

      // Bank (roll) group: in pivot-local space the nose points +Z, so rolling
      // about local Z tilts the wings. Nested inside the pivot so banking never
      // disturbs the heading yaw or the chase camera.
      const bank = new THREE.Group();
      bank.add(oriented);
      this.bankGroup = bank;

      // Wrap in a pivot whose rotation.y is the live heading (drives the chase).
      const pivot = new THREE.Group();
      pivot.add(bank);
      this.model = pivot;
      this.scene!.add(pivot);
      this.zone.run(() => this.modelState.set('ready'));
    };

    const onError = () => this.zone.run(() => this.modelState.set('error'));

    // Try the .mtl first; if it isn't there, fall back to a default material.
    new MTLLoader().load(
      MODEL_MTL_URL,
      (materials) => {
        materials.preload();
        objLoader.setMaterials(materials);
        objLoader.load(MODEL_OBJ_URL, place, undefined, onError);
      },
      undefined,
      () => {
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

  /**
   * Keep the camera behind + above the aircraft (following its heading) unless
   * the user is orbiting — then it yields and eases back once they let go.
   */
  private updateChaseCamera(): void {
    // Chase follows the aircraft until the user first orbits; after that they
    // keep full manual control (no auto-return).
    if (!this.chaseEnabled || !this.model || !this.camera || !this.controls) {
      return;
    }
    this.controls.target.set(0, 0, 0); // the plane sits at the origin
    // Sit opposite the nose direction (behind) and above.
    const yaw =
      this.model.rotation.y + THREE.MathUtils.degToRad(CHASE_YAW_OFFSET_DEG);
    this.desiredCamPos.set(
      -Math.sin(yaw) * CHASE_DISTANCE,
      CHASE_HEIGHT,
      -Math.cos(yaw) * CHASE_DISTANCE,
    );
    this.camera.position.lerp(this.desiredCamPos, CHASE_LERP);
  }

  /**
   * "Moving plane" illusion. The plane is fixed at the origin; instead we scroll
   * the world past it along the flight direction:
   *  - Terrain: advance a noise-offset uniform (infinite, no geometry rebuild) so
   *    hills flow backward past the plane.
   *  - Clouds: translate the opposite way (toward the tail) and wrap.
   * Both scale with the plane's speed.
   */
  private updateWorldScroll(dt: number, speedKts: number): void {
    if (!this.model) {
      return;
    }
    const factor = THREE.MathUtils.clamp(speedKts / REFERENCE_SPEED_KTS, 0.25, 2);
    const yaw =
      this.model.rotation.y + THREE.MathUtils.degToRad(FLOW_YAW_OFFSET_DEG);
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);

    // Terrain: move the noise sample forward → the surface flows backward.
    this.noiseOffset.x += fwdX * TERRAIN_SCROLL_UNITS * factor * dt;
    this.noiseOffset.y += fwdZ * TERRAIN_SCROLL_UNITS * factor * dt;
    this.terrain?.setOffset(this.noiseOffset.x, this.noiseOffset.y);

    // Clouds: sweep toward the tail (opposite the flight direction).
    this.cloudVelocity
      .set(-fwdX, 0, -fwdZ)
      .multiplyScalar(CLOUD_SCROLL_UNITS * factor);
    this.clouds?.update(dt, this.cloudVelocity);
  }

  /**
   * Occasional gentle banking. A simple two-state schedule: while level, each
   * time the timer fires there's a BANK_CHANCE of easing into a random ±bank;
   * while banked, the next fire always returns to level. The roll itself eases
   * exponentially toward the target so entries/exits are smooth.
   */
  private updateBank(dt: number): void {
    if (!this.bankGroup) {
      return;
    }
    const now = performance.now();
    // First frame: start level and hold straight before any banking.
    if (this.nextBankChangeAtMs === 0) {
      this.nextBankChangeAtMs = now + BANK_STRAIGHT_START_MS;
      return;
    }
    if (now >= this.nextBankChangeAtMs) {
      if (this.bankTarget === 0 && Math.random() < BANK_CHANCE) {
        const magnitude =
          BANK_MIN_DEG + Math.random() * (BANK_MAX_DEG - BANK_MIN_DEG);
        const sign = Math.random() < 0.5 ? -1 : 1;
        this.bankTarget = THREE.MathUtils.degToRad(sign * magnitude);
      } else {
        this.bankTarget = 0; // level out
      }
      this.nextBankChangeAtMs =
        now + BANK_HOLD_MIN_MS + Math.random() * (BANK_HOLD_MAX_MS - BANK_HOLD_MIN_MS);
    }
    // Frame-rate-independent exponential ease toward the target roll.
    const k = 1 - Math.exp(-BANK_EASE * dt);
    this.bankAngle += (this.bankTarget - this.bankAngle) * k;
    this.bankGroup.rotation.z = this.bankAngle;
  }

  private onResize(): void {
    if (!this.renderer || !this.camera) {
      return;
    }
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /** Swap sky/ground/light colours to match the current theme. */
  private applyTheme(theme: MapTheme): void {
    if (!this.scene) {
      return;
    }
    const day = theme === 'day';
    const sky = new THREE.Color(day ? '#a9cbe8' : '#0a1420');
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(sky);
    this.terrain?.recolor(theme);
    this.clouds?.recolor(theme);
    if (this.hemi) {
      this.hemi.color.set(day ? '#ffffff' : '#9fb8d6');
      this.hemi.groundColor.set(day ? '#c9c1a8' : '#0a1018');
      this.hemi.intensity = day ? 1.1 : 0.7;
    }
    if (this.sun) {
      this.sun.intensity = day ? 1.4 : 0.9;
    }
  }
}
