import type { Job } from '../job';
import type { CncTileBounds } from './effective-cnc-tile-grid';

/** One row-major CNC tile and its stock-space clipping rectangle. */
export type CncTile = {
  readonly row: number;
  readonly col: number;
  readonly rect: CncTileBounds;
};

/** One materialized tile paired with its tile-local CNC job. */
export type TiledJob = {
  readonly tile: CncTile;
  readonly job: Job;
};
