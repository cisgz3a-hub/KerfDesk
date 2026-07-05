// RemovalGrid — a uniform depth field over the stock footprint recording how
// deep the cutter has been at every XY cell (Phase H.2, ADR-098). 0 = the
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

export type RemovalGridResult =
  | { readonly kind: 'ok'; readonly grid: RemovalGrid }
  | { readonly kind: 'error'; readonly reason: string };

export type RemovalGridCellSizeResult =
  | { readonly kind: 'ok'; readonly mmPerCell: number }
  | { readonly kind: 'error'; readonly reason: string };

export const DEFAULT_CELL_MM = 0.2;
// ~4M cells ≈ 16 MB Float32 — beyond this the grid coarsens automatically so
// a huge stock cannot freeze the app.
export const MAX_GRID_CELLS = 4_000_000;

export function createRemovalGrid(spec: RemovalGridSpec): RemovalGridResult {
  const originError = validateFinite('Removal grid origin X', spec.originX);
  if (originError !== null) return originError;
  const originYError = validateFinite('Removal grid origin Y', spec.originY);
  if (originYError !== null) return originYError;
  const requested = spec.mmPerCell ?? DEFAULT_CELL_MM;
  const size = coarsenedCellSize(spec.widthMm, spec.heightMm, requested);
  if (size.kind === 'error') return size;
  const { mmPerCell } = size;
  const widthCells = Math.max(1, Math.ceil(spec.widthMm / mmPerCell));
  const heightCells = Math.max(1, Math.ceil(spec.heightMm / mmPerCell));
  if (!Number.isFinite(widthCells * heightCells)) {
    return { kind: 'error', reason: 'Removal grid dimensions exceed numeric limits.' };
  }
  return {
    kind: 'ok',
    grid: {
      widthCells,
      heightCells,
      mmPerCell,
      originX: spec.originX,
      originY: spec.originY,
      depth: new Float32Array(widthCells * heightCells),
    },
  };
}

// Returns the requested cell size, or the smallest coarser size that keeps
// the cell count under MAX_GRID_CELLS.
export function coarsenedCellSize(
  widthMm: number,
  heightMm: number,
  requested: number,
): RemovalGridCellSizeResult {
  const widthError = validateFinitePositive('Removal grid width', widthMm);
  if (widthError !== null) return widthError;
  const heightError = validateFinitePositive('Removal grid height', heightMm);
  if (heightError !== null) return heightError;
  const requestedError = validateFinitePositive('Removal grid cell size', requested);
  if (requestedError !== null) return requestedError;
  const requestedMm = Math.max(1e-3, requested);
  const cells = Math.ceil(widthMm / requestedMm) * Math.ceil(heightMm / requestedMm);
  if (Number.isFinite(cells) && cells <= MAX_GRID_CELLS) {
    return { kind: 'ok', mmPerCell: requestedMm };
  }
  const area = widthMm * heightMm;
  if (!Number.isFinite(area)) {
    return { kind: 'error', reason: 'Removal grid dimensions exceed numeric limits.' };
  }
  const mmPerCell = Math.sqrt(area / MAX_GRID_CELLS);
  return Number.isFinite(mmPerCell) && mmPerCell > 0
    ? { kind: 'ok', mmPerCell }
    : { kind: 'error', reason: 'Removal grid dimensions exceed numeric limits.' };
}

function validateFinite(
  label: string,
  value: number,
): { readonly kind: 'error'; readonly reason: string } | null {
  return Number.isFinite(value)
    ? null
    : { kind: 'error', reason: `${label} must be a finite number.` };
}

function validateFinitePositive(
  label: string,
  value: number,
): { readonly kind: 'error'; readonly reason: string } | null {
  return Number.isFinite(value) && value > 0
    ? null
    : { kind: 'error', reason: `${label} must be a finite positive number.` };
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
