import type { EffectiveCncTileGrid, EffectiveCncTileGridResult } from './effective-cnc-tile-grid';
import type { CncTile, TiledJob } from './cnc-tile';

/** Pre-allocation CNC tile planning result. */
export type TilePlanResult =
  | {
      readonly kind: 'ready';
      readonly grid: EffectiveCncTileGrid;
      readonly tiles: ReadonlyArray<CncTile>;
    }
  | Extract<EffectiveCncTileGridResult, { readonly kind: 'work-budget-exceeded' }>;

/** CNC job tiling result, including empty and pre-allocation budget outcomes. */
export type TiledJobsResult =
  | {
      readonly kind: 'ready';
      readonly grid: EffectiveCncTileGrid;
      readonly tiles: ReadonlyArray<TiledJob>;
      readonly advisories?: ReadonlyArray<string>;
    }
  | { readonly kind: 'empty' }
  | Extract<EffectiveCncTileGridResult, { readonly kind: 'work-budget-exceeded' }>;
