import { describe, expect, it } from 'vitest';
import { levenbergMarquardt, type ResidualFn } from './levmar';

// y = a*exp(b*x) + c, sampled cleanly from a known truth. Recovering (a,b,c)
// from a deliberately wrong start exercises the full nonlinear LM path; if the
// normal-equation right-hand side lost its minus sign the fit would ascend and
// never reach the truth, so this doubles as the gradient-sign guard.
function expModel(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): ResidualFn {
  return (p) => {
    const a = p[0] ?? 0;
    const b = p[1] ?? 0;
    const c = p[2] ?? 0;
    return xs.map((x, i) => a * Math.exp(b * x) + c - (ys[i] ?? 0));
  };
}

const EXP_XS = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0];
const EXP_TRUTH = { a: 2.0, b: 0.3, c: -1.0 };
const EXP_YS = EXP_XS.map((x) => EXP_TRUTH.a * Math.exp(EXP_TRUTH.b * x) + EXP_TRUTH.c);

describe('levenbergMarquardt', () => {
  it('recovers a nonlinear exponential model from a wrong start', () => {
    const result = levenbergMarquardt(expModel(EXP_XS, EXP_YS), [1, 0, 0]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.converged).toBe(true);
    expect(result.params[0]).toBeCloseTo(EXP_TRUTH.a, 4);
    expect(result.params[1]).toBeCloseTo(EXP_TRUTH.b, 4);
    expect(result.params[2]).toBeCloseTo(EXP_TRUTH.c, 4);
    expect(result.rms).toBeLessThan(1e-6);
    expect(result.iterations).toBeLessThan(100);
  });

  it('final cost never exceeds the start cost (no silent ascent)', () => {
    const fn = expModel(EXP_XS, EXP_YS);
    const startCost = 0.5 * fn([1, 0, 0]).reduce((s, r) => s + r * r, 0);
    const result = levenbergMarquardt(fn, [1, 0, 0]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.cost).toBeLessThan(startCost);
  });

  it('matches the analytic least-squares solution for a linear model', () => {
    // y = a*x + b, over-determined; LM must land on the normal-equation optimum.
    const xs = [-2, -1, 0, 1, 2, 3];
    const truth = { a: 1.7, b: -0.4 };
    const ys = xs.map((x) => truth.a * x + truth.b);
    const fn: ResidualFn = (p) => xs.map((x, i) => (p[0] ?? 0) * x + (p[1] ?? 0) - (ys[i] ?? 0));
    const result = levenbergMarquardt(fn, [0, 0]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.params[0]).toBeCloseTo(truth.a, 6);
    expect(result.params[1]).toBeCloseTo(truth.b, 6);
  });

  it('converges across a 1e6 parameter-scale spread (Marquardt diagonal scaling)', () => {
    // One parameter ~1e3, one ~1e-3: identity damping would stall the small one.
    const xs = [0, 1, 2, 3, 4, 5];
    const truth = { big: 1500, small: 0.002 };
    const ys = xs.map((x) => truth.big + truth.small * x * x);
    const fn: ResidualFn = (p) =>
      xs.map((x, i) => (p[0] ?? 0) + (p[1] ?? 0) * x * x - (ys[i] ?? 0));
    const result = levenbergMarquardt(fn, [1000, 0], { maxIterations: 200 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.params[0]).toBeCloseTo(truth.big, 2);
    expect(result.params[1]).toBeCloseTo(truth.small, 6);
  });

  it('does not hang on a parameter the residual ignores (dead Jacobian column)', () => {
    // p[1] has no effect on the residual: its column is all-zero. The diagonal
    // floor must keep the system solvable and the solver must still terminate.
    const fn: ResidualFn = (p) => [(p[0] ?? 0) - 5, (p[0] ?? 0) - 5];
    const result = levenbergMarquardt(fn, [0, 99]);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.params[0]).toBeCloseTo(5, 5);
  });

  it('is deterministic — identical inputs give byte-identical output', () => {
    const fn = expModel(EXP_XS, EXP_YS);
    const a = levenbergMarquardt(fn, [1, 0, 0]);
    const b = levenbergMarquardt(fn, [1, 0, 0]);
    expect(a).toEqual(b);
  });

  it('rejects a residual whose length changes between calls', () => {
    let calls = 0;
    const fn: ResidualFn = (p) => {
      calls += 1;
      return calls === 1 ? [p[0] ?? 0, p[1] ?? 0] : [p[0] ?? 0];
    };
    expect(levenbergMarquardt(fn, [1, 1])).toEqual({
      kind: 'failed',
      reason: 'residual-length-mismatch',
    });
  });

  it('rejects a non-finite initial parameter', () => {
    const fn: ResidualFn = (p) => [p[0] ?? 0];
    expect(levenbergMarquardt(fn, [Number.NaN])).toEqual({ kind: 'failed', reason: 'non-finite' });
  });

  it('rejects an under-determined system (fewer residuals than parameters)', () => {
    const fn: ResidualFn = (p) => [(p[0] ?? 0) + (p[1] ?? 0)];
    expect(levenbergMarquardt(fn, [0, 0])).toEqual({ kind: 'failed', reason: 'bad-dimensions' });
  });

  it('holds a fixed parameter exactly at its initial value', () => {
    // y = a*x + b with b frozen at its true value: a recovers, b never moves (its
    // Jacobian column is zeroed). A frozen index stays byte-exact at its seed.
    const xs = [-2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => 1.7 * x - 0.4);
    const fn: ResidualFn = (p) => xs.map((x, i) => (p[0] ?? 0) * x + (p[1] ?? 0) - (ys[i] ?? 0));
    const result = levenbergMarquardt(fn, [0, -0.4], { fixedIndices: [1] });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.params[1]).toBe(-0.4); // frozen — exactly unchanged
    expect(result.params[0]).toBeCloseTo(1.7, 6); // slope recovers around it
  });

  it('keeps a frozen parameter put even when its value is wrong', () => {
    // Freezing the intercept at a wrong 5 forces the slope to the constrained
    // least-squares optimum (0.847 here), proving the freeze, not just a no-op.
    const xs = [-2, -1, 0, 1, 2, 3];
    const ys = xs.map((x) => 1.7 * x - 0.4);
    const fn: ResidualFn = (p) => xs.map((x, i) => (p[0] ?? 0) * x + (p[1] ?? 0) - (ys[i] ?? 0));
    const result = levenbergMarquardt(fn, [0, 5], { fixedIndices: [1] });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.params[1]).toBe(5);
    expect(result.params[0]).toBeCloseTo(0.8474, 3);
  });
});
