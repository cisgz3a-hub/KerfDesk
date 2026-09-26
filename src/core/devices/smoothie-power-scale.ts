// Smoothieware's S range (controller audit SM-7). The planner keeps each
// block's S word in a 12-bit 1.11 fixed-point field: `uint16_t s_value:12`
// (Block.h L81) stored as `roundf(s_value*(1<<11))` (Planner.cpp L81) and
// read back as `s_value / 2048 / laser_module_maximum_s_value` (Laser.cpp
// L246). Only 0 <= S < 2 survives; the shipped firmware.bin keeps the low 12
// bits of any larger value, so S255 on a 255 scale fires at 0.39 % and S50 on
// a 100 scale at 0 %. Every build since 5c749b4a (2016-07-31) does this, so
// the only working scale is fractional: Full-power S 1 with
// `laser_module_maximum_s_value 1.0` (the firmware default).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Block.h#L81
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Planner.cpp#L81

import type { DeviceProfile } from './device-profile';

/** The Full-power S a Smoothieware profile must use. */
export const SMOOTHIE_FULL_POWER_S = 1;
/** The smallest S the 12-bit 1.11 field cannot hold (2 × 2048 = 4096). */
export const SMOOTHIE_S_STORAGE_LIMIT = 2;

export const SMOOTHIE_FULL_POWER_S_REASON =
  'Smoothieware stores every S word in 12-bit 1.11 fixed point, so only S values below 2 reach the laser. Full-power S stays at 1; set laser_module_maximum_s_value 1.0 in the Smoothieware config to match.';

/** Job Review text for a saved Smoothieware profile whose Full-power S cannot
 *  work, or null. A warning only: saved values are never migrated silently. */
export function smoothiePowerScaleWarning(
  device: Pick<DeviceProfile, 'controllerKind' | 'maxPowerS'>,
): string | null {
  if (device.controllerKind !== 'smoothieware') return null;
  if (device.maxPowerS < SMOOTHIE_S_STORAGE_LIMIT) return null;
  return (
    `This Smoothieware profile's Full-power S is ${device.maxPowerS}, but Smoothieware stores every S word ` +
    'in 12-bit 1.11 fixed point: any S of 2 or more wraps and fires far below the requested power ' +
    '(S255 on a 255 scale fires at under 1 %). Set Full-power S to 1 in Machine Setup and ' +
    'laser_module_maximum_s_value 1.0 in the Smoothieware config before burning.'
  );
}
