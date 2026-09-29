import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import {
  closeOpenPaths,
  isCloseablePolyline,
  reversePaths,
  reversePolyline,
} from './path-direction-edits';

const U = [p(0, 0), p(0, 10), p(10, 10), p(10, 0)];

describe('close path', () => {
  it('closes open paths and reports the widest gap in world millimetres', () => {
    const result = closeOpenPaths([path([open(U)])], { ...IDENTITY_TRANSFORM, scaleX: 2 });

    expect(result.closed).toBe(1);
    expect(result.longestGapMm).toBeCloseTo(20);
    expect(result.paths[0]?.polylines[0]).toEqual({ closed: true, points: [...U, p(0, 0)] });
  });

  it('adds a closing line to the exact curve and marks it closed', () => {
    const curve: CurveSubpath = { start: p(0, 0), segments: lines(U.slice(1)), closed: false };

    const result = closeOpenPaths([path([open(U)], [curve])], IDENTITY_TRANSFORM);

    expect(result.paths[0]?.curves?.[0]).toEqual({
      start: p(0, 0),
      segments: lines([...U.slice(1), p(0, 0)]),
      closed: true,
    });
    // The polyline repeats its start, so it matches the curve's anchors.
    expect(anchors(result.paths[0]?.curves?.[0])).toEqual(result.paths[0]?.polylines[0]?.points);
  });

  it('leaves straight lines and closed paths alone', () => {
    const paths = [path([open([p(0, 0), p(10, 0)])]), path([closed(U)])];

    const result = closeOpenPaths(paths, IDENTITY_TRANSFORM);

    expect(result).toEqual({ paths, closed: 0, longestGapMm: 0 });
    expect(isCloseablePolyline(open([p(0, 0), p(10, 0)]))).toBe(false);
  });

  it('closes a path whose ends already meet as Z would, with no second closing point', () => {
    const curve: CurveSubpath = {
      start: p(0, 0),
      segments: lines([...U.slice(1), p(0, 0)]),
      closed: false,
    };

    const result = closeOpenPaths([path([open([...U, p(0, 0)])], [curve])], IDENTITY_TRANSFORM);

    expect(result.closed).toBe(1);
    expect(result.longestGapMm).toBe(0);
    expect(result.paths[0]?.polylines[0]).toEqual({ closed: true, points: [...U, p(0, 0)] });
    expect(result.paths[0]?.curves?.[0]).toEqual({ ...curve, closed: true });
  });

  it('moves an end that stops just short of the start onto it', () => {
    const nearStart = p(0.00005, -0.00003);
    const curve: CurveSubpath = {
      start: p(0, 0),
      segments: [
        ...lines(U.slice(1)),
        { kind: 'cubic', control1: p(7, -1), control2: p(3, -1), to: nearStart },
      ],
      closed: false,
    };

    const result = closeOpenPaths([path([open([...U, nearStart])], [curve])], IDENTITY_TRANSFORM);

    expect(result.paths[0]?.polylines[0]).toEqual({ closed: true, points: [...U, p(0, 0)] });
    expect(result.paths[0]?.curves?.[0]).toEqual({
      start: p(0, 0),
      segments: [
        ...lines(U.slice(1)),
        { kind: 'cubic', control1: p(7, -1), control2: p(3, -1), to: p(0, 0) },
      ],
      closed: true,
    });
    expect(anchors(result.paths[0]?.curves?.[0])).toEqual(result.paths[0]?.polylines[0]?.points);
  });

  it('lets the kerf compensate an outline whose ends met but was left open', () => {
    const outline = open([p(0, 0), p(40, 0), p(40, 20), p(0, 20), p(0, 0)]);
    const [closedPath] = closeOpenPaths([path([outline])], IDENTITY_TRANSFORM).paths;
    if (closedPath === undefined) throw new Error('expected the closed path');
    const part: ImportedSvg = {
      kind: 'imported-svg',
      id: 'part',
      source: 'part.svg',
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [closedPath],
    };
    const layer = { ...createLayer({ id: 'cut', color: '#000000' }), kerfOffsetMm: 0.1 };

    const group = compileJob({ objects: [part], layers: [layer] }, DEFAULT_DEVICE_PROFILE)
      .groups[0];

    if (group?.kind !== 'cut') throw new Error('expected a cut group');
    const xs = group.segments.flatMap((segment) => segment.polyline.map((point) => point.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40.2, 6);
  });

  it('does not guess when curves and polylines do not pair up', () => {
    const curve: CurveSubpath = { start: p(0, 0), segments: lines(U.slice(1)), closed: false };
    const mismatched = path([open(U), open(U)], [curve]);

    expect(closeOpenPaths([mismatched], IDENTITY_TRANSFORM).closed).toBe(0);
    expect(reversePaths([mismatched]).reversed).toBe(0);
  });
});

describe('reverse direction', () => {
  it('swaps the ends of an open path', () => {
    const result = reversePaths([path([open(U)])]);

    expect(result.reversed).toBe(1);
    expect(result.openReversed).toBe(1);
    expect(result.paths[0]?.polylines[0]?.points).toEqual([...U].reverse());
  });

  it('keeps the start point of a closed path and runs the other way round', () => {
    expect(reversePolyline(closed(U)).points).toEqual([p(0, 0), p(10, 0), p(10, 10), p(0, 10)]);
    expect(reversePolyline(closed([...U, p(0, 0)])).points).toEqual([
      p(0, 0),
      p(10, 0),
      p(10, 10),
      p(0, 10),
      p(0, 0),
    ]);
  });

  it('reverses the exact curve to match its polyline', () => {
    const openCurve: CurveSubpath = { start: p(0, 0), segments: lines(U.slice(1)), closed: false };
    const closedCurve: CurveSubpath = { ...openCurve, closed: true };

    const result = reversePaths([path([open(U), closed(U)], [openCurve, closedCurve])]);

    const [openBack, closedBack] = result.paths[0]?.curves ?? [];
    expect(anchors(openBack)).toEqual(result.paths[0]?.polylines[0]?.points);
    // The implicit closing edge becomes explicit so the start point stays put.
    expect(anchors(closedBack)).toEqual([
      ...(result.paths[0]?.polylines[1]?.points ?? []),
      p(0, 0),
    ]);
    expect(closedBack?.closed).toBe(true);
  });

  it('swaps cubic control points so the curve keeps its shape', () => {
    const curve: CurveSubpath = {
      start: p(0, 0),
      segments: [{ kind: 'cubic', control1: p(1, 5), control2: p(9, 5), to: p(10, 0) }],
      closed: false,
    };

    const result = reversePaths([path([open([p(0, 0), p(5, 4), p(10, 0)])], [curve])]);

    expect(result.paths[0]?.curves?.[0]).toEqual({
      start: p(10, 0),
      segments: [{ kind: 'cubic', control1: p(9, 5), control2: p(1, 5), to: p(0, 0) }],
      closed: false,
    });
  });

  it('counts only closed paths as not open', () => {
    const result = reversePaths([path([closed(U), open([p(0, 0), p(1, 1)]), open([p(5, 5)])])]);

    expect(result).toMatchObject({ reversed: 2, openReversed: 1 });
  });
});

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function open(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: false, points };
}

function closed(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points };
}

function lines(points: ReadonlyArray<Vec2>): CurveSubpath['segments'] {
  return points.map((to) => ({ kind: 'line' as const, to }));
}

function path(
  polylines: ReadonlyArray<Polyline>,
  curves?: ReadonlyArray<CurveSubpath>,
): ColoredPath {
  return { color: '#000000', polylines, ...(curves === undefined ? {} : { curves }) };
}

function anchors(curve: CurveSubpath | undefined): ReadonlyArray<Vec2> {
  return curve === undefined ? [] : [curve.start, ...curve.segments.map((segment) => segment.to)];
}
