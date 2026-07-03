import type { Vec2 } from '../scene';
import { solveLinearSystem } from './linear-solve';

/** Row-major 3x3 projective transform `[m0 m1 m2; m3 m4 m5; m6 m7 m8]`. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** One `src` -> `dst` correspondence (e.g. camera pixel -> bed mm). */
export type PointPair = { readonly src: Vec2; readonly dst: Vec2 };

/** Result of {@link solveHomography}: a matrix, or a typed failure reason. */
export type HomographyResult =
  | { readonly ok: true; readonly matrix: Mat3 }
  | { readonly ok: false; readonly reason: 'need-four-points' | 'degenerate' };

const REQUIRED_POINTS = 4;
const UNKNOWNS = 8;

/**
 * Solve the exact 3x3 homography mapping each `src` onto its `dst` from
 * exactly four correspondences (8 DOF, `m8` fixed to 1) — the model LightBurn
 * and MeerK40t use for manual camera alignment. Returns a typed failure for
 * the wrong point count or a degenerate (e.g. collinear) configuration. The
 * caller must apply any image-y-down -> bed-y-up flip before building pairs.
 */
export function solveHomography(pairs: ReadonlyArray<PointPair>): HomographyResult {
  if (pairs.length !== REQUIRED_POINTS) {
    return { ok: false, reason: 'need-four-points' };
  }
  const solution = solveLinearSystem(buildSystem(pairs), UNKNOWNS);
  if (solution === null) {
    return { ok: false, reason: 'degenerate' };
  }
  return { ok: true, matrix: toMatrix(solution) };
}

/** Map a point through a homography, including the perspective divide. */
export function applyHomography(matrix: Mat3, point: Vec2): Vec2 {
  const { x, y } = point;
  const w = matrix[6] * x + matrix[7] * y + matrix[8];
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / w,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / w,
  };
}

// Each correspondence (x, y) -> (u, v) contributes two rows of the 8x8 system
// for the unknowns m0..m7 (m8 == 1):
//   x*m0 + y*m1 + m2 - u*x*m6 - u*y*m7 = u
//   x*m3 + y*m4 + m5 - v*x*m6 - v*y*m7 = v
function buildSystem(pairs: ReadonlyArray<PointPair>): number[][] {
  const rows: number[][] = [];
  for (const { src, dst } of pairs) {
    const { x, y } = src;
    const { x: u, y: v } = dst;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  return rows;
}

function toMatrix(solution: number[]): Mat3 {
  const [m0, m1, m2, m3, m4, m5, m6, m7] = solution;
  return [m0 ?? 0, m1 ?? 0, m2 ?? 0, m3 ?? 0, m4 ?? 0, m5 ?? 0, m6 ?? 0, m7 ?? 0, 1];
}
