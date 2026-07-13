import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import {
  cncGroupForLayer,
  collectLayerPolylines,
  vcarveClearanceGroupForLayer,
  xyToolpathsForCutType,
} from './compile-cnc-job';

// Output layers whose vector geometry exists but cannot produce any toolpath.
export function findDroppedCncLayers(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<string> {
  const dropped: string[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    if (settings.cutType === 'inlay-pair') continue;
    if (explicitPocketPlannerHasBasePaths(polylines, settings, config)) continue;
    const clearance = vcarveClearanceGroupForLayer(layer, settings, polylines, device, config);
    const group = cncGroupForLayer(layer, settings, polylines, device, config);
    if (clearance === null && group === null) dropped.push(layer.id);
  }
  return dropped;
}

function explicitPocketPlannerHasBasePaths(
  polylines: ReadonlyArray<Parameters<typeof xyToolpathsForCutType>[0][number]>,
  settings: typeof DEFAULT_CNC_LAYER_SETTINGS,
  config: CncMachineConfig,
): boolean {
  const usesExplicitPlanner =
    settings.cutType === 'pocket' &&
    (settings.helixEntry !== undefined ||
      settings.pocketRoughToolId !== undefined ||
      settings.pocketStrategy === 'adaptive');
  if (!usesExplicitPlanner) return false;
  if (settings.pocketStrategy === 'adaptive') {
    return polylines.some((polyline) => polyline.closed && polyline.points.length >= 3);
  }
  const tool = layerCncTool(config, settings);
  return xyToolpathsForCutType(polylines, settings, tool.diameterMm, 0).length > 0;
}
