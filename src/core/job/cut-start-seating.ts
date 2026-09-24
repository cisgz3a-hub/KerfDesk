// Compile-time seating of operator-set closed Line cut starts (ADR-385).
//
// A stored start (scene/cut-start-points.ts) resolves to a machine-space
// point; the compiled closed segment is then rotated so it begins at its ring
// vertex nearest that point and is marked startLocked, which every automatic
// start and direction choice respects. Snapping to an existing vertex keeps
// the burned geometry exactly as compiled, and it follows a kerf offset: a
// start set on a square corner lands on the offset loop's mitred corner,
// where a projection onto the offset edges would land beside it.
//
// Seating runs after tabs are applied, so a shape that tabs split into open
// bridges has no closed loop left to seat and its tabs stay where the drawn
// start put them.

import { toMachineCoords, type DeviceProfile } from '../devices';
import { applyTransform, type ColoredPath, type SceneObject, type Vec2 } from '../scene';
import { cutStartLocalPosition } from '../scene/cut-start-points';
import { closedLoopRing, rotateClosedPolyline } from './closed-cut-loop';
import type { CutSegment } from './job';

const NO_TARGETS: ReadonlyMap<number, Vec2> = new Map();

// How far a kerf offset can carry a start vertex from its source point:
// Clipper's miter limit of 2 bounds a corner's move to twice the offset.
const KERF_MATCH_FACTOR = 3;
const MIN_KERF_MATCH_MM = 0.5;

/** Machine-space start targets for one path, keyed by polyline index. */
export function cutStartTargetsForPath(
  object: SceneObject & { readonly paths: ReadonlyArray<ColoredPath> },
  pathIndex: number,
  device: DeviceProfile,
): ReadonlyMap<number, Vec2> {
  const starts = object.cutStartPoints?.filter((start) => start.pathIndex === pathIndex);
  const path = object.paths[pathIndex];
  if (starts === undefined || starts.length === 0 || path === undefined) return NO_TARGETS;
  const targets = new Map<number, Vec2>();
  for (const start of starts) {
    const local = cutStartLocalPosition(path, start);
    if (local === null) continue;
    targets.set(
      start.polylineIndex,
      toMachineCoords(applyTransform(local, object.transform), device),
    );
  }
  return targets;
}

/** Seat a closed segment's start at its vertex nearest `target`. */
export function seatCutStart(segment: CutSegment, target: Vec2 | undefined): CutSegment {
  if (target === undefined || !segment.closed) return segment;
  const ring = closedLoopRing(segment.polyline);
  const nearest = nearestRingVertex(ring, target);
  if (nearest === null) return segment;
  return {
    ...segment,
    polyline: rotateClosedPolyline(segment.polyline, nearest.index),
    startLocked: true,
  };
}

/**
 * Kerf offset may merge, split or reorder a path's loops, so a start is
 * matched by proximity: the target nearest one of this loop's vertices
 * claims it, provided the offset could plausibly have moved that vertex there.
 */
export function seatKerfCutStart(
  segment: CutSegment,
  targets: ReadonlyArray<Vec2>,
  kerfOffsetMm: number,
): CutSegment {
  if (targets.length === 0 || !segment.closed) return segment;
  const ring = closedLoopRing(segment.polyline);
  const reach = Math.max(MIN_KERF_MATCH_MM, KERF_MATCH_FACTOR * Math.abs(kerfOffsetMm));
  let best: { readonly index: number; readonly distanceSq: number } | null = null;
  for (const target of targets) {
    const candidate = nearestRingVertex(ring, target);
    if (candidate !== null && (best === null || candidate.distanceSq < best.distanceSq)) {
      best = candidate;
    }
  }
  if (best === null || best.distanceSq > reach * reach) return segment;
  return {
    ...segment,
    polyline: rotateClosedPolyline(segment.polyline, best.index),
    startLocked: true,
  };
}

function nearestRingVertex(
  ring: ReadonlyArray<Vec2>,
  target: Vec2,
): { readonly index: number; readonly distanceSq: number } | null {
  let best: { readonly index: number; readonly distanceSq: number } | null = null;
  for (let index = 0; index < ring.length; index += 1) {
    const point = ring[index] as Vec2;
    const distanceSq = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (best === null || distanceSq < best.distanceSq) best = { index, distanceSq };
  }
  return best;
}
