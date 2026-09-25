import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { extendCurveEnd, openEndOfNode, openEndOfSegment } from './curve-extend';
import type { TrimCutter } from './curve-trim';

const same = (point: Vec2): Vec2 => point;

const LINE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
  closed: false,
};

const ARCH: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 10 }, control2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
  ],
  closed: false,
};

function upright(x: number, from = -5, to = 5): TrimCutter {
  return [
    { x, y: from },
    { x, y: to },
  ];
}

function level(y: number, from = -50, to = 50): TrimCutter {
  return [
    { x: from, y },
    { x: to, y },
  ];
}

describe('extendCurveEnd', () => {
  it('runs a straight end on to the nearest line ahead of it', () => {
    const cutters = [upright(30), upright(15), upright(-5), level(3)];
    const end = extendCurveEnd({ path: LINE, end: 'end', toShared: same, cutters });
    expect(end).toEqual({
      kind: 'extended',
      path: { ...LINE, segments: [{ kind: 'line', to: { x: 15, y: 0 } }] },
    });
    const start = extendCurveEnd({ path: LINE, end: 'start', toShared: same, cutters });
    expect(start).toEqual({ kind: 'extended', path: { ...LINE, start: { x: -5, y: 0 } } });
  });

  it('keeps a curved end and adds a straight run along its tangent', () => {
    const cutters = [level(-5)];
    const end = extendCurveEnd({ path: ARCH, end: 'end', toShared: same, cutters });
    expect(end).toEqual({
      kind: 'extended',
      path: { ...ARCH, segments: [...ARCH.segments, { kind: 'line', to: { x: 10, y: -5 } }] },
    });
    const start = extendCurveEnd({ path: ARCH, end: 'start', toShared: same, cutters });
    expect(start).toEqual({
      kind: 'extended',
      path: {
        ...ARCH,
        start: { x: 0, y: -5 },
        segments: [{ kind: 'line', to: { x: 0, y: 0 } }, ...ARCH.segments],
      },
    });
  });

  it('follows an arc’s direction at its end', () => {
    // Half circle over the top, arriving at (10, 0) heading +y.
    const arc: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 5,
          radiusY: 5,
          rotationDeg: 0,
          largeArc: false,
          sweep: true,
          to: { x: 10, y: 0 },
        },
      ],
      closed: false,
    };
    const result = extendCurveEnd({ path: arc, end: 'end', toShared: same, cutters: [level(4)] });
    if (result.kind !== 'extended') throw new Error('expected an extension');
    const added = result.path.segments.at(-1);
    expect(added?.kind).toBe('line');
    expect(added?.to.x).toBeCloseTo(10, 4);
    expect(added?.to.y).toBeCloseTo(4, 9);
  });

  it('passes the line an end already touches and ignores its own last edge', () => {
    const cutters = [LINE_AS_CUTTER, upright(10), upright(20)];
    const result = extendCurveEnd({ path: LINE, end: 'end', toShared: same, cutters });
    expect(result.kind === 'extended' ? result.path.segments[0]?.to : null).toEqual({
      x: 20,
      y: 0,
    });
  });

  it('measures in shared space and lands on the matching path point', () => {
    // A quarter turn with unequal scales: local +x runs along shared +y.
    const toShared = (point: Vec2): Vec2 => ({ x: 100 - 3 * point.y, y: 50 + 2 * point.x });
    const result = extendCurveEnd({
      path: LINE,
      end: 'end',
      toShared,
      cutters: [level(80, 0, 200)],
    });
    expect(result.kind === 'extended' ? result.path.segments[0]?.to : null).toEqual({
      x: 15,
      y: 0,
    });
  });

  it('closes the gap to a line that carries straight on', () => {
    const cutters = [level(0, 20, 40), level(0, -30, 5)];
    const result = extendCurveEnd({ path: LINE, end: 'end', toShared: same, cutters });
    expect(result.kind === 'extended' ? result.path.segments[0]?.to : null).toEqual({
      x: 20,
      y: 0,
    });
  });

  it('reports when nothing lies ahead', () => {
    const cutters = [upright(-5), level(0, -40, -20), level(1, 20, 40), upright(15, 1, 5)];
    expect(extendCurveEnd({ path: LINE, end: 'end', toShared: same, cutters })).toEqual({
      kind: 'no-crossing',
    });
  });
});

describe('open ends', () => {
  const zigzag: CurveSubpath = {
    start: { x: 0, y: 0 },
    segments: [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'line', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 20, y: 10 } },
    ],
    closed: false,
  };

  it('names the end a first or last segment leads to, and the nearer end of a lone one', () => {
    expect(openEndOfSegment(zigzag, 0, 0.9)).toBe('start');
    expect(openEndOfSegment(zigzag, 2, 0.1)).toBe('end');
    expect(openEndOfSegment(zigzag, 1, 0.5)).toBeNull();
    expect(openEndOfSegment(LINE, 0, 0.3)).toBe('start');
    expect(openEndOfSegment(LINE, 0, 0.7)).toBe('end');
    expect(openEndOfSegment({ ...zigzag, closed: true }, 0, 0.1)).toBeNull();
  });

  it('names the end a node is', () => {
    expect(openEndOfNode(zigzag, 0)).toBe('start');
    expect(openEndOfNode(zigzag, 3)).toBe('end');
    expect(openEndOfNode(zigzag, 1)).toBeNull();
    expect(openEndOfNode({ ...zigzag, closed: true }, 0)).toBeNull();
  });
});

const LINE_AS_CUTTER: TrimCutter = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];
