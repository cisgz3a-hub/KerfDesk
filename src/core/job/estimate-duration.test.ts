import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Vec2 } from '../scene';
import { estimateJobDuration, formatDuration } from './estimate-duration';
import type { CutGroup, CutSegment, Job } from './job';

const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000 }; // 6000 mm/min = 100 mm/s

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

  it('a single 100 mm cut at 1000 mm/min takes 6 s; travel from origin + travel back', () => {
    // Cut: (0,0) → (100,0) at 1000 mm/min = 16.667 mm/s → 6 s
    // Travel out: origin → (0,0) = 0 mm → 0 s
    // Travel back: (100,0) → (0,0) = 100 mm at maxFeed 6000 mm/min = 100 mm/s → 1 s
    const j: Job = { groups: [group({ segments: [seg([0, 0], [100, 0])] })] };
    const r = estimateJobDuration(j, device);
    expect(r.breakdown.cutSeconds).toBeCloseTo(6, 3);
    expect(r.breakdown.travelSeconds).toBeCloseTo(1, 3);
    expect(r.totalSeconds).toBeCloseTo(7, 3);
  });

  it('doubling passes doubles the cut time, travel scales with the inter-segment count', () => {
    const oneSeg = seg([0, 0], [100, 0]);
    const onePass = estimateJobDuration({ groups: [group({ segments: [oneSeg] })] }, device);
    const twoPass = estimateJobDuration(
      { groups: [group({ segments: [oneSeg], passes: 2 })] },
      device,
    );
    // Cut doubles exactly.
    expect(twoPass.breakdown.cutSeconds).toBeCloseTo(onePass.breakdown.cutSeconds * 2, 3);
    // Travel trace for N passes through a single segment (0,0)→(100,0):
    //   pass 1 seek: origin → (0,0)        = 0 mm
    //   pass 2 seek: (100,0) → (0,0)       = 100 mm
    //   postamble:   (100,0) → origin      = 100 mm
    // Total = 200 mm at maxFeed 6000 mm/min (100 mm/s) = 2 s. (Not 3 — the
    // postamble doesn't double when passes do; it always runs once at end.)
    expect(twoPass.breakdown.travelSeconds).toBeCloseTo(2, 3);
  });

  it('accounts for travel between non-adjacent segments', () => {
    // Two 10 mm cuts 50 mm apart at 1000 mm/min cut, 6000 mm/min travel.
    // Cuts: 2 × 10 mm / 1000 mm/min × 60 = 1.2 s
    // Travel: origin→(0,0)=0 + (10,0)→(50,0)=40 + (60,0)→(0,0)=60 = 100 mm → 1 s
    const j: Job = {
      groups: [
        group({
          segments: [seg([0, 0], [10, 0]), seg([50, 0], [60, 0])],
        }),
      ],
    };
    const r = estimateJobDuration(j, device);
    expect(r.breakdown.cutSeconds).toBeCloseTo(1.2, 3);
    expect(r.breakdown.travelSeconds).toBeCloseTo(1, 3);
  });

  it('caps the per-group cut feed at device.maxFeed', () => {
    // Group asks for 12000 mm/min but device caps at 6000 → cut at 6000.
    // 100 mm / 6000 mm/min × 60 = 1 s.
    const fastDevice = { ...device, maxFeed: 6000 };
    const j: Job = {
      groups: [group({ speed: 12000, segments: [seg([0, 0], [100, 0])] })],
    };
    const r = estimateJobDuration(j, fastDevice);
    expect(r.breakdown.cutSeconds).toBeCloseTo(1, 3);
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

  it('property: scaling all coordinates by k scales the estimate by k', () => {
    // Cut time scales linearly with distance at fixed feed; travel time
    // also scales linearly. So 2x bigger geometry → 2x total time.
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 10, noNaN: true }),
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
          expect(scaledJob.totalSeconds).toBeCloseTo(base.totalSeconds * k, 3);
        },
      ),
      { numRuns: 30 },
    );
  });
});

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
