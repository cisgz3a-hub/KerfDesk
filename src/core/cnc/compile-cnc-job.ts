// compileCncJob — Scene + DeviceProfile + CncMachineConfig → Job of CncGroups.
//
// Materialize layer geometry in machine coordinates and order passes safely:
//
//   1. Pockets and engraves first — they never free the part.
//   2. Profiles last, inner contours before outer, so a part is machined
//      completely before the cut that could let it move.
//
// Pure and deterministic: no clock, random input, or I/O.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import { artworkOperationRuns } from '../artwork-order';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncGroup, CncPass, Job } from '../job';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
import type { ReliefMaterializationFailure } from '../relief/relief-materialization-failure';
import { coolantFields } from './coolant-fields';
import {
  capFeed,
  capSpindle,
  isProfileCutType,
  resolveRetractBetweenPasses,
  type CncGroupCompileOptions,
} from './compile-cnc-helpers';
import { compileReliefGroupsForLayer } from './compile-cnc-relief';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';
import { collectLayerContours, layerPolylinesFromContours } from './collect-cnc-contours';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import { cncGroupProvenance } from './cnc-group-provenance';
import {
  prepareCncCompilationArtifact,
  resolveCncCompilationArtifact,
  runCncCompilationTask,
  type CncCompilationEvidence,
  type CncCompilationIdentity,
  type CncCompilationRejectionReason,
  type CncCompilationTaskResult,
  type PreparedCncCompilationArtifact,
} from './cnc-compilation-artifact';
import type { VCarveLadder } from './vcarve-ladder';
import { passesForCncLayerWithEvidence } from './compile-cnc-layer-passes';
import { machineFrameHandedness } from './machine-frame-handedness';
import { parkFields } from './motion-polish';
import { applyProfileLeadPasses } from './profile-lead-passes';
import {
  boundVCarveLadder,
  buildCncCompilationSidecar,
  hasVCarveOperation,
  offsetDiagnosticsForStatus,
  reliefOffsetDiagnosticsForStatus,
} from './cnc-compilation-sidecar';
import { compiledInlayGroups, secondaryClearingGroups } from './compile-cnc-operation-groups';

export { xyToolpathsForCutType } from './compile-cnc-layer-passes';
export { vcarveClearanceGroupForLayer } from './compile-cnc-operation-groups';

/** Pure CNC compilation result used by output preparation and worker finalization. */
export type CncJobCompilationResult =
  | { readonly kind: 'compiled'; readonly job: Job }
  | ReliefMaterializationFailure;

/** Compile CNC geometry while returning expected relief-source failures as data. */
export function compileCncJobResult(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncJobCompilationResult {
  if (!hasVCarveOperation(scene)) return compileCncSnapshot(scene, device, config, []);
  const identity = { jobId: 'synchronous', compilationId: 'synchronous' };
  const artifact = prepareCncCompilationArtifact(identity, scene, device, config);
  const results = artifact.tasks.map(
    (task): CncCompilationTaskResult => ({
      jobId: identity.compilationId,
      taskId: task.taskId,
      result: runCncCompilationTask(task.payload),
    }),
  );
  const finalized = finalizeCncCompilationArtifact(artifact, results);
  if (finalized.kind === 'rejected') {
    throw new Error(`Synchronous CNC compilation rejected: ${finalized.reason}`);
  }
  return finalized;
}

/**
 * Compatibility entry for already-validated core callers. Output preparation
 * uses compileCncJobResult so a malformed stored relief never uses exceptions
 * for expected compile-integrity control flow.
 */
export function compileCncJob(scene: Scene, device: DeviceProfile, config: CncMachineConfig): Job {
  const result = compileCncJobResult(scene, device, config);
  if (result.kind === 'compiled') return result.job;
  throw new Error(`Relief "${result.source}" could not be materialized: ${result.reason}`);
}

export type FinalizedCncCompilation =
  | { readonly kind: 'rejected'; readonly reason: CncCompilationRejectionReason }
  | ReliefMaterializationFailure
  | {
      readonly kind: 'compiled';
      readonly job: Job;
      readonly evidence: CncCompilationEvidence;
    };

export function finalizeCncCompilationArtifact(
  artifact: PreparedCncCompilationArtifact,
  results: ReadonlyArray<CncCompilationTaskResult>,
): FinalizedCncCompilation {
  const resolved = resolveCncCompilationArtifact(artifact, results);
  if (resolved.kind === 'rejected') return resolved;
  const compiled = compileCncSnapshot(
    resolved.scene,
    resolved.device,
    resolved.config,
    resolved.evidence.vcarveLayers,
  );
  return compiled.kind === 'compiled' ? { ...compiled, evidence: resolved.evidence } : compiled;
}

export function prepareBoundCncCompilation(
  identity: CncCompilationIdentity,
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): PreparedCncCompilationArtifact {
  return prepareCncCompilationArtifact(identity, scene, device, config);
}

function compileCncSnapshot(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
  vcarveLayers: CncCompilationEvidence['vcarveLayers'],
): CncJobCompilationResult {
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  const stepoverOperations: CncStepoverCompilationEvidence[] = [];
  const offsetLadderDiagnostics: CncOffsetLadderCompilationEvidence[] = [];
  const reliefPlans: CncReliefPlanningEvidence[] = [];
  const sourceObjects = scene.objects;
  for (const [operationIndex, run] of artworkOperationRuns(scene).entries()) {
    const operation = compileCncOperation(
      sourceObjects,
      run,
      operationIndex,
      device,
      config,
      vcarveLayers,
    );
    if (operation.kind === 'relief-materialization-failed') return operation;
    clearingGroups.push(...operation.clearingGroups);
    profileGroups.push(...operation.profileGroups);
    reliefPlans.push(...operation.reliefPlans);
    offsetLadderDiagnostics.push(...operation.offsetLadderDiagnostics);
    if (operation.stepoverOperation !== undefined) {
      stepoverOperations.push(operation.stepoverOperation);
    }
  }
  // H.7 multi-tool: contiguous per-bit sections (one change per bit),
  // profile-carrying sections last so freed parts are never re-machined.
  const groups = orderGroupsIntoToolSections([...clearingGroups, ...profileGroups]);
  const cncCompilation = buildCncCompilationSidecar(
    vcarveLayers,
    stepoverOperations,
    reliefPlans,
    offsetLadderDiagnostics,
  );
  return {
    kind: 'compiled',
    job: { groups, cncCompilation },
  };
}

type CompiledCncOperation = {
  readonly kind: 'compiled';
  readonly layerId: string;
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly reliefPlans: ReadonlyArray<CncReliefPlanningEvidence>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverOperation?: CncStepoverCompilationEvidence;
};

function compileCncOperation(
  sourceObjects: Scene['objects'],
  run: { readonly layer: Layer; readonly priorityObjectId: string },
  operationIndex: number,
  device: DeviceProfile,
  config: CncMachineConfig,
  vcarveLayers: CncCompilationEvidence['vcarveLayers'],
): CompiledCncOperation | ReliefMaterializationFailure {
  const { layer, priorityObjectId } = run;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const relief = compileReliefGroupsForLayer(sourceObjects, layer, settings, device, config);
  if (relief.kind === 'relief-materialization-failed') return relief;
  const contours = collectLayerContours(sourceObjects, layer, device);
  const polylines = layerPolylinesFromContours(layer, contours);
  const vectorGroups = compileVectorOperationGroups(
    layer,
    settings,
    polylines,
    contours,
    priorityObjectId,
    operationIndex,
    device,
    config,
    vcarveLayers,
  );
  const usesStepover = relief.evidence.stepoverUsed || vectorGroups.stepoverUsed;
  return {
    kind: 'compiled',
    layerId: layer.id,
    clearingGroups: [
      ...relief.groups.map((group) => tagArtworkGroup(group, priorityObjectId)),
      ...vectorGroups.clearingGroups,
    ],
    profileGroups: vectorGroups.profileGroups,
    reliefPlans: relief.evidence.plans,
    offsetLadderDiagnostics: [
      ...vectorGroups.offsetLadderDiagnostics,
      ...reliefOffsetDiagnosticsForStatus(layer.id, {
        offsetFailed: relief.evidence.offsetFailed,
        passLimited: relief.evidence.passLimited,
      }),
    ],
    ...(usesStepover
      ? { stepoverOperation: { layerId: layer.id, stepoverPercent: settings.stepoverPercent } }
      : {}),
  };
}

type CncOperationGroups = {
  readonly clearingGroups: ReadonlyArray<CncGroup>;
  readonly profileGroups: ReadonlyArray<CncGroup>;
  readonly offsetLadderDiagnostics: ReadonlyArray<CncOffsetLadderCompilationEvidence>;
  readonly stepoverUsed: boolean;
};

function compileVectorOperationGroups(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  contours: ReadonlyArray<CollectedCncContour>,
  priorityObjectId: string,
  operationIndex: number,
  device: DeviceProfile,
  config: CncMachineConfig,
  vcarveLayers: CncCompilationEvidence['vcarveLayers'],
): CncOperationGroups {
  if (polylines.length === 0) {
    return {
      clearingGroups: [],
      profileGroups: [],
      offsetLadderDiagnostics: [],
      stepoverUsed: false,
    };
  }
  const inlay = compiledInlayGroups(layer, settings, polylines, device, config);
  if (inlay !== null) {
    const groups = inlay.groups;
    return {
      clearingGroups: groups === null ? [] : [tagArtworkGroup(groups.female, priorityObjectId)],
      profileGroups: groups === null ? [] : [tagArtworkGroup(groups.male, priorityObjectId)],
      offsetLadderDiagnostics: offsetDiagnosticsForStatus(layer.id, {
        offsetFailed: inlay.femalePocketOffsetFailed,
        passLimited: inlay.femalePocketPassLimited,
      }),
      stepoverUsed: inlay.stepoverUsed,
    };
  }
  const secondary = secondaryClearingGroups(layer, settings, polylines, device, config);
  const clearingGroups = secondary.groups.map((group) => tagArtworkGroup(group, priorityObjectId));
  const compiledGroup = cncGroupForLayerResolvedWithEvidence(
    layer,
    settings,
    polylines,
    device,
    config,
    contours,
    boundVCarveLadder(
      vcarveLayers,
      operationIndex,
      layer.id,
      priorityObjectId,
      settings.cutType === 'v-carve',
    ),
  );
  const offsetLadderDiagnostics = offsetDiagnosticsForStatus(layer.id, {
    offsetFailed: secondary.offsetFailed || compiledGroup.offsetFailed,
    passLimited: secondary.passLimited || compiledGroup.passLimited,
  });
  if (compiledGroup.group === null) {
    return {
      clearingGroups,
      profileGroups: [],
      offsetLadderDiagnostics,
      stepoverUsed: secondary.stepoverUsed || compiledGroup.stepoverUsed,
    };
  }
  const tagged = tagArtworkGroup(compiledGroup.group, priorityObjectId);
  return isProfileCutType(settings.cutType)
    ? {
        clearingGroups,
        profileGroups: [tagged],
        offsetLadderDiagnostics,
        stepoverUsed: secondary.stepoverUsed || compiledGroup.stepoverUsed,
      }
    : {
        clearingGroups: [...clearingGroups, tagged],
        profileGroups: [],
        offsetLadderDiagnostics,
        stepoverUsed: secondary.stepoverUsed || compiledGroup.stepoverUsed,
      };
}

function tagArtworkGroup(group: CncGroup, sourceObjectId: string): CncGroup {
  return { ...group, sourceObjectId };
}

export { collectLayerPolylines } from './collect-cnc-contours';

export function cncGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
  sourceContours?: ReadonlyArray<CollectedCncContour>,
): CncGroup | null {
  return cncGroupForLayerResolvedWithEvidence(
    layer,
    settings,
    polylines,
    device,
    config,
    sourceContours,
  ).group;
}

type CompiledLayerGroup = {
  readonly group: CncGroup | null;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly stepoverUsed: boolean;
};

function cncGroupForLayerResolvedWithEvidence(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
  sourceContours?: ReadonlyArray<CollectedCncContour>,
  vcarveLadder?: VCarveLadder,
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
  const led = applyProfileLeadPasses(
    result.passes,
    settings,
    tool.diameterMm,
    machineBoundsForDevice(device),
  );
  return {
    group: cncGroupForPasses(layer, settings, tool, led, device, config),
    offsetFailed: result.offsetFailed,
    passLimited: result.passLimited,
    stepoverUsed: result.stepoverUsed,
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
