// Rest finishing steps down where the finishing bit did not reach (rolling
// audit v12 X6-P2-2; ADR-421 Amendment 3).
//
// ADR-421 Amendment 2 steps the finishing bit down where roughing left stock.
// The same holds one stage on: where the finishing ball cannot enter (a groove
// narrower than it), its rows ride over, and the smaller rest bit then cut the
// whole depth at full width and full feed. Here the emitted finishing moves
// are swept on a grid an eighth of the finishing bit across, as roughing's are
// (relief-roughing-reach.ts), with no allowance (finishing leaves none by
// design), and the rest bit cuts what they missed in levels of its own stage's
// depth per pass before its rest rows.

import type { CncPass, CncPath3dPass } from '../job';
import { finishingStepDown } from '../relief/relief-finishing-step-down';
import { reliefObjectToHeightmap } from '../relief/relief-object-to-heightmap';
import { reliefRoughingReach } from '../relief/relief-roughing-reach';
import { reliefNextToolRadiusMm } from '../relief/relief-next-tool-radius';
import type { CncLayerSettings, CncTool, ReliefObject } from '../scene';
import { cncSettingsForStage } from './cnc-stage-settings';
import { reliefMachineSpaceGeometry } from './relief-machine-space';

const REACH_CELL_TOOL_FRACTION = 8;

export type RestStepDown = {
  readonly passes: ReadonlyArray<CncPath3dPass>;
  readonly levels: number;
  // Area the finishing bit left more than one rest depth per pass above the
  // surface, in mm²; absent when it left none, or when the sweep did not run.
  readonly missedAreaMm2?: number;
  readonly unchecked?: true;
};

/** Step-down levels for the rest rows (relief map frame) over stock finishing missed. */
export function restStepDown(
  relief: ReliefObject,
  finishingPasses: ReadonlyArray<CncPass>,
  restRows: ReadonlyArray<CncPath3dPass>,
  settings: CncLayerSettings,
  tools: { readonly rest: CncTool; readonly finishing: CncTool },
): RestStepDown {
  const space = reliefMachineSpaceGeometry(relief);
  const stepMm = cncSettingsForStage(settings, 'relief-rest-finish', tools.rest).depthPerPassMm;
  // N2-P2-2 (ADR-421 Amendment 4): the band beside a wall is the finishing
  // ball's own fillet, so a rest bit narrower than it rides in it, and the
  // grid follows the smaller bit: one cell of slack on a grid an eighth of the
  // finishing ball hid the 1.9 mm a 1/4" ball left for a 1/16" one.
  const restRadius = reliefNextToolRadiusMm(tools.rest, stepMm);
  const finishingRadius = reliefNextToolRadiusMm(tools.finishing, stepMm);
  const grid = reliefObjectToHeightmap(relief, {
    targetWidthMm: relief.targetWidthMm,
    reliefDepthMm: relief.reliefDepthMm,
    targetScaleX: space.targetScaleX,
    targetScaleY: space.targetScaleY,
    mmPerCell: (2 * Math.min(finishingRadius, restRadius)) / REACH_CELL_TOOL_FRACTION,
    sampling: 'exact-mesh',
  });
  if (grid.kind === 'error') return { passes: [], levels: 0, unchecked: true };
  const reach = reliefRoughingReach(grid.heightmap, finishingPasses, tools.finishing, {
    depthPerPassMm: stepMm,
    allowanceMm: 0,
    minWidthMm: restRadius,
    nextToolRadiusMm: restRadius,
    nextIsSmall: restRadius < finishingRadius,
  });
  if (reach.kind === 'unchecked') return { passes: [], levels: 0, unchecked: true };
  const stepped = finishingStepDown(restRows, reach.reach, tools.rest, stepMm);
  return {
    ...stepped,
    ...(reach.reach.missedCells > 0 ? { missedAreaMm2: reach.reach.missedAreaMm2 } : {}),
  };
}
