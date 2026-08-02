import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { maskCirclePoints, maskShape } from './mask-shape';

// A regular n-gon on this circle spans 10..90 on both axes and never touches
// the origin, so a bounds box that reports minX/minY 0 is reporting the seed
// rather than the geometry.
const CIRCLE_POINTS = 2000;
const CIRCLE_RADIUS = 40;
const CIRCLE_CENTER = 50;
const EXPECTED_MIN = 10;
const EXPECTED_MAX = 90;
const BOUNDS_DIGITS = 6;

describe('maskShape', () => {
  it('bounds a contour that does not straddle the origin without pulling in (0,0)', () => {
    const { bounds } = maskShape(
      'M1',
      maskCirclePoints(CIRCLE_POINTS, CIRCLE_RADIUS, CIRCLE_CENTER, CIRCLE_CENTER),
    );

    expect(bounds.minX).toBeCloseTo(EXPECTED_MIN, BOUNDS_DIGITS);
    expect(bounds.minY).toBeCloseTo(EXPECTED_MIN, BOUNDS_DIGITS);
    expect(bounds.maxX).toBeCloseTo(EXPECTED_MAX, BOUNDS_DIGITS);
    expect(bounds.maxY).toBeCloseTo(EXPECTED_MAX, BOUNDS_DIGITS);
  });

  it('bounds a wholly negative contour below the origin', () => {
    const { bounds } = maskShape('M1', [
      { x: -8, y: -6 },
      { x: -2, y: -4 },
    ]);

    expect(bounds).toEqual({ minX: -8, minY: -6, maxX: -2, maxY: -4 });
  });

  it('collapses a single-point contour onto that point', () => {
    expect(maskShape('M1', [{ x: 3, y: 7 }]).bounds).toEqual({
      minX: 3,
      minY: 7,
      maxX: 3,
      maxY: 7,
    });
  });

  it('gives a point-less contour the documented empty box', () => {
    expect(maskShape('M1', []).bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  // The fixed cases above pin the origin-seed regression; this pins the
  // invariant itself over arbitrary point sets, including ones far from the
  // origin where a reintroduced 0-seed would silently widen the box.
  it('reports the tightest box containing every point, wherever they sit', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
            y: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        (points) => {
          const { bounds } = maskShape('M1', points);

          expect(bounds.minX).toBe(Math.min(...points.map((point) => point.x)));
          expect(bounds.minY).toBe(Math.min(...points.map((point) => point.y)));
          expect(bounds.maxX).toBe(Math.max(...points.map((point) => point.x)));
          expect(bounds.maxY).toBe(Math.max(...points.map((point) => point.y)));
        },
      ),
    );
  });
});
