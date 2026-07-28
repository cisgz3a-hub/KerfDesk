import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FillGroup, FillSegment } from './job';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps } from './fill-sweep-plan';

const DEFAULT_RUNWAY_MM = 5;
const TEST_EPS_MM = 1e-9;

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
    fillRunwayPolicy: 'feed-matched-every-sweep',
    overscanMm: DEFAULT_RUNWAY_MM,
    segments,
  };
}

function legacyGroup(segments: ReadonlyArray<FillSegment>): FillGroup {
  return { ...group(segments), fillRunwayPolicy: 'legacy-skip' };
}

function expandedEndpoints(plan: ReturnType<typeof planFillSweeps>[number]) {
  const first = plan.sweep.spans[0];
  const last = plan.sweep.spans.at(-1);
  if (first === undefined || last === undefined) return null;
  return expandFillHatchWithRunways([first.start, last.end], plan);
}

function requiredPlan(
  plans: ReturnType<typeof planFillSweeps>,
  index: number,
): ReturnType<typeof planFillSweeps>[number] {
  const plan = plans[index];
  if (plan === undefined) throw new Error(`Expected fill sweep plan at index ${index}`);
  return plan;
}

describe('planFillSweeps', () => {
  it('gives every split sweep bounded feed-matched entry and exit motion', () => {
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
      { leadInMm: 5, leadOutMm: 4.8025, runwayMotion: 'feed-matched' },
      { leadInMm: 4.8025, leadOutMm: 5, runwayMotion: 'feed-matched' },
    ]);
    const firstRun = expandedEndpoints(requiredPlan(plans, 0));
    const secondRun = expandedEndpoints(requiredPlan(plans, 1));
    expect(firstRun?.leadEnd.x).toBeCloseTo(11.8175, 6);
    expect(secondRun?.leadStart.x).toBeCloseTo(11.8175, 6);
  });

  it.each([
    ['C 6.683 mm gap', 6.683],
    ['C 7.048 mm gap', 7.048],
    ['J 9.605 mm gap', 9.605],
  ])('shares the %s monotonically between the adjacent exit and entry', (_name, gapMm) => {
    const plans = planFillSweeps(group([seg(0, 0, 2, 0), seg(2 + gapMm, 0, 4 + gapMm, 0)]));
    const previous = requiredPlan(plans, 0);
    const next = requiredPlan(plans, 1);
    const previousRun = expandedEndpoints(previous);
    const nextRun = expandedEndpoints(next);

    expect(previous.leadOutMm).toBeCloseTo(gapMm / 2, 6);
    expect(next.leadInMm).toBeCloseTo(gapMm / 2, 6);
    expect(previousRun?.leadEnd.x).toBeCloseTo(nextRun?.leadStart.x ?? Number.NaN, 6);
  });

  it('applies the same split entry and exit monotonically on a reverse snake row', () => {
    const plans = planFillSweeps(
      group([reverseSeg(7.015, 43, 6.551, 43), reverseSeg(18.972, 43, 16.62, 43)]),
    );
    const firstRun = expandedEndpoints(requiredPlan(plans, 0));
    const secondRun = expandedEndpoints(requiredPlan(plans, 1));

    expect(firstRun?.leadStart.x).toBeCloseTo(23.972, 6);
    expect(firstRun?.leadEnd.x).toBeCloseTo(11.8175, 6);
    expect(secondRun?.leadStart.x).toBeCloseTo(11.8175, 6);
    expect(secondRun?.burnStart.x).toBeCloseTo(7.015, 6);
  });

  it('splits an internal runway gap symmetrically without overlap', () => {
    const segments = [seg(0, 0, 10, 0), seg(16, 0, 26, 0)];
    const legacy = planFillSweeps(legacyGroup(segments));
    const safe = planFillSweeps(group(segments));

    expect(legacy.map(({ leadOutMm, leadInMm }) => [leadOutMm, leadInMm])).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(safe.map(({ leadOutMm, leadInMm }) => [leadOutMm, leadInMm])).toEqual([
      [3, 5],
      [5, 3],
    ]);
    expect(expandedEndpoints(requiredPlan(safe, 0))?.leadEnd.x).toBe(13);
    expect(expandedEndpoints(requiredPlan(safe, 1))?.leadStart.x).toBe(13);
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
    if (second === undefined) throw new Error('Expected second Island Fill sweep');
    expect(expandedEndpoints(second)?.leadStart.x).toBe(10);
  });

  it('keeps explicitly requested legacy short-fragment behavior available to fixtures', () => {
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

  it('keeps a full feed-matched runway around a sub-millimetre triangle-tip sweep', () => {
    const plans = planFillSweeps(group([seg(10, 4, 10.47, 4)]));

    expect(plans).toEqual([
      expect.objectContaining({
        leadInMm: DEFAULT_RUNWAY_MM,
        leadOutMm: DEFAULT_RUNWAY_MM,
        runwayMotion: 'feed-matched',
      }),
    ]);
  });

  it('uses the bounded generic default instead of allowing a zero-runway powered start', () => {
    const plans = planFillSweeps({ ...group([seg(10, 4, 10.47, 4)]), overscanMm: 0 });

    expect(plans).toEqual([
      expect.objectContaining({
        leadInMm: DEFAULT_RUNWAY_MM,
        leadOutMm: DEFAULT_RUNWAY_MM,
        runwayMotion: 'feed-matched',
      }),
    ]);
  });

  it('preserves close-gap S0 bridging as one sweep with two powered spans', () => {
    const plans = planFillSweeps(group([seg(0, 0, 2, 0), seg(2.5, 0, 4, 0)]));
    const plan = requiredPlan(plans, 0);

    expect(plans).toHaveLength(1);
    expect(plan.sweep.spans).toHaveLength(2);
    expect({ leadInMm: plan.leadInMm, leadOutMm: plan.leadOutMm }).toEqual({
      leadInMm: DEFAULT_RUNWAY_MM,
      leadOutMm: DEFAULT_RUNWAY_MM,
    });
  });

  it('property: split-sweep runways stay monotonic and add no more than the available gap', () => {
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
          const totalRunwayMm = plans.reduce(
            (sum, plan) => sum + plan.leadInMm + plan.leadOutMm,
            0,
          );
          return (
            firstRun.burnEnd.x <= secondRun.leadStart.x + TEST_EPS_MM &&
            firstRun.leadEnd.x <= secondRun.leadStart.x + TEST_EPS_MM &&
            secondRun.leadStart.x <= secondRun.burnStart.x + TEST_EPS_MM &&
            first.leadOutMm <= DEFAULT_RUNWAY_MM &&
            second.leadInMm <= DEFAULT_RUNWAY_MM &&
            first.leadOutMm + second.leadInMm <= gapMm + TEST_EPS_MM &&
            totalRunwayMm <= 2 * DEFAULT_RUNWAY_MM * plans.length + TEST_EPS_MM
          );
        },
      ),
    );
  });
});
