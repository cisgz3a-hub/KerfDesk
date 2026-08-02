import { describe, expect, it } from 'vitest';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { Polyline, Vec2 } from '../scene';
import { computeVCarveMedialAxis } from './vcarve-medial-axis';
import {
  detailPath3dPlan,
  sourceBoundarySegments,
  type BoundarySegment,
  type DetailDepthLaw,
} from './vcarve-detail-depth';
import {
  vcarveBoundarySegments,
  vcarveMedialRegionsFromTree,
  type VCarveMedialRegion,
} from './vcarve-medial-region';
import { vcarveMedialRoutes } from './vcarve-medial-route';
import { vcarveMedialPasses } from './vcarve-medial';

const TEST_RESOLUTION_MM = 0.25;
const SIMPLIFY_TOLERANCE_MM = 0.02;
const MEDIAL_Z_TOLERANCE_MM = 0.05;
const INTERPOLATION_STEPS = 32;
const NUMERIC_EPSILON_MM = 1e-9;
const CONCURRENT_TEST_TIMEOUT_MS = 30_000;

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

function onlyRegion(contours: ReadonlyArray<Polyline>): VCarveMedialRegion {
  const normalized = normalizeClosedPolylineTreeEvenOddChecked(contours);
  expect(normalized.kind).toBe('ok');
  if (normalized.kind !== 'ok') throw new Error('Expected normalized V-carve contours.');
  const regions = vcarveMedialRegionsFromTree(normalized.value);
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (region === undefined) throw new Error('Expected one normalized V-carve region.');
  return region;
}

function analyticZ(
  point: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): number {
  let distanceMm = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - segment.ax) * dx + (point.y - segment.ay) * dy) / lengthSquared,
            ),
          );
    distanceMm = Math.min(
      distanceMm,
      Math.hypot(point.x - (segment.ax + t * dx), point.y - (segment.ay + t * dy)),
    );
  }
  return -Math.min(distanceMm / law.tanHalf, law.maxDepthMm);
}

function expectRoundedProfileIsConservative(
  points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): void {
  const emitted = points.map((point) => ({
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
    z: Number(point.z.toFixed(3)),
  }));
  for (let index = 1; index < emitted.length; index += 1) {
    const from = emitted[index - 1];
    const to = emitted[index];
    if (from === undefined || to === undefined) continue;
    for (let sample = 0; sample <= INTERPOLATION_STEPS; sample += 1) {
      const t = sample / INTERPOLATION_STEPS;
      const point = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
      const emittedZ = from.z + (to.z - from.z) * t;
      const expectedZ = analyticZ(point, segments, law);
      expect(emittedZ).toBeGreaterThanOrEqual(expectedZ - NUMERIC_EPSILON_MM);
      expect(emittedZ).toBeLessThanOrEqual(NUMERIC_EPSILON_MM);
      expect(emittedZ).toBeGreaterThanOrEqual(-law.maxDepthMm - NUMERIC_EPSILON_MM);
    }
  }
}

describe('V-carve emitted depth law', () => {
  it.each([
    { widthMm: 0.05, resolutionMm: 0 },
    { widthMm: 0.1, resolutionMm: 0.25 },
    { widthMm: 0.2, resolutionMm: 1 },
  ])(
    'keeps a $widthMm mm annulus connected at $resolutionMm mm requested detail',
    ({ widthMm, resolutionMm }) => {
      const contours = [
        rectangle(0, 0, 10, 10),
        rectangle(widthMm, widthMm, 10 - widthMm, 10 - widthMm),
      ];
      const plan = vcarveMedialPasses(contours, {
        tool: {
          id: 'v90',
          name: '90 degree V-bit',
          kind: 'v-bit',
          diameterMm: 6,
          tipAngleDeg: 90,
        },
        maxDepthMm: Number.POSITIVE_INFINITY,
        depthPerPassMm: 10,
        resolutionMm,
      });

      expect(plan.offsetFailed).toBe(false);
      expect(plan.thinResidual).toBe(false);
      expect(plan.passLimited).toBe(false);
      expect(plan.passes).toHaveLength(1);
      const pass = plan.passes[0];
      expect(pass?.kind).toBe('path3d');
      if (pass?.kind !== 'path3d') throw new Error('Expected one connected annulus route.');
      const deepestMm = -Math.min(...pass.points.map((point) => point.z));
      expect(deepestMm).toBeGreaterThanOrEqual(widthMm / 2 - 0.003);
      const cornerRadiusMm = (Math.SQRT2 / (1 + Math.SQRT2)) * widthMm;
      expect(deepestMm).toBeLessThanOrEqual(cornerRadiusMm + 0.002);
      expectRoundedProfileIsConservative(pass.points, sourceBoundarySegments(contours), {
        tanHalf: 1,
        maxDepthMm: 3,
      });
    },
    CONCURRENT_TEST_TIMEOUT_MS,
  );

  it('stays within the analytic depth law after 0.001 mm XYZ emission rounding', () => {
    const region = onlyRegion([rectangle(0, 0, 12, 4)]);
    const exactSegments = vcarveBoundarySegments(region);
    const depthSegments = sourceBoundarySegments(region.loops);
    const law = { tanHalf: 1, maxDepthMm: 3 };
    const axis = computeVCarveMedialAxis(region, TEST_RESOLUTION_MM);
    const routes = vcarveMedialRoutes(axis.graph, region, exactSegments, SIMPLIFY_TOLERANCE_MM);

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const profile = detailPath3dPlan(route, depthSegments, law, MEDIAL_Z_TOLERANCE_MM);
      expect(profile.toleranceMet).toBe(true);
      expect(profile.points.length).toBeGreaterThan(1);
      expectRoundedProfileIsConservative(profile.points, depthSegments, law);
    }
  });
});
