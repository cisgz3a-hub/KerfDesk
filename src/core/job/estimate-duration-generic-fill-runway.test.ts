import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import { planFillSweeps } from './fill-sweep-plan';
import type { FillGroup, FillSegment } from './job';

const ACCELERATION_MM_PER_SEC2 = 300;
const BURN_FEED_MM_PER_MIN = 1500;
const FRAGMENT_COUNT = 20;
const FRAGMENT_LENGTH_MM = 0.5;
const FRAGMENT_SPACING_MM = 12;
const JUNCTION_DEVIATION_MM = 0.01;
const MAX_FEED_MM_PER_MIN = 2250;
const MAX_ACCEPTED_SECONDS_PER_FRAGMENT = 1;
const RUNWAY_MM = 5;

function fragment(index: number): FillSegment {
  const startX = index * FRAGMENT_SPACING_MM;
  return {
    polyline: [
      { x: startX, y: 0 },
      { x: startX + FRAGMENT_LENGTH_MM, y: 0 },
    ],
    closed: false,
    reverse: false,
  };
}

function fragmentedGroup(fillRunwayPolicy: NonNullable<FillGroup['fillRunwayPolicy']>): FillGroup {
  return {
    kind: 'fill',
    layerId: 'fragmented-trace',
    color: '#000000',
    power: 30,
    speed: BURN_FEED_MM_PER_MIN,
    passes: 1,
    airAssist: false,
    fillStyle: 'scanline',
    fillRunwayPolicy,
    overscanMm: RUNWAY_MM,
    segments: Array.from({ length: FRAGMENT_COUNT }, (_, index) => fragment(index)),
  };
}

describe('generic Scan Line runway duration', () => {
  it('times both runways on every fragment within the accepted planner runtime bound', () => {
    const group = fragmentedGroup('feed-matched-every-sweep');
    const entryOnlyGroup = fragmentedGroup('feed-matched-entry');
    const controller = {
      ...DEFAULT_DEVICE_PROFILE,
      maxFeed: MAX_FEED_MM_PER_MIN,
      accelMmPerSec2: ACCELERATION_MM_PER_SEC2,
      junctionDeviationMm: JUNCTION_DEVIATION_MM,
    };

    const estimate = estimateJobDuration({ groups: [group] }, controller);
    const entryOnlyEstimate = estimateJobDuration({ groups: [entryOnlyGroup] }, controller);
    const plans = planFillSweeps(group);

    expect(plans).toHaveLength(FRAGMENT_COUNT);
    expect(plans.every((plan) => plan.leadInMm === RUNWAY_MM && plan.leadOutMm === RUNWAY_MM)).toBe(
      true,
    );
    expect(estimate.totalSeconds).toBeLessThanOrEqual(
      FRAGMENT_COUNT * MAX_ACCEPTED_SECONDS_PER_FRAGMENT,
    );
    expect(estimate.breakdown.feedTravelSeconds).toBeGreaterThan(
      entryOnlyEstimate.breakdown.feedTravelSeconds ?? 0,
    );
  });
});
