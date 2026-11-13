// Material starting values offered by the layer card's two side doors: the
// "Use <material> values" button after a bit change (CncKeptFeedsNotice) and a
// stage recipe's material starter (CncStageRecipeFields).
//
// Both pass whether the operation's RPM is automatic (ADR-256 Amendment 1):
// an RPM a starter or recipe set, which any hand edit would have cleared with
// the feed source. A 4040 starter seeds 3,000 RPM; treated as hand-set, it held
// a 1/16" aluminium recipe at S3000 F60 where the Material picker gives
// S12000 F250 (CNC audit v3 N7r-P3-2).

import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
} from '../../core/scene';
import { materialFeedsPatch } from '../state/cnc-project-material';

type MachineContext = {
  readonly machine: CncMachineConfig;
  readonly profile: DeviceProfile;
  readonly liveCaps: CncMachineStarterLiveCaps | null;
};

/** The material's values for the layer's current bit, after a bit change kept the old ones. */
export function keptFeedsMaterialPatch(
  input: MachineContext & {
    readonly materialKey: string;
    readonly settings: CncLayerSettings;
  },
): Partial<CncLayerSettings> | null {
  return materialFeedsPatch({
    materialKey: input.materialKey,
    tool: layerCncTool(input.machine, input.settings),
    spindleRpm: input.settings.spindleRpm,
    automaticSpindleRpm: input.settings.feedSource !== undefined,
    profile: input.profile,
    machineParams: input.machine.params,
    liveCaps: input.liveCaps,
  });
}

/**
 * A stage recipe's material starter. The stage's RPM is automatic only while
 * it is the operation's own automatic RPM; a recipe RPM typed separately is
 * hand-set and stays the upper bound.
 */
export function stageMaterialStarterPatch(
  input: MachineContext & {
    readonly materialKey: string;
    readonly settings: CncLayerSettings;
    readonly stageTool: CncTool;
    readonly stageSpindleRpm: number;
  },
): Partial<CncLayerSettings> | null {
  return materialFeedsPatch({
    materialKey: input.materialKey,
    tool: input.stageTool,
    spindleRpm: input.stageSpindleRpm,
    automaticSpindleRpm:
      input.settings.feedSource !== undefined &&
      input.stageSpindleRpm === input.settings.spindleRpm,
    profile: input.profile,
    machineParams: input.machine.params,
    liveCaps: input.liveCaps,
  });
}
