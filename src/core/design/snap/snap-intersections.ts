// snap-intersections — where two pieces of geometry actually cross
// (ADR-272, Phase N DS-4).
//
// The most expensive snap and the one worth bounding: candidate pairs are limited
// to segments whose bounding boxes reach the query point, so cost scales with the
// geometry NEAR the cursor rather than with the size of the sketch. Without that,
// every pointer move over a busy drawing would be an O(n^2) sweep.
//
// Only crossings between DIFFERENT entities are reported. A self-intersection is a
// property of one shape, not a reference point between two, and offering it tends
// to fight the endpoint snap on closed paths.

import type { Vec2 } from '../../scene';
import type { SnapTarget } from './snap-kinds';
import { distanceMm, type SnapSegment } from './snap-segments';

// Parallel and near-parallel pairs have no single crossing point; below this
// denominator the solve is numerically meaningless.
const PARALLEL_EPSILON = 1e-12;

export function intersectionTargets(
  segments: ReadonlyArray<SnapSegment>,
  pointMm: Vec2,
  toleranceMm: number,
): ReadonlyArray<SnapTarget> {
  const near = segments.filter((segment) => reachesPoint(segment, pointMm, toleranceMm));
  const targets: SnapTarget[] = [];
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const a = near[i];
      const b = near[j];
      if (a === undefined || b === undefined) continue;
      if (a.entityId === b.entityId) continue;
      const at = segmentCrossing(a, b);
      if (at === null) continue;
      if (distanceMm(at, pointMm) > toleranceMm) continue;
      targets.push({ kind: 'intersection', atMm: at, entityId: a.entityId });
    }
  }
  return targets;
}

// Cheap rejection: a segment can only contribute a crossing within tolerance of
// the cursor if its own bounding box, grown by the tolerance, contains the cursor.
function reachesPoint(segment: SnapSegment, pointMm: Vec2, toleranceMm: number): boolean {
  const minX = Math.min(segment.fromMm.x, segment.toMm.x) - toleranceMm;
  const maxX = Math.max(segment.fromMm.x, segment.toMm.x) + toleranceMm;
  const minY = Math.min(segment.fromMm.y, segment.toMm.y) - toleranceMm;
  const maxY = Math.max(segment.fromMm.y, segment.toMm.y) + toleranceMm;
  return pointMm.x >= minX && pointMm.x <= maxX && pointMm.y >= minY && pointMm.y <= maxY;
}

// Proper segment-segment crossing: both parameters must lie within [0, 1], so a
// point where the infinite lines would meet beyond either segment is not a
// crossing the operator can see.
export function segmentCrossing(a: SnapSegment, b: SnapSegment): Vec2 | null {
  const ax = a.toMm.x - a.fromMm.x;
  const ay = a.toMm.y - a.fromMm.y;
  const bx = b.toMm.x - b.fromMm.x;
  const by = b.toMm.y - b.fromMm.y;
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < PARALLEL_EPSILON) return null;
  const dx = b.fromMm.x - a.fromMm.x;
  const dy = b.fromMm.y - a.fromMm.y;
  const t = (dx * by - dy * bx) / denominator;
  const u = (dx * ay - dy * ax) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.fromMm.x + t * ax, y: a.fromMm.y + t * ay };
}
