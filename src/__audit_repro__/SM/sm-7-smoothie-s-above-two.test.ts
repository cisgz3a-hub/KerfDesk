// Audit SM-7 repro: Smoothieware cannot store an S word of 2 or more, but the
// Smoothieware strategy emits S up to the profile's maxPowerS (for example
// S0-S255 or S0-S100) and the setup guide says only "match
// laser_module_maximum_s_value to the profile".
//
// Correct behaviour: every G1 power KerfDesk emits for Smoothieware must reach
// the laser at the requested fraction of full power. Upstream stores the modal S
// of each planned block in a 12-bit field as 1.11 fixed point, so only
// 0 <= S < 2 survives; a profile with maxPowerS >= 2 must be refused or
// corrected at setup (keep laser_module_maximum_s_value below 2, e.g. 1.0).
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - Block.h L81: `uint16_t s_value:12; // for laser 1.11 Fixed point`
// - Planner.cpp L81: `block->s_value = roundf(s_value*(1<<11)); // 1.11 fixed point`
// - Laser.cpp L246: `requested_power = ((float)block->s_value / (1 << 11)) / this->laser_maximum_s_value;`
// - Robot.cpp L1034 / L1466: the raw G-code S is what reaches the planner.
// Storing S*2048 in 12 bits keeps only its low 12 bits (S=50 -> 102400 -> 0;
// S=255 -> 522240 -> 2048). Above S=32 the float-to-integer conversion is also
// out of range, so no stored value can be relied on.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Block.h#L81
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Planner.cpp#L81
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L246
// The Smoothieware docs (https://smoothieware.org/laser.html) list "S0-S255 range
// (common in laser software)" as a laser_module_maximum_s_value choice, so
// operators do configure it. The repo's smoothie-laser-power-model.ts omits the
// 12-bit storage, so the simulator oracle cannot show this.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import { smoothiewareStrategy } from '../../core/output/smoothieware-strategy';

const JOB: Job = {
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

/** Planner::append_block + Laser::get_laser_power for one block's S word. */
function firedFraction(s: number, maximumS: number): number {
  const stored = (Math.round(s * 2048) >>> 0) & 0xfff; // uint16_t s_value:12
  return stored / 2048 / maximumS;
}

function burnPowers(gcode: string): number[] {
  return gcode
    .split('\n')
    .filter((line) => /^G1\b/.test(line))
    .map((line) => /\bS(\d+(?:\.\d+)?)/.exec(line)?.[1])
    .filter((text): text is string => text !== undefined)
    .map(Number)
    .filter((s) => s > 0);
}

describe('SM-7: Smoothieware S words of 2 or more', () => {
  it.each([100, 255])(
    'a 50%% cut on a maxPowerS=%i profile fires at 50%% (or the profile is refused)',
    (maxPowerS) => {
      const device: DeviceProfile = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: 'smoothieware',
        maxPowerS,
      };
      let gcode: string;
      try {
        gcode = smoothiewareStrategy.emit(JOB, device);
      } catch {
        return; // refusing the unrepresentable range is also correct
      }
      const powers = burnPowers(gcode);
      expect(powers.length).toBeGreaterThan(0);
      // Fails today: S50 (max 100) fires at 0 and S127.5 (max 255) at ~0.2%.
      for (const s of powers) {
        expect(firedFraction(s, maxPowerS), `S${s}`).toBeCloseTo(0.5, 3);
      }
    },
  );

  it('the default fractional profile (maxPowerS=1) fires exactly', () => {
    const device: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'smoothieware',
      maxPowerS: 1,
    };
    for (const s of burnPowers(smoothiewareStrategy.emit(JOB, device))) {
      expect(firedFraction(s, 1)).toBeCloseTo(0.5, 3);
    }
  });
});
