import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from './program-time';
import type { MotionLimits } from './motion-limits';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

describe('buildProgramTime', () => {
  it('times a long cut close to distance / feed, plus accel and decel', () => {
    // 100 mm at 600 mm/min = 10 mm/s → 10 s cruising, plus ramp overhead.
    const time = buildProgramTime(model('G21 G90\nM3 S1\nG1 X100 F600'), LIMITS);
    expect(time.motionSeconds).toBeGreaterThan(10);
    expect(time.motionSeconds).toBeLessThan(10.2);
  });

  it('accumulates monotonically and totals the segments', () => {
    const time = buildProgramTime(
      model(['G21 G90', 'M3 S1', 'G0 X10', 'G1 X60 F1200', 'G1 Y40', 'G0 X0 Y0'].join('\n')),
      LIMITS,
    );
    let previous = 0;
    for (const end of time.segTimeEndSec) {
      expect(end).toBeGreaterThanOrEqual(previous);
      previous = end;
    }
    const summed = [...time.segSeconds].reduce((total, value) => total + value, 0);
    expect(time.motionSeconds).toBeCloseTo(summed, 4);
    expect(previous).toBeCloseTo(time.motionSeconds, 4);
  });

  it('adds G4 dwell to the total but not to motion time', () => {
    const time = buildProgramTime(model('G21 G90\nM3 S1\nG1 X10 F600\nG4 P2.5'), LIMITS);
    expect(time.dwellSeconds).toBeCloseTo(2.5, 6);
    expect(time.totalSeconds).toBeCloseTo(time.motionSeconds + 2.5, 6);
  });

  it('flags moves that never sustain their programmed feed', () => {
    // Many tiny zig-zag moves: acceleration and cornering dominate.
    const zigzag = ['G21 G90', 'M3 S1'];
    for (let i = 1; i <= 20; i += 1) zigzag.push(`G1 X${i * 0.2} Y${i % 2} F3000`);
    const jagged = buildProgramTime(model(zigzag.join('\n')), LIMITS);
    expect([...jagged.segFeedLimited].filter((flag) => flag === 1).length).toBeGreaterThan(10);

    // One long straight move at a modest feed reaches and holds its target.
    const straight = buildProgramTime(model('G21 G90\nM3 S1\nG1 X200 F600'), LIMITS);
    expect(straight.segFeedLimited[0]).toBe(0);
  });

  it('is empty and finite for a program with no motion', () => {
    const time = buildProgramTime(model('G21 G90\nM3 S0\nM5'), LIMITS);
    expect(time.totalSeconds).toBe(0);
    expect(time.segSeconds.length).toBe(0);
  });

  it('never produces NaN or Infinity from degenerate limits', () => {
    const time = buildProgramTime(model('G21 G90\nM3 S1\nG1 X50 F600'), {
      accelMmPerSec2: 0,
      junctionDeviationMm: 0,
      maxFeedMmPerMin: 0,
    });
    expect(Number.isFinite(time.totalSeconds)).toBe(true);
    expect(time.totalSeconds).toBeGreaterThan(0);
  });
});
