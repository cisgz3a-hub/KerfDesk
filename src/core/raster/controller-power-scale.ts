import type { DeviceProfile } from '../devices';
import { resolveMarlinDialect } from '../devices/gcode-dialects';
import type { RasterPowerValues } from './raster-power-values';

export const SMOOTHIE_VIRTUAL_MAX_POWER = 1000;
export const MARLIN_FAN_MAX_POWER = 255;

/** Dither in integer PWM units, then return the compiled job's original S units.
 * Fractional controllers must not round a percentage in a 0..1 domain. */
export function rasterCompilationPowerScale(device: DeviceProfile): number {
  if (device.controllerKind === 'smoothieware') return SMOOTHIE_VIRTUAL_MAX_POWER;
  if (device.controllerKind === 'marlin' && resolveMarlinDialect(device).powerMode === 'fan') {
    return MARLIN_FAN_MAX_POWER;
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
