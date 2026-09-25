// One span of the compact contour fit (ADR-405): the best single cubic (and,
// when the span is straight, the single line) between two fixed joints, with
// its ORTHOGONAL error. The error of a span never depends on the tolerance it
// is later judged against, which is what makes the merge's segment count
// monotone in Optimize (compact-curve-fit.ts).
//
// The least-squares core (the 2x2 normal equations for the two arm lengths
// along fixed end tangents, P. J. Schneider, Graphics Gems 1990) and the
// Newton point-to-curve projection are the shared ones in
// core/geometry/cubic-fit.ts; the two-way orthogonal error is the centreline
// fit's (centerline/curve-fit-error.ts). Pure core, deterministic.

import { chordParameterize, solveTangentArms, type CubicBezier } from '../geometry/cubic-fit';
import type { Vec2 } from '../scene';
import { orthogonalError, reverseError } from './centerline/curve-fit-error';

// Newton reparameterization passes per span; a pass that does not lower the
// error ends the refinement (a tolerance-free rule).
const MAX_REPARAM_PASSES = 4;
const MIN_PASS_GAIN_PX = 1e-4;
// Arms outside this multiple of the chord make loops, never outlines; they
// fall back to the chord/3 arms.
const MIN_ARM_CHORD_RATIO = 1e-3;
const MAX_ARM_CHORD_RATIO = 2;
const NEAR_ZERO = 1e-12;

export type SpanFit = {
  readonly cubic: CubicBezier;
  /** Max of point-to-curve and curve-to-chain distance, px. */
  readonly cubicError: number;
  /** Max distance of the span from its chord, px. */
  readonly lineError: number;
  /** Span index where the cubic misses worst (split candidate). */
  readonly worstIndex: number;
};

/** Fit one cubic through `span` with its end tangents fixed (`tEnd` points
 *  back from the last point into the curve), and measure the straight chord
 *  too. */
export function fitSpan(span: ReadonlyArray<Vec2>, tStart: Vec2, tEnd: Vec2): SpanFit {
  let u = chordParameterize(span, 0, span.length - 1);
  let best: { cubic: CubicBezier; error: number; index: number; params: number[] } | null = null;
  for (let pass = 0; pass <= MAX_REPARAM_PASSES; pass += 1) {
    const cubic = armCubic(span, u, tStart, tEnd);
    const projected = orthogonalError(span, cubic, u);
    const improved = best === null || projected.error < best.error - MIN_PASS_GAIN_PX;
    if (best === null || projected.error < best.error) {
      best = { cubic, error: projected.error, index: projected.index, params: projected.params };
    }
    if (!improved || span.length <= 2) break;
    u = projected.params;
  }
  // The curve-to-chain check runs once, on the pass kept: it rejects a loop
  // or bulge that slips between the data points.
  const fit = best as { cubic: CubicBezier; error: number; index: number; params: number[] };
  const reverse = reverseError(span, fit.cubic, fit.params);
  return {
    cubic: fit.cubic,
    cubicError: Math.max(fit.error, reverse.error),
    lineError: chordDeviation(span),
    worstIndex: fit.error >= reverse.error ? fit.index : reverse.index,
  };
}

// Schneider's arm lengths along the fixed tangents, with the loop and
// degeneracy guard.
function armCubic(
  span: ReadonlyArray<Vec2>,
  u: ReadonlyArray<number>,
  t1: Vec2,
  t2: Vec2,
): CubicBezier {
  const p0 = span[0] as Vec2;
  const p3 = span.at(-1) as Vec2;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const arms = solveTangentArms(span, 0, span.length - 1, u, t1, t2);
  let a = arms.start;
  let b = arms.end;
  const lo = MIN_ARM_CHORD_RATIO * chord;
  const hi = MAX_ARM_CHORD_RATIO * chord;
  if (!(a > lo && b > lo && a < hi && b < hi)) {
    a = chord / 3;
    b = chord / 3;
  }
  return {
    p0,
    p1: { x: p0.x + t1.x * a, y: p0.y + t1.y * a },
    p2: { x: p3.x + t2.x * b, y: p3.y + t2.y * b },
    p3,
  };
}

function chordDeviation(span: ReadonlyArray<Vec2>): number {
  const a = span[0] as Vec2;
  const b = span.at(-1) as Vec2;
  let worst = 0;
  for (let i = 1; i < span.length - 1; i += 1) {
    worst = Math.max(worst, pointToSegment(span[i] as Vec2, a, b));
  }
  return worst;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  if (lenSq < NEAR_ZERO) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// ——— tangents on a ring ———

/** Walk `arc` px along the ring from index `from` in `direction`, never past
 *  the unrolled index `limit` (a corner). Indices are unrolled: the ring is
 *  read modulo its length. */
export function walkRing(
  ring: ReadonlyArray<Vec2>,
  from: number,
  direction: 1 | -1,
  arc: number,
  limit: number,
): Vec2 {
  const n = ring.length;
  let remaining = arc;
  let i = from;
  for (let step = 0; step < n; step += 1) {
    if (i === limit) break;
    const a = ring[mod(i, n)] as Vec2;
    const b = ring[mod(i + direction, n)] as Vec2;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= remaining && seg > 0) {
      const t = remaining / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
    i += direction;
  }
  return ring[mod(i, n)] as Vec2;
}

/** Forward unit tangent at unrolled index `i`, from the points `window` px
 *  behind and ahead, bounded by the corners at `lo` and `hi`. At a bound it
 *  is the one-sided parabola estimate through the point and the points half
 *  and one window inside (second-order accurate, no chord lag). */
export function ringTangent(
  ring: ReadonlyArray<Vec2>,
  i: number,
  window: number,
  lo: number,
  hi: number,
): Vec2 {
  const at = ring[mod(i, ring.length)] as Vec2;
  if (i === lo || i === hi) {
    const direction = i === lo ? 1 : -1;
    const limit = i === lo ? hi : lo;
    const half = walkRing(ring, i, direction, window / 2, limit);
    const full = walkRing(ring, i, direction, window, limit);
    const d = { x: -3 * at.x + 4 * half.x - full.x, y: -3 * at.y + 4 * half.y - full.y };
    const forward = direction === 1 ? d : { x: -d.x, y: -d.y };
    return unit(forward, direction === 1 ? sub(full, at) : sub(at, full));
  }
  const ahead = walkRing(ring, i, 1, window, hi);
  const behind = walkRing(ring, i, -1, window, lo);
  return unit(sub(ahead, behind), sub(ahead, at));
}

export function mod(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v: Vec2, fallback: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len > NEAR_ZERO) return { x: v.x / len, y: v.y / len };
  const fl = Math.hypot(fallback.x, fallback.y);
  return fl > NEAR_ZERO ? { x: fallback.x / fl, y: fallback.y / fl } : { x: 1, y: 0 };
}
