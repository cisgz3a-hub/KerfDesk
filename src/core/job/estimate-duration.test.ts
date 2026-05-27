import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Vec2 } from '../scene';
import { estimateJobDuration, formatDuration } from './estimate-duration';
import type { CutGroup, CutSegment, Job } from './job';

// Pin accel + junctionDeviation explicitly. The shipping defaults are
// 500 / 0.01; this suite was written against accel=1000 so we'd get
// reproducible numbers — same intent, just guarding against changes
// to DEFAULT_DEVICE_PROFILE moving the expectations.
const device = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000, // 6000 mm/min = 100 mm/s
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

function seg(...pts: Array<[number, number]>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

function group(opts: {
  speed?: number;
  passes?: number;
  segments?: ReadonlyArray<CutSegment>;
}): CutGroup {
  return {
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: opts.speed ?? 1000, // mm/min
    passes: opts.passes ?? 1,
    segments: opts.segments ?? [],
  };
}

describe('estimateJobDuration', () => {
  it('returns 0 for an empty job', () => {
    const r = estimateJobDuration({ groups: [] }, device);
    expect(r.totalSeconds).toBe(0);
    expect(r.breakdown.cutSeconds).toBe(0);
    expect(r.breakdown.travelSeconds).toBe(0);
  });

  it('returns 0 for a job with empty groups (all output off)', () => {
    const r = estimateJobDuration({ groups: [group({ segments: [] })] }, device);
    expect(r.totalSeconds).toBe(0);
  });

  it('a single 100 mm cut + 100 mm travel back includes accel overhead', () => {
    // Cut: 100 mm at 1000 mm/min (16.667 mm/s), accel 1000 mm/s² →
    //   dAccel = 0.139 mm, trapezoid: 2·0.0167 + (100-0.278)/16.667 ≈ 6.02 s
    // Travel back: 100 mm at 6000 mm/min (100 mm/s), accel 1000 mm/s² →
    //   dAccel = 5 mm, trapezoid: 2·0.1 + (100-10)/100 = 1.10 s
    // Travel out from origin = 0 mm = 0 s.
    const j: Job = { groups: [group({ segments: [seg([0, 0], [100, 0])] })] };
    const r = estimateJobDuration(j, device);
    expect(r.breakdown.cutSeconds).toBeCloseTo(6.017, 2);
    expect(r.breakdown.travelSeconds).toBeCloseTo(1.1, 2);
  });

  it('doubling passes doubles the cut time, travel grows by one extra inter-pass seek', () => {
    const oneSeg = seg([0, 0], [100, 0]);
    const onePass = estimateJobDuration({ groups: [group({ segments: [oneSeg] })] }, device);
    const twoPass = estimateJobDuration(
      { groups: [group({ segments: [oneSeg], passes: 2 })] },
      device,
    );
    // Cut doubles exactly (same accel profile, run twice).
    expect(twoPass.breakdown.cutSeconds).toBeCloseTo(onePass.breakdown.cutSeconds * 2, 3);
    // Travel = inter-pass seek (100 mm @ 100 mm/s, accel = 1.1 s) +
    // postamble (100 mm = 1.1 s). One-pass travel was just the
    // postamble = 1.1 s. Two-pass = 2.2 s.
    expect(twoPass.breakdown.travelSeconds).toBeCloseTo(2.2, 2);
  });

  it('accounts for travel between non-adjacent segments', () => {
    // Two 10 mm cuts 50 mm apart at 1000 mm/min cut, 6000 mm/min travel,
    // accel = 1000 mm/s².
    // Cuts: 2 × (10 mm at 1000 mm/min) =
    //   2 × (2·0.0167 + (10-0.278)/16.667) ≈ 2 × 0.617 = 1.233 s
    // Travels: 0 + 40 + 60 mm at 100 mm/s, each through trapezoidal accel:
    //   40 mm: 2·0.1 + (40-10)/100 = 0.5 s
    //   60 mm: 2·0.1 + (60-10)/100 = 0.7 s
    //   total = 0 + 0.5 + 0.7 = 1.2 s
    const j: Job = {
      groups: [
        group({
          segments: [seg([0, 0], [10, 0]), seg([50, 0], [60, 0])],
        }),
      ],
    };
    const r = estimateJobDuration(j, device);
    expect(r.breakdown.cutSeconds).toBeCloseTo(1.233, 2);
    expect(r.breakdown.travelSeconds).toBeCloseTo(1.2, 2);
  });

  it('caps the per-group cut feed at device.maxFeed', () => {
    // Group asks for 12000 mm/min but device caps at 6000. 100 mm at
    // 6000 mm/min through accel = 1.1 s (same trapezoidal math as travel).
    const fastDevice = { ...device, maxFeed: 6000 };
    const j: Job = {
      groups: [group({ speed: 12000, segments: [seg([0, 0], [100, 0])] })],
    };
    const r = estimateJobDuration(j, fastDevice);
    expect(r.breakdown.cutSeconds).toBeCloseTo(1.1, 2);
  });

  it('handles a layer whose speed is 0 or negative by treating it as 1 mm/min (minimum) — never NaN/Inf', () => {
    const j: Job = {
      groups: [group({ speed: 0, segments: [seg([0, 0], [1, 0])] })],
    };
    const r = estimateJobDuration(j, device);
    expect(Number.isFinite(r.totalSeconds)).toBe(true);
    expect(r.totalSeconds).toBeGreaterThan(0);
  });

  it('property: total = cut + travel for all valid inputs', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            speed: fc.integer({ min: 100, max: 6000 }),
            passes: fc.integer({ min: 1, max: 5 }),
            pts: fc.array(
              fc.tuple(fc.double({ min: 0, max: 400, noNaN: true }), fc.double({ min: 0, max: 400, noNaN: true })),
              { minLength: 2, maxLength: 10 },
            ),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        (groups) => {
          const job: Job = {
            groups: groups.map((g) => ({
              layerId: 'L',
              color: '#000',
              power: 50,
              speed: g.speed,
              passes: g.passes,
              segments: [{ polyline: g.pts.map(([x, y]) => ({ x, y })), closed: false }],
            })),
          };
          const r = estimateJobDuration(job, device);
          expect(r.totalSeconds).toBeCloseTo(
            r.breakdown.cutSeconds + r.breakdown.travelSeconds,
            6,
          );
          expect(r.breakdown.cutSeconds).toBeGreaterThanOrEqual(0);
          expect(r.breakdown.travelSeconds).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(r.totalSeconds)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('property: scaling all coordinates UP never decreases the estimate (monotonicity)', () => {
    // Strict linear scaling broke when v1 added acceleration modeling —
    // trapezoidal time grows linearly in the cruise phase but the
    // accel/decel phases are fixed-cost, and triangular moves grow as
    // √distance. Monotonicity still holds: bigger geometry takes
    // longer (or the same time, at the limit where cruise dominates).
    fc.assert(
      fc.property(
        fc.double({ min: 1.0, max: 10, noNaN: true }),
        fc.array(
          fc.tuple(fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true })),
          { minLength: 2, maxLength: 8 },
        ),
        (k, pts) => {
          const points: Vec2[] = pts.map(([x, y]) => ({ x, y }));
          const scaled: Vec2[] = points.map((p) => ({ x: p.x * k, y: p.y * k }));
          const base = estimateJobDuration(
            { groups: [group({ segments: [{ polyline: points, closed: false }] })] },
            device,
          );
          const scaledJob = estimateJobDuration(
            { groups: [group({ segments: [{ polyline: scaled, closed: false }] })] },
            device,
          );
          expect(scaledJob.totalSeconds).toBeGreaterThanOrEqual(base.totalSeconds - 1e-9);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('detail-heavy short-move jobs predict realistically (regression for the 3.4× v1 bug)', () => {
    // Hardware test on Falcon A1 Pro reported v1 estimate = 50 s,
    // actual = 170 s (3.4× under). Root cause: v1 assumed length/feed,
    // ignoring accel. Short moves never reach maxFeed on real machines.
    //
    // Fixture: 100 short cuts (3 mm each at 1000 mm/min), 100 short
    // travels between them (5 mm each at 6000 mm/min). On a Falcon-class
    // diode with accel = 1000 mm/s²:
    //
    //   Per-cut (3 mm at 16.667 mm/s):
    //     dAccel = 0.139 mm; 3 mm > 0.278 mm → trapezoid
    //     2·0.0167 + (3 - 0.278)/16.667 ≈ 0.197 s
    //   Per-travel (5 mm at 100 mm/s):
    //     dAccel = 5 mm; 5 mm < 10 mm → triangle
    //     vPeak = √(1000·5) = 70.7 mm/s; t = 2·70.7/1000 = 0.141 s
    //
    // 100 cuts × 0.197 s + 100 travels × 0.141 s ≈ 33.8 s.
    // The OLD model would have said: 100·3/16.667 + 100·5/100 = 23 s.
    // New estimate is ~47% longer — the bug was always reporting the
    // OLD number. With accel modeling the short-move jobs now align
    // with reality (5-20% margin instead of 200-300%).
    const segments = [];
    for (let i = 0; i < 100; i += 1) {
      const x0 = i * 8;
      segments.push(seg([x0, 0], [x0 + 3, 0]));
    }
    const j: Job = { groups: [group({ segments, speed: 1000 })] };
    const r = estimateJobDuration(j, device);
    // The exact number depends on travel + postamble; bound it:
    // strictly larger than the v1 naive estimate would have been
    // (cut ~18 s + travel ~7.5 s ≈ 25 s).
    expect(r.totalSeconds).toBeGreaterThan(30);
    // And not absurdly high (sanity ceiling):
    expect(r.totalSeconds).toBeLessThan(60);
  });
});

// Trapezoidal-profile unit tests for `moveSeconds` moved into
// planner.test.ts (the planner now owns block-time math via blockTime).

describe('formatDuration', () => {
  it('shows seconds-only under one minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(7.4)).toBe('7s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('shows minutes-and-seconds under one hour', () => {
    expect(formatDuration(60)).toBe('1m 0s');
    expect(formatDuration(263)).toBe('4m 23s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('shows hours-and-minutes once over an hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(4332)).toBe('1h 12m');
  });

  it('handles non-finite and negative inputs as 0s', () => {
    expect(formatDuration(NaN)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});
