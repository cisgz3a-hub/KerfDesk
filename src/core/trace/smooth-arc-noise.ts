// Local moving circle-fit smoothing of the DENSE chain — the arc
// counterpart of flatten-straight-runs.ts, at the stage where it is safe.
//
// Mid-wavelength boundary noise (±1px dents over ~10-20px, the "small
// wobble in the O") sits between what Taubin evening removes (a few px)
// and what the straight-run flattener may touch (arcs are protected from
// secant-cutting). A LOCAL least-squares circle through each vertex's
// ±window neighbourhood estimates where the underlying curve runs and
// pulls the vertex onto it. Locality is the safety property: a window only
// averages structure shorter than itself, so drawn art at wave scale
// (30px+ undulations, ±2px+ amplitude) passes through untouched — the
// run-level alternative (fitting whole arcs and resampling) was measured
// to average away 10 IoU points of real artwork.
//
// A circle is the right local model for BOTH regimes: on genuine arcs it
// is exact, and on straight spans Kasa's fit degenerates toward an
// enormous radius whose local surface is the fitted line. Windows
// containing a pinned corner, a hard turn, or feature-scale residuals are
// skipped; every movement is capped by the same Smoothness-scaled budget
// the flattener uses.

import type { Vec2 } from '../scene';
import { fitCircleThroughRun } from './run-fit';

// Window half-span in points (dense chains run ~0.7-0.8px/point, so ±12
// points ≈ ±9px — long enough to average the reported 10-20px dents, short
// enough to leave 30px+ drawn undulation alone).
const WINDOW_HALF_POINTS = 12;
// Baseline movement budget at strength 1 (the shared Smoothness scale).
const BASE_MAX_MOVE_PX = 1.0;
const MIN_ACTIVE_MOVE_PX = 0.2;
// A window whose worst circle residual exceeds this multiple of the budget
// contains feature geometry, not noise: skip it.
const FEATURE_RESIDUAL_FACTOR = 1.4;
// Turns at least this sharp bound windows like corners do (same convention
// as curve-refine / chain-smoothing).
const HARD_TURN_RAD = (60 * Math.PI) / 180;

/** Pull each dense vertex onto the least-squares circle of its local
 *  neighbourhood. Corner vertices never move and never participate in a
 *  window; open-chain endpoints stay exact. `strength` scales the movement
 *  budget (1 = baseline; 0 disables). */
export function smoothArcNoise(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  strength = 1,
): Vec2[] {
  const maxMovePx = BASE_MAX_MOVE_PX * Math.max(0, strength);
  if (points.length < 2 * WINDOW_HALF_POINTS + 1 || maxMovePx < MIN_ACTIVE_MOVE_PX) {
    return [...points];
  }
  // One pass attenuates dent-scale noise ~65%; the second reaches the
  // roundness bar. Corners are re-derived per pass from the ORIGINAL
  // blocked set semantics (the corner objects never move, so identity
  // lookups stay valid).
  let current = [...points];
  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    current = smoothOnce(current, closed, corners, maxMovePx);
  }
  return current;
}

const SMOOTHING_PASSES = 2;

function smoothOnce(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  maxMovePx: number,
): Vec2[] {
  const n = points.length;
  const blocked = blockedIndices(points, closed, corners);
  const out: Vec2[] = new Array<Vec2>(n);
  const window: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = points[i] as Vec2;
    if (blocked[i] === true) {
      out[i] = p;
      continue;
    }
    if (!fillWindow(window, points, closed, blocked, i)) {
      out[i] = p;
      continue;
    }
    out[i] = smoothedVertex(p, window, maxMovePx);
  }
  return out;
}

// Corner objects, hard turns, and (open chains) the endpoints neither move
// nor may appear inside another vertex's window — a window spanning a
// corner would fit a circle across two unrelated legs.
function blockedIndices(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
): boolean[] {
  const n = points.length;
  return points.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    if (corners.has(p)) return true;
    return turnAtIndex(points, i, closed) >= HARD_TURN_RAD;
  });
}

// Collect the ±WINDOW_HALF_POINTS neighbourhood of i into `window`,
// stopping at blocked vertices. False when either side is cut so short
// that the fit would lean on one side only.
function fillWindow(
  window: Vec2[],
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  blocked: ReadonlyArray<boolean>,
  i: number,
): boolean {
  const n = points.length;
  window.length = 0;
  const minSide = Math.floor(WINDOW_HALF_POINTS / 2);
  let reachBack = 0;
  for (let k = 1; k <= WINDOW_HALF_POINTS; k += 1) {
    const idx = closed ? (i - k + n) % n : i - k;
    if (idx < 0 || blocked[idx] === true) break;
    window.push(points[idx] as Vec2);
    reachBack = k;
  }
  let reachForward = 0;
  for (let k = 1; k <= WINDOW_HALF_POINTS; k += 1) {
    const idx = closed ? (i + k) % n : i + k;
    if (idx >= n || blocked[idx] === true) break;
    window.push(points[idx] as Vec2);
    reachForward = k;
  }
  window.push(points[i] as Vec2);
  return reachBack >= minSide && reachForward >= minSide;
}

// Fit the window's circle and project the vertex onto it — bounded by the
// movement budget, skipped entirely when the window carries feature-scale
// residuals or the fit is degenerate/straight (the flattener's regime).
function smoothedVertex(p: Vec2, window: ReadonlyArray<Vec2>, maxMovePx: number): Vec2 {
  const circle = fitCircleThroughRun(window, 0, window.length - 1);
  if (circle === null) return p;
  let maxResidual = 0;
  for (const q of window) {
    const dev = Math.abs(Math.hypot(q.x - circle.cx, q.y - circle.cy) - circle.r);
    maxResidual = Math.max(maxResidual, dev);
  }
  if (maxResidual > maxMovePx * FEATURE_RESIDUAL_FACTOR) return p;
  const dx = p.x - circle.cx;
  const dy = p.y - circle.cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return p;
  const target = { x: circle.cx + (dx / dist) * circle.r, y: circle.cy + (dy / dist) * circle.r };
  const move = Math.hypot(target.x - p.x, target.y - p.y);
  if (move > maxMovePx) return p;
  return target;
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
  if (inLen < 1e-9 || outLen < 1e-9) return 0;
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
