// Where a closed Line cut begins and which way it runs (ADR-385).
//
// LightBurn's Optimization Settings offer "Choose best starting point" (start
// a closed shape at any of its points, not just the first), "Choose corners,
// if possible" and "Choose best direction"
// (https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/).
// KerfDesk keeps all three opt-in per job, so a project that never ticks them
// emits the drawn start and direction byte for byte. Differences, on purpose:
//
//   * Prefer corners also works on its own: the start moves to the corner
//     nearest the drawn start, so a designer's rough start survives while
//     the mark lands where the edge already turns.
//   * A start the operator set by hand (Set Start Point) is never moved or
//     reversed by these automatic choices. LightBurn lets best start override
//     a user start when that saves time; here the explicit choice wins.
//   * Candidates are existing vertices only. No vertex is added, so the cut
//     geometry, kerf offset and tab gaps stay exactly as compiled.

import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import {
  closedLoopRing,
  cornerVertexIndices,
  firstEdgeDirection,
  reverseClosedPolyline,
  rotateClosedPolyline,
  unit,
} from './closed-cut-loop';
import type { CutSegment } from './job';
import type { SegmentEntry } from './segment-entry-index';

export type ClosedCutStartSettings = Partial<
  Pick<ProjectOptimizationSettings, 'bestStartPoint' | 'preferCorners' | 'bestDirection'>
>;

export type ClosedCutStartPolicy = {
  readonly bestStartPoint: boolean;
  readonly preferCorners: boolean;
  readonly bestDirection: boolean;
};

// Reversal must win by more than rounding noise; an exact tie keeps the
// drawn direction.
const DIRECTION_EPS = 1e-9;

/** Null when every closed-cut choice is off: the optimizer then runs its legacy path. */
export function closedCutStartPolicy(
  settings: ClosedCutStartSettings,
): ClosedCutStartPolicy | null {
  const policy = {
    bestStartPoint: settings.bestStartPoint === true,
    preferCorners: settings.preferCorners === true,
    bestDirection: settings.bestDirection === true,
  };
  return policy.bestStartPoint || policy.preferCorners || policy.bestDirection ? policy : null;
}

/** Automatic choices apply to unlocked closed loops with at least three ring vertices. */
export function hasMovableStart(segment: CutSegment): boolean {
  return (
    segment.closed && segment.startLocked !== true && closedLoopRing(segment.polyline).length >= 3
  );
}

/**
 * Ring vertices this segment may be entered at, ascending. Best start offers
 * every vertex (or only the corners when Prefer corners is on and the shape
 * has any); Prefer corners alone offers the corner nearest the drawn start.
 */
export function closedEntryVertices(
  segment: CutSegment,
  policy: ClosedCutStartPolicy,
): ReadonlyArray<number> {
  if (!hasMovableStart(segment) || (!policy.bestStartPoint && !policy.preferCorners)) return [0];
  const ring = closedLoopRing(segment.polyline);
  const corners = policy.preferCorners ? cornerVertexIndices(ring) : [];
  if (policy.bestStartPoint) {
    return corners.length > 0 ? corners : ring.map((_, index) => index);
  }
  const drawnStart = ring[0] as Vec2;
  return corners.length === 0 ? [0] : [nearestVertex(ring, corners, drawnStart)];
}

/** Nearest-neighbour entries for one closed segment, one per candidate vertex. */
export function closedSegmentEntries(
  segment: CutSegment,
  segmentIndex: number,
  policy: ClosedCutStartPolicy,
): ReadonlyArray<SegmentEntry> {
  const ring = closedLoopRing(segment.polyline);
  return closedEntryVertices(segment, policy).map((vertexIndex) => ({
    point: ring[vertexIndex] as Vec2,
    segmentIndex,
    reverse: false,
    vertexIndex,
  }));
}

/**
 * The segment entered at ring vertex `vertexIndex`, reversed when Choose best
 * direction is on and the reversed first edge continues the approach from
 * `from` more directly. Unchanged segments keep their identity.
 */
export function enterClosedSegment<T extends CutSegment>(
  segment: T,
  vertexIndex: number,
  from: Vec2 | null,
  policy: ClosedCutStartPolicy,
): T {
  if (!hasMovableStart(segment)) return segment;
  let polyline = rotateClosedPolyline(segment.polyline, vertexIndex);
  if (policy.bestDirection && from !== null && reversalTurnsLess(polyline, from)) {
    polyline = reverseClosedPolyline(polyline);
  }
  return polyline === segment.polyline ? segment : { ...segment, polyline };
}

/**
 * Keep-source-order variant: the visiting order is the operator's, only each
 * closed segment's entry (and, when asked, direction) follows the head.
 */
export function sequentialClosedCutStarts<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  startCursor: Vec2,
  policy: ClosedCutStartPolicy,
): T[] {
  const out: T[] = [];
  let cursor = startCursor;
  for (const segment of segments) {
    const vertexIndex = hasMovableStart(segment) ? nearestCandidate(segment, policy, cursor) : 0;
    const placed = enterClosedSegment(segment, vertexIndex, cursor, policy);
    out.push(placed);
    const last = placed.polyline[placed.polyline.length - 1];
    if (last !== undefined) cursor = last;
  }
  return out;
}

function nearestCandidate(segment: CutSegment, policy: ClosedCutStartPolicy, cursor: Vec2): number {
  const ring = closedLoopRing(segment.polyline);
  return nearestVertex(ring, closedEntryVertices(segment, policy), cursor);
}

// Lowest ring index wins an exact distance tie, matching the entry index's
// vertexIndex tie-break so both planners agree on the same input.
function nearestVertex(
  ring: ReadonlyArray<Vec2>,
  candidates: ReadonlyArray<number>,
  target: Vec2,
): number {
  let best = candidates[0] ?? 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const point = ring[index];
    if (point === undefined) continue;
    const distSq = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (distSq < bestDistSq) {
      best = index;
      bestDistSq = distSq;
    }
  }
  return best;
}

// "Most efficient" for a closed loop, whose travel cost is the same either
// way round: the direction whose first edge bends least from the approach
// travel, so the head carries speed into the cut instead of stopping to turn
// on the start mark. A head already on the start keeps the drawn direction.
function reversalTurnsLess(polyline: ReadonlyArray<Vec2>, from: Vec2): boolean {
  const ring = closedLoopRing(polyline);
  const start = ring[0];
  if (start === undefined) return false;
  const approach = unit({ x: start.x - from.x, y: start.y - from.y });
  const forward = firstEdgeDirection(ring, 1);
  const backward = firstEdgeDirection(ring, -1);
  if (approach === null || forward === null || backward === null) return false;
  const forwardAlignment = approach.x * forward.x + approach.y * forward.y;
  const backwardAlignment = approach.x * backward.x + approach.y * backward.y;
  return backwardAlignment > forwardAlignment + DIRECTION_EPS;
}
