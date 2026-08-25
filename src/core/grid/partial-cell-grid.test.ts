import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  mapPartialGridCoordinate,
  partialCellCenter,
  partialCellCount,
  partialCellEnd,
  partialCellIndex,
  partialCellSize,
  partialCellStart,
  partialDualCoordinate,
  partialGridCellAtPoint,
  partialGridHasPartialCell,
  type PartialCellGrid,
} from './partial-cell-grid';

const HALF_EPSILON = Number.EPSILON / 2;
const PARTIAL_GRID: PartialCellGrid = {
  widthCells: 4,
  heightCells: 3,
  widthMm: 1,
  heightMm: 0.65,
  mmPerCell: 0.3,
};

describe('partial-cell-grid', () => {
  it('corrects floating-integral quotients without changing the requested pitch', () => {
    expect(partialCellCount(0.07, 0.01)).toBe(7);
    expect(partialCellCount(0.3, 0.1)).toBe(3);
    expect(partialCellCount(1, 0.3)).toBe(4);
  });

  it('signals counts that cannot be represented as safe finite indices', () => {
    expect(partialCellCount(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
    expect(partialCellCount(Number.POSITIVE_INFINITY, 1)).toBeNull();
  });

  it('keeps a positive quotient-underflow domain as one terminal cell', () => {
    expect(partialCellCount(Number.MIN_VALUE, Number.MAX_VALUE)).toBe(1);
  });

  it('keeps a maximum-finite terminal midpoint finite', () => {
    const pitch = Number.MAX_VALUE * 0.6;
    const grid: PartialCellGrid = {
      widthCells: 2,
      heightCells: 1,
      widthMm: Number.MAX_VALUE,
      heightMm: 1,
      mmPerCell: pitch,
    };
    const expected = pitch + (Number.MAX_VALUE - pitch) / 2;
    expect(partialCellCenter(grid, 'x', 1)).toBe(expected);
    expect(partialDualCoordinate(grid, 'x', 1.5)).toBe(expected);
    expect(Number.isFinite(expected)).toBe(true);
  });

  it('returns the least count that covers every generated finite extent', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (extentMm, mmPerCell) => {
          const count = partialCellCount(extentMm, mmPerCell);
          expect(count).not.toBeNull();
          if (count === null) return;
          expect((count - 1) * mmPerCell).toBeLessThan(extentMm);
          expect(count * mmPerCell).toBeGreaterThanOrEqual(extentMm);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('keeps interior pitch and gives the terminal cells exact bounds and midpoint centers', () => {
    expect(partialCellStart(PARTIAL_GRID, 'x', 3)).toBeCloseTo(0.9, 15);
    expect(partialCellEnd(PARTIAL_GRID, 'x', 3)).toBe(1);
    expect(partialCellCenter(PARTIAL_GRID, 'x', 3)).toBeCloseTo(0.95, 15);
    expect(partialCellSize(PARTIAL_GRID, 'x', 3)).toBeCloseTo(0.1, 15);
    expect(partialCellEnd(PARTIAL_GRID, 'y', 2)).toBe(0.65);
    expect(partialCellCenter(PARTIAL_GRID, 'y', 2)).toBeCloseTo(0.625, 15);
  });

  it('maps marching dual coordinates to exact edges and actual terminal centers', () => {
    expect(partialDualCoordinate(PARTIAL_GRID, 'x', 3)).toBeCloseTo(0.9, 15);
    expect(partialDualCoordinate(PARTIAL_GRID, 'x', 3.5)).toBeCloseTo(0.95, 15);
    expect(partialDualCoordinate(PARTIAL_GRID, 'x', 4)).toBe(1);
  });

  it('maps normalized coordinates between exact domains without clamping', () => {
    const target = { ...PARTIAL_GRID, widthMm: 2, widthCells: 7 };
    expect(mapPartialGridCoordinate(PARTIAL_GRID, target, 'x', 0.95)).toBeCloseTo(1.9, 15);
    expect(mapPartialGridCoordinate(PARTIAL_GRID, target, 'x', 1)).toBe(2);
    expect(mapPartialGridCoordinate(PARTIAL_GRID, target, 'x', 1.5)).toBe(3);
  });

  it('locates the short terminal cell while treating the exact far edge as outside', () => {
    expect(partialCellIndex(PARTIAL_GRID, 'x', 0.95)).toBe(3);
    expect(partialCellIndex(PARTIAL_GRID, 'x', 1)).toBeNull();
    expect(partialGridCellAtPoint(PARTIAL_GRID, 0.95, 0.625)).toEqual({ col: 3, row: 2 });
    expect(partialGridCellAtPoint(PARTIAL_GRID, 0.95, 0.65)).toBeNull();
  });

  it('keeps a rounded-up division at the last inside coordinate in the final cell', () => {
    const thirds = { ...PARTIAL_GRID, widthCells: 3, widthMm: 1, mmPerCell: 1 / 3 };
    const lastInside = 1 - HALF_EPSILON;
    expect(lastInside / thirds.mmPerCell).toBe(3);
    expect(partialCellIndex(thirds, 'x', lastInside)).toBe(2);
  });

  it('retains an exact one-ULP terminal remainder', () => {
    const widthMm = 0.3000000000000001;
    const floatingIntegral: PartialCellGrid = {
      widthCells: 4,
      heightCells: 1,
      widthMm,
      heightMm: 0.1,
      mmPerCell: 0.1,
    };
    expect(partialCellCount(widthMm, floatingIntegral.mmPerCell)).toBe(4);
    expect(partialGridHasPartialCell(floatingIntegral, 'x')).toBe(true);
    expect(partialCellStart(floatingIntegral, 'x', 3)).toBe(0.30000000000000004);
    expect(partialCellEnd(floatingIntegral, 'x', 3)).toBe(widthMm);
    // The mathematical midpoint is between adjacent doubles and rounds back to
    // the terminal start; the cell still exists and retains its exact far edge.
    expect(partialCellCenter(floatingIntegral, 'x', 3)).toBe(
      partialCellStart(floatingIntegral, 'x', 3),
    );
  });
});
