import { describe, expect, it } from 'vitest';
import { choleskySolve, inverseDiagonal } from './cholesky';
import { solveLeastSquares } from './least-squares';

describe('choleskySolve', () => {
  it('solves a symmetric positive-definite system', () => {
    const a = [4, 1, 0, 1, 3, 1, 0, 1, 2];
    const x = choleskySolve(a, [1, 2, 3], 3);
    expect(x).not.toBeNull();
    const [x0, x1, x2] = x ?? [];
    expect(4 * (x0 ?? 0) + (x1 ?? 0)).toBeCloseTo(1, 10);
    expect((x0 ?? 0) + 3 * (x1 ?? 0) + (x2 ?? 0)).toBeCloseTo(2, 10);
    expect((x1 ?? 0) + 2 * (x2 ?? 0)).toBeCloseTo(3, 10);
  });

  it('refuses a matrix that is not positive definite', () => {
    expect(choleskySolve([1, 2, 2, 1], [1, 1], 2)).toBeNull();
  });

  it('gives the diagonal of the inverse', () => {
    const diagonal = inverseDiagonal([4, 0, 0, 0.5], 2);
    expect(diagonal?.[0]).toBeCloseTo(0.25, 12);
    expect(diagonal?.[1]).toBeCloseTo(2, 12);
  });
});

describe('solveLeastSquares', () => {
  it('fits a badly scaled exponential model from a poor start', () => {
    // y = a·exp(b·t) + c with a in the thousands and b in the thousandths —
    // the kind of unit spread (focal vs distortion) that stalls plain damping.
    const t = Array.from({ length: 40 }, (_, i) => i * 25);
    const truth = [2400, -0.0031, 15];
    const y = t.map((ti) => (truth[0] ?? 0) * Math.exp((truth[1] ?? 0) * ti) + (truth[2] ?? 0));
    const result = solveLeastSquares(
      {
        paramCount: 3,
        residualCount: t.length,
        residuals: (p, out) => {
          t.forEach((ti, i) => {
            out[i] = (p[0] ?? 0) * Math.exp((p[1] ?? 0) * ti) + (p[2] ?? 0) - (y[i] ?? 0);
          });
        },
      },
      [1000, -0.01, 0],
    );
    expect(result.converged).toBe(true);
    expect(result.params[0]).toBeCloseTo(2400, 4);
    expect(result.params[1]).toBeCloseTo(-0.0031, 9);
    expect(result.params[2]).toBeCloseTo(15, 4);
  });

  it('respects declared residual ranges (block-structured problems)', () => {
    // Two independent lines sharing nothing: each parameter touches only its
    // own half of the residuals.
    const result = solveLeastSquares(
      {
        paramCount: 2,
        residualCount: 4,
        residuals: (p, out) => {
          out[0] = (p[0] ?? 0) - 3;
          out[1] = 2 * (p[0] ?? 0) - 6;
          out[2] = (p[1] ?? 0) + 1;
          out[3] = 3 * (p[1] ?? 0) + 3;
        },
        influence: (i) => (i === 0 ? [0, 2] : [2, 4]),
      },
      [0, 0],
    );
    expect(result.params[0]).toBeCloseTo(3, 8);
    expect(result.params[1]).toBeCloseTo(-1, 8);
    expect(result.normalMatrix[1]).toBe(0);
  });
});
