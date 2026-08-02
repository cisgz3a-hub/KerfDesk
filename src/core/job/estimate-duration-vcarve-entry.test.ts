import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from './job';
import { estimateJobDuration } from './estimate-duration';
import { blockTime, planVelocities, type Block } from './planner';

type PathPoint = { readonly x: number; readonly y: number; readonly z: number };

const SAFE_Z_MM = 3;
const PLUNGE_FEED_MM_PER_MIN = 300;
const SECONDS_PER_MINUTE = 60;

function rampGroup(
  lateralFeed?: 'plunge' | 'z-rate-capped',
  points: ReadonlyArray<PathPoint> = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 0, z: -1 },
  ],
  feedMmPerMin = 1000,
): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'v-carve',
    color: '#ff0000',
    cutType: 'v-carve',
    toolDiameterMm: 3.175,
    feedMmPerMin,
    plungeMmPerMin: PLUNGE_FEED_MM_PER_MIN,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: SAFE_Z_MM,
    passes: [
      {
        kind: 'path3d',
        closed: false,
        ...(lateralFeed === undefined ? {} : { lateralFeed }),
        points,
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

  it('keeps flat, rising, and shallow descending motion at the cutting feed', () => {
    const points = [
      { x: 0, y: 0, z: -3 },
      { x: 100, y: 0, z: -3 },
      { x: 200, y: 0, z: -1 },
      { x: 300, y: 0, z: -2 },
    ];
    const zRateCapped = estimateJobDuration(
      { groups: [rampGroup('z-rate-capped', points)] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(zRateCapped.breakdown.cutSeconds).toBeCloseTo(
      expectedCutSeconds(points, [1000, 1000, 1000]),
      9,
    );
  });

  it('prices a steep descent at the same plunge-component-capped feed as emission', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: -100 },
    ];
    // floor(300 * hypot(100, 100) / 100) = 424 mm/min.
    const expectedFeed = 424;
    const zRateCapped = estimateJobDuration(
      { groups: [rampGroup('z-rate-capped', points)] },
      DEFAULT_DEVICE_PROFILE,
    );
    const cuttingFeed = estimateJobDuration(
      { groups: [rampGroup(undefined, points)] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(zRateCapped.breakdown.cutSeconds).toBeCloseTo(
      expectedCutSeconds(points, [expectedFeed]),
      9,
    );
    expect(zRateCapped.totalSeconds).toBeGreaterThan(cuttingFeed.totalSeconds);
  });

  it('prices a pure vertical in-cut descent instead of losing it in XY projection', () => {
    const points = [
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: -2 },
    ];
    const estimate = estimateJobDuration(
      { groups: [rampGroup('z-rate-capped', points)] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(estimate.breakdown.cutSeconds).toBeCloseTo(
      expectedCutSeconds(points, [PLUNGE_FEED_MM_PER_MIN]),
      9,
    );
  });
});

function expectedCutSeconds(
  points: ReadonlyArray<PathPoint>,
  feeds: ReadonlyArray<number>,
): number {
  const blocks = profileBlocks(points, feeds);
  const plan = planVelocities(
    blocks,
    DEFAULT_DEVICE_PROFILE.accelMmPerSec2,
    DEFAULT_DEVICE_PROFILE.junctionDeviationMm,
  );
  const motionSeconds = blocks.reduce((sum, block, index) => {
    const velocity = plan[index];
    return velocity === undefined
      ? sum
      : sum +
          blockTime(block, velocity.entryV, velocity.exitV, DEFAULT_DEVICE_PROFILE.accelMmPerSec2);
  }, 0);
  const entryTravelMm = SAFE_Z_MM + Math.abs(points[0]?.z ?? 0);
  const plungeSeconds = (entryTravelMm / PLUNGE_FEED_MM_PER_MIN) * SECONDS_PER_MINUTE;
  const retractSeconds = (entryTravelMm / DEFAULT_DEVICE_PROFILE.maxFeed) * SECONDS_PER_MINUTE;
  return motionSeconds + plungeSeconds + retractSeconds;
}

function profileBlocks(points: ReadonlyArray<PathPoint>, feeds: ReadonlyArray<number>): Block[] {
  const blocks: Block[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const feed = feeds[index - 1];
    if (from === undefined || to === undefined || feed === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (!(distance > 0)) continue;
    blocks.push({
      kind: 'cut',
      motion: 'feed',
      distance,
      targetVelocity: feed / SECONDS_PER_MINUTE,
      direction: { x: dx / distance, y: dy / distance, z: dz / distance },
    });
  }
  return blocks;
}
