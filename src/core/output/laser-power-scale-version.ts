import type { DeviceProfile } from '../devices';

/** Version 1 rounds vector power in the original S range and spells raw S.
 * Version 2 retains fractional GRBL power and ordinary decimal S spelling.
 * Version 3 also gives a whole-number range below 100 S steps that virtual
 * range, so a small $30 cannot round every power to S0 or full power
 * (ADR-567 Amendment 1). Version 4 gives FluidNC version 1's whole S again,
 * because FluidNC narrows every S word to a whole number before its
 * speed_map (ADR-567 Amendment 2). */
export type LaserPowerScaleVersion = 1 | 2 | 3 | 4;
export const CURRENT_LASER_POWER_SCALE_VERSION: LaserPowerScaleVersion = 4;

/** At 100 or more whole S steps every whole percentage lands within half a
 * percentage point of full scale; fewer steps cannot keep that promise. */
export const MIN_WHOLE_NUMBER_POWER_STEPS = 100;

export function archivedLaserPowerScaleVersion(value: unknown): LaserPowerScaleVersion | null {
  return value === undefined || value === 1
    ? 1
    : value === 2 || value === 3 || value === 4
      ? value
      : null;
}

/** Whether a GRBL-family S maximum uses the virtual fractional range rather
 * than rounding each percentage to a whole S. Ranges of 100 S steps or more,
 * such as $30=1000 or $30=255, keep their established whole-S bytes. */
export function usesVirtualPowerRange(maxPowerS: number, version: LaserPowerScaleVersion): boolean {
  if (version === 1) return false;
  if (!Number.isInteger(maxPowerS)) return true;
  return version >= 3 && maxPowerS < MIN_WHOLE_NUMBER_POWER_STEPS;
}

export function powerScaleVersionForDevice(
  device: DeviceProfile,
  version: LaserPowerScaleVersion = CURRENT_LASER_POWER_SCALE_VERSION,
): LaserPowerScaleVersion {
  // FluidNC's SpindleSpeed is uint32_t, so S0.6 runs as S0. Versions 2 and 3
  // keep the fractional bytes they were written with.
  if (device.controllerKind === 'fluidnc') return version >= 4 ? 1 : version;
  return device.controllerKind === undefined ||
    device.controllerKind === 'grbl-v1.1' ||
    device.controllerKind === 'grblhal'
    ? version
    : 1;
}
