// Controller audit v4 E1-P3-3: stock Marlin laser builds narrow S to one byte
// (`uint8_t cutter_power_t`) before power_to_range can clamp it, so a Full-power
// S above 255 wraps: S600 runs as 88 and S1000 as 232. Job Review warns, as it
// does for Smoothieware's 12-bit S.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import type { MarlinGcodeDialectId } from './gcode-dialects';
import { marlinPowerScaleWarning } from './marlin-power-scale';

function marlin(
  maxPowerS: number,
  dialectId: MarlinGcodeDialectId = 'marlin-inline',
): DeviceProfile {
  return {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'marlin',
    maxPowerS,
    gcodeDialect: { dialectId },
  };
}

describe('marlinPowerScaleWarning', () => {
  it('stays quiet at the PWM255 and PERCENT ranges and on fan wiring', () => {
    expect(marlinPowerScaleWarning(marlin(255))).toBeNull();
    expect(marlinPowerScaleWarning(marlin(100))).toBeNull();
    // M106 always writes 0..255, whatever the profile says.
    expect(marlinPowerScaleWarning(marlin(1000, 'marlin-fan'))).toBeNull();
    expect(marlinPowerScaleWarning({ ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 })).toBeNull();
  });

  it('says what full power wraps to above one byte', () => {
    expect(marlinPowerScaleWarning(marlin(1000))).toBe(
      "This Marlin profile's Full-power S is 1000, but stock Marlin laser builds (CUTTER_POWER_UNIT PWM255 or PERCENT) hold S in one byte: " +
        'any S above 255 wraps instead of clamping, so 100% (S1000) runs as S232, 91% on a PWM255 build. ' +
        'Set Full-power S to 255 for PWM255 or 100 for PERCENT in Machine Setup before burning, ' +
        'or keep 1000 only on a CUTTER_POWER_UNIT RPM build whose SPEED_POWER_MAX is 1000.',
    );
    expect(marlinPowerScaleWarning(marlin(256))).toContain('100% (S256) runs as S0, 0% on');
    expect(marlinPowerScaleWarning(marlin(600))).toContain('runs as S88, 34.5% on');
  });
});
