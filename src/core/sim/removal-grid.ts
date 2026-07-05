// RemovalGrid — a uniform depth field over the stock footprint recording how
// deep the cutter has been at every XY cell (Phase H.2, ADR-098). 0 = the
// untouched stock top; values go negative as material is removed. Row-major
// Float32, deterministic by construction (indexed loops only).

import { finiteOr, finitePositiveOr } from '../util';

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
// Beyond this a stock dimension is treated as pathological input and clamped so
// widthMm*heightMm cannot overflow to Infinity (which would poison mmPerCell and
// the cell counts). Far larger than any real machine bed (1 km).
export const MAX_GRID_DIMENSION_MM = 1_000_000;

// A stock dimension normalized to a finite positive value no larger than
// MAX_GRID_DIMENSION_MM, so the widthMm*heightMm area math stays finite even for
// pathological finite input (a plain finite guard leaves 1e308 to overflow).
function boundedDimensionMm(value: number): number {
  return Math.min(MAX_GRID_DIMENSION_MM, finitePositiveOr(value, DEFAULT_CELL_MM));
}

export function createRemovalGrid(spec: RemovalGridSpec): RemovalGrid {
  // Fail closed on non-finite dimensions: a NaN/Infinity size would size a
  // NaN cell count (→ zero-length or throwing Float32Array). Normalize to a
  // minimal valid grid instead.
  const widthMm = boundedDimensionMm(spec.widthMm);
  const heightMm = boundedDimensionMm(spec.heightMm);
  const requested = Math.max(
    1e-3,
    finitePositiveOr(spec.mmPerCell ?? DEFAULT_CELL_MM, DEFAULT_CELL_MM),
  );
  const mmPerCell = coarsenedCellSize(widthMm, heightMm, requested);
  const widthCells = Math.max(1, Math.ceil(widthMm / mmPerCell));
  const heightCells = Math.max(1, Math.ceil(heightMm / mmPerCell));
  return {
    widthCells,
    heightCells,
    mmPerCell,
    originX: finiteOr(spec.originX, 0),
    originY: finiteOr(spec.originY, 0),
    depth: new Float32Array(widthCells * heightCells),
  };
}

// Returns the requested cell size, or the smallest coarser size that keeps
// the cell count under MAX_GRID_CELLS.
export function coarsenedCellSize(widthMm: number, heightMm: number, requested: number): number {
  const w = boundedDimensionMm(widthMm);
  const h = boundedDimensionMm(heightMm);
  const req = finitePositiveOr(requested, DEFAULT_CELL_MM);
  const cells = Math.ceil(w / req) * Math.ceil(h / req);
  if (cells <= MAX_GRID_CELLS) return req;
  return Math.sqrt((w * h) / MAX_GRID_CELLS);
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
