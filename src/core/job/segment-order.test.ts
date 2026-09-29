import { describe, expect, it } from 'vitest';

import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import type { CutSegment } from './job';
import {
  bucketSegmentsByContainmentDepth,
  configuredSegmentOrder,
  startCursorForSegments,
} from './segment-order';

function closedSegment(...points: ReadonlyArray<readonly [number, number]>): CutSegment {
  const polyline = points.map(([x, y]) => ({ x, y }));
  return { polyline: [...polyline, ...polyline.slice(0, 1)], closed: true };
}

describe('inside-first order', () => {
  it('cuts a hole in a U-shaped plate before the plate, though the hole’s bounds centre is in the notch', () => {
    const plate = closedSegment(
      [0, 0],
      [100, 0],
      [100, 100],
      [70, 100],
      [70, 40],
      [30, 40],
      [30, 100],
      [0, 100],
    );
    // The plate inset by 3 mm: inside the material everywhere.
    const hole = closedSegment(
      [3, 3],
      [97, 3],
      [97, 97],
      [73, 97],
      [73, 37],
      [27, 37],
      [27, 97],
      [3, 97],
    );

    expect(configuredSegmentOrder([plate, hole], DEFAULT_PROJECT_OPTIMIZATION)).toEqual([
      hole,
      plate,
    ]);
  });
});

describe('startCursorForSegments', () => {
  it('reduces 125,000 usable bounds without spreading them into Math.min or Math.max', () => {
    const segments: CutSegment[] = Array.from({ length: 125_000 }, (_, index) => ({
      polyline: [
        { x: index, y: index % 2 },
        { x: index + 0.5, y: (index % 2) + 0.5 },
      ],
      closed: false,
    }));

    expect(startCursorForSegments(segments, 'job-lower-left')).toEqual({ x: 0, y: 0 });
    expect(startCursorForSegments(segments, 'job-center')).toEqual({ x: 62_499.75, y: 0.75 });
  });
});

describe('bucketSegmentsByContainmentDepth', () => {
  it('places 5,000 distinct depths in one bucket each without rescanning the segment list', () => {
    const segments = Array.from({ length: 5_000 }, (_, index) => index);
    const buckets = bucketSegmentsByContainmentDepth(segments, segments);

    expect(buckets.size).toBe(5_000);
    expect(buckets.get(0)).toEqual([0]);
    expect(buckets.get(4_999)).toEqual([4_999]);
  });
});
