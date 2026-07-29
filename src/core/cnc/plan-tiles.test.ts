import { describe, expect, it } from 'vitest';
import type { CncTiling } from '../scene';
import type { CncTile } from './cnc-tile';
import { planTiles } from './plan-tiles';

const ORDINARY_TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: false,
};

function readyTiles(
  bounds: CncTile['rect'],
  tiling: CncTiling = ORDINARY_TILING,
): ReadonlyArray<CncTile> {
  const result = planTiles(bounds, tiling);
  if (result.kind !== 'ready') throw new Error('expected tile plan within work budget');
  return result.tiles;
}

describe('planTiles', () => {
  it('materializes an ordinary effective grid in row-major order', () => {
    const tiles = readyTiles({ minX: 0, minY: 0, maxX: 250, maxY: 80 });

    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => `${tile.row},${tile.col}`)).toEqual(['0,0', '0,1', '0,2']);
    expect(tiles[1]?.rect).toEqual({ minX: 90, minY: 0, maxX: 190, maxY: 100 });
  });

  it('materializes one tile when the job fits inside it', () => {
    expect(readyTiles({ minX: 0, minY: 0, maxX: 50, maxY: 50 })).toHaveLength(1);
  });

  it('returns only work metadata when the effective grid exceeds the budget', () => {
    const result = planTiles(
      { minX: 0, minY: 0, maxX: 400, maxY: 400 },
      {
        tileWidthMm: 60,
        tileHeightMm: 60,
        overlapMm: 100,
        registrationHoles: false,
      },
    );

    expect(result.kind).toBe('work-budget-exceeded');
    expect(result).not.toHaveProperty('tiles');
    expect(result.grid.coveredBounds.maxX).toBeGreaterThanOrEqual(400);
    expect(result.grid.coveredBounds.maxY).toBeGreaterThanOrEqual(400);
  });

  it('materializes the corrected far-edge tile after a floating-point boundary tie', () => {
    const requiredMaximumMm = 4_103.400_000_000_001;
    const tiles = readyTiles(
      { minX: 0, minY: 0, maxX: requiredMaximumMm, maxY: 100 },
      {
        tileWidthMm: 195.4,
        tileHeightMm: 100,
        overlapMm: 0,
        registrationHoles: false,
      },
    );

    expect(tiles).toHaveLength(22);
    expect(tiles.at(-1)?.rect.maxX).toBeGreaterThanOrEqual(requiredMaximumMm);
  });
});
