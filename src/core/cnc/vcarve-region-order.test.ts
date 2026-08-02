import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  buildVCarveRegionLayout,
  vcarveRegionBuckets,
  vcarveRegionBucketsWithLayout,
  vcarveRegionOrder,
} from './vcarve-region-order';

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

function rectangle(minX: number, minY: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
    ],
  };
}

function orderedPolylines(
  source: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<Polyline> {
  return vcarveRegionOrder(source, rings).map((entry) => entry.polyline);
}

describe('vcarveRegionOrder', () => {
  it('keeps source-region order when the offset engine returns disjoint rings in another order', () => {
    const left = square(0, 0, 8);
    const right = square(20, 0, 8);
    const leftRing = square(1, 1, 6);
    const rightRing = square(21, 1, 6);

    expect(orderedPolylines([left, right], [[rightRing, leftRing]])).toEqual([leftRing, rightRing]);
  });

  it('keeps every ladder step and split descendant together before the next region', () => {
    const left = square(0, 0, 8);
    const right = square(20, 0, 8);
    const leftOuter = square(1, 1, 6);
    const rightOuter = square(21, 1, 6);
    const leftInnerA = square(1, 1, 2);
    const leftInnerB = square(5, 5, 2);
    const rightInner = square(22, 2, 4);

    expect(
      vcarveRegionOrder(
        [left, right],
        [
          [rightOuter, leftOuter],
          [leftInnerB, rightInner, leftInnerA],
        ],
      ),
    ).toEqual([
      { step: 0, polyline: leftOuter },
      { step: 1, polyline: leftInnerB },
      { step: 1, polyline: leftInnerA },
      { step: 0, polyline: rightOuter },
      { step: 1, polyline: rightInner },
    ]);
  });

  it('keeps an expanding hole boundary with its containing outer region', () => {
    const outer = square(0, 0, 20);
    const hole = square(7, 7, 6);
    const separate = square(30, 0, 10);
    const outerRing = square(1, 1, 18);
    const expandedHoleRing = square(6, 6, 8);
    const separateRing = square(31, 1, 8);

    expect(
      orderedPolylines([outer, hole, separate], [[separateRing, expandedHoleRing, outerRing]]),
    ).toEqual([expandedHoleRing, outerRing, separateRing]);
  });

  it("assigns an island inside another region's hole to its own source-order region", () => {
    const outer = square(0, 0, 30);
    const hole = square(5, 5, 20);
    const island = square(10, 10, 10);
    const outerRing = square(1, 1, 28);
    const expandedHoleRing = square(4, 4, 22);
    const islandRing = square(11, 11, 8);

    expect(
      orderedPolylines([outer, hole, island], [[islandRing, expandedHoleRing, outerRing]]),
    ).toEqual([expandedHoleRing, outerRing, islandRing]);
  });

  it('puts contours that cannot be assigned to a source region last without reordering them', () => {
    const left = square(0, 0, 8);
    const right = square(20, 0, 8);
    const leftRing = square(1, 1, 6);
    const rightRing = square(21, 1, 6);
    const strayOuter = square(50, 0, 4);
    const strayInner = square(51, 1, 2);

    expect(
      orderedPolylines([left, right], [[strayOuter, rightRing, leftRing], [strayInner]]),
    ).toEqual([leftRing, rightRing, strayOuter, strayInner]);
  });

  it('leaves a single-region ladder in its original step and contour order', () => {
    const outer = square(0, 0, 20);
    const hole = square(7, 7, 6);
    const firstOuter = square(1, 1, 18);
    const firstHole = square(6, 6, 8);
    const secondOuter = square(2, 2, 16);
    const secondHole = square(5, 5, 10);

    expect(
      vcarveRegionOrder(
        [outer, hole],
        [
          [firstHole, firstOuter],
          [secondOuter, secondHole],
        ],
      ),
    ).toEqual([
      { step: 0, polyline: firstHole },
      { step: 0, polyline: firstOuter },
      { step: 1, polyline: secondOuter },
      { step: 1, polyline: secondHole },
    ]);
  });
});

// ADR-281: the ladder zips δ-ring buckets with thin-detail buckets by index,
// so bucket layout must depend only on the source contours.
describe('vcarveRegionBuckets', () => {
  it('returns no buckets for an empty ring set', () => {
    expect(vcarveRegionBuckets([square(0, 0, 8)], [])).toEqual([]);
  });

  it('single region: one bucket in raw ladder order', () => {
    const ring0 = square(1, 1, 6);
    const ring1 = square(2, 2, 4);
    expect(vcarveRegionBuckets([square(0, 0, 8)], [[ring0], [ring1]])).toEqual([
      [
        { step: 0, polyline: ring0 },
        { step: 1, polyline: ring1 },
      ],
    ]);
  });

  it('two ring sets bucketed against the same sources align by region index', () => {
    const left = square(0, 0, 8);
    const right = square(20, 0, 8);
    const leftRing = square(1, 1, 6);
    const rightRing = square(21, 1, 6);
    const rightDetail = square(22, 2, 4);

    const coarse = vcarveRegionBuckets([left, right], [[rightRing, leftRing]]);
    const detail = vcarveRegionBuckets([left, right], [[rightDetail]]);

    // Buckets: [left, right, unassigned] in both calls.
    expect(coarse).toEqual([
      [{ step: 0, polyline: leftRing }],
      [{ step: 0, polyline: rightRing }],
      [],
    ]);
    expect(detail).toEqual([[], [{ step: 0, polyline: rightDetail }], []]);
  });

  it('flattening the buckets reproduces vcarveRegionOrder exactly', () => {
    const source = [square(0, 0, 8), square(20, 0, 8)];
    const rings = [[square(21, 1, 6), square(1, 1, 6)], [square(2, 2, 4)]];
    expect(vcarveRegionBuckets(source, rings).flat()).toEqual(vcarveRegionOrder(source, rings));
  });

  it('uses strict source nesting so a partial overlap cannot masquerade as a hole', () => {
    const rightFirst = rectangle(5, 2, 10, 6);
    const leftSecond = rectangle(0, 0, 10, 10);
    const leftRoot = square(0.5, 0.5, 4);
    const rightRoot = rectangle(10.5, 2.5, 4, 5);
    const leftRing = square(1, 1, 3);
    const rightRing = rectangle(11, 3, 3, 4);
    const rings = [[leftRing, rightRing]];
    const layout = buildVCarveRegionLayout([leftRoot, rightRoot], [rightFirst, leftSecond], rings);

    expect(vcarveRegionBucketsWithLayout(layout, rings).flat()).toEqual([
      { step: 0, polyline: rightRing },
      { step: 0, polyline: leftRing },
    ]);
  });

  it('ranks a nested island by original source order while keeping its hole with the outer', () => {
    const outer = square(0, 0, 30);
    const hole = square(5, 5, 20);
    const island = square(10, 10, 10);
    const outerRing = square(1, 1, 28);
    const expandedHoleRing = square(4, 4, 22);
    const islandRing = square(11, 11, 8);
    const rings = [[outerRing, islandRing, expandedHoleRing]];
    const layout = buildVCarveRegionLayout([outer, hole, island], [island, outer, hole], rings);

    expect(vcarveRegionBucketsWithLayout(layout, rings).flat()).toEqual([
      { step: 0, polyline: islandRing },
      { step: 0, polyline: outerRing },
      { step: 0, polyline: expandedHoleRing },
    ]);
  });

  it('uses one shared layout when coarse and detail stages emit different regions', () => {
    const left = square(0, 0, 8);
    const right = square(20, 0, 8);
    const leftCoarse = square(1, 1, 6);
    const rightDetail = square(22, 2, 4);
    const layout = buildVCarveRegionLayout(
      [left, right],
      [left, right],
      [[leftCoarse], [rightDetail]],
    );

    expect(vcarveRegionBucketsWithLayout(layout, [[leftCoarse]])).toEqual([
      [{ step: 0, polyline: leftCoarse }],
      [],
      [],
    ]);
    expect(vcarveRegionBucketsWithLayout(layout, [[rightDetail]])).toEqual([
      [],
      [{ step: 0, polyline: rightDetail }],
      [],
    ]);
  });
});
