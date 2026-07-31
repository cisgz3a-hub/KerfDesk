// Advisory-only disclosure for the generic diameter-band material recipe when
// an output layer uses an angled cutter. Apply and compilation remain unchanged.

import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type Project,
} from '../../core/scene';
import { cncAngledToolFeedAdvisory } from '../common/cnc-angled-tool-feed-advisory';

export function detectCncAngledToolFeedWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    if (!project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer))) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.feedSource?.kind !== 'material-recipe') continue;
    const tool = layerCncTool(machine, settings);
    const advisory = cncAngledToolFeedAdvisory(tool);
    if (advisory === null) continue;
    warnings.push(
      `Layer ${layer.id} uses automatic material values for ${tool.name}. ${advisory} ` +
        `Current values: ${settingsSummary(settings)}.`,
    );
  }
  return warnings;
}

function settingsSummary(settings: CncLayerSettings): string {
  return (
    `feed ${settings.feedMmPerMin} mm/min, plunge ${settings.plungeMmPerMin} mm/min, ` +
    `spindle ${settings.spindleRpm} RPM, ${settings.depthPerPassMm} mm/pass`
  );
}
