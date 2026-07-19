import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import type { FillGroup, FillSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

function fillSegment(startX: number, endX: number, reverse: boolean): FillSegment {
  return {
    polyline: [
      { x: startX, y: 0 },
      { x: endX, y: 0 },
    ],
    closed: false,
    reverse,
  };
}

function islandGroup(segment: FillSegment, offsetMm?: number): FillGroup {
  return {
    kind: 'fill',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    fillStyle: 'island',
    overscanMm: 0,
    segments: [segment],
    ...(offsetMm === undefined ? {} : { bidirectionalScanOffsetMm: offsetMm }),
  };
}

describe('optimizePaths scan-offset routing', () => {
  it('routes Island Fill from adjusted endpoints and lets an explicit override win', () => {
    const reverseFar = islandGroup(fillSegment(100, 99, true));
    const forwardNear = islandGroup(fillSegment(10, 11, false));
    const job: Job = { groups: [reverseFar, forwardNear] };
    const calibrated = [{ speedMmPerMin: 1000, offsetMm: 100 }];

    expect(optimizePaths(job).groups).toEqual([forwardNear, reverseFar]);
    expect(optimizePaths(job, DEFAULT_PROJECT_OPTIMIZATION, calibrated).groups).toEqual([
      reverseFar,
      forwardNear,
    ]);

    const explicitlyUnshifted: Job = {
      groups: [
        islandGroup(reverseFar.segments[0] as FillSegment, 0),
        islandGroup(forwardNear.segments[0] as FillSegment, 0),
      ],
    };
    expect(
      optimizePaths(explicitlyUnshifted, DEFAULT_PROJECT_OPTIMIZATION, calibrated).groups[0],
    ).toMatchObject({ segments: forwardNear.segments });
  });
});
