// Exact finite-domain geometry for grids whose requested interior pitch does
// not evenly divide their physical width or height. Every interior cell keeps
// the requested square pitch; only the terminal cell on an axis may be short.

/** A finite rectangular grid with square interior pitch and exact outer extents. */
export type PartialCellGrid = {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerCell: number;
};

/** Axis selector shared by all partial-cell coordinate helpers. */
export type PartialCellAxis = 'x' | 'y';

/** Integer cell address inside a partial-cell grid. */
export type PartialGridCell = {
  readonly col: number;
  readonly row: number;
};

/** The least safe integer count whose requested cells cover the exact extent. */
export function partialCellCount(extentMm: number, mmPerCell: number): number | null {
  if (!positiveFinite(extentMm) || !positiveFinite(mmPerCell)) return null;
  const quotient = extentMm / mmPerCell;
  if (!Number.isFinite(quotient)) return null;
  // A positive extent smaller than the smallest representable fraction of the
  // requested pitch is still one terminal cell. Consumers that need a nominal
  // cell frame use their normalized one-cell fallback instead of refusing it.
  if (quotient === 0) return 1;
  let count = Math.max(1, Math.ceil(quotient));
  if (!Number.isSafeInteger(count)) return null;
  while (count > 1 && (count - 1) * mmPerCell >= extentMm) count -= 1;
  while (count * mmPerCell < extentMm) {
    count += 1;
    if (!Number.isSafeInteger(count)) return null;
  }
  return count;
}

/** Exact physical start coordinate of a cell on one axis. */
export function partialCellStart(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  index: number,
): number {
  return index === axisCellCount(grid, axis) ? axisExtentMm(grid, axis) : index * grid.mmPerCell;
}

/** Exact physical end coordinate of a cell on one axis. */
export function partialCellEnd(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  index: number,
): number {
  const count = axisCellCount(grid, axis);
  return index + 1 === count ? axisExtentMm(grid, axis) : (index + 1) * grid.mmPerCell;
}

/** Stable physical midpoint of a cell, including a shortened terminal cell. */
export function partialCellCenter(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  index: number,
): number {
  const start = partialCellStart(grid, axis, index);
  const end = partialCellEnd(grid, axis, index);
  return end === (index + 1) * grid.mmPerCell
    ? (index + 0.5) * grid.mmPerCell
    : start + (end - start) / 2;
}

/** Physical size of a cell on one axis. */
export function partialCellSize(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  index: number,
): number {
  return partialCellEnd(grid, axis, index) - partialCellStart(grid, axis, index);
}

/** True when the exact terminal cell is shorter than the requested pitch. */
export function partialGridHasPartialCell(grid: PartialCellGrid, axis: PartialCellAxis): boolean {
  const extent = axisExtentMm(grid, axis);
  const covered = axisCellCount(grid, axis) * grid.mmPerCell;
  return covered > extent;
}

/**
 * Map a local physical coordinate to the same normalized position in another
 * exact grid domain. Values outside the source domain are extrapolated; this
 * helper never clamps operator geometry.
 */
export function mapPartialGridCoordinate(
  source: PartialCellGrid,
  target: PartialCellGrid,
  axis: PartialCellAxis,
  coordinateMm: number,
): number {
  const sourceExtent = axisExtentMm(source, axis);
  const targetExtent = axisExtentMm(target, axis);
  if (coordinateMm === 0) return 0;
  if (coordinateMm === sourceExtent) return targetExtent;
  return (coordinateMm / sourceExtent) * targetExtent;
}

/** Integer dual coordinates are edges; half-integers are actual cell centers. */
export function partialDualCoordinate(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  cellCoordinate: number,
): number {
  const count = axisCellCount(grid, axis);
  const extent = axisExtentMm(grid, axis);
  if (cellCoordinate === count) return extent;
  const index = Math.floor(cellCoordinate);
  const fraction = cellCoordinate - index;
  if (fraction === 0) return partialCellStart(grid, axis, index);
  if (fraction === 0.5) return partialCellCenter(grid, axis, index);
  return partialCellStart(grid, axis, index) + fraction * partialCellSize(grid, axis, index);
}

/** Locate a physical coordinate; the exact far edge and outside values return null. */
export function partialCellIndex(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  coordinateMm: number,
): number | null {
  const extent = axisExtentMm(grid, axis);
  if (!Number.isFinite(coordinateMm) || coordinateMm < 0 || coordinateMm >= extent) return null;
  const index = Math.floor(coordinateMm / grid.mmPerCell);
  const count = axisCellCount(grid, axis);
  // The physical-domain check is authoritative. Division can round the last
  // representable inside coordinate up to `count`; it still belongs to N - 1.
  return index < count ? index : count - 1;
}

/** Locate a physical XY point inside the exact grid domain. */
export function partialGridCellAtPoint(
  grid: PartialCellGrid,
  xMm: number,
  yMm: number,
): PartialGridCell | null {
  const col = partialCellIndex(grid, 'x', xMm);
  if (col === null) return null;
  const row = partialCellIndex(grid, 'y', yMm);
  return row === null ? null : { col, row };
}

function axisCellCount(grid: PartialCellGrid, axis: PartialCellAxis): number {
  return axis === 'x' ? grid.widthCells : grid.heightCells;
}

function axisExtentMm(grid: PartialCellGrid, axis: PartialCellAxis): number {
  return axis === 'x' ? grid.widthMm : grid.heightMm;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
