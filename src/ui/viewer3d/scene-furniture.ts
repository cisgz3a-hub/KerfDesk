// Scene furniture and camera framing (ADR-255): the work-plane grid, origin
// triad, and the fit-to-bounds camera placement, plus the shared bounds math
// they both use.

import type * as ThreeNamespace from 'three';
import type { Object3D, PerspectiveCamera } from 'three';
import type { AxisBounds } from '../../core/gcode-view';
import type { Viewer3dTheme } from './viewer3d-theme';

const FIT_DISTANCE_FACTOR = 1.7;
const DEFAULT_VIEW_MM = 100;
const GRID_STEP_MM = 10;
const TRIAD_EXTENT_FRACTION = 0.25;

type ThreeModule = typeof ThreeNamespace;

export function buildFurniture(
  three: ThreeModule,
  bounds: AxisBounds | null,
  theme: Viewer3dTheme,
): ReadonlyArray<Object3D> {
  const extent = boundsExtent(bounds);
  const gridSize = Math.ceil((extent * FIT_DISTANCE_FACTOR) / GRID_STEP_MM) * GRID_STEP_MM * 2;
  const divisions = Math.max(2, Math.round(gridSize / GRID_STEP_MM));
  const grid = new three.GridHelper(gridSize, divisions, theme.gridMajor, theme.gridMinor);
  // GridHelper lies in XZ; rotate onto the XY work plane (Z-up frame).
  grid.rotation.x = Math.PI / 2;
  const center = boundsCenter(bounds);
  grid.position.set(center.x, center.y, 0);
  const axes = new three.AxesHelper(Math.max(GRID_STEP_MM, extent * TRIAD_EXTENT_FRACTION));
  return [grid, axes];
}

export function frameCamera(
  camera: PerspectiveCamera,
  controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void },
  bounds: AxisBounds | null,
): void {
  const center = boundsCenter(bounds);
  const distance = boundsExtent(bounds) * FIT_DISTANCE_FACTOR;
  camera.position.set(center.x + distance * 0.6, center.y - distance * 0.6, distance * 0.55);
  controls.target.set(center.x, center.y, center.z);
  camera.lookAt(center.x, center.y, center.z);
  controls.update();
}

export function boundsCenter(bounds: AxisBounds | null): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  if (bounds === null) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

export function boundsExtent(bounds: AxisBounds | null): number {
  if (bounds === null) return DEFAULT_VIEW_MM;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const spanZ = bounds.maxZ - bounds.minZ;
  return Math.max(spanX, spanY, spanZ, GRID_STEP_MM);
}

// Complete disposal: geometry AND material of every child (the pre-ADR-255
// scene leaked materials on every rebuild — [R3D] gap 4).
export function disposeChildren(group: Object3D): void {
  for (const child of [...group.children]) {
    group.remove(child);
    const mesh = child as { geometry?: { dispose?: () => void }; material?: unknown };
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      (entry as { dispose?: () => void } | undefined)?.dispose?.();
    }
  }
}
