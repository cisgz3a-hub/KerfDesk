import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { junctionVelocity, type Block } from '../motion-planner';
import type { MotionLimits } from './motion-limits';
import { buildProgramTime } from './program-time';
import { segmentBlocks } from './segment-blocks';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 100,
  junctionDeviationMm: 0.1,
  maxFeedMmPerMin: 6000,
};

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(`G21 G90\n${text}`);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

describe('XYZ program timing', () => {
  it('uses the full XYZ length to normalize oblique and vertical block directions', () => {
    const blocks = segmentBlocks(model('G1 X3 Y4 Z12 F600\nG1 Z22'), LIMITS);
    const oblique = blocks[0];
    const vertical = blocks[1];
    expect(oblique?.distance).toBe(13);
    expect(oblique?.direction).toEqual({ x: 3 / 13, y: 4 / 13, z: 12 / 13 });
    expect(vertical?.direction).toEqual({ x: 0, y: 0, z: 1 });
    for (const block of blocks) {
      expect(Math.hypot(block.direction.x, block.direction.y, block.direction.z ?? 0)).toBeCloseTo(
        1,
        12,
      );
    }
  });

  it('keeps successive same-direction Z moves continuous', () => {
    const split = buildProgramTime(model('G1 Z5 F6000\nG1 Z10'), LIMITS);
    const whole = buildProgramTime(model('G1 Z10 F6000'), LIMITS);
    // A 10 mm rest-to-rest triangle at 100 mm/s²: 2 sqrt(distance / accel).
    expect(split.motionSeconds).toBeCloseTo(2 * Math.sqrt(10 / 100), 8);
    expect(split.motionSeconds).toBeCloseTo(whole.motionSeconds, 8);
    expect(split.segExitVelocityMmPerSec[0]).toBeCloseTo(Math.sqrt(1000), 5);
  });

  it('stops at all 100 pure-Z reversals and matches their analytic triangular time', () => {
    const moves = Array.from(
      { length: 100 },
      (_, index) => `G1 Z${index % 2 === 0 ? 0.5 : 0} F600`,
    );
    const time = buildProgramTime(model(moves.join('\n')), LIMITS);
    // Every 0.5 mm leg starts and ends at rest; vPeak = sqrt(100 * 0.5)
    // stays below the 10 mm/s feed. Previously XY-only directions let the
    // planner blend through the vertical reversals in about 7.46 seconds.
    expect(time.motionSeconds).toBeCloseTo(100 * 2 * Math.sqrt(0.5 / 100), 6);
    expect([...time.segEntryVelocityMmPerSec]).toEqual(Array(100).fill(0));
    expect([...time.segExitVelocityMmPerSec]).toEqual(Array(100).fill(0));
  });

  it('limits an oblique corner whose XY projection is straight', () => {
    const time = buildProgramTime(model('G1 X3 Z4 F600\nG1 X6 Z0'), LIMITS);
    // Unit XYZ directions (3/5, 0, 4/5) and (3/5, 0, -4/5) have
    // dot product -7/25. The JD half-angle is sqrt((1 - 7/25) / 2) = 0.6.
    const cornerSpeed = Math.sqrt((100 * 0.1 * 0.6) / 0.4);
    const legSeconds =
      10 / 100 +
      (5 - 10 ** 2 / 200 - (10 ** 2 - cornerSpeed ** 2) / 200) / 10 +
      (10 - cornerSpeed) / 100;
    expect(time.segExitVelocityMmPerSec[0]).toBeCloseTo(cornerSpeed, 5);
    expect(time.segEntryVelocityMmPerSec[1]).toBeCloseTo(cornerSpeed, 5);
    expect(time.motionSeconds).toBeCloseTo(legSeconds * 2, 8);
  });

  it('gives the same corner timing after rotating a planar path into the YZ plane', () => {
    const planar = buildProgramTime(model('G1 X10 F600\nG1 Y10'), LIMITS);
    const vertical = buildProgramTime(model('G1 Y10 F600\nG1 Z10'), LIMITS);
    expect(vertical.motionSeconds).toBeCloseTo(planar.motionSeconds, 12);
    expect(vertical.segSeconds).toEqual(planar.segSeconds);
  });

  it('preserves legacy planar block directions when Z is omitted', () => {
    const first: Block = {
      kind: 'cut',
      distance: 10,
      targetVelocity: 10,
      direction: { x: 1, y: 0 },
    };
    for (const direction of [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]) {
      const next = { ...first, direction };
      expect(junctionVelocity(first, next, 100, 0.1)).toBe(
        junctionVelocity(
          { ...first, direction: { ...first.direction, z: 0 } },
          { ...next, direction: { ...direction, z: 0 } },
          100,
          0.1,
        ),
      );
    }
  });
});
