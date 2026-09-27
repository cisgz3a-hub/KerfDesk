// ADR-483 (LightBurn gap LBG-M02): the laser finish position is placed on the
// prepared job once, and finishOptionsForJob is the one reader.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../scene';
import { finishOptionsForJob } from '../output/output-strategy';
import type { Job } from './job';
import { placeLaserFinish } from './laser-finish';

const JOB: Job = { groups: [] };
const FRONT_LEFT: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  origin: 'front-left',
  bedWidth: 400,
  bedHeight: 300,
};
const CURRENT = {
  startFrom: 'current-position' as const,
  anchor: 'center' as const,
  currentPosition: { x: 12, y: 34 },
};

function withFinish(finish: DeviceProfile['laserFinishPosition']): DeviceProfile {
  return { ...FRONT_LEFT, laserFinishPosition: finish };
}

describe('placeLaserFinish', () => {
  it('returns the very same job when no finish is configured', () => {
    expect(placeLaserFinish(JOB, FRONT_LEFT, undefined, { x: 0, y: 0 })).toBe(JOB);
    expect(placeLaserFinish(JOB, FRONT_LEFT, undefined, null)).toBe(JOB);
  });

  it('records stay whatever the translation', () => {
    const device = withFinish({ kind: 'stay' });
    expect(placeLaserFinish(JOB, device, undefined, null).laserFinish).toEqual({ kind: 'stay' });
  });

  it('moves a canvas point into machine then program coordinates', () => {
    const device = withFinish({ kind: 'bed', xMm: 25, yMm: 0 });
    // Canvas Y 0 is the back edge: machine Y is the bed height on a front-left origin.
    expect(placeLaserFinish(JOB, device, undefined, { x: 0, y: 0 }).laserFinish).toEqual({
      kind: 'point',
      x: 25,
      y: 300,
    });
    expect(placeLaserFinish(JOB, device, undefined, { x: -58, y: -168 }).laserFinish).toEqual({
      kind: 'point',
      x: -33,
      y: 132,
    });
  });

  it('sets a bed finish aside when the translation is unknown, never reading it as program', () => {
    const device = withFinish({ kind: 'bed', xMm: 25, yMm: 0 });
    expect(placeLaserFinish(JOB, device, undefined, null).laserFinish).toEqual({
      kind: 'set-aside',
      reason: 'unplaced',
    });
  });

  it('sets a bed finish aside while the rotary is on', () => {
    const device: DeviceProfile = {
      ...withFinish({ kind: 'bed', xMm: 25, yMm: 0 }),
      rotary: { enabled: true, type: 'roller', mmPerRotation: 100, objectDiameterMm: 50 },
    };
    expect(placeLaserFinish(JOB, device, undefined, { x: 0, y: 0 }).laserFinish).toEqual({
      kind: 'set-aside',
      reason: 'rotary',
    });
  });

  it('leaves CNC jobs to their own park', () => {
    const device = withFinish({ kind: 'stay' });
    expect(placeLaserFinish(JOB, device, DEFAULT_CNC_MACHINE_CONFIG, { x: 0, y: 0 })).toBe(JOB);
  });
});

describe('finishOptionsForJob', () => {
  it('keeps the placement default for a job without a placed finish', () => {
    expect(finishOptionsForJob(JOB, undefined)).toEqual({});
    expect(finishOptionsForJob(JOB, CURRENT)).toEqual({ finishPosition: { x: 12, y: 34 } });
    const setAside: Job = { groups: [], laserFinish: { kind: 'set-aside', reason: 'unplaced' } };
    expect(finishOptionsForJob(setAside, CURRENT)).toEqual({ finishPosition: { x: 12, y: 34 } });
  });

  it('omits the park for stay, even for a Current Position job', () => {
    const stay: Job = { groups: [], laserFinish: { kind: 'stay' } };
    expect(finishOptionsForJob(stay, CURRENT)).toEqual({ finishPosition: null });
    expect(finishOptionsForJob(stay, undefined)).toEqual({ finishPosition: null });
  });

  it('parks at a placed point in every mode', () => {
    const point: Job = { groups: [], laserFinish: { kind: 'point', x: 5, y: 6 } };
    expect(finishOptionsForJob(point, CURRENT)).toEqual({ finishPosition: { x: 5, y: 6 } });
    expect(finishOptionsForJob(point, undefined)).toEqual({ finishPosition: { x: 5, y: 6 } });
  });
});
