import { describe, expect, it } from 'vitest';
import { applyTransform } from './transform';
import { flattenCurveSubpath } from './curve-path';
import { curveEndpointJoin } from './curve-join';
import type { CurveSubpath, Transform, Vec2 } from './scene-object';

const FIRST: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 1, y: 2 },
      control2: { x: 3, y: 2 },
      to: { x: 4, y: 0 },
    },
  ],
  closed: false,
};

const SECOND: CurveSubpath = {
  start: { x: 10, y: 0 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 11, y: 2 },
      control2: { x: 13, y: 2 },
      to: { x: 14, y: 0 },
    },
  ],
  closed: false,
};

describe('curve endpoint joining', () => {
  it.each([
    {
      firstNode: 0,
      secondNode: 0,
      expectedStart: 4,
      bridgeTo: 10,
      expectedEnd: 14,
      expectedFirstControls: [3, 1],
      expectedSecondControls: [11, 13],
    },
    {
      firstNode: 0,
      secondNode: 1,
      expectedStart: 4,
      bridgeTo: 14,
      expectedEnd: 10,
      expectedFirstControls: [3, 1],
      expectedSecondControls: [13, 11],
    },
    {
      firstNode: 1,
      secondNode: 0,
      expectedStart: 0,
      bridgeTo: 10,
      expectedEnd: 14,
      expectedFirstControls: [1, 3],
      expectedSecondControls: [11, 13],
    },
    {
      firstNode: 1,
      secondNode: 1,
      expectedStart: 0,
      bridgeTo: 14,
      expectedEnd: 10,
      expectedFirstControls: [1, 3],
      expectedSecondControls: [13, 11],
    },
  ])(
    'honors endpoint pair $firstNode -> $secondNode without changing source roles',
    ({
      firstNode,
      secondNode,
      expectedStart,
      bridgeTo,
      expectedEnd,
      expectedFirstControls,
      expectedSecondControls,
    }) => {
      const result = curveEndpointJoin.join(FIRST, firstNode, SECOND, secondNode);
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.curve.start.x).toBe(expectedStart);
      expect(result.curve.segments[0]).toMatchObject({
        kind: 'cubic',
        control1: { x: expectedFirstControls[0] },
        control2: { x: expectedFirstControls[1] },
      });
      expect(result.curve.segments[1]).toEqual({ kind: 'line', to: { x: bridgeTo, y: 0 } });
      expect(result.curve.segments[2]).toMatchObject({
        kind: 'cubic',
        control1: { x: expectedSecondControls[0] },
        control2: { x: expectedSecondControls[1] },
      });
      expect(result.curve.segments.at(-1)?.to.x).toBe(expectedEnd);
    },
  );

  it('reverses elliptical arcs losslessly', () => {
    const arc: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 4,
          radiusY: 2,
          rotationDeg: 15,
          largeArc: true,
          sweep: true,
          to: { x: 8, y: 0 },
        },
      ],
      closed: false,
    };

    const result = curveEndpointJoin.join(arc, 0, SECOND, 0);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.curve.segments[0]).toEqual({
      kind: 'elliptical-arc',
      radiusX: 4,
      radiusY: 2,
      rotationDeg: 15,
      largeArc: true,
      sweep: false,
      to: { x: 0, y: 0 },
    });
  });

  it('preserves reversed arc geometry through rotation, nonuniform scale, and reflection', () => {
    const arc: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        {
          kind: 'elliptical-arc',
          radiusX: 7,
          radiusY: 3,
          rotationDeg: 22,
          largeArc: false,
          sweep: true,
          to: { x: 10, y: 4 },
        },
      ],
      closed: false,
    };
    const result = curveEndpointJoin.join(
      arc,
      0,
      { start: arc.start, segments: [], closed: false },
      0,
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const transform: Transform = {
      x: 40,
      y: 25,
      scaleX: 2,
      scaleY: 0.5,
      rotationDeg: 37,
      mirrorX: true,
      mirrorY: false,
    };
    // Chord-optimal flattening walks from a curve's start (ADR-442), so a
    // reversed ellipse may place its vertices elsewhere on the same curve.
    // Every vertex of each flattening must lie on the other curve, whose
    // exact trace is its flattening at 1e-7, and the ends must swap.
    const original = flattenedPhysicalPoints(arc, transform);
    const reversed = flattenedPhysicalPoints(result.curve, transform);
    expectSamePoint(reversed[0], original.at(-1));
    expectSamePoint(reversed.at(-1), original[0]);
    const originalTrace = flattenedPhysicalPoints(arc, transform, 1e-7);
    const reversedTrace = flattenedPhysicalPoints(result.curve, transform, 1e-7);
    for (const point of reversed) {
      expect(distanceToPolyline(point, originalTrace)).toBeLessThan(1e-6);
    }
    for (const point of original) {
      expect(distanceToPolyline(point, reversedTrace)).toBeLessThan(1e-6);
    }
  });

  it('omits a zero-length bridge for coincident selected endpoints', () => {
    const second: CurveSubpath = {
      start: { x: 4, y: 0 },
      segments: [{ kind: 'line', to: { x: 8, y: 0 } }],
      closed: false,
    };
    const result = curveEndpointJoin.join(FIRST, 1, second, 0);
    expect(result).toMatchObject({
      kind: 'ok',
      curve: { segments: [FIRST.segments[0], second.segments[0]] },
    });
  });

  it('closes one open curve in place without changing its source direction', () => {
    const result = curveEndpointJoin.close(FIRST, 1, 0);
    expect(result).toEqual({
      kind: 'ok',
      curve: {
        ...FIRST,
        segments: [...FIRST.segments, { kind: 'line', to: FIRST.start }],
        closed: true,
      },
    });
  });

  it('does not duplicate an already-coincident closing vertex', () => {
    const coincident: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 0, y: 0 } }],
      closed: false,
    };
    const result = curveEndpointJoin.close(coincident, 0, 1);
    expect(result).toEqual({ kind: 'ok', curve: { ...coincident, closed: true } });
  });

  it('rejects interior anchors and closed paths without producing geometry', () => {
    const threeNodes: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [
        { kind: 'line', to: { x: 2, y: 0 } },
        { kind: 'line', to: { x: 4, y: 0 } },
      ],
      closed: false,
    };
    expect(curveEndpointJoin.join(threeNodes, 1, SECOND, 0)).toEqual({
      kind: 'error',
      reason: 'interior-anchor',
    });
    expect(curveEndpointJoin.close(threeNodes, 0, 1)).toEqual({
      kind: 'error',
      reason: 'interior-anchor',
    });
    expect(curveEndpointJoin.join({ ...FIRST, closed: true }, 0, SECOND, 0)).toEqual({
      kind: 'error',
      reason: 'closed-path',
    });
  });
});

function flattenedPhysicalPoints(path: CurveSubpath, transform: Transform, toleranceMm = 0.005) {
  const flattened = flattenCurveSubpath(path, { toleranceMm });
  if (flattened.kind !== 'ok') throw new Error('Expected curve fixture to flatten.');
  return flattened.polyline.points.map((point) => applyTransform(point, transform));
}

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let nearest = Infinity;
  for (let index = 1; index < polyline.length; index += 1) {
    const a = polyline[index - 1] as Vec2;
    const b = polyline[index] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return nearest;
}

function expectSamePoint(actual: Vec2 | undefined, expected: Vec2 | undefined): void {
  expect(actual).toBeDefined();
  expect(expected).toBeDefined();
  expect(actual?.x).toBeCloseTo(expected?.x ?? Number.NaN, 8);
  expect(actual?.y).toBeCloseTo(expected?.y ?? Number.NaN, 8);
}
