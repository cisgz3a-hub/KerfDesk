import { describe, expect, it } from 'vitest';
import { maximumPointDistanceToPolyline } from '../../__fixtures__/polyline-distance';
import {
  flattenCurveSubpath,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Vec2,
} from '../scene';
import { sampleCubics, type CubicBezier } from './fit-cubics';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { curvedTraceRing, scaleTracedPaths, withCanonicalTraceCurves } from './trace-curves';

const LOOP: ReadonlyArray<CubicBezier> = [
  { p0: { x: 10, y: 10 }, p1: { x: 40, y: -10 }, p2: { x: 60, y: 30 }, p3: { x: 30, y: 40 } },
  { p0: { x: 30, y: 40 }, p1: { x: 0, y: 50 }, p2: { x: -10, y: 20 }, p3: { x: 10, y: 10 } },
];
const SIZE = 128;
const CX = 64.25;
const CY = 63.7;
const DISC_RADIUS = 48.6;
const COVERAGE_GRID = 8;
// Samples lie on their cubics; a fine flattening is within this of the curve.
const ON_CURVE_PX = 1e-3;
const FINE_FLATTENING_PX = 1e-4;

function curveOf(cubics: ReadonlyArray<CubicBezier>): CurveSubpath {
  return {
    start: (cubics[0] as CubicBezier).p0,
    closed: true,
    segments: cubics.map((cubic) => ({
      kind: 'cubic',
      control1: cubic.p1,
      control2: cubic.p2,
      to: cubic.p3,
    })),
  };
}

function withRing(points: Vec2[]): ColoredPath {
  return { color: '#000000', polylines: [{ points, closed: true }] };
}

function antialiasedDisc(): RawImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < COVERAGE_GRID; sy += 1) {
        for (let sx = 0; sx < COVERAGE_GRID; sx += 1) {
          const r = Math.hypot(
            x + (sx + 0.5) / COVERAGE_GRID - CX,
            y + (sy + 0.5) / COVERAGE_GRID - CY,
          );
          if (r <= DISC_RADIUS) covered += 1;
        }
      }
      const value = Math.round(255 * (1 - covered / COVERAGE_GRID ** 2));
      data.set([value, value, value, 255], 4 * (y * SIZE + x));
    }
  }
  return { width: SIZE, height: SIZE, data };
}

describe('canonical trace curves', () => {
  it('keeps the curve a ring carries and emits plain polylines', () => {
    const curve = curveOf(LOOP);
    const points = [...sampleCubics(LOOP, true), LOOP[0]?.p0 as Vec2];
    const [path] = withCanonicalTraceCurves([
      { color: '#000000', polylines: [curvedTraceRing(points, curve)] },
    ]);
    expect(path?.curves).toEqual([curve]);
    // The carried curve is not stored twice on the output polyline.
    expect(path?.polylines).toEqual([{ points, closed: true }]);
    expect(Object.keys(path?.polylines[0] ?? {})).toEqual(['points', 'closed']);
  });

  it('falls back to straight segments over a ring a later stage rebuilt', () => {
    const ring = curvedTraceRing(sampleCubics(LOOP, true), curveOf(LOOP));
    const rebuilt = { points: ring.points, closed: true };
    const [path] = withCanonicalTraceCurves([withRing(rebuilt.points.slice())]);
    expect(path?.curves).toEqual([
      polylineToCurveSubpath({ points: rebuilt.points, closed: true }),
    ]);
  });

  it('keeps curves a path already carries', () => {
    const curves = [curveOf(LOOP)];
    const path: ColoredPath = { ...withRing(sampleCubics(LOOP, true)), curves };
    expect(withCanonicalTraceCurves([path])[0]?.curves).toBe(curves);
  });

  it('maps carried curves exactly with independent axis scales', () => {
    const curve = curveOf(LOOP);
    const ring = curvedTraceRing([...sampleCubics(LOOP, true), LOOP[0]?.p0 as Vec2], curve);
    const [path] = withCanonicalTraceCurves([withRing(ring.points.slice())]).map((p) => ({
      ...p,
      curves: [curve],
    }));
    const [scaled] = scaleTracedPaths([path as ColoredPath], 2, 3);
    const map = (p: Vec2): Vec2 => ({ x: p.x * 2, y: p.y * 3 });
    expect(scaled?.curves?.[0]).toEqual({
      start: map(curve.start),
      closed: true,
      segments: LOOP.map((cubic) => ({
        kind: 'cubic',
        control1: map(cubic.p1),
        control2: map(cubic.p2),
        to: map(cubic.p3),
      })),
    });
    expect(scaled?.polylines[0]?.points).toEqual(ring.points.map(map));
  });

  it('carries a measured contour cubics to the traced path', async () => {
    const preset = TRACE_PRESETS['Line Art'];
    if (preset === undefined) throw new Error('expected the Line Art preset');
    const paths = await traceImageToColoredPaths(antialiasedDisc(), preset);
    const subpaths = paths.flatMap((path) =>
      path.polylines.map((polyline, index) => ({ polyline, curve: path.curves?.[index] })),
    );
    const fitted = subpaths.filter(({ curve }) => curve?.segments.some((s) => s.kind === 'cubic'));
    expect(fitted.length).toBeGreaterThan(0);
    for (const { polyline, curve } of fitted) {
      if (curve === undefined) throw new Error('expected a curve');
      expect(curve.closed).toBe(true);
      expect(polyline.closed).toBe(true);
      expect(polyline.points[0]).toEqual(curve.start);
      // The compatibility polyline is samples of these very cubics: every
      // joint is one of its vertices and every vertex lies on the curve.
      for (const joint of curve.segments.map((segment) => segment.to)) {
        expect(polyline.points).toContainEqual(joint);
      }
      const fine = flattenCurveSubpath(curve, { toleranceMm: FINE_FLATTENING_PX });
      if (fine.kind !== 'ok') throw new Error('expected a flattened curve');
      expect(maximumPointDistanceToPolyline(polyline.points, fine.polyline.points)).toBeLessThan(
        ON_CURVE_PX,
      );
    }
  });
});
