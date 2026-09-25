// Compact cubic output for centreline strokes (ADR-397).
//
// The finished centreline used to reach the scene as a dense Catmull-Rom
// resample drawn as straight segments: a 3 px ring became 128 line moves and
// every stroke stayed dense. This stage fits the faired dense chain with
// least-squares G1 cubic Béziers instead (own implementation of the published
// Schneider 1990 scheme: chord-length parameters, tangent-constrained normal
// equations for the two arm lengths, Newton reparameterization, split at the
// worst point and recurse). Two things differ from the textbook version:
//
//  * Acceptance is ORTHOGONAL. A candidate passes only when every chain point
//    lies within the tolerance of the curve measured perpendicular to it
//    (Newton projection, not the fit's own parameter), and every sample of
//    the curve lies within the tolerance of the chain. The second check
//    rejects a loop or bulge that slips between the data points.
//  * Breaks are typed. A CORNER (sharp bend, open end) splits the stroke with
//    one-sided tangents, so the corner stays exact and its legs stay straight.
//    A KNOT (a branch attachment on a through-stroke) is an exact vertex too,
//    but both sides share one centred tangent, so the stroke stays G1 through
//    it. A closed ring without corners seams at index 0 with a centred
//    tangent, so the seam is G1 as well.
//
// Pure core — deterministic, no I/O.

import {
  chordParameterize,
  evaluateCubic,
  solveTangentArms,
  type CubicBezier,
} from '../../geometry/cubic-fit';
import type { CurveSubpath, PathSegment, Vec2 } from '../../scene';
import {
  add,
  centredTangent,
  controlLength,
  distance,
  negate,
  oneSidedTangent,
  pointToSegment,
  scale,
} from './cubic-geometry';
import { orthogonalError, reverseError, type FitError } from './curve-fit-error';

// Newton reparameterization only pays when the first fit is already close.
const REPARAM_ERROR_FACTOR = 6;
const MAX_REPARAM_PASSES = 6;
// Arms longer than this multiple of the chord make loops, never strokes.
const MAX_ARM_CHORD_RATIO = 2;
const MIN_ARM_CHORD_RATIO = 1e-3;
const MAX_SPLIT_DEPTH = 28;
// Compatibility-polyline sampling: about one vertex per this many px.
const SAMPLE_STEP_PX = 1.5;
const MIN_CUBIC_SAMPLES = 2;
const NEAR_POINT_EPS = 1e-9;

type BreakKind = 'corner' | 'knot';

type FitState = {
  readonly tolerance: number;
  readonly out: PathSegment[];
};

/**
 * Fit a stroke chain with compact G1 cubics. `corners` (by object reference)
 * split the curve with exact, one-sided vertices; `knots` stay exact but keep
 * a shared tangent. A closed chain's curve returns to its start. Returns null
 * for a chain with fewer than two distinct points.
 */
export function fitStrokeCurve(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  knots: ReadonlySet<Vec2>,
  tolerancePx: number,
): CurveSubpath | null {
  const chain = distinctPoints(points, closed, corners, knots);
  if (chain.length < 2) return null;
  const ring = closed && chain.length >= 3;
  const breaks = breakIndices(chain, ring, corners, knots);
  const tolerance = Math.max(1e-3, tolerancePx);
  const state: FitState = { tolerance, out: [] };
  if (ring && breaks.length === 0) {
    const seam = centredTangent(chain, true, 0);
    fitTop([...chain, chain[0] as Vec2], seam, negate(seam), false, state);
    return { start: chain[0] as Vec2, segments: state.out, closed: true };
  }
  const bounds = ring ? rotateToFirstBreak(chain, breaks) : openBounds(chain, breaks);
  for (let b = 0; b + 1 < bounds.indices.length; b += 1) {
    const from = bounds.indices[b] as number;
    const to = bounds.indices[b + 1] as number;
    const run = bounds.points.slice(from, to + 1);
    if (run.length < 2) continue;
    const startKind = bounds.kinds[b];
    const endKind = bounds.kinds[b + 1];
    const tStart =
      startKind === 'knot'
        ? centredTangent(bounds.points, bounds.wraps, from)
        : oneSidedTangent(run, 'start');
    const tEnd =
      endKind === 'knot'
        ? negate(centredTangent(bounds.points, bounds.wraps, to))
        : oneSidedTangent(run, 'end');
    fitTop(run, tStart, tEnd, startKind !== 'knot' && endKind !== 'knot', state);
  }
  return { start: bounds.points[0] as Vec2, segments: state.out, closed: ring };
}

/** Sample a fitted curve into its compatibility polyline: line ends exactly,
 *  about one vertex per 1.5 px along cubics. A closed curve's samples end on
 *  their start (an explicit return, as every closed trace ring does). */
export function sampleStrokeCurve(curve: CurveSubpath): Vec2[] {
  const out: Vec2[] = [curve.start];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      const cubic = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
      const steps = Math.max(MIN_CUBIC_SAMPLES, Math.ceil(controlLength(cubic) / SAMPLE_STEP_PX));
      for (let s = 1; s < steps; s += 1) out.push(evaluateCubic(cubic, s / steps));
    }
    out.push(segment.to);
    current = segment.to;
  }
  return out;
}

// ——— break bookkeeping ———

type Bounds = {
  readonly points: ReadonlyArray<Vec2>;
  readonly indices: ReadonlyArray<number>;
  readonly kinds: ReadonlyArray<BreakKind>;
  /** Whether tangent windows may wrap (a rotated closed ring). */
  readonly wraps: boolean;
};

function distinctPoints(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  knots: ReadonlySet<Vec2>,
): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && distance(last, p) < NEAR_POINT_EPS) {
      // Keep the marked object when a duplicate carries the mark.
      if ((corners.has(p) || knots.has(p)) && !corners.has(last) && !knots.has(last)) {
        out[out.length - 1] = p;
      }
      continue;
    }
    out.push(p);
  }
  if (closed && out.length > 2) {
    const first = out[0] as Vec2;
    const last = out.at(-1) as Vec2;
    if (distance(first, last) < NEAR_POINT_EPS) out.pop();
  }
  return out;
}

function breakIndices(
  chain: ReadonlyArray<Vec2>,
  ring: boolean,
  corners: ReadonlySet<Vec2>,
  knots: ReadonlySet<Vec2>,
): Array<{ index: number; kind: BreakKind }> {
  const breaks: Array<{ index: number; kind: BreakKind }> = [];
  const lo = ring ? 0 : 1;
  const hi = ring ? chain.length : chain.length - 1;
  for (let i = lo; i < hi; i += 1) {
    const p = chain[i] as Vec2;
    if (corners.has(p)) breaks.push({ index: i, kind: 'corner' });
    else if (knots.has(p)) breaks.push({ index: i, kind: 'knot' });
  }
  return breaks;
}

function openBounds(
  chain: ReadonlyArray<Vec2>,
  breaks: ReadonlyArray<{ index: number; kind: BreakKind }>,
): Bounds {
  return {
    points: chain,
    indices: [0, ...breaks.map((b) => b.index), chain.length - 1],
    kinds: ['corner', ...breaks.map((b) => b.kind), 'corner'],
    wraps: false,
  };
}

// A closed ring with breaks starts at its first break and returns to it, so
// no run straddles the seam.
function rotateToFirstBreak(
  chain: ReadonlyArray<Vec2>,
  breaks: ReadonlyArray<{ index: number; kind: BreakKind }>,
): Bounds {
  const first = (breaks[0] as { index: number }).index;
  const n = chain.length;
  const rotated = [...chain.slice(first), ...chain.slice(0, first)];
  const ring = [...rotated, rotated[0] as Vec2];
  const indices = breaks.map((b) => (b.index - first + n) % n);
  indices.push(n);
  const kinds = breaks.map((b) => b.kind);
  kinds.push((breaks[0] as { kind: BreakKind }).kind);
  return { points: ring, indices, kinds, wraps: true };
}

// ——— fitting ———

// A whole break-to-break run that is straight within tolerance, and bounded
// by C0 breaks on both sides, is exactly a line. Knot-bounded runs stay cubic
// so the through-stroke keeps its shared tangent.
function fitTop(
  run: ReadonlyArray<Vec2>,
  tStart: Vec2,
  tEnd: Vec2,
  lineAllowed: boolean,
  state: FitState,
): void {
  const first = run[0] as Vec2;
  const last = run.at(-1) as Vec2;
  if (run.length === 2 || (lineAllowed && maxChordDeviation(run) <= state.tolerance)) {
    if (distance(first, last) >= NEAR_POINT_EPS || run.length > 2) {
      state.out.push({ kind: 'line', to: last });
    }
    return;
  }
  const pieces: Piece[] = [];
  fitRecursive(run, 0, run.length - 1, tStart, tEnd, state.tolerance, pieces, 0);
  mergePieces(run, pieces, state.tolerance);
  for (const piece of pieces) state.out.push(...piece.segments);
}

// One fitted stretch of a run: the chain index range it covers, the tangents
// it was fitted with, and its segments. Only single cubics fitted over their
// own range may merge with a neighbour.
type Piece = {
  readonly lo: number;
  readonly hi: number;
  readonly tStart: Vec2;
  readonly tEnd: Vec2;
  readonly segments: PathSegment[];
  readonly mergeable: boolean;
};

function fitRecursive(
  run: ReadonlyArray<Vec2>,
  lo: number,
  hi: number,
  tStart: Vec2,
  tEnd: Vec2,
  tolerance: number,
  pieces: Piece[],
  depth: number,
): void {
  const span = run.slice(lo, hi + 1);
  if (span.length === 2) {
    const segment = twoPointSegment(span, tStart, tEnd, tolerance);
    pieces.push({ lo, hi, tStart, tEnd, segments: [segment], mergeable: segment.kind === 'cubic' });
    return;
  }
  if (depth >= MAX_SPLIT_DEPTH) {
    const segments: PathSegment[] = span.slice(1).map((to) => ({ kind: 'line', to }));
    pieces.push({ lo, hi, tStart, tEnd, segments, mergeable: false });
    return;
  }
  const attempt = attemptCubic(span, tStart, tEnd, tolerance);
  if (attempt.cubic !== null) {
    pieces.push({ lo, hi, tStart, tEnd, segments: [cubicSegment(attempt.cubic)], mergeable: true });
    return;
  }
  const split = lo + Math.min(Math.max(attempt.worstIndex, 1), span.length - 2);
  const tangent = centredTangent(run, false, split);
  fitRecursive(run, lo, split, tStart, negate(tangent), tolerance, pieces, depth + 1);
  fitRecursive(run, split, hi, tangent, tEnd, tolerance, pieces, depth + 1);
}

// Splitting at the worst point over-segments: each split is chosen for its
// own half, never revisited. One left-to-right sweep re-fits each adjacent
// pair over their joint range with their outer tangents and keeps any merge
// that still meets the tolerance both ways; after a merge only the new piece
// and its neighbours are retried, so the pass stays linear in merge attempts.
function mergePieces(run: ReadonlyArray<Vec2>, pieces: Piece[], tolerance: number): void {
  let i = 0;
  while (i + 1 < pieces.length) {
    const a = pieces[i] as Piece;
    const b = pieces[i + 1] as Piece;
    const attempt =
      a.mergeable && b.mergeable
        ? attemptCubic(run.slice(a.lo, b.hi + 1), a.tStart, b.tEnd, tolerance)
        : null;
    if (attempt === null || attempt.cubic === null) {
      i += 1;
      continue;
    }
    pieces.splice(i, 2, {
      lo: a.lo,
      hi: b.hi,
      tStart: a.tStart,
      tEnd: b.tEnd,
      segments: [cubicSegment(attempt.cubic)],
      mergeable: true,
    });
    // The grown piece may now also merge with its left neighbour.
    if (i > 0) i -= 1;
  }
}

// Least-squares cubic over the span, refined by Newton reparameterization
// while it is close. Returns the cubic when it meets the tolerance both ways,
// otherwise the span index where it misses worst.
function attemptCubic(
  span: ReadonlyArray<Vec2>,
  tStart: Vec2,
  tEnd: Vec2,
  tolerance: number,
): { cubic: CubicBezier | null; worstIndex: number } {
  let u = chordParameterize(span, 0, span.length - 1);
  let worst: FitError = { error: Infinity, index: span.length >> 1 };
  for (let pass = 0; pass <= MAX_REPARAM_PASSES; pass += 1) {
    const cubic = leastSquaresCubic(span, u, tStart, tEnd);
    const projected = orthogonalError(span, cubic, u);
    worst = projected;
    if (projected.error <= tolerance) {
      const reverse = reverseError(span, cubic, projected.params);
      if (reverse.error <= tolerance) return { cubic, worstIndex: -1 };
      worst = reverse;
    }
    if (worst.error > tolerance * REPARAM_ERROR_FACTOR) break;
    u = projected.params;
  }
  return { cubic: null, worstIndex: worst.index };
}

// Two points cannot constrain a cubic. Keep the requested tangents with the
// usual chord/3 arms when that stays within tolerance of the chord; otherwise
// the straight chord is the honest answer (a C0 joint of sub-tolerance size).
function twoPointSegment(
  span: ReadonlyArray<Vec2>,
  tStart: Vec2,
  tEnd: Vec2,
  tolerance: number,
): PathSegment {
  const a = span[0] as Vec2;
  const b = span[1] as Vec2;
  const arm = distance(a, b) / 3;
  const cubic = {
    p0: a,
    p1: add(a, scale(tStart, arm)),
    p2: add(b, scale(tEnd, arm)),
    p3: b,
  };
  const reverse = reverseError(span, cubic, [0, 1]);
  return reverse.error <= tolerance ? cubicSegment(cubic) : { kind: 'line', to: b };
}

// Schneider's normal equations (shared solver): the arm lengths along the
// fixed end tangents that minimise the squared parametric residual. Arms
// longer than twice the chord make loops, never strokes; degenerate or
// looping arms fall back to chord/3.
function leastSquaresCubic(
  run: ReadonlyArray<Vec2>,
  u: ReadonlyArray<number>,
  t1: Vec2,
  t2: Vec2,
): CubicBezier {
  const p0 = run[0] as Vec2;
  const p3 = run.at(-1) as Vec2;
  const chord = distance(p0, p3);
  const arms = solveTangentArms(run, 0, run.length - 1, u, t1, t2);
  let armA = arms.start;
  let armB = arms.end;
  const lo = MIN_ARM_CHORD_RATIO * chord;
  const hi = MAX_ARM_CHORD_RATIO * chord;
  if (!(armA > lo && armB > lo && armA < hi && armB < hi)) {
    armA = chord / 3;
    armB = chord / 3;
  }
  return { p0, p1: add(p0, scale(t1, armA)), p2: add(p3, scale(t2, armB)), p3 };
}

// ——— small geometry ———

function maxChordDeviation(run: ReadonlyArray<Vec2>): number {
  const a = run[0] as Vec2;
  const b = run.at(-1) as Vec2;
  let worst = 0;
  for (let i = 1; i < run.length - 1; i += 1) {
    worst = Math.max(worst, pointToSegment(run[i] as Vec2, a, b));
  }
  return worst;
}

function cubicSegment(cubic: CubicBezier): PathSegment {
  return { kind: 'cubic', control1: cubic.p1, control2: cubic.p2, to: cubic.p3 };
}
