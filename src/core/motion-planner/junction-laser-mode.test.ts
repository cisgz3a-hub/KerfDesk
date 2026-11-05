// Perf audit S1, S4-P3-3 (ADR-255 Amendment 3): GRBL 1.1 and grblHAL in
// laser mode run a G0 with axis words as laser motion, so a rapid/feed junction
// blends by junction deviation instead of stopping. Other controllers, CNC jobs
// and $32=0 keep the stop.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices/device-profile';
import { buildProgramDuration } from '../gcode-time/program-duration';
import {
  deviceMotionLimits,
  deviceProgramTimingOptions,
  deviceRunsRapidsAsLaserMotion,
} from '../gcode-time/program-timing-options';
import type { Block } from './block';
import { junctionVelocity } from './junction';

const along = (motion: 'rapid' | 'feed', laserModeMotion?: true): Block => ({
  kind: motion === 'rapid' ? 'travel' : 'cut',
  motion,
  distance: 10,
  targetVelocity: motion === 'rapid' ? 100 : 20,
  direction: { x: 1, y: 0 },
  ...(laserModeMotion === undefined ? {} : { laserModeMotion }),
});

// Fill rows that hop over other artwork: G1 S0 runway, G0 hop, G1 S0 runway.
function hoppingRows(rows: number): string {
  const lines = ['G21', 'G90', 'M4 S0', 'G0 X0 Y0', 'G1 F1200'];
  for (let row = 0; row < rows; row += 1) {
    const y = (row * 0.1).toFixed(3);
    lines.push(`G0 X0 Y${y}`, `G1 X10 S800`, `G1 X12 S0`, `G0 X30`, `G1 X32 S0`, `G1 X42 S800`);
  }
  lines.push('M5');
  return lines.join('\n');
}

describe('rapid/feed junctions (perf audit S4-P3-3)', () => {
  it('stop unless both moves are laser-mode motion', () => {
    expect(junctionVelocity(along('feed'), along('rapid'), 500, 0.01)).toBe(0);
    expect(junctionVelocity(along('feed', true), along('rapid'), 500, 0.01)).toBe(0);
    expect(junctionVelocity(along('feed', true), along('rapid', true), 500, 0.01)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('blend only for a GRBL 1.1 or grblHAL laser job with laser mode on', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true };
    expect(deviceRunsRapidsAsLaserMotion(device, 'laser', 'grbl-v1.1')).toBe(true);
    expect(deviceRunsRapidsAsLaserMotion(device, 'laser', 'grblhal')).toBe(true);
    expect(deviceRunsRapidsAsLaserMotion(device, 'cnc', 'grbl-v1.1')).toBe(false);
    expect(deviceRunsRapidsAsLaserMotion(device, 'laser', 'fluidnc')).toBe(false);
    expect(deviceRunsRapidsAsLaserMotion(device, 'laser', 'marlin')).toBe(false);
    expect(
      deviceRunsRapidsAsLaserMotion({ ...device, laserModeEnabled: false }, 'laser', 'grbl-v1.1'),
    ).toBe(false);
  });

  it('times hopping Fill rows without two stops per hop on GRBL in laser mode', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true };
    const gcode = hoppingRows(200);
    const time = (laserModeEnabled: boolean): number => {
      const profile = { ...device, laserModeEnabled };
      const result = buildProgramDuration(gcode, deviceMotionLimits(profile), {
        ...deviceProgramTimingOptions(profile, 'laser', 'grbl-v1.1'),
      });
      if (result.kind !== 'ok') throw new Error(result.kind);
      return result.duration.motionSeconds;
    };
    const blended = time(true);
    const stopped = time(false);
    // Each hop stopped twice: from 20 to 0 and back at the 500 mm/s² default
    // costs 2 × v/a = 0.08 s more per junction pair than a collinear blend.
    expect(blended).toBeLessThan(stopped - 200 * 2 * 0.03);
  });
});
