// Andrew's monotone chain. Returns the hull without collinear or repeated
// points, counter-clockwise in y-up terms (clockwise on KerfDesk's y-down
// canvas); fewer than three distinct points come back as they are.

import type { Vec2 } from '../scene';

export function convexHull(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower = halfHull(sorted);
  const upper = halfHull([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function halfHull(sorted: ReadonlyArray<Vec2>): Vec2[] {
  const hull: Vec2[] = [];
  for (const point of sorted) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }
  return hull;
}

function cross(o: Vec2 | undefined, a: Vec2 | undefined, b: Vec2): number {
  if (o === undefined || a === undefined) return 0;
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
