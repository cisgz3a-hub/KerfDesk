import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncMachineConfig,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './compile-cnc-job';
import { planStraightInlayPairForSettings, straightInlayPocketDepthMm } from './inlay-pair';
import { planTaperedInlayPair } from './tapered-inlay';

export type CncInlayIssue = { readonly layerId: string; readonly reason: string };

export function findCncInlayIssues(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncInlayIssue> {
  const issues: CncInlayIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    if (settings.cutType !== 'inlay-pair') continue;
    if (settings.taperedInlay !== undefined) {
      const contours = collectLayerPolylines(scene.objects, layer, device);
      if (contours.length === 0) continue;
      const tapered = planTaperedInlayPair(
        contours,
        settings.taperedInlay,
        layerCncTool(config, settings),
      );
      for (const reason of tapered.ok ? tapered.findings : [tapered.reason])
        issues.push({ layerId: layer.id, reason });
      continue;
    }
    const pocketDepth = straightInlayPocketDepthMm(settings);
    if (!(pocketDepth > 0)) {
      issues.push({ layerId: layer.id, reason: 'Pocket depth must be positive.' });
      continue;
    }
    const contours = collectLayerPolylines(scene.objects, layer, device);
    if (contours.length === 0) continue;
    const plan = planStraightInlayPairForSettings(
      contours,
      settings,
      layerCncTool(config, settings),
    );
    if (!plan.ok) issues.push({ layerId: layer.id, reason: plan.reason });
  }
  return issues;
}
