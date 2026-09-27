import { zPassCount } from '../cnc/depth-passes';
import type { ReliefFlatLevel } from './relief-flat-finish';
import type { ReliefRoughingLevel } from './relief-roughing-levels';
import { assertReliefLevelArrayLength } from './relief-roughing-level-materialization';

export type FlatFinishingStepPlan = {
  readonly flat: ReliefFlatLevel;
  readonly sliceTopMm: number;
  readonly count: number;
};

/** Count every extra flat slice before materializing any of them. A full
 * roughing level only establishes cleared stock if it reached the flat's
 * allowance-bearing tip region, not merely a height above the final flat. */
export function flatFinishingStepPlans(
  flats: ReadonlyArray<ReliefFlatLevel>,
  levels: ReadonlyArray<ReliefRoughingLevel>,
  roughingTip: Float32Array,
  depthPerPassMm: number,
): ReadonlyArray<FlatFinishingStepPlan> {
  let count = levels.length;
  return flats.map((flat) => {
    let highestTip = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < flat.mask.length; index += 1) {
      if (flat.mask[index] === 1) highestTip = Math.max(highestTip, roughingTip[index] ?? 0);
    }
    const sliceTopMm = levels.reduce(
      (top, level) =>
        level.bandFloorMm === null && level.zMm >= highestTip ? Math.min(top, level.zMm) : top,
      0,
    );
    const steps = zPassCount(sliceTopMm - flat.zMm, depthPerPassMm);
    count += steps;
    assertReliefLevelArrayLength(count);
    return { flat, sliceTopMm, count: steps };
  });
}
