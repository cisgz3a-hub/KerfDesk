// Distance-along-path helpers shared by perforation and overcut (ADR-415).
// A walk is the sequence of points the head follows: a closed contour always
// returns to its start, whether or not the source repeated the first point.

import type { Polyline, Vec2 } from '../scene';

export type PathWalk = {
  readonly points: ReadonlyArray<Vec2>;
  /** cumulative[i] is the distance from points[0] to points[i]. */
  readonly cumulative: ReadonlyArray<number>;
  readonly lengthMm: number;
};

const EPS = 1e-9;

/** Null when the path has no length to walk. */
export function pathWalk(polyline: Polyline): PathWalk | null {
  const points = walkPoints(polyline);
  if (points.length < 2) return null;
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    cumulative.push((cumulative[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const lengthMm = cumulative[cumulative.length - 1] ?? 0;
  return lengthMm > EPS ? { points, cumulative, lengthMm } : null;
}

/** The point `distanceMm` along the walk, clamped to its ends. */
export function pointAtDistance(walk: PathWalk, distanceMm: number): Vec2 {
  const { points, cumulative } = walk;
  // First edge whose end reaches the distance (binary search: long paths are
  // sampled once per dash).
  let low = 1;
  let high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((cumulative[mid] ?? 0) < distanceMm) low = mid + 1;
    else high = mid;
  }
  const a = points[low - 1] as Vec2;
  const b = points[low] as Vec2;
  const edgeStart = cumulative[low - 1] ?? 0;
  const edge = (cumulative[low] ?? 0) - edgeStart;
  const t = edge <= EPS ? 0 : Math.max(0, Math.min(1, (distanceMm - edgeStart) / edge));
  return { x: clean(a.x + (b.x - a.x) * t), y: clean(a.y + (b.y - a.y) * t) };
}

export function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function walkPoints(polyline: Polyline): ReadonlyArray<Vec2> {
  const points = polyline.points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!polyline.closed || first === undefined || last === undefined) return points;
  return samePoint(first, last) ? points : [...points, first];
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
