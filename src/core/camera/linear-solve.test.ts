import { describe, expect, it } from 'vitest';
import { solveLinearSystem } from './linear-solve';

describe('solveLinearSystem', () => {
  it('solves a 2x2 system', () => {
    // 2x + y = 5 ; x - y = 1  ->  x = 2, y = 1
    const solution = solveLinearSystem(
      [
        [2, 1, 5],
        [1, -1, 1],
      ],
      2,
    );
    expect(solution).not.toBeNull();
    expect(solution![0]!).toBeCloseTo(2, 9);
    expect(solution![1]!).toBeCloseTo(1, 9);
  });

  it('solves an identity system', () => {
    const solution = solveLinearSystem(
      [
        [1, 0, 7],
        [0, 1, 9],
      ],
      2,
    );
    expect(solution![0]!).toBeCloseTo(7, 9);
    expect(solution![1]!).toBeCloseTo(9, 9);
  });

  it('needs partial pivoting (zero leading coefficient)', () => {
    // 0x + 2y = 4 ; 3x + y = 5  ->  x = 1, y = 2
    const solution = solveLinearSystem(
      [
        [0, 2, 4],
        [3, 1, 5],
      ],
      2,
    );
    expect(solution![0]!).toBeCloseTo(1, 9);
    expect(solution![1]!).toBeCloseTo(2, 9);
  });

  it('returns null for a singular system', () => {
    expect(
      solveLinearSystem(
        [
          [1, 1, 2],
          [2, 2, 5],
        ],
        2,
      ),
    ).toBeNull();
  });
});
