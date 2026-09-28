import { describe, expect, it } from 'vitest';
import type { CubicPathSegment, CurveSubpath, PathSegment, Vec2 } from '../scene';
import {
  contourPoint,
  contourSegments,
  segmentPoint,
  sliceClosedContour,
  sliceContour,
  splitCubic,
  subSegment,
} from './trim-curve-split';

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
  ],
  closed: true,
};

const CUBIC: CubicPathSegment = {
  kind: 'cubic',
  control1: { x: 0, y: 20 },
  control2: { x: 30, y: -10 },
  to: { x: 30, y: 10 },
};

function ends(curve: CurveSubpath): ReadonlyArray<Vec2> {
  return [curve.start, ...curve.segments.map((segment) => segment.to)];
}

function expectClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('contour segments', () => {
  it('makes the closing line of a closed contour explicit', () => {
    const contour = contourSegments(SQUARE, true);
    expect(contour.segments).toHaveLength(4);
    expect(contour.segments[3]).toEqual({ kind: 'line', to: { x: 0, y: 0 } });
  });

  it('adds no closing line when the contour already returns to its start', () => {
    const explicit = {
      ...SQUARE,
      segments: [...SQUARE.segments, { kind: 'line' as const, to: { x: 0, y: 0 } }],
    };
    expect(contourSegments(explicit, true).segments).toHaveLength(4);
    expect(contourSegments(SQUARE, false).segments).toHaveLength(3);
  });
});

describe('slicing', () => {
  it('slices lines by interpolation', () => {
    const contour = contourSegments(SQUARE, true);
    expect(ends(sliceContour(contour, 0.5, 2.25))).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 7.5, y: 10 },
    ]);
  });

  it('runs a closed slice through the start point as one piece', () => {
    const contour = contourSegments(SQUARE, true);
    const piece = sliceClosedContour(contour, 3.5, 0.5);
    expect(piece.closed).toBe(false);
    expect(ends(piece)).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('keeps a cubic exact: the piece retraces the original between its parameters', () => {
    const from = { x: 0, y: 0 };
    const piece = subSegment(from, CUBIC, 0.2, 0.7);
    const start = segmentPoint(from, CUBIC, 0.2);
    expect(piece.kind).toBe('cubic');
    for (const s of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      expectClose(segmentPoint(start, piece, s), segmentPoint(from, CUBIC, 0.2 + 0.5 * s));
    }
  });

  it('splits a cubic by de Casteljau into halves that meet on the curve', () => {
    const [left, right] = splitCubic(
      [{ x: 0, y: 0 }, CUBIC.control1, CUBIC.control2, CUBIC.to],
      0.4,
    );
    expectClose(left[3], segmentPoint({ x: 0, y: 0 }, CUBIC, 0.4));
    expect(right[0]).toEqual(left[3]);
    expect(right[3]).toEqual(CUBIC.to);
  });

  it('keeps an elliptical arc exact, with its large-arc flag recomputed', () => {
    const from = { x: 0, y: 10 };
    // Three quarters of a radius-10 circle about the origin.
    const arc: PathSegment = {
      kind: 'elliptical-arc',
      radiusX: 10,
      radiusY: 10,
      rotationDeg: 0,
      largeArc: true,
      sweep: true,
      to: { x: 10, y: 0 },
    };
    const small = subSegment(from, arc, 0, 0.5);
    expect(small).toMatchObject({ kind: 'elliptical-arc', largeArc: false, sweep: true });
    const large = subSegment(from, arc, 0.1, 0.9);
    expect(large).toMatchObject({ kind: 'elliptical-arc', largeArc: true });
    for (const t of [0.2, 0.45, 0.8]) {
      const point = contourPoint({ start: from, segments: [arc], closed: false }, t);
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
    const start = segmentPoint(from, arc, 0.1);
    for (const s of [0.25, 0.5, 0.75]) {
      const point = segmentPoint(start, large, s);
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
  });
});
