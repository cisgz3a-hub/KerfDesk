import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import {
  buildVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
  minimumVCarveBoundaryChordDistance,
  minimumVCarveBoundaryPointDistance,
  someVCarveBoundarySegmentInBox,
  type VCarveBoundaryBox,
} from './vcarve-boundary-segment-index';
import {
  pointToSegmentDistance,
  segmentToSegmentDistance,
  type BoundarySegment,
} from './vcarve-detail-geometry';

describe('V-carve boundary segment index', () => {
  it('matches the original full scan for deterministic point and chord queries', () => {
    const random = seededRandom(0x6e15a068);
    const segments = Array.from({ length: 127 }, (_, index) => randomSegment(random, index));
    const index = buildVCarveBoundarySegmentIndex(segments);

    for (let query = 0; query < 400; query += 1) {
      const a = randomPoint(random);
      const b = randomPoint(random);
      expect(minimumVCarveBoundaryPointDistance(index, a)).toBe(
        minimumPointDistanceByFullScan(segments, a),
      );
      expect(minimumVCarveBoundaryChordDistance(index, a, b)).toBe(
        minimumChordDistanceByFullScan(segments, a, b),
      );
    }
  });

  it('matches the original AABB-filtered predicates without reordering source data', () => {
    const random = seededRandom(0x285286);
    const segments = Array.from({ length: 91 }, (_, index) => randomSegment(random, index));
    const index = buildVCarveBoundarySegmentIndex(segments);

    expect(index.segments).toBe(segments);
    for (let query = 0; query < 250; query += 1) {
      const box = randomBox(random);
      const threshold = nextBetween(random, -60, 60);
      const predicate = (segment: BoundarySegment): boolean =>
        segment.ax + segment.ay + segment.bx + segment.by >= threshold;
      const candidates = segments.filter((segment) => segmentOverlapsBox(segment, box));

      expect(everyVCarveBoundarySegmentInBox(index, box, predicate)).toBe(
        candidates.every(predicate),
      );
      expect(someVCarveBoundarySegmentInBox(index, box, predicate)).toBe(
        candidates.some(predicate),
      );
    }
  });

  it('keeps empty, point-segment, and intersecting-chord results exact', () => {
    const empty = buildVCarveBoundarySegmentIndex([]);
    expect(minimumVCarveBoundaryPointDistance(empty, { x: 0, y: 0 })).toBe(Infinity);
    expect(minimumVCarveBoundaryChordDistance(empty, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(
      Infinity,
    );

    const segments: ReadonlyArray<BoundarySegment> = [
      { ax: 2, ay: 3, bx: 2, by: 3 },
      { ax: -4, ay: 0, bx: 4, by: 0 },
    ];
    const index = buildVCarveBoundarySegmentIndex(segments);
    expect(minimumVCarveBoundaryPointDistance(index, { x: 2, y: 3 })).toBe(0);
    expect(minimumVCarveBoundaryChordDistance(index, { x: 0, y: -2 }, { x: 0, y: 2 })).toBe(0);
  });

  it('keeps the original conservative scan when invalid bounds disable the tree', () => {
    const outside: BoundarySegment = { ax: 10, ay: 10, bx: 11, by: 11 };
    const invalid: BoundarySegment = { ax: Number.NaN, ay: 0, bx: 0, by: 0 };
    const index = buildVCarveBoundarySegmentIndex([outside, invalid]);
    const query = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

    expect(index.root).toBeNull();
    expect(everyVCarveBoundarySegmentInBox(index, query, (segment) => segment !== outside)).toBe(
      true,
    );
    expect(someVCarveBoundarySegmentInBox(index, query, (segment) => segment === invalid)).toBe(
      true,
    );

    const finiteIndex = buildVCarveBoundarySegmentIndex([outside]);
    const nonFiniteQuery = { minX: Number.NaN, minY: 0, maxX: Number.NaN, maxY: 20 };
    expect(everyVCarveBoundarySegmentInBox(finiteIndex, nonFiniteQuery, () => false)).toBe(false);
    expect(minimumVCarveBoundaryPointDistance(finiteIndex, { x: Number.NaN, y: 0 })).toBeNaN();
    expect(
      minimumVCarveBoundaryChordDistance(finiteIndex, { x: Number.NaN, y: 0 }, { x: 1, y: 0 }),
    ).toBeNaN();
  });
});

function minimumPointDistanceByFullScan(
  segments: ReadonlyArray<BoundarySegment>,
  point: Vec2,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, pointToSegmentDistance(point.x, point.y, segment));
  }
  return minimum;
}

function minimumChordDistanceByFullScan(
  segments: ReadonlyArray<BoundarySegment>,
  a: Vec2,
  b: Vec2,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    minimum = Math.min(minimum, segmentToSegmentDistance(a, b, segment));
  }
  return minimum;
}

function randomSegment(random: () => number, index: number): BoundarySegment {
  const a = randomPoint(random);
  const b = index % 11 === 0 ? a : randomPoint(random);
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y };
}

function randomPoint(random: () => number): Vec2 {
  return { x: nextBetween(random, -100, 100), y: nextBetween(random, -100, 100) };
}

function randomBox(random: () => number): VCarveBoundaryBox {
  const a = randomPoint(random);
  const b = randomPoint(random);
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function segmentOverlapsBox(segment: BoundarySegment, box: VCarveBoundaryBox): boolean {
  return (
    Math.min(segment.ax, segment.bx) <= box.maxX &&
    Math.max(segment.ax, segment.bx) >= box.minX &&
    Math.min(segment.ay, segment.by) <= box.maxY &&
    Math.max(segment.ay, segment.by) >= box.minY
  );
}

function nextBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

function seededRandom(initialSeed: number): () => number {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}
