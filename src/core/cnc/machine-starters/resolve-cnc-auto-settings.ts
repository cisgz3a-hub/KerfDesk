import type { DeviceProfile } from '../../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
} from '../../scene';
import { cncHeadDevice } from '../cnc-head-feeds';
import {
  calculateFeeds,
  chiploadFor,
  isChiploadMaterialKey,
  type ChiploadMaterial,
} from '../feeds-calculator';
import {
  resolveCncMachineStarter,
  type CncMachineStarterLiveCaps,
} from '../resolve-cnc-machine-starter';
import { minOf } from '../../util';

/** Shared engineering assumption for automatic material-feed calculations. */
export const DEFAULT_ASSUMED_FLUTE_COUNT = 2;

export type CncAutoSettingsInput = {
  readonly profile: DeviceProfile;
  readonly machine: CncMachineConfig;
  readonly baseSettings?: CncLayerSettings;
  readonly liveCaps?: CncMachineStarterLiveCaps;
};

export type CncMaterialFeedInput = {
  // The device as the CNC head sees it (cncHeadDevice): its maxFeed is CNC's.
  readonly profile: DeviceProfile;
  readonly tool: CncTool;
  readonly materialKey: string;
  readonly spindleRpm: number;
  readonly machineSpindleMaxRpm: number;
  readonly fluteCount: number;
  readonly liveCaps?: CncMachineStarterLiveCaps;
  // The machine starter is a recipe for its own cutter (ADR-256: a 3.175 mm
  // two-flute end mill). A caller seeding a different kind of cut, such as
  // spoilboard surfacing with a facing cutter, leaves its ceilings out.
  readonly ignoreMachineStarter?: boolean;
  // The operation's RPM came from a recipe or machine starter, not a hand edit
  // (any hand edit drops the feed source). A starter that lowers RPM to meet its
  // feed cap then plans from the spindle's full speed, so a speed it lowered for
  // one material never holds down the next (ADR-256 Amendment 1).
  readonly automaticSpindleRpm?: boolean;
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
    const tool = layerCncTool(input.machine, base);
    const materialPatch = resolveCncMaterialFeedPatch({
      profile: cncHeadDevice(input.profile, input.machine.params),
      tool,
      materialKey,
      spindleRpm: base.spindleRpm,
      machineSpindleMaxRpm: input.machine.params.spindleMaxRpm,
      fluteCount: tool.fluteCount ?? DEFAULT_ASSUMED_FLUTE_COUNT,
      automaticSpindleRpm: true,
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
    profile: cncHeadDevice(input.profile, input.machine.params),
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
  const starter = input.ignoreMachineStarter === true ? null : materialMachineStarter(input);
  const spindleMinRpm = starter?.spindleMinRpm;
  const rpmCeiling = materialSpindleRpm(input, spindleMinRpm !== undefined);
  if (rpmCeiling === undefined) return null;
  const maxFeedMmPerMin = materialFeedCeiling(input, starter?.feedMmPerMin);
  const spindleRpm = rpmForFeedCeiling({
    material: input.materialKey,
    bitDiameterMm: input.tool.diameterMm,
    fluteCount: input.fluteCount,
    rpmCeiling,
    maxFeedMmPerMin,
    spindleMinRpm,
  });
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

// The fastest RPM the recipe may plan at: the spindle's ceilings, and the
// operation's own RPM unless that RPM is automatic and the starter lowers RPM
// to its feed cap. The starter's seed RPM is not a ceiling (ADR-256 Amd 1).
function materialSpindleRpm(
  input: CncMaterialFeedInput,
  starterLowersRpm: boolean,
): number | undefined {
  const spindleCeiling = lesserPositive([
    input.machineSpindleMaxRpm,
    input.profile.cncSubProfile?.spindleMaxRpm,
    input.liveCaps?.spindleMaxRpm,
  ]);
  if (starterLowersRpm && input.automaticSpindleRpm === true && spindleCeiling !== undefined) {
    return spindleCeiling;
  }
  return lesserPositive([input.spindleRpm, spindleCeiling]);
}

const RPM_STEP = 50;

// ADR-256 Amendment 1 (CNC audit FS-2; maintainer's choice "Keep 300, lower
// RPM"): when the feed ceiling stops the recipe reaching the chart chip load,
// lower the RPM until it does, rounded up to 50 RPM so the chip load never
// exceeds the chart, and never below the spindle's minimum. Only a starter that
// names its spindle's minimum lowers RPM; elsewhere the feed is simply capped.
function rpmForFeedCeiling(input: {
  readonly material: ChiploadMaterial;
  readonly bitDiameterMm: number;
  readonly fluteCount: number;
  readonly rpmCeiling: number;
  readonly maxFeedMmPerMin: number | undefined;
  readonly spindleMinRpm: number | undefined;
}): number {
  const { maxFeedMmPerMin: maxFeed, spindleMinRpm: minRpm, rpmCeiling } = input;
  if (maxFeed === undefined || minRpm === undefined) return rpmCeiling;
  const chiploadMm = chiploadFor(input.material, input.bitDiameterMm);
  const flutes = Math.max(1, Math.round(input.fluteCount));
  if (!(chiploadMm > 0) || !Number.isFinite(flutes)) return rpmCeiling;
  const rpmAtChart = Math.ceil(maxFeed / (flutes * chiploadMm) / RPM_STEP) * RPM_STEP;
  return Math.min(rpmCeiling, Math.max(minRpm, rpmAtChart));
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
  return positive.length === 0 ? undefined : minOf(positive);
}
