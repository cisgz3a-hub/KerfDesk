import type { tileJobs } from '../../core/cnc';
import { formatDisplayMillimetres } from '../format-display-millimetres';

const TILE_COUNT_LOCALE = 'en-US';

type OverBudgetTileGrid = Extract<
  ReturnType<typeof tileJobs>,
  { readonly kind: 'work-budget-exceeded' }
>['grid'];

/** Explain why a tiled Save cannot materialize its complete planned grid. */
export function tiledSaveWorkBudgetMessage(grid: OverBudgetTileGrid): string {
  const count =
    grid.work.exactTileCount === null
      ? `more than ${grid.work.budget.toLocaleString(TILE_COUNT_LOCALE)}`
      : grid.work.exactTileCount.toLocaleString(TILE_COUNT_LOCALE);
  return (
    `Cannot export tiles:\n\nThis job would require ${count} planned grid cells using an effective ` +
    `overlap of ${formatDisplayMillimetres(grid.geometry.overlapMm)} mm (X step ` +
    `${formatDisplayMillimetres(grid.geometry.stepXMm)} mm, Y step ` +
    `${formatDisplayMillimetres(grid.geometry.stepYMm)} mm), which exceeds the ` +
    `${grid.work.budget.toLocaleString(TILE_COUNT_LOCALE)}-cell work limit. ` +
    'Increase tile width or height, or reduce overlap, then try again.\n\nNo files were written.'
  );
}
