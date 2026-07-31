import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncTool,
  type Project,
  type Scene,
} from '../../core/scene';

export const CNC_RETAINED_FEEDS_WARNING =
  'Bit changed. Feed, plunge, spindle RPM, and depth/pass were kept. Verify them for the selected bit before cutting.';

/**
 * True when at least one operation follows the machine's Active bit while its
 * numeric cutting values remain manual/unscoped. Material recipes are excluded:
 * a successful machine update recalculates those values for the new cutter.
 */
export function hasActiveBitDependentRetainedFeeds(scene: Scene): boolean {
  return scene.layers.some((layer) => {
    if (!layer.output || !scene.objects.some((object) => sceneObjectUsesOperation(object, layer))) {
      return false;
    }
    const settings = layer.cnc;
    if (settings === undefined) return true;
    return settings.toolId === undefined && settings.feedSource?.kind !== 'material-recipe';
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

function sameCncTool(left: CncTool, right: CncTool): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.diameterMm === right.diameterMm &&
    left.tipAngleDeg === right.tipAngleDeg
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
