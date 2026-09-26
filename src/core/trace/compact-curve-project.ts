// Allocation-free projection passes for the compact contour fit's spans
// (ADR-405, speed amendment). The arithmetic is exactly the centreline fit's
// two-way error (centerline/curve-fit-error.ts: orthogonalError and
// reverseError, with evaluateCubic, distance and pointToSegment inlined in the
// same operation order), so every value keeps its bits. Two things differ:
// parameters go into a caller's reusable buffer instead of a fresh array, and
// a pass stops as soon as its running maximum crosses a bound the caller
// passes, when the rest of the pass can no longer change the caller's
// decision. Pure core, deterministic.

import { newtonProjectionStep, type CubicBezier } from '../geometry/cubic-fit';
import { hypot2 } from '../geometry/fast-hypot';
import type { Vec2 } from '../scene';

const PROJECTION_NEWTON_STEPS = 4;
const REVERSE_CHECK_STEP_PX = 0.5;
const REVERSE_WINDOW_BEHIND = 4;
const REVERSE_WINDOW_AHEAD = 12;
const NEAR_SEGMENT_SQ = 1e-18;

export type PassError = {
  /** Max distance found (the full pass's max unless `stopped`). */
  error: number;
  /** Span index of that distance. */
  index: number;
  /** True when the pass stopped early at its bound. */
  stopped: boolean;
};

/** Point-to-curve distance of every interior span point, each parameter
 *  refined by clamped Newton projection from `u[i]` into `out[i]` (the ends
 *  are copied). Stops once the running maximum is above `stopAbove`, or at or
 *  above it when `inclusive`. */
export function projectSpan(
  span: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  u: ArrayLike<number>,
  out: Float64Array,
  stopAbove: number,
  inclusive: boolean,
): PassError {
  const last = span.length - 1;
  out[0] = u[0] as number;
  out[last] = u[last] as number;
  const { p0, p1, p2, p3 } = cubic;
  let error = 0;
  let index = span.length >> 1;
  for (let i = 1; i < last; i += 1) {
    const p = span[i] as Vec2;
    let t = u[i] as number;
    for (let step = 0; step < PROJECTION_NEWTON_STEPS; step += 1) {
      const raw = newtonProjectionStep(cubic, p, t);
      if (raw === null) break;
      const next = Math.min(1, Math.max(0, raw));
      if (Math.abs(next - t) < 1e-9) {
        t = next;
        break;
      }
      t = next;
    }
    out[i] = t;
    const m = 1 - t;
    const b0 = m * m * m;
    const b1 = 3 * t * m * m;
    const b2 = 3 * t * t * m;
    const b3 = t * t * t;
    const qx = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x;
    const qy = b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y;
    const d = hypot2(p.x - qx, p.y - qy);
    if (d > error) {
      error = d;
      index = i;
      if (error > stopAbove || (inclusive && error >= stopAbove)) {
        return { error, index, stopped: true };
      }
    }
  }
  return { error, index, stopped: false };
}

/** Distance from samples of the curve back to the span polyline (sliding
 *  window of span segments). The index is the span point whose parameter in
 *  `params` is nearest the worst sample. Stops once the running maximum is
 *  above `stopAbove` (index then meaningless). */
export function reverseSpan(
  span: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  params: ArrayLike<number>,
  stopAbove: number,
): PassError {
  const { p0, p1, p2, p3 } = cubic;
  const polygon =
    hypot2(p1.x - p0.x, p1.y - p0.y) +
    hypot2(p2.x - p1.x, p2.y - p1.y) +
    hypot2(p3.x - p2.x, p3.y - p2.y);
  const samples = Math.max(4, Math.ceil(polygon / REVERSE_CHECK_STEP_PX));
  let segment = 0;
  let error = 0;
  let worstT = 0.5;
  for (let s = 1; s < samples; s += 1) {
    const t = s / samples;
    const m = 1 - t;
    const b0 = m * m * m;
    const b1 = 3 * t * m * m;
    const b2 = 3 * t * t * m;
    const b3 = t * t * t;
    const qx = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x;
    const qy = b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y;
    const lo = Math.max(0, segment - REVERSE_WINDOW_BEHIND);
    const hi = Math.min(span.length - 2, segment + REVERSE_WINDOW_AHEAD);
    let best = Infinity;
    for (let k = lo; k <= hi; k += 1) {
      const d = segmentDistance(qx, qy, span[k] as Vec2, span[k + 1] as Vec2);
      if (d < best) {
        best = d;
        segment = k;
      }
    }
    if (best > error) {
      error = best;
      worstT = t;
      if (error > stopAbove) return { error, index: 0, stopped: true };
    }
  }
  return { error, index: nearestParamIndex(params, span.length, worstT), stopped: false };
}

function segmentDistance(px: number, py: number, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < NEAR_SEGMENT_SQ) return hypot2(a.x - px, a.y - py);
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / lenSq));
  return hypot2(px - (a.x + t * vx), py - (a.y + t * vy));
}

function nearestParamIndex(params: ArrayLike<number>, length: number, t: number): number {
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < length; i += 1) {
    const gap = Math.abs((params[i] as number) - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}
