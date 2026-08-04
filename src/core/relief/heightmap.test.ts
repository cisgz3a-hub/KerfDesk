import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { heightmapCellSize, MAX_HEIGHTMAP_CELLS } from './heightmap';

function allocatedCells(widthMm: number, heightMm: number, mmPerCell: number): number {
  return Math.max(1, Math.ceil(widthMm / mmPerCell)) * Math.max(1, Math.ceil(heightMm / mmPerCell));
}

describe('heightmapCellSize', () => {
  it('rejects non-finite target dimensions instead of returning a malformed cell size', () => {
    const result = heightmapCellSize(Number.POSITIVE_INFINITY, 10, 1);

    expect(result).toEqual({
      kind: 'error',
      reason: 'Heightmap width must be a finite positive number.',
    });
  });

  it('coarsens an extreme supported anisotropic relief without exceeding the cell cap', () => {
    const widthMm = 40 * 100_000;
    const heightMm = 40 * 0.001;
    const requested = 3.175 / 8;
    const result = heightmapCellSize(widthMm, heightMm, requested);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.mmPerCell).toBeGreaterThanOrEqual(requested);
    expect(result.mmPerCell).toBeCloseTo(1, 12);
    expect(allocatedCells(widthMm, heightMm, result.mmPerCell)).toBeLessThanOrEqual(
      MAX_HEIGHTMAP_CELLS,
    );
  });

  it('counts the one-cell minimum when a finite dimension underflows during division', () => {
    const widthMm = Number.MIN_VALUE;
    const heightMm = 1e308;
    const requested = 0.001;
    const result = heightmapCellSize(widthMm, heightMm, requested);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.mmPerCell).toBeGreaterThanOrEqual(requested);
    expect(allocatedCells(widthMm, heightMm, result.mmPerCell)).toBeLessThanOrEqual(
      MAX_HEIGHTMAP_CELLS,
    );
  });

  it('never refines the request or exceeds the cap across transformed aspect extremes', () => {
    fc.assert(
      fc.property(
        fc.record({
          baseWidthExponent: fc.integer({ min: -3, max: 3 }),
          aspectExponent: fc.integer({ min: -3, max: 3 }),
          scaleXExponent: fc.integer({ min: -3, max: 5 }),
          scaleYExponent: fc.integer({ min: -3, max: 5 }),
          requestedExponent: fc.integer({ min: -3, max: 1 }),
        }),
        ({
          baseWidthExponent,
          aspectExponent,
          scaleXExponent,
          scaleYExponent,
          requestedExponent,
        }) => {
          const baseWidth = 10 ** baseWidthExponent;
          const widthMm = baseWidth * 10 ** scaleXExponent;
          const heightMm = baseWidth * 10 ** aspectExponent * 10 ** scaleYExponent;
          const requested = 10 ** requestedExponent;
          const result = heightmapCellSize(widthMm, heightMm, requested);

          expect(result.kind).toBe('ok');
          if (result.kind !== 'ok') return;
          expect(result.mmPerCell).toBeGreaterThanOrEqual(Math.max(1e-3, requested));
          expect(allocatedCells(widthMm, heightMm, result.mmPerCell)).toBeLessThanOrEqual(
            MAX_HEIGHTMAP_CELLS,
          );
        },
      ),
      { numRuns: 500 },
    );
  });
});
