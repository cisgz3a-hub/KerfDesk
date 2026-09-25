// Small cubic and polyline geometry for the centreline curve fit (ADR-397).

import type { Vec2 } from '../../scene';

export type Cubic = { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2 };

// Arc length over which a tangent is estimated. Two faired pixels average
// the residual lattice noise without lagging far behind real curvature (a
// parabola estimate is used, so the lag is second-order in the window).
const TANGENT_WINDOW_PX = 2;

// Tangent at a run end from a parabola through the end and the points half
// and one window along the run: -3p0 + 4p1 - p2 is its end derivative, exact
// for a quadratic and far less lagged than a chord on a curving stroke. The
// start tangent points forward; the end tangent points back into the run.
export function oneSidedTangent(run: ReadonlyArray<Vec2>, side: 'start' | 'end'): Vec2 {
  const ordered = side === 'start' ? run : [...run].reverse();
  const length = pathLength(ordered);
  const window = Math.min(TANGENT_WINDOW_PX, length / 2);
  const p0 = ordered[0] as Vec2;
  const p1 = pointAlong(ordered, window / 2);
  const p2 = pointAlong(ordered, window);
  const parabola = {
    x: -3 * p0.x + 4 * p1.x - p2.x,
    y: -3 * p0.y + 4 * p1.y - p2.y,
  };
  return normalizeOr(parabola, subtract(ordered[1] as Vec2, p0));
}

// Forward tangent at chain index i from the points one window behind and one
// window ahead (wrapping on a ring, clamped at an open end).
export function centredTangent(points: ReadonlyArray<Vec2>, wraps: boolean, i: number): Vec2 {
  const ahead = walk(points, wraps, i, 1, TANGENT_WINDOW_PX);
  const behind = walk(points, wraps, i, -1, TANGENT_WINDOW_PX);
  const at = points[i] as Vec2;
  return normalizeOr(subtract(ahead, behind), subtract(ahead, at));
}

export function walk(
  points: ReadonlyArray<Vec2>,
  wraps: boolean,
  from: number,
  direction: 1 | -1,
  arc: number,
): Vec2 {
  const n = points.length;
  let remaining = arc;
  let i = from;
  for (let step = 0; step < n; step += 1) {
    const j = i + direction;
    if (!wraps && (j < 0 || j >= n)) return points[i] as Vec2;
    const a = points[(i + n) % n] as Vec2;
    const b = points[(j + n) % n] as Vec2;
    const seg = distance(a, b);
    if (seg >= remaining && seg > 0) return lerp(a, b, remaining / seg);
    remaining -= seg;
    i = (j + n) % n;
  }
  return points[i] as Vec2;
}

export function pointAlong(points: ReadonlyArray<Vec2>, arc: number): Vec2 {
  return walk(points, false, 0, 1, arc);
}

export function evaluate(c: Cubic, t: number): Vec2 {
  const m = 1 - t;
  const b0 = m * m * m;
  const b1 = 3 * t * m * m;
  const b2 = 3 * t * t * m;
  const b3 = t * t * t;
  return {
    x: b0 * c.p0.x + b1 * c.p1.x + b2 * c.p2.x + b3 * c.p3.x,
    y: b0 * c.p0.y + b1 * c.p1.y + b2 * c.p2.y + b3 * c.p3.y,
  };
}

export function derivative(c: Cubic, t: number): Vec2 {
  const m = 1 - t;
  return {
    x:
      3 * m * m * (c.p1.x - c.p0.x) + 6 * m * t * (c.p2.x - c.p1.x) + 3 * t * t * (c.p3.x - c.p2.x),
    y:
      3 * m * m * (c.p1.y - c.p0.y) + 6 * m * t * (c.p2.y - c.p1.y) + 3 * t * t * (c.p3.y - c.p2.y),
  };
}

export function secondDerivative(c: Cubic, t: number): Vec2 {
  const m = 1 - t;
  return {
    x: 6 * m * (c.p2.x - 2 * c.p1.x + c.p0.x) + 6 * t * (c.p3.x - 2 * c.p2.x + c.p1.x),
    y: 6 * m * (c.p2.y - 2 * c.p1.y + c.p0.y) + 6 * t * (c.p3.y - 2 * c.p2.y + c.p1.y),
  };
}

export function controlLength(c: Cubic): number {
  return distance(c.p0, c.p1) + distance(c.p1, c.p2) + distance(c.p2, c.p3);
}

export function pathLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1] as Vec2, points[i] as Vec2);
  }
  return total;
}

export function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < 1e-18) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function normalizeOr(v: Vec2, fallback: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len > 1e-12) return { x: v.x / len, y: v.y / len };
  const fl = Math.hypot(fallback.x, fallback.y);
  return fl > 1e-12 ? { x: fallback.x / fl, y: fallback.y / fl } : { x: 1, y: 0 };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, y: v.y * factor };
}

export function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
