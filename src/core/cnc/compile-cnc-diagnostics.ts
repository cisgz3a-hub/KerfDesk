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
    const usesExplicitPocketPlanner =
      settings.cutType === 'pocket' &&
      (settings.helixEntry !== undefined || settings.pocketRoughToolId !== undefined);
    if (usesExplicitPocketPlanner) {
      const tool = layerCncTool(config, settings);
      if (xyToolpathsForCutType(polylines, settings, tool.diameterMm, 0).length > 0) continue;
    }
    const clearance = vcarveClearanceGroupForLayer(layer, settings, polylines, device, config);
    const group = cncGroupForLayer(layer, settings, polylines, device, config);
    if (clearance === null && group === null) dropped.push(layer.id);
  }
  return dropped;
}
