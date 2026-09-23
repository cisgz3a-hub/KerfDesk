import { describe, expect, it } from 'vitest';
import { flattenCurveSubpath, IDENTITY_TRANSFORM, type CurveSubpath, type Vec2 } from '../scene';
import { transformVectorCurve } from './vector-curve-transform';

describe('canonical curve transforms used by path repair', () => {
  it('preserves a skewed ellipse under nonuniform scale and reflection, checked against independent parametric samples', () => {
    const theta = Math.PI / 6;
    const localPoint = (angle: number): Vec2 => ({
      x: 4 + 6 * Math.cos(angle) * Math.cos(theta) - 2 * Math.sin(angle) * Math.sin(theta),
      y: 7 + 6 * Math.cos(angle) * Math.sin(theta) + 2 * Math.sin(angle) * Math.cos(theta),
    });
    const curve: CurveSubpath = {
      start: localPoint(0),
      closed: false,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 6,
          radiusY: 2,
          rotationDeg: 30,
          largeArc: false,
          sweep: true,
          to: localPoint(Math.PI / 2),
        },
      ],
    };
    const transformed = transformVectorCurve(curve, {
      ...IDENTITY_TRANSFORM,
      x: 100,
      y: 200,
      scaleX: 2,
      scaleY: 3,
      mirrorX: true,
      rotationDeg: 90,
    });
    expect(transformed.segments[0]?.kind).toBe('elliptical-arc');
    expect(transformed.segments[0]).toMatchObject({ sweep: false, largeArc: false });
    const flat = flattenCurveSubpath(transformed, { toleranceMm: 0.00001 });
    if (flat.kind !== 'ok') throw new Error('Unexpected flattening limit');
    // In this independently chosen transform, x'=100-3y and y'=200-2x.
    for (let sample = 0; sample <= 100; sample += 1) {
      const local = localPoint(((sample / 100) * Math.PI) / 2);
      const expected = { x: 100 - 3 * local.y, y: 200 - 2 * local.x };
      expect(distanceToPolyline(expected, flat.polyline.points)).toBeLessThan(0.000011);
    }
  });

  it('transforms cubic control points exactly', () => {
    const curve: CurveSubpath = {
      start: { x: 0, y: 0 },
      closed: false,
      segments: [
        { kind: 'cubic', control1: { x: 1, y: 2 }, control2: { x: 3, y: 4 }, to: { x: 5, y: 6 } },
      ],
    };
    const result = transformVectorCurve(curve, {
      ...IDENTITY_TRANSFORM,
      x: 7,
      y: 8,
      scaleX: 2,
      scaleY: -3,
    });
    expect(result).toEqual({
      start: { x: 7, y: 8 },
      closed: false,
      segments: [
        {
          kind: 'cubic',
          control1: { x: 9, y: 2 },
          control2: { x: 13, y: -4 },
          to: { x: 17, y: -10 },
        },
      ],
    });
  });
});

function distanceToPolyline(point: Vec2, points: ReadonlyArray<Vec2>): number {
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return nearest;
}
