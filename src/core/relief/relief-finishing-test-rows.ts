// Test helper: the serpentine rows of a finishing plan, whether they arrive as
// separate passes or linked into one stay-down path along their edge column
// (ADR-421). A row is a maximal run of X moves at one Y.
import type { CncPass } from '../job';

export type FinishingRowPoint = { readonly x: number; readonly y: number; readonly z: number };

export type FinishingRow = {
  readonly y: number;
  readonly points: ReadonlyArray<FinishingRowPoint>;
};

export function finishingRows(passes: ReadonlyArray<CncPass>): ReadonlyArray<FinishingRow> {
  const rows: FinishingRow[] = [];
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    let current: FinishingRowPoint[] | null = null;
    for (let index = 1; index < pass.points.length; index += 1) {
      const from = pass.points[index - 1];
      const to = pass.points[index];
      if (from === undefined || to === undefined || from.y !== to.y || from.x === to.x) {
        current = null;
        continue;
      }
      if (current === null) {
        current = [from];
        rows.push({ y: from.y, points: current });
      }
      current.push(to);
    }
  }
  return rows;
}

export function rowDirection(row: FinishingRow | undefined): number {
  const first = row?.points[0];
  const last = row?.points.at(-1);
  if (first === undefined || last === undefined) throw new Error('finishing row expected');
  return Math.sign(last.x - first.x);
}
