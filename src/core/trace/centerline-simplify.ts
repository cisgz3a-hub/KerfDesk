import type { Vec2 } from '../scene';

const GEOMETRY_EPS = 1e-6;

export function simplifyCenterlinePoints(points: ReadonlyArray<Vec2>, tolerance: number): Vec2[] {
  if (points.length <= 2 || tolerance <= GEOMETRY_EPS) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  simplifyRange(points, 0, points.length - 1, tolerance * tolerance, keep);
  return points.filter((_, index) => keep[index] === 1);
}

function simplifyRange(
  points: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  toleranceSq: number,
  keep: Uint8Array,
): void {
  const a = points[first];
  const b = points[last];
  if (a === undefined || b === undefined || last <= first + 1) return;
  let bestIndex = -1;
  let bestDistanceSq = 0;
  for (let i = first + 1; i < last; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    const d = distancePointToSegmentSq(p, a, b);
    if (d > bestDistanceSq) {
      bestDistanceSq = d;
      bestIndex = i;
    }
  }
  if (bestIndex === -1 || bestDistanceSq <= toleranceSq) return;
  keep[bestIndex] = 1;
  simplifyRange(points, first, bestIndex, toleranceSq, keep);
  simplifyRange(points, bestIndex, last, toleranceSq, keep);
}

function distancePointToSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= GEOMETRY_EPS) return distanceSq(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return distanceSq(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
