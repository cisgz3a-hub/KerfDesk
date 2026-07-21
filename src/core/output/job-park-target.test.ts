import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';
import { grblStrategy } from './grbl-strategy';
import { resolveJobParkTarget } from './job-park-target';

const dev = DEFAULT_DEVICE_PROFILE;

const laserJob: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'cut',
      color: '#ff0000',
      power: 50,
      speed: 600,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: false,
          polyline: [
            { x: 30, y: 30 },
            { x: 40, y: 30 },
            { x: 40, y: 40 },
          ],
        },
      ],
    },
  ],
};

function cncGroup(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1.5,
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 30 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
    ...overrides,
  };
}

describe('resolveJobParkTarget (laser)', () => {
  it('parks at work 0,0 for a dialect that parks at origin, matching the emitted postamble', () => {
    const park = resolveJobParkTarget(laserJob, dev, 'laser', undefined);

    expect(park).toEqual({ x: 0, y: 0 });
    const gcode = grblStrategy.emit(laserJob, dev);
    const lines = gcode.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toContain('G0 X0.000 Y0.000');
  });

  it('lets an explicit finish position win over the dialect default, matching emission', () => {
    const finish = { x: 12.5, y: 34 };
    const park = resolveJobParkTarget(laserJob, dev, 'laser', finish);

    expect(park).toEqual(finish);
    const gcode = grblStrategy.emit(laserJob, dev, { finishPosition: finish });
    const lines = gcode.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toContain('G0 X12.500 Y34.000');
  });

  it('resolves no park for a dialect that does not park at origin', () => {
    const noParkDev: DeviceProfile = {
      ...dev,
      gcodeDialect: { dialectId: 'neotronics-4040-safe' },
    };

    expect(resolveJobParkTarget(laserJob, noParkDev, 'laser', undefined)).toBeNull();
  });
});

describe('resolveJobParkTarget (cnc)', () => {
  it('lets the configured park position win, matching the emitted postamble', () => {
    const job: Job = { groups: [cncGroup({ parkXMm: 200, parkYMm: 5 })] };
    const park = resolveJobParkTarget(job, dev, 'cnc', { x: 50, y: 50 });

    expect(park).toEqual({ x: 200, y: 5 });
    const gcode = cncGrblStrategy.emit(job, dev, { finishPosition: { x: 50, y: 50 } });
    const lines = gcode.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toBe('G0 X200.000 Y5.000');
  });

  it('falls back to the finish position, then to work 0,0', () => {
    const job: Job = { groups: [cncGroup()] };

    expect(resolveJobParkTarget(job, dev, 'cnc', { x: 50, y: 60 })).toEqual({ x: 50, y: 60 });
    expect(resolveJobParkTarget(job, dev, 'cnc', undefined)).toEqual({ x: 0, y: 0 });
  });

  it('resolves no park for a CNC job with no CNC groups (nothing is emitted)', () => {
    expect(resolveJobParkTarget(laserJob, dev, 'cnc', undefined)).toBeNull();
  });
});
