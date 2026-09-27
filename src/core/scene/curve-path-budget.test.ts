import { describe, expect, it } from 'vitest';
import {
  MAX_FLATTENED_CURVE_SEGMENTS,
  flattenColoredPathCurves,
  flattenCurveSubpath,
  polylineToCurveSubpath,
} from './curve-path';
import type { ColoredPath, PathSegment, Polyline } from './scene-object';

const options = { toleranceMm: 0.025, segmentBudget: 5 };

function representations(polylines: ReadonlyArray<Polyline>): ReadonlyArray<ColoredPath> {
  const compact: ColoredPath = { color: '#000000', polylines };
  return [compact, { ...compact, curves: polylines.map(polylineToCurveSubpath) }];
}

describe('geometry representation segment budget parity', () => {
  it.each([false, true])('enforces the explicit budget with closed=%s', (closed) => {
    for (const path of representations([
      { closed, points: Array.from({ length: 7 }, (_, x) => ({ x, y: x % 2 })) },
    ])) {
      expect(flattenColoredPathCurves(path, options)).toEqual({
        kind: 'segment-budget-exceeded',
        segmentBudget: 5,
      });
      expect(flattenColoredPathCurves(path, { ...options, segmentBudget: 6 })).toMatchObject({
        kind: 'ok',
        segmentCount: 6,
      });
    }
  });

  it('enforces the aggregate budget across one-segment paths', () => {
    for (const path of representations(
      Array.from({ length: 6 }, (_, y) => ({
        closed: false,
        points: [
          { x: 0, y },
          { x: 1, y },
        ],
      })),
    )) {
      expect(flattenColoredPathCurves(path, options)).toEqual({
        kind: 'segment-budget-exceeded',
        segmentBudget: 5,
      });
    }
  });

  it('allows a zero-segment subpath after exactly exhausting the budget', () => {
    for (const path of representations([
      { closed: false, points: Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })) },
      { closed: false, points: [{ x: 7, y: 0 }] },
    ])) {
      expect(flattenColoredPathCurves(path, options)).toMatchObject({
        kind: 'ok',
        segmentCount: 5,
      });
    }
  });

  it('keeps explicit unlimited-output callers separate from the default preparation budget', () => {
    const path: ColoredPath = {
      color: '#000000',
      polylines: [
        { closed: false, points: Array.from({ length: 200_002 }, (_, x) => ({ x, y: 0 })) },
      ],
    };
    expect(flattenColoredPathCurves(path, { toleranceMm: 0.025 })).toEqual({
      kind: 'segment-budget-exceeded',
      segmentBudget: 200_000,
    });
    expect(
      flattenColoredPathCurves(path, {
        toleranceMm: 0.025,
        segmentBudget: Number.MAX_SAFE_INTEGER,
      }),
    ).toMatchObject({
      kind: 'ok',
      segmentCount: 200_001,
      polylines: path.polylines,
    });
  });

  it.each<[string, PathSegment]>([
    [
      'a NaN cubic control',
      {
        kind: 'cubic',
        control1: { x: Number.NaN, y: 0 },
        control2: { x: 5, y: 5 },
        to: { x: 10, y: 0 },
      },
    ],
    [
      'an infinite cubic control',
      {
        kind: 'cubic',
        control1: { x: Infinity, y: 0 },
        control2: { x: 5, y: 5 },
        to: { x: 10, y: 0 },
      },
    ],
    [
      'a NaN arc radius',
      {
        kind: 'elliptical-arc',
        radiusX: Number.NaN,
        radiusY: 4,
        rotationDeg: 0,
        largeArc: false,
        sweep: true,
        to: { x: 10, y: 0 },
      },
    ],
  ])('refuses %s instead of drawing it as one straight move', (_name, segment) => {
    const path = { start: { x: 0, y: 0 }, segments: [segment], closed: false };
    for (const segmentBudget of [MAX_FLATTENED_CURVE_SEGMENTS, Number.MAX_SAFE_INTEGER]) {
      expect(flattenCurveSubpath(path, { toleranceMm: 0.025, segmentBudget }).kind).toBe(
        'segment-budget-exceeded',
      );
    }
  });
});
