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

  it('preserves an ordinary requested cell size exactly', () => {
    expect(heightmapCellSize(100, 80, 0.2)).toEqual({ kind: 'ok', mmPerCell: 0.2 });
  });

  it('preserves a finite positive request below 0.001 mm exactly', () => {
    for (const requested of [0.000_125, Number.MIN_VALUE]) {
      expect(heightmapCellSize(1, 1, requested)).toEqual({ kind: 'ok', mmPerCell: requested });
    }
  });

  it('preserves the request when its derived field exceeds the advisory cell count', () => {
    const widthMm = MAX_HEIGHTMAP_CELLS + 1;
    const heightMm = 1;
    const requested = 1;
    const result = heightmapCellSize(widthMm, heightMm, requested);

    expect(allocatedCells(widthMm, heightMm, requested)).toBeGreaterThan(MAX_HEIGHTMAP_CELLS);
    expect(result).toEqual({ kind: 'ok', mmPerCell: requested });
  });

  it('returns every generated finite positive request without rewriting it', () => {
    fc.assert(
      fc.property(fc.integer({ min: -323, max: 308 }), (exponent) => {
        const requested = 10 ** exponent;
        expect(Number.isFinite(requested) && requested > 0).toBe(true);
        expect(heightmapCellSize(1, 1, requested)).toEqual({
          kind: 'ok',
          mmPerCell: requested,
        });
      }),
      { numRuns: 500 },
    );
  });
});
