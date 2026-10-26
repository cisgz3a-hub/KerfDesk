import { compileCncProjectedOperation } from './compile-cnc-projected-operation';
import { tagArtworkGroup, type CompiledCncOperation } from './compile-cnc-operation-result';
import type { CncOperationGroups } from './compile-cnc-operation-result';
// compileCncJob — Scene + DeviceProfile + CncMachineConfig → Job of CncGroups.
//
// Materialize layer geometry in machine coordinates and order passes safely:
//
//   1. Pockets and engraves first — they never free the part.
//   2. Profiles last, inner contours before outer, so a part is machined
//      completely before the cut that could let it move.
//
// Pure and deterministic: no clock, random input, or I/O.

import type { DeviceProfile } from '../devices';
import { artworkOperationRuns } from '../artwork-order';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncGroup, Job } from '../job';
// Deep type import: core/job's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  CncOffsetLadderCompilationEvidence,
  CncReliefPlanningEvidence,
  CncStepoverCompilationEvidence,
} from '../job/job';
import type {
  CncOpenContourOmission,
  CncOpenContourOmissionSource,
  CncProfileOpenPaths,
  CncStackedCopyMerge,
} from '../job/cnc-compilation-sidecar-types';
import { cncOpenContourOmissions } from './cnc-open-contour-omissions';
import { cncProfileOpenPaths } from './cnc-profile-outline-join';
import {
  cncKeptPartCuts,
  keptPartCutOperation,
  type KeptPartCutOperation,
} from './cnc-kept-part-cuts';
import { cncStackedCopyMerges } from './cnc-stacked-copies';
import type { ReliefMaterializationFailure } from '../relief/relief-materialization-failure';
import { isProfileCutType } from './compile-cnc-helpers';
import { compileReliefGroupsForLayer } from './compile-cnc-relief';
import { cncHeadDevice } from './cnc-head-feeds';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';
import { collectLayerContours, layerPolylinesFromContours } from './collect-cnc-contours';
import type { CollectedCncContour } from './cnc-manual-tab-mapping';
import {
  prepareCncCompilationArtifact,
  resolveCncCompilationArtifact,
  runCncCompilationTask,
  type CncCompilationEvidence,
  type CncOperationSourceGeometry,
  type CncCompilationRejectionReason,
  type CncCompilationTaskResult,
  type PreparedCncCompilationArtifact,
} from './cnc-compilation-artifact';
import { profileLeadJobWalls } from './profile-lead-job-walls';
import { profileLeadCutWidthMm, type ProfileLeadKeptWall } from './profile-lead-kept-walls';
import { cncGroupForLayerResolvedWithEvidence } from './compile-cnc-layer-group';
import {
  boundVCarveLadder,
  buildCncCompilationSidecar,
  hasVCarveOperation,
  offsetDiagnosticsForStatus,
  reliefOffsetDiagnosticsForStatus,
} from './cnc-compilation-sidecar';
import { compiledInlayGroups, secondaryClearingGroups } from './compile-cnc-operation-groups';
import { restAwareVCarveGroup } from './vcarve-rest-finishing';

export { xyToolpathsForCutType } from './compile-cnc-layer-passes';
export { vcarveClearanceGroupForLayer } from './compile-cnc-operation-groups';
export { prepareCncCompilationArtifact as prepareBoundCncCompilation } from './cnc-compilation-artifact';

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
    resolved.sourceGeometry,
  );
  return compiled.kind === 'compiled' ? { ...compiled, evidence: resolved.evidence } : compiled;
}

function compileCncSnapshot(
  scene: Scene,
  sharedDevice: DeviceProfile,
  config: CncMachineConfig,
  vcarveLayers: CncCompilationEvidence['vcarveLayers'],
  sourceGeometry?: ReadonlyMap<number, CncOperationSourceGeometry>,
): CncJobCompilationResult {
  // Feeds cap at CNC's own Max feed, never the laser's.
  const device = cncHeadDevice(sharedDevice, config.params);
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  const stepoverOperations: CncStepoverCompilationEvidence[] = [];
  const offsetLadderDiagnostics: CncOffsetLadderCompilationEvidence[] = [];
  const reliefPlans: CncReliefPlanningEvidence[] = [];
  const omittedOpenContours: CncOpenContourOmission[] = [];
  const omittedOpenContourSources: CncOpenContourOmissionSource[] = [];
  const profileOpenPaths: CncProfileOpenPaths[] = [];
  const keptPartOperations: KeptPartCutOperation[] = [];
  const mergedStackedCopies: CncStackedCopyMerge[] = [];
  const sourceObjects = scene.objects;
  const allSourceObjects = [...sourceObjects, ...(scene.outputDependencies ?? [])];
  const runs = artworkOperationRuns(scene);
  // ADR-250 Amendment 3: every profile lead keeps clear of the parts that
  // every profile operation keeps, so collect those walls before any compiles.
  const leadWalls = profileLeadJobWalls(runs, sourceObjects, device, config, sourceGeometry);
  for (const [operationIndex, run] of runs.entries()) {
    const operation = compileCncOperation(
      sourceObjects,
      run,
      operationIndex,
      device,
      config,
      vcarveLayers,
      sourceGeometry?.get(operationIndex) ?? leadWalls.geometry.get(operationIndex),
      allSourceObjects,
      leadWalls.walls,
    );
    if (operation.kind === 'relief-materialization-failed') return operation;
    clearingGroups.push(...operation.clearingGroups);
    profileGroups.push(...operation.profileGroups);
    reliefPlans.push(...operation.reliefPlans);
    omittedOpenContours.push(...operation.openContourOmissions.counts);
    omittedOpenContourSources.push(...operation.openContourOmissions.sources);
    profileOpenPaths.push(...operation.profileOpenPaths);
    const measured = keptPartCutOperation(run.layer, operation.profileGroups, config);
    if (measured !== null) keptPartOperations.push(measured);
    mergedStackedCopies.push(...operation.stackedCopyMerges);
    offsetLadderDiagnostics.push(...operation.offsetLadderDiagnostics);
    if (operation.stepoverOperation !== undefined) {
      stepoverOperations.push(operation.stepoverOperation);
    }
  }
  // Multi-tool release ordering: all clearing phases finish before any
  // profile can free material. Group ready work by tool while preserving each
  // operation's secondary-clearing-before-finish dependency.
  const groups = orderGroupsIntoToolSections([...clearingGroups, ...profileGroups]);
  const cncCompilation = buildCncCompilationSidecar(
    vcarveLayers,
    stepoverOperations,
    reliefPlans,
    offsetLadderDiagnostics,
    { counts: omittedOpenContours, sources: omittedOpenContourSources },
    mergedStackedCopies,
    // ADR-672 and ADR-433 Amendment 3: outlines cut on their line, and cuts
    // that reach a part another operation keeps.
    { profileOpenPaths, keptPartCuts: cncKeptPartCuts(keptPartOperations, leadWalls.walls) },
  );
  return {
    kind: 'compiled',
    job: { groups, cncCompilation },
  };
}

function compileCncOperation(
  sourceObjects: Scene['objects'],
  run: { readonly layer: Layer; readonly priorityObjectId: string },
  operationIndex: number,
  device: DeviceProfile,
  config: CncMachineConfig,
  vcarveLayers: CncCompilationEvidence['vcarveLayers'],
  sourceGeometry?: CncOperationSourceGeometry,
  allSourceObjects: Scene['objects'] = sourceObjects,
  leadWalls: ReadonlyArray<ProfileLeadKeptWall> = [],
): CompiledCncOperation | ReliefMaterializationFailure {
  const { layer, priorityObjectId } = run;
  const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (settings.reliefProjection !== undefined) {
    return compileCncProjectedOperation(
      sourceObjects,
      allSourceObjects,
      layer,
      settings,
      priorityObjectId,
      device,
      config,
      sourceGeometry,
    );
  }
  const relief = compileReliefGroupsForLayer(sourceObjects, layer, settings, device, config);
  if (relief.kind === 'relief-materialization-failed') return relief;
  // The private artifact owns these contours and the validated ladder for this operation.
  const contours = sourceGeometry?.contours ?? collectLayerContours(sourceObjects, layer, device);
  const polylines = sourceGeometry?.polylines ?? layerPolylinesFromContours(layer, contours);
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
    leadWalls,
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
    openContourOmissions: cncOpenContourOmissions(layer, contours),
    profileOpenPaths: cncProfileOpenPaths(
      layer,
      contours,
      profileLeadCutWidthMm(layerCncTool(config, settings), settings),
    ),
    stackedCopyMerges: cncStackedCopyMerges(layer, contours),
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
  leadWalls: ReadonlyArray<ProfileLeadKeptWall>,
): CncOperationGroups {
  if (polylines.length === 0) {
    return {
      clearingGroups: [],
      profileGroups: [],
      offsetLadderDiagnostics: [],
      stepoverUsed: false,
    };
  }
  const inlay = compiledInlayGroups(layer, settings, polylines, device, config, leadWalls);
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
    leadWalls,
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
  const tagged = tagFinishedGroup(
    compiledGroup.group,
    secondary.groups,
    polylines,
    priorityObjectId,
  );
  const profileGroups = compiledGroup.groups.map((group) =>
    tagArtworkGroup(group, priorityObjectId),
  );
  const profileCut = isProfileCutType(settings.cutType);
  return {
    clearingGroups: profileCut ? clearingGroups : [...clearingGroups, tagged],
    profileGroups: profileCut ? profileGroups : [],
    offsetLadderDiagnostics,
    stepoverUsed: secondary.stepoverUsed || compiledGroup.stepoverUsed,
  };
}

function tagFinishedGroup(
  group: CncGroup,
  clearing: ReadonlyArray<CncGroup>,
  polylines: ReadonlyArray<Polyline>,
  sourceObjectId: string,
): CncGroup {
  return tagArtworkGroup(restAwareVCarveGroup(group, clearing, polylines), sourceObjectId);
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
