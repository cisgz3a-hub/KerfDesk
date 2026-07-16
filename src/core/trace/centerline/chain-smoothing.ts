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
  let current: Vec2[] = [...points];
  for (let pass = 0; pass < CURVATURE_SMOOTHING_PASSES; pass += 1) {
    current = taubinStep(current, closed, pinned, TAUBIN_LAMBDA);
    current = taubinStep(current, closed, pinned, TAUBIN_MU);
  }
  return current;
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

// One Taubin pass. Pinned vertices are carried through as their ORIGINAL
// objects (identity preserved for reference-based corner pinning); every
// other interior vertex moves toward the midpoint of its neighbours by
// `factor`. Open-chain endpoints have no neighbour pair and stay put.
function taubinStep(
  src: ReadonlyArray<Vec2>,
  closed: boolean,
  pinned: ReadonlyArray<boolean>,
  factor: number,
): Vec2[] {
  const n = src.length;
  const out: Vec2[] = new Array<Vec2>(n);
  for (let i = 0; i < n; i += 1) {
    const p = src[i];
    if (p === undefined) continue;
    if (pinned[i] === true) {
      out[i] = p;
      continue;
    }
    const prev = closed ? src[(i - 1 + n) % n] : src[i - 1];
    const next = closed ? src[(i + 1) % n] : src[i + 1];
    if (prev === undefined || next === undefined) {
      out[i] = p;
      continue;
    }
    const midX = (prev.x + next.x) / 2;
    const midY = (prev.y + next.y) / 2;
    out[i] = { x: p.x + factor * (midX - p.x), y: p.y + factor * (midY - p.y) };
  }
  return out.filter((p): p is Vec2 => p !== undefined);
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
