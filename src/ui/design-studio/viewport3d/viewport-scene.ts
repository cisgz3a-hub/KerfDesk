// viewport-scene — the Studio's 3D design space (ADR-272 Amendment 2).
//
// Long-lived on purpose: renderer, Z-up camera, controls, lights, and stage
// are built ONCE per Studio open; the carved solid and the sketch overlay
// swap in place. Render-on-demand — no rAF loop; a still viewport costs zero
// GPU (the discipline every shipped viewer here follows).
//
// Input mapping is the Fusion synthesis recorded in the research doc: the
// LEFT button never touches the camera (mouseButtons.LEFT = -1 falls through
// OrbitControls' dispatch to NONE, verified in the installed r180 source),
// MIDDLE pans with the built-in Shift-orbit modifier, RIGHT orbits, and the
// wheel zooms at the cursor.

import type { WebGLRenderer } from 'three';
import type * as ThreeNamespace from 'three';
import type { Vec2 } from '../../../core/scene';
import {
  buildViewerContent,
  buildStageFurniture,
  type ViewerContentInput,
} from '../../cnc-viewer3d';
import { localFromScene, pointerNdc, sceneFromLocal } from '../../cnc-viewer3d/viewer3d-picking';
import { applySceneLighting } from '../../relief-viewer/scene-lighting';
import { viewer3dTheme } from '../../theme/viewer3d-theme';
import { cameraPlacement, type CameraPreset } from '../../viewer3d';
import {
  buildOverlayDrawable,
  loadViewportLinesAddons,
  type OverlayDrawableHandle,
} from './viewport-lines';
import type { OverlayFrame, ViewportOverlay } from './viewport-overlay';

const CAMERA_FOV_DEG = 40;
const CAMERA_NEAR_MM = 0.5;
const CAMERA_FAR_MM = 20000;
const MIN_DOLLY_MM = 8;
const MAX_DOLLY_MM = 6000;

export type ViewportFrame = OverlayFrame & { readonly thicknessMm: number };

export type DesignViewportHandle = {
  readonly dispose: () => void;
  readonly resize: (width: number, height: number) => void;
  readonly updateCarve: (input: ViewerContentInput) => Promise<void>;
  readonly updateOverlay: (overlay: ViewportOverlay) => void;
  readonly setPreset: (preset: CameraPreset) => void;
  // Raw pointer offsets → sketch mm on the stock-top plane, or null when the
  // ray misses (looking at the horizon).
  readonly pointerToSceneMm: (offsetX: number, offsetY: number) => Vec2 | null;
  // Screen pixels per millimetre at the camera target — hit radii and snap
  // tolerances keep their on-screen size from any camera.
  readonly pxPerMmAtTarget: () => number;
};

export type DesignViewportResult =
  | { readonly kind: 'ok'; readonly handle: DesignViewportHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

export async function createDesignViewportScene(
  canvas: HTMLCanvasElement,
  frame: ViewportFrame,
): Promise<DesignViewportResult> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const addons = await loadViewportLinesAddons();

  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    return { kind: 'no-webgl', reason: error instanceof Error ? error.message : 'WebGL failed' };
  }

  const scene = new three.Scene();
  scene.background = new three.Color(viewer3dTheme.color.background);
  const camera = new three.PerspectiveCamera(
    CAMERA_FOV_DEG,
    1,
    CAMERA_NEAR_MM,
    CAMERA_FAR_MM,
  );
  camera.up.set(0, 0, 1);

  const lighting = applySceneLighting(three, renderer, scene, frame);
  const stage = buildStageFurniture(three, frame, frame.thicknessMm);
  scene.add(stage.object);

  const controls = new OrbitControls(camera, canvas);
  // LEFT is the armed tool's button, never the camera: null falls through
  // OrbitControls' action switch to state NONE (research doc §2/§3).
  controls.mouseButtons = { LEFT: null, MIDDLE: three.MOUSE.PAN, RIGHT: three.MOUSE.ROTATE };
  controls.zoomToCursor = true;
  controls.minDistance = MIN_DOLLY_MM;
  controls.maxDistance = MAX_DOLLY_MM;
  const render = (): void => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  let content: { object: ThreeNamespace.Object3D; dispose: () => void } | null = null;
  let overlay: OverlayDrawableHandle | null = null;
  const plane = new three.Plane(new three.Vector3(0, 0, 1), 0);
  const raycaster = new three.Raycaster();
  const scratch = new three.Vector3();

  const setPreset = (preset: CameraPreset): void => {
    const placement = cameraPlacement(preset, {
      minX: -frame.widthMm / 2,
      maxX: frame.widthMm / 2,
      minY: -frame.heightMm / 2,
      maxY: frame.heightMm / 2,
      minZ: -frame.thicknessMm,
      maxZ: 0,
    });
    camera.position.set(placement.position.x, placement.position.y, placement.position.z);
    camera.up.set(placement.up.x, placement.up.y, placement.up.z);
    controls.target.set(placement.target.x, placement.target.y, placement.target.z);
    controls.update();
    render();
  };
  setPreset('top');

  const handle: DesignViewportHandle = {
    dispose: () => {
      controls.removeEventListener('change', render);
      controls.dispose();
      overlay?.dispose();
      content?.dispose();
      stage.dispose();
      lighting.dispose();
      renderer.dispose();
    },
    resize: (width, height) => {
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    },
    updateCarve: async (input) => {
      // Build the replacement before tearing down the old, so the viewport
      // never blanks mid-edit (relief-scene-handle's rule).
      const next = await buildViewerContent(three, input);
      if (content !== null) {
        scene.remove(content.object);
        content.dispose();
      }
      content = next;
      scene.add(next.object);
      render();
    },
    updateOverlay: (input) => {
      const next = buildOverlayDrawable(three, addons, input);
      if (overlay !== null) {
        scene.remove(overlay.object);
        overlay.dispose();
      }
      overlay = next;
      scene.add(next.object);
      render();
    },
    setPreset,
    pointerToSceneMm: (offsetX, offsetY) => {
      const ndc = pointerNdc(offsetX, offsetY, canvas.clientWidth, canvas.clientHeight);
      raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
      const hit = raycaster.ray.intersectPlane(plane, scratch);
      if (hit === null) return null;
      const sceneMm = sceneFromLocal({ x: hit.x, y: hit.y, z: 0 }, frame.originMm, frame);
      return { x: sceneMm.x, y: sceneMm.y };
    },
    pxPerMmAtTarget: () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return 1;
      const a = controls.target.clone().project(camera);
      const b = controls.target.clone().add(new three.Vector3(1, 0, 0)).project(camera);
      const dxPx = ((b.x - a.x) * width) / 2;
      const dyPx = ((b.y - a.y) * height) / 2;
      const px = Math.hypot(dxPx, dyPx);
      return px > 0.01 ? px : 1;
    },
  };

  handle.resize(canvas.clientWidth, canvas.clientHeight);
  return { kind: 'ok', handle };
}

// Re-exported so the component can map its stored frame without repeating the
// one-frame arithmetic (ADR-261 §2: one mapping, one helper).
export { localFromScene };
