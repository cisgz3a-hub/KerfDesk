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
  readonly dispose: () => void;
};

type RendererParts = {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly content: ViewerContentHandle;
  readonly lighting: SceneLightingHandle;
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
  const parts = { renderer, scene, camera, content, lighting };
  return createRendererHandle(parts, cameraState, input);
}

function createRenderer(three: typeof ThreeNamespace, canvas: OffscreenCanvas): WebGLRenderer {
  const renderer = new three.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(viewer3dTheme.color.background);
  return renderer;
}

function createRendererHandle(
  parts: RendererParts,
  initialCamera: Cut3DCameraState,
  input: Parameters<typeof createCut3DOffscreenRenderer>[0],
): Cut3DOffscreenRenderer {
  let cameraState = initialCamera;
  let viewportHeightPx = Math.max(MIN_VIEWPORT_PX, input.heightPx);
  let isDisposed = false;
  const handleContextLoss = (event: Event): void => {
    event.preventDefault();
    if (!isDisposed) input.onFailure(CONTEXT_LOST_REASON);
  };
  input.canvas.addEventListener('webglcontextlost', handleContextLoss);
  const render = (): void => {
    if (isDisposed) return;
    applyCameraPose(parts.camera, cameraState);
    parts.renderer.render(parts.scene, parts.camera);
    if (parts.renderer.getContext().isContextLost()) input.onFailure(CONTEXT_LOST_REASON);
  };
  const resize = (widthPx: number, heightPx: number, pixelRatio: number): void => {
    const width = Math.max(MIN_VIEWPORT_PX, widthPx);
    const height = Math.max(MIN_VIEWPORT_PX, heightPx);
    viewportHeightPx = height;
    parts.renderer.setPixelRatio(Math.min(pixelRatio, viewer3dTheme.maxPixelRatio));
    parts.renderer.setSize(width, height, false);
    parts.camera.aspect = width / height;
    parts.camera.updateProjectionMatrix();
    render();
  };
  resize(input.widthPx, input.heightPx, input.pixelRatio);
  return {
    control: (control) => {
      cameraState = applyCut3DCameraControl(cameraState, control, viewportHeightPx);
      render();
    },
    resize,
    dispose: () => {
      if (isDisposed) return;
      isDisposed = true;
      input.canvas.removeEventListener('webglcontextlost', handleContextLoss);
      parts.content.dispose();
      parts.lighting.dispose();
      parts.renderer.dispose();
      parts.renderer.forceContextLoss();
    },
  };
}

function applyCameraPose(camera: PerspectiveCamera, state: Cut3DCameraState): void {
  const pose = cut3DCameraPose(state);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
}

function safeAspect(widthPx: number, heightPx: number): number {
  return Math.max(MIN_VIEWPORT_PX, widthPx) / Math.max(MIN_VIEWPORT_PX, heightPx);
}
