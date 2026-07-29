import type { CncTiling } from '../scene';
import type { CncTile } from './cnc-tile';
import { effectiveCncTileGrid, type CncTileBounds } from './effective-cnc-tile-grid';
import type { TilePlanResult } from './tile-plan-result';

/** Plan row-major CNC tiles without materializing an over-budget grid. */
export function planTiles(bounds: CncTileBounds, tiling: CncTiling): TilePlanResult {
  const gridResult = effectiveCncTileGrid(bounds, tiling);
  if (gridResult.kind === 'work-budget-exceeded') return gridResult;
  const { geometry, work } = gridResult.grid;
  const tiles: CncTile[] = [];
  for (let row = 0; row < work.rows; row += 1) {
    for (let col = 0; col < work.columns; col += 1) {
      const minX = bounds.minX + col * geometry.stepXMm;
      const minY = bounds.minY + row * geometry.stepYMm;
      tiles.push({
        row,
        col,
        rect: {
          minX,
          minY,
          maxX: minX + geometry.tileWidthMm,
          maxY: minY + geometry.tileHeightMm,
        },
      });
    }
  }
  return { kind: 'ready', grid: gridResult.grid, tiles };
}
