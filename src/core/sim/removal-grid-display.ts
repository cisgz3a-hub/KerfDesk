// downsampleRemovalGrid — reduce a removal grid to a display-sized grid for
// the 3D cut preview (ADR-103 G4). Each fully included output cell takes the
// deepest value in its source block; any excluded source coverage keeps the
// coarse display cell excluded so preview downsampling cannot fill holes.
// Pure and deterministic (indexed loops only).

import type { RemovalGrid, RemovalGridResolution } from './removal-grid';

export function downsampleRemovalGrid(grid: RemovalGrid, maxCellsAcross: number): RemovalGrid {
  const factor = displayFactor(grid, maxCellsAcross);
  if (factor <= 1) return grid;
  const widthCells = Math.ceil(grid.widthCells / factor);
  const heightCells = Math.ceil(grid.heightCells / factor);
  const depth = new Float32Array(widthCells * heightCells);
  const inclusion = grid.inclusion === undefined ? undefined : new Uint8Array(depth.length);
  for (let row = 0; row < heightCells; row += 1) {
    for (let col = 0; col < widthCells; col += 1) {
      const sampled = downsampledCell(grid, factor, row, col);
      const targetIndex = row * widthCells + col;
      depth[targetIndex] = sampled.depth;
      if (inclusion !== undefined && sampled.included) inclusion[targetIndex] = 1;
    }
  }
  return {
    widthCells,
    heightCells,
    mmPerCell: grid.mmPerCell * factor,
    originX: grid.originX,
    originY: grid.originY,
    depth,
    ...(inclusion === undefined ? {} : { inclusion }),
    resolution: removalGridDisplayResolution(grid, maxCellsAcross),
  };
}

/** Resolution of the bounded display copy without allocating that copy. */
export function removalGridDisplayResolution(
  grid: RemovalGrid,
  maxCellsAcross: number,
): RemovalGridResolution {
  const factor = displayFactor(grid, maxCellsAcross);
  if (factor <= 1) return grid.resolution;
  return {
    requestedMmPerCell: grid.resolution.requestedMmPerCell,
    effectiveMmPerCell: grid.mmPerCell * factor,
    reason: 'display-mesh-cell-budget',
  };
}

function displayFactor(grid: RemovalGrid, maxCellsAcross: number): number {
  const across = Math.max(1, Math.floor(maxCellsAcross));
  return Math.ceil(Math.max(grid.widthCells, grid.heightCells) / across);
}

function downsampledCell(
  grid: RemovalGrid,
  factor: number,
  row: number,
  col: number,
): { readonly depth: number; readonly included: boolean } {
  let deepest = 0;
  const rowEnd = Math.min(grid.heightCells, (row + 1) * factor);
  const colEnd = Math.min(grid.widthCells, (col + 1) * factor);
  for (let sourceRow = row * factor; sourceRow < rowEnd; sourceRow += 1) {
    for (let sourceCol = col * factor; sourceCol < colEnd; sourceCol += 1) {
      const sourceIndex = sourceRow * grid.widthCells + sourceCol;
      if (grid.inclusion?.[sourceIndex] === 0) return { depth: 0, included: false };
      deepest = Math.min(deepest, grid.depth[sourceIndex] ?? 0);
    }
  }
  return { depth: deepest, included: true };
}
