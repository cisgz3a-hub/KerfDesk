import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { vcarveLadderPasses } from './vcarve-ladder';

export type CncVCarveEntryIssue = {
  readonly layerId: string;
  readonly reason: string;
};

export function findCncVCarveEntryIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncVCarveEntryIssue> {
  const issues: CncVCarveEntryIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'v-carve' || settings.vCarveRampEntryDeg === undefined) continue;
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    const ladder = vcarveLadderPasses(polylines, {
      tool: layerCncTool(config, settings),
      maxDepthMm: settings.depthMm,
      depthPerPassMm: settings.depthPerPassMm,
      resolutionMm: settings.vResolutionMm,
      rampAngleDeg: settings.vCarveRampEntryDeg,
    });
    if (ladder.entryIssue !== null) {
      issues.push({ layerId: layer.id, reason: ladder.entryIssue });
    }
  }
  return issues;
}
