import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { pocketToolpathsForSettings } from './cnc-rest-operation';
import { zPassDepths } from './depth-passes';
import { planHelicalPocketPasses } from './helical-entry';

export type CncHelicalEntryIssue = {
  readonly layerId: string;
  readonly reason: string;
};

export function findCncHelicalEntryIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncHelicalEntryIssue> {
  const issues: CncHelicalEntryIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'pocket' || settings.helixEntry === undefined) continue;
    if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') {
      issues.push({
        layerId: layer.id,
        reason: 'Helical entry requires the Offset pocket fill method.',
      });
      continue;
    }
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    const tool = layerCncTool(config, settings);
    const toolpaths = pocketToolpathsForSettings(polylines, settings, tool.diameterMm);
    const depths = zPassDepths(settings.depthMm, settings.depthPerPassMm);
    if (toolpaths.length === 0 || depths.length === 0) continue;
    const plan = planHelicalPocketPasses(toolpaths, depths, settings.helixEntry);
    if (!plan.ok) issues.push({ layerId: layer.id, reason: plan.reason });
  }
  return issues;
}
