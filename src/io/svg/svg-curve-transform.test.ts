import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type CurveSubpath,
} from '../../core/scene';
import { transformSvgCurveSubpath } from './svg-curve-transform';

describe('transformSvgCurveSubpath', () => {
  it('applies an affine transform to cubic controls and endpoints', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 1, y: 2 },
          control2: { x: 3, y: 4 },
          to: { x: 5, y: 6 },
        },
      ],
      closed: false,
    };
    expect(transformSvgCurveSubpath(curve, { a: 2, b: 0, c: 0, d: 3, e: 7, f: 11 })).toEqual({
      start: { x: 7, y: 11 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 9, y: 17 },
          control2: { x: 13, y: 23 },
          to: { x: 17, y: 29 },
        },
      ],
      closed: false,
    });
  });

  it('keeps transformed arcs curve-native as cubic segments', () => {
    const curve: CurveSubpath = {
      start: { x: 10, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 10,
          radiusY: 10,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 0, y: 10 },
        },
      ],
      closed: false,
    };
    const transformed = transformSvgCurveSubpath(curve, {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 5,
      f: 7,
    });
    expect(transformed.start).toEqual({ x: 15, y: 7 });
    expect(transformed.segments).toHaveLength(1);
    expect(transformed.segments[0]?.kind).toBe('cubic');
    expect(transformed.segments[0]?.to.x).toBeCloseTo(5, 12);
    expect(transformed.segments[0]?.to.y).toBeCloseTo(17, 12);
  });

  it('keeps a scaled 100 mm-radius arc within 0.03 mm of its circle at machine tolerance', () => {
    // Import applies the viewBox scale here, so every SVG arc reaches the scene
    // as these cubics and job compilation cuts them at 0.025 mm. The old arm
    // length put each quarter's midpoint 0.196 mm inside (ADR-159 Amendment 2).
    const half = { radiusX: 50, radiusY: 50, rotationDeg: 0, largeArc: false, sweep: true };
    const curve: CurveSubpath = {
      start: { x: 0, y: 50 },
      segments: [
        { kind: 'elliptical-arc', ...half, to: { x: 100, y: 50 } },
        { kind: 'elliptical-arc', ...half, to: { x: 0, y: 50 } },
      ],
      closed: true,
    };
    const scaled = transformSvgCurveSubpath(curve, { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 });
    const flattened = flattenCurveSubpath(scaled, {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    });
    const points = flattened.kind === 'ok' ? flattened.polyline.points : [];
    const radialErrors = points.map((p) => Math.abs(Math.hypot(p.x - 110, p.y - 120) - 100));
    expect(radialErrors.length).toBeGreaterThan(100);
    expect(Math.max(...radialErrors)).toBeLessThan(0.03);
  });
});
