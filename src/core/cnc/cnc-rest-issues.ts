import type { DeviceProfile } from '../devices';
import { DEFAULT_CNC_LAYER_SETTINGS, type CncMachineConfig, type Scene } from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { resolveRestPocketOperation } from './cnc-rest-operation';

export type CncRestPocketIssue = {
  readonly layerId: string;
  readonly reason: string;
};

export function findCncRestPocketIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncRestPocketIssue> {
  const issues: CncRestPocketIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'pocket' || settings.pocketRoughToolId === undefined) continue;
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    const operation = resolveRestPocketOperation(polylines, settings, config);
    if (operation.kind === 'error') issues.push({ layerId: layer.id, reason: operation.reason });
  }
  return issues;
}
