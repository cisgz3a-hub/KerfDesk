import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cloneWeldWorkChain,
  denseWeldChains,
  referenceWeldPairs,
  staleCandidateWeldChains,
  translatedRingWeldChains,
  weldPairSegment,
} from '../../__fixtures__/weld-pair-fixtures';
import type { Polyline, Vec2 } from '../scene';
import { bestWeldEndpointMatch } from './weld-pair-selector';
import { weldOpenPolylines } from './weld-open-polylines';
import { weldPairs, type WeldWorkChain } from './weld-pairs';

const MAX_GAP_PX = 5;
const TANGENT_SAMPLE_PX = 3;
const ENDPOINT_COMBINATIONS_PER_PAIR = 4;
const PROPERTY_RUNS = 1_000;
const PROPERTY_SEED = 20_260_728;
const MAX_PROPERTY_CHAINS = 8;
const MIN_COORDINATE = -20;
const MAX_COORDINATE = 20;
const MIN_SEGMENT_LENGTH = 1;
const MAX_SEGMENT_LENGTH = 6;
const DENSE_CHAIN_COUNT = 300;
const EXPECTED_STALE_X_SEQUENCE = [0, 1, 2, 3, 4, 5];
const HUGE_SECOND_START_Y = 2;
const HUGE_SECOND_END_Y = 3;
const PAIR_FIXTURE_CHAIN_COUNT = 2;
const ENDPOINT_TIE_DISTANCE_PX = 4;
const DENSE_TANGENT_QUADRATIC_FACTOR = 2;
const DENSE_TANGENT_LINEAR_FACTOR = 2;
const DENSE_TANGENT_OFFSET = 2;
const ROUNDED_THRESHOLD_MM_PER_PX = 0.125;
const ROUNDED_THRESHOLD_MAX_GAP_MM = 0.5;
const ROUNDED_THRESHOLD_LEFT_END_X = 3.9999999999999996;
const ROUNDED_THRESHOLD_SEGMENT_LENGTH_PX = 3;
const ROUNDED_THRESHOLD_RIGHT_START_X = 8;
const ROUNDED_THRESHOLD_RIGHT_END_X = 11;
const ROUNDED_THRESHOLD_GAP_PX = 4;
const HUGE_EXACT_COORDINATE = Number.MAX_SAFE_INTEGER - 1;
const HUGE_COORDINATE_GAP_PX = 1;
const ENDPOINT_TIE_A_POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];
const ENDPOINT_TIE_B_POINTS: ReadonlyArray<Vec2> = [
  { x: 14, y: 0 },
  { x: 15, y: 0 },
  { x: 17, y: 0 },
  { x: -7, y: 0 },
  { x: -5, y: 0 },
  { x: -4, y: 0 },
];

type SegmentSpec = {
  readonly x: number;
  readonly y: number;
  readonly direction: Vec2;
  readonly length: number;
};

type InputOrderCase = {
  readonly label: string;
  readonly isReversed: boolean;
};

const INPUT_ORDER_CASES: ReadonlyArray<InputOrderCase> = [
  { label: 'original', isReversed: false },
  { label: 'reversed', isReversed: true },
];

const DIRECTION_ARBITRARY = fc.constantFrom<Vec2>(
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
);

const SEGMENT_SPEC_ARBITRARY = fc.record({
  x: fc.integer({ min: MIN_COORDINATE, max: MAX_COORDINATE }),
  y: fc.integer({ min: MIN_COORDINATE, max: MAX_COORDINATE }),
  direction: DIRECTION_ARBITRARY,
  length: fc.integer({ min: MIN_SEGMENT_LENGTH, max: MAX_SEGMENT_LENGTH }),
});

function chainFromSpec(spec: SegmentSpec, order: number): WeldWorkChain {
  return weldPairSegment({
    order,
    x0: spec.x,
    y0: spec.y,
    x1: spec.x + spec.direction.x * spec.length,
    y1: spec.y + spec.direction.y * spec.length,
  });
}

describe('weldPairs', () => {
  it('matches the exhaustive legacy selector across seeded small fixtures', () => {
    fc.assert(
      fc.property(
        fc.array(SEGMENT_SPEC_ARBITRARY, { maxLength: MAX_PROPERTY_CHAINS }),
        fc.integer({ min: MIN_SEGMENT_LENGTH, max: MAX_SEGMENT_LENGTH }),
        (specs, maxGapPx) => {
          const input = specs.map(chainFromSpec);
          const actual = weldPairs(input, maxGapPx, TANGENT_SAMPLE_PX);
          const expected = referenceWeldPairs(input, maxGapPx, TANGENT_SAMPLE_PX);
          expect(actual.chains).toEqual(expected);
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });

  it('preserves equal-gap ordering while invalidating stale candidates after each merge', () => {
    const input = staleCandidateWeldChains();

    const result = weldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX);

    expect(result.chains).toEqual(referenceWeldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX));
    expect(result.chains[0]?.points).toEqual(EXPECTED_STALE_X_SEQUENCE.map((x) => ({ x, y: 0 })));
  });

  it('preserves start-before-end ordering when endpoint distances tie', () => {
    const match = bestWeldEndpointMatch(
      { points: ENDPOINT_TIE_A_POINTS, order: 0 },
      { points: ENDPOINT_TIE_B_POINTS, order: 1 },
      MAX_GAP_PX,
      TANGENT_SAMPLE_PX,
    );

    expect(match).toEqual({
      aEnd: 'start',
      bEnd: 'end',
      dist: ENDPOINT_TIE_DISTANCE_PX,
    });
  });

  it('retains every fragmented-ring candidate after heap bubbling', () => {
    const input = translatedRingWeldChains();
    const result = weldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX);

    expect(result.chains).toEqual(referenceWeldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX));
    expect(result.chains).toHaveLength(1);
  });

  it('does not mutate caller-owned chains or point arrays', () => {
    const input = staleCandidateWeldChains().slice(0, PAIR_FIXTURE_CHAIN_COUNT);
    const before = input.map(cloneWeldWorkChain);

    weldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX);

    expect(input).toEqual(before);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'preserves exhaustive compatibility for an unusual gap %s',
    (maxGapPx) => {
      const input = staleCandidateWeldChains().slice(0, PAIR_FIXTURE_CHAIN_COUNT);
      const result = weldPairs(input, maxGapPx, TANGENT_SAMPLE_PX);

      expect(result.stats.strategy).toBe('persistent-heap');
      expect(result.chains).toEqual(referenceWeldPairs(input, maxGapPx, TANGENT_SAMPLE_PX));
    },
  );

  it('preserves exact compatibility at huge coordinates', () => {
    const hugeCoordinate = Number.MAX_VALUE;
    const input = [
      weldPairSegment({
        order: 0,
        x0: hugeCoordinate,
        y0: 0,
        x1: hugeCoordinate,
        y1: 1,
      }),
      weldPairSegment({
        order: 1,
        x0: hugeCoordinate,
        y0: HUGE_SECOND_START_Y,
        x1: hugeCoordinate,
        y1: HUGE_SECOND_END_Y,
      }),
    ];
    const result = weldPairs(input, Number.MIN_VALUE, TANGENT_SAMPLE_PX);

    expect(result.stats.strategy).toBe('persistent-heap');
    expect(result.chains).toEqual(referenceWeldPairs(input, Number.MIN_VALUE, TANGENT_SAMPLE_PX));
  });

  it.each(INPUT_ORDER_CASES)(
    'finds a rounded exact-threshold pair in $label input order',
    ({ isReversed }) => {
      const input = roundedThresholdChains();
      const ordered = isReversed ? reversedChains(input) : input;
      const result = weldPairs(ordered, ROUNDED_THRESHOLD_GAP_PX, TANGENT_SAMPLE_PX);

      expect(result.stats.strategy).toBe('persistent-heap');
      expect(result.chains).toEqual(
        referenceWeldPairs(ordered, ROUNDED_THRESHOLD_GAP_PX, TANGENT_SAMPLE_PX),
      );
      expect(result.chains).toHaveLength(1);
      expect(
        weldOpenPolylines(ordered.map(polylineFromChain), {
          mmPerPx: ROUNDED_THRESHOLD_MM_PER_PX,
          maxGapMm: ROUNDED_THRESHOLD_MAX_GAP_MM,
        }),
      ).toHaveLength(1);
    },
  );

  it('preserves exact selection at huge coordinates without coordinate bucketing', () => {
    const input = [
      weldPairSegment({
        order: 0,
        x0: HUGE_EXACT_COORDINATE - 1,
        y0: 0,
        x1: HUGE_EXACT_COORDINATE,
        y1: 0,
      }),
      weldPairSegment({
        order: 1,
        x0: HUGE_EXACT_COORDINATE,
        y0: 0,
        x1: HUGE_EXACT_COORDINATE + 1,
        y1: 0,
      }),
    ];
    const result = weldPairs(input, HUGE_COORDINATE_GAP_PX, TANGENT_SAMPLE_PX);

    expect(result.stats.strategy).toBe('persistent-heap');
    expect(result.chains).toEqual(
      referenceWeldPairs(input, HUGE_COORDINATE_GAP_PX, TANGENT_SAMPLE_PX),
    );
  });

  it('bounds dense-connectable candidate evaluation without a timing threshold', () => {
    const input = denseWeldChains(DENSE_CHAIN_COUNT);
    const result = weldPairs(input, MAX_GAP_PX, TANGENT_SAMPLE_PX);
    const activeMerges = DENSE_CHAIN_COUNT - 1;
    const pairBound = activeMerges * activeMerges;
    const tangentVisitBound =
      DENSE_TANGENT_QUADRATIC_FACTOR * DENSE_CHAIN_COUNT * DENSE_CHAIN_COUNT +
      DENSE_TANGENT_LINEAR_FACTOR * DENSE_CHAIN_COUNT -
      DENSE_TANGENT_OFFSET;

    expect(result.stats.strategy).toBe('persistent-heap');
    expect(result.chains).toHaveLength(1);
    expect(result.stats.pairEvaluations).toBe(pairBound);
    expect(result.stats.endpointEvaluations).toBe(
      result.stats.pairEvaluations * ENDPOINT_COMBINATIONS_PER_PAIR,
    );
    expect(result.stats.continuityDescriptorBuilds).toBe(DENSE_CHAIN_COUNT + activeMerges);
    expect(result.stats.tangentPointVisits).toBeLessThanOrEqual(tangentVisitBound);
  });
});

function roundedThresholdChains(): WeldWorkChain[] {
  return [
    weldPairSegment({
      order: 0,
      x0: ROUNDED_THRESHOLD_LEFT_END_X - ROUNDED_THRESHOLD_SEGMENT_LENGTH_PX,
      y0: 0,
      x1: ROUNDED_THRESHOLD_LEFT_END_X,
      y1: 0,
    }),
    weldPairSegment({
      order: 1,
      x0: ROUNDED_THRESHOLD_RIGHT_START_X,
      y0: 0,
      x1: ROUNDED_THRESHOLD_RIGHT_END_X,
      y1: 0,
    }),
  ];
}

function reversedChains(chains: ReadonlyArray<WeldWorkChain>): ReadonlyArray<WeldWorkChain> {
  return chains.flatMap((_, index) => {
    const chain = chains.at(-index - 1);
    return chain === undefined ? [] : [chain];
  });
}

function polylineFromChain(chain: WeldWorkChain): Polyline {
  return { points: chain.points, closed: false };
}
