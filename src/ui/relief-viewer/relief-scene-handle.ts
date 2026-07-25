// createSceneHandle — the operations callers can perform on a built scene.
//
// Split out of relief-three-scene so that module does one thing: build the
// scene. This one does the other: expose it. The split is what keeps both
// inside the function-length limit now that the viewport has resize, content
// swap, scrub, display mode, section plane, capture and pick.
//
// The content handle is the only mutable state here, and it is mutable because
// updateContent replaces it. Everything else is captured once.

import type * as ThreeNamespace from 'three';
import type { WebGLRenderer } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { sectionPlaneConstant } from '../viewer3d/viewer3d-clipping';
import {
  buildViewerContent,
  type ViewerContentHandle,
  type ViewerContentInput,
} from '../viewer3d/viewer3d-content';
import type { Viewer3DDisplayMode } from '../viewer3d/viewer3d-display-mode';
import { pointerNdc, type PickVec3 } from '../viewer3d/viewer3d-picking';
import { screenshotSize } from '../viewer3d/viewer3d-screenshot';

export type SceneHandle = {
  readonly dispose: () => void;
  readonly resize: (width: number, height: number) => void;
  readonly updateContent: (input: ViewerContentInput) => Promise<void>;
  readonly setScrubMm: (atMm: number | null) => void;
  readonly setDisplayMode: (mode: Viewer3DDisplayMode) => void;
  readonly setSectionFraction: (fraction: number) => void;
  readonly capturePng: (scale: number) => string;
  readonly probeAt: (offsetX: number, offsetY: number) => PickVec3 | null;
};

export type SceneHandleDeps = {
  readonly three: typeof ThreeNamespace;
  readonly scene: ThreeNamespace.Scene;
  readonly renderer: WebGLRenderer;
  readonly camera: ThreeNamespace.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly controls: OrbitControls;
  readonly raycaster: ThreeNamespace.Raycaster;
  readonly sectionPlane: ThreeNamespace.Plane;
  readonly sectionSpanMm: number;
  readonly content: ViewerContentHandle;
  readonly render: () => void;
  readonly disposeLighting: () => void;
};

/**
 * Wraps a built scene in the operations its owner needs.
 *
 * @param deps The already-constructed scene objects and initial content.
 * @returns The handle the pane holds for the scene's lifetime.
 */
export function createSceneHandle(deps: SceneHandleDeps): SceneHandle {
  const { three, scene, renderer, camera, canvas, controls, render } = deps;
  let content = deps.content;

  return {
    resize: (width, height) => {
      if (width <= 0 || height <= 0) return;
      resizeTo(renderer, camera, { width, height });
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
      deps.sectionPlane.constant = sectionPlaneConstant(fraction, deps.sectionSpanMm);
      render();
    },
    capturePng: (scale) => capturePngDataUrl({ renderer, camera, canvas, render, scale }),
    probeAt: (offsetX, offsetY) =>
      pickSurfacePoint({
        three,
        raycaster: deps.raycaster,
        camera,
        canvas,
        surface: content.surface,
        offsetX,
        offsetY,
      }),
    dispose: () => {
      controls.removeEventListener('change', render);
      controls.dispose();
      deps.disposeLighting();
      content.dispose();
      renderer.dispose();
    },
  };
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

// Casts a ray at the pointer and returns where it meets the machined surface.
// Non-recursive on purpose: the stage grid, the stock outline and the toolpath
// quads share the content group and would otherwise be hit first, reporting a
// depth that belongs to no material.
function pickSurfacePoint(input: {
  readonly three: typeof ThreeNamespace;
  readonly raycaster: ThreeNamespace.Raycaster;
  readonly camera: ThreeNamespace.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly surface: ThreeNamespace.Object3D;
  readonly offsetX: number;
  readonly offsetY: number;
}): PickVec3 | null {
  const { three, raycaster, camera, canvas, surface, offsetX, offsetY } = input;
  const ndc = pointerNdc(offsetX, offsetY, canvas.clientWidth, canvas.clientHeight);
  raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
  const hit = raycaster.intersectObject(surface, false)[0];
  return hit === undefined ? null : { x: hit.point.x, y: hit.point.y, z: hit.point.z };
}
