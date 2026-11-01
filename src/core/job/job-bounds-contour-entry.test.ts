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

  it('extends the motion envelope by a custom compiled distance', () => {
    const job: Job = { groups: [{ ...lineGroup, entryRunwayMm: 2 }] };
    expect(computeJobMotionBounds(job)).toEqual({ minX: 8, minY: 10, maxX: 20, maxY: 20 });
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

describe('job bounds with ADR-239 Amendment 2 contour exits', () => {
  const withExit: CutGroup = { ...lineGroup, exitRunwayMm: 5 };

  it('extends the motion envelope to the exit point, not the artwork AABB', () => {
    const job: Job = { groups: [withExit] };
    expect(computeJobBounds(job)).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    expect(computeJobMotionBounds(job)).toEqual({ minX: 5, minY: 5, maxX: 20, maxY: 20 });
  });

  it("bounds the final pass's exit after its overcut, and an earlier pass's exit too", () => {
    const overcut: CutGroup = {
      ...withExit,
      entryRunwayMm: 1,
      exitRunwayMm: 15,
      finalPassOvercutMm: 2,
    };
    // The overcut ends at (12, 10) heading +x, so its exit reaches x = 27; the
    // closing edge's exit (10, -5) belongs to no pass when there is only one.
    expect(computeJobMotionBounds({ groups: [overcut] })).toEqual({
      minX: 9,
      minY: 10,
      maxX: 27,
      maxY: 20,
    });
    expect(computeJobMotionBounds({ groups: [{ ...overcut, passes: 2 }] })).toEqual({
      minX: 9,
      minY: -5,
      maxX: 27,
      maxY: 20,
    });
  });

  it('adds no exit with an unknown bed envelope', () => {
    const job: Job = { groups: [withExit], contourEntryBounds: null };
    expect(computeJobMotionBounds(job)).toEqual({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
  });
});
