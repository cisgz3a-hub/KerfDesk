import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import type { CncGroup, Job } from '../../../core/job';
import { detectParkOutsideFrameWarnings } from './park-outside-frame-warnings';

const dev = DEFAULT_DEVICE_PROFILE;

// Cut motion spans X/Y 30..40: work 0,0 (the default GRBL park) is outside it.
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

describe('detectParkOutsideFrameWarnings (laser)', () => {
  it('warns with the park coordinates when the final rapid exits the framed outline', () => {
    const warnings = detectParkOutsideFrameWarnings(laserJob, dev, 'laser', undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('X 0');
    expect(warnings[0]).toContain('Y 0');
    expect(warnings[0]).toContain('outside the framed outline');
  });

  it('names the finish position when a current-position job finishes outside the outline', () => {
    const warnings = detectParkOutsideFrameWarnings(laserJob, dev, 'laser', { x: 120, y: 80.5 });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('X 120');
    expect(warnings[0]).toContain('Y 80.5');
  });

  it('stays silent when the park target lies inside the framed motion bounds', () => {
    expect(detectParkOutsideFrameWarnings(laserJob, dev, 'laser', { x: 35, y: 35 })).toEqual([]);
    // The framed outline itself counts as inside — parking on the boundary
    // never leaves the traced envelope.
    expect(detectParkOutsideFrameWarnings(laserJob, dev, 'laser', { x: 30, y: 30 })).toEqual([]);
  });

  it('stays silent when the dialect emits no park move at all', () => {
    const noParkDev: DeviceProfile = {
      ...dev,
      gcodeDialect: { dialectId: 'neotronics-4040-safe' },
    };

    expect(detectParkOutsideFrameWarnings(laserJob, noParkDev, 'laser', undefined)).toEqual([]);
  });

  it('stays silent for a job with no motion at all', () => {
    expect(detectParkOutsideFrameWarnings({ groups: [] }, dev, 'laser', undefined)).toEqual([]);
  });
});

describe('detectParkOutsideFrameWarnings (cnc)', () => {
  it('warns when the resolved CNC park target lies outside the motion bounds', () => {
    const job: Job = { groups: [cncGroup({ parkXMm: 200, parkYMm: 5 })] };
    const warnings = detectParkOutsideFrameWarnings(job, dev, 'cnc', undefined);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('X 200');
    expect(warnings[0]).toContain('Y 5');
    expect(warnings[0]).toContain('outside the framed outline');
  });

  it('warns for the default work-0,0 park when the passes sit away from work zero', () => {
    const warnings = detectParkOutsideFrameWarnings(
      { groups: [cncGroup()] },
      dev,
      'cnc',
      undefined,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('X 0');
  });

  it('stays silent when the configured park position is inside the motion bounds', () => {
    const job: Job = { groups: [cncGroup({ parkXMm: 15, parkYMm: 15 })] };

    expect(detectParkOutsideFrameWarnings(job, dev, 'cnc', undefined)).toEqual([]);
  });
});
