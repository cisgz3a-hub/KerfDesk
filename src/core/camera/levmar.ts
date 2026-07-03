// Generic Levenberg-Marquardt least-squares minimiser (ADR-107, calibration v2.c).
// Minimises 0.5*Σ rᵢ(p)² for a caller-supplied residual closure, using a
// central-difference numeric Jacobian and Marquardt diagonal-scaled damping.
// Camera-agnostic and deterministic: no clock, no RNG, no I/O — the same inputs
// always yield byte-identical output. The numeric kernels live in levmar-kernel.

import {
  addVector,
  copyInto,
  costOf,
  dampedSolve,
  evalResidual,
  gainDenominator,
  infNorm,
  isConverged,
  maxDiagonal,
  nextLambdaAccept,
  relinearize,
  type ResidualFn,
} from './levmar-kernel';

export type { ResidualFn } from './levmar-kernel';

export type LevMarOptions = {
  readonly maxIterations?: number;
  readonly gradientTolerance?: number;
  readonly stepTolerance?: number;
  readonly costTolerance?: number;
  // Parameter indices to hold constant at their initial value (e.g. freezing a
  // distortion coefficient the data cannot observe). Their Jacobian column is zeroed.
  readonly fixedIndices?: ReadonlyArray<number>;
};

// How the minimiser stopped. Only 'tolerance' is a true convergence; 'iteration-cap'
// ran out of budget and 'damping-stall' could not improve from a (possibly poor) basin.
export type LevMarExit = 'tolerance' | 'iteration-cap' | 'damping-stall';

export type LevMarResult =
  | {
      readonly kind: 'ok';
      readonly params: ReadonlyArray<number>;
      readonly cost: number;
      readonly rms: number;
      readonly iterations: number;
      readonly converged: boolean;
      readonly exit: LevMarExit;
    }
  | {
      readonly kind: 'failed';
      readonly reason:
        | 'bad-dimensions'
        | 'non-finite'
        | 'residual-length-mismatch'
        | 'singular-system';
    };

const MAX_ITERATIONS_DEFAULT = 100;
// Gradient stop is secondary: with an FD Jacobian on pixel-unit residuals it
// essentially never fires — the step/cost tolerances are the operative criteria.
const GRAD_TOL_DEFAULT = 1e-9;
const STEP_TOL_DEFAULT = 1e-8;
const COST_TOL_DEFAULT = 1e-12;
// Nielsen damping: λ₀ = TAU·max(diag(JᵀJ)); reject grows λ geometrically by ν.
const TAU = 1e-3;
const NU_INIT = 2;
const MAX_SINGULAR_RETRIES = 12;
// When repeated rejections drive λ this high the damped step is negligible: we are at
// a minimum (the cost floor may be nonzero for a reduced model) and have converged.
// The absolute gradient stop is too tight to catch this at pixel scale.
const LAMBDA_MAX = 1e16;

type ResolvedOptions = {
  readonly maxIterations: number;
  readonly gradientTolerance: number;
  readonly stepTolerance: number;
  readonly costTolerance: number;
  readonly fixedIndices: ReadonlySet<number>;
};

/**
 * Minimise the sum of squared residuals from `initialParams`. Returns the fitted
 * parameters with the final cost, per-scalar RMS (√(2·cost/m)), iteration count,
 * and whether a tolerance (not the iteration cap) triggered termination.
 */
export function levenbergMarquardt(
  residualFn: ResidualFn,
  initialParams: ReadonlyArray<number>,
  options?: LevMarOptions,
): LevMarResult {
  const n = initialParams.length;
  if (n === 0) return { kind: 'failed', reason: 'bad-dimensions' };
  for (const value of initialParams) {
    if (!Number.isFinite(value)) return { kind: 'failed', reason: 'non-finite' };
  }
  const probe = evalResidual(residualFn, initialParams, undefined);
  if (probe.kind !== 'ok') return { kind: 'failed', reason: 'non-finite' };
  if (probe.r.length < n) return { kind: 'failed', reason: 'bad-dimensions' };
  return runLevMar(residualFn, initialParams.slice(), probe.r.length, n, resolveOptions(options));
}

function resolveOptions(options: LevMarOptions | undefined): ResolvedOptions {
  return {
    maxIterations: options?.maxIterations ?? MAX_ITERATIONS_DEFAULT,
    gradientTolerance: options?.gradientTolerance ?? GRAD_TOL_DEFAULT,
    stepTolerance: options?.stepTolerance ?? STEP_TOL_DEFAULT,
    costTolerance: options?.costTolerance ?? COST_TOL_DEFAULT,
    fixedIndices: new Set(options?.fixedIndices ?? []),
  };
}

function runLevMar(
  fn: ResidualFn,
  params: number[],
  m: number,
  n: number,
  cfg: ResolvedOptions,
): LevMarResult {
  const start = relinearize(fn, params, n, m, cfg.fixedIndices);
  if (start.kind !== 'ok') return mapFail(start);
  let a = start.a;
  let g = start.g;
  let cost = start.cost;
  let lambda = TAU * Math.max(maxDiagonal(a, n), 1);
  let nu = NU_INIT;
  let singular = 0;
  let iterations = 0;
  while (iterations < cfg.maxIterations) {
    if (infNorm(g) < cfg.gradientTolerance) return ok(params, cost, m, iterations, 'tolerance');
    const delta = dampedSolve(a, g, lambda, n);
    if (delta === null) {
      singular += 1;
      if (singular > MAX_SINGULAR_RETRIES) return { kind: 'failed', reason: 'singular-system' };
      lambda *= nu;
      nu *= 2;
      continue;
    }
    singular = 0;
    const trial = addVector(params, delta, n);
    const evalTrial = evalResidual(fn, trial, m);
    if (evalTrial.kind !== 'ok') return mapFail(evalTrial);
    const trialCost = costOf(evalTrial.r);
    iterations += 1;
    if (trialCost < cost) {
      const outcome = acceptStep(fn, params, delta, g, a, lambda, cost, trialCost, n, m, cfg);
      if (outcome.kind === 'failed') return outcome.result;
      cost = trialCost;
      if (outcome.kind === 'converged') return ok(params, cost, m, iterations, 'tolerance');
      a = outcome.a;
      g = outcome.g;
      cost = outcome.cost;
      lambda = outcome.lambda;
      nu = NU_INIT;
    } else {
      lambda *= nu;
      nu *= 2;
      if (lambda > LAMBDA_MAX) return ok(params, cost, m, iterations, 'damping-stall');
    }
  }
  return ok(params, cost, m, iterations, 'iteration-cap');
}

type AcceptOutcome =
  | { readonly kind: 'converged' }
  | { readonly kind: 'failed'; readonly result: LevMarResult }
  | {
      readonly kind: 'go';
      readonly a: number[][];
      readonly g: number[];
      readonly cost: number;
      readonly lambda: number;
    };

// Commit an improving step in place, then signal convergence or re-linearize at the
// new point for the next iteration. Mutates `params` (a local scratch vector); the
// driver owns the iteration count and builds the final Result.
function acceptStep(
  fn: ResidualFn,
  params: number[],
  delta: number[],
  g: number[],
  a: number[][],
  lambda: number,
  cost: number,
  trialCost: number,
  n: number,
  m: number,
  cfg: ResolvedOptions,
): AcceptOutcome {
  const stop = isConverged(delta, params, cost, trialCost, cfg.stepTolerance, cfg.costTolerance);
  const nextLambda = nextLambdaAccept(
    lambda,
    cost - trialCost,
    gainDenominator(delta, g, a, lambda, n),
  );
  copyInto(params, addVector(params, delta, n), n);
  if (stop) return { kind: 'converged' };
  const next = relinearize(fn, params, n, m, cfg.fixedIndices);
  if (next.kind !== 'ok') return { kind: 'failed', result: mapFail(next) };
  return { kind: 'go', a: next.a, g: next.g, cost: next.cost, lambda: nextLambda };
}

function ok(
  params: ReadonlyArray<number>,
  cost: number,
  m: number,
  iterations: number,
  exit: LevMarExit,
): LevMarResult {
  return {
    kind: 'ok',
    params: params.slice(),
    cost,
    rms: Math.sqrt((2 * cost) / Math.max(m, 1)),
    iterations,
    converged: exit === 'tolerance',
    exit,
  };
}

function mapFail(failure: { readonly kind: 'bad-length' | 'non-finite' }): LevMarResult {
  return {
    kind: 'failed',
    reason: failure.kind === 'bad-length' ? 'residual-length-mismatch' : 'non-finite',
  };
}
