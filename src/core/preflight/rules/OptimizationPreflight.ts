import type { PreflightContext, PreflightResult } from '../PreflightContext';
import { PREFLIGHT_CODES } from '../PreflightContext';
import type { Scene } from '../../scene/Scene';

function countCutObjects(scene: Scene): number {
  const cutLayerIds = new Set(
    scene.layers
      .filter(l => l.visible !== false && l.output !== false && l.settings.mode === 'cut')
      .map(l => l.id),
  );
  return scene.objects.filter(obj => obj.visible && cutLayerIds.has(obj.layerId)).length;
}

export function runOptimizationChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (!ctx.optimizeOrderEnabled) {
    const cutObjectCount = countCutObjects(ctx.scene);
    if (cutObjectCount >= 5) {
      out.push({
        severity: 'info',
        code: PREFLIGHT_CODES.OPTIMIZE_ORDER_OFF,
        message: `Optimize order is off. With ${cutObjectCount} cut objects, enabling it can reduce travel time.`,
      });
    }
  }

  for (const layer of ctx.scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    if (layer.settings.mode === 'image' || layer.settings.mode === 'engrave') {
      if (!layer.settings.smartOverscanEnabled && layer.settings.speed >= 3000) {
        out.push({
          severity: 'info',
          code: PREFLIGHT_CODES.SMART_OVERSCAN_OFF_FAST,
          message: `Layer "${layer.name}" is fast raster without smart overscan.`,
          layerId: layer.id,
        });
      }
      if (!layer.settings.accelAwarePower && layer.settings.mode === 'image') {
        out.push({
          severity: 'info',
          code: PREFLIGHT_CODES.ACCEL_AWARE_OFF_RASTER,
          message: `Layer "${layer.name}" has acceleration-aware power disabled for raster output.`,
          layerId: layer.id,
        });
      }
    }
  }

  if (ctx.estimatedTimeSeconds && ctx.estimatedTimeSeconds > 3600) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.LONG_JOB,
      message: `Estimated job time is about ${Math.round(ctx.estimatedTimeSeconds / 60)} minutes.`,
    });
  }
}
