import { describe, expect, it } from 'vitest';
import { polylineDeviationBounds } from '../../__fixtures__/polyline-deviation-bounds';
import { sampleCubics, type CubicBezier } from '../../core/geometry';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { simplifyTracedPathsForLaser } from './laser-trace-moves';

// 254 DPI import default: one trace pixel is 0.1 mm.
const PLACEMENT: Transform = { ...IDENTITY_TRANSFORM, scaleX: 0.1, scaleY: 0.1 };
const TOLERANCE_MM = 0.025;
const ORACLE_ERROR_MM = 1e-4;
// A 10 mm circle sampled every 1.5 trace pixels, as the finisher samples.
const RING_RADIUS_PX = 100;
const RING_SAMPLES = 420;
const MAX_RING_MOVES = 90;

function sampledRing(radius: number, samples: number): Polyline {
  const points: Vec2[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = (2 * Math.PI * index) / samples;
    points.push({ x: 150 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) });
  }
  points.push({ ...(points[0] as Vec2) });
  return { points, closed: true };
}

// A fitted ring as the finisher returns it: cubics, and their samples.
function fittedSubpath(): { readonly curve: CurveSubpath; readonly polyline: Polyline } {
  const cubics: CubicBezier[] = [
    { p0: { x: 10, y: 10 }, p1: { x: 40, y: -10 }, p2: { x: 60, y: 30 }, p3: { x: 30, y: 40 } },
    { p0: { x: 30, y: 40 }, p1: { x: 0, y: 50 }, p2: { x: -10, y: 20 }, p3: { x: 10, y: 10 } },
  ];
  const curve: CurveSubpath = {
    start: { x: 10, y: 10 },
    closed: true,
    segments: cubics.map((cubic) => ({
      kind: 'cubic',
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  };
  const points = sampleCubics(cubics, true);
  points.push({ ...(points[0] as Vec2) });
  return { curve, polyline: { points, closed: true } };
}

function inMm(points: ReadonlyArray<Vec2>, placement: Transform): Vec2[] {
  return points.map((point) => ({ x: point.x * placement.scaleX, y: point.y * placement.scaleY }));
}

describe('simplifyTracedPathsForLaser', () => {
  it('simplifies straight-segment subpaths and keeps fitted curves for compile', () => {
    const ring = sampledRing(RING_RADIUS_PX, RING_SAMPLES);
    const fitted = fittedSubpath();
    const path: ColoredPath = {
      color: '#000000',
      polylines: [fitted.polyline, ring],
      curves: [fitted.curve, polylineToCurveSubpath(ring)],
    };
    const [result] = simplifyTracedPathsForLaser([path], PLACEMENT);
    expect(result?.curves?.[0]).toBe(fitted.curve);
    // The scene stores what compile emits at this placement.
    expect(result?.polylines).toEqual(compilationPolylines(result as ColoredPath, PLACEMENT));
    expect(result?.polylines[0]?.points.length).toBeLessThan(fitted.polyline.points.length);
    const simplified = result?.polylines[1] as Polyline;
    expect(simplified.points.length - 1).toBeLessThanOrEqual(MAX_RING_MOVES);
    expect(simplified.closed).toBe(true);
    expect(result?.curves?.[1]).toEqual(polylineToCurveSubpath(simplified));
    const deviation = polylineDeviationBounds(
      inMm(ring.points, PLACEMENT),
      inMm(simplified.points, PLACEMENT),
      ORACLE_ERROR_MM,
    );
    expect(deviation.upperBound).toBeLessThanOrEqual(TOLERANCE_MM + ORACLE_ERROR_MM);
  });

  it('measures the tolerance at the placement the trace is committed with', () => {
    const ring = sampledRing(RING_RADIUS_PX, RING_SAMPLES);
    const path: ColoredPath = { color: '#000000', polylines: [ring] };
    const moves = (placement: Transform): number =>
      (simplifyTracedPathsForLaser([path], placement)[0]?.polylines[0]?.points.length ?? 0) - 1;
    expect(moves({ ...PLACEMENT, scaleX: 0.5, scaleY: 0.5 })).toBeGreaterThan(moves(PLACEMENT));
    const mirrored = { ...PLACEMENT, scaleX: -0.1, rotationDeg: 30, mirrorY: true };
    expect(simplifyTracedPathsForLaser([path], mirrored)).toEqual(
      simplifyTracedPathsForLaser([path], PLACEMENT),
    );
  });

  it('simplifies the polylines of a path without curves and adds none', () => {
    const ring = sampledRing(RING_RADIUS_PX, RING_SAMPLES);
    const [result] = simplifyTracedPathsForLaser(
      [{ color: '#000000', polylines: [ring] }],
      PLACEMENT,
    );
    expect(result?.curves).toBeUndefined();
    expect(result?.polylines[0]?.points.length).toBeLessThan(ring.points.length);
  });

  it('returns paths it cannot or need not change as they are', () => {
    const ring = sampledRing(RING_RADIUS_PX, RING_SAMPLES);
    const unpaired: ColoredPath = { color: '#000000', polylines: [ring, ring], curves: [] };
    const triangle: Polyline = {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    const minimal: ColoredPath = {
      color: '#000000',
      polylines: [triangle],
      curves: [polylineToCurveSubpath(triangle)],
    };
    const [first, second] = simplifyTracedPathsForLaser([unpaired, minimal], PLACEMENT);
    expect(first).toBe(unpaired);
    expect(second).toBe(minimal);
  });
});
