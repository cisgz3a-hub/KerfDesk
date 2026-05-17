import type { PreflightContext, PreflightResult } from '../PreflightContext';
import { PREFLIGHT_CODES } from '../PreflightContext';
import type { Layer } from '../../scene/Layer';

const Z_EPS = 0.001;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function plannedZRangeForLayer(layer: Layer): { minZ: number; maxZ: number; passCount: number } | null {
  const zStep = Number(layer.settings.zStepPerPass);
  if (!Number.isFinite(zStep) || Math.abs(zStep) <= Z_EPS) return null;

  const rawPassCount = Number(layer.settings.passes);
  const passCount = Number.isFinite(rawPassCount)
    ? Math.max(1, Math.floor(rawPassCount))
    : 1;
  if (passCount <= 1) return null;

  const finalZ = zStep * (passCount - 1);
  return {
    minZ: Math.min(0, finalZ),
    maxZ: Math.max(0, finalZ),
    passCount,
  };
}

function runZAxisStepChecks(ctx: PreflightContext, layer: Layer, out: PreflightResult[]): void {
  const zRange = plannedZRangeForLayer(layer);
  if (!zRange) return;

  const zAxis = ctx.profile?.zAxis;
  if (zAxis?.supported !== true) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.Z_AXIS_UNSUPPORTED,
      message: `Layer "${layer.name}" uses Z step per pass, but the active machine profile does not explicitly support bounded Z-axis job moves.`,
      layerId: layer.id,
    });
    return;
  }

  const minLimit = zAxis.minMm;
  const maxLimit = zAxis.maxMm;
  if (!finiteNumber(minLimit) || !finiteNumber(maxLimit) || minLimit > maxLimit) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.Z_AXIS_LIMITS_MISSING,
      message: `Layer "${layer.name}" uses Z step per pass, but the active machine profile has no safe Z min/max range.`,
      layerId: layer.id,
    });
    return;
  }

  if (zRange.minZ < minLimit - Z_EPS || zRange.maxZ > maxLimit + Z_EPS) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.Z_AXIS_OUT_OF_RANGE,
      message: `Layer "${layer.name}" would move Z from ${zRange.minZ.toFixed(3)}mm to ${zRange.maxZ.toFixed(3)}mm across ${zRange.passCount} passes, outside the configured safe Z range ${minLimit.toFixed(3)}mm to ${maxLimit.toFixed(3)}mm.`,
      layerId: layer.id,
    });
  }
}

export function runLayerChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  const { profile, scene } = ctx;
  const maxSpindle = profile?.maxSpindle ?? 1000;
  const maxRate = Math.max(profile?.maxRateX ?? profile?.maxFeedRate ?? 12000, profile?.maxRateY ?? profile?.maxFeedRate ?? 12000);

  for (const layer of scene.layers) {
    if (layer.visible === false || layer.output === false) continue;
    const layerObjects = scene.objects.filter(obj => obj.layerId === layer.id && obj.visible);
    if (layerObjects.length === 0) continue;

    // S25-07-002: planning emits `setZ` / `G0 Z...` for multi-pass
    // zStepPerPass output, so preflight must fail closed unless the
    // active profile explicitly declares bounded Z travel as safe.
    runZAxisStepChecks(ctx, layer, out);

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
