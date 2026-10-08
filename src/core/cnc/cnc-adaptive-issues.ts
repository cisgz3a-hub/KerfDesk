import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { resolveAdaptivePocketOperation } from './adaptive-pocket-operation';
import { collectLayerPolylines } from './compile-cnc-job';

export type CncAdaptivePocketIssue = { readonly layerId: string; readonly reason: string };

export function findCncAdaptivePocketIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncAdaptivePocketIssue> {
  const issues: CncAdaptivePocketIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'pocket' || settings.pocketStrategy !== 'adaptive') continue;
    const contours = collectLayerPolylines(scene.objects, layer, device);
    if (contours.length === 0) continue;
    const operation = resolveAdaptivePocketOperation(
      contours,
      settings,
      layerCncTool(config, settings),
    );
    if (operation.kind === 'error')
      issues.push({ layerId: layer.id, reason: 'Offset pocket fallback: ' + operation.reason });
    else if (operation.kind === 'ok' && operation.plan.islandPartitions !== undefined)
      issues.push({
        layerId: layer.id,
        reason:
          'Island adaptive uses ' +
          operation.plan.islandPartitions +
          ' verified partitions with independent entries and plunge-feed seed slotting that may engage full cutter width. The radial limit applies to clearing rings; seed slotting and final wall cleanup can engage more stock; coverage is simulated; physical efficiency is unqualified.',
      });
  }
  return issues;
}
