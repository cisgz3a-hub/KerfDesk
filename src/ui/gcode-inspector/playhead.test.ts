import { describe, expect, it } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { playheadAtTime, secondsAtLine } from './playhead';

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

function timed(text: string): {
  readonly model: GcodeRenderModel;
  readonly segTimeEndSec: Float32Array;
  readonly motionSeconds: number;
} {
  const built = model(text);
  const time = buildProgramTime(built, LIMITS);
  return { model: built, segTimeEndSec: time.segTimeEndSec, motionSeconds: time.motionSeconds };
}

// Three 10 mm moves: travel to (10,0), cut to (20,0), cut to (20,10).
const PROGRAM = ['G21 G90', 'M3 S1', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'G1 X20 Y10'].join('\n');

describe('playheadAtTime', () => {
  it('interpolates within the active segment rather than snapping', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    // Halfway through the second segment's time span.
    const firstEnd = segTimeEndSec[0] ?? 0;
    const secondEnd = segTimeEndSec[1] ?? 0;
    const mid = firstEnd + (secondEnd - firstEnd) / 2;
    const state = playheadAtTime(built, segTimeEndSec, mid);
    expect(state.segmentIndex).toBe(1);
    expect(state.segmentFraction).toBeCloseTo(0.5, 3);
    // Segment 1 runs X10 → X20 at Y0, so mid-time lands between the ends.
    expect(state.point?.x).toBeGreaterThan(10);
    expect(state.point?.x).toBeLessThan(20);
    expect(state.point?.y).toBeCloseTo(0, 6);
  });

  it('clamps below zero and beyond the program end', () => {
    const { model: built, segTimeEndSec, motionSeconds } = timed(PROGRAM);
    const start = playheadAtTime(built, segTimeEndSec, -5);
    expect(start.routeMm).toBe(0);
    expect(start.point?.x).toBeCloseTo(0, 6);

    const end = playheadAtTime(built, segTimeEndSec, 9999);
    expect(end.routeMm).toBeCloseTo(motionSeconds, 6);
    expect(end.segmentIndex).toBe(2);
    expect(end.point?.x).toBeCloseTo(20, 6);
    expect(end.point?.y).toBeCloseTo(10, 6);
  });

  it('reports no point for a motionless program', () => {
    const { model: built, segTimeEndSec } = timed('G21 G90\nM3 S0\nM5');
    const state = playheadAtTime(built, segTimeEndSec, 5);
    expect(state.segmentIndex).toBe(-1);
    expect(state.point).toBeNull();
  });

  it('advances monotonically through the program', () => {
    const { model: built, segTimeEndSec, motionSeconds } = timed(PROGRAM);
    let previousIndex = -1;
    for (let step = 0; step <= 10; step += 1) {
      const state = playheadAtTime(built, segTimeEndSec, (motionSeconds * step) / 10);
      expect(state.segmentIndex).toBeGreaterThanOrEqual(previousIndex);
      previousIndex = state.segmentIndex;
    }
  });
});

describe('secondsAtLine', () => {
  it('returns the moment a line’s motion begins', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    expect(secondsAtLine(built, segTimeEndSec, 2)).toBe(0);
    expect(secondsAtLine(built, segTimeEndSec, 3)).toBeCloseTo(segTimeEndSec[0] ?? 0, 6);
    expect(secondsAtLine(built, segTimeEndSec, 4)).toBeCloseTo(segTimeEndSec[1] ?? 0, 6);
  });

  it('returns null for a line that produced no motion', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    expect(secondsAtLine(built, segTimeEndSec, 0)).toBeNull();
  });
});
