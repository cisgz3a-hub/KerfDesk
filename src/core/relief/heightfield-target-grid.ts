import {
  partialCellCount,
  partialDualCoordinate,
  partialGridHasPartialCell,
  type PartialCellAxis,
  type PartialCellGrid,
} from '../grid';

/** Build the exact target grid, or null when its cell counts are unrepresentable. */
export function heightfieldTargetGrid(
  widthMm: number,
  heightMm: number,
  mmPerCell: number,
): PartialCellGrid | null {
  const widthCells = partialCellCount(widthMm, mmPerCell);
  const heightCells = partialCellCount(heightMm, mmPerCell);
  return widthCells === null || heightCells === null
    ? null
    : { widthCells, heightCells, widthMm, heightMm, mmPerCell };
}

/** Normalized physical edge coordinate used to sample a target cell footprint. */
export function targetCellFraction(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  edgeIndex: number,
): number {
  const cells = axis === 'x' ? grid.widthCells : grid.heightCells;
  if (!partialGridHasPartialCell(grid, axis)) return edgeIndex / cells;
  const extent = axis === 'x' ? grid.widthMm : grid.heightMm;
  return partialDualCoordinate(grid, axis, edgeIndex) / extent;
}
