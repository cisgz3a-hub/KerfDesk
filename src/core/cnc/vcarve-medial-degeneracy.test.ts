import { describe, expect, it } from 'vitest';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';
import { computeVCarveMedialAxis, type VCarveMedialAxisPlan } from './vcarve-medial-axis';
import { vcarveMedialSampleBudget } from './vcarve-medial-budget';
import {
  pointInOrOnVCarveRegion,
  vcarveBoundarySegments,
  vcarveChordInsideRegion,
  vcarveMedialRegionsFromTree,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

const EXTREMELY_FINE_RESOLUTION_MM = 0.000_001;
const COARSE_RESOLUTION_MM = 1;
const ISSUE_FIXTURE_RESOLUTION_MM = 0.001;
const LARGE_BOUNDARY_SEGMENT_COUNT = 4_097;
const VERY_LARGE_BOUNDARY_SEGMENT_COUNT = 150_000;
const SHARP_CORNER_STRESS_SEGMENT_COUNT = 60_000;
const DEEP_NESTING_CONTOUR_COUNT = 3_000;
const SAMPLE_BUDGET = 4_096;

const DELAUNATOR_ISSUE_91_POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 30.51591076416662, y: -5.272057753973058 },
  { x: 13.955446995823877, y: 16.74653639495955 },
  { x: 22.3355613751919, y: -3.8587860099360114 },
];

const DELAUNATOR_ISSUE_94_POINTS: ReadonlyArray<Vec2> = [
  { x: 0, y: 0 },
  { x: 0.05626429153399996, y: 0 },
  { x: 0.024093852080076722, y: 4.80267923973791e-18 },
  { x: 0.01379050745122589, y: 0.1463775332929564 },
  { x: 0.05177587092034522, y: 0.015468457826306506 },
  { x: 0.024093852080076705, y: -5.204170427930421e-18 },
];

function closedPolyline(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points };
}

function rectangle(width: number, height: number): Polyline {
  return closedPolyline([
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]);
}

function regularPolygon(pointCount: number, radius: number): Polyline {
  return closedPolyline(
    Array.from({ length: pointCount }, (_, index) => {
      const angle = (index / pointCount) * Math.PI * 2;
      return { x: radius + Math.cos(angle) * radius, y: radius + Math.sin(angle) * radius };
    }),
  );
}

function onlyRegion(contour: Polyline): VCarveMedialRegion {
  const normalized = normalizeClosedPolylineTreeEvenOddChecked([contour]);
  expect(normalized.kind).toBe('ok');
  if (normalized.kind !== 'ok') throw new Error('Expected normalized V-carve contour.');
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (region === undefined) throw new Error('Expected one normalized V-carve region.');
  return region;
}

function expectFiniteDeterministicPlan(
  region: VCarveMedialRegion,
  resolutionMm: number,
): VCarveMedialAxisPlan {
  const first = computeVCarveMedialAxis(region, resolutionMm);
  const second = computeVCarveMedialAxis(region, resolutionMm);

  expect(first.failed).toBe(false);
  expect(first.graph.nodes.length).toBeGreaterThan(0);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  expect(
    first.graph.nodes.every(
      ({ x, y, clearanceMm }) =>
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(clearanceMm),
    ),
  ).toBe(true);
  expect(
    first.graph.adjacency.every((neighbors) =>
      neighbors.every((neighbor) => neighbor >= 0 && neighbor < first.graph.nodes.length),
    ),
  ).toBe(true);
  return first;
}

function expectCertifiedGraphChords(region: VCarveMedialRegion, plan: VCarveMedialAxisPlan): void {
  const segments = vcarveBoundarySegments(region);
  expect(plan.graph.nodes.every((node) => pointInOrOnVCarveRegion(node, region, segments))).toBe(
    true,
  );
  plan.graph.adjacency.forEach((neighbors, index) => {
    const from = plan.graph.nodes[index];
    if (from === undefined) return;
    for (const neighbor of neighbors) {
      const to = plan.graph.nodes[neighbor];
      if (to !== undefined) expect(vcarveChordInsideRegion(from, to, region, segments)).toBe(true);
    }
  });
}

describe('V-carve medial degeneracy regressions', () => {
  it.each([
    { segmentCount: 1_953, expected: 4_096 },
    { segmentCount: 2_000, expected: 4_000 },
    { segmentCount: 4_096, expected: 1_953 },
    { segmentCount: 4_097, expected: 1_952 },
  ])(
    'keeps the boundary-work product capped at $segmentCount source segments',
    ({ segmentCount, expected }) => {
      const budget = vcarveMedialSampleBudget(segmentCount);

      expect(budget).toBe(expected);
      expect(budget * segmentCount).toBeLessThanOrEqual(8_000_000);
    },
  );

  it('caps an extremely fine requested boundary resolution deterministically', () => {
    const region = onlyRegion(rectangle(12, 4));
    const plan = expectFiniteDeterministicPlan(region, EXTREMELY_FINE_RESOLUTION_MM);

    expect(plan.budgetLimited).toBe(true);
    expect(plan.resolutionMm).toBeGreaterThan(EXTREMELY_FINE_RESOLUTION_MM);
    expect(plan.graph.nodes.length).toBeLessThan(SAMPLE_BUDGET);
  });

  it('caps a source boundary containing more than 4096 segments', () => {
    const region = onlyRegion(regularPolygon(LARGE_BOUNDARY_SEGMENT_COUNT, 10));
    expect(vcarveBoundarySegments(region)).toHaveLength(LARGE_BOUNDARY_SEGMENT_COUNT);

    const plan = expectFiniteDeterministicPlan(region, COARSE_RESOLUTION_MM);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.graph.nodes.length).toBeLessThan(SAMPLE_BUDGET);
  });

  it('does not overflow before budgeting a 150000-segment boundary', () => {
    const region = onlyRegion(regularPolygon(VERY_LARGE_BOUNDARY_SEGMENT_COUNT, 10));
    const plan = computeVCarveMedialAxis(region, COARSE_RESOLUTION_MM);

    expect(plan.failed).toBe(false);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.graph.nodes.length).toBeGreaterThan(0);
    expect(
      plan.graph.nodes.every(
        ({ x, y, clearanceMm }) =>
          Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(clearanceMm),
      ),
    ).toBe(true);
  }, 20_000);

  it('bounds sharp-corner linking on a high-vertex outer contour with a hole', () => {
    const contours = [
      regularPolygon(SHARP_CORNER_STRESS_SEGMENT_COUNT, 10),
      closedPolyline([
        { x: 9, y: 9 },
        { x: 11, y: 9 },
        { x: 11, y: 11 },
        { x: 9, y: 11 },
      ]),
    ];
    const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);
    expect(normalized.kind).toBe('ok');
    if (normalized.kind !== 'ok') return;
    const region = vcarveMedialRegionsFromTree(normalized.value)[0];
    if (region === undefined) throw new Error('Expected one filled region around the hole.');

    const plan = computeVCarveMedialAxis(region, COARSE_RESOLUTION_MM);

    expect(plan.failed).toBe(false);
    expect(plan.budgetLimited).toBe(true);
    expect(plan.graph.nodes.length).toBeGreaterThan(0);
  }, 15_000);

  it('does not overflow while materializing 3000 nested Clipper contours', () => {
    const span = DEEP_NESTING_CONTOUR_COUNT * 2;
    const contours = Array.from({ length: DEEP_NESTING_CONTOUR_COUNT }, (_, inset) =>
      closedPolyline([
        { x: inset, y: inset },
        { x: span - inset, y: inset },
        { x: span - inset, y: span - inset },
        { x: inset, y: span - inset },
      ]),
    );
    const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);

    expect(normalized.kind).toBe('ok');
    if (normalized.kind !== 'ok') return;
    expect(normalized.value).toHaveLength(DEEP_NESTING_CONTOUR_COUNT);
    expect(vcarveMedialRegionsFromTree(normalized.value)).toHaveLength(
      DEEP_NESTING_CONTOUR_COUNT / 2,
    );
  }, 20_000);

  it('handles the Delaunator issue 91 collinear-point fixture deterministically', () => {
    // Upstream reproduction: https://github.com/mapbox/delaunator/issues/91
    const [first, second, third, collinear] = DELAUNATOR_ISSUE_91_POINTS;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      collinear === undefined
    ) {
      throw new Error('Expected the complete Delaunator issue 91 fixture.');
    }
    const region = onlyRegion(closedPolyline([first, collinear, second, third]));
    const plan = expectFiniteDeterministicPlan(region, ISSUE_FIXTURE_RESOLUTION_MM);

    expectCertifiedGraphChords(region, plan);
  });

  it('handles the Delaunator issue 94 near-duplicate fixture deterministically', () => {
    // Upstream reproduction: https://github.com/mapbox/delaunator/issues/94
    const [origin, right, nearAbove, upperLeft, upperRight, nearBelow] = DELAUNATOR_ISSUE_94_POINTS;
    if (
      origin === undefined ||
      right === undefined ||
      nearAbove === undefined ||
      upperLeft === undefined ||
      upperRight === undefined ||
      nearBelow === undefined
    ) {
      throw new Error('Expected the complete Delaunator issue 94 fixture.');
    }
    const region = onlyRegion(
      closedPolyline([origin, nearBelow, nearAbove, right, upperRight, upperLeft]),
    );
    const plan = expectFiniteDeterministicPlan(region, ISSUE_FIXTURE_RESOLUTION_MM);

    expectCertifiedGraphChords(region, plan);
  });
});
