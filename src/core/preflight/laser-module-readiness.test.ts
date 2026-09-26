// Controller audit SM-3/SM-2: what the Smoothieware M221 laser report means for
// laser output. Without the module test Fire is refused (nothing answers
// `fire`), a laser job gets a Job Review warning and a program without `fire
// off` (ADR-397); a build without M221 P is a Job Review warning for
// constant-power (M3 -> `M221 S100 P1`) output.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { Job } from '../job';
import { smoothiewareStrategy } from '../output/smoothieware-strategy';
import {
  CONSTANT_POWER_UNSUPPORTED_MESSAGE,
  constantPowerModeWarning,
  LASER_MODULE_ABSENT_JOB_WARNING,
  LASER_MODULE_ABSENT_MESSAGE,
  laserFireRefusal,
  laserModuleAbsentJobWarning,
  programForLaserModule,
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

describe('a board without the Laser module', () => {
  it('refuses test Fire and warns for a laser job only when the module is absent', () => {
    expect(laserFireRefusal(ABSENT)).toBe(LASER_MODULE_ABSENT_MESSAGE);
    expect(laserModuleAbsentJobWarning(ABSENT)).toBe(LASER_MODULE_ABSENT_JOB_WARNING);
    for (const evidence of [PRE_2021, EDGE, null]) {
      expect(laserFireRefusal(evidence)).toBeNull();
      expect(laserModuleAbsentJobWarning(evidence)).toBeNull();
    }
  });

  it('streams the program without its `fire off`, which nothing would answer', () => {
    const program = smoothieOutput('dynamic');
    expect(program.split('\n')[0]).toBe('fire off');
    const streamed = programForLaserModule(program, ABSENT);
    expect(streamed.split('\n')).not.toContain('fire off');
    expect(streamed).toBe(program.split('\n').slice(1).join('\n'));
    expect(programForLaserModule(program, EDGE)).toBe(program);
    expect(programForLaserModule(program, null)).toBe(program);
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
