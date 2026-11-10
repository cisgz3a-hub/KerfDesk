import { describe, expect, it } from 'vitest';
import {
  boundsOfPoints,
  boxCentre,
  boxContains,
  boxCorners,
  boxesOverlap,
  growBox,
  isFiniteBox,
  pointInBox,
  segmentBox,
  unionBox,
} from './box-math';

const unit = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

describe('box-math', () => {
  it('bounds the points, and reports no points as an inverted box', () => {
    expect(
      boundsOfPoints([
        { x: 2, y: -1 },
        { x: -3, y: 4 },
      ]),
    ).toEqual({ minX: -3, minY: -1, maxX: 2, maxY: 4 });
    const empty = boundsOfPoints([]);
    expect(empty.minX).toBe(Infinity);
    expect(empty.maxX).toBe(-Infinity);
    expect(isFiniteBox(empty)).toBe(false);
  });

  it('builds a box from two corners given in either order', () => {
    expect(segmentBox({ x: 3, y: 1 }, { x: 1, y: 2 })).toEqual({
      minX: 1,
      minY: 1,
      maxX: 3,
      maxY: 2,
    });
  });

  it('counts touching edges as contained, overlapping and inside', () => {
    expect(boxContains(unit, unit)).toBe(true);
    expect(boxContains(unit, { ...unit, maxX: 1.1 })).toBe(false);
    expect(boxesOverlap(unit, { minX: 1, minY: 1, maxX: 2, maxY: 2 })).toBe(true);
    expect(boxesOverlap(unit, { minX: 1.1, minY: 0, maxX: 2, maxY: 1 })).toBe(false);
    expect(pointInBox({ x: 1, y: 0 }, unit)).toBe(true);
    expect(pointInBox({ x: 1.1, y: 0 }, unit)).toBe(false);
  });

  it('never overlaps a box that holds NaN', () => {
    expect(boxesOverlap(unit, { ...unit, minX: Number.NaN })).toBe(false);
    expect(isFiniteBox({ ...unit, maxY: Number.NaN })).toBe(false);
  });

  it('joins, grows and measures boxes', () => {
    expect(unionBox(unit, { minX: -1, minY: 0.5, maxX: 0.5, maxY: 3 })).toEqual({
      minX: -1,
      minY: 0,
      maxX: 1,
      maxY: 3,
    });
    expect(growBox(unit, 2)).toEqual({ minX: -2, minY: -2, maxX: 3, maxY: 3 });
    expect(boxCentre(unit)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('lists corners from (minX, minY), going along X first', () => {
    expect(boxCorners(unit)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });
});
