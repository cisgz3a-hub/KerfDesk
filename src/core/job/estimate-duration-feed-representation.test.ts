import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from './job';
import { estimateJobDuration } from './estimate-duration';

const job: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'feed-boundary',
      color: '#000000',
      power: 50,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 100, y: 0 },
            { x: 101, y: 0 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('duration feed representation', () => {
  it('prices controlled travel at the same represented feed used by output', () => {
    const estimate = (controlledFeed: number) =>
      estimateJobDuration(
        job,
        {
          ...DEFAULT_DEVICE_PROFILE,
          maxFeed: 6000,
          controlledLaserOffTravelFeedMmPerMin: controlledFeed,
        },
        { finishPosition: null },
      );

    expect(estimate(0.75).breakdown.travelSeconds).toBeGreaterThan(
      estimate(1).breakdown.travelSeconds,
    );
    expect(estimate(1000.6)).toEqual(estimate(1000));
  });
});
