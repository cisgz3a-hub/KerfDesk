// snap-intersections — where visible outlines cross, near the pointer
// (LightBurn gap LBG-F06).
//
// The crossing maths is the Design Studio's (ADR-272): a proper segment-segment
// crossing with both parameters inside [0, 1], so where two lines WOULD meet if
// extended is never offered. This module decides which pairs to test.
//
// Cost is bounded twice. Only segments passing within reach of the pointer can
// hold a crossing within reach, and the caller finds those through each path's
// spatial index; then at most MAX_NEAR_SEGMENTS of them — the nearest — are
// paired, so even a pointer parked on the densest part of a photo trace tests
// a fixed number of pairs.
//
// Neighbouring segments of one subpath touch at their shared node; that touch
// is a node, not a crossing, and is skipped. Any other pair counts, including
// two subpaths of one object and a figure-eight crossing itself.

import type { Vec2 } from '../../../core/scene';
import { segmentCrossing } from '../../../core/design/snap/snap-intersections';

export const MAX_NEAR_SEGMENTS = 256;

export type WorldSegment = {
  readonly fromMm: Vec2;
  readonly toMm: Vec2;
  // Owner identity, as `${objectId}` for the crossing's target and the full
  // key for the adjacency rule.
  readonly entityId: string;
  readonly subpathKey: string;
};

export type SnapCrossing = {
  readonly pointMm: Vec2;
  readonly distanceMm: number;
  readonly objectId: string;
};

export function nearestCrossing(
  segments: ReadonlyArray<WorldSegment>,
  pointMm: Vec2,
  radiusMm: number,
): SnapCrossing | null {
  const near = nearestSegments(segments, pointMm, radiusMm);
  let best: SnapCrossing | null = null;
  for (let i = 0; i < near.length; i += 1) {
    for (let j = i + 1; j < near.length; j += 1) {
      const a = near[i];
      const b = near[j];
      if (a === undefined || b === undefined || areNeighbours(a, b)) continue;
      const at = segmentCrossing(a, b);
      if (at === null) continue;
      const distanceMm = Math.hypot(at.x - pointMm.x, at.y - pointMm.y);
      if (distanceMm > radiusMm || (best !== null && distanceMm >= best.distanceMm)) continue;
      best = { pointMm: at, distanceMm, objectId: a.entityId };
    }
  }
  return best;
}

function nearestSegments(
  segments: ReadonlyArray<WorldSegment>,
  pointMm: Vec2,
  radiusMm: number,
): ReadonlyArray<WorldSegment> {
  const reaching = segments
    .map((segment) => ({ segment, distance: distanceToSegment(pointMm, segment) }))
    .filter((entry) => entry.distance <= radiusMm);
  if (reaching.length > MAX_NEAR_SEGMENTS) {
    reaching.sort((a, b) => a.distance - b.distance);
    reaching.length = MAX_NEAR_SEGMENTS;
  }
  return reaching.map((entry) => entry.segment);
}

function areNeighbours(a: WorldSegment, b: WorldSegment): boolean {
  if (a.subpathKey !== b.subpathKey) return false;
  return (
    samePoint(a.fromMm, b.fromMm) ||
    samePoint(a.fromMm, b.toMm) ||
    samePoint(a.toMm, b.fromMm) ||
    samePoint(a.toMm, b.toMm)
  );
}

export function distanceToSegment(point: Vec2, segment: WorldSegment): number {
  const dx = segment.toMm.x - segment.fromMm.x;
  const dy = segment.toMm.y - segment.fromMm.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(
            0,
            ((point.x - segment.fromMm.x) * dx + (point.y - segment.fromMm.y) * dy) / lengthSquared,
          ),
        );
  return Math.hypot(segment.fromMm.x + t * dx - point.x, segment.fromMm.y + t * dy - point.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}
