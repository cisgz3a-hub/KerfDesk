// A least-squares homography from many weighted point pairs (the exact
// four-point solve is in ./homography). Points are moved to their centre and
// scaled to about one first (Hartley normalisation), so millimetre sizes do
// not swamp the solve. Pure core.

import type { Mat3 } from './homography';
import { solveLinearSystem } from './linear-solve';
import type { Vec2 } from './model/camera-model';

/** One `from` → `to` correspondence with its weight. */
export type WeightedPair = { readonly from: Vec2; readonly to: Vec2; readonly weight: number };

type Normaliser = {
  readonly apply: (p: Vec2) => Vec2;
  readonly matrix: ReadonlyArray<number>;
  readonly inverse: ReadonlyArray<number>;
};

/** The homography that best maps each `from` onto its `to` in the weighted
 * least-squares sense; null when the points are degenerate. */
export function weightedHomography(pairs: ReadonlyArray<WeightedPair>): Mat3 | null {
  const from = normaliser(pairs.map((pair) => pair.from));
  const to = normaliser(pairs.map((pair) => pair.to));
  const normal = Array.from({ length: 8 }, () => new Array<number>(9).fill(0));
  for (const pair of pairs) {
    const { x, y } = from.apply(pair.from);
    const { x: u, y: v } = to.apply(pair.to);
    addNormalRow(normal, [x, y, 1, 0, 0, 0, -u * x, -u * y, u], pair.weight);
    addNormalRow(normal, [0, 0, 0, x, y, 1, -v * x, -v * y, v], pair.weight);
  }
  const solution = solveLinearSystem(normal, 8);
  if (solution === null) return null;
  // H = To⁻¹ · Hn · From, scaled so its last entry is one.
  const full = multiply3(to.inverse, multiply3([...solution, 1], from.matrix));
  return asMat3(full);
}

// Scaled so the last entry is one; null when that cannot be done.
function asMat3(full: ReadonlyArray<number>): Mat3 | null {
  const scale = full[8] ?? 0;
  if (!(Math.abs(scale) > 1e-12)) return null;
  const m = full.map((value) => value / scale);
  if (m.length !== 9 || !m.every(Number.isFinite)) return null;
  return m as unknown as Mat3;
}

// Add weight · rowᵀ·row (coefficients by coefficients and right-hand side).
function addNormalRow(normal: number[][], row: ReadonlyArray<number>, weight: number): void {
  for (let i = 0; i < 8; i += 1) {
    const target = normal[i];
    if (target === undefined) continue;
    const ri = (row[i] ?? 0) * weight;
    for (let j = 0; j < 9; j += 1) target[j] = (target[j] ?? 0) + ri * (row[j] ?? 0);
  }
}

function multiply3(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number[] {
  return Array.from({ length: 9 }, (_, k) => {
    const i = Math.floor(k / 3);
    const j = k % 3;
    let sum = 0;
    for (let n = 0; n < 3; n += 1) sum += (a[i * 3 + n] ?? 0) * (b[n * 3 + j] ?? 0);
    return sum;
  });
}

function normaliser(points: ReadonlyArray<Vec2>): Normaliser {
  const n = points.length;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / n;
  const spread = points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const k = spread > 0 ? Math.SQRT2 / spread : 1;
  return {
    apply: (p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k }),
    matrix: [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1],
    inverse: [1 / k, 0, cx, 0, 1 / k, cy, 0, 0, 1],
  };
}
