import { describe, expect, it } from 'vitest';
import { blockTime, junctionVelocity, planVelocities } from './index';

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

  it('stops at rapid/feed boundaries but keeps laser-off feed motion continuous', () => {
    const rapid = { ...cutBlock(1, 0), kind: 'travel' as const, motion: 'rapid' as const };
    const blankFeed = { ...cutBlock(1, 0), kind: 'travel' as const, motion: 'feed' as const };

    expect(junctionVelocity(cutBlock(1, 0), rapid, accel, jd)).toBe(0);
    expect(junctionVelocity(cutBlock(1, 0), blankFeed, accel, jd)).toBe(Number.POSITIVE_INFINITY);
  });

  it('carries feed only through tagged, feed-matched full-runway laser transitions', () => {
    const taggedCut = { ...cutBlock(1, 0), feedMatchedLaserMotion: true as const };
    const taggedTravel = {
      ...cutBlock(1, 0),
      kind: 'travel' as const,
      feedMatchedLaserMotion: true as const,
    };

    expect(junctionVelocity(taggedTravel, taggedCut, accel, jd)).toBe(Number.POSITIVE_INFINITY);
    expect(junctionVelocity(taggedCut, taggedTravel, accel, jd)).toBe(Number.POSITIVE_INFINITY);
    expect(junctionVelocity(taggedTravel, { ...taggedCut, targetVelocity: 50 }, accel, jd)).toBe(0);
    expect(
      junctionVelocity(taggedTravel, { ...taggedCut, direction: { x: -1, y: 0 } }, accel, jd),
    ).toBe(0);

    const corner = junctionVelocity(
      taggedTravel,
      { ...taggedCut, direction: { x: 0, y: 1 } },
      accel,
      jd,
    );
    expect(corner).toBeGreaterThan(0);
    expect(Number.isFinite(corner)).toBe(true);
  });

  it('rises monotonically as the turn opens from a reversal toward straight', () => {
    // The cornering cap must FALL as a turn sharpens toward a reversal and
    // RISE as it opens toward straight. The prior √((1 − cosθ)/2) form had
    // this inverted — gentle turns were throttled to ~0 while near-reversals
    // were let through near full speed. The 0°/90°/180° endpoints it was
    // tested against all agree with the correct formula, so only a mid-range
    // ordering check catches the regression.
    const gentle = junctionVelocity(cutBlock(1, 0), cutBlock(1, 0.1), accel, jd); // ~6° turn
    const ninety = junctionVelocity(cutBlock(1, 0), cutBlock(0, 1), accel, jd); // 90° turn
    const sharp = junctionVelocity(cutBlock(1, 0), cutBlock(-1, 0.1), accel, jd); // ~169° turn
    expect(gentle).toBeGreaterThan(ninety);
    expect(ninety).toBeGreaterThan(sharp);
    expect(sharp).toBeGreaterThan(0);
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

describe('planVelocities — GCO-06 junction clamp to both target speeds', () => {
  const accel = 1000;
  const jd = 0.01;
  const cut = (distance: number, targetVelocity: number) => ({
    kind: 'cut' as const,
    distance,
    targetVelocity,
    direction: { x: 1, y: 0 }, // collinear → straight junction (vJunction = ∞)
  });

  // Regression: a slow block abutting a collinear faster block used to inherit
  // an exit velocity ABOVE its own target (the junction cap omitted
  // prev.targetVelocity), which made blockTime's decel leg negative and shaved
  // time off the estimate. Every block's entry/exit must stay within its target.
  it('never plans an entry or exit above the block’s own target speed', () => {
    const blocks = [cut(10, 5), cut(10, 100), cut(10, 20)]; // slow → fast → medium
    const plan = planVelocities(blocks, accel, jd);

    const EPS = 1e-9;
    plan.forEach((p, i) => {
      const target = blocks[i]?.targetVelocity ?? 0;
      expect(p.entryV).toBeLessThanOrEqual(target + EPS);
      expect(p.exitV).toBeLessThanOrEqual(target + EPS);
    });
  });

  it('keeps every block time non-negative across mixed-speed junctions', () => {
    const blocks = [cut(10, 5), cut(10, 100)];
    const plan = planVelocities(blocks, accel, jd);

    plan.forEach((p, i) => {
      const b = blocks[i];
      if (b === undefined) return;
      expect(blockTime(b, p.entryV, p.exitV, accel)).toBeGreaterThanOrEqual(0);
    });
  });
});
