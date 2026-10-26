// Where a CNC operation's artwork lies in program coordinates (ADR-327
// Amendment 1). Job Origin anchors on this, not on the cutter's reach: an
// Outside profile's reach is one bit diameter past the drawn outline, and a
// V-bit's reach is its full body radius however shallow it cuts. The outlines
// are the operation's own machine-space polylines; a relief is the rectangle
// its heightmap is carved in, placed as the relief compiler places it.

import { toMachineCoords, type DeviceProfile } from '../devices';
import type { CncGroup } from '../job';
import {
  applyTransform,
  sceneObjectUsesOperation,
  type Bounds,
  type Layer,
  type Polyline,
  type ReliefObject,
  type SceneObject,
  type Vec2,
} from '../scene';
import { reliefMachineSpaceGeometry } from './relief-machine-space';

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function cncOperationDesignBounds(
  polylines: ReadonlyArray<Polyline>,
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  device: DeviceProfile,
): Bounds | null {
  const b: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const polyline of polylines) for (const point of polyline.points) extend(b, point);
  for (const object of objects) {
    if (object.kind !== 'relief' || !sceneObjectUsesOperation(object, layer)) continue;
    for (const corner of reliefMachineCorners(object, device)) extend(b, corner);
  }
  return Number.isFinite(b.minX) && Number.isFinite(b.minY)
    ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
    : null;
}

/** Stamp an operation's design extent on each group it compiled. */
export function withDesignBounds(
  groups: ReadonlyArray<CncGroup>,
  designBounds: Bounds | null,
): ReadonlyArray<CncGroup> {
  return designBounds === null ? groups : groups.map((group) => ({ ...group, designBounds }));
}

function reliefMachineCorners(relief: ReliefObject, device: DeviceProfile): ReadonlyArray<Vec2> {
  const { residualTransform, widthMm, heightMm } = reliefMachineSpaceGeometry(relief);
  return [
    { x: 0, y: 0 },
    { x: widthMm, y: 0 },
    { x: widthMm, y: heightMm },
    { x: 0, y: heightMm },
  ].map((corner) => toMachineCoords(applyTransform(corner, residualTransform), device));
}

function extend(b: MutableBounds, p: Vec2): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.y > b.maxY) b.maxY = p.y;
}
