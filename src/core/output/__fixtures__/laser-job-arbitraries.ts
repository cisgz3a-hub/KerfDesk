import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../../devices';
import type { CutSegment, FillSegment, Job } from '../../job';

export const OUTPUT_FUZZ_RUNS = 100;
export const OUTPUT_BED_WIDTH = DEFAULT_DEVICE_PROFILE.bedWidth;
export const OUTPUT_BED_HEIGHT = DEFAULT_DEVICE_PROFILE.bedHeight;

const arbVec2InBed = fc.record({
  x: fc.double({
    min: 0,
    max: OUTPUT_BED_WIDTH,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  y: fc.double({
    min: 0,
    max: OUTPUT_BED_HEIGHT,
    noNaN: true,
    noDefaultInfinity: true,
  }),
});

export const arbCutSegment: fc.Arbitrary<CutSegment> = fc.record({
  polyline: fc.array(arbVec2InBed, { minLength: 2, maxLength: 12 }),
  closed: fc.boolean(),
});

const arbCutGroup = fc.record({
  kind: fc.constant('cut' as const),
  layerId: fc.string({ minLength: 1, maxLength: 4 }),
  color: fc.constantFrom('#ff0000', '#00ff00', '#0000ff', '#000000'),
  power: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  speed: fc.double({
    min: 1,
    max: DEFAULT_DEVICE_PROFILE.maxFeed,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  passes: fc.integer({ min: 1, max: 3 }),
  airAssist: fc.boolean(),
  segments: fc.array(arbCutSegment, { minLength: 0, maxLength: 4 }),
});

export const arbLaserJob: fc.Arbitrary<Job> = fc.record({
  groups: fc.array(arbCutGroup, { minLength: 0, maxLength: 3 }),
});

// Shared Y values deliberately create multi-span sweeps with interior gaps.
export const arbFillSpan: fc.Arbitrary<FillSegment> = fc
  .record({
    y: fc.constantFrom(10, 20, 30),
    x0: fc.double({
      min: 0,
      max: OUTPUT_BED_WIDTH,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    x1: fc.double({
      min: 0,
      max: OUTPUT_BED_WIDTH,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  })
  .map(({ y, x0, x1 }) => ({
    polyline: [
      { x: x0, y },
      { x: x1, y },
    ],
    closed: false,
    reverse: false,
  }));

const arbFillGroup = fc.record({
  kind: fc.constant('fill' as const),
  layerId: fc.string({ minLength: 1, maxLength: 4 }),
  color: fc.constantFrom('#ff0000', '#00ff00', '#000000'),
  power: fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  speed: fc.double({
    min: 1,
    max: DEFAULT_DEVICE_PROFILE.maxFeed,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  passes: fc.integer({ min: 1, max: 3 }),
  airAssist: fc.boolean(),
  overscanMm: fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
  segments: fc.array(arbFillSpan, { minLength: 0, maxLength: 8 }),
});

export const arbMixedLaserJob: fc.Arbitrary<Job> = fc.record({
  groups: fc.array(fc.oneof(arbCutGroup, arbFillGroup), { minLength: 0, maxLength: 3 }),
});

export function singleCutJob(power: number): Job {
  return {
    groups: [
      {
        kind: 'cut',
        layerId: 'power-scale',
        color: '#000000',
        power,
        speed: 1500,
        passes: 1,
        airAssist: false,
        segments: [
          {
            polyline: [
              { x: 10, y: 10 },
              { x: 20, y: 20 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}
