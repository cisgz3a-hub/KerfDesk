// createReliefThreeScene — the persistent half of the 3D viewport (ADR-102
// §2: three is UI-only, lazy-loaded). Owns the renderer, Z-up camera, orbit
// controls and lights, and renders on demand (no rAF loop — renders on
// interaction, resize, or a content swap only).
//
// Everything that depends on the JOB lives in viewer3d-content and is swapped
// through updateContent(). Keeping the two lifetimes apart is what stops the
// operator's orbit resetting on every keystroke: previously a project edit
// tore down the renderer and rebuilt the camera from scratch, which also
// forced a shader recompile and a full buffer re-upload per edit.

// Type-only import: erased at compile time, so three itself still loads
// lazily through the dynamic import() below (ADR-102 §3).
import type { WebGLRenderer } from 'three';
import type * as ThreeNamespace from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  SECTION_DISABLED_FRACTION,
  SECTION_PLANE_NORMAL,
  sectionPlaneConstant,
} from '../viewer3d/viewer3d-clipping';
import type { Viewer3DDisplayMode } from '../viewer3d/viewer3d-display-mode';
import { screenshotSize } from '../viewer3d/viewer3d-screenshot';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import {
  buildViewerContent,
  type ViewerContentHandle,
  type ViewerContentInput,
  type ViewerSurfaceMesh,
  type ViewerToolpathOverlay,
} from '../viewer3d';
import { applySceneLighting } from './scene-lighting';

export type { ViewerSurfaceMesh, ViewerToolpathOverlay };

export type ReliefSceneHandle = {
  readonly dispose: () => void;
  // Re-fit the renderer + camera to a new canvas size. The scene renders on
  // demand (no rAF loop), so a resizable host must call this when its box
  // changes or the buffer stays at its mount-time size and scales blurrily.
  readonly resize: (width: number, height: number) => void;
  // Swap in new job geometry WITHOUT touching the camera. This is the whole
  // point of the split: the operator's viewpoint survives an edit.
  readonly updateContent: (input: ViewerContentInput) => Promise<void>;
  /** Scrubs the cutter and path reveal without rebuilding any geometry. */
  readonly setScrubMm: (atMm: number | null) => void;
  /** Shows or hides the surface and the route. */
  readonly setDisplayMode: (mode: Viewer3DDisplayMode) => void;
  /** Slides the section plane; 1 shows the whole part. */
  readonly setSectionFraction: (fraction: number) => void;
  /** Renders one frame at a scale multiplier and returns it as a data URL. */
  readonly capturePng: (scale: number) => string;
};

export type ReliefSceneResult =
  | { readonly kind: 'ok'; readonly handle: ReliefSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

const CAMERA_FOV_DEG = 40;
const CAMERA_NEAR_MM = 0.1;
const CAMERA_FAR_MM = 10_000;
// Framing: pull back enough that the stock fills most of the view without
// clipping, from a three-quarter angle that reads depth.
const ORBIT_RADIUS_FACTOR = 1.6;
const THICKNESS_FRAMING_FACTOR = 4;

export async function createReliefThreeScene(
  canvas: HTMLCanvasElement,
  mesh: ViewerSurfaceMesh,
  stockThicknessMm: number,
  toolpath?: ViewerToolpathOverlay,
): Promise<ReliefSceneResult> {
  const three = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');

  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    return {
      kind: 'no-webgl',
      reason: err instanceof Error ? err.message : 'WebGL is unavailable in this browser.',
    };
  }
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  renderer.setSize(width, height, false);
  renderer.setClearColor(viewer3dTheme.color.background);

  const scene = new three.Scene();
  const lighting = applySceneLighting(three, renderer, scene, mesh);

  const camera = framedCamera(three, width / height, mesh, stockThicknessMm);
  const controls = new OrbitControls(camera, canvas);
  applyOperatorMouseBindings(three, controls);
  const sectionPlane = installSectionPlane(three, renderer, mesh.heightMm);
  const render = (): void => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  let content: ViewerContentHandle = await buildViewerContent(three, {
    mesh,
    stockThicknessMm,
    ...(toolpath === undefined ? {} : { toolpath }),
  });
  scene.add(content.object);
  render();

  return {
    kind: 'ok',
    handle: {
      resize: (nextWidth, nextHeight) => {
        if (nextWidth <= 0 || nextHeight <= 0) return;
        renderer.setSize(nextWidth, nextHeight, false);
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        render();
      },
      updateContent: async (input) => {
        const next = await buildViewerContent(three, input);
        // Build the replacement BEFORE tearing down the old one, so a slow
        // rebuild never leaves the pane blank mid-edit.
        scene.remove(content.object);
        content.dispose();
        content = next;
        scene.add(content.object);
        render();
      },
      setScrubMm: (atMm) => {
        content.setScrubMm(atMm);
        render();
      },
      setDisplayMode: (mode) => {
        content.setDisplayMode(mode);
        render();
      },
      setSectionFraction: (fraction) => {
        sectionPlane.constant = sectionPlaneConstant(fraction, mesh.heightMm);
        render();
      },
      capturePng: (scale) => capturePngDataUrl({ renderer, camera, canvas, render, scale }),
      dispose: () => {
        controls.removeEventListener('change', render);
        controls.dispose();
        lighting.dispose();
        content.dispose();
        renderer.dispose();
      },
    },
  };
}

// Perspective camera framed to the stock, looking down at it from the front
// left. Z-up so depth reads vertically, matching the machine's own axes.
function framedCamera(
  three: typeof ThreeNamespace,
  aspect: number,
  mesh: ViewerSurfaceMesh,
  stockThicknessMm: number,
): ThreeNamespace.PerspectiveCamera {
  const camera = new three.PerspectiveCamera(CAMERA_FOV_DEG, aspect, CAMERA_NEAR_MM, CAMERA_FAR_MM);
  camera.up.set(0, 0, 1);
  const orbitRadius =
    Math.max(mesh.widthMm, mesh.heightMm, stockThicknessMm * THICKNESS_FRAMING_FACTOR) *
    ORBIT_RADIUS_FACTOR;
  camera.position.set(orbitRadius * 0.7, -orbitRadius * 0.7, orbitRadius * 0.6);
  camera.lookAt(0, 0, 0);
  return camera;
}

// Renders one frame at an enlarged size and reads it back as a PNG data URL,
// then restores the on-screen size. preserveDrawingBuffer is off, so the
// buffer is cleared after each present and the capture has to render into the
// enlarged buffer itself rather than read back whatever was last shown.
function capturePngDataUrl(input: {
  readonly renderer: WebGLRenderer;
  readonly camera: ThreeNamespace.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly render: () => void;
  readonly scale: number;
}): string {
  const { renderer, camera, canvas, render, scale } = input;
  const previous = { width: canvas.clientWidth, height: canvas.clientHeight };
  const size = screenshotSize(previous.width, previous.height, scale);
  resizeTo(renderer, camera, size);
  render();
  const dataUrl = renderer.domElement.toDataURL('image/png');
  resizeTo(renderer, camera, previous);
  render();
  return dataUrl;
}

function resizeTo(
  renderer: WebGLRenderer,
  camera: ThreeNamespace.PerspectiveCamera,
  size: { readonly width: number; readonly height: number },
): void {
  renderer.setSize(size.width, size.height, false);
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
}

// Left-drag PANS, right-drag orbits — the opposite of three's default. Sliding
// the part around is the move an operator reaches for constantly while
// inspecting a cut; re-aiming the camera is occasional.
function applyOperatorMouseBindings(three: typeof ThreeNamespace, controls: OrbitControls): void {
  controls.mouseButtons = {
    LEFT: three.MOUSE.PAN,
    MIDDLE: three.MOUSE.DOLLY,
    RIGHT: three.MOUSE.ROTATE,
  };
}

// Allocated ONCE at length 1 and never resized. three recompiles every shader
// in the scene when the clipping-plane count changes, which stutters precisely
// while the operator is dragging the section slider; pushing the plane past
// the far edge disables it without touching the array's length.
function installSectionPlane(
  three: typeof ThreeNamespace,
  renderer: WebGLRenderer,
  spanMm: number,
): ThreeNamespace.Plane {
  const plane = new three.Plane(
    new three.Vector3(...SECTION_PLANE_NORMAL),
    sectionPlaneConstant(SECTION_DISABLED_FRACTION, spanMm),
  );
  renderer.clippingPlanes = [plane];
  return plane;
}
