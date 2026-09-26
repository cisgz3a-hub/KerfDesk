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

import { solveTangentArms, type CubicBezier } from '../geometry/cubic-fit';
import { hypot2 } from '../geometry/fast-hypot';
import type { Vec2 } from '../scene';
import { orthogonalError } from './centerline/curve-fit-error';
import { projectSpan, reverseSpan, SQ_BELOW, SQ_PRUNE_MIN } from './compact-curve-project';
import { cubicSelfIntersects } from './compact-curve-shape';

// Newton reparameterization passes per span; a pass that does not lower the
// error ends the refinement (a tolerance-free rule).
const MAX_REPARAM_PASSES = 4;
const MIN_PASS_GAIN_PX = 1e-4;
// Arms outside this multiple of the chord make loops, never outlines; they
// fall back to the chord/3 arms.
const MIN_ARM_CHORD_RATIO = 1e-3;
const MAX_ARM_CHORD_RATIO = 2;
const NEAR_ZERO = 1e-12;
// A span longer than twice this many points screens its first pass on about
// this many of them before projecting every point (see screenFirstPass).
const SCREEN_POINTS = 48;
// A first pass that misses by more than this multiple of the rejection
// error gives up (see fitSpan): Newton reparameterization lowers a span's
// error by well under this factor.
const FIRST_PASS_GIVE_UP = 3;

export type SpanFit = {
  readonly cubic: CubicBezier;
  /** Max of point-to-curve and curve-to-chain distance, px; Infinity for a
   *  cubic that crosses itself. */
  readonly cubicError: number;
  /** Max distance of the span from its chord, px. */
  readonly lineError: number;
  /** Span index where the cubic misses worst (split candidate). */
  readonly worstIndex: number;
  /** False when the fit stopped once it was bound to miss (see fitSpan). */
  readonly complete: boolean;
  /** The passes a full fit ran (absent when it gave up or never fitted). */
  readonly passes?: SpanPasses | undefined;
};

/** What the Newton passes of one span found: the kept cubic and its error
 *  and worst index, and the first (chord-parameter) pass's error. */
export type SpanPasses = {
  readonly cubic: CubicBezier;
  readonly firstError: number;
  readonly error: number;
  readonly index: number;
};

/** Fit one cubic through `span` with its end tangents fixed (`tEnd` points
 *  back from the last point into the curve), and measure the straight chord
 *  too. `missAbove` is the error beyond which the caller rejects the cubic
 *  anyway: a kept pass beyond it skips the curve-to-chain check, and a first
 *  pass off by more than `giveUpAbove` (by default
 *  {@link FIRST_PASS_GIVE_UP} times `missAbove`) skips the Newton passes.
 *  Such a fit is marked incomplete: its error already exceeds `missAbove`
 *  and its cubic is not to be drawn. With `decisionOnly` (the merge, which
 *  only asks whether a span fits) the curve-to-chain check also stops once
 *  it passes `missAbove`; a caller that splits at the worst point needs the
 *  whole check. */
export function fitSpan(
  span: ReadonlyArray<Vec2>,
  tStart: Vec2,
  tEnd: Vec2,
  missAbove = Infinity,
  giveUpAbove = FIRST_PASS_GIVE_UP * missAbove,
  decisionOnly = false,
  known?: SpanPasses,
): SpanFit {
  if (known !== undefined && decisionOnly) {
    return decideFromPasses(span, known, missAbove, giveUpAbove);
  }
  const u = chordParams(span);
  // The first pass's cubic, shared by the screen and the passes (armCubic is
  // deterministic, so fitting it once changes nothing).
  const first = armCubic(span, u, tStart, tEnd);
  const screened = screenFirstPass(span, u, first, giveUpAbove);
  if (screened !== null) return screened;
  const fit = bestPass(span, u, first, tStart, tEnd, giveUpAbove);
  if (fit.gaveUp) return missed(span, fit.cubic, fit.error, fit.index);
  return checkedFit(span, fit, missAbove, decisionOnly);
}

// The kept pass against the tolerance, then the curve-to-chain check, which
// runs once, on the pass kept: it rejects a loop or bulge that slips between
// the data points. A caller that only needs the decision stops it once it is
// past `missAbove`: the cubic is rejected whatever the rest of the check
// finds. The passes ride along for a later decision on the same span.
function checkedFit(
  span: ReadonlyArray<Vec2>,
  fit: Pass & { readonly firstError: number },
  missAbove: number,
  decisionOnly: boolean,
): SpanFit {
  const passes = {
    cubic: fit.cubic,
    firstError: fit.firstError,
    error: fit.error,
    index: fit.index,
  };
  if (fit.error > missAbove) return { ...missed(span, fit.cubic, fit.error, fit.index), passes };
  const stopAbove = decisionOnly ? missAbove : Infinity;
  const reverse = reverseSpan(span, fit.cubic, fit.params, stopAbove);
  if (reverse.stopped) return missed(span, fit.cubic, reverse.error, fit.index);
  // A cubic that loops or cusps is never an outline, however close it runs.
  const loops = cubicSelfIntersects(fit.cubic);
  return {
    cubic: fit.cubic,
    cubicError: loops ? Infinity : Math.max(fit.error, reverse.error),
    lineError: chordDeviation(span),
    worstIndex: fit.error >= reverse.error ? fit.index : reverse.index,
    complete: true,
    passes,
  };
}

// The same decision fitSpan reaches when its passes already ran on this span
// with these joint tangents (they are deterministic): the first pass decides
// the give-up (a screen is a subset of it, so it never gives up alone), the
// kept pass the miss, then the curve-to-chain and loop checks as above. The
// worst index is not tracked (a decision-only caller never splits).
function decideFromPasses(
  span: ReadonlyArray<Vec2>,
  known: SpanPasses,
  missAbove: number,
  giveUpAbove: number,
): SpanFit {
  const { cubic } = known;
  if (known.firstError > giveUpAbove) return missed(span, cubic, known.firstError, 0);
  if (known.error > missAbove) return missed(span, cubic, known.error, known.index);
  const reverse = reverseSpan(span, cubic, null, missAbove);
  if (reverse.stopped) return missed(span, cubic, reverse.error, known.index);
  const loops = cubicSelfIntersects(cubic);
  return {
    cubic,
    cubicError: loops ? Infinity : Math.max(known.error, reverse.error),
    lineError: chordDeviation(span),
    worstIndex: known.index,
    complete: true,
  };
}

type Pass = {
  readonly cubic: CubicBezier;
  readonly error: number;
  readonly index: number;
  readonly params: Float64Array;
};

// Three parameter buffers (chord parameters and two passes), reused by every
// span (the fit is synchronous and never re-entered); they grow up to this
// many points, and a longer span gets its own (so a huge ring never pins its
// size in memory).
const RETAINED_BUFFER_POINTS = 1 << 16;
let bufferA = new Float64Array(256);
let bufferB = new Float64Array(256);
let bufferC = new Float64Array(256);

function passBuffers(length: number): [Float64Array, Float64Array] {
  growBuffers(length);
  if (bufferA.length >= length) return [bufferA, bufferB];
  return [new Float64Array(length), new Float64Array(length)];
}

function growBuffers(length: number): void {
  if (bufferA.length < length && length <= RETAINED_BUFFER_POINTS) {
    bufferA = new Float64Array(Math.min(length * 2, RETAINED_BUFFER_POINTS));
    bufferB = new Float64Array(bufferA.length);
    bufferC = new Float64Array(bufferA.length);
  }
}

// cubic-fit.ts's chordParameterize (cumulative chord lengths over the total,
// or even steps on a zero-length span), same operations in the same order,
// into the reused chord buffer instead of two fresh arrays.
function chordParams(span: ReadonlyArray<Vec2>): Float64Array {
  const n = span.length;
  growBuffers(n);
  const u = bufferC.length >= n ? bufferC : new Float64Array(n);
  u[0] = 0;
  for (let i = 1; i < n; i += 1) {
    const a = span[i - 1] as Vec2;
    const b = span[i] as Vec2;
    u[i] = (u[i - 1] as number) + hypot2(b.x - a.x, b.y - a.y);
  }
  const total = u[n - 1] as number;
  if (total <= 0) {
    for (let i = 0; i < n; i += 1) u[i] = i / Math.max(1, n - 1);
  } else {
    for (let i = 0; i < n; i += 1) u[i] = (u[i] as number) / total;
  }
  return u;
}

// The first pass at chord parameters, then Newton reparameterization passes
// while they lower the error; the best pass is kept. A first pass beyond
// `giveUpAbove` stops at once, marked given up. A later pass stops as soon as
// it reaches the best error so far: it can then neither become the best nor
// improve, which ends the passes anyway.
function bestPass(
  span: ReadonlyArray<Vec2>,
  chordU: ArrayLike<number>,
  firstCubic: CubicBezier,
  tStart: Vec2,
  tEnd: Vec2,
  giveUpAbove: number,
): Pass & { readonly gaveUp: boolean; readonly firstError: number } {
  let [out, spare] = passBuffers(span.length);
  const first = projectSpan(span, firstCubic, chordU, out, giveUpAbove, false);
  const firstError = first.error;
  let best: Pass = { cubic: firstCubic, error: first.error, index: first.index, params: out };
  if (first.stopped) return { ...best, gaveUp: true, firstError };
  [out, spare] = [spare, out];
  if (span.length <= 2) return { ...best, gaveUp: false, firstError };
  for (let pass = 1; pass <= MAX_REPARAM_PASSES; pass += 1) {
    const cubic = armCubic(span, best.params, tStart, tEnd);
    const projected = projectSpan(span, cubic, best.params, out, best.error, true);
    if (projected.stopped) break;
    const improved = projected.error < best.error - MIN_PASS_GAIN_PX;
    if (projected.error < best.error) {
      best = { cubic, error: projected.error, index: projected.index, params: out };
      [out, spare] = [spare, out];
    }
    if (!improved) break;
  }
  return { ...best, gaveUp: false, firstError };
}

/** The straight chord of `span` alone, as an incomplete fit (no cubic was
 *  fitted: the caller has already chosen the line). */
export function chordSpanFit(span: ReadonlyArray<Vec2>): SpanFit {
  const p0 = span[0] as Vec2;
  const p3 = span.at(-1) as Vec2;
  const third = { x: (p3.x - p0.x) / 3, y: (p3.y - p0.y) / 3 };
  const cubic = {
    p0,
    p1: { x: p0.x + third.x, y: p0.y + third.y },
    p2: { x: p3.x - third.x, y: p3.y - third.y },
    p3,
  };
  return missed(span, cubic, Infinity, span.length >> 1);
}

function missed(
  span: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  error: number,
  worstIndex: number,
): SpanFit {
  return { cubic, cubicError: error, lineError: chordDeviation(span), worstIndex, complete: false };
}

// On a long span, the first pass's error at every few points is a lower
// bound of its error at all of them: when that already exceeds `giveUpAbove`
// the span gives up exactly as the full first pass would, for a fraction of
// its projections (the split point is the worst screened point).
function screenFirstPass(
  span: ReadonlyArray<Vec2>,
  u: ArrayLike<number>,
  cubic: CubicBezier,
  giveUpAbove: number,
): SpanFit | null {
  if (!Number.isFinite(giveUpAbove) || span.length <= 2 * SCREEN_POINTS) return null;
  const stride = Math.ceil(span.length / SCREEN_POINTS);
  const points: Vec2[] = [];
  const params: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < span.length - 1; i += stride) {
    points.push(span[i] as Vec2);
    params.push(u[i] as number);
    indices.push(i);
  }
  points.push(span.at(-1) as Vec2);
  params.push(1);
  indices.push(span.length - 1);
  const screen = orthogonalError(points, cubic, params);
  if (screen.error <= giveUpAbove) return null;
  return missed(span, cubic, screen.error, indices[screen.index] as number);
}

// Schneider's arm lengths along the fixed tangents, with the loop and
// degeneracy guard.
function armCubic(
  span: ReadonlyArray<Vec2>,
  u: ArrayLike<number>,
  t1: Vec2,
  t2: Vec2,
): CubicBezier {
  const p0 = span[0] as Vec2;
  const p3 = span.at(-1) as Vec2;
  const chord = hypot2(p3.x - p0.x, p3.y - p0.y);
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

// The last span measured and its deviation: a caller that tries the chord
// first (lineSpanFit) and then the cubic measures the same span twice. Spans
// are never changed once built; only spans the pass buffers would hold are
// kept, so a huge ring is never pinned in memory.
let deviationSpan: ReadonlyArray<Vec2> | null = null;
let deviationValue = 0;

function chordDeviation(span: ReadonlyArray<Vec2>): number {
  if (span === deviationSpan) return deviationValue;
  const worst = measureChordDeviation(span);
  deviationSpan = span.length <= RETAINED_BUFFER_POINTS ? span : null;
  deviationValue = worst;
  return worst;
}

function measureChordDeviation(span: ReadonlyArray<Vec2>): number {
  const a = span[0] as Vec2;
  const b = span.at(-1) as Vec2;
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  const degenerate = lenSq < NEAR_ZERO;
  let worst = 0;
  let floorSq = 0;
  for (let i = 1; i < span.length - 1; i += 1) {
    // Point-to-segment distance; the root only where it may raise the max.
    const p = span[i] as Vec2;
    let ex: number;
    let ey: number;
    if (degenerate) {
      ex = p.x - a.x;
      ey = p.y - a.y;
    } else {
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq));
      ex = p.x - (a.x + t * vx);
      ey = p.y - (a.y + t * vy);
    }
    if (ex * ex + ey * ey < floorSq) continue;
    worst = Math.max(worst, hypot2(ex, ey));
    if (worst > SQ_PRUNE_MIN) floorSq = worst * worst * SQ_BELOW;
  }
  return worst;
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
    const seg = hypot2(b.x - a.x, b.y - a.y);
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
  const len = hypot2(v.x, v.y);
  if (len > NEAR_ZERO) return { x: v.x / len, y: v.y / len };
  const fl = hypot2(fallback.x, fallback.y);
  return fl > NEAR_ZERO ? { x: fallback.x / fl, y: fallback.y / fl } : { x: 1, y: 0 };
}
