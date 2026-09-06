import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from '../output/grbl-strategy';
import { buildGcodeTimingPlan, plannedProgressAtRoute } from './gcode-timing-plan';

const DEVICE = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, accelMmPerSec2: 1000 };
const LIMITS = {
  maxFeedMmPerMin: DEVICE.maxFeed,
  accelMmPerSec2: DEVICE.accelMmPerSec2,
  junctionDeviationMm: DEVICE.junctionDeviationMm,
};

function emittedCut(speed: number): string {
  const job: Job = {
    groups: [
      {
        kind: 'cut',
        layerId: 'slow-cut',
        color: '#000000',
        power: 50,
        speed,
        passes: 1,
        airAssist: false,
        segments: [
          {
            closed: false,
            polyline: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  return grblStrategy.emit(job, DEVICE);
}

function plan(gcode: string, cutTimeScale = 1, travelTimeScale = 1) {
  const result = buildGcodeTimingPlan(
    gcode,
    LIMITS,
    { x: 0, y: 0, z: 0 },
    { machineKind: 'laser', timeCalibration: { cutTimeScale, travelTimeScale } },
  );
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.plan;
}

describe('emitted positive fractional feed timing', () => {
  it('times a long emitted F0.5 cut at half the speed of F1', () => {
    const halfFeedGcode = emittedCut(0.5);
    const oneFeedGcode = emittedCut(1);
    expect(halfFeedGcode).toMatch(/\bF0\.5\b/u);
    expect(oneFeedGcode).toMatch(/\bF1\b/u);
    const half = plan(halfFeedGcode);
    const one = plan(oneFeedGcode);
    // 100 mm / 0.5 mm/min = 200 min; the very short acceleration ramps
    // contribute less than one millisecond at these represented feeds.
    expect(half.plannedMotionEndSeconds[0]).toBeCloseTo(12_000, 3);
    expect(one.plannedMotionEndSeconds[0]).toBeCloseTo(6000, 3);
    expect(half.totalSeconds - one.totalSeconds).toBeCloseTo(6000, 3);
    expect(plannedProgressAtRoute(half, 50).motionSeconds).toBeCloseTo(6000, 2);
    expect(plannedProgressAtRoute(one, 50).motionSeconds).toBeCloseTo(3000, 2);
  });

  it('retains fractional feed kinematics under independent motion-time calibration', () => {
    const gcode = emittedCut(0.5);
    const baseline = plan(gcode);
    const calibrated = plan(gcode, 2, 3);
    const rawCut = baseline.plannedMotionEndSeconds[0] ?? 0;
    const rawTravel = baseline.motionSeconds - rawCut;
    expect(calibrated.segmentTargetVelocityMmPerSec).toEqual(
      baseline.segmentTargetVelocityMmPerSec,
    );
    expect(calibrated.motionSeconds).toBeCloseTo(rawCut * 2 + rawTravel * 3, 3);
    expect(plannedProgressAtRoute(calibrated, 50).motionSeconds).toBeCloseTo(12_000, 2);
  });
});
