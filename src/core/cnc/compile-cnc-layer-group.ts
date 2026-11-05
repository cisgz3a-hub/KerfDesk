// One CNC layer's passes compiled into groups: the depth ladder, ADR-250
// profile leads (kept clear of every part the job keeps, Amendment 3), and
// the profile finishing stage split. compile-cnc-job.ts owns the operation
// loop and the job-wide lead walls; this module owns one layer.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import type { CncGroup } from '../job';
import type { CncStrategyFallback } from '../job/cnc-compilation-sidecar-types';
import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Polyline,
} from '../scene';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import { cncSettingsForStage } from './cnc-stage-settings';
import { passesForCncLayerWithEvidence } from './compile-cnc-layer-passes';
import { cncGroupForPasses } from './compile-cnc-pass-group';
import { machineFrameHandedness } from './machine-frame-handedness';
import { preserveProfileFinishStages, profileStageRuns } from './profile-finishing-stage';
import { profileLeadKeptMaterial, type ProfileLeadKeptWall } from './profile-lead-kept-walls';
import { applyProfileLeadPasses } from './profile-lead-passes';
import type { VCarveLadder } from './vcarve-plan';

export type CompiledLayerGroup = {
  readonly group: CncGroup | null;
  readonly groups: ReadonlyArray<CncGroup>;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
  readonly strategyFallback?: Omit<CncStrategyFallback, 'layerId'>;
};

export function cncGroupForLayerResolvedWithEvidence(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
  sourceContours?: ReadonlyArray<CollectedCncContour>,
  vcarveLadder?: VCarveLadder,
  leadWalls: ReadonlyArray<ProfileLeadKeptWall> = [],
): CompiledLayerGroup {
  const tool = layerCncTool(config, settings);
  // Cut direction is a physical rule applied to machine numbers, and
  // front-right / rear-left mirror the frame — see machine-frame-handedness.
  const handedness = machineFrameHandedness(device.origin);
  const result = passesForCncLayerWithEvidence(
    polylines,
    settings,
    tool,
    config,
    handedness,
    sourceContours,
    vcarveLadder,
  );
  // ADR-250: bake profile lead-in/out into closed profile passes (default-on
  // for profile-outside/inside; a no-op for other cut types and shape 'none').
  // Amendment 3: a lead keeps its cutter out of every kept part in the job.
  const led = preserveProfileFinishStages(
    result.passes,
    applyProfileLeadPasses(
      result.passes,
      settings,
      tool.diameterMm,
      machineBoundsForDevice(device),
      profileLeadKeptMaterial(leadWalls, tool, settings),
    ),
  );
  const includeRampEntry = recordsRampEntry(settings, result.rampedEntry);
  const options = {
    includeRampEntry,
    ...(result.restStock === undefined ? {} : { restStock: result.restStock }),
  };
  const groups = profileStageRuns(led).flatMap((run) => {
    const stageSettings = run.finishing
      ? cncSettingsForStage(settings, 'profile-finish', tool)
      : settings;
    const group = cncGroupForPasses(
      layer,
      stageSettings,
      tool,
      run.passes,
      device,
      config,
      run.finishing ? { ...options, cuttingStage: 'profile-finish' } : options,
    );
    return group === null ? [] : [group];
  });
  return {
    group: cncGroupForPasses(layer, settings, tool, led, device, config, options),
    groups,
    offsetFailed: result.offsetFailed,
    passLimited: result.passLimited,
    stepoverUsed: result.stepoverUsed,
    ...(result.strategyFallback === undefined ? {} : { strategyFallback: result.strategyFallback }),
  };
}

// A group records the layer's ramp angle only when its passes ramp (ADR-273
// Amendment 2), so adaptive, drill and helical pocket groups record none. A
// V-carve keeps its own requested entry: its header says whether the planner
// ramped or the medial depth profile governs (ADR-285 item 6).
function recordsRampEntry(settings: CncLayerSettings, rampedEntry: boolean): boolean {
  return settings.cutType === 'v-carve' || rampedEntry;
}
