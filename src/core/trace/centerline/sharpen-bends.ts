// Corner restoration. Discrete thinning replaces every sharp stroke corner
// with a chamfer — a diagonal cut of up to ~0.41·radius — and a round nib
// following a sharp path leaves the same rounded elbow in the ink. Both are
// DRAWN corners and should trace as vertices. Recover them: where a chain's
// tangents, measured one window to each side of a bend, turn hard AND their
// intersection sits close to the chain (a chamfer hugs its vertex; a real
// arc's tangent intersection stands far off), replace the bend window with
// the intersection vertex. Deliberate fillets (roundings ≳ 2 stroke radii)
// keep their distance and stay round.
//
// This file is the ORCHESTRATION (the scan, the per-candidate attempt, the
// in-place splice); the pure geometric predicates it calls live in
// bend-geometry.ts.

import type { Vec2 } from '../../scene';
import { runTraceSteps, type TraceSteps } from '../trace-steps';
import {
  MAX_BEND_WINDOW_ARM_PX,
  MAX_VERTEX_OFFSET_FACTOR,
  apexReachScale,
  apexSupportedByInk,
  arcTrimIndexOn,
  bendGateReachPx,
  bendVertexAt,
  bendWindow,
  edgeLength,
  edgeLengths,
  legIsStraight,
  netTurnAcross,
  pointToSegment,
  quickTurnAt,
  turnIsConcentrated,
  vertexHugsChain,
} from './bend-geometry';
import { sharpenRingSteps, type RingBend, type RingBendJudge } from './ring-bend-scan';

const QUICK_TURN_GATE_RAD = (20 * Math.PI) / 180;
// One corner per physical corner: after a rebuild, nearby candidates (the
// corner sits inside their windows) can mint their OWN slightly-different
// vertex — measured as 4-6 chattered corner vertices per bar corner spread
// over ~2px, whose worst member tilts the straight-run fit of the whole
// adjacent edge. A rebuilt vertex landing this close to an existing corner
// is the same corner and is dropped.
const CORNER_MIN_SEPARATION_PX = 2.5;
// Replacement budget: one corner per two points, with a floor for short chains.
const MIN_REPLACEMENT_BUDGET = 8;
// Whole-trace attempt budget, per working-raster pixel: a worst-case bound,
// not a tuning knob. Every attempt is a bounded neighbourhood of gate walks,
// so the corner rebuild of one trace costs at most this many of them. Traced
// art stays far inside it (measured peak: owl 0.043 attempts/px in Edge
// Detection; hummingbird 0.033; every perceptual fixture 0.025 or less),
// while colour noise thresholded into meandering boundaries asks for
// 0.12-0.14/px. The floor exempts small rasters outright (a 192² noise
// trace needs ~20k attempts, a few hundred milliseconds).
const ATTEMPTS_PER_WORKING_PIXEL = 0.1;
const MIN_ATTEMPT_BUDGET = 32_768;

/** Shared corner-rebuild allowance for one trace (see createBendBudget). */
export type BendBudget = { attemptsLeft: number };

/** The corner-rebuild allowance of a trace over `workingPixels` pixels. Once
 *  spent, remaining chains keep their dense geometry (no rebuilt corners);
 *  the curve finisher's own hard-turn pins still apply to them. */
export function createBendBudget(workingPixels: number): BendBudget {
  return {
    attemptsLeft: Math.max(
      MIN_ATTEMPT_BUDGET,
      Math.ceil(workingPixels * ATTEMPTS_PER_WORKING_PIXEL),
    ),
  };
}

export type SharpenedChain = {
  readonly points: Vec2[];
  /** The rebuilt drawn-corner vertices, by object reference. Output
   *  refinement pins exactly these — they carry dense-chain evidence
   *  (straight legs, vertex hugging the chain) that no post-simplification
   *  angle heuristic can recover. */
  readonly corners: ReadonlySet<Vec2>;
};

/** Sharpen concentrated bends of a chain. A closed chain is judged with the
 *  ring centred on each candidate (a closed polyline is rotation-invariant),
 *  so ring corners sharpen exactly like open-chain corners. */
export function sharpenChainBends(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  distSq: Float64Array,
  width: number,
  anchors?: ReadonlySet<Vec2>,
): SharpenedChain {
  return runTraceSteps(sharpenChainBendsSteps(points, closed, distSq, width, anchors));
}

// Open chains take one forward pass: an accepted bend is spliced into the
// chain in place and the scan resumes just past the new vertex. Rings re-centre
// on each rebuilt corner and rescan (ring-bend-scan.ts), judging each
// candidate on its bounded stretch of ring and skipping rescans of vertices
// whose stretch no rebuild has touched. Neither copies the chain per
// candidate.
export function* sharpenChainBendsSteps(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  distSq: Float64Array,
  width: number,
  anchors?: ReadonlySet<Vec2>,
  budget?: BendBudget,
): TraceSteps<SharpenedChain> {
  yield;
  const corners = new Set<Vec2>();
  // An anchor the chain does not carry can never be retained by any rebuild.
  if (anchorMissing(points, anchors)) return { points: [...points], corners };
  const replacements = Math.max(MIN_REPLACEMENT_BUDGET, Math.ceil(points.length / 2));
  const addCorner = (chain: ReadonlyArray<Vec2>, bend: BendResult): boolean => {
    if (!acceptableBend(chain, bend, corners, anchors)) return false;
    corners.add(bend.corner);
    return true;
  };
  const sharpened = closed
    ? yield* sharpenRingSteps(points, ringJudge(distSq, width, addCorner, budget), replacements)
    : yield* sharpenOpenSteps([...points], distSq, width, addCorner, replacements, budget);
  return { points: sharpened, corners };
}

function ringJudge(
  distSq: Float64Array,
  width: number,
  accept: (pts: ReadonlyArray<Vec2>, bend: BendResult) => boolean,
  budget: BendBudget | undefined,
): RingBendJudge {
  return {
    spend: () => spend(budget),
    admits: (pts, i) => quickTurnAt(pts, i, true) >= QUICK_TURN_GATE_RAD,
    reachPx: (pts, i) => bendGateReachPx(pts, i, distSq, width, MAX_GATE_ARM_PX),
    maxGateArmPx: MAX_GATE_ARM_PX,
    attempt: (stretch, seg, at, maxArm) => trySharpenOpen(stretch, seg, at, distSq, width, maxArm),
    accept,
  };
}

function* sharpenOpenSteps(
  pts: Vec2[],
  distSq: Float64Array,
  width: number,
  accept: (pts: ReadonlyArray<Vec2>, bend: BendResult) => boolean,
  replacements: number,
  budget: BendBudget | undefined,
): TraceSteps<Vec2[]> {
  const cooperate = yield;
  let replacementsLeft = replacements;
  let seg = edgeLengths(pts);
  let i = 1;
  while (i < pts.length - 1) {
    if (cooperate) yield;
    if (quickTurnAt(pts, i, false) < QUICK_TURN_GATE_RAD) {
      i += 1;
      continue;
    }
    if (!spend(budget)) break;
    const bent = trySharpenOpen(pts, seg, i, distSq, width);
    if (bent === null || !accept(pts, bent)) {
      i += 1;
      continue;
    }
    seg = spliceOpen(pts, seg, bent);
    replacementsLeft -= 1;
    if (replacementsLeft <= 0) break;
    i = bent.from + 1;
  }
  return pts;
}

// Replace chain positions [from, to) with the corner, in place, and keep the
// edge lengths in step: only the corner's two edges are new.
function spliceOpen(pts: Vec2[], seg: Float64Array, bent: BendResult): Float64Array {
  const count = bent.to - bent.from;
  pts.splice(bent.from, count, bent.corner);
  seg.copyWithin(bent.from + 1, bent.from + count);
  const next = seg.subarray(0, seg.length - count + 1);
  if (bent.from > 0) next[bent.from - 1] = edgeLength(pts, bent.from - 1, bent.from);
  if (bent.from + 1 < pts.length) next[bent.from] = edgeLength(pts, bent.from, bent.from + 1);
  return next;
}

/** Take one attempt from the budget; false once it is spent. */
function spend(budget: BendBudget | undefined): boolean {
  if (budget === undefined) return true;
  if (budget.attemptsLeft <= 0) return false;
  budget.attemptsLeft -= 1;
  return true;
}

function anchorMissing(pts: ReadonlyArray<Vec2>, anchors: ReadonlySet<Vec2> | undefined): boolean {
  if (anchors === undefined || anchors.size === 0) return false;
  const present = new Set(pts);
  for (const anchor of anchors) if (!present.has(anchor)) return true;
  return false;
}

function acceptableBend(
  pts: ReadonlyArray<Vec2>,
  bent: BendResult,
  corners: ReadonlySet<Vec2>,
  anchors: ReadonlySet<Vec2> | undefined,
): boolean {
  return !tooCloseToExistingCorner(bent.corner, corners) && !removesAnchor(pts, bent, anchors);
}

/** A bend replaces chain positions [from, to) with its corner vertex. For a
 *  ring the positions are logical: they may run below 0 or past n and wrap. */
type BendResult = RingBend;

function removesAnchor(
  pts: ReadonlyArray<Vec2>,
  bent: BendResult,
  anchors: ReadonlySet<Vec2> | undefined,
): boolean {
  if (anchors === undefined || anchors.size === 0) return false;
  const n = pts.length;
  for (let k = bent.from; k < bent.to; k += 1) {
    const p = pts[((k % n) + n) % n];
    if (p !== undefined && anchors.has(p) && !keptElsewhere(pts, p, bent)) return true;
  }
  return false;
}

// A chain may carry one point object more than once (a centerline junction
// shared by both ends); the anchor survives while any copy stays outside the
// window.
function keptElsewhere(pts: ReadonlyArray<Vec2>, p: Vec2, bent: BendResult): boolean {
  const n = pts.length;
  const removed = bent.to - bent.from;
  for (let k = 0; k < n - removed; k += 1) {
    if (pts[(((bent.to + k) % n) + n) % n] === p) return true;
  }
  return false;
}

function tooCloseToExistingCorner(vertex: Vec2, corners: ReadonlySet<Vec2>): boolean {
  for (const c of corners) {
    if (Math.hypot(c.x - vertex.x, c.y - vertex.y) < CORNER_MIN_SEPARATION_PX) return true;
  }
  return false;
}

// A thin tip's radius-derived window sits entirely inside the tip's own
// rounded zone, so its "legs" measure as curved and the rebuild never fires
// (measured: 11 of 12 star tips had no corner). Retrying with wider arms
// lets the tangents reach the straight flanks beyond the rounding; every
// gate still applies at each size, so genuine curves keep rejecting. The
// retries are reserved for HARD turns AT the candidate itself: a needle tip
// turns ≥90° across the retry window AND most of that already within ±3px
// of the tip, while a mid-edge vertex a few px away from a genuine corner
// sees the ≥90° only in the wide window (the corner, not itself) — firing
// there replaces good edge geometry with tilted legs (measured on the
// jittered-bar instrument: edge RMS 0.14 → 0.39 without the near gate).
const RETRY_ARMS_PX = [6, 9, 12] as const;
const RETRY_MIN_TURN_RAD = (90 * Math.PI) / 180;
const RETRY_NEAR_SPAN_PX = 3;
const RETRY_MIN_NEAR_TURN_RAD = (60 * Math.PI) / 180;
// The widest tangent arm any attempt may use (base window or retry).
const MAX_GATE_ARM_PX = Math.max(MAX_BEND_WINDOW_ARM_PX, ...RETRY_ARMS_PX);

// `seg` holds the chain's edge lengths (see edgeLengths).
function trySharpenOpen(
  pts: ReadonlyArray<Vec2>,
  seg: Float64Array,
  i: number,
  distSq: Float64Array,
  width: number,
  maxArm = Infinity,
): BendResult | null {
  const window = bendWindow(pts, seg, i, distSq, width);
  const baseArm = Math.min(window.arm, maxArm);
  const base = attemptBend(pts, seg, i, baseArm, window.maxRadius, distSq, width);
  if (base !== null) return base;
  const nearTurn = netTurnAcross(pts, seg, i, RETRY_NEAR_SPAN_PX);
  if (nearTurn === null || nearTurn < RETRY_MIN_NEAR_TURN_RAD) return null;
  for (const armPx of RETRY_ARMS_PX) {
    if (armPx <= baseArm || armPx > maxArm) continue;
    // Cheapest decisive test first, so attemptBend need not repeat it.
    if (!legsAreStraight(pts, seg, i, armPx)) continue;
    const turn = netTurnAcross(pts, seg, i, armPx);
    if (turn === null || turn < RETRY_MIN_TURN_RAD) continue;
    const bent = attemptBend(pts, seg, i, armPx, window.maxRadius, distSq, width, true);
    if (bent !== null) return bent;
  }
  return null;
}

function attemptBend(
  pts: ReadonlyArray<Vec2>,
  seg: Float64Array,
  i: number,
  arm: number,
  maxRadius: number,
  distSq: Float64Array,
  width: number,
  legsChecked = false,
): BendResult | null {
  const p = pts[i];
  if (p === undefined) return null;
  // The legs are ranges of `pts`, not copies of it. Every gate below reads a
  // neighbourhood of the candidate, and only an ACCEPTED bend changes the
  // chain — which matters because the scan asks this of every vertex.
  // A drawn corner has straight legs and its turn CONCENTRATED at the
  // vertex; a glyph-scale curve (radius near the window size) passes the leg
  // test but turns uniformly, so the concentration gate rejects it. Every
  // gate is a pure test, so the one that rejects most candidates (the legs)
  // runs first.
  if (!legsChecked && !legsAreStraight(pts, seg, i, arm)) return null;
  const headEnd = arcTrimIndexOn(seg, 0, i, 'tail', arm);
  const tailStart = arcTrimIndexOn(seg, i, pts.length - 1, 'head', arm);
  if (headEnd < 2 || pts.length - tailStart < 2) return null;
  if (!turnIsConcentrated(pts, seg, i, arm)) return null;
  const bend = bendVertexAt(pts, seg, headEnd, tailStart);
  if (bend === null) return null;
  const wedge = wedgeInkSupport(pts, headEnd, tailStart, bend.vertex, distSq, width);
  if (wedge === null) return null;
  const { legStart, legEnd } = wedge;
  const maxOffset = maxRadius * MAX_VERTEX_OFFSET_FACTOR * apexReachScale(bend.turnRad);
  if (!vertexHugsChain(bend.vertex, pts, headEnd, tailStart, maxOffset)) return null;
  if (
    !replacementCoversRemoved(pts, headEnd, tailStart, legStart, bend.vertex, legEnd, maxOffset)
  ) {
    return null;
  }
  return { from: headEnd, to: tailStart, corner: bend.vertex };
}

function legsAreStraight(
  pts: ReadonlyArray<Vec2>,
  seg: Float64Array,
  i: number,
  arm: number,
): boolean {
  return legIsStraight(pts, seg, i, arm, 'before') && legIsStraight(pts, seg, i, arm, 'after');
}

// Physical gate: ink must accompany BOTH wedge legs to the apex. The
// reach-scaled hugs/coverage tolerances legitimately widen for needle-sharp
// turns (a real tip's apex stands ~radius past the rounded chain end), but
// that same allowance let blunt serif terminals extend into blank
// background — the intersection of two shallow leg fits is a fabrication
// unless the drawn stroke actually runs there (the Arch House serif-spike
// defect).
function wedgeInkSupport(
  pts: ReadonlyArray<Vec2>,
  headEnd: number,
  tailStart: number,
  apex: Vec2,
  distSq: Float64Array,
  width: number,
): { readonly legStart: Vec2; readonly legEnd: Vec2 } | null {
  const legStart = pts[headEnd - 1];
  const legEnd = pts[tailStart];
  if (legStart === undefined || legEnd === undefined) return null;
  if (!apexSupportedByInk(legStart, apex, distSq, width)) return null;
  if (!apexSupportedByInk(legEnd, apex, distSq, width)) return null;
  return { legStart, legEnd };
}

// A rebuild may only remove NOISE, never geometry: every point the window
// drops must lie near the replacement wedge (leg → corner → leg). A needle
// tip's rounding hugs its wedge; a serif's flare stands several px off the
// straight legs that would replace it — measured: the HOUSE-H serifs were
// amputated by wide-arm rebuilds before this gate.
function replacementCoversRemoved(
  pts: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  legStart: Vec2,
  corner: Vec2,
  legEnd: Vec2,
  tolerancePx: number,
): boolean {
  for (let k = from; k < to; k += 1) {
    const p = pts[k];
    if (p === undefined) continue;
    const d = Math.min(pointToSegment(p, legStart, corner), pointToSegment(p, corner, legEnd));
    if (d > tolerancePx) return false;
  }
  return true;
}
