import { jogAxisSignsForOrigin, machineBoundsForDevice, type DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type Polyline,
} from '../scene';
import { coolantFields } from './coolant-fields';
import {
  capFeed,
  capSpindle,
  resolveRetractBetweenPasses,
  sourceRegionMajorDepthPasses,
  type CncGroupCompileOptions,
} from './compile-cnc-helpers';
import { cncGroupProvenance } from './cnc-group-provenance';
import { resolveRestPocketOperation } from './cnc-rest-operation';
import { zPassDepths } from './depth-passes';
import { compileStraightInlayGroupsWithEvidence } from './inlay-pair-operation';
import { applyRampEntry, enforceCutDirection, parkFields } from './motion-polish';
import { machineFrameHandedness } from './machine-frame-handedness';
import { applyProfileLeadPasses } from './profile-lead-passes';
import { vcarveClearancePocket } from './vcarve-clearance';
import { vcarveEffectiveDepthMm } from './vcarve-depth';

export function compiledInlayGroups(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): {
  readonly groups: { readonly female: CncGroup; readonly male: CncGroup } | null;
  readonly femalePocketOffsetFailed: boolean;
  readonly femalePocketPassLimited: boolean;
  readonly stepoverUsed: boolean;
} | null {
  return compileStraightInlayGroupsWithEvidence(
    polylines,
    settings,
    config,
    (groupSettings, tool, passes) =>
      cncGroupForPasses(
        layer,
        groupSettings,
        tool,
        applyProfileLeadPasses(
          passes,
          groupSettings,
          tool.diameterMm,
          machineBoundsForDevice(device),
        ),
        device,
        config,
      ),
    jogAxisSignsForOrigin(device.origin).x,
  );
}

export function secondaryClearingGroups(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CompiledSecondaryClearingGroups {
  const groups: CncGroup[] = [];
  const clearance = compiledVcarveClearanceGroup(layer, settings, polylines, device, config);
  if (clearance.group !== null) groups.push(clearance.group);
  const roughing = restPocketRoughingGroupForLayer(layer, settings, polylines, device, config);
  if (roughing.group !== null) groups.push(roughing.group);
  return {
    groups,
    offsetFailed: clearance.offsetFailed || roughing.offsetFailed,
    passLimited: clearance.passLimited || roughing.passLimited,
    stepoverUsed: clearance.stepoverUsed || roughing.stepoverUsed,
  };
}

export type CncGroupPlanningStatus = {
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
};

export type CompiledSecondaryClearingGroups = CncGroupPlanningStatus & {
  readonly groups: ReadonlyArray<CncGroup>;
};

type CompiledOptionalCncGroup = CncGroupPlanningStatus & { readonly group: CncGroup | null };

const NO_OPTIONAL_GROUP: CompiledOptionalCncGroup = {
  group: null,
  offsetFailed: false,
  passLimited: false,
  stepoverUsed: false,
};

function restPocketRoughingGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CompiledOptionalCncGroup {
  const operation = resolveRestPocketOperation(polylines, settings, config);
  if (operation.kind === 'not-requested') return NO_OPTIONAL_GROUP;
  if (operation.kind === 'error') {
    return {
      group: null,
      offsetFailed: operation.offsetFailed,
      passLimited: operation.passLimited,
      stepoverUsed: operation.stepoverUsed,
    };
  }
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  const roughToolpaths =
    settings.cutDirection === undefined
      ? operation.roughToolpaths
      : enforceCutDirection(
          operation.roughToolpaths,
          settings.cutDirection,
          'pocket',
          machineFrameHandedness(device.origin),
        );
  let passes: ReadonlyArray<CncPass> = sourceRegionMajorDepthPasses(
    polylines,
    roughToolpaths,
    depths,
  );
  if (settings.rampEntryDeg !== undefined) passes = applyRampEntry(passes, settings.rampEntryDeg);
  const primaryTool = layerCncTool(config, settings);
  return {
    group: cncGroupForPasses(layer, settings, operation.roughTool, passes, device, config, {
      layerPrimaryTool: primaryTool,
    }),
    offsetFailed: operation.roughingOffsetFailed,
    passLimited: operation.roughingPassLimited,
    stepoverUsed: operation.stepoverUsed,
  };
}

function cncGroupForPasses(
  layer: Layer,
  settings: CncLayerSettings,
  tool: CncTool,
  passes: ReadonlyArray<CncPass>,
  device: DeviceProfile,
  config: CncMachineConfig,
  options: CncGroupCompileOptions = {},
): CncGroup | null {
  if (passes.length === 0) return null;
  const cutFeed =
    settings.cutType === 'drill'
      ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin)
      : settings.feedMmPerMin;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: settings.cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    ...cncGroupProvenance(settings, tool, options),
    feedMmPerMin: capFeed(cutFeed, device.maxFeed),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    retractBetweenPasses: options.retractBetweenPasses ?? resolveRetractBetweenPasses(settings),
    passes,
  };
}

// The two-stage V-carve's clearing group: pocket an explicitly enabled flat
// floor with the layer's clearing bit before the V-bit medial finish.
export function vcarveClearanceGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  return compiledVcarveClearanceGroup(layer, settings, polylines, device, config).group;
}

function compiledVcarveClearanceGroup(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CompiledOptionalCncGroup {
  if (
    settings.cutType !== 'v-carve' ||
    !(settings.vCarveFlatDepthEnabled ?? true) ||
    settings.vClearToolId === undefined
  ) {
    return NO_OPTIONAL_GROUP;
  }
  const clearTool = config.tools.find((tool) => tool.id === settings.vClearToolId);
  if (clearTool === undefined || clearTool.kind !== 'end-mill') return NO_OPTIONAL_GROUP;
  const vBit = layerCncTool(config, settings);
  const effectiveDepthMm = vcarveEffectiveDepthMm(vBit, settings.depthMm);
  if (effectiveDepthMm === null) return NO_OPTIONAL_GROUP;
  const clearance = vcarveClearancePocket(polylines, {
    vBit,
    clearTool,
    maxDepthMm: effectiveDepthMm,
    stepoverPercent: settings.stepoverPercent,
  });
  const depths = zPassDepths(effectiveDepthMm, settings.depthPerPassMm);
  if (clearance.toolpaths.length === 0 || depths.length === 0) {
    return {
      group: null,
      offsetFailed: clearance.offsetFailed,
      passLimited: clearance.passLimited,
      stepoverUsed: clearance.stepoverUsed,
    };
  }
  const clearingSettings: CncLayerSettings = { ...settings, cutType: 'pocket' };
  return {
    group: cncGroupForPasses(
      layer,
      clearingSettings,
      clearTool,
      sourceRegionMajorDepthPasses(polylines, clearance.toolpaths, depths),
      device,
      config,
      { layerPrimaryTool: vBit, includeRampEntry: false, retractBetweenPasses: false },
    ),
    offsetFailed: clearance.offsetFailed,
    passLimited: clearance.passLimited,
    stepoverUsed: clearance.stepoverUsed,
  };
}
