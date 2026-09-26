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
