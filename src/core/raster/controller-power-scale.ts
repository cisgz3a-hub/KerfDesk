import type { DeviceProfile } from '../devices';
import { resolveMarlinDialect } from '../devices/gcode-dialects';
import type { RasterPowerValues } from './raster-power-values';
import {
  CURRENT_LASER_POWER_SCALE_VERSION,
  powerScaleVersionForDevice,
  usesVirtualPowerRange,
  type LaserPowerScaleVersion,
} from '../output/laser-power-scale-version';

export const SMOOTHIE_VIRTUAL_MAX_POWER = 1000;
export const MARLIN_FAN_MAX_POWER = 255;

/** Dither in integer PWM units, then return the compiled job's original S units.
 * Fractional and small whole-number GRBL ranges must not round a percentage
 * in a 0..1 or 0..20 domain (ADR-567 Amendment 1). FluidNC from version 4,
 * like every non-GRBL dialect, quantizes in its own whole S range
 * (Amendment 2). */
export function rasterCompilationPowerScale(
  device: DeviceProfile,
  version: LaserPowerScaleVersion = CURRENT_LASER_POWER_SCALE_VERSION,
): number {
  if (device.controllerKind === 'smoothieware') return SMOOTHIE_VIRTUAL_MAX_POWER;
  if (device.controllerKind === 'marlin' && resolveMarlinDialect(device).powerMode === 'fan') {
    return MARLIN_FAN_MAX_POWER;
  }
  return usesVirtualPowerRange(device.maxPowerS, powerScaleVersionForDevice(device, version))
    ? SMOOTHIE_VIRTUAL_MAX_POWER
    : device.maxPowerS;
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

/** Power-scale version 3 keeps each rescaled sample to twelve significant
 * digits, as scaleS does for vectors, so 937 of 1000 at $30=20 is S18.74
 * rather than S18.740000000000002. Versions 1 and 2 keep the raw product. */
export function rescaleRasterValuesForVersion(
  values: RasterPowerValues,
  sourceMax: number,
  targetMax: number,
  version: LaserPowerScaleVersion,
): Float64Array {
  if (version < 3) return rescaleRasterValues(values, sourceMax, targetMax);
  return Float64Array.from(values, (value) =>
    Number(((value / sourceMax) * targetMax).toPrecision(12)),
  );
}
