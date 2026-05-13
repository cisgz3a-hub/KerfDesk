import type { PreflightContext, PreflightResult } from '../PreflightContext';
import { PREFLIGHT_CODES } from '../PreflightContext';

export function runLayerChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { profile, scene } = ctx;
  const maxSpindle = profile?.maxSpindle ?? 1000;
  const maxRate = Math.max(profile?.maxRateX ?? profile?.maxFeedRate ?? 12000, profile?.maxRateY ?? profile?.maxFeedRate ?? 12000);

  for (const layer of scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    const layerObjects = scene.objects.filter(obj => obj.layerId === layer.id && obj.visible);
    if (layerObjects.length === 0) continue;

    const powerMin = layer.settings.power.min;
    const powerMax = layer.settings.power.max;
    if (!Number.isFinite(powerMin) || !Number.isFinite(powerMax) || powerMin > powerMax) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_POWER_RANGE_INVALID,
        message: `Layer "${layer.name}" has an invalid power range (${powerMin}%-${powerMax}%).`,
        layerId: layer.id,
        fix: { label: 'Set power to 50%', action: { type: 'setLayerPower', layerId: layer.id, power: maxSpindle * 0.5 } },
      });
    } else if (layer.settings.power.max <= 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_POWER_ZERO,
        message: `Layer "${layer.name}" has power 0 - nothing will be burned.`,
        layerId: layer.id,
        fix: { label: 'Set power to 50%', action: { type: 'setLayerPower', layerId: layer.id, power: maxSpindle * 0.5 } },
      });
    } else if (layer.settings.power.max > 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_POWER_HIGH,
        message: `Layer "${layer.name}" power (${layer.settings.power.max}%) exceeds expected max (100%).`,
        layerId: layer.id,
      });
    }

    const speed = layer.settings.speed;
    if (!Number.isFinite(speed)) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_SPEED_INVALID,
        message: `Layer "${layer.name}" has an invalid speed (${speed}).`,
        layerId: layer.id,
        fix: { label: 'Set speed to 3000', action: { type: 'setLayerSpeed', layerId: layer.id, speed: 3000 } },
      });
    } else if (speed === 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_SPEED_ZERO,
        message: `Layer "${layer.name}" has speed 0.`,
        layerId: layer.id,
        fix: { label: 'Set speed to 3000', action: { type: 'setLayerSpeed', layerId: layer.id, speed: 3000 } },
      });
    } else if (speed < 0) {
      out.push({
        severity: 'error',
        code: PREFLIGHT_CODES.LAYER_SPEED_NEGATIVE,
        message: `Layer "${layer.name}" has negative speed (${speed}).`,
        layerId: layer.id,
      });
    } else if (speed > maxRate) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_SPEED_HIGH,
        message: `Layer "${layer.name}" speed (${speed}) exceeds machine max rate (${maxRate}).`,
        layerId: layer.id,
      });
    } else if (speed < 100) {
      out.push({
        severity: 'warning',
        code: PREFLIGHT_CODES.LAYER_SPEED_LOW,
        message: `Layer "${layer.name}" speed (${speed}) is very slow and may overburn.`,
        layerId: layer.id,
      });
    }
  }
}
