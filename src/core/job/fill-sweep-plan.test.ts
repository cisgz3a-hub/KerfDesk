import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FillGroup, FillSegment } from './job';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps } from './fill-sweep-plan';

const seg = (x0: number, y0: number, x1: number, y1: number): FillSegment => ({
  polyline: [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ],
  closed: false,
  reverse: false,
});

const reverseSeg = (x0: number, y0: number, x1: number, y1: number): FillSegment => ({
  ...seg(x0, y0, x1, y1),
  reverse: true,
});

function group(segments: ReadonlyArray<FillSegment>): FillGroup {
  return {
    kind: 'fill',
    layerId: 'script-name',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    fillRunwayPolicy: 'feed-matched-entry',
    overscanMm: 5,
    segments,
  };
}

function legacyGroup(segments: ReadonlyArray<FillSegment>): FillGroup {
  const { fillRunwayPolicy: _policy, ...legacy } = group(segments);
  return legacy;
}

function expandedEndpoints(plan: ReturnType<typeof planFillSweeps>[number]) {
  const first = plan.sweep.spans[0];
  const last = plan.sweep.spans.at(-1);
  if (first === undefined || last === undefined) return null;
  return expandFillHatchWithRunways([first.start, last.end], plan);
}

describe('planFillSweeps', () => {
  it('gives the enlarged J fragment a 5 mm feed-matched entry after its rapid', () => {
    const plans = planFillSweeps(
      group([seg(6.551, 43, 7.015, 43), seg(16.62, 43, 18.108, 43), seg(18.693, 43, 18.972, 43)]),
    );

    expect(plans).toHaveLength(2);
    expect(
      plans.map(({ leadInMm, leadOutMm, runwayMotion }) => ({
        leadInMm,
        leadOutMm,
        runwayMotion,
      })),
    ).toEqual([
      { leadInMm: 5, leadOutMm: 0, runwayMotion: 'feed-matched' },
      { leadInMm: 5, leadOutMm: 5, runwayMotion: 'feed-matched' },
    ]);
    expect(expandedEndpoints(plans[1] as (typeof plans)[number])?.leadStart.x).toBeCloseTo(
      11.62,
      6,
    );
    expect(11.62 - 7.015).toBeCloseTo(4.605, 6);
  });

  it.each([
    ['C 6.683 mm gap', 6.683],
    ['C 7.048 mm gap', 7.048],
    ['J 9.605 mm gap', 9.605],
  ])('keeps a controlled-travel remainder before the %s lead-in', (_name, gapMm) => {
    const plans = planFillSweeps(group([seg(0, 0, 2, 0), seg(2 + gapMm, 0, 4 + gapMm, 0)]));
    const next = plans[1];

    expect(next?.leadInMm).toBe(5);
    expect(expandedEndpoints(next as (typeof plans)[number])?.leadStart.x).toBeCloseTo(
      2 + gapMm - 5,
      6,
    );
    expect(gapMm - 5).toBeGreaterThan(0);
  });

  it('applies the same J entry monotonically on a reverse snake row', () => {
    const plans = planFillSweeps(
      group([reverseSeg(7.015, 43, 6.551, 43), reverseSeg(18.972, 43, 16.62, 43)]),
    );
    const first = plans[0];
    const second = plans[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const firstRun = expandedEndpoints(first as (typeof plans)[number]);
    const secondRun = expandedEndpoints(second as (typeof plans)[number]);

    expect(firstRun?.leadStart.x).toBeCloseTo(23.972, 6);
    expect(firstRun?.leadEnd.x).toBeCloseTo(16.62, 6);
    expect(secondRun?.leadStart.x).toBeCloseTo(12.015, 6);
    expect(secondRun?.burnStart.x).toBeCloseTo(7.015, 6);
    expect(16.62 - 12.015).toBeCloseTo(4.605, 6);
  });

  it('removes the legacy overlapping runway at an internal split', () => {
    const segments = [seg(0, 0, 10, 0), seg(16, 0, 26, 0)];
    const legacy = planFillSweeps(legacyGroup(segments));
    const safe = planFillSweeps(group(segments));

    expect(legacy.map(({ leadOutMm, leadInMm }) => [leadOutMm, leadInMm])).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(safe.map(({ leadOutMm, leadInMm }) => [leadOutMm, leadInMm])).toEqual([
      [0, 5],
      [5, 5],
    ]);
    expect(expandedEndpoints(safe[1] as (typeof safe)[number])?.leadStart.x).toBe(11);
  });

  it('keeps a full Island runway monotonic when configured overscan exceeds the split gap', () => {
    const plans = planFillSweeps({
      ...group([seg(0, 0, 10, 0), seg(16, 0, 26, 0)]),
      fillStyle: 'island',
      fillRunwayPolicy: 'full',
      overscanMm: 10,
    });
    const second = plans[1];

    expect(plans.map(({ leadInMm, leadOutMm }) => [leadInMm, leadOutMm])).toEqual([
      [10, 0],
      [6, 10],
    ]);
    expect(expandedEndpoints(second as (typeof plans)[number])?.leadStart.x).toBe(10);
  });

  it('keeps legacy short-fragment behavior byte-compatible outside the 4040 policy', () => {
    const plans = planFillSweeps(legacyGroup([seg(0, 0, 2, 0), seg(11.605, 0, 13.605, 0)]));

    expect(
      plans.map(({ leadInMm, leadOutMm, runwayMotion }) => ({
        leadInMm,
        leadOutMm,
        runwayMotion,
      })),
    ).toEqual([
      { leadInMm: 0, leadOutMm: 0, runwayMotion: 'rapid' },
      { leadInMm: 0, leadOutMm: 0, runwayMotion: 'rapid' },
    ]);
  });

  it('property: split-sweep motion stays monotonic and feed entries never exceed 5 mm', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 5.001, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 20, noNaN: true, noDefaultInfinity: true }),
        (gapMm, firstLengthMm, secondLengthMm) => {
          const plans = planFillSweeps(
            group([
              seg(0, 0, firstLengthMm, 0),
              seg(firstLengthMm + gapMm, 0, firstLengthMm + gapMm + secondLengthMm, 0),
            ]),
          );
          const first = plans[0];
          const second = plans[1];
          if (first === undefined || second === undefined) return false;
          const firstRun = expandedEndpoints(first);
          const secondRun = expandedEndpoints(second);
          if (firstRun === null || secondRun === null) return false;
          return (
            firstRun.burnEnd.x <= secondRun.leadStart.x &&
            secondRun.leadStart.x <= secondRun.burnStart.x &&
            second.leadInMm <= 5 &&
            first.leadOutMm === 0
          );
        },
      ),
    );
  });
});
