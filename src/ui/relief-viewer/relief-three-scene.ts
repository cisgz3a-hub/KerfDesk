// createReliefThreeScene — the persistent half of the 3D viewport (ADR-102
// §2: three is UI-only, lazy-loaded). Owns the renderer, Z-up camera, orbit
// controls and lights, and renders on demand (no rAF loop — renders on
// interaction, resize, a content swap, or while a drag's glide settles).
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
import {
  SECTION_DISABLED_FRACTION,
  SECTION_PLANE_NORMAL,
  sectionPlaneConstant,
} from '../cnc-viewer3d/viewer3d-clipping';
import { createSceneHandle, type SceneHandle } from './relief-scene-handle';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import {
  buildViewerContent,
  type ViewerSurfaceMesh,
  type ViewerToolpathOverlay,
} from '../cnc-viewer3d';
import { applySceneLighting } from './scene-lighting';
import { installViewer3DThreeKeyboard } from './viewer3d-three-keyboard';
// Deep imports: the viewer3d barrel is capped at 20 exports by its index contract.
import { configureViewer3dControls } from '../viewer3d/viewer3d-controls';
import { createViewer3dGlideRendering } from '../viewer3d/viewer3d-glide-rendering';

export type { ViewerSurfaceMesh, ViewerToolpathOverlay };

export type ReliefSceneHandle = SceneHandle;

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
  const lighting = applySceneLighting(three, renderer, scene, mesh, window.devicePixelRatio);

  const camera = framedCamera(three, width / height, mesh, stockThicknessMm);
  const controls = new OrbitControls(camera, canvas);
  // The shared mouse map and feel of every 3D view (ADR-426).
  configureViewer3dControls(three, controls);
  const sectionPlane = installSectionPlane(three, renderer, mesh.heightMm);
  const raycaster = new three.Raycaster();
  const rendering = createViewer3dGlideRendering(controls, () => renderer.render(scene, camera));
  const render = rendering.render;

  const content = await buildViewerContent(three, {
    mesh,
    stockThicknessMm,
    ...(toolpath === undefined ? {} : { toolpath }),
  });
  const disposeKeyboard = installViewer3DThreeKeyboard(canvas, camera, controls);
  scene.add(content.object);
  render();

  return {
    kind: 'ok',
    handle: createSceneHandle({
      three,
      scene,
      renderer,
      camera,
      canvas,
      controls,
      raycaster,
      sectionPlane,
      sectionSpanMm: mesh.heightMm,
      content,
      render,
      disposeRendering: rendering.dispose,
      disposeKeyboard,
      disposeLighting: lighting.dispose,
    }),
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
