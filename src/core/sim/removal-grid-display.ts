// downsampleRemovalGrid — reduce a removal grid to a display-sized grid for
// the 3D cut preview (ADR-102 G4). Each output cell takes the DEEPEST value
// of its source block so narrow cuts stay visible at coarse resolution.
// Pure and deterministic (indexed loops only).

import type { RemovalGrid } from './removal-grid';

export function downsampleRemovalGrid(grid: RemovalGrid, maxCellsAcross: number): RemovalGrid {
  const across = Math.max(1, Math.floor(maxCellsAcross));
  const factor = Math.ceil(Math.max(grid.widthCells, grid.heightCells) / across);
  if (factor <= 1) return grid;
  const widthCells = Math.ceil(grid.widthCells / factor);
  const heightCells = Math.ceil(grid.heightCells / factor);
  const depth = new Float32Array(widthCells * heightCells);
  for (let row = 0; row < heightCells; row += 1) {
    for (let col = 0; col < widthCells; col += 1) {
      let deepest = 0;
      const rowEnd = Math.min(grid.heightCells, (row + 1) * factor);
      const colEnd = Math.min(grid.widthCells, (col + 1) * factor);
      for (let sr = row * factor; sr < rowEnd; sr += 1) {
        for (let sc = col * factor; sc < colEnd; sc += 1) {
          const value = grid.depth[sr * grid.widthCells + sc] ?? 0;
          if (value < deepest) deepest = value;
        }
      }
      depth[row * widthCells + col] = deepest;
    }
  }
  return {
    widthCells,
    heightCells,
    mmPerCell: grid.mmPerCell * factor,
    originX: grid.originX,
    originY: grid.originY,
    depth,
  };
}
