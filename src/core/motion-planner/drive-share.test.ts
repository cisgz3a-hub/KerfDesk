// ADR-675 (rolling audit v6 K3-P2-2): how a per-axis or per-motor limit
// reaches a move.

import { describe, expect, it } from 'vitest';
import { busiestDriveShare, busiestDriveShareAtAngle } from './drive-share';
import { blockAcceleration, junctionPlanningLimits, plannedDriveShare } from './planner-kinematics';

// grblHAL's CoreXY planner, done the long way: the head move turned into motor
// steps (A = X + Y, B = X - Y, corexy.c), the planner's unit vector over those,
// min a / |u_i| (planner.c), then back to head millimetres per second².
function coreXyAccelFromMotorSpace(accel: number, angleDeg: number): number {
  const rad = (angleDeg * Math.PI) / 180;
  const head = { x: Math.cos(rad), y: Math.sin(rad) };
  const motor = [head.x + head.y, head.x - head.y];
  const motorLength = Math.hypot(...motor);
  const unit = motor.map((value) => value / motorLength);
  const motorAccel = Math.min(
    ...unit.filter((value) => value !== 0).map((value) => accel / Math.abs(value)),
  );
  return motorAccel / motorLength; // one head millimetre is motorLength motor millimetres
}

describe('busiestDriveShare', () => {
  it('is 1 along an axis in both layouts', () => {
    for (const kinematics of ['cartesian', 'corexy'] as const) {
      expect(busiestDriveShareAtAngle(kinematics, 0)).toBe(1);
      expect(busiestDriveShareAtAngle(kinematics, 90)).toBeCloseTo(1, 12);
      expect(busiestDriveShare(kinematics, { x: 0, y: 0, z: 1 })).toBe(1);
    }
  });

  it('gives a diagonal √2 more on Cartesian and √2 less on CoreXY', () => {
    expect(busiestDriveShareAtAngle('cartesian', 45)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(busiestDriveShareAtAngle('corexy', 45)).toBeCloseTo(Math.SQRT2, 12);
    expect(busiestDriveShareAtAngle('cartesian', 30)).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(busiestDriveShareAtAngle('corexy', 30)).toBeCloseTo(0.5 + Math.cos(Math.PI / 6), 12);
  });

  it('matches grblHAL’s motor-space limit at every angle', () => {
    for (let angleDeg = 0; angleDeg <= 180; angleDeg += 7.5) {
      expect(1000 / busiestDriveShareAtAngle('corexy', angleDeg)).toBeCloseTo(
        coreXyAccelFromMotorSpace(1000, angleDeg),
        9,
      );
    }
  });

  it('falls back to 1 for a direction it cannot use', () => {
    expect(busiestDriveShare('corexy', { x: 0, y: 0 })).toBe(1);
    expect(busiestDriveShareAtAngle('corexy', Number.NaN)).toBe(1);
  });
});

describe('the time model on CoreXY', () => {
  const diagonal = { direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 } };
  const alongX = { direction: { x: 1, y: 0 } };

  it('keeps the Cartesian profile value in every direction', () => {
    expect(plannedDriveShare('cartesian', diagonal.direction)).toBe(1);
    expect(blockAcceleration(diagonal, 500, 'cartesian')).toBe(500);
    expect(junctionPlanningLimits(alongX, diagonal, 500, 0.01, 'cartesian')).toEqual({
      accel: 500,
      jd: 0.01,
    });
  });

  it('plans a CoreXY diagonal at a / √2 and an axis move at a', () => {
    expect(blockAcceleration(diagonal, 1000, 'corexy')).toBeCloseTo(1000 / Math.SQRT2, 9);
    expect(blockAcceleration(alongX, 1000, 'corexy')).toBe(1000);
  });

  it('plans a CoreXY square corner along one motor, with a motor-space deviation', () => {
    const alongY = { direction: { x: 0, y: 1 } };
    const corner = junctionPlanningLimits(alongX, alongY, 1000, 0.01, 'corexy');
    // The junction vector (-1, 1)/√2 drives motor B alone at √2 of its share.
    expect(corner.accel).toBeCloseTo(1000 / Math.SQRT2, 9);
    expect(corner.jd).toBeCloseTo(0.01 / Math.SQRT2, 12);
  });
});
