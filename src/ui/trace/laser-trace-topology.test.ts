import { describe, expect, it } from 'vitest';
import { compilationPolylines } from '../../core/job/compilation-polylines';
import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../../core/scene';
import { simplifyTracedPathsForLaser } from './laser-trace-moves';

function circle(radius: number, phase = 0, x = 0): Polyline {
  const points = Array.from({ length: 128 }, (_, index) => {
    const angle = (2 * Math.PI * index) / 128 + phase;
    return { x: x + radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  points.push({ ...(points[0] as Vec2) });
  return { closed: true, points };
}

function path(polylines: Polyline[], canonical = true): ColoredPath {
  return {
    color: '#000000',
    polylines,
    ...(canonical ? { curves: polylines.map(polylineToCurveSubpath) } : {}),
  };
}

function fittedCircle(radius: number, phase: number): CurveSubpath {
  const point = (x: number, y: number): Vec2 => ({
    x: radius * (x * Math.cos(phase) - y * Math.sin(phase)),
    y: radius * (x * Math.sin(phase) + y * Math.cos(phase)),
  });
  const arm = (4 / 3) * Math.tan(Math.PI / 8);
  return {
    start: point(1, 0),
    closed: true,
    segments: [
      { kind: 'cubic', control1: point(1, arm), control2: point(arm, 1), to: point(0, 1) },
      { kind: 'cubic', control1: point(-arm, 1), control2: point(-1, arm), to: point(-1, 0) },
      { kind: 'cubic', control1: point(-1, -arm), control2: point(-arm, -1), to: point(0, -1) },
      { kind: 'cubic', control1: point(arm, -1), control2: point(1, -arm), to: point(1, 0) },
    ],
  };
}

// Independent ray and segment predicates observe the compiled result, rather
// than calling the topology repair that conditions it.
function inside(point: Vec2, polyline: Polyline): boolean {
  let result = false;
  const points = polyline.points;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index] as Vec2;
    const b = points[previous] as Vec2;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      result = !result;
    }
  }
  return result;
}

function crossings(first: Polyline, second: Polyline): number {
  const turn = (a: Vec2, b: Vec2, c: Vec2): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let i = 1; i < first.points.length; i += 1) {
    for (let j = 1; j < second.points.length; j += 1) {
      const a = first.points[i - 1] as Vec2;
      const b = first.points[i] as Vec2;
      const c = second.points[j - 1] as Vec2;
      const d = second.points[j] as Vec2;
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) count += 1;
    }
  }
  return count;
}

describe('laser trace commit topology', () => {
  it.each([true, false])(
    'keeps a narrow hole inside its outline, canonical curves %s',
    (canonical) => {
      const outer = circle(1);
      // A half simplified-segment offset makes independently valid chords
      // cross: source gap 0.01 mm, simplification tolerance 0.025 mm.
      const hole = circle(0.99, Math.PI / 32);
      const input = path([outer, hole], canonical);
      expect(crossings(outer, hole)).toBe(0);
      expect(hole.points.every((point) => inside(point, outer))).toBe(true);
      const [result] = simplifyTracedPathsForLaser([input], IDENTITY_TRANSFORM);
      const [compiledOuter, compiledHole] = compilationPolylines(
        result as ColoredPath,
        IDENTITY_TRANSFORM,
      ) as [Polyline, Polyline];
      expect(crossings(compiledOuter, compiledHole)).toBe(0);
      expect(compiledHole.points.every((point) => inside(point, compiledOuter))).toBe(true);
      expect(result?.polylines).toEqual([compiledOuter, compiledHole]);
    },
  );

  it('checks neighbours across colored paths and retains unrelated simplification', () => {
    const outer = path([circle(1)]);
    const hole = { ...path([circle(0.99, Math.PI / 32)]), color: '#ff0000' };
    const distant = path([circle(1, 0, 20)]);
    const result = simplifyTracedPathsForLaser([outer, hole, distant], IDENTITY_TRANSFORM);
    const compiled = result.flatMap((item) => compilationPolylines(item, IDENTITY_TRANSFORM));
    expect(crossings(compiled[0] as Polyline, compiled[1] as Polyline)).toBe(0);
    expect(
      (compiled[1] as Polyline).points.every((point) => inside(point, compiled[0] as Polyline)),
    ).toBe(true);
    expect((compiled[2] as Polyline).points.length).toBeLessThan(
      distant.polylines[0]!.points.length,
    );
  });

  it('uses canonical boundaries and preserves an unchanged fitted curve during repair', () => {
    const outer = path([circle(1)]);
    const hole = path([circle(0.99, Math.PI / 32)]);
    // Stale compatibility geometry must not hide the hole from the guard.
    const staleHole = { ...hole, polylines: [circle(1, 0, 40)] };
    const fitted: ColoredPath = {
      color: '#00ff00',
      polylines: [circle(1, 0, 20)],
      curves: [
        {
          start: { x: 20, y: 0 },
          closed: true,
          segments: [
            {
              kind: 'cubic',
              control1: { x: 20, y: -1 },
              control2: { x: 22, y: -1 },
              to: { x: 22, y: 0 },
            },
            {
              kind: 'cubic',
              control1: { x: 22, y: 1 },
              control2: { x: 20, y: 1 },
              to: { x: 20, y: 0 },
            },
          ],
        },
      ],
    };
    const result = simplifyTracedPathsForLaser([outer, staleHole, fitted], IDENTITY_TRANSFORM);
    const compiled = result.flatMap((item) => compilationPolylines(item, IDENTITY_TRANSFORM));
    expect(crossings(compiled[0] as Polyline, compiled[1] as Polyline)).toBe(0);
    expect(
      (compiled[1] as Polyline).points.every((point) => inside(point, compiled[0] as Polyline)),
    ).toBe(true);
    expect(result[2]?.curves?.[0]).toBe(fitted.curves?.[0]);
    expect(result[2]?.polylines).toEqual([compiled[2]]);
  });

  it('backs a conflicting outline off without replacing its fitted neighbour', () => {
    const outer = path([circle(1)]);
    const curve = fittedCircle(0.99, Math.PI / 16);
    const hole: ColoredPath = {
      ...path([circle(0.99, Math.PI / 16)]),
      curves: [curve],
    };
    const before = [outer, hole].flatMap((item) => compilationPolylines(item, IDENTITY_TRANSFORM));
    expect(crossings(before[0] as Polyline, before[1] as Polyline)).toBe(0);
    const result = simplifyTracedPathsForLaser([outer, hole], IDENTITY_TRANSFORM);
    const compiled = result.flatMap((item) => compilationPolylines(item, IDENTITY_TRANSFORM));
    expect(crossings(compiled[0] as Polyline, compiled[1] as Polyline)).toBe(0);
    expect(result[1]?.curves?.[0]).toBe(curve);
    expect(compiled[1]).toEqual(before[1]);
    expect((compiled[0] as Polyline).points.length).toBe(outer.polylines[0]!.points.length);
  });
});
