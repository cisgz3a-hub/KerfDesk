// RemovalGrid — a uniform depth field over the stock footprint recording how
// deep the cutter has been at every XY cell (Phase H.2, ADR-094). 0 = the
// untouched stock top; values go negative as material is removed. Row-major
// Float32, deterministic by construction (indexed loops only).

export type RemovalGrid = {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly mmPerCell: number;
  // Machine-coordinate min corner of cell (0, 0).
  readonly originX: number;
  readonly originY: number;
  // Depth per cell in mm, ≤ 0. Length = widthCells * heightCells.
  readonly depth: Float32Array;
};

export type RemovalGridSpec = {
  readonly originX: number;
  readonly originY: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerCell?: number;
};

export const DEFAULT_CELL_MM = 0.2;
// ~4M cells ≈ 16 MB Float32 — beyond this the grid coarsens automatically so
// a huge stock cannot freeze the app.
export const MAX_GRID_CELLS = 4_000_000;

export function createRemovalGrid(spec: RemovalGridSpec): RemovalGrid {
  const requested = Math.max(1e-3, spec.mmPerCell ?? DEFAULT_CELL_MM);
  const mmPerCell = coarsenedCellSize(spec.widthMm, spec.heightMm, requested);
  const widthCells = Math.max(1, Math.ceil(spec.widthMm / mmPerCell));
  const heightCells = Math.max(1, Math.ceil(spec.heightMm / mmPerCell));
  return {
    widthCells,
    heightCells,
    mmPerCell,
    originX: spec.originX,
    originY: spec.originY,
    depth: new Float32Array(widthCells * heightCells),
  };
}

// Returns the requested cell size, or the smallest coarser size that keeps
// the cell count under MAX_GRID_CELLS.
export function coarsenedCellSize(widthMm: number, heightMm: number, requested: number): number {
  const cells = Math.ceil(widthMm / requested) * Math.ceil(heightMm / requested);
  if (cells <= MAX_GRID_CELLS) return requested;
  return Math.sqrt((widthMm * heightMm) / MAX_GRID_CELLS);
}

export function gridCellIndex(grid: RemovalGrid, cx: number, cy: number): number | null {
  if (cx < 0 || cy < 0 || cx >= grid.widthCells || cy >= grid.heightCells) return null;
  return cy * grid.widthCells + cx;
}

// Machine coords → cell coords (may be out of range; callers bounds-check
// via gridCellIndex).
export function gridCellOfPoint(
  grid: RemovalGrid,
  x: number,
  y: number,
): { cx: number; cy: number } {
  return {
    cx: Math.floor((x - grid.originX) / grid.mmPerCell),
    cy: Math.floor((y - grid.originY) / grid.mmPerCell),
  };
}
