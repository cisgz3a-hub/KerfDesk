import { describe, expect, it } from 'vitest';
import type { Mat3 } from './homography';
import { rodriguesToMatrix, rotationToRvec, type Rvec } from './rodrigues';

function expectMatClose(actual: Mat3, expected: Mat3, digits = 9): void {
  for (let i = 0; i < 9; i += 1) expect(actual[i] ?? 0).toBeCloseTo(expected[i] ?? 0, digits);
}

function determinant(r: Mat3): number {
  return (
    r[0] * (r[4] * r[8] - r[5] * r[7]) -
    r[1] * (r[3] * r[8] - r[5] * r[6]) +
    r[2] * (r[3] * r[7] - r[4] * r[6])
  );
}

describe('rodriguesToMatrix', () => {
  it('maps a zero vector to the identity', () => {
    expectMatClose(rodriguesToMatrix([0, 0, 0]), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('builds a 90-degree rotation about z', () => {
    expectMatClose(rodriguesToMatrix([0, 0, Math.PI / 2]), [0, -1, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('produces a proper rotation (det = +1) for arbitrary axes', () => {
    const samples: Rvec[] = [
      [0.3, -0.4, 1.1],
      [2.0, 0.1, -0.5],
      [-1.2, 0.9, 0.2],
    ];
    for (const v of samples) expect(determinant(rodriguesToMatrix(v))).toBeCloseTo(1, 9);
  });
});

describe('rotationToRvec', () => {
  it('returns zero for the identity', () => {
    expect(rotationToRvec([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([0, 0, 0]);
  });

  it('round-trips arbitrary rotations through the matrix and back', () => {
    const samples: Rvec[] = [
      [0.0007, -0.0003, 0.0005], // tiny
      [0.3, -0.4, 1.1],
      [2.0, 0.1, -0.5],
      [-1.2, 0.9, 0.2],
    ];
    for (const v of samples) {
      const recovered = rotationToRvec(rodriguesToMatrix(v));
      expect(recovered[0]).toBeCloseTo(v[0], 6);
      expect(recovered[1]).toBeCloseTo(v[1], 6);
      expect(recovered[2]).toBeCloseTo(v[2], 6);
    }
  });

  it('handles the near-pi branch (179 degrees about a tilted axis)', () => {
    // Axis with a positive dominant component so the pi sign ambiguity does not
    // flip the recovered vector; magnitude just under pi triggers the branch.
    const angle = (179 * Math.PI) / 180;
    const axis = [0.8, 0.5, 0.33];
    const norm = Math.hypot(axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0);
    const v: Rvec = [
      (angle * (axis[0] ?? 0)) / norm,
      (angle * (axis[1] ?? 0)) / norm,
      (angle * (axis[2] ?? 0)) / norm,
    ];
    const recovered = rotationToRvec(rodriguesToMatrix(v));
    expect(recovered[0]).toBeCloseTo(v[0], 4);
    expect(recovered[1]).toBeCloseTo(v[1], 4);
    expect(recovered[2]).toBeCloseTo(v[2], 4);
  });
});
