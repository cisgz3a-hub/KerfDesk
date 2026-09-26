import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type * as ThreeNamespace from 'three';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import { buildViewerContent, type ViewerContentHandle } from '../cnc-viewer3d';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { applySceneLighting, type SceneLightingHandle } from './scene-lighting';
import {
  applyCut3DCameraControl,
  cut3DCameraPose,
  CUT3D_CAMERA_FOV_DEG,
  initialCut3DCameraState,
  type Cut3DCameraState,
} from './cut3d-offscreen-camera';
import type { Cut3DOffscreenControl } from './cut3d-offscreen-worker-protocol';

export type Cut3DOffscreenRenderer = {
  readonly control: (control: Cut3DOffscreenControl) => void;
  readonly resize: (widthPx: number, heightPx: number, pixelRatio: number) => void;
  /**
   * Shows a recomputed surface without a new canvas or renderer. The camera
   * stays where the operator left it unless the stock changed size. Resolves
   * false when a newer surface or disposal overtook this one.
   */
  readonly replaceSurface: (
    mesh: ReliefSurfaceMeshWithNormals | null,
    stockThicknessMm: number,
  ) => Promise<boolean>;
  readonly dispose: () => void;
};

type RendererParts = {
  readonly three: typeof ThreeNamespace;
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
};

// Replaced as a unit when the stock changes size: the light rig is sized to it.
type SurfaceParts = {
  readonly scene: Scene;
  readonly content: ViewerContentHandle;
  readonly lighting: SceneLightingHandle;
  readonly mesh: ReliefSurfaceMeshWithNormals;
  readonly stockThicknessMm: number;
};

const CAMERA_NEAR_MM = 0.1;
const CAMERA_FAR_MM = 10_000;
const MIN_VIEWPORT_PX = 1;
const CONTEXT_LOST_REASON = 'The 3D graphics context was lost.';

/** Builds the entire Cut 3D Three.js scene inside its render worker. */
export async function createCut3DOffscreenRenderer(input: {
  readonly canvas: OffscreenCanvas;
  readonly mesh: ReliefSurfaceMeshWithNormals;
  readonly stockThicknessMm: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelRatio: number;
  readonly onFailure: (message: string) => void;
}): Promise<Cut3DOffscreenRenderer> {
  const three = await import('three');
  const renderer = createRenderer(three, input.canvas);
  const scene = new three.Scene();
  const cameraState = initialCut3DCameraState(
    input.mesh.widthMm,
    input.mesh.heightMm,
    input.stockThicknessMm,
  );
  const camera = new three.PerspectiveCamera(
    CUT3D_CAMERA_FOV_DEG,
    safeAspect(input.widthPx, input.heightPx),
    CAMERA_NEAR_MM,
    CAMERA_FAR_MM,
  );
  camera.up.set(0, 0, 1);
  const lighting = applySceneLighting(three, renderer, scene, input.mesh, input.pixelRatio);
  const content = await buildViewerContent(three, {
    mesh: input.mesh,
    stockThicknessMm: input.stockThicknessMm,
  });
  scene.add(content.object);
  const surface = {
    scene,
    content,
    lighting,
    mesh: input.mesh,
    stockThicknessMm: input.stockThicknessMm,
  };
  return createRendererHandle({ three, renderer, camera }, surface, cameraState, input);
}

function createRenderer(three: typeof ThreeNamespace, canvas: OffscreenCanvas): WebGLRenderer {
  const renderer = new three.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(viewer3dTheme.color.background);
  return renderer;
}

function createRendererHandle(
  parts: RendererParts,
  initialSurface: SurfaceParts,
  initialCamera: Cut3DCameraState,
  input: Parameters<typeof createCut3DOffscreenRenderer>[0],
): Cut3DOffscreenRenderer {
  let surface = initialSurface;
  let cameraState = initialCamera;
  let viewportHeightPx = Math.max(MIN_VIEWPORT_PX, input.heightPx);
  let pixelRatio = input.pixelRatio;
  let surfaceSequence = 0;
  let isDisposed = false;
  const handleContextLoss = (event: Event): void => {
    event.preventDefault();
    if (!isDisposed) input.onFailure(CONTEXT_LOST_REASON);
  };
  input.canvas.addEventListener('webglcontextlost', handleContextLoss);
  const render = (): void => {
    if (isDisposed) return;
    applyCameraPose(parts.camera, cameraState);
    parts.renderer.render(surface.scene, parts.camera);
    if (parts.renderer.getContext().isContextLost()) input.onFailure(CONTEXT_LOST_REASON);
  };
  const resize = (widthPx: number, heightPx: number, ratio: number): void => {
    const width = Math.max(MIN_VIEWPORT_PX, widthPx);
    const height = Math.max(MIN_VIEWPORT_PX, heightPx);
    viewportHeightPx = height;
    pixelRatio = ratio;
    parts.renderer.setPixelRatio(Math.min(ratio, viewer3dTheme.maxPixelRatio));
    parts.renderer.setSize(width, height, false);
    parts.camera.aspect = width / height;
    parts.camera.updateProjectionMatrix();
    render();
  };
  const replaceSurface = async (
    nextMesh: ReliefSurfaceMeshWithNormals | null,
    stockThicknessMm: number,
  ): Promise<boolean> => {
    surfaceSequence += 1;
    const sequence = surfaceSequence;
    const mesh = nextMesh ?? surface.mesh;
    const content = await buildViewerContent(parts.three, { mesh, stockThicknessMm });
    if (isDisposed || sequence !== surfaceSequence) {
      content.dispose();
      return false;
    }
    const reframe = !sameStock(surface, mesh, stockThicknessMm);
    surface = swapSurface(parts, surface, { content, mesh, stockThicknessMm }, pixelRatio);
    if (reframe) {
      cameraState = initialCut3DCameraState(mesh.widthMm, mesh.heightMm, stockThicknessMm);
    }
    render();
    return true;
  };
  resize(input.widthPx, input.heightPx, input.pixelRatio);
  return {
    control: (control) => {
      cameraState = applyCut3DCameraControl(cameraState, control, viewportHeightPx);
      render();
    },
    resize,
    replaceSurface,
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      input.canvas.removeEventListener('webglcontextlost', handleContextLoss);
      surface.content.dispose();
      surface.lighting.dispose();
      parts.renderer.dispose();
      parts.renderer.forceContextLoss();
    },
  };
}

// Same stock: swap the content in place. New stock: re-light for its envelope.
function swapSurface(
  parts: RendererParts,
  previous: SurfaceParts,
  next: Pick<SurfaceParts, 'content' | 'mesh' | 'stockThicknessMm'>,
  pixelRatio: number,
): SurfaceParts {
  if (sameStock(previous, next.mesh, next.stockThicknessMm)) {
    previous.scene.remove(previous.content.object);
    previous.content.dispose();
    previous.scene.add(next.content.object);
    return { ...previous, ...next };
  }
  const scene = new parts.three.Scene();
  const lighting = applySceneLighting(parts.three, parts.renderer, scene, next.mesh, pixelRatio);
  scene.add(next.content.object);
  previous.content.dispose();
  previous.lighting.dispose();
  return { ...next, scene, lighting };
}

function sameStock(
  surface: SurfaceParts,
  mesh: ReliefSurfaceMeshWithNormals,
  stockThicknessMm: number,
): boolean {
  return (
    surface.mesh.widthMm === mesh.widthMm &&
    surface.mesh.heightMm === mesh.heightMm &&
    surface.stockThicknessMm === stockThicknessMm
  );
}

function applyCameraPose(camera: PerspectiveCamera, state: Cut3DCameraState): void {
  const pose = cut3DCameraPose(state);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
}

function safeAspect(widthPx: number, heightPx: number): number {
  return Math.max(MIN_VIEWPORT_PX, widthPx) / Math.max(MIN_VIEWPORT_PX, heightPx);
}
