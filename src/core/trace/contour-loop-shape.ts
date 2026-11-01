// Lattice and corner-span helpers for the contour loop finish, split from
// contour-trace.ts (file cap). Pure functions.

import type { Vec2 } from '../scene';
import { smoothRawChain, type InkMask } from './centerline';

// A lattice vertex where ink touches ink only diagonally (a 2x2 checkerboard):
// two boundary passages meet there, one per touching component or twice for
// one pinched loop.
export function isSaddleVertex(mask: InkMask, vertex: Vec2): boolean {
  const { x, y } = vertex;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const at = (px: number, py: number): number =>
    px < 0 || py < 0 || px >= mask.width || py >= mask.height
      ? 0
      : (mask.ink[py * mask.width + px] ?? 0);
  const a = at(x - 1, y - 1);
  const b = at(x, y - 1);
  const c = at(x - 1, y);
  const d = at(x, y);
  return a === d && b === c && a !== b;
}

// Taubin pre-smoothing between corner apexes: each span between two corners
// is smoothed as an open chain, so its end apexes stay fixed as the same
// objects. Without corners this is exactly the closed-ring pass. The output
// is index-aligned with the input.
export function smoothBetweenCorners(
  points: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
): Vec2[] {
  if (corners.size === 0) return smoothRawChain(points, true);
  const n = points.length;
  const first = points.findIndex((point) => corners.has(point));
  const out: Vec2[] = new Array<Vec2>(n);
  let spanStart = 0;
  for (let k = 1; k <= n; k += 1) {
    if (k < n && !corners.has(points[(first + k) % n] as Vec2)) continue;
    const span: Vec2[] = [];
    for (let j = spanStart; j <= k; j += 1) span.push(points[(first + j) % n] as Vec2);
    const smoothed = smoothRawChain(span, false);
    for (let j = 0; j < smoothed.length - 1; j += 1) {
      out[(first + spanStart + j) % n] = smoothed[j] as Vec2;
    }
    spanStart = k;
  }
  return out;
}

// A loop this narrow on average (twice its area over its perimeter, source px)
// is a hairline ribbon: both sides of it lie one staircase step apart.
const HAIRLINE_MEAN_WIDTH_PX = 1.5;

/** True for a hairline ribbon of a binary loop (ADR-530 Amendment 11). The
 *  binary tail's staircase model (straight-run flattening, simplification and
 *  the spline resample) moves each side by up to its own tolerance, which on a
 *  ribbon this narrow pinches it: a 1-px 30 or 60 degree diagonal kept 0.41 of
 *  its pixels on Smooth and 0.70 on Line Art. Its crack chain is fitted
 *  directly instead, as a measured loop's is. */
export function isHairlineRibbon(staircase: ReadonlyArray<Vec2>, pixelScale: number): boolean {
  const n = staircase.length;
  let twiceArea = 0;
  for (let i = 0; i < n; i += 1) {
    const p = staircase[i] as Vec2;
    const q = staircase[(i + 1) % n] as Vec2;
    twiceArea += p.x * q.y - q.x * p.y;
  }
  // The staircase has one point per unit step, so n is its perimeter.
  return Math.abs(twiceArea) < HAIRLINE_MEAN_WIDTH_PX * n * pixelScale;
}
