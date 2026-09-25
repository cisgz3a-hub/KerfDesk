// Shape checks for the compact contour fit (ADR-405): does a cubic cross
// itself, and how finely must a cubic be sampled to stay within a flatness
// bound. Closed forms, own derivations. Pure core, deterministic.

import type { CubicBezier } from '../geometry/cubic-fit';

const NEAR_ZERO = 1e-12;
// Parameter slack at the ends: a crossing at an end point still counts.
const PARAMETER_SLACK = 1e-9;

/** True when the cubic crosses or touches itself (a loop or a cusp) for two
 *  parameters in [0, 1]. Written in power form B(t) = a t^3 + b t^2 + c t + d,
 *  B(s) = B(t) with s != t means a (s^2 + s t + t^2) + b (s + t) + c = 0; in
 *  sum and product (S = s + t, P = s t) that is linear once crossed with a,
 *  so S and P follow in closed form and s, t are the roots of z^2 - S z + P. */
export function cubicSelfIntersects(cubic: CubicBezier): boolean {
  const { p0, p1, p2, p3 } = cubic;
  const a = {
    x: -p0.x + 3 * p1.x - 3 * p2.x + p3.x,
    y: -p0.y + 3 * p1.y - 3 * p2.y + p3.y,
  };
  const b = { x: 3 * p0.x - 6 * p1.x + 3 * p2.x, y: 3 * p0.y - 6 * p1.y + 3 * p2.y };
  const c = { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) };
  const aa = a.x * a.x + a.y * a.y;
  const scale = Math.max(aa, b.x * b.x + b.y * b.y, c.x * c.x + c.y * c.y);
  if (scale < NEAR_ZERO || aa < NEAR_ZERO * scale) return false;
  const axb = a.x * b.y - a.y * b.x;
  if (Math.abs(axb) < NEAR_ZERO * scale) return false;
  const axc = a.x * c.y - a.y * c.x;
  const sum = -axc / axb;
  const product = sum * sum + (sum * (a.x * b.x + a.y * b.y) + (a.x * c.x + a.y * c.y)) / aa;
  const disc = sum * sum - 4 * product;
  if (disc < 0) return false;
  const root = Math.sqrt(disc);
  const s = (sum - root) / 2;
  const t = (sum + root) / 2;
  return s >= -PARAMETER_SLACK && t <= 1 + PARAMETER_SLACK;
}

/** Uniform parameter steps that keep every chord of the cubic within
 *  `flatness` px of it: a chord over a parameter step h deviates at most
 *  h^2 / 8 times the largest second derivative, which is at most six times
 *  the larger second difference of the control points. */
export function cubicFlatnessSteps(cubic: CubicBezier, flatness: number): number {
  const { p0, p1, p2, p3 } = cubic;
  const d1 = Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y);
  const d2 = Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y);
  const secondDerivative = 6 * Math.max(d1, d2);
  return Math.max(1, Math.ceil(Math.sqrt(secondDerivative / (8 * flatness))));
}
