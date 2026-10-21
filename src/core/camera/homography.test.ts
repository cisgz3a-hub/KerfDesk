import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHomography, solveHomography, type Mat3, type PointPair } from './homography';

// Four well-separated corners used as the source quad for round-trip tests.
const SOURCE_QUAD: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function pairsFrom(matrix: Mat3): PointPair[] {
  return SOURCE_QUAD.map((src) => ({ src, dst: applyHomography(matrix, src) }));
}

describe('solveHomography', () => {
  it('rejects fewer than four correspondences', () => {
    const result = solveHomography([{ src: { x: 0, y: 0 }, dst: { x: 0, y: 0 } }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('need-four-points');
  });

  it('recovers an identity mapping', () => {
    const result = solveHomography(SOURCE_QUAD.map((p) => ({ src: p, dst: p })));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mapped = applyHomography(result.matrix, { x: 37, y: 61 });
      expect(mapped.x).toBeCloseTo(37, 6);
      expect(mapped.y).toBeCloseTo(61, 6);
    }
  });

  it('recovers a translation + non-uniform scale', () => {
    const result = solveHomography(
      SOURCE_QUAD.map((p) => ({ src: p, dst: { x: p.x * 2 + 10, y: p.y * 0.5 - 4 } })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mapped = applyHomography(result.matrix, { x: 50, y: 80 });
      expect(mapped.x).toBeCloseTo(50 * 2 + 10, 5);
      expect(mapped.y).toBeCloseTo(80 * 0.5 - 4, 5);
    }
  });

  it('recovers a known perspective transform', () => {
    const known: Mat3 = [1.2, 0.1, 5, -0.05, 1.1, 3, 0.0005, -0.0003, 1];
    const result = solveHomography(pairsFrom(known));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const probe = { x: 53, y: 41 };
      const expected = applyHomography(known, probe);
      const actual = applyHomography(result.matrix, probe);
      expect(actual.x).toBeCloseTo(expected.x, 5);
      expect(actual.y).toBeCloseTo(expected.y, 5);
    }
  });

  it('reports degenerate for collinear sources', () => {
    const result = solveHomography(
      [0, 1, 2, 3].map((i) => ({ src: { x: i * 10, y: i * 10 }, dst: { x: i, y: i * 2 } })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('degenerate');
  });

  it('reports degenerate for coincident sources', () => {
    const result = solveHomography(
      [0, 1, 2, 3].map((i) => ({ src: { x: 5, y: 5 }, dst: { x: i, y: i } })),
    );
    expect(result.ok).toBe(false);
  });

  it('round-trips arbitrary well-conditioned homographies', () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.double({ min: 0.5, max: 2, noNaN: true }),
          e: fc.double({ min: 0.5, max: 2, noNaN: true }),
          b: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
          d: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
          tx: fc.double({ min: -50, max: 50, noNaN: true }),
          ty: fc.double({ min: -50, max: 50, noNaN: true }),
          g: fc.double({ min: -0.0008, max: 0.0008, noNaN: true }),
          h: fc.double({ min: -0.0008, max: 0.0008, noNaN: true }),
        }),
        ({ a, e, b, d, tx, ty, g, h }) => {
          const matrix: Mat3 = [a, b, tx, d, e, ty, g, h, 1];
          const result = solveHomography(pairsFrom(matrix));
          if (!result.ok) return; // skip the rare degenerate draw
          const probe = { x: 60, y: 45 };
          const expected = applyHomography(matrix, probe);
          const actual = applyHomography(result.matrix, probe);
          expect(actual.x).toBeCloseTo(expected.x, 3);
          expect(actual.y).toBeCloseTo(expected.y, 3);
        },
      ),
      { numRuns: 100 },
    );
  });
});
