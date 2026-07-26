import { describe, expect, it } from 'vitest';
import {
  buildGcodeTimingPlan,
  plannedProgressAtRoute,
  type GcodeTimingPlanResult,
} from '../../core/gcode-time';
import {
  completeLiveJobTiming,
  describeLiveJobTiming,
  disconnectLiveJobTiming,
  finishLiveJobTiming,
  observeTrustedLiveJobProgress,
  pauseLiveJobTiming,
  runLiveJobTiming,
  startLiveJobTiming,
} from './live-job-timing';

const LIMITS = {
  accelMmPerSec2: 1_000,
  junctionDeviationMm: 0.02,
  maxFeedMmPerMin: 10_000,
};

function plan(gcode: string): GcodeTimingPlanResult {
  return buildGcodeTimingPlan(gcode, LIMITS, { x: 0, y: 0, z: 0 });
}

describe('live job timing', () => {
  it('freezes active time across pause and resumes from a fresh pacing anchor', () => {
    const started = startLiveJobTiming(plan('G1 X1000 F600'), 0);
    const running = observeTrustedLiveJobProgress(runLiveJobTiming(started, 0), 100, 10_000);
    if (running.kind !== 'running') throw new Error('Expected running timing.');
    expect(running.lastTrustedSample?.routeMm).toBe(100);
    const paused = pauseLiveJobTiming(running, 10_000);
    const pausedDisplay = describeLiveJobTiming(paused, 40_000);
    const resumed = runLiveJobTiming(paused, 40_000);
    const resumedDisplay = describeLiveJobTiming(resumed, 45_000);
    const firstAfterResume = observeTrustedLiveJobProgress(resumed, 150, 45_000);

    expect(pausedDisplay.kind).toBe('paused');
    expect(resumedDisplay.kind).toBe('running');
    if (pausedDisplay.kind !== 'paused' || resumedDisplay.kind !== 'running') return;
    expect(resumedDisplay.remainingSeconds).toBeCloseTo(pausedDisplay.remainingSeconds - 5);
    if (resumed.kind !== 'running') return;
    expect(resumed.lastTrustedSample).toBeNull();
    if (firstAfterResume.kind !== 'running') return;
    expect(firstAfterResume.motionPace).toBe(running.motionPace);
  });

  it('marks disconnect unavailable instead of drifting a numeric remainder', () => {
    const started = startLiveJobTiming(plan('G1 X100 F600'), 0);
    const disconnected = disconnectLiveJobTiming(started);

    expect(describeLiveJobTiming(disconnected, 5_000)).toEqual({ kind: 'disconnected' });
    expect(describeLiveJobTiming(disconnected, 90_000)).toEqual({ kind: 'disconnected' });
    expect(runLiveJobTiming(disconnected, 90_000)).toBe(disconnected);
  });

  it('scales observed motion pacing without scaling deterministic G4 dwell', () => {
    const built = plan('G1 X10 F60\nG4 P10\nG1 X20 F60\nG1 X30 F60');
    if (built.kind !== 'ok') throw new Error('Expected a timing plan.');
    const observed = plannedProgressAtRoute(built.plan, 20);
    const observedAtMs = (observed.motionSeconds * 2 + observed.dwellSeconds) * 1_000;
    let timing = startLiveJobTiming(built, 0);
    timing = observeTrustedLiveJobProgress(timing, 0, 0);
    timing = observeTrustedLiveJobProgress(timing, 20, observedAtMs);

    if (timing.kind !== 'running') throw new Error('Expected running timing.');
    // Planned motion took twice its baseline after subtracting the
    // deterministic 10-second dwell. The EWMA moves pace 1 -> 1.25, so only
    // remaining motion is scaled; the known dwell is never multiplied.
    expect(timing.motionPace).toBeCloseTo(1.25);
    expect(timing.remainingSecondsAtUpdate).toBeCloseTo(
      (built.plan.motionSeconds - observed.motionSeconds) * 1.25 +
        (built.plan.dwellSeconds - observed.dwellSeconds),
    );
  });

  it('keeps a future deterministic dwell unscaled after motion pace calibration', () => {
    const built = plan('G1 X10 F60\nG1 X20 F60\nG4 P10\nG1 X30 F60\nG1 X40 F60');
    if (built.kind !== 'ok') throw new Error('Expected a timing plan.');
    const observed = plannedProgressAtRoute(built.plan, 20);
    let timing = startLiveJobTiming(built, 0);
    timing = observeTrustedLiveJobProgress(timing, 0, 0);
    timing = observeTrustedLiveJobProgress(timing, 20, observed.motionSeconds * 2_000);

    if (timing.kind !== 'running') throw new Error('Expected running timing.');
    const remainingMotion = built.plan.motionSeconds - observed.motionSeconds;
    expect(timing.motionPace).toBeGreaterThan(1);
    expect(timing.remainingSecondsAtUpdate).toBeCloseTo(remainingMotion * timing.motionPace + 10);
  });

  it('accumulates frequent short route samples until they can calibrate pacing', () => {
    const built = plan('G1 X100 F600');
    if (built.kind !== 'ok') throw new Error('Expected a timing plan.');
    let timing = startLiveJobTiming(built, 0);
    timing = observeTrustedLiveJobProgress(timing, 0, 0);
    for (let routeMm = 2; routeMm <= 20; routeMm += 2) {
      timing = observeTrustedLiveJobProgress(timing, routeMm, routeMm * 200);
    }

    if (timing.kind !== 'running') throw new Error('Expected running timing.');
    expect(timing.motionPace).toBeGreaterThan(1);
    expect(timing.lastTrustedSample?.routeMm).toBe(20);
  });

  it('retains pace one for an on-model sample inside an accelerating segment', () => {
    const built = buildGcodeTimingPlan(
      'G21\nG90\nG1 X1000 F3000',
      {
        accelMmPerSec2: 50,
        junctionDeviationMm: 0.01,
        maxFeedMmPerMin: 6_000,
      },
      { x: 0, y: 0, z: 0 },
    );
    if (built.kind !== 'ok') throw new Error('Expected a timing plan.');
    let timing = startLiveJobTiming(built, 0);
    timing = observeTrustedLiveJobProgress(timing, 0, 0);
    timing = observeTrustedLiveJobProgress(timing, 50, 1_500);

    if (timing.kind !== 'running') throw new Error('Expected running timing.');
    expect(timing.motionPace).toBeCloseTo(1, 8);
  });

  it('uses only route-confirmed progress to correct the prediction', () => {
    const started = startLiveJobTiming(plan('G1 X100 F600'), 0);
    const wallClockOnly = runLiveJobTiming(started, 10_000);
    const corrected = observeTrustedLiveJobProgress(wallClockOnly, 50, 20_000);

    if (wallClockOnly.kind !== 'running' || corrected.kind !== 'running') return;
    expect(wallClockOnly.motionPace).toBe(1);
    expect(wallClockOnly.lastTrustedSample).toBeNull();
    expect(corrected.lastTrustedSample?.routeMm).toBe(50);
  });

  it('distinguishes controller settling from explicit settled completion', () => {
    const started = startLiveJobTiming(plan('G1 X10 F600'), 0);
    const finishing = finishLiveJobTiming(started);
    const complete = completeLiveJobTiming();

    expect(describeLiveJobTiming(finishing, 90_000)).toEqual({ kind: 'finishing' });
    expect(describeLiveJobTiming(complete, 90_000)).toEqual({ kind: 'complete' });
  });

  it('keeps unsupported emitted timing explicitly unavailable', () => {
    const timing = startLiveJobTiming(plan('G82 X1 Y1 Z-1 R1 P1'), 0);
    const display = describeLiveJobTiming(timing, 10_000);

    expect(display.kind).toBe('unavailable');
    if (display.kind !== 'unavailable') return;
    expect(display.reason).toContain('Timing-unknown canned-cycle');
  });
});
