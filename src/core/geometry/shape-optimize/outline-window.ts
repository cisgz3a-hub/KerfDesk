// Directions of an outline over a stretch of its length, for Optimize Shapes
// (LBG-T22): the best-fit line through the points near a vertex averages out
// jitter finer than the stretch, where the neighbouring points alone would
// give the jitter's own direction.
//
// A window walks from the vertex along the outline for a given distance,
// taking every point it passes and the interpolated point where it ends. The
// points are summed as they are walked (relative to the vertex, so far-off
// coordinates lose no precision) and never stored.

import type { Vec2 } from '../../scene/scene-object';

export type OutlineWindow = {
  readonly points: ReadonlyArray<Vec2>;
  /** The points wrap round: the last is followed by the first (which is not repeated). */
  readonly closed: boolean;
};

type Sums = { n: number; sx: number; sy: number; sxx: number; syy: number; sxy: number };

/**
 * The best-fit direction of the outline over `distance` behind the vertex
 * (`step` -1) or ahead of it (1), pointing along the outline's travel. Past an
 * open end the walk stops there when `truncate` is set, and gives null
 * otherwise. A walk stops after `maxPoints` points, short of the distance.
 */
export function windowDirection(
  outline: OutlineWindow,
  index: number,
  step: -1 | 1,
  distance: number,
  truncate: boolean,
  maxPoints: number,
): Vec2 | null {
  const sums: Sums = { n: 1, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
  const far = walk(outline, index, step, distance, truncate, maxPoints, sums);
  if (far === null) return null;
  const direction = principal(sums, far);
  return step === 1 ? direction : { x: -direction.x, y: -direction.y };
}

/**
 * The best-fit direction over `distance` each side of the vertex, pointing
 * along the outline's travel; an open end cuts its side short.
 */
export function spanDirection(
  outline: OutlineWindow,
  index: number,
  distance: number,
  maxPoints: number,
): Vec2 {
  const sums: Sums = { n: 1, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 };
  const behind = walk(outline, index, -1, distance, true, maxPoints, sums) ?? { x: 0, y: 0 };
  const ahead = walk(outline, index, 1, distance, true, maxPoints, sums) ?? { x: 0, y: 0 };
  return principal(sums, { x: ahead.x - behind.x, y: ahead.y - behind.y });
}

// Adds the walked points to `sums` (relative to the vertex) and gives the
// last one, relative to the vertex; null past an open end unless truncating.
function walk(
  outline: OutlineWindow,
  index: number,
  step: -1 | 1,
  distance: number,
  truncate: boolean,
  maxPoints: number,
  sums: Sums,
): Vec2 | null {
  const { points, closed } = outline;
  const n = points.length;
  const origin = points[index] as Vec2;
  const steps = Math.min(n, maxPoints + 1);
  let cx = 0;
  let cy = 0;
  let remaining = distance;
  for (let count = 1; count < steps; count += 1) {
    const raw = index + step * count;
    if (!closed && (raw < 0 || raw >= n)) {
      if (truncate) break;
      return null;
    }
    const next = points[((raw % n) + n) % n] as Vec2;
    const nx = next.x - origin.x;
    const ny = next.y - origin.y;
    const length = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
    if (length >= remaining) {
      const t = remaining / length;
      add(sums, cx + (nx - cx) * t, cy + (ny - cy) * t);
      return { x: cx + (nx - cx) * t, y: cy + (ny - cy) * t };
    }
    remaining -= length;
    cx = nx;
    cy = ny;
    add(sums, cx, cy);
  }
  return { x: cx, y: cy };
}

function add(sums: Sums, x: number, y: number): void {
  sums.n += 1;
  sums.sx += x;
  sums.sy += y;
  sums.sxx += x * x;
  sums.syy += y * y;
  sums.sxy += x * y;
}

// The major axis of the summed points' spread, pointing along `along`.
function principal(sums: Sums, along: Vec2): Vec2 {
  const mx = sums.sx / sums.n;
  const my = sums.sy / sums.n;
  const sxx = sums.sxx - sums.n * mx * mx;
  const syy = sums.syy - sums.n * my * my;
  const sxy = sums.sxy - sums.n * mx * my;
  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  return along.x * direction.x + along.y * direction.y >= 0
    ? direction
    : { x: -direction.x, y: -direction.y };
}
