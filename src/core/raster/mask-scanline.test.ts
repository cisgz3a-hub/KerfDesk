import { describe, expect, it } from 'vitest';
import { isInsideRowCrossings, maskRowCrossings, type MaskContours } from './mask-scanline';

describe('maskRowCrossings', () => {
  const square: MaskContours = [
    [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ],
  ];

  it('returns the crossings of a row in ascending order', () => {
    expect(Array.from(maskRowCrossings(square, 2))).toEqual([1, 3]);
  });

  it('skips horizontal edges, which never straddle a row', () => {
    const horizontal: MaskContours = [
      [
        { x: 0, y: 5 },
        { x: 4, y: 5 },
        { x: 2, y: 5 },
      ],
    ];
    expect(Array.from(maskRowCrossings(horizontal, 5))).toEqual([]);
  });

  it('counts a row exactly on the lower edge once per straddling segment', () => {
    // Half-open rule: y === 1 is above the horizontal bottom edge but below
    // the two vertical ones, so the row still crosses twice.
    expect(Array.from(maskRowCrossings(square, 1))).toEqual([1, 3]);
    // y === 3 is the top edge; both verticals now sit entirely below it.
    expect(Array.from(maskRowCrossings(square, 3))).toEqual([]);
  });

  it('returns nothing for degenerate and empty contours', () => {
    expect(Array.from(maskRowCrossings([], 1))).toEqual([]);
    expect(Array.from(maskRowCrossings([[]], 1))).toEqual([]);
    expect(Array.from(maskRowCrossings([[{ x: 1, y: 1 }]], 1))).toEqual([]);
  });
});

describe('isInsideRowCrossings', () => {
  it('reads membership as the parity of the crossings right of the point', () => {
    const crossings = Float64Array.from([1, 3, 5, 7]);
    expect(isInsideRowCrossings(crossings, 0)).toBe(false);
    expect(isInsideRowCrossings(crossings, 2)).toBe(true);
    expect(isInsideRowCrossings(crossings, 4)).toBe(false);
    expect(isInsideRowCrossings(crossings, 6)).toBe(true);
    expect(isInsideRowCrossings(crossings, 8)).toBe(false);
  });

  it('treats a point exactly on a crossing as the per-pixel test did', () => {
    // The per-pixel toggle was `point.x < x`, so a point ON a crossing does
    // not count that crossing.
    expect(isInsideRowCrossings(Float64Array.from([1, 3]), 1)).toBe(true);
    expect(isInsideRowCrossings(Float64Array.from([1, 3]), 3)).toBe(false);
  });

  it('is outside for a non-finite point, matching the old comparison', () => {
    // An ODD crossing list (what a dropped NaN crossing leaves behind) is the
    // only shape that tells "NaN is outside" apart from "NaN counts every
    // crossing", so the NaN case is pinned rather than accidentally passing.
    const oddCrossings = Float64Array.from([1, 3, 5]);
    expect(isInsideRowCrossings(oddCrossings, Number.NaN)).toBe(false);
    expect(isInsideRowCrossings(oddCrossings, Number.POSITIVE_INFINITY)).toBe(false);
    // -Infinity is left of every crossing, so all three still count.
    expect(isInsideRowCrossings(oddCrossings, Number.NEGATIVE_INFINITY)).toBe(true);
  });

  it('is outside when the row has no crossings', () => {
    expect(isInsideRowCrossings(Float64Array.from([]), 0)).toBe(false);
  });
});
