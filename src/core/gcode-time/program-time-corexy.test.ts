// ADR-675 (rolling audit v6 K3-P2-2): grblHAL's CoreXY limits each motor, so a
// diagonal move gets $120 / √2 and $110 / √2. Cartesian timing is unchanged.

import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from './program-time';
import type { MotionLimits } from './motion-limits';

const CARTESIAN: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};
const COREXY: MotionLimits = { ...CARTESIAN, kinematics: 'corexy' };

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

describe('CoreXY program time', () => {
  it('times a move along an axis exactly as on a Cartesian machine', () => {
    for (const move of ['G1 X100 F3000', 'G1 Y60 F3000', 'G1 X40 F3000\nG1 X90']) {
      const program = model(`G21 G90\nM3 S1\n${move}`);
      expect(buildProgramTime(program, COREXY).motionSeconds).toBe(
        buildProgramTime(program, CARTESIAN).motionSeconds,
      );
    }
  });

  it('takes a square corner slower, as grblHAL plans it in motor space', () => {
    // From +X to +Y the junction vector drives one motor: a / √2 with a
    // junction deviation √2 shorter in head millimetres.
    const program = model('G21 G90\nM3 S1\nG1 X100 F3000\nG1 Y60');
    const coreXy = buildProgramTime(program, COREXY);
    const cartesian = buildProgramTime(program, CARTESIAN);
    expect(coreXy.motionSeconds).toBeGreaterThan(cartesian.motionSeconds);
    expect(coreXy.segExitVelocityMmPerSec[0]).toBeLessThan(
      cartesian.segExitVelocityMmPerSec[0] ?? 0,
    );
  });

  it('caps a diagonal at the per-motor rate and acceleration', () => {
    // 141.4 mm at F6000. Cartesian plans 100 mm/s at 500 mm/s²: 0.2 s ramps
    // over 10 mm each and 1.21 s cruising. CoreXY tops out at 70.7 mm/s with
    // 353.6 mm/s²: 0.2 s ramps over 7.07 mm each and 1.8 s cruising.
    const program = model('G21 G90\nM3 S1\nG1 X100 Y100 F6000');
    expect(buildProgramTime(program, CARTESIAN).motionSeconds).toBeCloseTo(1.614, 3);
    const coreXy = buildProgramTime(program, COREXY);
    expect(coreXy.motionSeconds).toBeCloseTo(2.2, 3);
    expect(coreXy.segTargetVelocityMmPerSec[0]).toBeCloseTo(100 / Math.SQRT2, 3);
    expect(coreXy.segAccelMmPerSec2[0]).toBeCloseTo(500 / Math.SQRT2, 9);
  });

  it('never plans a CoreXY move faster than the Cartesian estimate', () => {
    const program = model(
      ['G21 G90', 'M3 S1', 'G1 X20 Y5 F2400', 'G1 X35 Y30', 'G1 X10 Y40', 'G0 X0 Y0'].join('\n'),
    );
    expect(buildProgramTime(program, COREXY).motionSeconds).toBeGreaterThan(
      buildProgramTime(program, CARTESIAN).motionSeconds,
    );
  });
});
