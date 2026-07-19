import type { DeviceProfile } from '../../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
} from '../../scene';
import { calculateFeeds, isChiploadMaterialKey } from '../feeds-calculator';
import {
  resolveCncMachineStarter,
  type CncMachineStarterLiveCaps,
} from '../resolve-cnc-machine-starter';

export type CncAutoSettingsInput = {
  readonly profile: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly baseSettings?: CncLayerSettings;
  readonly liveCaps?: CncMachineStarterLiveCaps;
};

export type CncMaterialFeedInput = {
  readonly profile: DeviceProfile;
  readonly tool: CncTool;
  readonly materialKey: string;
  readonly spindleRpm: number;
  readonly machineSpindleMaxRpm: number;
  readonly fluteCount: number;
  readonly liveCaps?: CncMachineStarterLiveCaps;
};

export type CncStarterFeedInput = {
  readonly profile: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly liveCaps?: CncMachineStarterLiveCaps;
};

// Resolves settings only for a caller-proven fresh CNC operation. Loaded and
// manual layers must never be passed here merely because their CNC block is absent.
export function resolveCncAutoLayerSettings(input: CncAutoSettingsInput): CncLayerSettings | null {
  const base = input.baseSettings ?? DEFAULT_CNC_LAYER_SETTINGS;
  const materialKey = input.machine.stock.materialKey;
  if (materialKey !== undefined) {
    const materialPatch = resolveCncMaterialFeedPatch({
      profile: input.profile,
      tool: layerCncTool(input.machine, base),
      materialKey,
      spindleRpm: base.spindleRpm,
      machineSpindleMaxRpm: input.machine.params.spindleMaxRpm,
      fluteCount: 2,
      ...(input.liveCaps === undefined ? {} : { liveCaps: input.liveCaps }),
    });
    return materialPatch === null ? null : { ...base, ...materialPatch };
  }
  const starterPatch = resolveCncStarterFeedPatch(input);
  return starterPatch === null ? null : { ...base, ...starterPatch };
}

export function resolveCncStarterFeedPatch(
  input: CncStarterFeedInput,
): Partial<CncLayerSettings> | null {
  const starter = resolveCncMachineStarter({
    profile: input.profile,
    machineSpindleMaxRpm: input.machine.params.spindleMaxRpm,
    ...(input.liveCaps === undefined ? {} : { liveCaps: input.liveCaps }),
  });
  if (starter === null) return null;
  const starterTool = input.machine.tools.find((tool) => tool.id === starter.tool.toolId);
  if (starterTool?.kind !== 'end-mill' || starterTool.diameterMm !== starter.tool.diameterMm) {
    return null;
  }
  return {
    toolId: starter.tool.toolId,
    feedMmPerMin: starter.feedMmPerMin,
    plungeMmPerMin: starter.plungeMmPerMin,
    spindleRpm: starter.spindleRpm,
    depthPerPassMm: starter.depthPerPassMm,
    feedSource: {
      kind: 'machine-starter',
      starterId: starter.provenance.starterId,
      revision: starter.provenance.starterRevision,
    },
  };
}

export function resolveCncMaterialFeedPatch(
  input: CncMaterialFeedInput,
): Partial<CncLayerSettings> | null {
  if (!isChiploadMaterialKey(input.materialKey)) return null;
  const starter = materialMachineStarter(input);
  const spindleRpm = materialSpindleRpm(input, starter?.spindleRpm);
  if (spindleRpm === undefined) return null;
  const maxFeedMmPerMin = materialFeedCeiling(input, starter?.feedMmPerMin);
  const feeds = calculateFeeds({
    material: input.materialKey,
    bitDiameterMm: input.tool.diameterMm,
    flutes: input.fluteCount,
    rpm: spindleRpm,
    ...(maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin }),
  });
  if (feeds.kind === 'error') return null;
  return {
    materialKey: input.materialKey,
    feedMmPerMin: feeds.feedMmPerMin,
    plungeMmPerMin: materialPlungeRate(input, feeds.plungeMmPerMin, starter?.plungeMmPerMin),
    spindleRpm,
    depthPerPassMm: limitedDepthPerPass(feeds.depthPerPassMm, starter?.depthPerPassMm),
    feedSource: {
      kind: 'material-recipe',
      materialKey: input.materialKey,
      fluteCount: input.fluteCount,
    },
  };
}

function materialMachineStarter(input: CncMaterialFeedInput) {
  return resolveCncMachineStarter(
    input.liveCaps === undefined
      ? { profile: input.profile, machineSpindleMaxRpm: input.machineSpindleMaxRpm }
      : {
          profile: input.profile,
          machineSpindleMaxRpm: input.machineSpindleMaxRpm,
          liveCaps: input.liveCaps,
        },
  );
}

function materialSpindleRpm(
  input: CncMaterialFeedInput,
  starterSpindleRpm: number | undefined,
): number | undefined {
  return lesserPositive([
    input.spindleRpm,
    input.machineSpindleMaxRpm,
    input.profile.cncSubProfile?.spindleMaxRpm,
    input.liveCaps?.spindleMaxRpm,
    starterSpindleRpm,
  ]);
}

function materialFeedCeiling(
  input: CncMaterialFeedInput,
  starterFeedMmPerMin: number | undefined,
): number | undefined {
  return lesserPositive([
    input.profile.maxFeed,
    slowerXyLimit(input.liveCaps),
    starterFeedMmPerMin,
  ]);
}

function materialPlungeRate(
  input: CncMaterialFeedInput,
  calculatedPlungeMmPerMin: number,
  starterPlungeMmPerMin: number | undefined,
): number {
  return (
    lesserPositive([
      calculatedPlungeMmPerMin,
      input.liveCaps?.zMaxFeedMmPerMin,
      starterPlungeMmPerMin,
    ]) ?? calculatedPlungeMmPerMin
  );
}

function limitedDepthPerPass(calculated: number, starter: number | undefined): number {
  return starter === undefined ? calculated : Math.min(calculated, starter);
}

function slowerXyLimit(liveCaps: CncMachineStarterLiveCaps | undefined): number | undefined {
  return lesserPositive([liveCaps?.xMaxFeedMmPerMin, liveCaps?.yMaxFeedMmPerMin]);
}

function lesserPositive(values: ReadonlyArray<number | undefined>): number | undefined {
  const positive = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value) && value > 0,
  );
  return positive.length === 0 ? undefined : Math.min(...positive);
}
