// Controller audit SM-7: Smoothieware keeps each block's S in a 12-bit 1.11
// fixed-point field (Block.h L81, Planner.cpp L81, read back at Laser.cpp
// L246), so only S < 2 reaches the laser. The oracle below is the repo's
// Smoothieware power model, which now stores S the same way; the Smoothieware
// strategy scales every burn to the profile's Full-power S.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Block.h#L81

import { describe, expect, it } from 'vitest';
import {
  plannedSValue,
  powerUpSmoothie,
  runSmoothieLines,
} from '../../__fixtures__/controllers/smoothie-laser-power-model';
import type { Job } from '../job';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from './device-profile';
import {
  SMOOTHIE_FULL_POWER_S,
  SMOOTHIE_S_STORAGE_LIMIT,
  smoothiePowerScaleWarning,
} from './smoothie-power-scale';

const HALF_POWER_CUT: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function smoothieProfile(maxPowerS: number): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'smoothieware', maxPowerS };
}

/** Burn power the firmware delivers for the job on a board whose
 *  laser_module_maximum_s_value matches the profile, as the guide used to say. */
function firedPowers(maxPowerS: number): ReadonlyArray<number> {
  const gcode = smoothiewareStrategy.emit(HALF_POWER_CUT, smoothieProfile(maxPowerS));
  return runSmoothieLines(powerUpSmoothie({ maximumS: maxPowerS }), gcode).burns.map(
    (burn) => burn.power,
  );
}

describe('Smoothieware 12-bit S storage (power oracle)', () => {
  it('keeps only the low 12 bits of S x 2048', () => {
    expect(plannedSValue(0.5)).toBe(0.5);
    expect(plannedSValue(1)).toBe(1);
    expect(plannedSValue(50)).toBe(0); // 102400 = 25 x 4096
    expect(plannedSValue(255)).toBe(1); // 522240 mod 4096 = 2048
    expect(plannedSValue(127.5)).toBe(1.5);
  });

  it('fires the default fractional profile (Full-power S 1) exactly', () => {
    expect(firedPowers(SMOOTHIE_FULL_POWER_S)).toEqual([0.5]);
  });

  it.each([100, 255])('shows a half-power cut at Full-power S %i firing far below half', (max) => {
    // S50 on a 100 scale is stored as 0 (no burn at all); S127.5 on a 255
    // scale fires at 1.5/255 = 0.59 %.
    for (const power of firedPowers(max)) expect(power).toBeLessThan(0.01);
  });
});

describe('smoothiePowerScaleWarning', () => {
  it('warns for a saved Smoothieware profile at S 2 or more, and never migrates it', () => {
    const device = smoothieProfile(255);
    expect(smoothiePowerScaleWarning(device)).toMatch(/12-bit 1\.11 fixed point/);
    expect(smoothiePowerScaleWarning(device)).toMatch(/laser_module_maximum_s_value 1\.0/);
    expect(device.maxPowerS).toBe(255);
    expect(smoothiePowerScaleWarning(smoothieProfile(SMOOTHIE_S_STORAGE_LIMIT))).not.toBeNull();
  });

  it('is silent below S 2 and for other controllers', () => {
    expect(smoothiePowerScaleWarning(smoothieProfile(1))).toBeNull();
    expect(smoothiePowerScaleWarning({ controllerKind: 'grbl-v1.1', maxPowerS: 1000 })).toBeNull();
  });
});
