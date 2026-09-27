// Isolating part of the job (ADR-470): clipping planes that keep a Z range or
// one side of a section, applied to every material that draws the toolpath.
// Clipping runs per pixel on the GPU, so dragging a range slider redraws
// without touching geometry, and a move that crosses a plane is cut exactly
// where it crosses instead of vanishing whole.

import type * as ThreeNamespace from 'three';
import type { Material, Object3D } from 'three';

/**
 * A plane in work coordinates. Points where `normal · p + constant >= 0` stay
 * drawn; the rest of the toolpath is clipped away.
 */
export type Viewer3dClipPlane = {
  readonly normal: readonly [number, number, number];
  readonly constant: number;
};

export function toThreePlanes(
  three: typeof ThreeNamespace,
  planes: ReadonlyArray<Viewer3dClipPlane>,
): ThreeNamespace.Plane[] | null {
  if (planes.length === 0) return null;
  return planes.map(
    (plane) =>
      new three.Plane(
        new three.Vector3(plane.normal[0], plane.normal[1], plane.normal[2]),
        plane.constant,
      ),
  );
}

/** Sets the clipping planes of every material under `root`. */
export function clipObjects(root: Object3D | null, planes: ThreeNamespace.Plane[] | null): void {
  root?.traverse((object) => {
    const { material } = object as Object3D & { material?: Material | Material[] };
    if (material === undefined) return;
    for (const each of Array.isArray(material) ? material : [material]) {
      each.clippingPlanes = planes;
    }
  });
}
