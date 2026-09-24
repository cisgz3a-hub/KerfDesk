import { describe, expect, it } from 'vitest';
import { drillPeckPasses } from '../cnc/drill-peck';
import { planHelicalPocketPasses } from '../cnc/helical-entry';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { grblStrategy } from '../output/grbl-strategy';
import { estimateJobDuration } from './estimate-duration';
import type { CncGroup, CutGroup, Job } from './job';

const DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
  estimateCutTimeScale: 1,
  estimateTravelTimeScale: 1,
};

function square(at = 0, size = 1) {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

function cnc(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1200,
    plungeMmPerMin: 60,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 5,
    passes: [{ kind: 'contour', zMm: -1, polyline: square(), closed: true }],
    ...overrides,
  };
}

function vector(overrides: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#ff0000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
        ],
        closed: false,
      },
    ],
    ...overrides,
  };
}

describe('estimateJobDuration follows emitted CNC commands', () => {
  it('includes every feed descent and chip-clear return in a compiler-produced peck cycle', () => {
    const passes = drillPeckPasses([{ points: square(-2, 4), closed: true }], {
      depthMm: 10,
      depthPerPassMm: 1,
    });
    const job: Job = { groups: [cnc({ cutType: 'drill', passes, feedMmPerMin: 60 })] };
    const program = cncGrblStrategy.emit(job, DEVICE);
    const result = estimateJobDuration(job, DEVICE);

    expect(program).toContain('G1 X0.000 Y0.000 Z-1.000 F60');
    expect(program).toContain('G1 X0.000 Y0.000 Z-10.000');
    // 5 mm safe clearance + descending 1+...+10 mm + returning 1+...+9 mm
    // = 105 mm of G1 at 1 mm/s. G0 adds (5+15)/100 s; dwell adds 3 s.
    expect(result.unavailableReason).toBeUndefined();
    expect(result.totalSeconds).toBeGreaterThanOrEqual(105 + 0.2 + 3);
    expect(result.totalSeconds).toBeLessThan(109);
    // All 105 mm of G1 is cut time. The 45 mm of chip-clear returns are feed
    // moves with the tool still in the hole, so they are priced with the
    // descents, not as travel (drilling.test.ts pins the same rule).
    expect(result.breakdown.cutSeconds).toBeGreaterThanOrEqual(105);
    expect(result.breakdown.feedTravelSeconds ?? 0).toBe(0);
  });

  it('uses full XYZ distance and plunge feed for internal vertical path3d moves', () => {
    const job: Job = {
      groups: [
        cnc({
          passes: [
            {
              kind: 'path3d',
              closed: false,
              points: [
                { x: 0, y: 0, z: -1 },
                { x: 1, y: 0, z: -11 },
                { x: 1, y: 0, z: -1 },
              ],
            },
          ],
        }),
      ],
    };
    const program = cncGrblStrategy.emit(job, DEVICE);
    const result = estimateJobDuration(job, DEVICE);

    expect(program).toContain('G1 X1.000 Y0.000 Z-11.000 F1200');
    expect(program).toContain('G1 X1.000 Y0.000 Z-1.000 F60');
    // Entry is 6 mm at 1 mm/s; diagonal is sqrt(1²+10²) mm at 20 mm/s;
    // the vertical return is another 10 mm at 1 mm/s. The return is still a
    // feed move inside the material, so it is cut time too.
    expect(result.breakdown.cutSeconds).toBeGreaterThanOrEqual(6 + Math.sqrt(101) / 20 + 10);
    expect(result.breakdown.feedTravelSeconds ?? 0).toBe(0);
    expect(result.totalSeconds).toBeGreaterThanOrEqual(16 + Math.sqrt(101) / 20 + 3);
  });

  it('includes all helix revolutions at the emitted plunge feed and true arc length', () => {
    const planned = planHelicalPocketPasses([{ points: square(10, 10), closed: true }], [-5], {
      minDiameterMm: 2,
      maxDiameterMm: 2,
      angleDeg: 1,
    });
    if (!planned.ok) throw new Error(planned.reason);
    const pass = planned.passes[0];
    if (pass?.kind !== 'helical-contour') throw new Error('Expected a compiled helical entry');
    expect(pass.revolutions).toBe(46);
    const job: Job = { groups: [cnc({ cutType: 'pocket', passes: planned.passes })] };
    const program = cncGrblStrategy.emit(job, DEVICE);
    const result = estimateJobDuration(job, DEVICE);

    // Two half-circle arcs per revolution (GRBL 1.1h full-circle rounding).
    expect(program.match(/^G3 .*F60$/gm)).toHaveLength(92);
    // F60 is 1 mm/s. The true 3D helix is at least hypot(46*2π,5) mm;
    // integer output rounding of per-turn Z cannot shorten this uniform-slope
    // lower bound. Add 5 mm entry at F60 and the 40 mm contour at F1200.
    const feedFloorSeconds = Math.hypot(46 * 2 * Math.PI, 5) + 5 + 40 / 20;
    expect(result.unavailableReason).toBeUndefined();
    expect(result.breakdown.cutSeconds).toBeGreaterThanOrEqual(feedFloorSeconds - 1e-5);
    expect(result.totalSeconds).toBeGreaterThan(feedFloorSeconds + 3);
  });

  it('adds a changed deterministic spindle dwell without scaling or losing it', () => {
    const shortJob: Job = { groups: [cnc({ spindleSpinupSec: 3 })] };
    const longJob: Job = { groups: [cnc({ spindleSpinupSec: 33 })] };
    const short = estimateJobDuration(shortJob, DEVICE);
    const long = estimateJobDuration(longJob, DEVICE);

    expect(cncGrblStrategy.emit(longJob, DEVICE)).toContain('G4 P33.000');
    expect(short.breakdown.dwellSeconds).toBe(3);
    expect(long.breakdown.dwellSeconds).toBe(33);
    expect(long.totalSeconds - short.totalSeconds).toBeCloseTo(30, 8);
  });

  it('prices the extra replunges when retract-between-passes is enabled', () => {
    const passes = Array.from({ length: 10 }, (_, index) => ({
      kind: 'contour' as const,
      closed: true,
      zMm: -index - 1,
      polyline: square(),
    }));
    const steppedJob: Job = { groups: [cnc({ passes, retractBetweenPasses: false })] };
    const retractJob: Job = { groups: [cnc({ passes, retractBetweenPasses: true })] };
    const stepped = estimateJobDuration(steppedJob, DEVICE);
    const retracted = estimateJobDuration(retractJob, DEVICE);

    expect(cncGrblStrategy.emit(steppedJob, DEVICE).match(/^G0 Z5\.000$/gm)).toHaveLength(2);
    expect(cncGrblStrategy.emit(retractJob, DEVICE).match(/^G0 Z5\.000$/gm)).toHaveLength(11);
    // Stepping down feeds 5+10 mm. Re-entering from safe Z feeds
    // (5+1)+...+(5+10) = 105 mm, adding 90 seconds at 60 mm/min.
    expect(retracted.totalSeconds - stepped.totalSeconds).toBeGreaterThanOrEqual(90);
  });

  it('prices the configured CNC park even if an explicit null laser finish is supplied', () => {
    const nearJob: Job = { groups: [cnc({ parkXMm: 0, parkYMm: 0 })] };
    const farJob: Job = { groups: [cnc({ parkXMm: 300, parkYMm: 300 })] };
    const options = { finishPosition: null };
    const near = estimateJobDuration(nearJob, DEVICE, options);
    const far = estimateJobDuration(farJob, DEVICE, options);

    expect(cncGrblStrategy.emit(farJob, DEVICE, options)).toMatch(/G0 X300\.000 Y300\.000\n$/);
    // Additional final G0 covers sqrt(300²+300²) mm at at most 100 mm/s.
    expect(far.totalSeconds - near.totalSeconds).toBeGreaterThanOrEqual(Math.hypot(300, 300) / 100);
  });

  it('is independent of a laser-only travel setting when CNC output is unchanged', () => {
    const job: Job = {
      groups: [
        cnc({
          passes: [
            {
              kind: 'contour',
              zMm: -1,
              polyline: square(100, 10),
              closed: true,
            },
          ],
        }),
      ],
    };
    const laserControlled = { ...DEVICE, controlledLaserOffTravelFeedMmPerMin: 60 };

    expect(cncGrblStrategy.emit(job, laserControlled)).toBe(cncGrblStrategy.emit(job, DEVICE));
    expect(estimateJobDuration(job, laserControlled)).toEqual(estimateJobDuration(job, DEVICE));
  });
});

describe('estimateJobDuration follows emitted laser precision and motion', () => {
  it('times the whole-number feed sent to the controller rather than its fractional request', () => {
    const job: Job = {
      groups: [
        vector({
          speed: 1.49,
          segments: [
            {
              closed: false,
              polyline: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
              ],
            },
          ],
        }),
      ],
    };
    const result = estimateJobDuration(job, DEVICE, { finishPosition: null });

    expect(grblStrategy.emit(job, DEVICE)).toContain('G1 X1.000 Y0.000 F1 S500');
    // One millimetre at the emitted F1 takes 60 seconds, plus acceleration.
    expect(result.breakdown.cutSeconds).toBeGreaterThanOrEqual(60);
    expect(result.breakdown.cutSeconds).toBeLessThan(60.001);
    expect(result.breakdown.travelSeconds).toBe(0);
  });

  it('does not price a collapsed vector or its omitted approach as motion', () => {
    const job: Job = {
      groups: [
        vector({
          segments: [
            {
              closed: false,
              polyline: [
                { x: 300, y: 300 },
                { x: 300.0001, y: 300 },
              ],
            },
          ],
        }),
      ],
    };
    const result = estimateJobDuration(job, DEVICE);

    expect(grblStrategy.emit(job, DEVICE)).not.toContain('X300.000');
    expect(result.breakdown.cutSeconds).toBe(0);
    expect(result.breakdown.travelSeconds).toBe(0);
    // Sending the remaining modal setup still has serial cost.
    expect(result.totalSeconds).toBe(result.breakdown.transportSeconds);
  });

  it('classifies controlled G1 approaches as feed travel with continuous feed timing', () => {
    const profile = { ...DEVICE, controlledLaserOffTravelFeedMmPerMin: 1200 };
    const job: Job = { groups: [vector()] };
    const result = estimateJobDuration(job, profile);

    expect(grblStrategy.emit(job, profile)).not.toMatch(/^G0 /m);
    expect(result.breakdown.rapidTravelSeconds).toBe(0);
    expect(result.breakdown.feedTravelSeconds).toBeGreaterThan(1.5);
    // 0→10 (S0)→20 (powered) blends into one 20 mm move, then returns
    // 20 mm after M5. At 20 mm/s and 1000 mm/s² each takes 1 + .02 s.
    expect(result.breakdown.cutSeconds + result.breakdown.travelSeconds).toBeCloseTo(2.04, 6);
  });
});
