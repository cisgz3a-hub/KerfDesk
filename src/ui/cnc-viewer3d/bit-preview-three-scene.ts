// Small, self-owned Three scene for the transient catalog preview. Three stays
// behind a dynamic import so opening CNC setup does not add it to the initial
// UI bundle.

import type * as ThreeNamespace from 'three';
import type { AmbientLight, DirectionalLight, Scene, WebGLRenderer } from 'three';
import type { CncTool } from '../../core/scene';
import { viewer3dTheme } from '../theme/viewer3d-theme';
import { bitPreviewProfile } from './bit-preview-profile';
import { buildToolMesh, type ToolMeshHandle } from './viewer3d-tool';

export type BitPreviewThreeModule = typeof ThreeNamespace;

export type BitPreviewSceneHandle = {
  readonly dispose: () => void;
};

export type BitPreviewRuntimeFailureReporter = (reason: string) => void;

export type BitPreviewSceneResult =
  | { readonly kind: 'ok'; readonly handle: BitPreviewSceneHandle }
  | { readonly kind: 'no-webgl'; readonly reason: string };

export type BitPreviewSceneFactory = (
  canvas: HTMLCanvasElement,
  tool: CncTool,
  onRuntimeFailure: BitPreviewRuntimeFailureReporter,
) => Promise<BitPreviewSceneResult>;

const CAMERA_FOV_DEG = 34;
const CAMERA_NEAR_MM = 0.01;
const CAMERA_FAR_MM = 10_000;
const MAX_PIXEL_RATIO = 2;
const ORBIT_RADIANS_PER_FRAME = 0.008;

type PreviewResources = {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  scene: Scene | null;
  toolMesh: ToolMeshHandle | null;
  ambient: AmbientLight | null;
  key: DirectionalLight | null;
  frameId: number | null;
  contextLostListener: (() => void) | null;
  disposed: boolean;
};

export async function createBitPreviewThreeScene(
  canvas: HTMLCanvasElement,
  tool: CncTool,
  onRuntimeFailure: BitPreviewRuntimeFailureReporter = () => undefined,
  loadThree: () => Promise<BitPreviewThreeModule> = () => import('three'),
): Promise<BitPreviewSceneResult> {
  const three = await loadThree();
  let renderer: WebGLRenderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    return { kind: 'no-webgl', reason: errorMessage(error) };
  }

  return buildBitPreviewScene(three, renderer, canvas, tool, onRuntimeFailure);
}

function buildBitPreviewScene(
  three: BitPreviewThreeModule,
  renderer: WebGLRenderer,
  canvas: HTMLCanvasElement,
  tool: CncTool,
  onRuntimeFailure: BitPreviewRuntimeFailureReporter,
): BitPreviewSceneResult {
  const resources: PreviewResources = {
    renderer,
    canvas,
    scene: null,
    toolMesh: null,
    ambient: null,
    key: null,
    frameId: null,
    contextLostListener: null,
    disposed: false,
  };
  try {
    const width = canvas.clientWidth || canvas.width || 180;
    const height = canvas.clientHeight || canvas.height || 132;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    renderer.setClearColor(viewer3dTheme.color.background, 0);

    const profile = bitPreviewProfile(tool);
    const profileHeightMm = profile.at(-1)?.heightMm ?? tool.diameterMm;
    const profileDiameterMm = Math.max(...profile.map((point) => point.radiusMm * 2));
    const spanMm = Math.max(profileHeightMm, profileDiameterMm, 1);
    const scene = new three.Scene();
    resources.scene = scene;
    const camera = new three.PerspectiveCamera(
      CAMERA_FOV_DEG,
      width / height,
      CAMERA_NEAR_MM,
      CAMERA_FAR_MM,
    );
    camera.up.set(0, 0, 1);

    const toolMesh = buildToolMesh(three, profile, { x: 0, y: 0, z: 0 });
    resources.toolMesh = toolMesh;
    const ambient = new three.AmbientLight(0xffffff, 1.15);
    const key = new three.DirectionalLight(0xffffff, 2.2);
    resources.ambient = ambient;
    resources.key = key;
    key.position.set(spanMm, -spanMm, spanMm * 2);
    scene.add(toolMesh.object, ambient, key);

    const targetZMm = profileHeightMm * 0.45;
    const orbitRadiusMm = spanMm * 2.15;
    let orbitAngleRad = -0.8;
    const failRuntime = installRuntimeFailureHandler(resources, onRuntimeFailure);
    const render = (): void => {
      camera.position.set(
        Math.cos(orbitAngleRad) * orbitRadiusMm,
        Math.sin(orbitAngleRad) * orbitRadiusMm,
        targetZMm + spanMm * 0.65,
      );
      camera.lookAt(0, 0, targetZMm);
      renderer.render(scene, camera);
    };
    const animate = (): void => {
      if (resources.disposed) return;
      try {
        orbitAngleRad += ORBIT_RADIANS_PER_FRAME;
        render();
        resources.frameId = globalThis.requestAnimationFrame(animate);
      } catch (error) {
        failRuntime(`3D preview rendering stopped: ${errorMessage(error)}`);
      }
    };

    render();
    if (shouldAnimate()) resources.frameId = globalThis.requestAnimationFrame(animate);
    return { kind: 'ok', handle: { dispose: () => disposePreviewResources(resources) } };
  } catch (error) {
    disposePreviewResources(resources);
    throw error;
  }
}

function installRuntimeFailureHandler(
  resources: PreviewResources,
  onRuntimeFailure: BitPreviewRuntimeFailureReporter,
): BitPreviewRuntimeFailureReporter {
  const failRuntime = (reason: string): void => {
    if (resources.disposed) return;
    disposePreviewResources(resources);
    onRuntimeFailure(reason);
  };
  const onContextLost = (): void => failRuntime('The WebGL context was lost.');
  resources.contextLostListener = onContextLost;
  resources.canvas.addEventListener('webglcontextlost', onContextLost);
  return failRuntime;
}

function shouldAnimate(): boolean {
  if (typeof globalThis.requestAnimationFrame !== 'function') return false;
  return !(
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function disposePreviewResources(resources: PreviewResources): void {
  if (resources.disposed) return;
  resources.disposed = true;
  try {
    if (resources.contextLostListener !== null) {
      resources.canvas.removeEventListener('webglcontextlost', resources.contextLostListener);
      resources.contextLostListener = null;
    }
    if (resources.frameId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(resources.frameId);
    }
    if (resources.scene !== null) {
      if (resources.toolMesh !== null) resources.scene.remove(resources.toolMesh.object);
      if (resources.ambient !== null) resources.scene.remove(resources.ambient);
      if (resources.key !== null) resources.scene.remove(resources.key);
    }
  } finally {
    try {
      resources.toolMesh?.dispose();
    } finally {
      resources.renderer.dispose();
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'WebGL is unavailable in this browser.';
}
