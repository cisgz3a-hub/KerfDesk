import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from './scene-object';
import {
  curveSubpathBounds,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  transformCurveSubpathUniform,
} from './curve-path';

describe('curve path geometry', () => {
  it('converts line-only polylines without changing their points', () => {
    const polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 2, y: 3 },
      ],
    };
    const curve = polylineToCurveSubpath(polyline);
    expect(curve).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 2, y: 3 } }],
      closed: false,
    });
    expect(flattenCurveSubpath(curve, { toleranceMm: 0.01 })).toMatchObject({
      kind: 'ok',
      polyline,
    });
  });

  it('computes cubic bounds from derivative extrema', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 10 },
          control2: { x: 10, y: 10 },
          to: { x: 10, y: 0 },
        },
      ],
      closed: false,
    };
    expect(curveSubpathBounds(curve)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 7.5 });
  });

  it('uniformly transforms curve controls, endpoints, and arc radii', () => {
    const curve: CurveSubpath = {
      start: { x: 1, y: 2 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 2, y: 3 },
          control2: { x: 4, y: 5 },
          to: { x: 6, y: 7 },
        },
        {
          kind: 'elliptical-arc',
          radiusX: 2,
          radiusY: 3,
          rotationDeg: 15,
          largeArc: false,
          sweep: true,
          to: { x: 8, y: 9 },
        },
      ],
      closed: false,
    };
    expect(
      transformCurveSubpathUniform(curve, { scale: 2, translateX: 10, translateY: -4 }),
    ).toMatchObject({
      start: { x: 12, y: 0 },
      segments: [
        {
          control1: { x: 14, y: 2 },
          control2: { x: 18, y: 6 },
          to: { x: 22, y: 10 },
        },
        { radiusX: 4, radiusY: 6, to: { x: 26, y: 14 } },
      ],
    });
  });

  it('computes and flattens a semicircular arc', () => {
    const curve: CurveSubpath = {
      start: { x: -5, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 5,
          radiusY: 5,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 5, y: 0 },
        },
      ],
      closed: false,
    };
    const bounds = curveSubpathBounds(curve);
    expect(bounds.minX).toBeCloseTo(-5, 10);
    expect(bounds.maxX).toBeCloseTo(5, 10);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(5, 10);
    const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.01 });
    expect(flattened.kind).toBe('ok');
    if (flattened.kind === 'ok') expect(flattened.segmentCount).toBeGreaterThan(10);
  });

  it('fails closed when flattening exceeds the segment budget', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 100 },
          control2: { x: 100, y: 100 },
          to: { x: 100, y: 0 },
        },
      ],
      closed: false,
    };
    expect(flattenCurveSubpath(curve, { toleranceMm: 0.0001, segmentBudget: 1 })).toEqual({
      kind: 'segment-budget-exceeded',
      segmentBudget: 1,
    });
  });
});
