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
import type { CncCompilationSidecar } from '../job/job';
import { coolantFields } from './coolant-fields';
import {
  capFeed,
  capSpindle,
  sourceRegionMajorDepthPasses,
  isProfileCutType,
  resolveRetractBetweenPasses,
  type CncGroupCompileOptions,
} from './compile-cnc-helpers';
import { compileReliefGroupsForLayer } from './compile-cnc-relief';
import { orderGroupsIntoToolSections } from './cnc-tool-sections';
import { resolveRestPocketOperation } from './cnc-rest-operation';
import { zPassDepths } from './depth-passes';
import { compileStraightInlayGroups } from './inlay-pair-operation';
import { machineFrameHandedness } from './machine-frame-handedness';
import { applyRampEntry, parkFields } from './motion-polish';
import { applyProfileLeadPasses } from './profile-lead-passes';
import { vcarveClearanceToolpaths } from './vcarve-clearance';
import { vcarveEffectiveDepthMm } from './vcarve-depth';
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
import { passesForCncLayer } from './compile-cnc-layer-passes';

export { xyToolpathsForCutType } from './compile-cnc-layer-passes';

export function compileCncJob(scene: Scene, device: DeviceProfile, config: CncMachineConfig): Job {
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
  return finalized.job;
}

export type FinalizedCncCompilation =
  | { readonly kind: 'rejected'; readonly reason: CncCompilationRejectionReason }
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
  return {
    kind: 'compiled',
    job: compileCncSnapshot(
      resolved.scene,
      resolved.device,
      resolved.config,
      resolved.evidence.vcarveLayers,
    ),
    evidence: resolved.evidence,
  };
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
): Job {
  const clearingGroups: CncGroup[] = [];
  const profileGroups: CncGroup[] = [];
  const sourceObjects = scene.objects;
  for (const [operationIndex, { layer, priorityObjectId }] of artworkOperationRuns(
    scene,
  ).entries()) {
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    // H.5/H.8: relief objects rough (and optionally finish, with their own
    // bit) as clearing groups — neither ever frees a part.
    clearingGroups.push(
      ...compileReliefGroupsForLayer(sourceObjects, layer, settings, device, config).map((group) =>
        tagArtworkGroup(group, priorityObjectId),
      ),
    );
    const contours = collectLayerContours(sourceObjects, layer, device);
    const polylines = layerPolylinesFromContours(layer, contours);
    if (polylines.length === 0) continue;
    const inlayGroups = compileStraightInlayGroups(
      polylines,
      settings,
      config,
      // The inlay pair builds its groups directly rather than through
      // cncGroupForLayer, so it has to apply the ADR-250 lead itself or the
      // male insert plunges full-depth onto the very wall that must fit the
      // pocket. applyProfileLeadPasses is a no-op for the female pocket.
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
    );
    if (inlayGroups !== null) {
      clearingGroups.push(tagArtworkGroup(inlayGroups.female, priorityObjectId));
      profileGroups.push(tagArtworkGroup(inlayGroups.male, priorityObjectId));
      continue;
    }
    // H.7 two-stage V-carve clearance runs before the V-bit medial finish.
    const clearance = vcarveClearanceGroupForLayer(layer, settings, polylines, device, config);
    if (clearance !== null) clearingGroups.push(tagArtworkGroup(clearance, priorityObjectId));
    const roughing = restPocketRoughingGroupForLayer(layer, settings, polylines, device, config);
    if (roughing !== null) clearingGroups.push(tagArtworkGroup(roughing, priorityObjectId));
    const group = cncGroupForLayerResolved(
      layer,
      settings,
      polylines,
      device,
      config,
      contours,
      vcarveLadderForOperation(
        vcarveLayers,
        operationIndex,
        layer.id,
        priorityObjectId,
        settings.cutType === 'v-carve',
      ),
    );
    if (group === null) continue;
    if (isProfileCutType(settings.cutType)) {
      profileGroups.push(tagArtworkGroup(group, priorityObjectId));
    } else {
      clearingGroups.push(tagArtworkGroup(group, priorityObjectId));
    }
  }
  // H.7 multi-tool: contiguous per-bit sections (one change per bit),
  // profile-carrying sections last so freed parts are never re-machined.
  const groups = orderGroupsIntoToolSections([...clearingGroups, ...profileGroups]);
  const cncCompilation = cncCompilationSidecar(vcarveLayers);
  return cncCompilation === undefined ? { groups } : { groups, cncCompilation };
}

function hasVCarveOperation(scene: Scene): boolean {
  return artworkOperationRuns(scene).some(
    ({ layer }) => (layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS).cutType === 'v-carve',
  );
}

function vcarveLadderForOperation(
  layers: CncCompilationEvidence['vcarveLayers'],
  operationIndex: number,
  layerId: string,
  priorityObjectId: string,
  required: boolean,
): VCarveLadder | undefined {
  const evidence = layers.find((candidate) => candidate.operationIndex === operationIndex);
  if (evidence === undefined) {
    if (required)
      throw new Error(`Missing bound V-carve evidence for operation ${operationIndex}.`);
    return undefined;
  }
  if (evidence.layerId !== layerId || evidence.priorityObjectId !== priorityObjectId) {
    throw new Error(`Bound V-carve evidence does not match operation ${operationIndex}.`);
  }
  return evidence.ladder;
}

function cncCompilationSidecar(
  layers: CncCompilationEvidence['vcarveLayers'],
): CncCompilationSidecar | undefined {
  if (layers.length === 0) return undefined;
  return {
    vcarveOperations: layers.map(({ operationIndex, layerId, ladder }) => ({
      operationIndex,
      layerId,
      entryIssue: ladder.entryIssue,
      offsetFailed: ladder.offsetFailed,
      thinResidual: ladder.thinResidual,
      passLimited: ladder.passLimited,
    })),
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
  return cncGroupForLayerResolved(layer, settings, polylines, device, config, sourceContours);
}

function cncGroupForLayerResolved(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
  sourceContours?: ReadonlyArray<CollectedCncContour>,
  vcarveLadder?: VCarveLadder,
): CncGroup | null {
  const tool = layerCncTool(config, settings);
  // Cut direction is a physical rule applied to machine numbers, and
  // front-right / rear-left mirror the frame — see machine-frame-handedness.
  const handedness = machineFrameHandedness(device.origin);
  const passes = passesForCncLayer(
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
    passes,
    settings,
    tool.diameterMm,
    machineBoundsForDevice(device),
  );
  return cncGroupForPasses(layer, settings, tool, led, device, config);
}

function restPocketRoughingGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  const operation = resolveRestPocketOperation(polylines, settings, config);
  if (operation.kind !== 'ok') return null;
  const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
  let passes: ReadonlyArray<CncPass> = sourceRegionMajorDepthPasses(
    polylines,
    operation.roughToolpaths,
    depths,
  );
  if (settings.rampEntryDeg !== undefined) passes = applyRampEntry(passes, settings.rampEntryDeg);
  const primaryTool = layerCncTool(config, settings);
  return cncGroupForPasses(layer, settings, operation.roughTool, passes, device, config, {
    layerPrimaryTool: primaryTool,
  });
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

// The two-stage V-carve's clearing group (H.7): pocket an explicitly enabled
// flat floor with the layer's clearing bit before the V-bit medial finish.
export function vcarveClearanceGroupForLayer(
  layer: Layer,
  settings: CncLayerSettings,
  polylines: ReadonlyArray<Polyline>,
  device: DeviceProfile,
  config: CncMachineConfig,
): CncGroup | null {
  if (
    settings.cutType !== 'v-carve' ||
    !(settings.vCarveFlatDepthEnabled ?? true) ||
    settings.vClearToolId === undefined
  ) {
    return null;
  }
  const clearTool = config.tools.find((tool) => tool.id === settings.vClearToolId);
  if (clearTool === undefined || clearTool.kind !== 'end-mill') return null;
  const vBit = layerCncTool(config, settings);
  const effectiveDepthMm = vcarveEffectiveDepthMm(vBit, settings.depthMm);
  if (effectiveDepthMm === null) return null;
  const toolpaths = vcarveClearanceToolpaths(polylines, {
    vBit,
    clearTool,
    maxDepthMm: effectiveDepthMm,
    stepoverPercent: settings.stepoverPercent,
  });
  const depths = zPassDepths(effectiveDepthMm, settings.depthPerPassMm);
  if (toolpaths.length === 0 || depths.length === 0) return null;
  const clearingSettings: CncLayerSettings = { ...settings, cutType: 'pocket' };
  return cncGroupForPasses(
    layer,
    clearingSettings,
    clearTool,
    sourceRegionMajorDepthPasses(polylines, toolpaths, depths),
    device,
    config,
    { layerPrimaryTool: vBit, includeRampEntry: false, retractBetweenPasses: false },
  );
}
