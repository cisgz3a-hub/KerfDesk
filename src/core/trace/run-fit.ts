// Shared run-fitting math for the chain-evening stages: total-least-squares
// lines, line-frame residual moments, and the least-squares quadratic
// r ≈ a + b·s + c·s² built on them. flatten-straight-runs.ts (line
// replacement) and even-arc-runs.ts (arc replacement) both fit candidate
// vertex runs with these; keeping one implementation guarantees the two
// stages classify against identical models.

import type { Vec2 } from '../scene';

// Determinants / knot spans under this magnitude are degenerate.
export const FIT_DEGENERATE_EPS = 1e-6;

export type FitLine = {
  readonly px: number;
  readonly py: number;
  readonly dx: number;
  readonly dy: number;
};

export type RunFrameStats = {
  readonly maxAbsResidual: number;
  readonly residualSumSq: number;
  /** Residuals past the caller's cap (gray-zone census). */
  readonly overCapCount: number;
  // Moments of the along-line coordinate s and residual r for the quadratic
  // normal equations (s is centred by the fit's centroid).
  readonly m1: number;
  readonly m2: number;
  readonly m3: number;
  readonly m4: number;
  readonly v0: number;
  readonly v1: number;
  readonly v2: number;
};

export type QuadraticFit = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly rms: number;
};

// Total-least-squares line through ring[start..end]: centroid plus the
// principal axis of the covariance (perpendicular residuals, standard
// closed form via the double-angle identity).
export function fitLineThroughRun(ring: ReadonlyArray<Vec2>, start: number, end: number): FitLine {
  const n = end - start + 1;
  let cx = 0;
  let cy = 0;
  for (let k = start; k <= end; k += 1) {
    const p = ring[k] as Vec2;
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let k = start; k <= end; k += 1) {
    const p = ring[k] as Vec2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: cx, py: cy, dx: Math.cos(theta), dy: Math.sin(theta) };
}

// One pass over the run in the fitted line's frame: per-point along-line
// coordinate s and perpendicular residual r, accumulated into the moments
// both models need.
export function runFrameStats(
  ring: ReadonlyArray<Vec2>,
  start: number,
  end: number,
  line: FitLine,
  capPx: number,
): RunFrameStats {
  let maxAbsResidual = 0;
  let residualSumSq = 0;
  let overCapCount = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let v0 = 0;
  let v1 = 0;
  let v2 = 0;
  for (let k = start; k <= end; k += 1) {
    const p = ring[k] as Vec2;
    const relX = p.x - line.px;
    const relY = p.y - line.py;
    const s = relX * line.dx + relY * line.dy;
    const r = relX * -line.dy + relY * line.dx;
    maxAbsResidual = Math.max(maxAbsResidual, Math.abs(r));
    if (Math.abs(r) > capPx) overCapCount += 1;
    residualSumSq += r * r;
    const s2 = s * s;
    m1 += s;
    m2 += s2;
    m3 += s2 * s;
    m4 += s2 * s2;
    v0 += r;
    v1 += s * r;
    v2 += s2 * r;
  }
  return { maxAbsResidual, residualSumSq, overCapCount, m1, m2, m3, m4, v0, v1, v2 };
}

// Least-squares quadratic r = a + b·s + c·s² over the run's frame stats
// (Cramer on the 3×3 normal equations; residual sum via the LS identity
// Σε² = Σr² − a·V0 − b·V1 − c·V2, clamped at 0 — a near-perfect fit can
// cancel to a tiny negative numerically). Null when the system is
// degenerate.
export function quadraticFitFromStats(stats: RunFrameStats, n: number): QuadraticFit | null {
  const { m1, m2, m3, m4, v0, v1, v2 } = stats;
  const det = n * (m2 * m4 - m3 * m3) - m1 * (m1 * m4 - m2 * m3) + m2 * (m1 * m3 - m2 * m2);
  if (Math.abs(det) < FIT_DEGENERATE_EPS || !Number.isFinite(det)) return null;
  const a = (v0 * (m2 * m4 - m3 * m3) - m1 * (v1 * m4 - v2 * m3) + m2 * (v1 * m3 - v2 * m2)) / det;
  const b = (n * (v1 * m4 - v2 * m3) - v0 * (m1 * m4 - m2 * m3) + m2 * (m1 * v2 - m2 * v1)) / det;
  const c = (n * (m2 * v2 - m3 * v1) - m1 * (m1 * v2 - m2 * v1) + v0 * (m1 * m3 - m2 * m2)) / det;
  const residualSumSq = stats.residualSumSq - a * v0 - b * v1 - c * v2;
  if (!Number.isFinite(residualSumSq)) return null;
  return { a, b, c, rms: Math.sqrt(Math.max(0, residualSumSq) / n) };
}

export type FitCircle = {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
};

// Radii above this are effectively straight lines — the line flattener's
// business, and numerically fragile as circles.
const MAX_FIT_CIRCLE_RADIUS = 1e5;

// Least-squares circle through ring[start..end] (Kasa's algebraic fit:
// minimize Σ(x² + y² + D·x + E·y + F)², a linear 3×3 system — the classic
// closed form). Coordinates are centred on the run's centroid for
// conditioning. Null when degenerate or effectively straight.
export function fitCircleThroughRun(
  ring: ReadonlyArray<Vec2>,
  start: number,
  end: number,
): FitCircle | null {
  const n = end - start + 1;
  let mx = 0;
  let my = 0;
  for (let k = start; k <= end; k += 1) {
    const p = ring[k] as Vec2;
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxz = 0;
  let syz = 0;
  let sz = 0;
  for (let k = start; k <= end; k += 1) {
    const p = ring[k] as Vec2;
    const x = p.x - mx;
    const y = p.y - my;
    const z = x * x + y * y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }
  // Centred coordinates make Σx = Σy = 0, collapsing the normal equations to
  // a 2×2 system for the centre plus a direct expression for r².
  const det = sxx * syy - sxy * sxy;
  if (Math.abs(det) < FIT_DEGENERATE_EPS || !Number.isFinite(det)) return null;
  const cx = (sxz * syy - syz * sxy) / (2 * det);
  const cy = (syz * sxx - sxz * sxy) / (2 * det);
  const rSq = cx * cx + cy * cy + sz / n;
  if (!Number.isFinite(rSq) || rSq <= 0) return null;
  const r = Math.sqrt(rSq);
  if (r > MAX_FIT_CIRCLE_RADIUS) return null;
  return { cx: cx + mx, cy: cy + my, r };
}

/** Project p onto the fitted line, returning its along-line coordinate. */
export function alongLineCoordinate(line: FitLine, p: Vec2): number {
  return (p.x - line.px) * line.dx + (p.y - line.py) * line.dy;
}

/** The point at along-line coordinate s with perpendicular offset r. */
export function pointInLineFrame(line: FitLine, s: number, r: number): Vec2 {
  return {
    x: line.px + s * line.dx + r * -line.dy,
    y: line.py + s * line.dy + r * line.dx,
  };
}
