import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  type CncLayerSettings,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { resolveRestPocketOperation, type CncRestPocketOperation } from './cnc-rest-operation';

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
    if (!hasRestIntent(settings)) continue;
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    if (polylines.length === 0) continue;
    // Legacy invalid roughers are reported by factual preflight. Explicit
    // previous-stock intent instead discloses its executable full-pocket fallback.
    if (settings.pocketRestStock === undefined && !hasLegacyRoughTool(settings, config)) continue;
    const operation = resolveRestPocketOperation(polylines, settings, config);
    for (const reason of operationReasons(operation)) issues.push({ layerId: layer.id, reason });
  }
  return issues;
}

function operationReasons(operation: CncRestPocketOperation): ReadonlyArray<string> {
  if (operation.kind === 'error') return [operation.reason];
  return operation.kind === 'ok' ? (operation.findings ?? []) : [];
}

function hasRestIntent(settings: CncLayerSettings): boolean {
  return (
    settings.cutType === 'pocket' &&
    (settings.pocketRoughToolId !== undefined || settings.pocketRestStock !== undefined)
  );
}
function hasLegacyRoughTool(settings: CncLayerSettings, config: CncMachineConfig): boolean {
  return config.tools.some(
    (tool) => tool.id === settings.pocketRoughToolId && tool.kind === 'end-mill',
  );
}
