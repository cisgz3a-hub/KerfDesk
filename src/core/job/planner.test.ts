import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CutGroup, CutSegment, Job } from './job';
import { estimateWithPlanner, junctionVelocity, blockTime } from './planner';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000, // 100 mm/s travel
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

function seg(...pts: Array<[number, number]>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

function group(opts: Partial<CutGroup> & { segments: ReadonlyArray<CutSegment> }): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000, // 16.667 mm/s cut
    passes: 1,
    airAssist: false,
    ...opts,
  };
}

describe('estimateWithPlanner — basics', () => {
  it('returns 0 for an empty job', () => {
    expect(estimateWithPlanner({ groups: [] }, device).totalSeconds).toBe(0);
  });

  it('a straight 100 mm cut + travel back matches the trapezoidal v2 result', () => {
    // Pure straight line, no junctions to slow at.
    //   cut: 100 mm at 16.667 mm/s, accel from rest, decel to rest.
    //     trapezoid: dAccel = 0.139 mm; trapezoidal time ≈ 6.017 s
    //   travel: 100 mm at 100 mm/s, accel from rest, decel to rest.
    //     dAccel = 5 mm; trapezoidal time = 1.1 s
    const j: Job = { groups: [group({ segments: [seg([0, 0], [100, 0])] })] };
    const r = estimateWithPlanner(j, device);
    expect(r.breakdown.cutSeconds).toBeCloseTo(6.017, 2);
    expect(r.breakdown.travelSeconds).toBeCloseTo(1.1, 2);
  });

  it('a 101-vertex straight line is the same as a 2-vertex one (junctions are all 0°)', () => {
    // Adding waypoints along a straight line introduces blocks but
    // their junction angles are all 0 → junction velocity infinite →
    // capped at target → indistinguishable from one big block. Use
    // 101 vertices so the 100 1-mm sub-blocks cover the same total
    // 100 mm as the two-vertex version.
    const oneBlock: Job = { groups: [group({ segments: [seg([0, 0], [100, 0])] })] };
    const manyBlocks: Job = {
      groups: [
        group({
          segments: [
            {
              polyline: Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 })),
              closed: false,
            },
          ],
        }),
      ],
    };
    const a = estimateWithPlanner(oneBlock, device);
    const b = estimateWithPlanner(manyBlocks, device);
    expect(b.totalSeconds).toBeCloseTo(a.totalSeconds, 2);
  });

  it('a sharp zigzag takes longer than a straight cut of the same TOTAL distance', () => {
    // Compare two paths with identical cut distance (100 mm) and
    // identical end point (0,0) → identical travel-back. The zigzag
    // has 9 sharp corners that force decel/accel cycles; the
    // straight has none. Junction-deviation planner must produce a
    // strictly longer estimate for the zigzag.
    const N = 10;
    const stepX = 100 / N; // 10 mm
    const zig: Array<[number, number]> = [];
    for (let i = 0; i <= N; i += 1) {
      zig.push([i * stepX, i % 2 === 0 ? 0 : 1]); // zigzag amplitude 1mm
    }
    // Note: zigzag total distance is slightly > 100 mm (10·√101 ≈ 100.5),
    // not exactly 100, but the difference is <0.5%. Real effect is
    // the corner-deceleration cost, which dominates by ≥10×.
    const zigzag: Job = { groups: [group({ segments: [seg(...zig)] })] };
    const straight: Job = {
      groups: [group({ segments: [seg([0, 0], [100, 0])] })],
    };
    const zigT = estimateWithPlanner(zigzag, device);
    const strT = estimateWithPlanner(straight, device);
    expect(zigT.breakdown.cutSeconds).toBeGreaterThan(strT.breakdown.cutSeconds);
  });

  it('a fully-reversed direction (180°) forces a full stop', () => {
    // (0,0)→(50,0)→(0,0) — head must stop, reverse direction, accel back.
    const j: Job = {
      groups: [group({ segments: [seg([0, 0], [50, 0], [0, 0])] })],
    };
    const r = estimateWithPlanner(j, device);
    // Two 50mm cuts each starting/ending at rest:
    //   dAccel = 0.139; trapezoidal time = 2·0.0167 + (50-0.278)/16.667 ≈ 3.017s
    //   2 cuts × 3.017 = 6.033s cut
    // Plus travel: origin→origin (0) + (0,0)→origin (0) = 0
    // Hmm both endpoints are origin. Travel = 0.
    expect(r.breakdown.cutSeconds).toBeCloseTo(6.033, 1);
  });

  it('many-vertex curve (approximated circle) takes longer than circumference / target feed', () => {
    // 64-vertex octogonal approximation of a 50mm-radius circle.
    // Naive (one-move) estimate: 2πr / cutFeed = 314.16 / 16.667 ≈ 18.85 s
    // Planner-aware should be measurably longer due to cornering.
    const r = 50;
    const N = 64;
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= N; i += 1) {
      const a = (i / N) * 2 * Math.PI;
      points.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const j: Job = { groups: [group({ segments: [seg(...points)] })] };
    const result = estimateWithPlanner(j, device);
    // Naive bound: cut distance / target velocity, ignoring all overhead.
    const naiveSeconds = (2 * Math.PI * r) / 16.667;
    expect(result.breakdown.cutSeconds).toBeGreaterThan(naiveSeconds);
  });

  it('multi-pass scales cut time near-linearly (planner is per-pass deterministic)', () => {
    const oneSeg = seg([0, 0], [100, 0]);
    const one = estimateWithPlanner({ groups: [group({ segments: [oneSeg] })] }, device);
    const three = estimateWithPlanner(
      { groups: [group({ segments: [oneSeg], passes: 3 })] },
      device,
    );
    expect(three.breakdown.cutSeconds).toBeCloseTo(one.breakdown.cutSeconds * 3, 2);
  });
});

describe('junctionVelocity', () => {
  const accel = 1000;
  const jd = 0.01;
  const cutBlock = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    return {
      kind: 'cut' as const,
      distance: len,
      targetVelocity: 100,
      direction: { x: dx / len, y: dy / len },
    };
  };

  it('returns Infinity for a perfectly straight transition (0° turn)', () => {
    expect(junctionVelocity(cutBlock(1, 0), cutBlock(1, 0), accel, jd)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('returns 0 for a full reversal (180° turn)', () => {
    expect(junctionVelocity(cutBlock(1, 0), cutBlock(-1, 0), accel, jd)).toBe(0);
  });

  it('returns a finite, positive velocity for a 90° turn', () => {
    const v = junctionVelocity(cutBlock(1, 0), cutBlock(0, 1), accel, jd);
    expect(v).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
    // 90° formula: sin(45°) = √2/2 ≈ 0.707
    // v = √(1000 · 0.01 · 0.707 / (1 − 0.707)) = √(24.16) ≈ 4.92 mm/s
    expect(v).toBeCloseTo(4.92, 1);
  });

  it('returns 0 for a junction across cut/travel boundary (laser on/off transition)', () => {
    const travel = { ...cutBlock(1, 0), kind: 'travel' as const };
    expect(junctionVelocity(cutBlock(1, 0), travel, accel, jd)).toBe(0);
  });
});

describe('blockTime', () => {
  const accel = 1000;
  const block = (distance: number, vTarget: number) => ({
    kind: 'cut' as const,
    distance,
    targetVelocity: vTarget,
    direction: { x: 1, y: 0 },
  });

  it('rest-to-rest trapezoid (long block, hits target)', () => {
    // 100 mm at v_target=100 mm/s, accel=1000, entry=exit=0
    //   dAccel = 100²/2000 = 5 mm each side, cruise = 90 mm
    //   time = 0.1 + 0.9 + 0.1 = 1.1 s
    expect(blockTime(block(100, 100), 0, 0, accel)).toBeCloseTo(1.1, 3);
  });

  it('rest-to-rest triangle (short block, never hits target)', () => {
    // 4 mm at v_target=100 mm/s, accel=1000, entry=exit=0
    //   would need 10 mm to reach target → triangle
    //   v_peak = √(0 + 0 + 2·1000·4)/√2 ... actually:
    //   v_peakSq = (0+0)/2 + 1000·4 = 4000; v_peak = 63.25 mm/s
    //   t = 2·63.25/1000 = 0.1265 s
    expect(blockTime(block(4, 100), 0, 0, accel)).toBeCloseTo(0.1265, 3);
  });

  it('cruising-to-cruising (entry = exit = target) is just d/v', () => {
    // No accel/decel — perfectly straight cruise. 100mm at 100 mm/s = 1.0 s
    expect(blockTime(block(100, 100), 100, 100, accel)).toBeCloseTo(1.0, 3);
  });

  it('zero-distance returns zero', () => {
    expect(blockTime(block(0, 100), 0, 0, accel)).toBe(0);
  });
});
