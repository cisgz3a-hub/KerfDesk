import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from './job';
import { estimateJobDuration } from './estimate-duration';

function rampGroup(lateralFeed?: 'plunge'): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'v-carve',
    color: '#ff0000',
    cutType: 'v-carve',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3,
    passes: [
      {
        kind: 'path3d',
        closed: false,
        ...(lateralFeed === undefined ? {} : { lateralFeed }),
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 100, y: 0, z: -1 },
        ],
      },
    ],
  };
}

describe('V-carve ramp duration', () => {
  it('prices a plunge-fed lateral entry at plunge feed instead of cutting feed', () => {
    const cuttingFeed = estimateJobDuration({ groups: [rampGroup()] }, DEFAULT_DEVICE_PROFILE);
    const plungeFeed = estimateJobDuration(
      { groups: [rampGroup('plunge')] },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(plungeFeed.totalSeconds).toBeGreaterThan(cuttingFeed.totalSeconds);
    expect(plungeFeed.breakdown.cutSeconds).toBeGreaterThan(cuttingFeed.breakdown.cutSeconds);
  });
});
