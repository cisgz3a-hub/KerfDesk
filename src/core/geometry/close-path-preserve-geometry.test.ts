import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../scene';
import { closeOpenPaths } from './path-direction-edits';

const p = (x: number, y: number): Vec2 => ({ x, y });
const curve: CurveSubpath = {
  start: p(0, 0),
  closed: false,
  segments: [
    { kind: 'line', to: p(0, 0.01) },
    { kind: 'line', to: p(0.01, 0.01) },
    {
      kind: 'cubic',
      control1: p(0.01, 0.005),
      control2: p(0.005, 0),
      to: p(0.00005, 0),
    },
  ],
};
const transform: Transform = {
  ...IDENTITY_TRANSFORM,
  scaleX: 10000,
  scaleY: 5000,
  rotationDeg: 37,
  mirrorX: true,
  x: 21,
  y: -13,
};

function path(source: CurveSubpath): ColoredPath {
  return {
    color: '#000000',
    curves: [source],
    polylines: [
      { closed: false, points: [source.start, ...source.segments.map((segment) => segment.to)] },
    ],
  };
}

/** This fixture contains only lines and cubics, whose controls transform directly. */
function bake(source: CurveSubpath): CurveSubpath {
  const world = (point: Vec2) => applyTransform(point, transform);
  return {
    ...source,
    start: world(source.start),
    segments: source.segments.map((segment) =>
      segment.kind === 'cubic'
        ? {
            ...segment,
            control1: world(segment.control1),
            control2: world(segment.control2),
            to: world(segment.to),
          }
        : { ...segment, to: world(segment.to) },
    ),
  };
}

describe('Close Path preserves source geometry', () => {
  it('closes identical transformed and baked cubics with the same straight bridge', () => {
    const scaled = closeOpenPaths([path(curve)], transform);
    const baked = closeOpenPaths([path(bake(curve))], IDENTITY_TRANSFORM);
    const closed = scaled.paths[0]!.curves![0]!;
    expect(scaled.closed).toBe(1);
    expect(scaled.longestGapMm).toBeCloseTo(0.5, 10);
    expect(closed.segments.slice(0, -1)).toEqual(curve.segments);
    expect(closed.segments.at(-1)).toEqual({ kind: 'line', to: curve.start });
    expect(bake(closed)).toEqual(baked.paths[0]!.curves![0]);
    expect(scaled.paths[0]!.polylines[0]!.points).toEqual([
      ...path(curve).polylines[0]!.points,
      curve.start,
    ]);
  });

  it('keeps an elliptical arc unchanged when its endpoint is locally near the seam', () => {
    const arc: CurveSubpath = {
      start: p(0, 0),
      closed: false,
      segments: [
        { kind: 'line', to: p(0.01, 0) },
        {
          kind: 'elliptical-arc',
          radiusX: 0.005,
          radiusY: 0.01,
          rotationDeg: 25,
          largeArc: false,
          sweep: true,
          to: p(0.00005, 0),
        },
      ],
    };
    const closed = closeOpenPaths([path(arc)], transform).paths[0]!.curves![0]!;
    expect(closed.segments).toEqual([...arc.segments, { kind: 'line', to: arc.start }]);
  });

  it('preserves every distinct endpoint, even below the former local coincidence epsilon', () => {
    const tiny = {
      ...curve,
      segments: [...curve.segments.slice(0, -1), { kind: 'line' as const, to: p(5e-12, 0) }],
    };
    const closed = closeOpenPaths([path(tiny)], { ...transform, scaleX: 1e12 }).paths[0]!;
    expect(closed.curves![0]!.segments).toEqual([
      ...tiny.segments,
      { kind: 'line', to: tiny.start },
    ]);
    expect(closed.polylines[0]!.points.at(-2)).toEqual(p(5e-12, 0));
  });

  it('does not append a zero-length bridge to an exactly coincident seam', () => {
    const coincident = {
      ...curve,
      segments: [...curve.segments, { kind: 'line' as const, to: curve.start }],
    };
    const original = path(coincident);
    const closed = closeOpenPaths([original], transform).paths[0]!;
    expect(closed.curves![0]!.segments).toEqual(coincident.segments);
    expect(closed.polylines[0]!.points).toEqual(original.polylines[0]!.points);
  });

  it('reports canonical gaps while retaining existing compatibility-based eligibility', () => {
    const canonical = {
      ...curve,
      segments: [...curve.segments.slice(0, -1), { kind: 'line' as const, to: p(0.001, 0) }],
    };
    const original = path(canonical);
    const stale = {
      ...original,
      polylines: [{ closed: false, points: [p(0, 0), p(0, 0.01), p(0.00001, 0)] }],
    };
    const closed = closeOpenPaths([stale], transform);
    expect(closed.closed).toBe(1);
    expect(closed.longestGapMm).toBeCloseTo(10, 10);
    expect(closed.paths[0]!.curves![0]!.segments).toEqual([
      ...canonical.segments,
      { kind: 'line', to: canonical.start },
    ]);
    const legacyClosed = { ...stale, polylines: [{ ...stale.polylines[0]!, closed: true }] };
    expect(closeOpenPaths([legacyClosed], transform)).toEqual({
      paths: [legacyClosed],
      closed: 0,
      longestGapMm: 0,
    });
  });
});
