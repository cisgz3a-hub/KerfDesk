import { describe, expect, it } from 'vitest';
import { curveEndpointJoin } from './curve-join';
import { applyTransform } from './transform';
import {
  IDENTITY_TRANSFORM,
  type CubicPathSegment,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from './scene-object';

const p = (x: number, y: number): Vec2 => ({ x: x / 1e9, y: y / 1e9 });
const first: CurveSubpath = {
  start: p(10, 10),
  segments: [{ kind: 'cubic', control1: p(12, 15), control2: p(18, 15), to: p(20, 10) }],
  closed: false,
};
const second: CurveSubpath = {
  start: p(20.5, 10),
  segments: [{ kind: 'cubic', control1: p(25, 15), control2: p(35, 15), to: p(40, 10) }],
  closed: false,
};
const scaled: Transform = { ...IDENTITY_TRANSFORM, scaleX: 1e9, scaleY: 1e9 };

function reverseCubic(path: CurveSubpath): CurveSubpath {
  const segment = path.segments[0] as CubicPathSegment;
  return {
    start: segment.to,
    segments: [
      { kind: 'cubic', control1: segment.control2, control2: segment.control1, to: path.start },
    ],
    closed: false,
  };
}

function bake(path: CurveSubpath, transform: Transform): CurveSubpath {
  return {
    ...path,
    start: applyTransform(path.start, transform),
    segments: path.segments.map((segment) => {
      if (segment.kind === 'elliptical-arc') throw new Error('Cubic fixture only');
      return segment.kind === 'line'
        ? { ...segment, to: applyTransform(segment.to, transform) }
        : {
            ...segment,
            to: applyTransform(segment.to, transform),
            control1: applyTransform(segment.control1, transform),
            control2: applyTransform(segment.control2, transform),
          };
    }),
  };
}

function cubicAt(from: Vec2, segment: CubicPathSegment, t: number): Vec2 {
  const u = 1 - t;
  return {
    x:
      u ** 3 * from.x +
      3 * u ** 2 * t * segment.control1.x +
      3 * u * t ** 2 * segment.control2.x +
      t ** 3 * segment.to.x,
    y:
      u ** 3 * from.y +
      3 * u ** 2 * t * segment.control1.y +
      3 * u * t ** 2 * segment.control2.y +
      t ** 3 * segment.to.y,
  };
}

describe('Node Join preserves physically distinct canonical endpoints', () => {
  it.each([
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ] as const)(
    'preserves both cubics and baked equivalence for endpoints %i/%i',
    (firstNode, secondNode) => {
      const a = firstNode === 0 ? reverseCubic(first) : first;
      const b = secondNode === 1 ? reverseCubic(second) : second;
      const snapshot = structuredClone([a, b]);
      const result = curveEndpointJoin.join(a, firstNode, b, secondNode);
      if (result.kind !== 'ok') throw new Error('Expected endpoint join');
      expect(result.curve.segments).toEqual([
        first.segments[0],
        { kind: 'line', to: second.start },
        second.segments[0],
      ]);
      for (const transform of [
        scaled,
        { ...scaled, rotationDeg: 37, mirrorX: true, scaleY: 5e8, x: 50, y: 30 },
      ]) {
        const baked = curveEndpointJoin.join(
          bake(a, transform),
          firstNode,
          bake(b, transform),
          secondNode,
        );
        if (baked.kind !== 'ok') throw new Error('Expected baked join');
        expect(bake(result.curve, transform)).toEqual(baked.curve);
        for (const [path, segmentIndex] of [
          [first, 0],
          [second, 2],
        ] as const) {
          const from = result.curve.segments[segmentIndex - 1]?.to ?? result.curve.start;
          for (const t of [0, 0.125, 0.5, 0.875, 1]) {
            const actual = applyTransform(
              cubicAt(from, result.curve.segments[segmentIndex] as CubicPathSegment, t),
              transform,
            );
            const expected = applyTransform(
              cubicAt(path.start, path.segments[0] as CubicPathSegment, t),
              transform,
            );
            expect(actual.x).toBeCloseTo(expected.x, 10);
            expect(actual.y).toBeCloseTo(expected.y, 10);
          }
        }
      }
      expect([a, b]).toEqual(snapshot);
    },
  );

  it('does not move a cubic by 0.0625 mm at its midpoint when a local gap is 5e-10', () => {
    const result = curveEndpointJoin.join(first, 1, second, 0);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const curve = result.curve;
    const index = curve.segments.length - 1;
    const from = curve.segments[index - 1]?.to ?? curve.start;
    const actual = applyTransform(
      cubicAt(from, curve.segments[index] as CubicPathSegment, 0.5),
      scaled,
    );
    const expected = applyTransform(
      cubicAt(second.start, second.segments[0] as CubicPathSegment, 0.5),
      scaled,
    );
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(curve.segments).toHaveLength(3);
    expect(curve.segments[1]).toEqual({ kind: 'line', to: second.start });
  });

  it('preserves an arc and its exact start across the physically visible seam', () => {
    const arc: CurveSubpath = {
      start: second.start,
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 1e-8,
          radiusY: 5e-9,
          rotationDeg: 25,
          largeArc: false,
          sweep: true,
          to: p(40.5, 10),
        },
      ],
      closed: false,
    };
    const result = curveEndpointJoin.join(first, 1, arc, 0);
    if (result.kind !== 'ok') throw new Error('Expected arc join');
    expect(result.curve.segments).toEqual([
      first.segments[0],
      { kind: 'line', to: arc.start },
      arc.segments[0],
    ]);
    expect(applyTransform(result.curve.segments[1]!.to, scaled)).toEqual(
      applyTransform(arc.start, scaled),
    );
  });

  it('closes a tiny local gap explicitly without changing the existing cubic', () => {
    const segment = first.segments[0] as CubicPathSegment;
    const path = { ...first, segments: [{ ...segment, to: p(10.5, 10) }] };
    const result = curveEndpointJoin.close(path, 1, 0);
    expect(result).toEqual({
      kind: 'ok',
      curve: {
        ...path,
        closed: true,
        segments: [...path.segments, { kind: 'line', to: path.start }],
      },
    });
    const coincident = { ...path, segments: [{ ...segment, to: path.start }] };
    expect(curveEndpointJoin.close(coincident, 0, 1)).toEqual({
      kind: 'ok',
      curve: { ...coincident, closed: true },
    });
    expect(curveEndpointJoin.join(first, 1, { ...second, start: segment.to }, 0)).toMatchObject({
      kind: 'ok',
      curve: { segments: [segment, second.segments[0]] },
    });
  });
});
