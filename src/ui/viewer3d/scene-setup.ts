// Renderer and camera-rig bootstrap (ADR-255 stage 10 split).
//
// Split out of viewer3d-scene.ts, which had accumulated every concern and
// kept hitting both the file and function size caps. Creating the WebGL
// context and wiring the Z-up camera is one job with one failure mode.

import type * as ThreeNamespace from 'three';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type * as OrbitControlsModule from 'three/examples/jsm/controls/OrbitControls.js';
import type { Viewer3dTheme } from './viewer3d-theme';

const MAX_PIXEL_RATIO = 2;
const CAMERA_FOV_DEG = 40;

type ThreeModule = typeof ThreeNamespace;

export type OrbitControlsCtor = typeof OrbitControlsModule.OrbitControls;

export type CameraRig = {
  readonly camera: PerspectiveCamera;
  readonly controls: InstanceType<OrbitControlsCtor>;
  readonly render: () => void;
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
  return { kind: 'ok', renderer, width, height };
}

// Z-up perspective camera + orbit controls, wired to render on demand (no rAF
// loop — the scene only redraws on interaction, resize, or data change).
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
    CAMERA_FOV_DEG,
    deps.width / deps.height,
    0.1,
    100_000,
  );
  camera.up.set(0, 0, 1); // Z-up: the program's own frame
  const controls = new OrbitControls(camera, deps.canvas);
  const render = (): void => deps.renderer.render(deps.scene, camera);
  controls.addEventListener('change', render);
  return { camera, controls, render };
}
