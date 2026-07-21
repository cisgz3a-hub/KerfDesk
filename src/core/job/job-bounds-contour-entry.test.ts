import { describe, expect, it } from 'vitest';
import { computeJobBounds, computeJobMotionBounds } from './job-bounds';
import type { CutGroup, FillGroup, Job } from './job';

const square = {
  polyline: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10 },
  ],
  closed: true,
};

const lineGroup: CutGroup = {
  kind: 'cut',
  layerId: 'outline',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  entryRunwayMm: 5,
  segments: [square],
};

describe('job bounds with ADR-239 contour entries', () => {
  it('keeps the artwork AABB free of entry motion', () => {
    const job: Job = { groups: [lineGroup] };
    expect(computeJobBounds(job)).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
  });

  it('extends the motion envelope to the tangential entry point', () => {
    const job: Job = { groups: [lineGroup] };
    expect(computeJobMotionBounds(job)).toEqual({ minX: 5, minY: 10, maxX: 20, maxY: 20 });
  });

  it('covers Follow Shape (offset) fill entries the same way', () => {
    const offset: FillGroup = {
      ...lineGroup,
      kind: 'fill',
      fillStyle: 'offset',
      overscanMm: 5,
      segments: [{ ...square, reverse: false }],
    };
    expect(computeJobMotionBounds({ groups: [offset] })).toEqual({
      minX: 5,
      minY: 10,
      maxX: 20,
      maxY: 20,
    });
  });

  it('leaves groups without an entry runway untouched', () => {
    const legacy: CutGroup = { ...lineGroup, segments: [square] };
    const noEntry: CutGroup = {
      kind: 'cut',
      layerId: legacy.layerId,
      color: legacy.color,
      power: legacy.power,
      speed: legacy.speed,
      passes: legacy.passes,
      airAssist: legacy.airAssist,
      segments: legacy.segments,
    };
    expect(computeJobMotionBounds({ groups: [noEntry] })).toEqual({
      minX: 10,
      minY: 10,
      maxX: 20,
      maxY: 20,
    });
  });
});
