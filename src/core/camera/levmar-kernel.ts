// Numeric kernels for the Levenberg-Marquardt driver (ADR-108, calibration v2.c):
// residual evaluation, the central-difference linearization (cost, gradient,
// Gauss-Newton Hessian), the damped normal-equation step, and the small vector
// reductions the driver iterates over. Pure: no clock, RNG, or I/O. Split from
// levmar.ts only to keep each file inside the size limit (cf. linear-solve.ts).

import { solveLinearSystem } from './linear-solve';

const ONE_THIRD = 1 / 3;
// Floor each Marquardt diagonal so an all-zero Jacobian column (an unobserved
// parameter) still yields a solvable, well-damped system instead of a hang.
const DIAG_FLOOR = 1e-12;
// Central-difference relative step ≈ ε^(1/3); the absolute floor is load-bearing
// because parameters initialised to 0 would otherwise get a zero step (dead column).
const REL_STEP = Math.cbrt(Number.EPSILON);
const ABS_STEP_FLOOR = 1e-6;

/** Residual vector r(p); its length m must stay constant across all calls. */
export type ResidualFn = (params: ReadonlyArray<number>) => number[];

export type EvalResult =
  | { readonly kind: 'ok'; readonly r: number[] }
  | { readonly kind: 'bad-length' }
  | { readonly kind: 'non-finite' };

export type Linearization =
  | {
      readonly kind: 'ok';
      readonly r: number[];
      readonly cost: number;
      readonly a: number[][];
      readonly g: number[];
    }
  | { readonly kind: 'bad-length' }
  | { readonly kind: 'non-finite' };

/** Evaluate the residual, checking finiteness and (when `expected` is set) length. */
export function evalResidual(
  fn: ResidualFn,
  params: ReadonlyArray<number>,
  expected: number | undefined,
): EvalResult {
  const r = fn(params);
  if (expected !== undefined && r.length !== expected) return { kind: 'bad-length' };
  for (const value of r) {
    if (!Number.isFinite(value)) return { kind: 'non-finite' };
  }
  return { kind: 'ok', r };
}

/**
 * Linearize the residual at `params`: its cost, gradient Jᵀr, and Hessian JᵀJ.
 * Parameters in `fixed` are held constant — their Jacobian column is left zero, so
 * the damped solve gives them a ~zero step and they never move from their seed.
 */
export function relinearize(
  fn: ResidualFn,
  params: ReadonlyArray<number>,
  n: number,
  m: number,
  fixed: ReadonlySet<number>,
): Linearization {
  const evaluated = evalResidual(fn, params, m);
  if (evaluated.kind !== 'ok') return evaluated;
  const jac = numericJacobian(fn, params, n, m, fixed);
  if (jac.kind !== 'ok') return jac;
  return {
    kind: 'ok',
    r: evaluated.r,
    cost: costOf(evaluated.r),
    a: approxHessian(jac.j, n, m),
    g: gradient(jac.j, evaluated.r, n, m),
  };
}

function numericJacobian(
  fn: ResidualFn,
  params: ReadonlyArray<number>,
  n: number,
  m: number,
  fixed: ReadonlySet<number>,
):
  | { readonly kind: 'ok'; readonly j: number[][] }
  | { readonly kind: 'bad-length' }
  | { readonly kind: 'non-finite' } {
  const j: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  const probe = params.slice();
  for (let col = 0; col < n; col += 1) {
    if (fixed.has(col)) continue; // held constant: leave its column zero
    const base = probe[col] ?? 0;
    const step = Math.max(REL_STEP * Math.abs(base), ABS_STEP_FLOOR);
    probe[col] = base + step;
    const plus = evalResidual(fn, probe, m);
    if (plus.kind !== 'ok') return plus;
    probe[col] = base - step;
    const minus = evalResidual(fn, probe, m);
    if (minus.kind !== 'ok') return minus;
    probe[col] = base;
    const inv = 1 / (2 * step);
    for (let row = 0; row < m; row += 1) {
      const target = j[row];
      if (target === undefined) continue;
      target[col] = ((plus.r[row] ?? 0) - (minus.r[row] ?? 0)) * inv;
    }
  }
  return { kind: 'ok', j };
}

// g[a] = Σᵢ Jᵢₐ·rᵢ — the gradient of 0.5·Σrᵢ².
function gradient(j: number[][], r: number[], n: number, m: number): number[] {
  const g = new Array<number>(n).fill(0);
  for (let row = 0; row < m; row += 1) {
    const jr = j[row];
    const ri = r[row] ?? 0;
    if (jr === undefined) continue;
    for (let col = 0; col < n; col += 1) g[col] = (g[col] ?? 0) + (jr[col] ?? 0) * ri;
  }
  return g;
}

// A[a][b] = Σᵢ Jᵢₐ·Jᵢᵦ — the Gauss-Newton approximate Hessian JᵀJ.
function approxHessian(j: number[][], n: number, m: number): number[][] {
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let row = 0; row < m; row += 1) {
    const jr = j[row];
    if (jr === undefined) continue;
    for (let p = 0; p < n; p += 1) {
      const jp = jr[p] ?? 0;
      const ap = a[p];
      if (ap === undefined) continue;
      for (let q = 0; q < n; q += 1) ap[q] = (ap[q] ?? 0) + jp * (jr[q] ?? 0);
    }
  }
  return a;
}

/**
 * Solve (A + λ·diag(A))·δ = -g via the in-place Gauss-Jordan solver, building a
 * FRESH augmented matrix each call (the solver mutates rows). Returns null on a
 * singular system. The right-hand side is the NEGATIVE gradient — dropping the
 * sign would make the driver ascend.
 */
export function dampedSolve(
  a: number[][],
  g: number[],
  lambda: number,
  n: number,
): number[] | null {
  const rows: number[][] = [];
  for (let p = 0; p < n; p += 1) {
    const ap = a[p];
    if (ap === undefined) return null;
    const augmented = new Array<number>(n + 1).fill(0);
    for (let q = 0; q < n; q += 1) augmented[q] = ap[q] ?? 0;
    const diagonal = Math.max(ap[p] ?? 0, DIAG_FLOOR);
    augmented[p] = (augmented[p] ?? 0) + lambda * diagonal;
    augmented[n] = -(g[p] ?? 0);
    rows.push(augmented);
  }
  return solveLinearSystem(rows, n);
}

// Predicted cost reduction of the damped step: 0.5·δᵀ(λ·D·δ - g). Only used to
// drive the λ schedule — acceptance is the actual cost decrease, not this.
export function gainDenominator(
  delta: number[],
  g: number[],
  a: number[][],
  lambda: number,
  n: number,
): number {
  let sum = 0;
  for (let p = 0; p < n; p += 1) {
    const dp = delta[p] ?? 0;
    const diagonal = Math.max(a[p]?.[p] ?? 0, DIAG_FLOOR);
    sum += dp * (lambda * diagonal * dp - (g[p] ?? 0));
  }
  return 0.5 * sum;
}

export function nextLambdaAccept(lambda: number, costDrop: number, denom: number): number {
  if (denom <= 0) return lambda * ONE_THIRD;
  const rho = costDrop / denom;
  return lambda * Math.max(ONE_THIRD, 1 - Math.pow(2 * rho - 1, 3));
}

export function isConverged(
  delta: number[],
  params: ReadonlyArray<number>,
  costOld: number,
  costNew: number,
  stepTol: number,
  costTol: number,
): boolean {
  const stepNorm = norm2(delta);
  const paramNorm = norm2(params);
  const costDrop = costOld - costNew;
  return (
    stepNorm <= stepTol * (paramNorm + stepTol) ||
    costDrop <= costTol * Math.max(costOld, ABS_STEP_FLOOR)
  );
}

export function costOf(r: number[]): number {
  let sum = 0;
  for (const value of r) sum += value * value;
  return 0.5 * sum;
}

export function maxDiagonal(a: number[][], n: number): number {
  let max = 0;
  for (let p = 0; p < n; p += 1) {
    const value = a[p]?.[p] ?? 0;
    if (value > max) max = value;
  }
  return max;
}

export function addVector(a: ReadonlyArray<number>, b: ReadonlyArray<number>, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

export function copyInto(target: number[], source: ReadonlyArray<number>, n: number): void {
  for (let i = 0; i < n; i += 1) target[i] = source[i] ?? 0;
}

export function infNorm(v: ReadonlyArray<number>): number {
  let max = 0;
  for (const value of v) {
    const magnitude = Math.abs(value);
    if (magnitude > max) max = magnitude;
  }
  return max;
}

function norm2(v: ReadonlyArray<number>): number {
  let sum = 0;
  for (const value of v) sum += value * value;
  return Math.sqrt(sum);
}
