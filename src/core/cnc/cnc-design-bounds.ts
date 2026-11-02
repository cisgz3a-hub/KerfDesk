// Where a CNC operation's artwork lies in program coordinates (ADR-327
// Amendment 1). Job Origin anchors on this, not on the cutter's reach: an
// Outside profile's reach is one bit diameter past the drawn outline, and a
// V-bit's reach is its full body radius however shallow it cuts. The outlines
// are the operation's own machine-space polylines, less those it omits: a cut
// that needs filled contours cuts nothing from an open or empty one. A
// relief is the rectangle its heightmap is carved in, placed as the relief
// compiler places it.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { normalizeClosedPolylinesEvenOddChecked } from '../geometry/polygon-difference';
import type { CncGroup } from '../job';
import {
  applyTransform,
  DEFAULT_CNC_LAYER_SETTINGS,
  sceneObjectUsesOperation,
  type Bounds,
  type CncCutType,
  type Layer,
  type Polyline,
  type ReliefObject,
  type SceneObject,
  type Vec2,
} from '../scene';
import { cutTypeNeedsClosedContours } from './closed-contour-cut-types';
import { reliefMachineSpaceGeometry } from './relief-machine-space';
import { hasFinitePoints } from './profile-paths';

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
  const cutType = (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType;
  const closedOnly = cutTypeNeedsClosedContours(cutType);
  for (const polyline of polylines) {
    if (closedOnly && !contributesClosedGeometry(polyline, cutType)) continue;
    for (const point of polyline.points) extend(b, point);
  }
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

function contributesClosedGeometry(polyline: Polyline, cutType: CncCutType): boolean {
  if (!polyline.closed || polyline.points.length < 3 || !hasFinitePoints(polyline)) return false;
  // Drill uses the bounding-box centre of every finite closed contour,
  // including collinear ones; it does not require a filled interior.
  if (cutType === 'drill') return true;
  if (Math.abs(signedAreaMm2(polyline.points)) > 1e-9) return true;
  // Oppositely wound lobes can cancel in the shoelace sum while both are
  // pocketed. Resolve that ambiguous case with the compiler's fill rule;
  // genuinely collinear or retraced contours still normalize to nothing.
  const filled = normalizeClosedPolylinesEvenOddChecked([polyline]);
  // A geometry-engine failure is not evidence of emptiness. Preserve the
  // artwork extent if the compiler nevertheless produced a group for it.
  return filled.kind === 'error' || filled.value.length > 0;
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
