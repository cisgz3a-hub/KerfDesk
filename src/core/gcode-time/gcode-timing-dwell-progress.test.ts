import { describe, expect, it } from 'vitest';
import {
  buildGcodeTimingPlan,
  plannedProgressAtRoute,
  type GcodeTimingPlan,
  type GcodeTimingPlanOptions,
} from './gcode-timing-plan';

const LIMITS = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

function plan(source: string, options: GcodeTimingPlanOptions = {}): GcodeTimingPlan {
  const result = buildGcodeTimingPlan(source, LIMITS, undefined, options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.plan;
}

describe('route-confirmed dwell progress', () => {
  it.each([
    ['first raw line', 'G4 P4 G1 X60 F600', 'G4 P4\nG1 X60 F600', 30, 4],
    ['motion word first', 'G1 X60 F600 G4 P4', 'G4 P4\nG1 X60 F600', 30, 4],
    [
      'after earlier motion and dwell',
      'G4 P2\nG1 X10 F600\nG4 P4 G1 X60',
      'G4 P2\nG1 X10 F600\nG4 P4\nG1 X60',
      30,
      6,
    ],
    ['pure Z', 'G4 P4 G1 Z60 F600', 'G4 P4\nG1 Z60 F600', 30, 4],
    [
      'arc chords',
      'G1 X10 F600\nG4 P4 G3 X0 Y10 I-10 J0',
      'G1 X10 F600\nG4 P4\nG3 X0 Y10 I-10 J0',
      20,
      4,
    ],
  ])('counts the completed same-block dwell for %s', (_name, combined, split, route, dwell) => {
    const actual = plan(combined);
    const separate = plan(split);
    const progress = plannedProgressAtRoute(actual, route);
    const reference = plannedProgressAtRoute(separate, route);
    expect(progress.dwellSeconds).toBe(dwell);
    expect(progress.motionSeconds).toBeCloseTo(reference.motionSeconds, 9);
    expect(progress.totalSeconds).toBeCloseTo(reference.totalSeconds, 9);
    expect(actual.totalSeconds).toBeCloseTo(separate.totalSeconds, 9);
  });

  it('does not infer a leading, future or trailing dwell from a stationary route boundary', () => {
    const timing = plan('G4 P2 G1 X10 F600\nG4 P4 G1 X20\nG4 P8');
    expect(plannedProgressAtRoute(timing, 0).dwellSeconds).toBe(0);
    expect(plannedProgressAtRoute(timing, 5).dwellSeconds).toBe(2);
    expect(plannedProgressAtRoute(timing, 10).dwellSeconds).toBe(2);
    expect(plannedProgressAtRoute(timing, 10.001).dwellSeconds).toBe(6);
    expect(plannedProgressAtRoute(timing, 20).dwellSeconds).toBe(6);
    expect(timing.dwellSeconds).toBe(14);
  });

  it('keeps standalone dwells and dwell-only programs dependent on later physical movement', () => {
    const timing = plan('G1 X10 F600\nG4 P4\nG1 X20\nG4 P8');
    expect(plannedProgressAtRoute(timing, 10).dwellSeconds).toBe(0);
    expect(plannedProgressAtRoute(timing, 15).dwellSeconds).toBe(4);
    expect(plannedProgressAtRoute(timing, 20).dwellSeconds).toBe(4);
    expect(plannedProgressAtRoute(plan('G4 P4'), 0).dwellSeconds).toBe(0);
  });

  it('keeps same-block dwell separate from motion calibration and serial delivery', () => {
    const source = 'M4 S100\nG4 P4 G1 X60 F600\nG4 P8';
    const baseline = plan(source, { baudRate: 100 });
    const calibrated = plan(source, { baudRate: 100, cutTimeScale: 2 });
    const progress = plannedProgressAtRoute(calibrated, 30);
    const unscaled = plannedProgressAtRoute(baseline, 30);
    expect(progress.dwellSeconds).toBe(4);
    expect(progress.motionSeconds).toBeCloseTo(unscaled.motionSeconds * 2, 9);
    expect(progress.transportSeconds).toBeGreaterThan(0);
    expect(progress.transportSeconds).toBe(unscaled.transportSeconds);
    expect(progress.totalSeconds).toBeCloseTo(
      progress.motionSeconds + 4 + (progress.transportSeconds ?? 0),
      9,
    );
  });

  it('does not admit after-plunge canned-cycle dwells into the strict route timeline', () => {
    expect(buildGcodeTimingPlan('G82 X1 Z-1 R1 P2 F100', LIMITS)).toEqual({
      kind: 'unavailable',
      reason: 'Timing-unknown canned-cycle at raw line 1.',
    });
  });
});
