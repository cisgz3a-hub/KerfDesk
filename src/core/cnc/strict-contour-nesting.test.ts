import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import {
  isClosedFiniteContour,
  prepareStrictContourNesting,
  strictContourContainmentDepth,
  strictlyContainsContour,
} from './strict-contour-nesting';
import {
  originalIsClosedFiniteContour,
  originalStrictContourContainmentDepth,
  originalStrictlyContainsContour,
} from './strict-contour-nesting.test-support';
import { buildVCarveSourceRegionLayout } from './vcarve-region-order';

function polygon(points: ReadonlyArray<Vec2>, closed = true): Polyline {
  return { points, closed };
}

function square(minX: number, minY: number, size: number): Polyline {
  return polygon([
    { x: minX, y: minY },
    { x: minX + size, y: minY },
    { x: minX + size, y: minY + size },
    { x: minX, y: minY + size },
  ]);
}

function assertDepthsMatch(contours: ReadonlyArray<Polyline>): void {
  const prepared = prepareStrictContourNesting(contours);
  for (const [index, contour] of contours.entries()) {
    expect(isClosedFiniteContour(contour)).toBe(originalIsClosedFiniteContour(contour));
    expect(strictContourContainmentDepth(contour, index, contours, prepared)).toBe(
      originalStrictContourContainmentDepth(contour, index, contours),
    );
  }
}

describe('prepared strict contour nesting', () => {
  it('keeps contacts, crossings, holes, islands and repeated closure exactly as before', () => {
    const outer = square(0, 0, 20);
    const hole = square(2, 2, 16);
    const island = square(4, 4, 12);
    const closure = polygon([...island.points, { x: 4, y: 4 }]);
    const touching = square(0, 5, 10);
    const outside = square(20, 0, 20);
    const crossing = polygon([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 5, y: 10 },
    ]);
    const bowtie = polygon([
      { x: 3, y: 3 },
      { x: 17, y: 17 },
      { x: 3, y: 17 },
      { x: 17, y: 3 },
    ]);
    const concave = polygon([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 12, y: 20 },
      { x: 12, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 20 },
      { x: 0, y: 20 },
    ]);
    const gapCrossing = square(5, 5, 10);
    const contours = [
      outer,
      hole,
      island,
      closure,
      touching,
      outside,
      crossing,
      bowtie,
      concave,
      gapCrossing,
    ];
    assertDepthsMatch(contours);
    expect(strictlyContainsContour(outer, touching)).toBe(false);
    expect(strictlyContainsContour(outer, crossing)).toBe(false);
    expect(strictlyContainsContour(concave, gapCrossing)).toBe(false);
  });

  it('preserves contact at floating point coordinate precision', () => {
    for (const shift of [0, 1_000_000, -1_000_000]) {
      const outer = square(shift, shift, 20);
      const tinyGap = Number.EPSILON * Math.max(1, Math.abs(shift)) * 8;
      const inner = square(shift + tinyGap, shift + 5, 10);
      const contours = [outer, inner];
      assertDepthsMatch(contours);
      expect(strictlyContainsContour(outer, inner)).toBe(
        originalStrictlyContainsContour(outer, inner),
      );
    }
  });

  it('matches empty, open, short, nonfinite and duplicate-point input semantics', () => {
    const contours = [
      square(-10, -10, 20),
      polygon([]),
      polygon([{ x: 0, y: 0 }]),
      polygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      polygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ]),
      polygon([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
      polygon(square(-2, -2, 4).points, false),
      polygon([
        { x: NaN, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
      polygon([
        { x: Infinity, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
      polygon([
        { x: -Infinity, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]),
    ];
    assertDepthsMatch(contours);
    for (const outer of contours) {
      for (const inner of contours) {
        expect(strictlyContainsContour(outer, inner)).toBe(
          originalStrictlyContainsContour(outer, inner),
        );
      }
    }
  });

  it('agrees with the pre-change oracle for arbitrary crossing and degenerate polygons', () => {
    const point = fc.record({
      x: fc.integer({ min: -30, max: 30 }),
      y: fc.integer({ min: -30, max: 30 }),
    });
    const contour = fc.record({ closed: fc.boolean(), points: fc.array(point, { maxLength: 12 }) });
    fc.assert(fc.property(fc.array(contour, { maxLength: 12 }), assertDepthsMatch), {
      seed: 270,
      numRuns: 250,
    });
  });

  it('does not reuse geometry from another snapshot or a later preparation', () => {
    const outer = square(0, 0, 20);
    const first = [outer, square(1, 1, 2)];
    const second = [outer, square(21, 1, 2)];
    const preparedFirst = prepareStrictContourNesting(first);
    const inner = second[1];
    if (inner === undefined) throw new Error('Missing fixture contour');
    expect(strictContourContainmentDepth(inner, 1, second, preparedFirst)).toBe(0);
    expect(buildVCarveSourceRegionLayout(first)).toHaveLength(1);
    first[1] = inner;
    expect(buildVCarveSourceRegionLayout(first)).toHaveLength(2);
  });

  it('reads disconnected source vertices only a bounded number of times', () => {
    let coordinateReads = 0;
    const contours = Array.from({ length: 300 }, (_, i) => {
      const raw = square(i * 3, 0, 1);
      return polygon(
        raw.points.map(({ x, y }) => ({
          get x() {
            coordinateReads += 1;
            return x;
          },
          get y() {
            coordinateReads += 1;
            return y;
          },
        })),
      );
    });
    expect(buildVCarveSourceRegionLayout(contours)).toHaveLength(contours.length);
    expect(coordinateReads).toBeLessThan(300 * 4 * 16);
  });
});
