import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { buildGcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from '../gcode-time/program-time';
import { estimateJobDuration } from './estimate-duration';
import type { CncGroup, Job } from './job';

const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, accelMmPerSec2: 100 };

function group(extra: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'cnc',
    color: '#000000',
    cutType: 'profile-on-path',
    toolId: 'a',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 120,
    spindleRpm: 12000,
    spindleSpinupSec: 3.4567,
    safeZMm: 0,
    passes: [
      {
        kind: 'contour',
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        closed: false,
        zMm: 0,
      },
    ],
    ...extra,
  };
}

function emittedDwells(job: Job): number[] {
  return cncGrblStrategy
    .emit(job, device)
    .split('\n')
    .filter((line) => line.startsWith('G4 P'))
    .map((line) => Number(line.slice(4)));
}

describe('CNC fixed spindle-start duration', () => {
  it.each([
    ['initial start', [group()], [3.457]],
    [
      'unchanged spindle despite a changed delay',
      [group(), group({ spindleSpinupSec: 20 })],
      [3.457],
    ],
    ['RPM restart', [group(), group({ spindleRpm: 10000, spindleSpinupSec: 2 })], [3.457, 2]],
    [
      'tool change at the same RPM',
      [group(), group({ toolId: 'b', spindleSpinupSec: 4 })],
      [3.457, 4],
    ],
    [
      'returning to a prior tool',
      [group(), group({ toolId: 'b', spindleSpinupSec: 4 }), group({ spindleSpinupSec: 2 })],
      [3.457, 4, 2],
    ],
    [
      'RPM values that emit the same rounded S word',
      [group(), group({ spindleRpm: 12000.1, spindleSpinupSec: 2 })],
      [3.457, 2],
    ],
    ['empty CNC groups that still emit spindle start', [group({ passes: [] })], [3.457]],
    ['zero delay', [group({ spindleSpinupSec: 0 })], []],
    ['a positive delay rounded to zero in G-code', [group({ spindleSpinupSec: 0.0004 })], [0]],
    ['no CNC program', [], []],
  ] as const)('counts exactly the emitted dwells for %s', (_name, groups, expected) => {
    const job: Job = { groups };
    expect(emittedDwells(job)).toEqual(expected);
    const seconds = expected.reduce<number>((total, value) => total + value, 0);
    const estimate = estimateJobDuration(job, device);
    expect(estimate.breakdown.dwellSeconds).toBeCloseTo(seconds, 9);
    expect(estimate.totalSeconds).toBeCloseTo(
      estimate.breakdown.cutSeconds + estimate.breakdown.travelSeconds + seconds,
      9,
    );
  });

  it('adds represented spin-up seconds without scaling fixed dwell or manual tool-change time', () => {
    const groups = [group(), group({ toolId: 'b', spindleSpinupSec: 2.3456 })];
    const job: Job = { groups };
    const noDwell: Job = { groups: groups.map((item) => ({ ...item, spindleSpinupSec: 0 })) };
    const calibrated = { ...device, estimateCutTimeScale: 3, estimateTravelTimeScale: 2 };
    const baseline = estimateJobDuration(noDwell, calibrated);
    const withDwell = estimateJobDuration(job, calibrated);

    expect(cncGrblStrategy.emit(job, device)).toContain('\nM0\n');
    expect(withDwell.breakdown.dwellSeconds).toBeCloseTo(5.803, 9);
    expect(withDwell.totalSeconds - baseline.totalSeconds).toBeCloseTo(5.803, 9);
    expect(withDwell.breakdown.cutSeconds).toBe(baseline.breakdown.cutSeconds);
    expect(withDwell.breakdown.travelSeconds).toBe(baseline.breakdown.travelSeconds);
  });
});

describe('CNC Z-motion accounting', () => {
  it.each([
    ['RPM restart with dwell', 10000, 3, 6.4],
    ['unchanged RPM', 12000, 3, 3 + Math.sqrt(0.08)],
    ['RPM restart without dwell', 10000, 0, 3.4],
    ['unchanged represented S without dwell', 12000.1, 0, 3 + Math.sqrt(0.08)],
  ] as const)('retains exact planner drains for %s', (_name, rpm, spinup, expected) => {
    const first = group({
      feedMmPerMin: 6000,
      spindleSpinupSec: 3,
      passes: [
        {
          kind: 'contour',
          zMm: 0,
          closed: false,
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ],
    });
    const second = {
      ...first,
      spindleRpm: rpm,
      spindleSpinupSec: spinup,
      passes: [
        {
          kind: 'contour' as const,
          zMm: 0,
          closed: false,
          polyline: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ],
    };
    const job = { groups: [first, second] };
    const options = { finishPosition: { x: 2, y: 0 } };
    const parsed = buildGcodeRenderModel(cncGrblStrategy.emit(job, device, options));
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const emitted = buildProgramTime(parsed.model, {
      accelMmPerSec2: 100,
      junctionDeviationMm: device.junctionDeviationMm,
      maxFeedMmPerMin: 6000,
    });
    const estimate = estimateJobDuration(job, device, options);
    expect(emitted.totalSeconds).toBeCloseTo(expected, 9);
    expect(estimate.totalSeconds).toBeCloseTo(emitted.totalSeconds, 9);
  });

  it('places analytic plunge in cut and retract in rapid travel using the existing distances', () => {
    const flat = group({ spindleSpinupSec: 0 });
    const deep = { ...flat, safeZMm: 5, passes: flat.passes.map((pass) => ({ ...pass, zMm: -1 })) };
    const baseline = estimateJobDuration({ groups: [flat] }, device);
    const actual = estimateJobDuration({ groups: [deep] }, device);
    // Both paths retain the same XY plan. Existing Z terms cover 6 mm each:
    // plunge at 120 mm/min = 3 s; G0 retract at 6000 mm/min = 0.06 s.
    expect(actual.breakdown.cutSeconds - baseline.breakdown.cutSeconds).toBeCloseTo(3, 9);
    expect(
      (actual.breakdown.rapidTravelSeconds ?? 0) - (baseline.breakdown.rapidTravelSeconds ?? 0),
    ).toBeCloseTo(0.06, 9);
    expect(actual.breakdown.feedTravelSeconds).toBe(0);

    const calibrated = estimateJobDuration(
      { groups: [deep] },
      { ...device, estimateCutTimeScale: 3, estimateTravelTimeScale: 2 },
    );
    expect(calibrated.breakdown.cutSeconds).toBeCloseTo(actual.breakdown.cutSeconds * 3, 9);
    expect(calibrated.breakdown.rapidTravelSeconds).toBeCloseTo(
      (actual.breakdown.rapidTravelSeconds ?? 0) * 2,
      9,
    );
  });

  it('does not apply a retained laser controlled-seek setting to CNC G0 travel', () => {
    const job: Job = { groups: [group()] };
    const laserProfile = { ...device, controlledLaserOffTravelFeedMmPerMin: 600 };
    expect(cncGrblStrategy.emit(job, laserProfile)).toBe(cncGrblStrategy.emit(job, device));
    expect(estimateJobDuration(job, laserProfile)).toEqual(estimateJobDuration(job, device));
  });
});
