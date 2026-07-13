import { firstNumber } from './dxf-entities';
import type { DxfTag } from './dxf-tags';

export const MAX_MINSERT_INSTANCES = 10_000;

export type DxfInsertGrid = {
  readonly columns: number;
  readonly rows: number;
  readonly instanceCount: number;
};

export function dxfInsertGrid(tags: ReadonlyArray<DxfTag>): DxfInsertGrid {
  const columns = Math.max(1, Math.trunc(firstNumber(tags, 70, 1)));
  const rows = Math.max(1, Math.trunc(firstNumber(tags, 71, 1)));
  return { columns, rows, instanceCount: columns * rows };
}

export function isDxfInsertGridWithinBudget(grid: DxfInsertGrid): boolean {
  return Number.isSafeInteger(grid.instanceCount) && grid.instanceCount <= MAX_MINSERT_INSTANCES;
}
