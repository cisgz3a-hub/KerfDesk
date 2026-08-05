import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildVCarveBoundaryIndex,
  everyIndexedVCarveBoundarySegmentInBox,
  minimumIndexedVCarveBoundaryDistance,
  type VCarveBoundaryQueryBox,
} from './vcarve-boundary-index';
import { emittedChordIsSafe } from './vcarve-detail-depth';
import { pointToSegmentDistance, type BoundarySegment } from './vcarve-detail-geometry';
import type { RadialEnvelope } from './radial-envelope';

const ENVELOPE: RadialEnvelope = {
  tanHalf: Math.tan(Math.PI / 6),
  tipRadiusMm: 0,
  outerRadiusMm: 2,
};

const coordinate = fc.integer({ min: -10_000, max: 10_000 }).map((value) => value / 10);
const segmentArbitrary = fc
  .tuple(coordinate, coordinate, coordinate, coordinate)
  .map(([ax, ay, bx, by]): BoundarySegment => ({ ax, ay, bx, by }));

describe('V-carve boundary index', () => {
  it('returns the exact brute-force nearest-segment distance', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { minLength: 1, maxLength: 80 }),
        coordinate,
        coordinate,
        (segments, x, y) => {
          const expected = bruteForceDistance(segments, x, y);
          const actual = minimumIndexedVCarveBoundaryDistance(
            buildVCarveBoundaryIndex(segments),
            x,
            y,
          );
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('visits the same box-overlapping segments as the serial filter', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { minLength: 1, maxLength: 80 }),
        coordinate,
        coordinate,
        coordinate,
        coordinate,
        (segments, x1, y1, x2, y2) => {
          const box: VCarveBoundaryQueryBox = {
            minX: Math.min(x1, x2),
            minY: Math.min(y1, y2),
            maxX: Math.max(x1, x2),
            maxY: Math.max(y1, y2),
          };
          const expected = segments
            .map((segment, index) => ({ segment, index }))
            .filter(({ segment }) => overlapsBox(segment, box))
            .map(({ index }) => index);
          const visited: number[] = [];
          const completed = everyIndexedVCarveBoundarySegmentInBox(
            buildVCarveBoundaryIndex(segments),
            box,
            (segment) => {
              visited.push(segments.indexOf(segment));
              return true;
            },
          );
          expect(completed).toBe(true);
          expect(visited.sort((a, b) => a - b)).toEqual(expected);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('keeps indexed swept-chord safety equal to the serial oracle', () => {
    fc.assert(
      fc.property(
        fc.array(segmentArbitrary, { minLength: 1, maxLength: 80 }),
        coordinate,
        coordinate,
        coordinate,
        coordinate,
        fc.integer({ min: 0, max: 2_000 }),
        fc.integer({ min: 0, max: 2_000 }),
        (segments, ax, ay, bx, by, depthA, depthB) => {
          const a = { x: ax, y: ay };
          const b = { x: bx, y: by };
          const expected = emittedChordIsSafe(
            a,
            b,
            depthA / 1_000,
            depthB / 1_000,
            segments,
            ENVELOPE,
          );
          const actual = emittedChordIsSafe(
            a,
            b,
            depthA / 1_000,
            depthB / 1_000,
            segments,
            ENVELOPE,
            buildVCarveBoundaryIndex(segments),
          );
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

function bruteForceDistance(
  segments: ReadonlyArray<BoundarySegment>,
  x: number,
  y: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, pointToSegmentDistance(x, y, segment));
  }
  return minimum;
}

function overlapsBox(segment: BoundarySegment, box: VCarveBoundaryQueryBox): boolean {
  return !(
    Math.min(segment.ax, segment.bx) > box.maxX ||
    Math.max(segment.ax, segment.bx) < box.minX ||
    Math.min(segment.ay, segment.by) > box.maxY ||
    Math.max(segment.ay, segment.by) < box.minY
  );
}
