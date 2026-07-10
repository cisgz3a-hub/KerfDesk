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
// closed-ring rotation); the pure geometric predicates it calls live in
// bend-geometry.ts.

import type { Vec2 } from '../../scene';
import {
  MAX_VERTEX_OFFSET_FACTOR,
  apexReachScale,
  apexSupportedByInk,
  arcLengthOf,
  bendVertex,
  bendWindow,
  legIsStraight,
  netTurnAcross,
  pointToSegment,
  quickTurnAt,
  turnIsConcentrated,
  vertexHugsChain,
} from './bend-geometry';
import { trimArc } from './polyline-window';

const QUICK_TURN_GATE_RAD = (20 * Math.PI) / 180;
// One corner per physical corner: after a rebuild, nearby candidates (the
// corner sits inside their windows) can mint their OWN slightly-different
// vertex — measured as 4-6 chattered corner vertices per bar corner spread
// over ~2px, whose worst member tilts the straight-run fit of the whole
// adjacent edge. A rebuilt vertex landing this close to an existing corner
// is the same corner and is dropped.
const CORNER_MIN_SEPARATION_PX = 2.5;
// A closed chain's window may not swallow the whole loop: cap the arm so two
// corners of a tiny feature can't trim each other away.
const CLOSED_ARM_LENGTH_DIVISOR = 6;
// Iteration budget: a base allowance plus one chain-length per replacement
// (each closed replacement rotates the array and restarts the scan). The
// base absorbs the no-replacement scan; the floor keeps small chains fair.
const GUARD_BASE_BUDGET = 64;
const MIN_REPLACEMENT_BUDGET = 8;

export type SharpenedChain = {
  readonly points: Vec2[];
  /** The rebuilt drawn-corner vertices, by object reference. Output
   *  refinement pins exactly these — they carry dense-chain evidence
   *  (straight legs, vertex hugging the chain) that no post-simplification
   *  angle heuristic can recover. */
  readonly corners: ReadonlySet<Vec2>;
};

/** Sharpen concentrated bends of a chain. Closed chains are handled by
 *  rotation (a closed polyline is rotation-invariant), so ring corners
 *  sharpen exactly like open-chain corners. */
export function sharpenChainBends(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  distSq: Float64Array,
  width: number,
): SharpenedChain {
  let pts = [...points];
  const corners = new Set<Vec2>();
  let i = 1;
  // Every closed-chain replacement restarts the scan (the returned array is
  // rotated), so the iteration budget must grow with each replacement — a
  // fixed multiple of n exhausts mid-scan on rings with many drawn corners
  // (a gear or star) and silently leaves the rest chamfered. Replacements
  // themselves are finite: the vertex-gain guard makes each corner fire once.
  let guard = pts.length * 2 + GUARD_BASE_BUDGET;
  let replacementsLeft = Math.max(MIN_REPLACEMENT_BUDGET, Math.ceil(pts.length / 2));
  while (guard > 0) {
    guard -= 1;
    if (i >= (closed ? pts.length : pts.length - 1)) break;
    if (quickTurnAt(pts, i, closed) < QUICK_TURN_GATE_RAD) {
      i += 1;
      continue;
    }
    const bent = closed
      ? trySharpenClosed(pts, i, distSq, width)
      : trySharpenOpen(pts, i, distSq, width);
    if (bent === null || tooCloseToExistingCorner(bent.corner, corners)) {
      i += 1;
      continue;
    }
    pts = bent.points;
    corners.add(bent.corner);
    replacementsLeft -= 1;
    if (replacementsLeft <= 0) break;
    guard += pts.length;
    // A closed replacement returns a ROTATED array — earlier indices now hold
    // unscanned points, so restart. Open arrays keep their prefix; skip ahead.
    i = closed ? 1 : bent.resumeAt;
  }
  return { points: pts, corners };
}

type BendResult = {
  readonly points: Vec2[];
  readonly resumeAt: number;
  readonly corner: Vec2;
};

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

function trySharpenOpen(
  pts: ReadonlyArray<Vec2>,
  i: number,
  distSq: Float64Array,
  width: number,
  maxArm = Infinity,
): BendResult | null {
  const window = bendWindow(pts, i, distSq, width);
  const baseArm = Math.min(window.arm, maxArm);
  const base = attemptBend(pts, i, baseArm, window.maxRadius, distSq, width);
  if (base !== null) return base;
  const nearTurn = netTurnAcross(pts, i, RETRY_NEAR_SPAN_PX);
  if (nearTurn === null || nearTurn < RETRY_MIN_NEAR_TURN_RAD) return null;
  for (const armPx of RETRY_ARMS_PX) {
    if (armPx <= baseArm || armPx > maxArm) continue;
    const turn = netTurnAcross(pts, i, armPx);
    if (turn === null || turn < RETRY_MIN_TURN_RAD) continue;
    const bent = attemptBend(pts, i, armPx, window.maxRadius, distSq, width);
    if (bent !== null) return bent;
  }
  return null;
}

function attemptBend(
  pts: ReadonlyArray<Vec2>,
  i: number,
  arm: number,
  maxRadius: number,
  distSq: Float64Array,
  width: number,
): BendResult | null {
  const p = pts[i];
  if (p === undefined) return null;
  const head = trimArc(pts.slice(0, i + 1), 'tail', arm);
  const tail = trimArc(pts.slice(i), 'head', arm);
  if (head.length < 2 || tail.length < 2) return null;
  // A drawn corner has straight legs and its turn CONCENTRATED at the
  // vertex; a glyph-scale curve (radius near the window size) passes the leg
  // test but turns uniformly, so the concentration gate rejects it.
  if (!legIsStraight(pts, i, arm, 'before') || !legIsStraight(pts, i, arm, 'after')) return null;
  if (!turnIsConcentrated(pts, i, arm)) return null;
  const bend = bendVertex(head, tail);
  if (bend === null) return null;
  const wedge = wedgeInkSupport(head, tail, bend.vertex, distSq, width);
  if (wedge === null) return null;
  const { legStart, legEnd } = wedge;
  const removedFrom = head.length;
  const removedTo = pts.length - tail.length;
  const maxOffset = maxRadius * MAX_VERTEX_OFFSET_FACTOR * apexReachScale(bend.turnRad);
  if (!vertexHugsChain(bend.vertex, pts, removedFrom, removedTo, maxOffset)) return null;
  if (
    !replacementCoversRemoved(pts, removedFrom, removedTo, legStart, bend.vertex, legEnd, maxOffset)
  ) {
    return null;
  }
  return {
    points: [...head, bend.vertex, ...tail],
    resumeAt: head.length + 1,
    corner: bend.vertex,
  };
}

// Physical gate: ink must accompany BOTH wedge legs to the apex. The
// reach-scaled hugs/coverage tolerances legitimately widen for needle-sharp
// turns (a real tip's apex stands ~radius past the rounded chain end), but
// that same allowance let blunt serif terminals extend into blank
// background — the intersection of two shallow leg fits is a fabrication
// unless the drawn stroke actually runs there (the Arch House serif-spike
// defect).
function wedgeInkSupport(
  head: ReadonlyArray<Vec2>,
  tail: ReadonlyArray<Vec2>,
  apex: Vec2,
  distSq: Float64Array,
  width: number,
): { readonly legStart: Vec2; readonly legEnd: Vec2 } | null {
  const legStart = head.at(-1);
  const legEnd = tail[0];
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

// Rotate the closed chain so the candidate sits mid-array, then reuse the
// open-chain logic there. The result stays closed; its start point moves,
// which a closed polyline doesn't care about.
function trySharpenClosed(
  pts: ReadonlyArray<Vec2>,
  i: number,
  distSq: Float64Array,
  width: number,
): BendResult | null {
  const mid = Math.floor(pts.length / 2);
  const shift = (i - mid + pts.length) % pts.length;
  const rotated = [...pts.slice(shift), ...pts.slice(0, shift)];
  const maxArm = arcLengthOf(pts) / CLOSED_ARM_LENGTH_DIVISOR;
  return trySharpenOpen(rotated, mid, distSq, width, maxArm);
}
