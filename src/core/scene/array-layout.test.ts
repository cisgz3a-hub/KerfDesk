import { describe, expect, it } from 'vitest';
import { MAX_ARRAY_COPIES, arrayPlacements } from './array-layout';

const bounds = { minX: 10, minY: 20, maxX: 30, maxY: 30 };

describe('arrayPlacements', () => {
  it('builds a deterministic row-major grid from the original position', () => {
    expect(
      arrayPlacements(bounds, {
        kind: 'grid',
        rows: 2,
        columns: 2,
        spacingX: 5,
        spacingY: 3,
      }),
    ).toEqual([
      { dx: 0, dy: 0, rotationDeg: 0 },
      { dx: 25, dy: 0, rotationDeg: 0 },
      { dx: 0, dy: 13, rotationDeg: 0 },
      { dx: 25, dy: 13, rotationDeg: 0 },
    ]);
  });

  it('places a circular array around the requested center', () => {
    const placements = arrayPlacements(bounds, {
      kind: 'circular',
      count: 4,
      centerX: 100,
      centerY: 100,
      radius: 20,
      startAngleDeg: 0,
      rotateCopies: false,
    });
    expect(placements[0]).toMatchObject({ dx: 100, dy: 75, rotationDeg: 0 });
    expect(placements[1]?.dx).toBeCloseTo(80);
    expect(placements[1]?.dy).toBeCloseTo(95);
  });

  it('clamps pathological counts and non-finite inputs', () => {
    const placements = arrayPlacements(bounds, {
      kind: 'grid',
      rows: Number.POSITIVE_INFINITY,
      columns: 10000,
      spacingX: Number.NaN,
      spacingY: -2,
    });
    expect(placements).toHaveLength(MAX_ARRAY_COPIES);
    expect(placements.every((placement) => Number.isFinite(placement.dx))).toBe(true);
  });
});
