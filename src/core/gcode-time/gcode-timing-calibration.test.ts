import { describe, expect, it } from 'vitest';
import {
  buildGcodeTimingPlan,
  plannedProgressAtRoute,
  plannedProgressAtSendableLine,
  type GcodeTimingPlan,
} from './gcode-timing-plan';
import type { ProgramTimeCalibration } from './program-time';
import type { MachineKind } from '../scene/machine';

const LIMITS = {
  accelMmPerSec2: 50,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};
const ORIGIN = { x: 0, y: 0, z: 0 };
const LASER_PROGRAM = [
  'G21 G90',
  'M4 S0',
  'G0 X10',
  'G1 X20 F600 S0',
  'G1 X120 F600 S500',
  'G4 P4',
  'G1 X220 F600 S500',
  'M5',
  'G0 X0',
].join('\n');

function timingPlan(
  gcode: string,
  timeCalibration?: ProgramTimeCalibration,
  machineKind: MachineKind = 'laser',
): GcodeTimingPlan {
  const result = buildGcodeTimingPlan(gcode, LIMITS, ORIGIN, {
    machineKind,
    ...(timeCalibration === undefined ? {} : { timeCalibration }),
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.plan;
}

describe('emitted-program motion calibration', () => {
  it.each([
    { cutTimeScale: 2, travelTimeScale: 3 },
    { cutTimeScale: 0.25, travelTimeScale: 0.5 },
  ])('calibrates every laser route and line clock with %j', (calibration) => {
    const baseline = timingPlan(LASER_PROGRAM);
    const calibrated = timingPlan(LASER_PROGRAM, calibration);
    const factors = [
      calibration.travelTimeScale,
      calibration.travelTimeScale,
      calibration.cutTimeScale,
      calibration.cutTimeScale,
      calibration.travelTimeScale,
    ];
    expectCalibratedSegments(baseline, calibrated, factors);
    expect(calibrated.dwellSeconds).toBe(4);
    expect(calibrated.totalSeconds).toBeCloseTo(calibrated.motionSeconds + 4, 8);
    expect(plannedProgressAtSendableLine(calibrated, 6).dwellSeconds).toBe(4);
    expect(plannedProgressAtSendableLine(calibrated, 9).totalSeconds).toBe(calibrated.totalSeconds);
  });

  it('applies cut calibration to CNC plunge and travel calibration to rapid retract', () => {
    const gcode = [
      'G21 G90',
      'G0 Z5',
      'G0 Z2',
      'M3 S12000',
      'G4 P3',
      'G1 Z-1 F300',
      'G1 X20 F600',
      'G0 Z5',
      'M5',
      'G0 X0',
    ].join('\n');
    const baseline = timingPlan(gcode, undefined, 'cnc');
    const calibrated = timingPlan(gcode, { cutTimeScale: 2, travelTimeScale: 3 }, 'cnc');
    expectCalibratedSegments(baseline, calibrated, [3, 3, 2, 2, 3, 3]);
    expect(calibrated.dwellSeconds).toBe(3);
  });

  it.each([
    { cutTimeScale: Number.NaN, travelTimeScale: -2 },
    { cutTimeScale: Number.POSITIVE_INFINITY, travelTimeScale: 6 },
  ])('preserves the baseline for invalid calibration %j', (calibration) => {
    expect(timingPlan(LASER_PROGRAM, calibration)).toEqual(timingPlan(LASER_PROGRAM));
  });
});

function expectCalibratedSegments(
  baseline: GcodeTimingPlan,
  calibrated: GcodeTimingPlan,
  factors: ReadonlyArray<number>,
): void {
  expect(calibrated.segmentRawLine).toEqual(baseline.segmentRawLine);
  expect(calibrated.routeEndMm).toEqual(baseline.routeEndMm);
  expect(calibrated.segmentTargetVelocityMmPerSec).toEqual(baseline.segmentTargetVelocityMmPerSec);
  expect(calibrated.segmentEntryVelocityMmPerSec).toEqual(baseline.segmentEntryVelocityMmPerSec);
  expect(calibrated.segmentExitVelocityMmPerSec).toEqual(baseline.segmentExitVelocityMmPerSec);
  expect(calibrated.segmentRawLine).toHaveLength(factors.length);
  let expectedMotion = 0;
  factors.forEach((factor, index) => {
    const baseStart = baseline.plannedMotionStartSeconds[index] ?? 0;
    const baseEnd = baseline.plannedMotionEndSeconds[index] ?? 0;
    const calibratedStart = calibrated.plannedMotionStartSeconds[index] ?? 0;
    const routeStart = baseline.routeStartMm[index] ?? 0;
    const routeEnd = baseline.routeEndMm[index] ?? 0;
    const halfway = routeStart + (routeEnd - routeStart) / 2;
    const baseProgress = plannedProgressAtRoute(baseline, halfway);
    const progress = plannedProgressAtRoute(calibrated, halfway);
    expect(progress.motionSeconds - calibratedStart).toBeCloseTo(
      (baseProgress.motionSeconds - baseStart) * factor,
      5,
    );
    expect(progress.dwellSeconds).toBeCloseTo(baseProgress.dwellSeconds, 8);
    expectedMotion += (baseEnd - baseStart) * factor;
    expect(calibrated.plannedMotionEndSeconds[index]).toBeCloseTo(expectedMotion, 5);
    const rawLine = calibrated.segmentRawLine[index] ?? 0;
    expect(calibrated.rawLineMotionEndSeconds[rawLine]).toBeCloseTo(expectedMotion, 5);
    expect(plannedProgressAtSendableLine(calibrated, rawLine + 1).motionSeconds).toBeCloseTo(
      expectedMotion,
      5,
    );
  });
  expect(calibrated.motionSeconds).toBeCloseTo(expectedMotion, 5);
}
