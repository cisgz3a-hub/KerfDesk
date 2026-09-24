import { describe, expect, it } from 'vitest';
import {
  curveNodeCount,
  type CubicPathSegment,
  type CurveSubpath,
  type PathSegment,
  type Vec2,
} from '../scene';
import { deleteCurveNodes } from './curve-node-delete';

// The standard cubic for a circular arc from angle a0 to a1 about the origin.
function arcCubic(radius: number, a0: number, a1: number): CubicPathSegment {
  const arm = (4 / 3) * Math.tan((a1 - a0) / 4) * radius;
  const to = { x: radius * Math.cos(a1), y: radius * Math.sin(a1) };
  return {
    kind: 'cubic',
    control1: {
      x: radius * Math.cos(a0) - arm * Math.sin(a0),
      y: radius * Math.sin(a0) + arm * Math.cos(a0),
    },
    control2: { x: to.x + arm * Math.sin(a1), y: to.y - arm * Math.cos(a1) },
    to,
  };
}

function cubicPoint(from: Vec2, segment: PathSegment, t: number): Vec2 {
  if (segment.kind !== 'cubic') throw new Error(`expected a cubic, got ${segment.kind}`);
  const m = 1 - t;
  const [b0, b1, b2, b3] = [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t];
  return {
    x: b0 * from.x + b1 * segment.control1.x + b2 * segment.control2.x + b3 * segment.to.x,
    y: b0 * from.y + b1 * segment.control1.y + b2 * segment.control2.y + b3 * segment.to.y,
  };
}

const RADIUS = 50;

// A quarter circle split into two 45° cubics: the gentle curve an imported or
// traced outline stores.
function quarterCircle(): CurveSubpath {
  return {
    start: { x: RADIUS, y: 0 },
    segments: [arcCubic(RADIUS, 0, Math.PI / 4), arcCubic(RADIUS, Math.PI / 4, Math.PI / 2)],
    closed: false,
  };
}

// Four quarter cubics ending exactly on the start, as SVG and trace output close.
function circle(): CurveSubpath {
  const segments = [0, 1, 2, 3].map((quarter) =>
    arcCubic(20, (quarter * Math.PI) / 2, ((quarter + 1) * Math.PI) / 2),
  );
  return {
    start: { x: 20, y: 0 },
    segments: [
      ...segments.slice(0, 3),
      { ...(segments[3] as CubicPathSegment), to: { x: 20, y: 0 } },
    ],
    closed: true,
  };
}

describe('deleteCurveNodes', () => {
  it('merges the two curves around an interior anchor into one cubic on the original shape', () => {
    const source = quarterCircle();
    const removed = source.segments[0]!.to;

    const merged = deleteCurveNodes(source, new Set([1]));

    expect(merged?.start).toEqual(source.start);
    expect(merged?.segments).toHaveLength(1);
    const segment = merged!.segments[0]!;
    expect(segment).toMatchObject({ kind: 'cubic', to: source.segments[1]!.to });
    if (segment.kind !== 'cubic') throw new Error('expected a cubic');
    // The outer handles keep their directions (up from the start, across into
    // the end) and grow to span the whole quarter circle.
    const first = source.segments[0] as CubicPathSegment;
    const last = source.segments[1] as CubicPathSegment;
    expect(segment.control1.x).toBeCloseTo(RADIUS, 9);
    expect(segment.control1.y).toBeGreaterThan(first.control1.y);
    expect(segment.control2.y).toBeCloseTo(RADIUS, 9);
    expect(segment.control2.x).toBeGreaterThan(last.control2.x);
    // Reconnecting through the outer handles alone puts the midpoint 7.6 mm
    // inside the arc; the fitted cubic stays on it.
    const midpoint = cubicPoint(merged!.start, segment, 0.5);
    expect(Math.hypot(midpoint.x - removed.x, midpoint.y - removed.y)).toBeLessThan(0.05);
    for (let step = 0; step <= 20; step += 1) {
      const point = cubicPoint(merged!.start, segment, step / 20);
      expect(Math.abs(Math.hypot(point.x, point.y) - RADIUS)).toBeLessThan(0.05);
    }
  });

  it('joins two lines into their chord', () => {
    const merged = deleteCurveNodes(
      {
        start: { x: 0, y: 0 },
        segments: [
          { kind: 'line', to: { x: 10, y: 0 } },
          { kind: 'line', to: { x: 10, y: 10 } },
        ],
        closed: false,
      },
      new Set([1]),
    );

    expect(merged).toEqual({
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 10, y: 10 } }],
      closed: false,
    });
  });

  it('keeps a closed path closed and moves its start past a deleted start anchor', () => {
    const source = circle();

    for (const [node, start] of [
      [1, source.start],
      [0, source.segments[0]!.to],
    ] as const) {
      const edited = deleteCurveNodes(source, new Set([node]));

      expect(edited?.closed).toBe(true);
      expect(edited?.start).toEqual(start);
      expect(edited?.segments).toHaveLength(3);
      expect(edited?.segments.at(-1)?.to).toEqual(start);
      expect(curveNodeCount(edited!)).toBe(3);
    }
  });

  it('removes the end segment when an end anchor of an open path is deleted', () => {
    const source = quarterCircle();

    expect(deleteCurveNodes(source, new Set([2]))).toEqual({
      start: source.start,
      segments: [source.segments[0]],
      closed: false,
    });
    expect(deleteCurveNodes(source, new Set([0]))).toEqual({
      start: source.segments[0]!.to,
      segments: [source.segments[1]],
      closed: false,
    });
  });

  it('deletes adjacent anchors together and leaves untouched segments exact', () => {
    const source: CurveSubpath = {
      start: { x: RADIUS, y: 0 },
      segments: [
        arcCubic(RADIUS, 0, Math.PI / 8),
        arcCubic(RADIUS, Math.PI / 8, Math.PI / 4),
        arcCubic(RADIUS, Math.PI / 4, Math.PI / 2),
        { kind: 'line', to: { x: 0, y: 60 } },
      ],
      closed: false,
    };

    const edited = deleteCurveNodes(source, new Set([1, 2]));

    expect(edited?.start).toEqual(source.start);
    expect(edited?.segments).toHaveLength(2);
    expect(edited?.segments[0]).toMatchObject({ kind: 'cubic', to: source.segments[2]!.to });
    expect(edited?.segments[1]).toBe(source.segments[3]);
    const midpoint = cubicPoint(edited!.start, edited!.segments[0]!, 0.5);
    expect(Math.abs(Math.hypot(midpoint.x, midpoint.y) - RADIUS)).toBeLessThan(0.05);
  });

  it('refuses deletes below the polyline minimum and ignores indices that name no anchor', () => {
    const open: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 5, y: 0 } }],
      closed: false,
    };
    const triangle: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 5, y: 0 } },
        { kind: 'line', to: { x: 0, y: 5 } },
        { kind: 'line', to: { x: 0, y: 0 } },
      ],
      closed: true,
    };

    expect(deleteCurveNodes(open, new Set([0]))).toBeNull();
    expect(deleteCurveNodes(triangle, new Set([1]))).toBeNull();
    expect(deleteCurveNodes(triangle, new Set([3, -1, 0.5]))).toBe(triangle);
  });

  it('closes an implicitly closed ring with an explicit segment', () => {
    const square: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 0 } },
        { kind: 'line', to: { x: 10, y: 10 } },
        { kind: 'line', to: { x: 0, y: 10 } },
      ],
      closed: true,
    };

    expect(deleteCurveNodes(square, new Set([0]))).toEqual({
      start: { x: 10, y: 0 },
      segments: [
        { kind: 'line', to: { x: 10, y: 10 } },
        { kind: 'line', to: { x: 0, y: 10 } },
        { kind: 'line', to: { x: 10, y: 0 } },
      ],
      closed: true,
    });
  });

  it('drops a zero-length closing segment instead of refitting the curve beside it', () => {
    const source = circle();
    const withZeroLengthClose: CurveSubpath = {
      ...source,
      segments: [...source.segments, { kind: 'line', to: source.start }],
    };

    expect(deleteCurveNodes(withZeroLengthClose, new Set([4]))).toEqual(source);
  });

  it('fits across elliptical arcs along their true end tangents', () => {
    const arc = (to: Vec2): PathSegment => ({
      kind: 'elliptical-arc',
      radiusX: RADIUS,
      radiusY: RADIUS,
      rotationDeg: 0,
      largeArc: false,
      sweep: true,
      to,
    });
    const diagonal = RADIUS / Math.SQRT2;

    const merged = deleteCurveNodes(
      {
        start: { x: RADIUS, y: 0 },
        segments: [arc({ x: diagonal, y: diagonal }), arc({ x: 0, y: RADIUS })],
        closed: false,
      },
      new Set([1]),
    );

    const segment = merged!.segments[0]!;
    if (segment.kind !== 'cubic') throw new Error('expected a cubic');
    expect(segment.control1.x).toBeCloseTo(RADIUS, 4);
    expect(segment.control2.y).toBeCloseTo(RADIUS, 4);
    const midpoint = cubicPoint(merged!.start, segment, 0.5);
    expect(Math.abs(Math.hypot(midpoint.x, midpoint.y) - RADIUS)).toBeLessThan(0.05);
  });
});
