import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildGcodeTimingPlan, plannedProgressAtRoute } from '../../core/gcode-time';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output';
import { canvasJobTimingPlan } from './canvas-job-timing-plan';
import { observeTrustedLiveJobProgress, startLiveJobTiming } from './live-job-timing';

const ORIGIN = { x: 0, y: 0, z: 0 };
const CONTEXT = {
  controllerSessionEpoch: 1,
  positionEpoch: 1,
  activeControllerKind: 'grbl-v1.1',
  detectedControllerKind: 'grbl-v1.1',
} as const;
const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeed: 6_000,
};
const LIMITS = {
  accelMmPerSec2: DEVICE.accelMmPerSec2,
  junctionDeviationMm: DEVICE.junctionDeviationMm,
  maxFeedMmPerMin: DEVICE.maxFeed,
};

function lineJob(dense = false): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'L1',
        color: '#000000',
        power: 50,
        speed: 600,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: dense
              ? Array.from({ length: 101 }, (_, x) => ({ x, y: 0 }))
              : [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                ],
            closed: false,
          },
        ],
      },
    ],
  };
}

describe('live countdown retains the emitted timing baseline', () => {
  it('retains independent cut and travel calibration when Start initializes its clock', () => {
    const device = { ...DEVICE, estimateCutTimeScale: 2, estimateTravelTimeScale: 3 };
    const gcode = grblStrategy.emit(lineJob(), device);
    const raw = buildGcodeTimingPlan(gcode, LIMITS, ORIGIN, { machineKind: 'laser' });
    const calibrated = canvasJobTimingPlan(gcode, device, ORIGIN, CONTEXT);
    if (raw.kind !== 'ok' || calibrated.kind !== 'ok') throw new Error('Expected timing plans.');
    const expectedMotion =
      raw.plan.breakdown.cutSeconds * 2 +
      (raw.plan.breakdown.rapidTravelSeconds + raw.plan.breakdown.feedTravelSeconds) * 3;
    expect(calibrated.plan.motionSeconds).toBeCloseTo(expectedMotion, 5);
    expect(calibrated.plan.motionSeconds).toBeCloseTo(23.64, 5);
    const started = startLiveJobTiming(calibrated, 1_000);
    if (started.kind !== 'estimating') throw new Error('Expected an initial countdown.');
    expect(started.remainingSecondsAtUpdate).toBe(calibrated.plan.totalSeconds);
    expect(started.remainingSecondsAtUpdate).toBeCloseTo(
      expectedMotion + calibrated.plan.dwellSeconds + calibrated.plan.transportSeconds,
      5,
    );
  });

  it('uses CNC motion classification when supplied by the prepared job', () => {
    const device = { ...DEVICE, estimateCutTimeScale: 2, estimateTravelTimeScale: 3 };
    const gcode = 'G21\nG90\nG1 X100 F600';
    const laser = canvasJobTimingPlan(gcode, device, ORIGIN, CONTEXT);
    const cnc = canvasJobTimingPlan(gcode, device, ORIGIN, { ...CONTEXT, machineKind: 'cnc' });
    if (laser.kind !== 'ok' || cnc.kind !== 'ok') throw new Error('Expected timing plans.');
    // An unpowered feed move is laser-off travel; CNC feed remains a process move.
    expect(laser.plan.motionSeconds / cnc.plan.motionSeconds).toBeCloseTo(3 / 2);
  });

  it.each([1, 2])('does not mistake wire delay for %ix modeled motion pace', (observedPace) => {
    const device = { ...DEVICE, baudRate: 300 };
    const gcode = grblStrategy.emit(lineJob(true), device);
    const built = canvasJobTimingPlan(gcode, device, ORIGIN, CONTEXT);
    if (built.kind !== 'ok') throw new Error('Expected low-baud timing plan.');
    expect(built.plan.transportSeconds).toBeGreaterThan(built.plan.motionSeconds);
    expect(built.plan.totalSeconds).toBeGreaterThanOrEqual(built.plan.wireSeconds);
    const progress = plannedProgressAtRoute(built.plan, 50);
    expect(progress.transportSeconds).toBeGreaterThan(0);
    const atMs =
      (progress.motionSeconds * observedPace +
        progress.dwellSeconds +
        (progress.transportSeconds ?? 0)) *
      1_000;
    const initial = observeTrustedLiveJobProgress(startLiveJobTiming(built, 0), 0, 0);
    const observed = observeTrustedLiveJobProgress(initial, 50, atMs);
    if (observed.kind !== 'running') throw new Error('Expected running countdown.');
    const expectedPace = 0.75 + observedPace * 0.25;
    const remainingTransport = built.plan.transportSeconds - (progress.transportSeconds ?? 0);
    expect(remainingTransport).toBeGreaterThan(0);
    expect(observed.motionPace).toBeCloseTo(expectedPace);
    expect(observed.remainingSecondsAtUpdate).toBeCloseTo(
      (built.plan.motionSeconds - progress.motionSeconds) * expectedPace +
        (built.plan.dwellSeconds - progress.dwellSeconds) +
        remainingTransport,
    );
  });
});
