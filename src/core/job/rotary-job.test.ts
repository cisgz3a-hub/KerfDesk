import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../devices';
import type { CutGroup, Job } from './job';
import { machineSpaceJob, rotaryAppliesTo, rotaryWrapLimitMm } from './rotary-job';

function lineJob(): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 10, y: 0 },
          { x: 10, y: 50 },
        ],
      },
    ],
  };
  return { groups: [group] };
}

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

function firstPolylineY(job: Job): number[] {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected cut group');
  return (group.segments[0]?.polyline ?? []).map((p) => p.y);
}

describe('machineSpaceJob (R3 single source of truth)', () => {
  it('is identity when no rotary is active', () => {
    const job = lineJob();
    expect(machineSpaceJob(job, DEFAULT_DEVICE_PROFILE, undefined)).toBe(job);
    expect(rotaryAppliesTo(DEFAULT_DEVICE_PROFILE, undefined)).toBe(false);
    expect(rotaryWrapLimitMm(DEFAULT_DEVICE_PROFILE, undefined)).toBeNull();
  });

  it('scales and rebases Y under a chuck rotary — the same transform emit uses', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK };
    const scaled = machineSpaceJob(lineJob(), device, undefined);
    const ys = firstPolylineY(scaled);
    const scale = 360 / (Math.PI * 60);
    // Y extent 0..50 → rebased 0..(50*scale). Frame, estimate, .rd, and emit
    // all call this, so they measure the same motion.
    expect(ys[0]).toBeCloseTo(0, 6);
    expect(ys[1]).toBeCloseTo(50 * scale, 6);
    expect(rotaryWrapLimitMm(device, undefined)).toBeCloseTo(360, 6);
  });

  it('does not apply to CNC projects', () => {
    const device = { ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK };
    const machine = { kind: 'cnc' } as never;
    expect(rotaryAppliesTo(device, machine)).toBe(false);
    expect(machineSpaceJob(lineJob(), device, machine)).toEqual(lineJob());
  });

  it('reverseAxis mirrors Y within the wrap window (un-mirrors the engraving)', () => {
    const scale = 360 / (Math.PI * 60);
    const extent = 50 * scale;
    const forward = firstPolylineY(
      machineSpaceJob(lineJob(), { ...DEFAULT_DEVICE_PROFILE, rotary: CHUCK }, undefined),
    );
    const reversed = firstPolylineY(
      machineSpaceJob(
        lineJob(),
        { ...DEFAULT_DEVICE_PROFILE, rotary: { ...CHUCK, reverseAxis: true } },
        undefined,
      ),
    );
    // Forward 0→extent becomes extent→0; same [0,extent] window, opposite order.
    expect(forward[0]).toBeCloseTo(0, 6);
    expect(forward[1]).toBeCloseTo(extent, 6);
    expect(reversed[0]).toBeCloseTo(extent, 6);
    expect(reversed[1]).toBeCloseTo(0, 6);
    // Wrap limit is unchanged by direction.
    expect(
      rotaryWrapLimitMm(
        { ...DEFAULT_DEVICE_PROFILE, rotary: { ...CHUCK, reverseAxis: true } },
        undefined,
      ),
    ).toBeCloseTo(360, 6);
  });

  it('reverseAxis on a roller (scale 1) still mirrors — not identity', () => {
    const roller = {
      enabled: true,
      type: 'roller',
      mmPerRotation: 360,
      objectDiameterMm: 200,
      reverseAxis: true,
    } as const;
    const ys = firstPolylineY(
      machineSpaceJob(lineJob(), { ...DEFAULT_DEVICE_PROFILE, rotary: roller }, undefined),
    );
    // Roller scale 1, extent 50: forward 0..50 → reversed 50..0.
    expect(ys[0]).toBeCloseTo(50, 6);
    expect(ys[1]).toBeCloseTo(0, 6);
  });
});
