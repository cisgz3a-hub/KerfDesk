import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { pointInsideVCarveBoundary, vcarveEmissionConstraints } from './vcarve-cutting-constraints';
import {
  detailPath3dPlan,
  emittedChordIsSafe,
  sourceBoundarySegments,
  vcarveEmittedDepthAtPoint,
} from './vcarve-detail-depth';
import { vcarveMedialPasses } from './vcarve-medial';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};
const POINTED = { tanHalf: 1, tipRadiusMm: 0, outerRadiusMm: 10, maxDepthMm: 10 };

describe('V-carve represented containment', () => {
  it('distinguishes the filled side, holes and distant exterior points', () => {
    const hole: Polyline = {
      closed: true,
      points: [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
    };
    const boundary = sourceBoundarySegments([SQUARE, hole]);
    expect(pointInsideVCarveBoundary({ x: 1, y: 5 }, boundary)).toBe(true);
    expect(pointInsideVCarveBoundary({ x: 5, y: 5 }, boundary)).toBe(false);
    expect(pointInsideVCarveBoundary({ x: 11, y: 5 }, boundary)).toBe(false);
    expect(pointInsideVCarveBoundary({ x: -1, y: 5 }, boundary)).toBe(false);
    expect(pointInsideVCarveBoundary({ x: 5, y: -1 }, boundary)).toBe(false);
    expect(pointInsideVCarveBoundary({ x: Number.NaN, y: 5 }, boundary)).toBe(false);
  });

  it('does not turn an outward-rounded tiny-triangle route into an exterior cut', () => {
    const triangle: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 0.01, y: 0.007 },
        { x: 0.01, y: 0.009 },
      ],
    };
    const plan = vcarveMedialPasses([triangle], {
      tool: { id: 'v30', name: 'V30', kind: 'v-bit', diameterMm: 6, tipAngleDeg: 30 },
      maxDepthMm: 10,
      depthPerPassMm: 10,
      resolutionMm: 0,
    });
    const boundary = sourceBoundarySegments([triangle]);
    const law = {
      ...POINTED,
      tanHalf: Math.tan(Math.PI / 12),
      ...vcarveEmissionConstraints(POINTED),
    };
    expect(vcarveEmittedDepthAtPoint({ x: 0.002, y: 0.001 }, boundary, law)).toBe(0);
    expect(
      emittedChordIsSafe(
        { x: 0.002, y: 0.001 },
        { x: 0.003, y: 0.002 },
        0.001,
        0.001,
        boundary,
        law,
      ),
    ).toBe(false);
    for (const pass of plan.passes) {
      if (pass.kind !== 'path3d') continue;
      for (const point of pass.points) {
        if (point.z < 0) expect(pointInsideVCarveBoundary(point, boundary)).toBe(true);
      }
    }
    expect(plan.passLimited || plan.thinResidual).toBe(true);
  });

  it('rejects a long chord crossing a microscopic hole without polynomial cancellation', () => {
    const size = 1_000_000;
    const centre = size / 2;
    const halfHole = 0.003;
    const box = (low: number, high: number): Polyline => ({
      closed: true,
      points: [
        { x: low, y: low },
        { x: high, y: low },
        { x: high, y: high },
        { x: low, y: high },
      ],
    });
    const boundary = sourceBoundarySegments([
      box(0, size),
      box(centre - halfHole, centre + halfHole),
    ]);
    const law = { ...POINTED, ...vcarveEmissionConstraints(POINTED) };
    expect(
      emittedChordIsSafe(
        { x: 1, y: centre },
        { x: size - 1, y: centre },
        0.001,
        0.001,
        boundary,
        law,
      ),
    ).toBe(false);
  });

  it.each([0, 0.4])(
    'refines a hidden interior peak even when both endpoint depths are zero (tip radius %s)',
    (tipRadiusMm) => {
      const route: Polyline = {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      };
      const result = detailPath3dPlan(
        route,
        sourceBoundarySegments([SQUARE]),
        { ...POINTED, tipRadiusMm },
        0.01,
      );
      expect(result.toleranceMet).toBe(true);
      expect(Math.min(...result.points.map((point) => point.z))).toBeLessThan(
        -(5 - tipRadiusMm) + 0.01,
      );
      expect(result.points.length).toBeGreaterThan(2);
    },
  );
});
