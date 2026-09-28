// How the carved stock compares with the design (ADR-487), over the cells the
// design covers: how many the carving leaves material above, how many are
// within the tolerance, and how many it cuts below, with the most left and
// the deepest gouge. The view colours the same cells the same way
// (scene-stock-compare.ts).

import { NO_DESIGN } from './stock-design-target';

export type StockComparison = {
  /** Cells the design covers. */
  readonly cells: number;
  readonly leftover: number;
  readonly within: number;
  readonly gouged: number;
  /** The most material left above the design, in mm; 0 when none. */
  readonly mostLeftMm: number;
  /** The deepest cut below the design, in mm; 0 when none. */
  readonly deepestGougeMm: number;
};

export function compareWithDesign(
  depth: Float32Array,
  target: Float32Array,
  toleranceMm: number,
): StockComparison {
  let cells = 0;
  let leftover = 0;
  let gouged = 0;
  let mostLeftMm = 0;
  let deepestGougeMm = 0;
  for (let index = 0; index < target.length; index += 1) {
    const want = target[index] ?? NO_DESIGN;
    if (want > 0) continue;
    cells += 1;
    const off = (depth[index] ?? 0) - want;
    if (off > toleranceMm) {
      leftover += 1;
      mostLeftMm = Math.max(mostLeftMm, off);
    } else if (off < -toleranceMm) {
      gouged += 1;
      deepestGougeMm = Math.max(deepestGougeMm, -off);
    }
  }
  return {
    cells,
    leftover,
    within: cells - leftover - gouged,
    gouged,
    mostLeftMm,
    deepestGougeMm,
  };
}
