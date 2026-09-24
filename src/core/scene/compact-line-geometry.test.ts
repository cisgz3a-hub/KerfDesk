import { describe, expect, it } from 'vitest';
import { compactLineGeometry } from './compact-line-geometry';
import { polylineToCurveSubpath } from './curve-path';
import type { ColoredPath, CurveSubpath, Polyline } from './scene-object';

const lines: ReadonlyArray<Polyline> = [
  {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 0.017, y: 0 },
      { x: 0.017, y: 9 },
      { x: 0, y: 9 },
    ],
  },
  {
    closed: false,
    points: [
      { x: 4, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 3 },
    ],
  },
];
const path: ColoredPath = {
  color: '#123456',
  fillRule: 'evenodd',
  operationIds: ['photo-fill'],
  polylines: lines,
  curves: lines.map(polylineToCurveSubpath),
};

describe('exact line geometry compaction', () => {
  it('retains every point, repetition, closure, style and operation without mutating live geometry', () => {
    const curves = path.curves;
    const compact = compactLineGeometry(path);
    expect(compact).toEqual({
      color: path.color,
      fillRule: path.fillRule,
      operationIds: path.operationIds,
      polylines: lines,
    });
    expect(compact.polylines).toBe(lines);
    expect(path.curves).toBe(curves);
    expect(compactLineGeometry(compact)).toBe(compact);
  });

  it.each(['coordinate', 'closure', 'count', 'order', 'empty', 'infinite', 'nan'] as const)(
    'keeps canonical geometry when %s prevents exact equivalence',
    (difference) => {
      let polylines = lines;
      const first = lines[0]!;
      if (difference === 'coordinate') {
        polylines = [
          { ...first, points: [{ x: Number.EPSILON, y: 0 }, ...first.points.slice(1)] },
          lines[1]!,
        ];
      }
      if (difference === 'closure') polylines = [{ ...first, closed: false }, lines[1]!];
      if (difference === 'count') polylines = lines.slice(1);
      if (difference === 'order') polylines = [...lines].reverse();
      if (difference === 'empty') polylines = [{ ...first, points: [] }, lines[1]!];
      if (difference === 'infinite' || difference === 'nan') {
        const value = difference === 'infinite' ? Infinity : NaN;
        polylines = [
          { ...first, points: [{ x: value, y: 0 }, ...first.points.slice(1)] },
          lines[1]!,
        ];
      }
      const source = { ...path, polylines };
      expect(compactLineGeometry(source)).toBe(source);
    },
  );

  it.each(['cubic', 'elliptical-arc'] as const)(
    'retains %s authority even when endpoints match',
    (kind) => {
      const first = path.curves![0]!;
      const to = first.segments[0]!.to;
      const segment =
        kind === 'cubic'
          ? { kind, to, control1: first.start, control2: to }
          : { kind, to, radiusX: 2, radiusY: 3, rotationDeg: 0, largeArc: false, sweep: true };
      const curve: CurveSubpath = { ...first, segments: [segment, ...first.segments.slice(1)] };
      const source = { ...path, curves: [curve, path.curves![1]!] };
      expect(compactLineGeometry(source)).toBe(source);
    },
  );

  it('does not equate a fabricated origin curve with an empty polyline', () => {
    const empty: Polyline = { closed: false, points: [] };
    const source = {
      color: '#000000',
      polylines: [empty],
      curves: [polylineToCurveSubpath(empty)],
    };
    expect(compactLineGeometry(source)).toBe(source);
  });

  it('refuses matching nonfinite coordinates rather than making invalid geometry look compact', () => {
    const line = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: Infinity, y: 1 },
      ],
    };
    const source = { color: '#000000', polylines: [line], curves: [polylineToCurveSubpath(line)] };
    expect(compactLineGeometry(source)).toBe(source);
  });
});
