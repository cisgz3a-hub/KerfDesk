// Compact canonical curves for traced contours (ADR-405).
//
// A finished contour ring becomes the FEWEST cubic and line segments whose
// orthogonal distance from the ring stays within one tolerance, then the
// least error among those. Three stages:
//
//  1. Breaks. Decided corners (contour-corners.ts) split the ring C0 with
//     one-sided tangents and stay exact. Knots (kept feature points) are exact
//     joints that keep one centred tangent, so the outline stays G1 there.
//  2. Candidate joints. Between breaks, a split-at-the-worst-point cubic fit
//     at a FIXED candidate tolerance (never the Optimize tolerance) proposes
//     joints; each joint gets one centred tangent that every segment meeting
//     there uses, so the curve is G1 at any joint the merge keeps.
//  3. Merge. A shortest-path search over those joints (own implementation of
//     the published optimal-knot idea, M. Plass and M. Stone, "Curve-fitting
//     with piecewise parametric cubics", SIGGRAPH 1983) picks the fewest
//     segments, then the least summed squared error, where a segment may span
//     several candidate pieces only while its pieces turn the same way (never
//     across an inflection) and while every shorter extension from the same
//     joint also fit. A span's error never depends on the tolerance, so a
//     larger tolerance only adds feasible segments: the segment count is
//     monotone non-increasing in Optimize. A cornerless ring tries each
//     candidate joint as its seam.
//
// A span that is straight within the tolerance, and meets its joints along
// their tangents (or at corners), is one line segment; a single candidate
// piece no cubic through its joint tangents fits (a long flattened chord
// between tilted joints) is its chord when that is closer. Pure core,
// deterministic.

import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import { fitSpan, mod, ringTangent, type SpanFit } from './compact-curve-span';
import { evaluateCubic } from '../geometry/cubic-fit';

export type CompactFitOptions = {
  /** Max orthogonal deviation of the curve from the ring, px (Optimize). */
  readonly tolerance: number;
  /** Tolerance that proposes candidate joints, px; must not follow Optimize. */
  readonly candidateTolerance: number;
  /** Arc length over which joint tangents are estimated, px. */
  readonly tangentWindow: number;
};

// A merged segment spans at most this many candidate pieces.
const MAX_MERGE_PIECES = 24;
// Cornerless rings try at most this many seams (evenly spaced joints).
const MAX_SEAM_TRIALS = 48;
const MAX_SPLIT_DEPTH = 24;
// A piece turning less than this is straight: it merges on either side.
const NEUTRAL_TURN_RAD = (4 * Math.PI) / 180;
// A line may meet a smooth joint only this close to the joint's tangent.
const LINE_JOINT_COS = Math.cos((4 * Math.PI) / 180);
const NEAR_POINT_PX = 1e-9;
// Compatibility polyline: about one vertex per this many px along a cubic.
const SAMPLE_STEP_PX = 1.5;
const MIN_CUBIC_SAMPLES = 4;

// A stretch of the ring between two breaks, in unrolled indices.
type Section = {
  readonly from: number;
  readonly to: number;
  readonly fromCorner: boolean;
  readonly toCorner: boolean;
};

type Evaluation = SpanFit & { readonly error: number; readonly lineOk: boolean };

type Joints = {
  /** Unrolled ring index of each joint. */
  readonly at: ReadonlyArray<number>;
  /** Forward unit tangent at each joint. */
  readonly tangent: ReadonlyArray<Vec2>;
  /** Turn sign of the piece from joint t to t + 1 (-1, 0, 1). */
  readonly sign: ReadonlyArray<number>;
  readonly corner: ReadonlyArray<boolean>;
};

type Context = {
  readonly ring: ReadonlyArray<Vec2>;
  readonly options: CompactFitOptions;
};

/** Fit a closed ring (distinct points, no repeated start) with compact
 *  segments. `corners` and `knots` are matched by object reference. Null for
 *  fewer than three distinct points. */
export function fitCompactRing(
  points: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  knots: ReadonlySet<Vec2>,
  options: CompactFitOptions,
): CurveSubpath | null {
  const ring = distinctRing(points, corners, knots);
  if (ring.length < 3) return null;
  const ctx: Context = { ring, options };
  const breaks: Array<{ index: number; corner: boolean }> = [];
  ring.forEach((p, index) => {
    if (corners.has(p)) breaks.push({ index, corner: true });
    else if (knots.has(p)) breaks.push({ index, corner: false });
  });
  if (breaks.length === 0) return fitCornerlessRing(ctx);
  const segments: PathSegment[] = [];
  const n = ring.length;
  for (let b = 0; b < breaks.length; b += 1) {
    const from = breaks[b] as { index: number; corner: boolean };
    const next = breaks[(b + 1) % breaks.length] as { index: number; corner: boolean };
    const to = next.index > from.index ? next.index : next.index + n;
    const section = { from: from.index, to, fromCorner: from.corner, toCorner: next.corner };
    segments.push(...fitSection(ctx, section));
  }
  return { start: ring[(breaks[0] as { index: number }).index] as Vec2, segments, closed: true };
}

/** The compatibility polyline of a compact curve: line ends only, about one
 *  vertex per 1.5 px along cubics, every joint exact. A closed curve's samples
 *  end on its start, as every closed trace ring does. */
export function sampleCompactCurve(curve: CurveSubpath): Vec2[] {
  const out: Vec2[] = [curve.start];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      const cubic = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
      const length =
        Math.hypot(cubic.p1.x - cubic.p0.x, cubic.p1.y - cubic.p0.y) +
        Math.hypot(cubic.p2.x - cubic.p1.x, cubic.p2.y - cubic.p1.y) +
        Math.hypot(cubic.p3.x - cubic.p2.x, cubic.p3.y - cubic.p2.y);
      const steps = Math.max(MIN_CUBIC_SAMPLES, Math.ceil(length / SAMPLE_STEP_PX));
      for (let s = 1; s < steps; s += 1) out.push(evaluateCubic(cubic, s / steps));
    }
    out.push(segment.to);
    current = segment.to;
  }
  return out;
}

// ——— sections between breaks ———

function fitSection(ctx: Context, section: Section): PathSegment[] {
  const { ring, options } = ctx;
  const lo = section.fromCorner ? section.from : -Infinity;
  const hi = section.toCorner ? section.to : Infinity;
  const tangentAt = (i: number): Vec2 => ringTangent(ring, i, options.tangentWindow, lo, hi);
  const at = [section.from];
  const tangents = new Map<number, Vec2>([
    [section.from, tangentAt(section.from)],
    [section.to, tangentAt(section.to)],
  ]);
  proposeJoints(ctx, section.from, section.to, tangents, tangentAt, at, 0);
  at.push(section.to);
  const joints = jointsOf(at, tangents, (t) =>
    t === 0 ? section.fromCorner : t === at.length - 1 && section.toCorner,
  );
  const evaluate = cachedEvaluator(ctx, joints, (t, k) => t * (at.length + 1) + k);
  const plan = fewestSegments(joints, evaluate, 0, at.length - 1, options.tolerance);
  return emit(plan.steps, evaluate, options.tolerance);
}

// A cornerless ring: candidate joints from a fit seamed at index 0 (first
// split at the point farthest from it, so the ring always has two joints),
// then the merge from every candidate seam.
function fitCornerlessRing(ctx: Context): CurveSubpath {
  const { ring, options } = ctx;
  const n = ring.length;
  const tangentAt = (i: number): Vec2 =>
    ringTangent(ring, i, options.tangentWindow, -Infinity, Infinity);
  const far = farthestFrom(ring, 0);
  const tangents = new Map<number, Vec2>([
    [0, tangentAt(0)],
    [far, tangentAt(far)],
    [n, tangentAt(0)],
  ]);
  const at = [0];
  proposeJoints(ctx, 0, far, tangents, tangentAt, at, 0);
  at.push(far);
  proposeJoints(ctx, far, n, tangents, tangentAt, at, 0);
  const m = at.length;
  // Unroll twice so any seam's full turn is a contiguous joint range.
  const unrolled = [...at, ...at.map((i) => i + n), 2 * n];
  for (const i of at) tangents.set(i + n, tangents.get(i) as Vec2);
  tangents.set(2 * n, tangents.get(0) as Vec2);
  const joints = jointsOf(unrolled, tangents, () => false);
  const evaluate = cachedEvaluator(ctx, joints, (t, k) => (t % m) * (m + 1) + k);
  let best: Plan | null = null;
  const trials = Math.min(m, MAX_SEAM_TRIALS);
  for (let q = 0; q < trials; q += 1) {
    const seam = Math.floor((q * m) / trials);
    const plan = fewestSegments(joints, evaluate, seam, seam + m, options.tolerance, m - 1);
    if (best === null || better(plan, best)) best = plan;
  }
  const plan = best as Plan;
  const start = ring[mod(joints.at[plan.steps[0]?.t ?? 0] as number, n)] as Vec2;
  return { start, segments: emit(plan.steps, evaluate, options.tolerance), closed: true };
}

// Split-at-the-worst-point recursion at the candidate tolerance: pushes the
// interior joints of [lo, hi] in order and records each joint's tangent.
function proposeJoints(
  ctx: Context,
  lo: number,
  hi: number,
  tangents: Map<number, Vec2>,
  tangentAt: (i: number) => Vec2,
  out: number[],
  depth: number,
): void {
  if (hi - lo <= 1 || depth >= MAX_SPLIT_DEPTH) return;
  const tStart = tangents.get(lo) as Vec2;
  const tEnd = tangents.get(hi) as Vec2;
  const span = spanOf(ctx.ring, lo, hi);
  const fit = fitSpan(span, tStart, negate(tEnd));
  if (Math.min(fit.cubicError, fit.lineError) <= ctx.options.candidateTolerance) return;
  const split = lo + splitIndex(span, fit.worstIndex);
  tangents.set(split, tangentAt(split));
  proposeJoints(ctx, lo, split, tangents, tangentAt, out, depth + 1);
  out.push(split);
  proposeJoints(ctx, split, hi, tangents, tangentAt, out, depth + 1);
}

// The worst point, unless it sits at an end of a span the cubic misses badly
// (it would peel one point per split): then the point farthest from the
// chord, or the middle.
function splitIndex(span: ReadonlyArray<Vec2>, worst: number): number {
  const last = span.length - 1;
  const margin = Math.max(1, Math.floor(last / 8));
  if (worst >= margin && worst <= last - margin) return worst;
  const a = span[0] as Vec2;
  const b = span[last] as Vec2;
  let far = last >> 1;
  let farDistance = -1;
  for (let i = margin; i <= last - margin; i += 1) {
    const p = span[i] as Vec2;
    const d = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  return Math.min(Math.max(far, 1), last - 1);
}

function jointsOf(
  at: ReadonlyArray<number>,
  tangents: ReadonlyMap<number, Vec2>,
  isCorner: (t: number) => boolean,
): Joints {
  const tangent = at.map((i) => tangents.get(i) as Vec2);
  const sign = at.map((_, t) =>
    t + 1 < at.length ? turnSign(tangent[t] as Vec2, tangent[t + 1] as Vec2) : 0,
  );
  return { at, tangent, sign, corner: at.map((_, t) => isCorner(t)) };
}

// ——— span evaluation ———

type Evaluate = (t: number, k: number) => Evaluation;

function cachedEvaluator(
  ctx: Context,
  joints: Joints,
  key: (t: number, k: number) => number,
): Evaluate {
  const cache = new Map<number, Evaluation>();
  return (t, k) => {
    const id = key(t, k);
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const evaluation = evaluateSpan(ctx, joints, t, k);
    cache.set(id, evaluation);
    return evaluation;
  };
}

function evaluateSpan(ctx: Context, joints: Joints, t: number, k: number): Evaluation {
  const span = spanOf(ctx.ring, joints.at[t] as number, joints.at[t + k] as number);
  const tStart = joints.tangent[t] as Vec2;
  const tEnd = joints.tangent[t + k] as Vec2;
  const fit = fitSpan(span, tStart, negate(tEnd));
  const lineOk = lineMeetsJoints(
    span,
    tStart,
    tEnd,
    joints.corner[t] === true,
    joints.corner[t + k] === true,
  );
  return { ...fit, lineOk, error: Math.min(fit.cubicError, fit.lineError) };
}

// A line keeps the outline G1 only when it leaves and meets each smooth joint
// along the joint's tangent; at a corner any direction is exact.
function lineMeetsJoints(
  span: ReadonlyArray<Vec2>,
  tStart: Vec2,
  tEnd: Vec2,
  startCorner: boolean,
  endCorner: boolean,
): boolean {
  const a = span[0] as Vec2;
  const b = span.at(-1) as Vec2;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < NEAR_POINT_PX) return false;
  const dx = (b.x - a.x) / len;
  const dy = (b.y - a.y) / len;
  const startOk = startCorner || tStart.x * dx + tStart.y * dy >= LINE_JOINT_COS;
  const endOk = endCorner || tEnd.x * dx + tEnd.y * dy >= LINE_JOINT_COS;
  return startOk && endOk;
}

// ——— the merge ———

type Step = { readonly t: number; readonly k: number };
type Plan = { readonly count: number; readonly cost: number; readonly steps: Step[] };

// Fewest segments from joint `first` to joint `last`, then least summed
// squared error. From each joint a segment grows one candidate piece at a time
// and stops at the first extension that misses the tolerance or turns against
// its pieces; a single piece is always allowed.
function fewestSegments(
  joints: Joints,
  evaluate: Evaluate,
  first: number,
  last: number,
  tolerance: number,
  maxPieces = MAX_MERGE_PIECES,
): Plan {
  const size = last - first;
  const count = new Array<number>(size + 1).fill(Infinity);
  const cost = new Array<number>(size + 1).fill(Infinity);
  const back = new Array<number>(size + 1).fill(0);
  count[0] = 0;
  cost[0] = 0;
  for (let i = 0; i < size; i += 1) {
    let sign = 0;
    const reach = Math.min(maxPieces, MAX_MERGE_PIECES, size - i);
    for (let k = 1; k <= reach; k += 1) {
      const piece = joints.sign[first + i + k - 1] as number;
      if (piece !== 0 && sign !== 0 && piece !== sign) break;
      if (piece !== 0) sign = piece;
      const evaluation = evaluate(first + i, k);
      if (k > 1 && evaluation.error > tolerance) break;
      const nextCount = (count[i] as number) + 1;
      const nextCost = (cost[i] as number) + evaluation.error ** 2;
      if (improves(nextCount, nextCost, count[i + k] as number, cost[i + k] as number)) {
        count[i + k] = nextCount;
        cost[i + k] = nextCost;
        back[i + k] = k;
      }
    }
  }
  const steps: Step[] = [];
  for (let j = size; j > 0; j -= back[j] as number) {
    steps.unshift({ t: first + j - (back[j] as number), k: back[j] as number });
  }
  return { count: count[size] as number, cost: cost[size] as number, steps };
}

function improves(count: number, cost: number, bestCount: number, bestCost: number): boolean {
  return count < bestCount || (count === bestCount && cost < bestCost - 1e-12);
}

function better(plan: Plan, best: Plan): boolean {
  return improves(plan.count, plan.cost, best.count, best.cost);
}

// A straight span that meets its joints along their tangents is a line; a
// cubic within the tolerance comes next, keeping the outline G1; a span no
// cubic through the joint tangents fits (a long flattened chord between
// tilted joints) is the straight chord when that is closer.
function emit(steps: ReadonlyArray<Step>, evaluate: Evaluate, tolerance: number): PathSegment[] {
  return steps.map(({ t, k }) => {
    const fit = evaluate(t, k);
    const line =
      (fit.lineOk && fit.lineError <= tolerance) ||
      (fit.cubicError > tolerance && fit.lineError < fit.cubicError);
    if (line) return { kind: 'line', to: fit.cubic.p3 };
    return { kind: 'cubic', control1: fit.cubic.p1, control2: fit.cubic.p2, to: fit.cubic.p3 };
  });
}

// ——— small helpers ———

function turnSign(a: Vec2, b: Vec2): number {
  const turn = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
  if (Math.abs(turn) < NEUTRAL_TURN_RAD) return 0;
  return turn > 0 ? 1 : -1;
}

function spanOf(ring: ReadonlyArray<Vec2>, from: number, to: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = from; i <= to; i += 1) out.push(ring[mod(i, ring.length)] as Vec2);
  return out;
}

function farthestFrom(ring: ReadonlyArray<Vec2>, index: number): number {
  const origin = ring[index] as Vec2;
  let best = Math.floor(ring.length / 2);
  let bestDistance = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d > bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return Math.min(Math.max(best, 1), ring.length - 1);
}

function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

// Drop consecutive duplicates (keeping a marked object) and a repeated start.
function distinctRing(
  points: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  knots: ReadonlySet<Vec2>,
): Vec2[] {
  const marked = (p: Vec2): boolean => corners.has(p) || knots.has(p);
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last !== undefined && Math.hypot(last.x - p.x, last.y - p.y) < NEAR_POINT_PX) {
      if (marked(p) && !marked(last)) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  const first = out[0];
  const last = out.at(-1);
  if (first !== undefined && last !== undefined && out.length > 1) {
    if (Math.hypot(last.x - first.x, last.y - first.y) < NEAR_POINT_PX) {
      if (marked(last) && !marked(first)) out[0] = last;
      out.pop();
    }
  }
  return out;
}
