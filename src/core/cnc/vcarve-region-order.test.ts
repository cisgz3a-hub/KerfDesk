import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { vcarveRegionOrder } from './vcarve-region-order';

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
