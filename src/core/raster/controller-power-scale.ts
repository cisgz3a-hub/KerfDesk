import type { DeviceProfile } from '../devices';
import { resolveMarlinDialect } from '../devices/gcode-dialects';
import type { RasterPowerValues } from './raster-power-values';
import {
  CURRENT_LASER_POWER_SCALE_VERSION,
  usesVirtualPowerRange,
  type LaserPowerScaleVersion,
} from '../output/laser-power-scale-version';

export const SMOOTHIE_VIRTUAL_MAX_POWER = 1000;
export const MARLIN_FAN_MAX_POWER = 255;

/** Dither in integer PWM units, then return the compiled job's original S units.
 * Fractional and small whole-number GRBL ranges must not round a percentage
 * in a 0..1 or 0..20 domain (ADR-567 Amendment 1). */
export function rasterCompilationPowerScale(
  device: DeviceProfile,
  version: LaserPowerScaleVersion = CURRENT_LASER_POWER_SCALE_VERSION,
): number {
  if (device.controllerKind === 'smoothieware') return SMOOTHIE_VIRTUAL_MAX_POWER;
  if (device.controllerKind === 'marlin' && resolveMarlinDialect(device).powerMode === 'fan') {
    return MARLIN_FAN_MAX_POWER;
  }
  if (
    usesVirtualPowerRange(device.maxPowerS, version) &&
    (device.controllerKind === undefined ||
      device.controllerKind === 'grbl-v1.1' ||
      device.controllerKind === 'grblhal' ||
      device.controllerKind === 'fluidnc')
  ) {
    return SMOOTHIE_VIRTUAL_MAX_POWER;
  }
  return device.maxPowerS;
}

export function rescaleRasterValues(
  values: RasterPowerValues,
  sourceMax: number,
  targetMax: number,
  round = false,
): Float64Array {
  return Float64Array.from(values, (value) => {
    const scaled = (value / sourceMax) * targetMax;
    return round ? Math.round(scaled) : scaled;
  });
}
