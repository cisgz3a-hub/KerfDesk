import {
  partialGridHasPartialCell,
  type PartialCellAxis,
  type PartialCellGrid,
} from '../../core/grid';

/** Numeric mirror of the wood shader's physical-mm to depth-texture mapping. */
export function carveDepthTextureAxisUv(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  coordinateMm: number,
): number {
  const cells = axis === 'x' ? grid.widthCells : grid.heightCells;
  const extentMm = axis === 'x' ? grid.widthMm : grid.heightMm;
  if (!partialGridHasPartialCell(grid, axis)) return coordinateMm / extentMm;

  const terminalIndex = cells - 1;
  const terminalStartMm = terminalIndex * grid.mmPerCell;
  const cellCoordinate =
    coordinateMm <= terminalStartMm
      ? coordinateMm / grid.mmPerCell
      : terminalIndex + (coordinateMm - terminalStartMm) / (extentMm - terminalStartMm);
  return cellCoordinate / cells;
}

/** GLSL-friendly per-axis flags, computed in the exact JavaScript grid frame. */
export function carveDepthTexturePartialAxes(grid: PartialCellGrid): {
  readonly x: number;
  readonly y: number;
} {
  return {
    x: partialGridHasPartialCell(grid, 'x') ? 1 : 0,
    y: partialGridHasPartialCell(grid, 'y') ? 1 : 0,
  };
}
