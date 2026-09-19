import { describe, expect, it } from 'vitest';
import { representedCncCoordinateMm } from '../cnc/coordinate-representation';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import type { CncGroup } from './job';
import { estimateJobDuration } from './estimate-duration';
import { expectedVcarveMotion } from './estimate-duration-vcarve-kinematics.test-support';

type PathPoint = { readonly x: number; readonly y: number; readonly z: number };

const SAFE_Z_MM = 3;
const PLUNGE_FEED_MM_PER_MIN = 300;

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

    expectMotion(zRateCapped, points, [1000, 1000, 1000]);
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

    expectMotion(zRateCapped, points, [expectedFeed]);
    expect(zRateCapped.totalSeconds).toBeGreaterThan(cuttingFeed.totalSeconds);
  });

  it('prices a half-quantum descent from the represented XYZ and emitted feed', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: -0.0506 },
    ];
    const group = {
      ...rampGroup('z-rate-capped', points, 1000.4),
      plungeMmPerMin: 299.6,
    };
    const representedPoints = points.map(representedPoint);
    const estimate = estimateJobDuration({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    const emitted = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);

    expect(emitted).toContain('X0.100Y0.000Z-0.051F658');
    expectMotion(estimate, representedPoints, [658], SAFE_Z_MM, 299);
  });

  it('prices a GRBL float-boundary segment at the exact emitted feed', () => {
    const points = [
      { x: 0, y: 0, z: 0 },
      { x: 6553.606, y: 0, z: -3000.001 },
    ];
    const group = {
      ...rampGroup('z-rate-capped', points, 5000),
      plungeMmPerMin: 1103,
    };
    const representedPoints = points.map(representedPoint);
    const estimate = estimateJobDuration({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    const emitted = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);

    expect(emitted).toContain('X6553.606Y0.000Z-3000.001F2650');
    expectMotion(estimate, representedPoints, [2650], SAFE_Z_MM, 1103);
  });

  it('retains the emitter feed across opposite signed-zero XY words on a rise', () => {
    const points = [
      { x: -0.0004, y: 0, z: -0.0506 },
      { x: 0.0004, y: 0, z: 0 },
    ];
    const group = rampGroup('z-rate-capped', points);
    const representedPoints = points.map(representedPoint);
    const estimate = estimateJobDuration({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    const emitted = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);

    expect(emitted).toContain('X0.000Y0.000Z0.000F1000');
    expectMotion(estimate, representedPoints, [1000]);
    expect(estimate.breakdown.feedTravelSeconds).toBeGreaterThan(0);
  });

  it('prices entry and retract travel from represented safe Z and entry Z', () => {
    const points = [
      { x: 0, y: 0, z: -0.0506 },
      { x: 1, y: 0, z: -0.0506 },
    ];
    const group = { ...rampGroup(undefined, points), safeZMm: 3.0006 };
    const representedPoints = points.map(representedPoint);
    const estimate = estimateJobDuration({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    const emitted = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);

    expect(emitted).toContain('G0 Z3.001');
    expect(emitted).toContain('G1 Z-0.051');
    expectMotion(estimate, representedPoints, [1000], representedCncCoordinateMm(group.safeZMm));
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

    expectMotion(estimate, points, [PLUNGE_FEED_MM_PER_MIN]);
    // The two collinear downward G1 moves share their 5 mm/s junction.
    expect(estimate.breakdown.cutSeconds).toBeCloseTo(5 / 5 + 5 / 500, 9);
  });

  it('prices a pure vertical in-cut rise at plunge feed like the emitter', () => {
    const points = [
      { x: 0, y: 0, z: -2 },
      { x: 0, y: 0, z: -1 },
    ];
    const estimate = estimateJobDuration(
      { groups: [rampGroup('z-rate-capped', points)] },
      DEFAULT_DEVICE_PROFILE,
    );

    expectMotion(estimate, points, [PLUNGE_FEED_MM_PER_MIN]);
    // Reversal stops the entry plunge. A pure +Z G1 is feed travel, and
    // the preserved rapid/feed boundary also stops before the G0 retract.
    expect(estimate.breakdown.cutSeconds).toBeCloseTo(5 / 5 + 5 / 500, 9);
    expect(estimate.breakdown.feedTravelSeconds).toBeCloseTo(1 / 5 + 5 / 500, 9);
  });
});

function expectMotion(
  estimate: ReturnType<typeof estimateJobDuration>,
  points: ReadonlyArray<PathPoint>,
  feeds: ReadonlyArray<number>,
  safeZMm = SAFE_Z_MM,
  plungeFeedMmPerMin = PLUNGE_FEED_MM_PER_MIN,
): void {
  const expected = expectedVcarveMotion(points, feeds, safeZMm, plungeFeedMmPerMin);
  for (const [actual, analytic, roundOff] of [
    [estimate.breakdown.cutSeconds, expected.cut, expected.roundOffSeconds.cut],
    [
      estimate.breakdown.feedTravelSeconds ?? 0,
      expected.feedTravel,
      expected.roundOffSeconds.feedTravel,
    ],
    [estimate.breakdown.rapidTravelSeconds ?? 0, expected.rapid, expected.roundOffSeconds.rapid],
    [
      estimate.totalSeconds - (estimate.breakdown.transportSeconds ?? 0),
      expected.cut + expected.feedTravel + expected.rapid,
      expected.roundOffSeconds.cut +
        expected.roundOffSeconds.feedTravel +
        expected.roundOffSeconds.rapid,
    ],
  ] as const) {
    expect(Math.abs(actual - analytic)).toBeLessThanOrEqual(roundOff);
  }
}

function representedPoint(point: PathPoint): PathPoint {
  return {
    x: representedCncCoordinateMm(point.x),
    y: representedCncCoordinateMm(point.y),
    z: representedCncCoordinateMm(point.z),
  };
}
