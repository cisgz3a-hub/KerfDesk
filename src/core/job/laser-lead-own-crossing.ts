// A laser lead must not cross its own contour (ADR-626). The walking checks
// read the distance to the contour at samples 0.05 mm apart, and right by the
// join that distance is small anyway, so a lead could slip across a narrow
// tongue of the part beside the join between two samples. So the lead's path
// is also tested against the contour itself. Only a crossing within
// JOIN_NEIGHBOURHOOD_MM of the join, measured along the contour, is allowed:
// there a lead joins the contour and may ride its chords.

import type { Vec2 } from '../scene';

const JOIN_NEIGHBOURHOOD_MM = 0.2;

type RingWalk = { readonly cumulative: ReadonlyArray<number>; readonly lengthMm: number };

const walks = new WeakMap<ReadonlyArray<Vec2>, RingWalk>();

/** Whether `lead` crosses `ring` anywhere but beside the join at `at`. */
export function crossesOwnContour(
  lead: ReadonlyArray<Vec2>,
  at: Vec2,
  ring: ReadonlyArray<Vec2>,
): boolean {
  const walk = ringWalk(ring);
  const join = positionAlong(ring, walk, at);
  const box = boundsOf(lead);
  for (let edge = 1; edge < ring.length; edge += 1) {
    const a = ring[edge - 1] as Vec2;
    const b = ring[edge] as Vec2;
    if (!edgeMeetsBox(a, b, box)) continue;
    const from = walk.cumulative[edge - 1] ?? 0;
    const span = (walk.cumulative[edge] ?? 0) - from;
    for (let step = 1; step < lead.length; step += 1) {
      const along = crossingOnEdge(lead[step - 1] as Vec2, lead[step] as Vec2, a, b);
      if (along === null) continue;
      const apart = Math.abs(from + along * span - join);
      if (Math.min(apart, walk.lengthMm - apart) > JOIN_NEIGHBOURHOOD_MM) return true;
    }
  }
  return false;
}

function ringWalk(ring: ReadonlyArray<Vec2>): RingWalk {
  const known = walks.get(ring);
  if (known !== undefined) return known;
  const cumulative = [0];
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1] as Vec2;
    const b = ring[index] as Vec2;
    cumulative.push((cumulative[index - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const walk = { cumulative, lengthMm: cumulative[cumulative.length - 1] ?? 0 };
  walks.set(ring, walk);
  return walk;
}

/** How far along the ring the point nearest `point` lies. */
function positionAlong(ring: ReadonlyArray<Vec2>, walk: RingWalk, point: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  let position = 0;
  for (let edge = 1; edge < ring.length; edge += 1) {
    const a = ring[edge - 1] as Vec2;
    const b = ring[edge] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const spanSq = dx * dx + dy * dy;
    const t =
      spanSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / spanSq));
    const distanceSq = (a.x + dx * t - point.x) ** 2 + (a.y + dy * t - point.y) ** 2;
    if (distanceSq < best) {
      best = distanceSq;
      const from = walk.cumulative[edge - 1] ?? 0;
      position = from + t * ((walk.cumulative[edge] ?? 0) - from);
    }
  }
  return position;
}

/** Where along edge a-b the lead step p-q crosses it (0..1), or null. Steps
 * that run along the edge are left to the distance checks. */
function crossingOnEdge(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const determinant = rx * sy - ry * sx;
  if (determinant === 0) return null;
  const wx = a.x - p.x;
  const wy = a.y - p.y;
  const t = (wx * sy - wy * sx) / determinant;
  const u = (wx * ry - wy * rx) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null;
}

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function boundsOf(points: ReadonlyArray<Vec2>): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function edgeMeetsBox(a: Vec2, b: Vec2, box: Box): boolean {
  return (
    Math.max(a.x, b.x) >= box.minX &&
    Math.min(a.x, b.x) <= box.maxX &&
    Math.max(a.y, b.y) >= box.minY &&
    Math.min(a.y, b.y) <= box.maxY
  );
}
