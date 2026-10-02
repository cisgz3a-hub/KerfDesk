import type { DeviceProfile } from '../devices';

/** Version 1 rounds vector power in the original S range and spells raw S.
 * Version 2 retains fractional GRBL power and ordinary decimal S spelling. */
export type LaserPowerScaleVersion = 1 | 2;
export const CURRENT_LASER_POWER_SCALE_VERSION: LaserPowerScaleVersion = 2;

export function archivedLaserPowerScaleVersion(value: unknown): LaserPowerScaleVersion | null {
  return value === undefined || value === 1 ? 1 : value === 2 ? 2 : null;
}

export function powerScaleVersionForDevice(
  device: DeviceProfile,
  version: LaserPowerScaleVersion = CURRENT_LASER_POWER_SCALE_VERSION,
): LaserPowerScaleVersion {
  return device.controllerKind === undefined ||
    device.controllerKind === 'grbl-v1.1' ||
    device.controllerKind === 'grblhal' ||
    device.controllerKind === 'fluidnc'
    ? version
    : 1;
}
