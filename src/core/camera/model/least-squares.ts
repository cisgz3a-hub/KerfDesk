// Levenberg-Marquardt for the camera model fits (ADR-440). The earlier solver
// damped with a plain λ·I and a dense finite-difference Jacobian, so a focal in
// the hundreds and distortion terms near 0.01 moved at wildly different rates:
// it needed hundreds of iterations and still stopped short (measured: 37 s on
// a 12-view solve that finished ~20 px from the true lens). This one damps with
// Marquardt's diag(JᵀJ) scaling, which makes the step invariant to parameter
// units, and exploits the block structure every camera fit has: a parameter
// only moves the residuals in its declared range, so the Jacobian and JᵀJ are
// built from those ranges alone. Pure core: deterministic, no I/O.

import { choleskySolve } from './cholesky';

export type LeastSquaresProblem = {
  readonly paramCount: number;
  readonly residualCount: number;
  /** Fill `out` (length residualCount) with residuals at `params`. */
  readonly residuals: (params: Float64Array, out: Float64Array) => void;
  /** Residual index range [start, end) parameter `index` can change. Defaults to all. */
  readonly influence?: (index: number) => readonly [number, number];
  /** Finite-difference step for parameter `index` at `value`. */
  readonly step?: (index: number, value: number) => number;
};

export type LeastSquaresOptions = {
  readonly maxIterations?: number;
  /** Stop when the relative cost drop of an accepted step falls below this. */
  readonly relativeTolerance?: number;
};

export type LeastSquaresResult = {
  readonly params: Float64Array;
  /** Sum of squared residuals at `params`. */
  readonly cost: number;
  readonly iterations: number;
  readonly converged: boolean;
  /** JᵀJ at the solution (row-major paramCount²), for parameter uncertainty. */
  readonly normalMatrix: Float64Array;
};

type Column = { readonly start: number; readonly values: Float64Array };

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_RELATIVE_TOLERANCE = 1e-10;
const INITIAL_LAMBDA = 1e-3;
const MAX_LAMBDA = 1e12;
const MIN_DIAGONAL = 1e-12;

export function solveLeastSquares(
  problem: LeastSquaresProblem,
  initial: ArrayLike<number>,
  options: LeastSquaresOptions = {},
): LeastSquaresResult {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const params = Float64Array.from(initial);
  const residual = new Float64Array(problem.residualCount);
  problem.residuals(params, residual);
  let cost = sumSquares(residual);
  let lambda = INITIAL_LAMBDA;
  let iterations = 0;
  let converged = false;
  let normal: Float64Array = new Float64Array(problem.paramCount * problem.paramCount);
  while (iterations < maxIterations && !converged && lambda < MAX_LAMBDA) {
    iterations += 1;
    const columns = jacobianColumns(problem, params, residual);
    normal = normalMatrix(columns, problem.paramCount);
    const gradient = gradientOf(columns, residual);
    const step = acceptStep(problem, params, normal, gradient, cost, lambda);
    if (step === null) {
      lambda *= 10;
      continue;
    }
    const drop = cost - step.cost;
    params.set(step.params);
    residual.set(step.residual);
    converged = drop <= tolerance * Math.max(cost, Number.MIN_VALUE);
    cost = step.cost;
    lambda = Math.max(lambda / 10, 1e-12);
  }
  return { params, cost, iterations, converged: converged || cost === 0, normalMatrix: normal };
}

type AcceptedStep = {
  readonly params: Float64Array;
  readonly residual: Float64Array;
  readonly cost: number;
};

function acceptStep(
  problem: LeastSquaresProblem,
  params: Float64Array,
  normal: Float64Array,
  gradient: Float64Array,
  cost: number,
  lambda: number,
): AcceptedStep | null {
  const n = problem.paramCount;
  const damped = Float64Array.from(normal);
  for (let i = 0; i < n; i += 1) {
    const diagonal = Math.max(normal[i * n + i] ?? 0, MIN_DIAGONAL);
    damped[i * n + i] = diagonal * (1 + lambda);
  }
  const delta = choleskySolve(
    damped,
    gradient.map((g) => -g),
    n,
  );
  if (delta === null) return null;
  const candidate = Float64Array.from(params);
  for (let i = 0; i < n; i += 1) candidate[i] = (candidate[i] ?? 0) + (delta[i] ?? 0);
  const residual = new Float64Array(problem.residualCount);
  problem.residuals(candidate, residual);
  const nextCost = sumSquares(residual);
  if (!Number.isFinite(nextCost) || nextCost >= cost) return null;
  return { params: candidate, residual, cost: nextCost };
}

function jacobianColumns(
  problem: LeastSquaresProblem,
  params: Float64Array,
  base: Float64Array,
): ReadonlyArray<Column> {
  const columns: Column[] = [];
  const shifted = new Float64Array(problem.residualCount);
  const probe = Float64Array.from(params);
  for (let index = 0; index < problem.paramCount; index += 1) {
    const value = params[index] ?? 0;
    const h = problem.step?.(index, value) ?? defaultStep(value);
    probe[index] = value + h;
    problem.residuals(probe, shifted);
    probe[index] = value;
    const [start, end] = problem.influence?.(index) ?? [0, problem.residualCount];
    const values = new Float64Array(end - start);
    for (let row = start; row < end; row += 1) {
      values[row - start] = ((shifted[row] ?? 0) - (base[row] ?? 0)) / h;
    }
    columns.push({ start, values });
  }
  return columns;
}

function defaultStep(value: number): number {
  return 1e-6 * Math.max(Math.abs(value), 1e-2);
}

function normalMatrix(columns: ReadonlyArray<Column>, n: number): Float64Array {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    const a = columns[i];
    if (a === undefined) continue;
    for (let j = i; j < n; j += 1) {
      const b = columns[j];
      if (b === undefined) continue;
      const value = overlapDot(a, b);
      out[i * n + j] = value;
      out[j * n + i] = value;
    }
  }
  return out;
}

function overlapDot(a: Column, b: Column): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.start + a.values.length, b.start + b.values.length);
  let sum = 0;
  for (let row = start; row < end; row += 1) {
    sum += (a.values[row - a.start] ?? 0) * (b.values[row - b.start] ?? 0);
  }
  return sum;
}

function gradientOf(columns: ReadonlyArray<Column>, residual: Float64Array): Float64Array {
  const out = new Float64Array(columns.length);
  columns.forEach((column, index) => {
    let sum = 0;
    for (let k = 0; k < column.values.length; k += 1) {
      sum += (column.values[k] ?? 0) * (residual[column.start + k] ?? 0);
    }
    out[index] = sum;
  });
  return out;
}

export function sumSquares(values: Iterable<number>): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return sum;
}
