import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../../core/scene';
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
});
