// Output curve refinement. Douglas-Peucker emits sparse polygonal vertices,
// and the app draws those chords literally — every curve renders as visible
// flat facets (the faceted-letters defect). The dense chain is already
// evened toward smooth curvature upstream (chain-smoothing.ts), so the
// refine step's only job is to REPLACE the chords with a smooth curve that
// passes through the vertices without kinking at them. A centripetal
// Catmull-Rom resample does exactly that (curve-fit.ts): moderate turns
// between vertices become smooth arcs, while genuine corners break the spline
// and are emitted exactly. Chaikin was rejected here — its chord-quartering
// leaves a facet at every pinned soft-turn vertex, so it cannot smooth an
// already-evened curve.

import type { Vec2 } from '../../scene';
import { fitSmoothCurve } from './curve-fit';

// Turns at least this sharp are corners: they break the smooth spline so their
// legs stay straight. Matches the hard-corner threshold used across the
// sharpener and the dense-chain evening, so a junction weld or loop-closure
// corner the sharpener never rebuilt is still treated as a corner here.
const HARD_CORNER_RAD = (60 * Math.PI) / 180;
// Potrace's published corner criterion pairs a sharp angle with STRAIGHT
// legs. A hard turn whose neighbour keeps turning the SAME direction is a
// drawn rounding that Douglas-Peucker collapsed onto one vertex; pinning it
// renders a rounded terminal as an angular beak and a hooked apex as a
// flick (the Arch House "sharp corners"/"sharp points" verdicts,
// 2026-07-10). The sharper the candidate, the stronger the flank-curvature
// evidence required to unpin it; genuine needle tips arrive sharpener-marked
// (ink evidence) via drawnCorners and are never unpinned here.
const NEEDLE_TURN_RAD = (90 * Math.PI) / 180;
const CURVE_CONTINUATION_RAD = (20 * Math.PI) / 180;
const NEEDLE_CONTINUATION_RAD = (30 * Math.PI) / 180;
// Continuation evidence is only geometry when the vertices carrying it are
// far enough apart — at small-glyph scale post-DP segments shrink to ~1px
// and EVERY neighbour "turns", which would unpin genuine tiny-letter apexes
// (the small-glyph fidelity instrument caught exactly that: A-glyph mean
// boundary distance 0.30 → 0.31px).
const MIN_CONTINUATION_LEG_PX = 2;
// New samples placed inside each spline segment. Four keeps the drawn curve
// smooth at engraving scale while holding the total point count near the
// simplified-vertex budget (a smooth curve needs even curvature, not brute
// density).
const SAMPLES_PER_SEGMENT = 3;
const NEAR_POINT_EPS = 1e-9;
const NO_CORNERS: ReadonlySet<Vec2> = new Set();

/** Round a simplified chain for output. Drawn corners (marked by the bend
 *  sharpener, by reference), hard turns, and open-chain endpoints stay exact;
 *  smooth spans resample into an even-curvature Catmull-Rom curve.
 *
 *  `deviationCapPx` is the Douglas-Peucker tolerance ε the caller simplified
 *  with. The resample may smooth within ε of each chord but must not bow
 *  further into empty paper — that bounds the serif-foot overshoot without
 *  re-faceting discs (a genuine arc's sagitta between simplified vertices is
 *  ≤ ε). Omit to leave the resample unbounded. */
export function refineChainForOutput(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  drawnCorners: ReadonlySet<Vec2> = NO_CORNERS,
  deviationCapPx = Infinity,
): Vec2[] {
  if (points.length < 3) return [...points];
  const corners = collectCorners(points, closed, drawnCorners);
  return fitSmoothCurve(points, closed, corners, SAMPLES_PER_SEGMENT, deviationCapPx);
}

// Corners that break the spline: the sharpener's rebuilt vertices plus any
// hard turn it never saw. Soft and moderate turns are deliberately NOT
// corners — the upstream evening already made them genuine curve, so letting
// the spline flow through them is what removes the facets.
function collectCorners(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  drawnCorners: ReadonlySet<Vec2>,
): ReadonlySet<Vec2> {
  const corners = new Set<Vec2>();
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    if (drawnCorners.has(p)) {
      corners.add(p);
      continue;
    }
    const turn = Math.abs(signedTurnAtIndex(points, i, closed));
    if (turn < HARD_CORNER_RAD) continue;
    const continuationRad =
      turn >= NEEDLE_TURN_RAD ? NEEDLE_CONTINUATION_RAD : CURVE_CONTINUATION_RAD;
    if (isFilletContinuation(points, i, closed, continuationRad)) continue;
    corners.add(p);
  }
  return corners;
}

// True when either neighbour keeps turning the candidate's direction — the
// signature of a collapsed rounded terminal, not a drawn corner.
function isFilletContinuation(
  points: ReadonlyArray<Vec2>,
  i: number,
  closed: boolean,
  continuationRad: number,
): boolean {
  const sign = Math.sign(signedTurnAtIndex(points, i, closed));
  const at = points[i];
  if (at === undefined) return false;
  for (const j of [i - 1, i + 1]) {
    const wrapped = wrapIndex(j, points.length, closed);
    const neighbour = points[wrapped];
    if (neighbour === undefined) continue;
    if (Math.hypot(neighbour.x - at.x, neighbour.y - at.y) < MIN_CONTINUATION_LEG_PX) continue;
    const neighbourTurn = signedTurnAtIndex(points, wrapped, closed);
    if (Math.abs(neighbourTurn) >= continuationRad && Math.sign(neighbourTurn) === sign) {
      return true;
    }
  }
  return false;
}

// Out-of-range neighbours on open chains resolve to the endpoint, whose turn
// reads 0 — they can never mark a continuation.
function wrapIndex(i: number, n: number, closed: boolean): number {
  if (closed) return (i + n) % n;
  return Math.min(n - 1, Math.max(0, i));
}

function signedTurnAtIndex(points: ReadonlyArray<Vec2>, i: number, closed: boolean): number {
  const n = points.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const prev = points[(i - 1 + n) % n];
  const at = points[i];
  const next = points[(i + 1) % n];
  if (prev === undefined || at === undefined || next === undefined) return 0;
  return signedTurnAt(prev, at, next);
}

function signedTurnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen < NEAR_POINT_EPS || outLen < NEAR_POINT_EPS) return 0;
  const inX = (at.x - prev.x) / inLen;
  const inY = (at.y - prev.y) / inLen;
  const outX = (next.x - at.x) / outLen;
  const outY = (next.y - at.y) / outLen;
  return Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);
}
