// Marlin's inline laser S range (controller audit v4 E1-P3-3). Marlin 2.1.2.5
// spindle_laser_types.h makes `cutter_power_t` a uint8_t unless the build uses
// CUTTER_POWER_UNIT RPM with SPEED_POWER_MAX above 255. gcode.cpp and
// M3-M5.cpp pass the float S straight into `power_to_range(cutter_power_t)`,
// so it is narrowed to one byte before power_to_range's own constrain can
// clamp it. ARM and AVR GCC keep the low byte: S600 runs as 88 (34.5%), S1000
// as 232 and S256 as 0. Fan wiring (M106) always writes 0..255 and is safe.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.5/Marlin/src/feature/spindle_laser_types.h
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.5/Marlin/src/gcode/gcode.cpp

import type { DeviceProfile } from './device-profile';
import { resolveMarlinDialect } from './gcode-dialects';

/** The largest S a stock (PWM255 or PERCENT) Marlin laser build holds. */
export const MARLIN_CUTTER_POWER_BYTE_MAX = 255;

/** Job Review text for a Marlin inline profile whose Full-power S is above one
 *  byte, or null. Like smoothiePowerScaleWarning, a warning only: KerfDesk
 *  cannot read the build's CUTTER_POWER_UNIT, and saved values never migrate. */
export function marlinPowerScaleWarning(
  device: Pick<DeviceProfile, 'controllerKind' | 'maxPowerS' | 'gcodeDialect'>,
): string | null {
  if (device.controllerKind !== 'marlin') return null;
  if (resolveMarlinDialect(device).powerMode === 'fan') return null;
  const top = device.maxPowerS;
  if (!(top > MARLIN_CUTTER_POWER_BYTE_MAX)) return null;
  const wrapped = Math.round(top) % (MARLIN_CUTTER_POWER_BYTE_MAX + 1);
  const share = Number(((wrapped / MARLIN_CUTTER_POWER_BYTE_MAX) * 100).toFixed(1));
  return (
    `This Marlin profile's Full-power S is ${top}, but stock Marlin laser builds ` +
    '(CUTTER_POWER_UNIT PWM255 or PERCENT) hold S in one byte: any S above 255 wraps ' +
    `instead of clamping, so 100% (S${Math.round(top)}) runs as S${wrapped}, ${share}% on a PWM255 build. ` +
    'Set Full-power S to 255 for PWM255 or 100 for PERCENT in Machine Setup before burning, ' +
    `or keep ${top} only on a CUTTER_POWER_UNIT RPM build whose SPEED_POWER_MAX is ${top}.`
  );
}
