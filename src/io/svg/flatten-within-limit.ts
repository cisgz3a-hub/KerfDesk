// Curve flattening bounded by the importer's coordinate limit (A-07). The
// flattened point count grows with the square root of a segment's size over
// the flatness, so a coordinate far past the limit stalls the import, or
// overflows the stack, before the magnitude refusal in svg-import-budget runs.
// A segment reaching past the limit, or holding a non-finite value, is not
// flattened: its control points stand in for it, which puts the out-of-range
// coordinate in front of that refusal. Its native curve segment is kept as is.
//
// The limit is compared in user units, divided by the element's largest
// user-to-mm stretch. Translation is left out, so a curve that a transform
// moves back within the limit imports with its control points as the
// compatibility polyline, while its native curve still compiles exactly.

import type { Vec2 } from '../../core/scene';
import {
  arcToCubics,
  flattenArc,
  flattenCubic,
  flattenQuadratic,
  type ArcParams,
} from './flatten-curves';
import { SVG_IMPORT_LIMITS } from './svg-import-budget';

export type FlattenBounds = {
  /** Chord tolerance, in user units. */
  readonly flatness: number;
  /** The importer's coordinate limit, in user units. */
  readonly limit: number;
};

/** The importer's coordinate limit in user units for a largest user-to-mm stretch of `scale`. */
export function coordinateLimitUserUnits(scale: number): number {
  const stretch = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return SVG_IMPORT_LIMITS.coordinateMagnitudeMm / stretch;
}

export function flattenCubicWithin(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p3: Vec2,
  bounds: FlattenBounds,
  out: Vec2[],
): void {
  if (withinLimit([p0, c1, c2, p3], bounds.limit)) {
    flattenCubic(p0, c1, c2, p3, bounds.flatness, out);
  } else {
    out.push(c1, c2, p3);
  }
}

export function flattenQuadraticWithin(
  p0: Vec2,
  control: Vec2,
  p2: Vec2,
  bounds: FlattenBounds,
  out: Vec2[],
): void {
  if (withinLimit([p0, control, p2], bounds.limit)) {
    flattenQuadratic(p0, control, p2, bounds.flatness, out);
  } else {
    out.push(control, p2);
  }
}

// An arc's reach is set by its radii rather than its end points, so its
// control points come from the same arc-to-cubic conversion that flattens it.
export function flattenArcWithin(
  start: Vec2,
  end: Vec2,
  arc: ArcParams,
  bounds: FlattenBounds,
  out: Vec2[],
): void {
  const hull = arcControlPoints(start, end, arc);
  if (withinLimit([start, ...hull], bounds.limit)) {
    flattenArc(start, end, arc, bounds.flatness, out);
  } else {
    for (const point of hull) out.push(point);
  }
}

function arcControlPoints(start: Vec2, end: Vec2, arc: ArcParams): ReadonlyArray<Vec2> {
  const rx = Math.abs(arc.rx);
  const ry = Math.abs(arc.ry);
  if (rx === 0 || ry === 0 || (start.x === end.x && start.y === end.y)) return [end];
  return arcToCubics(start, end, rx, ry, arc).flatMap((cubic) => [cubic.p1, cubic.p2, cubic.p3]);
}

// False for NaN and infinities as well as for magnitudes past the limit.
function withinLimit(points: ReadonlyArray<Vec2>, limit: number): boolean {
  return points.every((point) => Math.abs(point.x) <= limit && Math.abs(point.y) <= limit);
}
