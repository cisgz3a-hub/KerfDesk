import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHomography, type Mat3 } from './homography';
import { multiplyMat3 } from './mat3';

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('multiplyMat3', () => {
  it('is identity-neutral', () => {
    const m: Mat3 = [2, 0, 5, 0, 3, 7, 0, 0, 1];
    expect(multiplyMat3(IDENTITY, m)).toEqual(m);
    expect(multiplyMat3(m, IDENTITY)).toEqual(m);
  });

  it('composes two affine transforms (scale then translate)', () => {
    const translate: Mat3 = [1, 0, 10, 0, 1, 20, 0, 0, 1];
    const scale: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 1];
    // translate · scale: scale first, then translate.
    const composed = multiplyMat3(translate, scale);
    const mapped = applyHomography(composed, { x: 3, y: 4 });
    expect(mapped).toEqual({ x: 3 * 2 + 10, y: 4 * 2 + 20 });
  });

  it('applyHomography(a·b, p) == applyHomography(a, applyHomography(b, p))', () => {
    fc.assert(
      fc.property(
        fc.record({
          a0: fc.double({ min: 0.5, max: 2, noNaN: true }),
          a1: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
          a2: fc.double({ min: -40, max: 40, noNaN: true }),
          b0: fc.double({ min: 0.5, max: 2, noNaN: true }),
          b1: fc.double({ min: -0.3, max: 0.3, noNaN: true }),
          b2: fc.double({ min: -40, max: 40, noNaN: true }),
        }),
        ({ a0, a1, a2, b0, b1, b2 }) => {
          const a: Mat3 = [a0, a1, a2, -a1, a0, 5, 0, 0, 1];
          const b: Mat3 = [b0, b1, b2, -b1, b0, -3, 0, 0, 1];
          const point = { x: 30, y: 18 };
          const composed = applyHomography(multiplyMat3(a, b), point);
          const sequential = applyHomography(a, applyHomography(b, point));
          expect(composed.x).toBeCloseTo(sequential.x, 6);
          expect(composed.y).toBeCloseTo(sequential.y, 6);
        },
      ),
      { numRuns: 100 },
    );
  });
});
