import { describe, expect, it } from 'vitest';

import type { CutSegment } from './job';
import { bucketSegmentsByContainmentDepth, startCursorForSegments } from './segment-order';

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
