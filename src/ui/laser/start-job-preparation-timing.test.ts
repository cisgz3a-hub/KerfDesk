import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { Job } from '../../core/job';
import { grblStrategy } from '../../core/output';
import { createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { startLiveJobTiming } from '../state/live-job-timing';
import { okPreparation } from './start-job-preparation';

describe('Review and Start timing handoff', () => {
  it('uses one calibrated emitted clock with physical approach and added dwell', () => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      estimateCutTimeScale: 2,
      estimateTravelTimeScale: 3,
      controlledLaserOffTravelFeedMmPerMin: 600,
    };
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'line',
          color: '#000',
          power: 50,
          speed: 600,
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
    const gcode = `G4 P7\n${grblStrategy.emit(job, device)}`;
    const prepared: Extract<PreparedOutput, { ok: true }> = {
      ok: true,
      project: createProject(device),
      job,
      jobOriginOffset: { x: 0, y: 0 },
    };
    const result = okPreparation(
      gcode,
      [],
      undefined,
      [],
      prepared,
      {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 300, y: 0, z: 0 },
          wco: null,
          feed: 0,
          spindle: 0,
        },
        alarmCode: null,
        hasActiveStreamer: false,
        controllerSessionEpoch: 1,
        trustedPositionEpoch: 1,
        activeControllerKind: 'grbl-v1.1',
        detectedControllerKind: 'grbl-v1.1',
      },
      undefined,
      false,
      'timing-parity',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.jobTimingPlan?.kind !== 'ok')
      throw new Error('Expected timed preparation');
    const duration = result.metrics.duration;
    // 300 mm approach plus 100 mm finish at 10 mm/s, travel scale 3.
    expect(duration.breakdown.travelSeconds).toBeGreaterThanOrEqual(120);
    expect(duration.breakdown.cutSeconds).toBeGreaterThanOrEqual(20);
    expect(duration.breakdown.dwellSeconds).toBe(7);
    expect(duration.totalSeconds).toBe(result.jobTimingPlan.plan.totalSeconds);
    const live = startLiveJobTiming(result.jobTimingPlan, 0);
    if (live.kind !== 'estimating') throw new Error('Expected estimating live clock');
    expect(live.remainingSecondsAtUpdate).toBe(duration.totalSeconds);
  });
});
