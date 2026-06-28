import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHomography, type Mat3 } from './homography';
import { homographyToMatrix3d, type Matrix3d } from './matrix3d';

// Apply the column-major 4×4 to the homogeneous 2D point [x, y, 0, 1] and
// perspective-divide — the exact thing the browser does to render the element.
// Column-major storage means M[row][col] = m[col * 4 + row].
function applyMatrix3d(m: Matrix3d, x: number, y: number): { x: number; y: number } {
  const input = [x, y, 0, 1];
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row]! += m[col * 4 + row]! * input[col]!;
    }
  }
  return { x: out[0]! / out[3]!, y: out[1]! / out[3]! };
}

describe('homographyToMatrix3d', () => {
  it('maps the identity homography to the CSS identity-with-perspective matrix', () => {
    const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(homographyToMatrix3d(identity)).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  });

  it('reproduces applyHomography for a known perspective transform', () => {
    const h: Mat3 = [1.2, 0.1, 5, -0.05, 1.1, 3, 0.0005, -0.0003, 1];
    const m = homographyToMatrix3d(h);
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 53, y: 87 },
    ]) {
      const viaMatrix = applyMatrix3d(m, point.x, point.y);
      const viaHomography = applyHomography(h, point);
      expect(viaMatrix.x).toBeCloseTo(viaHomography.x, 9);
      expect(viaMatrix.y).toBeCloseTo(viaHomography.y, 9);
    }
  });

  it('keeps perspective terms in the 4th row (no transpose bug)', () => {
    // A homography with only a perspective term must still perspective-divide.
    const h: Mat3 = [1, 0, 0, 0, 1, 0, 0.01, 0, 1];
    const m = homographyToMatrix3d(h);
    // m6/m7 (perspective) belong in the 4th-row x/y slots = column-major
    // indices 3 and 7. A transposed converter would put them at 8 and 9.
    expect(m[3]).toBe(0.01);
    expect(m[7]).toBe(0);
    const mapped = applyMatrix3d(m, 50, 0);
    expect(mapped.x).toBeCloseTo(50 / (0.01 * 50 + 1), 9);
  });

  it('reproduces applyHomography for arbitrary homographies (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.double({ min: 0.5, max: 2, noNaN: true }),
          e: fc.double({ min: 0.5, max: 2, noNaN: true }),
          tx: fc.double({ min: -50, max: 50, noNaN: true }),
          ty: fc.double({ min: -50, max: 50, noNaN: true }),
          g: fc.double({ min: -0.001, max: 0.001, noNaN: true }),
          h: fc.double({ min: -0.001, max: 0.001, noNaN: true }),
        }),
        ({ a, e, tx, ty, g, h }) => {
          const matrix: Mat3 = [a, 0.05, tx, -0.05, e, ty, g, h, 1];
          const m = homographyToMatrix3d(matrix);
          const point = { x: 70, y: 30 };
          const viaMatrix = applyMatrix3d(m, point.x, point.y);
          const viaHomography = applyHomography(matrix, point);
          expect(viaMatrix.x).toBeCloseTo(viaHomography.x, 6);
          expect(viaMatrix.y).toBeCloseTo(viaHomography.y, 6);
        },
      ),
      { numRuns: 100 },
    );
  });
});
