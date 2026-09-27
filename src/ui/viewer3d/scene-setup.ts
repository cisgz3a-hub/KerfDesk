// Renderer and camera-rig bootstrap (ADR-255 stage 10 split; ADR-426).
//
// Split out of viewer3d-scene.ts, which had accumulated every concern and
// kept hitting both the file and function size caps. Creating the WebGL
// context and wiring the Z-up camera is one job with one failure mode.

import type * as ThreeNamespace from 'three';
import type { OrthographicCamera, PerspectiveCamera, WebGLRenderer } from 'three';
import type * as OrbitControlsModule from 'three/examples/jsm/controls/OrbitControls.js';
import { VIEWER3D_FOV_DEG, type Viewer3dProjection } from './camera-presets';
import { syncOrthographicCamera } from './camera-projection';
import { configureViewer3dControls } from './viewer3d-controls';
import type { Viewer3dTheme } from './viewer3d-theme';

const MAX_PIXEL_RATIO = 2;
// Depth kept around the target by the orthographic camera, as a multiple of
// the camera distance plus the job's extent.
const ORTHO_DEPTH_EXTENTS = 4;

type ThreeModule = typeof ThreeNamespace;

export type OrbitControlsCtor = typeof OrbitControlsModule.OrbitControls;

export type ViewCamera = PerspectiveCamera | OrthographicCamera;

export type CameraRig = {
  /** The pose every control, view and animation moves. */
  readonly camera: PerspectiveCamera;
  readonly controls: InstanceType<OrbitControlsCtor>;
  readonly render: () => void;
  readonly getProjection: () => Viewer3dProjection;
  readonly setProjection: (projection: Viewer3dProjection) => void;
  /** Largest job dimension, so the orthographic depth range covers the job. */
  readonly setExtent: (extentMm: number) => void;
  /** The camera to draw with: the perspective pose, or its orthographic twin. */
  readonly viewCamera: () => ViewCamera;
};

export type StartRendererResult =
  | {
      readonly kind: 'ok';
      readonly renderer: WebGLRenderer;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'no-webgl'; readonly reason: string };

// WebGL context creation is the one failure mode this module tolerates: jsdom
// and WebGL-less browsers get a typed fallback instead of a throw.
export function startRenderer(
  three: ThreeModule,
  canvas: HTMLCanvasElement,
  theme: Viewer3dTheme,
): StartRendererResult {
  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'WebGL is unavailable in this browser.',
    };
  }
  // HiDPI-correct output — the single most visible quality defect of the
  // pre-ADR-255 scene was rendering at CSS-pixel resolution.
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  renderer.setSize(width, height, false);
  renderer.setClearColor(theme.background);
  // Z range and section views clip the toolpath's own materials (ADR-470).
  renderer.localClippingEnabled = true;
  return { kind: 'ok', renderer, width, height };
}

// Z-up camera + shared orbit controls (ADR-426: one mouse map, damping, zoom
// to the cursor). The scene only redraws on interaction, resize, data change,
// or while a drag's glide settles.
export function createCameraRig(
  three: ThreeModule,
  OrbitControls: OrbitControlsCtor,
  deps: {
    readonly renderer: WebGLRenderer;
    readonly scene: ThreeNamespace.Scene;
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
  },
): CameraRig {
  const camera = new three.PerspectiveCamera(
    VIEWER3D_FOV_DEG,
    deps.width / deps.height,
    0.1,
    100_000,
  );
  camera.up.set(0, 0, 1); // Z-up: the program's own frame
  const ortho = new three.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const controls = new OrbitControls(camera, deps.canvas);
  configureViewer3dControls(three, controls);
  let projection: Viewer3dProjection = 'perspective';
  let extentMm = 100;
  const viewCamera = (): ViewCamera => {
    if (projection === 'perspective') return camera;
    const distance = camera.position.distanceTo(controls.target);
    syncOrthographicCamera(ortho, camera, distance, distance + extentMm * ORTHO_DEPTH_EXTENTS);
    return ortho;
  };
  // The owner schedules frames from the controls' change events; the rig
  // only knows how to draw one.
  const render = (): void => deps.renderer.render(deps.scene, viewCamera());
  return {
    camera,
    controls,
    render,
    getProjection: () => projection,
    setProjection: (next) => {
      projection = next;
    },
    setExtent: (next) => {
      extentMm = next;
    },
    viewCamera,
  };
}
