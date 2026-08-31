import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from './job';
import { computeEmittedJobBounds, computeFrameJobBounds, computeJobBounds } from './job-bounds';

function precisionJob(xs: ReadonlyArray<number>): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'cnc',
    color: '#000000',
    cutType: 'engrave',
    toolDiameterMm: 4,
    feedMmPerMin: 600,
    plungeMmPerMin: 200,
    spindleRpm: 12_000,
    spindleSpinupSec: 1,
    safeZMm: 5,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: xs.map((x) => ({ x, y: 20_000 })),
      },
    ],
  };
  return { groups: [group] };
}

describe('final CNC bounds representation', () => {
  it('measures only parser-represented contour motion for final output bounds', () => {
    const job = precisionJob([10_000, 10_010, 10_010.0004]);

    expect(computeEmittedJobBounds(job)).toEqual({
      minX: 9_998,
      minY: 19_998,
      maxX: 10_012,
      maxY: 20_002,
    });
    expect(computeFrameJobBounds(job)).toEqual(computeEmittedJobBounds(job));
  });

  it('retains a Frame-only raw fallback when every contour segment is emissionless', () => {
    const job = precisionJob([10_000, 10_000.0004]);

    expect(computeEmittedJobBounds(job)).toBeNull();
    expect(computeFrameJobBounds(job)).toEqual(computeJobBounds(job));
  });
});
