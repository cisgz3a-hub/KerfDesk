import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { Job } from './job';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

const job: Job = {
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
          closed: false,
          polyline: [
            { x: 10, y: 0 },
            { x: 110, y: 0 },
          ],
        },
      ],
    },
  ],
};

describe('job duration calibration', () => {
  it('applies independent cut and travel factors after motion planning', () => {
    const baseline = estimateJobDuration(job, device);
    const calibrated = estimateJobDuration(job, {
      ...device,
      estimateCutTimeScale: 1.25,
      estimateTravelTimeScale: 1.5,
    });

    expect(calibrated.breakdown.cutSeconds).toBeCloseTo(baseline.breakdown.cutSeconds * 1.25, 8);
    expect(calibrated.breakdown.travelSeconds).toBeCloseTo(
      baseline.breakdown.travelSeconds * 1.5,
      8,
    );
    expect(calibrated.totalSeconds).toBeCloseTo(
      calibrated.breakdown.cutSeconds + calibrated.breakdown.travelSeconds,
      8,
    );
  });

  it('treats absent or invalid programmatic factors as 1.0', () => {
    const baseline = estimateJobDuration(job, device);

    expect(
      estimateJobDuration(job, {
        ...device,
        estimateCutTimeScale: Number.NaN,
        estimateTravelTimeScale: -2,
      }),
    ).toEqual(baseline);
  });
});
