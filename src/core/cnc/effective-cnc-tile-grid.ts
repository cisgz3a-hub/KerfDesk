import type { CncTiling } from '../scene';

const MIN_CNC_TILE_STEP_MM = 1;

/** Maximum number of CNC tile jobs that one planning operation may materialize. */
export const MAX_CNC_TILE_PLAN_COUNT = 500;

/** Stock-space bounds covered by a CNC tile grid. */
export type CncTileBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Normalized geometry shared by CNC grid placement, clipping, and registration. */
export type EffectiveCncTiling = {
  readonly tileWidthMm: number;
  readonly tileHeightMm: number;
  readonly stepXMm: number;
  readonly stepYMm: number;
  readonly overlapMm: number;
};

/** Pre-allocation row, column, and total work for a CNC tile grid. */
export type CncTileWork = {
  readonly columns: number;
  readonly rows: number;
  /** Exact total when it is a safe integer; null for astronomically large grids. */
  readonly exactTileCount: number | null;
  readonly budget: number;
};

/** Effective CNC grid facts calculated without allocating tile records. */
export type EffectiveCncTileGrid = {
  readonly geometry: EffectiveCncTiling;
  readonly work: CncTileWork;
  readonly coveredBounds: CncTileBounds;
};

/** Whether the effective CNC grid can be materialized within its work budget. */
export type EffectiveCncTileGridResult =
  | { readonly kind: 'ready'; readonly grid: EffectiveCncTileGrid }
  | { readonly kind: 'work-budget-exceeded'; readonly grid: EffectiveCncTileGrid };

/** Normalize persisted CNC tiling settings into coverage-consistent per-axis geometry. */
export function effectiveCncTiling(tiling: CncTiling): EffectiveCncTiling {
  const requestedOverlapMm = Math.max(0, tiling.overlapMm);
  const smallerTileSideMm = Math.min(tiling.tileWidthMm, tiling.tileHeightMm);
  const minimumStepMm = Math.max(
    Math.min(MIN_CNC_TILE_STEP_MM, smallerTileSideMm),
    Number.EPSILON * smallerTileSideMm,
  );
  const maximumOverlapMm = Math.max(0, smallerTileSideMm - minimumStepMm);
  const overlapMm = Math.min(requestedOverlapMm, maximumOverlapMm);
  return {
    tileWidthMm: tiling.tileWidthMm,
    tileHeightMm: tiling.tileHeightMm,
    stepXMm: tiling.tileWidthMm - overlapMm,
    stepYMm: tiling.tileHeightMm - overlapMm,
    overlapMm,
  };
}

/**
 * Resolve one coverage-correct CNC grid and its work before any tile array is
 * allocated. Persisted settings remain untouched; only the planning geometry
 * receives a positive representable stride, with the ordinary one-millimetre
 * minimum retained for UI-supported tile sizes.
 */
export function effectiveCncTileGrid(
  bounds: CncTileBounds,
  tiling: CncTiling,
): EffectiveCncTileGridResult {
  const geometry = effectiveCncTiling(tiling);
  const columns = tileAxisCount(bounds.minX, bounds.maxX, geometry.tileWidthMm, geometry.stepXMm);
  const rows = tileAxisCount(bounds.minY, bounds.maxY, geometry.tileHeightMm, geometry.stepYMm);
  const isOverBudget = tileWorkIsOverBudget(columns, rows);
  const grid: EffectiveCncTileGrid = {
    geometry,
    work: {
      columns,
      rows,
      exactTileCount: safeTileCount(columns, rows),
      budget: MAX_CNC_TILE_PLAN_COUNT,
    },
    coveredBounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: coveredAxisMax(bounds.minX, bounds.maxX, {
        tileCount: columns,
        stepMm: geometry.stepXMm,
        tileSizeMm: geometry.tileWidthMm,
      }),
      maxY: coveredAxisMax(bounds.minY, bounds.maxY, {
        tileCount: rows,
        stepMm: geometry.stepYMm,
        tileSizeMm: geometry.tileHeightMm,
      }),
    },
  };
  return isOverBudget ? { kind: 'work-budget-exceeded', grid } : { kind: 'ready', grid };
}

function tileAxisCount(
  minimumMm: number,
  requiredMaximumMm: number,
  tileSizeMm: number,
  stepMm: number,
): number {
  const spanMm = requiredMaximumMm - minimumMm;
  const remainingSpanMm = Math.max(0, spanMm - tileSizeMm);
  let tileCount = Math.max(1, Math.ceil(remainingSpanMm / stepMm) + 1);
  if (!Number.isSafeInteger(tileCount)) return tileCount;
  while (tileCount <= MAX_CNC_TILE_PLAN_COUNT + 1) {
    const plannedMaximumMm = plannedAxisMaximum(minimumMm, tileCount, stepMm, tileSizeMm);
    if (!Number.isFinite(plannedMaximumMm)) return Number.POSITIVE_INFINITY;
    if (plannedMaximumMm >= requiredMaximumMm) return tileCount;
    tileCount += 1;
  }
  return Number.POSITIVE_INFINITY;
}

function tileWorkIsOverBudget(columns: number, rows: number): boolean {
  if (!Number.isSafeInteger(columns) || columns < 1) return true;
  if (!Number.isSafeInteger(rows) || rows < 1) return true;
  return columns > MAX_CNC_TILE_PLAN_COUNT || rows > Math.floor(MAX_CNC_TILE_PLAN_COUNT / columns);
}

function safeTileCount(columns: number, rows: number): number | null {
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)) return null;
  if (rows > Math.floor(Number.MAX_SAFE_INTEGER / columns)) return null;
  return columns * rows;
}

function coveredAxisMax(
  minimumMm: number,
  requiredMaximumMm: number,
  axis: {
    readonly tileCount: number;
    readonly stepMm: number;
    readonly tileSizeMm: number;
  },
): number {
  if (!Number.isSafeInteger(axis.tileCount)) return requiredMaximumMm;
  const plannedMaximumMm = plannedAxisMaximum(
    minimumMm,
    axis.tileCount,
    axis.stepMm,
    axis.tileSizeMm,
  );
  return Number.isFinite(plannedMaximumMm) && plannedMaximumMm >= requiredMaximumMm
    ? plannedMaximumMm
    : requiredMaximumMm;
}

function plannedAxisMaximum(
  minimumMm: number,
  tileCount: number,
  stepMm: number,
  tileSizeMm: number,
): number {
  const plannedMinimumMm = minimumMm + (tileCount - 1) * stepMm;
  return plannedMinimumMm + tileSizeMm;
}
