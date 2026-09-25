// Controller audit SM-3/SM-2: what the Smoothieware M221 laser report means for
// laser output. The absent module is a factual refusal; a build without M221 P
// is a Job Review warning for constant-power (M3 -> `M221 S100 P1`) output.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { Job } from '../job';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import {
  CONSTANT_POWER_UNSUPPORTED_MESSAGE,
  constantPowerModeWarning,
  LASER_MODULE_ABSENT_MESSAGE,
  laserOutputRefusal,
} from './laser-module-readiness';

const ABSENT = { module: 'absent', constantPowerMode: null } as const;
const PRE_2021 = { module: 'loaded', constantPowerMode: false } as const;
const EDGE = { module: 'loaded', constantPowerMode: true } as const;

function smoothieOutput(cutPowerMode: 'constant' | 'dynamic'): string {
  const job: Job = {
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
  const device: DeviceProfile = {
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'smoothieware',
    maxPowerS: 1,
    gcodeDialect: { dialectId: cutPowerMode === 'constant' ? 'grbl-compatible' : 'grbl-dynamic' },
  };
  return smoothiewareStrategy.emit(job, device);
}

describe('laserOutputRefusal', () => {
  it('refuses laser output only when the module is absent', () => {
    expect(laserOutputRefusal(ABSENT)).toBe(LASER_MODULE_ABSENT_MESSAGE);
    expect(laserOutputRefusal(PRE_2021)).toBeNull();
    expect(laserOutputRefusal(EDGE)).toBeNull();
    expect(laserOutputRefusal(null)).toBeNull();
  });
});

describe('constantPowerModeWarning', () => {
  it('warns for constant-power output on a build without M221 P', () => {
    const constant = smoothieOutput('constant');
    expect(constant).toContain('M221 S100 P1');
    expect(constantPowerModeWarning(constant, PRE_2021)).toBe(CONSTANT_POWER_UNSUPPORTED_MESSAGE);
  });

  it('stays silent for speed-proportional output, current builds and unknown evidence', () => {
    const dynamic = smoothieOutput('dynamic');
    expect(dynamic).toContain('M221 S100 P0');
    expect(constantPowerModeWarning(dynamic, PRE_2021)).toBeNull();
    const constant = smoothieOutput('constant');
    expect(constantPowerModeWarning(constant, EDGE)).toBeNull();
    expect(constantPowerModeWarning(constant, ABSENT)).toBeNull();
    expect(constantPowerModeWarning(constant, null)).toBeNull();
  });
});
