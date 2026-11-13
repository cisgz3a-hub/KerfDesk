// Tools audit T1, T10-P2-1 and T10R-P2-1: "Moving both ends together" must
// keep an elliptical-arc end on its own circle. Re-solving the arc between the
// moved ends collapsed a single-arc path to a point and bent an end arc near a
// half circle by many times the gap.
import { describe, expect, it } from 'vitest';
import {
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type Vec2,
} from '../scene';
import { closePathsWithinTolerance } from './close-within-tolerance';

const at = (radius: number, degrees: number): Vec2 => ({
  x: radius * Math.cos((degrees * Math.PI) / 180),
  y: radius * Math.sin((degrees * Math.PI) / 180),
});

function flat(curve: CurveSubpath): ReadonlyArray<Vec2> {
  const result = flattenCurveSubpath(curve, { toleranceMm: 0.005 });
  if (result.kind !== 'ok') throw new Error('flatten failed');
  return result.polyline.points;
}

function pathOf(curve: CurveSubpath): ColoredPath {
  return { color: '#000000', curves: [curve], polylines: [{ points: flat(curve), closed: false }] };
}

function closedCurve(path: ColoredPath, tolerance: number): CurveSubpath {
  const result = closePathsWithinTolerance([path], IDENTITY_TRANSFORM, tolerance, 'move-ends');
  expect(result.closed).toBe(1);
  const curve = result.paths[0]?.curves?.[0];
  if (curve === undefined) throw new Error('curve missing');
  expect(curve.closed).toBe(true);
  return curve;
}

function length(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

describe('move-ends on an elliptical-arc end (T10)', () => {
  it('keeps a single-arc path on its circle instead of collapsing it to a point', () => {
    const arc: CurveSubpath = {
      start: at(20, 10),
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 20,
          radiusY: 20,
          rotationDeg: 0,
          largeArc: true,
          sweep: true,
          to: at(20, 350),
        },
      ],
      closed: false,
    };
    const gap = Math.hypot(at(20, 10).x - at(20, 350).x, at(20, 10).y - at(20, 350).y);
    const points = flat(closedCurve(pathOf(arc), 7));

    // A closed circle of radius 20 whose ends moved at most half the gap.
    expect(length(points)).toBeGreaterThan(120);
    const deviation = Math.max(
      ...points.map((point) => Math.abs(Math.hypot(point.x, point.y) - 20)),
    );
    expect(deviation).toBeLessThanOrEqual(gap / 2 + 0.01);
  });

  it('keeps the arc of a D shape within half the gap of its circle', () => {
    // Half circle of radius 10 from (-10, 0) over the top to (10, 0), then the
    // straight edge back to (-9.5, 0): open 0.5 mm at the corner.
    const d: CurveSubpath = {
      start: { x: -10, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 10,
          radiusY: 10,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 10, y: 0 },
        },
        { kind: 'line', to: { x: -9.5, y: 0 } },
      ],
      closed: false,
    };
    const points = flat(closedCurve(pathOf(d), 0.5));
    const arcPoints = points.filter((point) => Math.abs(point.y) > 1e-6);

    expect(arcPoints.length).toBeGreaterThan(10);
    const deviation = Math.max(
      ...arcPoints.map((point) => Math.abs(Math.hypot(point.x, point.y) - 10)),
    );
    expect(deviation).toBeLessThanOrEqual(0.25 + 0.01);
  });

  it('leaves an arc in the middle of the path untouched', () => {
    const middle = {
      kind: 'elliptical-arc',
      radiusX: 5,
      radiusY: 5,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to: { x: 10, y: 10 },
    } as const;
    const curve: CurveSubpath = {
      start: { x: 0, y: 0.3 },
      segments: [
        { kind: 'line', to: { x: 0, y: 10 } },
        middle,
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
      closed: false,
    };
    expect(closedCurve(pathOf(curve), 0.5).segments[1]).toEqual(middle);
  });
});
