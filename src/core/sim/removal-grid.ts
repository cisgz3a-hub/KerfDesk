// RemovalGrid — a depth field over the exact stock footprint recording how
// deep the cutter has been at every XY cell (Phase H.2, ADR-098). 0 = the
// untouched stock top; values go negative as material is removed. Row-major
// Float32, deterministic by construction (indexed loops only).

import { partialCellCount, partialCellIndex } from '../grid';

export type RemovalGridResolutionReason =
  | 'minimum-cell-size'
  | 'removal-grid-cell-budget'
  | 'interactive-preview-cell-budget'
  | 'display-mesh-cell-budget'
  | 'caller-selected-cell-size';

/** Traceable resolution used by display-only removal-grid previews. */
export type RemovalGridResolution = {
  readonly requestedMmPerCell: number;
  readonly effectiveMmPerCell: number;
  readonly reason: RemovalGridResolutionReason | null;
};

export type RemovalGrid = {
  readonly widthCells: number;
  readonly heightCells: number;
  // Exact physical domain. Interior cells retain mmPerCell; the terminal cell
  // on either axis ends at this dimension and may therefore be shorter.
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerCell: number;
  // Machine-coordinate min corner of cell (0, 0).
  readonly originX: number;
  readonly originY: number;
  // Depth per cell in mm, ≤ 0. Length = widthCells * heightCells.
  readonly depth: Float32Array;
  // Optional binary material domain used by canonical relief previews.
  readonly inclusion?: Uint8Array;
  // Requested-versus-effective display resolution. This is preview evidence;
  // it never changes CAM or emitted G-code.
  readonly resolution: RemovalGridResolution;
};

export type RemovalGridSpec = {
  readonly originX: number;
  readonly originY: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerCell?: number;
  // When a preview caller has already selected a coarser interactive cell
  // size, retain the original request and the reason instead of hiding it.
  readonly requestedMmPerCell?: number;
  readonly resolutionReason?: RemovalGridResolutionReason;
};

export type RemovalGridResult =
  | {
      readonly kind: 'ok';
      readonly grid: RemovalGrid;
      readonly resolution: RemovalGridResolution;
    }
  | { readonly kind: 'error'; readonly reason: string };

export type RemovalGridCellSizeResult =
  | {
      readonly kind: 'ok';
      readonly mmPerCell: number;
      readonly reason: Extract<
        RemovalGridResolutionReason,
        'minimum-cell-size' | 'removal-grid-cell-budget'
      > | null;
    }
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
  const selected = spec.mmPerCell ?? DEFAULT_CELL_MM;
  const requested = spec.requestedMmPerCell ?? selected;
  const size = coarsenedCellSize(spec.widthMm, spec.heightMm, selected);
  if (size.kind === 'error') return size;
  const { mmPerCell } = size;
  const widthCells = partialCellCount(spec.widthMm, mmPerCell);
  const heightCells = partialCellCount(spec.heightMm, mmPerCell);
  if (
    widthCells === null ||
    heightCells === null ||
    !Number.isSafeInteger(widthCells * heightCells)
  ) {
    return { kind: 'error', reason: 'Removal grid dimensions exceed numeric limits.' };
  }
  const resolution: RemovalGridResolution = {
    requestedMmPerCell: requested,
    effectiveMmPerCell: mmPerCell,
    reason:
      size.reason ??
      (mmPerCell === requested ? null : (spec.resolutionReason ?? 'caller-selected-cell-size')),
  };
  const grid: RemovalGrid = {
    widthCells,
    heightCells,
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
    mmPerCell,
    originX: spec.originX,
    originY: spec.originY,
    depth: new Float32Array(widthCells * heightCells),
    resolution,
  };
  return {
    kind: 'ok',
    grid,
    resolution,
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
    return {
      kind: 'ok',
      mmPerCell: requestedMm,
      reason: requestedMm === requested ? null : 'minimum-cell-size',
    };
  }
  const area = widthMm * heightMm;
  if (!Number.isFinite(area)) {
    return { kind: 'error', reason: 'Removal grid dimensions exceed numeric limits.' };
  }
  const mmPerCell = Math.sqrt(area / MAX_GRID_CELLS);
  return Number.isFinite(mmPerCell) && mmPerCell > 0
    ? { kind: 'ok', mmPerCell, reason: 'removal-grid-cell-budget' }
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
    cx: partialCellIndex(grid, 'x', x - grid.originX) ?? -1,
    cy: partialCellIndex(grid, 'y', y - grid.originY) ?? -1,
  };
}
