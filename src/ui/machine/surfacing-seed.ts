import { cncMaxFeedMmPerMin } from '../../core/cnc/cnc-head-feeds';
import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import { surfacingStarterValues, type SurfacingStarterValues } from '../../core/cnc/surfacing';
import {
  activeCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Project,
} from '../../core/scene';
import { materialFeedsPatch } from '../state/cnc-project-material';

export type SurfacingSeed = {
  readonly tool: CncTool;
  // The material calculator's values for the active cutter; null without a
  // stock material.
  readonly starter: Partial<CncLayerSettings> | null;
  readonly maxFeed: number;
  readonly seed: SurfacingStarterValues;
};

// Starting values for the Surfacing panel. The machine starter is left out: it
// is a recipe for its own 3.175 mm cutter (ADR-256), and on the 4040 its
// 300 mm/min seeded a 25.4 mm facing pass at 0.0125 mm per tooth. The
// conservative surfacing ceilings still apply (ADR-457 Amd 1).
export function surfacingSeed(
  machine: CncMachineConfig,
  project: Pick<Project, 'device'>,
  liveCaps: CncMachineStarterLiveCaps | null,
): SurfacingSeed {
  const tool = activeCncTool(machine);
  const starter =
    machine.stock.materialKey === undefined
      ? null
      : materialFeedsPatch({
          materialKey: machine.stock.materialKey,
          tool,
          spindleRpm: machine.params.spindleMaxRpm,
          profile: project.device,
          machineParams: machine.params,
          liveCaps,
          ignoreMachineStarter: true,
        });
  const maxFeed = cncMaxFeedMmPerMin(project.device, machine.params);
  return { tool, starter, maxFeed, seed: surfacingStarterValues(starter, maxFeed) };
}
