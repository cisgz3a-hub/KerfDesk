// convex-hull — Andrew's monotone chain. The hull runs counter-clockwise (in
// y-up coordinates), starts at the lowest-x point and does not repeat it, and
// drops points that lie on a hull edge. Fewer than three points that are not
// all on one line give a degenerate hull of 0-2 points.

import type { Vec2 } from '../scene';

export function convexHull(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const sorted = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return uniquePoints(sorted);
  const lower = halfHull(sorted);
  const upper = halfHull([...sorted].reverse());
  // Each half ends where the other starts.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function halfHull(sorted: ReadonlyArray<Vec2>): Vec2[] {
  const hull: Vec2[] = [];
  for (const point of sorted) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if (a === undefined || b === undefined || cross(a, b, point) > 0) break;
      hull.pop();
    }
    hull.push(point);
  }
  return hull;
}

function cross(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function uniquePoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  return points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]?.x || point.y !== points[index - 1]?.y,
  );
}
