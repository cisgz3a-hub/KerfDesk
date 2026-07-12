import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from './scene-object';
import {
  curveSubpathBounds,
  flattenColoredPathCurves,
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

  it('keeps cubic flattening within the requested geometric deviation', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'cubic',
          control1: { x: 0, y: 20 },
          control2: { x: 20, y: 20 },
          to: { x: 20, y: 0 },
        },
      ],
      closed: false,
    };
    const toleranceMm = 0.05;
    const result = flattenCurveSubpath(curve, { toleranceMm });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    let maximumDeviation = 0;
    for (let sample = 0; sample <= 1_000; sample += 1) {
      const t = sample / 1_000;
      const point = cubicPoint(t, curve);
      maximumDeviation = Math.max(
        maximumDeviation,
        distanceToPolyline(point, result.polyline.points),
      );
    }
    expect(maximumDeviation).toBeLessThanOrEqual(toleranceMm);
  });

  it('preserves subpath count and closed topology while flattening', () => {
    const result = flattenColoredPathCurves(
      {
        color: '#000000',
        polylines: [],
        curves: [
          {
            start: { x: 0, y: 0 },
            segments: [
              { kind: 'line', to: { x: 10, y: 0 } },
              { kind: 'line', to: { x: 10, y: 10 } },
              { kind: 'line', to: { x: 0, y: 10 } },
            ],
            closed: true,
          },
          {
            start: { x: 20, y: 0 },
            segments: [{ kind: 'line', to: { x: 30, y: 0 } }],
            closed: false,
          },
        ],
      },
      { toleranceMm: 0.025 },
    );
    expect(result).toMatchObject({
      kind: 'ok',
      polylines: [{ closed: true }, { closed: false }],
    });
  });

  it('enforces the aggregate segment budget exactly on large line fixtures', () => {
    const segmentCount = 10_000;
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: Array.from({ length: segmentCount }, (_, index) => ({
        kind: 'line' as const,
        to: { x: index + 1, y: index % 2 },
      })),
      closed: false,
    };
    expect(
      flattenCurveSubpath(curve, { toleranceMm: 0.025, segmentBudget: segmentCount }),
    ).toMatchObject({ kind: 'ok', segmentCount });
    expect(
      flattenCurveSubpath(curve, { toleranceMm: 0.025, segmentBudget: segmentCount - 1 }),
    ).toEqual({ kind: 'segment-budget-exceeded', segmentBudget: segmentCount - 1 });
  });
});

function cubicPoint(t: number, curve: CurveSubpath): { x: number; y: number } {
  const segment = curve.segments[0];
  if (segment?.kind !== 'cubic') throw new Error('Expected cubic test fixture');
  const u = 1 - t;
  return {
    x:
      u ** 3 * curve.start.x +
      3 * u * u * t * segment.control1.x +
      3 * u * t * t * segment.control2.x +
      t ** 3 * segment.to.x,
    y:
      u ** 3 * curve.start.y +
      3 * u * u * t * segment.control1.y +
      3 * u * t * t * segment.control2.y +
      t ** 3 * segment.to.y,
  };
}

function distanceToPolyline(
  point: { x: number; y: number },
  polyline: ReadonlyArray<{ x: number; y: number }>,
): number {
  let nearest = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    const from = polyline[index - 1];
    const to = polyline[index];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - (from.x + projection * dx), point.y - (from.y + projection * dy)),
    );
  }
  return nearest;
}
