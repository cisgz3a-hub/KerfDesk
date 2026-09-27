// Small scene operations shared by the G-code scene handle (ADR-255;
// split from viewer3d-scene.ts by ADR-426 to keep both inside the size caps).

import type * as ThreeNamespace from 'three';
import type { Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
import type { LineMaterial as LineMaterialType } from 'three/examples/jsm/lines/LineMaterial.js';
import type { AxisBounds } from '../../core/gcode-view';
import type { Viewer3dRenderScheduler } from './create-viewer3d-render-scheduler';
import type { ArrowPlacement } from './direction-arrows';
import { createArrowMesh, disposeArrowMesh, type ArrowMesh } from './scene-arrows';
import { buildFurniture, disposeChildren } from './scene-furniture';
import type { MarkerMesh } from './scene-markers';
import { buildToolpathObjects, type ToolpathBuildArgs } from './scene-toolpath';
import type { Viewer3dTheme } from './viewer3d-theme';

type ThreeModule = typeof ThreeNamespace;

export type Point3 = { readonly x: number; readonly y: number; readonly z: number };

export function captureFrame(scheduler: Viewer3dRenderScheduler, renderer: WebGLRenderer): string {
  scheduler.renderNow();
  return renderer.domElement.toDataURL('image/png');
}

// Swap the drawn toolpath: dispose what was there, build the new batches,
// mount them. Disposal first — the old buffers are dead the moment the
// program changes.
export function rebuildToolpath(
  group: Object3D,
  args: ToolpathBuildArgs,
): ReturnType<typeof buildToolpathObjects> {
  disposeChildren(group);
  const built = buildToolpathObjects(args);
  for (const object of built.objects) group.add(object);
  return built;
}

// Swap the bed/grid/triad for a new job extent.
export function rebuildFurniture(
  three: ThreeModule,
  group: Object3D,
  bounds: AxisBounds | null,
  theme: Viewer3dTheme,
): void {
  disposeChildren(group);
  for (const object of buildFurniture(three, bounds, theme)) group.add(object);
}

// Replace the arrow overlay: the old instanced mesh is dead the moment the
// overlay is toggled or the program changes.
export function swapArrows(
  three: ThreeModule,
  scene: ThreeNamespace.Scene,
  previous: ArrowMesh | null,
  placements: ReadonlyArray<ArrowPlacement> | null,
  extentMm: number,
  theme: Viewer3dTheme,
): ArrowMesh | null {
  disposeArrowMesh(scene, previous);
  if (placements === null) return null;
  const mesh = createArrowMesh(three, placements, extentMm, theme);
  if (mesh !== null) scene.add(mesh);
  return mesh;
}

// Fat-line materials size their strokes against the drawing buffer, so the
// material's resolution has to track the canvas. The orthographic twin reads
// the perspective camera's aspect each frame.
export function applyResize(
  parts: {
    readonly renderer: WebGLRenderer;
    readonly camera: PerspectiveCamera;
    readonly fatMaterial: LineMaterialType | null;
  },
  width: number,
  height: number,
): void {
  parts.renderer.setSize(width, height, false);
  parts.camera.aspect = width / height;
  parts.camera.updateProjectionMatrix();
  parts.fatMaterial?.resolution.set(width, height);
}

// Show a marker at a point, or hide it when there is nothing to show.
export function placeMarker(mesh: MarkerMesh, point: Point3 | null): void {
  mesh.visible = point !== null;
  if (point !== null) mesh.position.set(point.x, point.y, point.z);
}
