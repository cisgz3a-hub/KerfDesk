// Heightmap cell-sizing finite-guard invariants (D-S04-002): a non-finite
// dimension must yield a finite positive cell size, not a NaN cell count.

import { describe, expect, it } from 'vitest';
import { heightmapCellSize } from './heightmap';

describe('heightmapCellSize finite guards', () => {
  it('returns the requested size for a finite in-budget request', () => {
    expect(heightmapCellSize(20, 20, 0.2)).toBe(0.2);
  });

  it('returns a finite positive cell size for non-finite dimensions', () => {
    for (const args of [
      [Number.POSITIVE_INFINITY, 20, 0.2],
      [20, Number.NaN, 0.2],
      [20, 20, Number.NaN],
      [Number.NaN, Number.NaN, Number.POSITIVE_INFINITY],
    ] as const) {
      const size = heightmapCellSize(args[0], args[1], args[2]);
      expect(Number.isFinite(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }
  });
});
