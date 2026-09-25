import { describe, expect, it } from 'vitest';
import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import {
  explicitCurveSubpath,
  pointOnSegment,
  sameCurveSubpath,
  sampleSegment,
  segmentAsCubics,
  segmentParameterAtLength,
  segmentPiece,
  splitSegment,
} from './curve-segment-geometry';

const CUBIC: PathSegment = {
  kind: 'cubic',
  control1: { x: 0, y: 10 },
  control2: { x: 10, y: 10 },
  to: { x: 10, y: 0 },
};
const HALF_CIRCLE: PathSegment = {
  kind: 'elliptical-arc',
  radiusX: 5,
  radiusY: 5,
  rotationDeg: 0,
  largeArc: false,
  sweep: true,
  to: { x: 10, y: 0 },
};
const ORIGIN: Vec2 = { x: 0, y: 0 };

function expectClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

// Walk both traces at matching parameters: an exact split redraws the original.
function expectSameTrace(from: Vec2, whole: PathSegment, t: number): void {
  const [first, second] = splitSegment(from, whole, t);
  const splitPoint = pointOnSegment(from, whole, t);
  for (const u of [0, 0.2, 0.5, 0.8, 1]) {
    expectClose(pointOnSegment(from, first, u), pointOnSegment(from, whole, u * t));
    expectClose(
      pointOnSegment(splitPoint, second, u),
      pointOnSegment(from, whole, t + u * (1 - t)),
    );
  }
}

describe('curve segment geometry', () => {
  it('splits a cubic with de Casteljau so both halves trace the original', () => {
    expectSameTrace(ORIGIN, CUBIC, 0.3);
    const [first] = splitSegment(ORIGIN, CUBIC, 0.5);
    expectClose(first.to, { x: 5, y: 7.5 });
  });

  it('splits a line at the parameter', () => {
    const line: PathSegment = { kind: 'line', to: { x: 10, y: 20 } };
    expect(splitSegment(ORIGIN, line, 0.25)).toEqual([
      { kind: 'line', to: { x: 2.5, y: 5 } },
      line,
    ]);
  });

  it('splits an arc on its own ellipse, keeping the drawn curve', () => {
    expectSameTrace(ORIGIN, HALF_CIRCLE, 0.5);
    const [first, second] = splitSegment(ORIGIN, HALF_CIRCLE, 0.5);
    // Sweeping positively (clockwise on the y-down canvas) passes over the top.
    expectClose(first.to, { x: 5, y: -5 });
    expect(first).toMatchObject({ kind: 'elliptical-arc', largeArc: false, sweep: true });
    expect(second.to).toEqual({ x: 10, y: 0 });
  });

  it('carries scaled-up radii into both arc pieces', () => {
    // Radius 1 cannot span 10 mm; SVG scales it to 5, and each piece must too.
    const tiny: PathSegment = { ...HALF_CIRCLE, radiusX: 1, radiusY: 1 };
    const [first] = splitSegment(ORIGIN, tiny, 0.5);
    expect(first).toMatchObject({ radiusX: 5, radiusY: 5 });
    expectSameTrace(ORIGIN, tiny, 0.4);
  });

  it('cuts out a piece between two parameters with its own start point', () => {
    const piece = segmentPiece(ORIGIN, CUBIC, 0.25, 0.75);
    expectClose(piece.from, pointOnSegment(ORIGIN, CUBIC, 0.25));
    expectClose(pointOnSegment(piece.from, piece.segment, 1), pointOnSegment(ORIGIN, CUBIC, 0.75));
    expectClose(pointOnSegment(piece.from, piece.segment, 0.5), pointOnSegment(ORIGIN, CUBIC, 0.5));
    expect(segmentPiece(ORIGIN, CUBIC, 0, 1)).toEqual({ from: ORIGIN, segment: CUBIC });
  });

  it('samples within tolerance with the parameter of every sample', () => {
    const samples = sampleSegment(ORIGIN, CUBIC, 0.01);
    expect(samples[0]).toEqual({ t: 0, point: ORIGIN });
    expect(samples.at(-1)).toEqual({ t: 1, point: CUBIC.to });
    for (const sample of samples) {
      expectClose(sample.point, pointOnSegment(ORIGIN, CUBIC, sample.t));
    }
    const ts = samples.map((sample) => sample.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(sampleSegment(ORIGIN, { kind: 'line', to: { x: 3, y: 4 } }, 0.01)).toHaveLength(2);
  });

  it('finds the parameter at a fraction of the length', () => {
    expect(segmentParameterAtLength(ORIGIN, { kind: 'line', to: { x: 8, y: 0 } }, 0.5)).toBe(0.5);
    // Symmetric curve: the length midpoint is the parameter midpoint.
    expect(segmentParameterAtLength(ORIGIN, CUBIC, 0.5)).toBeCloseTo(0.5, 4);
    const lopsided: PathSegment = {
      kind: 'cubic',
      control1: { x: 1, y: 0 },
      control2: { x: 2, y: 0 },
      to: { x: 30, y: 0 },
    };
    const t = segmentParameterAtLength(ORIGIN, lopsided, 0.5);
    expect(pointOnSegment(ORIGIN, lopsided, t).x).toBeCloseTo(15, 2);
  });

  it('turns an arc into quarter-turn cubics that stay on the circle', () => {
    const cubics = segmentAsCubics(ORIGIN, HALF_CIRCLE);
    expect(cubics).toHaveLength(2);
    expect(cubics.at(-1)?.to).toEqual({ x: 10, y: 0 });
    let from = ORIGIN;
    for (const cubic of cubics) {
      for (const u of [0.25, 0.5, 0.75]) {
        const point = pointOnSegment(from, cubic, u);
        expect(Math.abs(Math.hypot(point.x - 5, point.y) - 5)).toBeLessThan(0.002);
      }
      from = cubic.to;
    }
  });

  it('writes out an implicit closing line so every edge is addressable', () => {
    const triangle: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 4, y: 0 } },
        { kind: 'line', to: { x: 0, y: 3 } },
      ],
      closed: true,
    };
    expect(explicitCurveSubpath(triangle).segments.at(-1)).toEqual({
      kind: 'line',
      to: { x: 0, y: 0 },
    });
    const open = { ...triangle, closed: false };
    expect(explicitCurveSubpath(open)).toBe(open);
  });

  it('tells a real change from rounding noise when comparing subpaths', () => {
    const path: CurveSubpath = { start: ORIGIN, segments: [CUBIC, HALF_CIRCLE], closed: false };
    const noise = { ...CUBIC, control1: { x: 1e-12, y: 10 } };
    expect(sameCurveSubpath(path, { ...path, segments: [noise, HALF_CIRCLE] })).toBe(true);
    const moved = { ...CUBIC, control1: { x: 0.001, y: 10 } };
    expect(sameCurveSubpath(path, { ...path, segments: [moved, HALF_CIRCLE] })).toBe(false);
    const flipped = { ...HALF_CIRCLE, sweep: false };
    expect(sameCurveSubpath(path, { ...path, segments: [CUBIC, flipped] })).toBe(false);
    expect(sameCurveSubpath(path, { ...path, closed: true })).toBe(false);
  });
});
