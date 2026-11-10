import type { Vec2 } from './scene-object';
import { distance } from '../geometry/point-math';

export function simplifyClosedRing(points: ReadonlyArray<Vec2>, tolerance: number): Vec2[] {
  const [first, second] = farthestPair(points);
  const forward = ringPath(points, first, second);
  const backward = ringPath(points, second, first);
  return [...simplifyOpen(forward, tolerance), ...simplifyOpen(backward, tolerance).slice(1, -1)];
}

function farthestPair(points: ReadonlyArray<Vec2>): readonly [number, number] {
  let result: readonly [number, number] = [0, 1];
  let farthest = -1;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const candidate = distance(points[left] as Vec2, points[right] as Vec2);
      if (candidate > farthest) {
        farthest = candidate;
        result = [left, right];
      }
    }
  }
  return result;
}

function ringPath(points: ReadonlyArray<Vec2>, start: number, end: number): Vec2[] {
  const result: Vec2[] = [];
  for (let index = start; ; index = (index + 1) % points.length) {
    result.push(points[index] as Vec2);
    if (index === end) return result;
  }
}

function simplifyOpen(points: ReadonlyArray<Vec2>, tolerance: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  let farthest = 0;
  let at = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const candidate = segmentDistance(
      points[index] as Vec2,
      points[0] as Vec2,
      points.at(-1) as Vec2,
    );
    if (candidate > farthest) {
      farthest = candidate;
      at = index;
    }
  }
  if (farthest <= tolerance) return [points[0] as Vec2, points.at(-1) as Vec2];
  return [
    ...simplifyOpen(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(at), tolerance),
  ];
}

function segmentDistance(point: Vec2, a: Vec2, b: Vec2): number {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const ratio =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared,
          ),
        );
  return distance(point, { x: a.x + ratio * (b.x - a.x), y: a.y + ratio * (b.y - a.y) });
}
