// Corner-anchored curvature smoothing for the DENSE stroke chain.
//
// The tracer's dense chain — even after sub-pixel ridge snapping and the two
// early Taubin passes — carries pixel-scale curvature NOISE: neighbouring
// vertices sit a hair off the true edge in independent directions, so the
// line does not turn EVENLY the way a fitted Bezier does. Douglas-Peucker
// then samples that noisy curve and every sampled vertex inherits a
// slightly-wrong tangent, baking visible facets into small-letter bowls
// (the "B bowls look angular" defect, 2026-07-04). Simplification is not the
// lever — the faceting is already in the chain — so we smooth the chain
// BEFORE it is thinned.
//
// The smoother is the same shrink-free Taubin lambda|mu operator the raw
// pass uses (mu re-inflates what lambda contracts, so closed bowls do not
// melt), but run to convergence with the drawn corners held FIXED. Anchors —
// the bend sharpener's rebuilt corner vertices, any hard turn the sharpener
// never saw (junction welds, loop-closure corners), and the endpoints of an
// open chain — never move and are emitted as their ORIGINAL objects, so the
// corner set that output refinement pins by reference survives untouched.
// Between two anchors the pass acts as a fixed-endpoint diffusion that
// converges toward an even-curvature arc; corners stay exact.

import type { Vec2 } from '../../scene';

// Same shrink-free constants as the raw pass in stroke-chains.ts: lambda
// smooths, the slightly-larger negative mu re-inflates so a closed loop keeps
// its area instead of melting toward its centroid.
const TAUBIN_LAMBDA = 0.5;
const TAUBIN_MU = -0.53;
// A lambda+mu pair barely moves any single point; reaching an even-curvature
// distribution on a letter-scale bowl needs several. Corners are pinned, so
// extra passes cannot round them — they only even out the noisy spans.
const CURVATURE_SMOOTHING_PASSES = 8;
// Turns at least this sharp are drawn corners regardless of whether the bend
// sharpener rebuilt them (matches the hard-corner pin in curve-refine.ts):
// junction welds and loop-closure corners land here. Pin them so smoothing
// never rounds a genuine corner.
const HARD_ANCHOR_RAD = (60 * Math.PI) / 180;
const NEAR_POINT_EPS = 1e-9;

/**
 * Smooth the non-corner spans of a dense chain toward even curvature while
 * holding drawn corners and open-chain endpoints exactly in place.
 *
 * @param anchors Drawn-corner vertices by object reference (the bend
 *   sharpener's output). These, plus hard turns and open-chain endpoints, are
 *   pinned and returned as their original objects so downstream corner pinning
 *   by identity still matches.
 */
export function smoothChainCurvature(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  anchors: ReadonlySet<Vec2>,
): Vec2[] {
  if (points.length < 3) return [...points];
  const pinned = classifyAnchors(points, closed, anchors);
  // The passes run on coordinate buffers; points are materialised once at the
  // end instead of one fresh object per vertex per pass. Pinned vertices hold
  // their coordinates in both buffers, so a pass writes only the free ones.
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = points[i] as Vec2;
    xs[i] = p.x;
    ys[i] = p.y;
  }
  const nextXs = xs.slice();
  const nextYs = ys.slice();
  const free = freeIndices(pinned);
  for (let pass = 0; pass < CURVATURE_SMOOTHING_PASSES; pass += 1) {
    taubinStep(xs, ys, nextXs, nextYs, free, TAUBIN_LAMBDA);
    taubinStep(nextXs, nextYs, xs, ys, free, TAUBIN_MU);
  }
  return points.map((p, i) =>
    pinned[i] === true ? p : { x: xs[i] as number, y: ys[i] as number },
  );
}

// Anchor = pinned exactly. Classification uses the ORIGINAL geometry so it is
// stable across passes (a point flagged a corner up front never becomes
// smoothable as its neighbours move). Exported so the arc-length fairing
// stage pins the identical vertex set (corners, hard turns, open endpoints).
export function classifyAnchors(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  anchors: ReadonlySet<Vec2>,
): boolean[] {
  const n = points.length;
  return points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true; // open-chain endpoints
    if (anchors.has(p)) return true; // sharpener-rebuilt drawn corners
    return turnAtIndex(points, i, closed) >= HARD_ANCHOR_RAD;
  });
}

// The vertices a pass moves: every one not pinned. Open-chain endpoints are
// pinned (they have no neighbour pair).
function freeIndices(pinned: ReadonlyArray<boolean>): Int32Array {
  let count = 0;
  for (const isPinned of pinned) if (!isPinned) count += 1;
  const free = new Int32Array(count);
  let at = 0;
  for (let i = 0; i < pinned.length; i += 1) if (!pinned[i]) free[at++] = i;
  return free;
}

// One Taubin pass from (xs, ys) into (outX, outY). Pinned vertices keep their
// coordinates (and, at the end, their ORIGINAL objects, for reference-based
// corner pinning); every free vertex moves toward the midpoint of its
// neighbours by `factor`.
function taubinStep(
  xs: Float64Array,
  ys: Float64Array,
  outX: Float64Array,
  outY: Float64Array,
  free: Int32Array,
  factor: number,
): void {
  const n = xs.length;
  for (const i of free) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    const prev = i === 0 ? n - 1 : i - 1;
    const next = i === n - 1 ? 0 : i + 1;
    const midX = ((xs[prev] as number) + (xs[next] as number)) / 2;
    const midY = ((ys[prev] as number) + (ys[next] as number)) / 2;
    outX[i] = x + factor * (midX - x);
    outY[i] = y + factor * (midY - y);
  }
}

function turnAtIndex(points: ReadonlyArray<Vec2>, i: number, closed: boolean): number {
  const n = points.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const prev = points[(i - 1 + n) % n];
  const at = points[i];
  const next = points[(i + 1) % n];
  if (prev === undefined || at === undefined || next === undefined) return 0;
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen < NEAR_POINT_EPS || outLen < NEAR_POINT_EPS) return 0;
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
