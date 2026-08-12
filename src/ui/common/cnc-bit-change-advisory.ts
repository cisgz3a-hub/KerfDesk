import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';

export const CNC_RETAINED_FEEDS_WARNING =
  'Bit changed. Feed, plunge, spindle RPM, and depth/pass were kept. Verify them for the selected bit before cutting.';

export const CNC_SECONDARY_RETAINED_FEEDS_WARNING =
  "Secondary bit selected. This layer's feed, plunge, spindle RPM, and depth/pass are shared with the primary bit. Verify them for the secondary bit before cutting.";

export const CNC_SECONDARY_RETAINED_RELIEF_FEEDS_WARNING =
  "Secondary finishing bit selected. This layer's feed, plunge, and spindle RPM are shared with the primary bit. Relief finishing follows the surface and scallop setting, not depth/pass. Verify the shared values for the finishing bit before cutting.";

/**
 * True when at least one operation follows the machine's Active bit while its
 * numeric cutting values remain manual/unscoped. A stale explicit id also
 * follows Active because layerCncTool falls back when that id is absent from
 * the machine. Material recipes are excluded: a successful machine update
 * recalculates those values for the new cutter.
 */
export function hasActiveBitDependentRetainedFeeds(
  scene: Scene,
  machine: CncMachineConfig,
): boolean {
  return scene.layers.some((layer) => {
    if (!layer.output || !scene.objects.some((object) => sceneObjectUsesOperation(object, layer))) {
      return false;
    }
    const settings = layer.cnc;
    if (settings === undefined) return true;
    const followsActive =
      settings.toolId === undefined || !machine.tools.some((tool) => tool.id === settings.toolId);
    return followsActive && settings.feedSource?.kind !== 'material-recipe';
  });
}

/** Detects an output operation whose effective cutter changed while all four
 * cutter-dependent numeric values stayed exact and no material recipe remains
 * authoritative. Used around synchronous store actions such as delete/apply. */
export function hasRetainedFeedsAfterEffectiveToolChange(before: Project, after: Project): boolean {
  const beforeMachine = before.machine;
  const afterMachine = after.machine;
  if (beforeMachine?.kind !== 'cnc' || afterMachine?.kind !== 'cnc') return false;
  return after.scene.layers.some((afterLayer) => {
    if (
      !afterLayer.output ||
      !after.scene.objects.some((object) => sceneObjectUsesOperation(object, afterLayer))
    ) {
      return false;
    }
    const beforeLayer = before.scene.layers.find((candidate) => candidate.id === afterLayer.id);
    if (beforeLayer === undefined) return false;
    const beforeSettings = beforeLayer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const afterSettings = afterLayer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (afterSettings.feedSource?.kind === 'material-recipe') return false;
    const beforeTool = layerCncTool(beforeMachine, beforeSettings);
    const afterTool = layerCncTool(afterMachine, afterSettings);
    return !sameCncTool(beforeTool, afterTool) && retainedFeedValues(beforeSettings, afterSettings);
  });
}

/** Returns the unique non-blocking review notices produced by one committed
 * Startup Setup change. Primary and secondary cutter comparisons happen after
 * the atomic store replacement, so Cancel remains silent and material recipes
 * that successfully recalculated do not receive the primary warning. */
export function cncRetainedFeedAdvisoriesAfterSetupChange(
  before: Project,
  after: Project,
): ReadonlyArray<string> {
  const advisories = new Set<string>();
  if (hasRetainedFeedsAfterEffectiveToolChange(before, after)) {
    advisories.add(CNC_RETAINED_FEEDS_WARNING);
  }
  const beforeMachine = before.machine;
  const afterMachine = after.machine;
  if (beforeMachine?.kind !== 'cnc' || afterMachine?.kind !== 'cnc') {
    return [...advisories];
  }
  for (const afterLayer of after.scene.layers) {
    addLayerSecondaryAdvisories({
      advisories,
      before,
      after,
      beforeMachine,
      afterMachine,
      afterLayer,
    });
  }
  return [...advisories];
}

function addLayerSecondaryAdvisories(input: {
  readonly advisories: Set<string>;
  readonly before: Project;
  readonly after: Project;
  readonly beforeMachine: CncMachineConfig;
  readonly afterMachine: CncMachineConfig;
  readonly afterLayer: Layer;
}): void {
  if (!operationProducesOutput(input.after, input.afterLayer)) return;
  const beforeLayer = input.before.scene.layers.find(
    (candidate) => candidate.id === input.afterLayer.id,
  );
  if (beforeLayer === undefined) return;
  const beforeSettings = beforeLayer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const afterSettings = input.afterLayer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  const primary = layerCncTool(input.afterMachine, afterSettings);
  if (retainedFeedValues(beforeSettings, afterSettings)) {
    addSharedSecondaryAdvisory({
      ...input,
      beforeToolId: beforeSettings.vClearToolId,
      afterToolId: afterSettings.vClearToolId,
      primary,
      message: CNC_SECONDARY_RETAINED_FEEDS_WARNING,
    });
    addSharedSecondaryAdvisory({
      ...input,
      beforeToolId: beforeSettings.pocketRoughToolId,
      afterToolId: afterSettings.pocketRoughToolId,
      primary,
      message: CNC_SECONDARY_RETAINED_FEEDS_WARNING,
    });
  }
  if (retainedReliefFeedValues(beforeSettings, afterSettings)) {
    addSharedSecondaryAdvisory({
      ...input,
      beforeToolId: beforeSettings.reliefFinishToolId,
      afterToolId: afterSettings.reliefFinishToolId,
      primary,
      message: CNC_SECONDARY_RETAINED_RELIEF_FEEDS_WARNING,
    });
  }
}

function operationProducesOutput(project: Project, layer: Layer): boolean {
  return (
    layer.output && project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer))
  );
}

function addSharedSecondaryAdvisory(input: {
  readonly advisories: Set<string>;
  readonly beforeMachine: CncMachineConfig;
  readonly afterMachine: CncMachineConfig;
  readonly beforeToolId: string | undefined;
  readonly afterToolId: string | undefined;
  readonly primary: CncTool;
  readonly message: string;
}): void {
  const afterTool = toolById(input.afterMachine, input.afterToolId);
  if (afterTool === null || sameCncTool(afterTool, input.primary)) return;
  const beforeTool = toolById(input.beforeMachine, input.beforeToolId);
  if (beforeTool === null || !sameCncTool(beforeTool, afterTool)) {
    input.advisories.add(input.message);
  }
}

function toolById(machine: CncMachineConfig, toolId: string | undefined): CncTool | null {
  if (toolId === undefined) return null;
  return machine.tools.find((tool) => tool.id === toolId) ?? null;
}

function sameCncTool(left: CncTool, right: CncTool): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.diameterMm === right.diameterMm &&
    left.tipAngleDeg === right.tipAngleDeg &&
    (left.tipDiameterMm ?? 0) === (right.tipDiameterMm ?? 0) &&
    left.fluteCount === right.fluteCount
  );
}

function retainedFeedValues(left: CncLayerSettings, right: CncLayerSettings): boolean {
  return (
    left.feedMmPerMin === right.feedMmPerMin &&
    left.plungeMmPerMin === right.plungeMmPerMin &&
    left.spindleRpm === right.spindleRpm &&
    left.depthPerPassMm === right.depthPerPassMm
  );
}

function retainedReliefFeedValues(left: CncLayerSettings, right: CncLayerSettings): boolean {
  return (
    left.feedMmPerMin === right.feedMmPerMin &&
    left.plungeMmPerMin === right.plungeMmPerMin &&
    left.spindleRpm === right.spindleRpm
  );
}
