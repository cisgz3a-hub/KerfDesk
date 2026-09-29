// Which holes a layer's kerf offset closed up entirely (ADR-486 amendment 1).
//
// Kerf Offset grows every part and shrinks every hole by the offset, the other
// way round when the offset is negative. A hole or slot narrower than twice the
// offset has no inside left after that, so the offset engine returns nothing
// for it and the cut is missing from the job. The engine did not fail, so
// nothing was reported.
//
// An offset contour stays the offset's width away from every source contour
// and never touches one, so it lies inside exactly one region of the source
// layout: the one bounded by the deepest source contour around it and that
// contour's own children. A shrinking contour whose region holds no offset
// contour has closed up. It does not matter whether that offset contour came
// from the hole's own edge or from an island inside it that grew, so a narrow
// channel around an island that closes counts too.

import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import { polylineBounds, type SegmentBounds } from './segment-bounds';

// Below the offset engine's 1 µm grid an offset contour can land on its source
// contour, where a probe cannot tell inside from outside.
const MIN_CHECKED_OFFSET_MM = 0.001;

/** Whether a closed contour enclosed by `depth` others on its layer shrinks under the offset. */
export function kerfShrinksContour(depth: number, kerfOffsetMm: number): boolean {
  if (!Number.isFinite(kerfOffsetMm) || Math.abs(kerfOffsetMm) < MIN_CHECKED_OFFSET_MM) {
    return false;
  }
  return (depth % 2 === 1) === kerfOffsetMm > 0;
}

/**
 * How many shrinking source contours have no offset contour inside their
 * region. Along any chain of nested source contours, `depths` must grow inward.
 */
export function countClosedUpRegions(
  sources: ReadonlyArray<Polyline>,
  depths: ReadonlyArray<number>,
  shrinking: ReadonlyArray<boolean>,
  offset: ReadonlyArray<Polyline>,
): number {
  if (!shrinking.includes(true)) return 0;
  const bounds = sources.map((ring) => polylineBounds(ring.points));
  const occupied = new Set<number>();
  for (const ring of offset) {
    const probe = ring.points[0];
    if (probe === undefined) continue;
    const region = deepestSourceAround(probe, sources, bounds, depths);
    if (region !== null) occupied.add(region);
  }
  return shrinking.filter((shrinks, index) => shrinks && !occupied.has(index)).length;
}

function deepestSourceAround(
  probe: Vec2,
  sources: ReadonlyArray<Polyline>,
  bounds: ReadonlyArray<SegmentBounds | null>,
  depths: ReadonlyArray<number>,
): number | null {
  let deepest: number | null = null;
  for (const [index, ring] of sources.entries()) {
    const box = bounds[index];
    if (box == null || !boxHolds(box, probe)) continue;
    if (deepest !== null && (depths[index] ?? 0) <= (depths[deepest] ?? 0)) continue;
    if (pointInPolygon(probe, ring.points)) deepest = index;
  }
  return deepest;
}

function boxHolds(box: SegmentBounds, point: Vec2): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}
