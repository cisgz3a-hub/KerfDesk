import { describe, expect, it } from 'vitest';
import { curveControlPoint, curveNodePoint, type CurveSubpath, type Vec2 } from '../scene';
import { pointOnSegment, segmentStartPoint } from './curve-segment-geometry';
import {
  bendCurveSegment,
  cornerCurveNodeIfSmooth,
  cubicSegmentForBend,
  isSmoothCurveNode,
  moveCurveHandle,
  smoothCurveNodeOfAnyKind,
  toggleCurveNodeSmooth,
} from './curve-node-shape';

const CORNER: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
  ],
  closed: false,
};

const SMOOTH: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 2, y: 4 }, control2: { x: 6, y: 0 }, to: { x: 10, y: 0 } },
    { kind: 'cubic', control1: { x: 12, y: 0 }, control2: { x: 18, y: 6 }, to: { x: 20, y: 10 } },
  ],
  closed: false,
};

function handleDirections(path: CurveSubpath, nodeIndex: number): { a: Vec2; b: Vec2 } {
  const anchor = curveNodePoint(path, nodeIndex) as Vec2;
  const incoming = curveControlPoint(path, nodeIndex, 'incoming') as Vec2;
  const outgoing = curveControlPoint(path, nodeIndex, 'outgoing') as Vec2;
  return {
    a: { x: incoming.x - anchor.x, y: incoming.y - anchor.y },
    b: { x: outgoing.x - anchor.x, y: outgoing.y - anchor.y },
  };
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

describe('curve node shape', () => {
  it('reads smoothness from the handle geometry', () => {
    expect(isSmoothCurveNode(SMOOTH, 1)).toBe(true);
    expect(isSmoothCurveNode(CORNER, 1)).toBe(false);
    expect(isSmoothCurveNode(SMOOTH, 0)).toBe(false);
  });

  it('smooths a corner between two lines by giving both sides handles', () => {
    const smoothed = toggleCurveNodeSmooth(CORNER, 1);
    expect(smoothed?.segments.map((segment) => segment.kind)).toEqual(['cubic', 'cubic']);
    expect(isSmoothCurveNode(smoothed!, 1)).toBe(true);
    expect(curveNodePoint(smoothed!, 1)).toEqual({ x: 10, y: 0 });
  });

  it('turns a smooth node back into a corner', () => {
    const corner = toggleCurveNodeSmooth(SMOOTH, 1);
    expect(isSmoothCurveNode(corner!, 1)).toBe(false);
    expect(cornerCurveNodeIfSmooth(CORNER, 1)).toBeNull();
    expect(cornerCurveNodeIfSmooth(SMOOTH, 1)).not.toBeNull();
  });

  it('smooths a node next to an arc, reporting where the node moved to', () => {
    const withArc: CurveSubpath = {
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
        { kind: 'line', to: { x: 20, y: 0 } },
      ],
      closed: false,
    };
    const result = smoothCurveNodeOfAnyKind(withArc, 1);
    // The half-turn arc became two quarter-turn cubics ahead of the node.
    expect(result?.nodeIndex).toBe(2);
    expect(curveNodePoint(result!.path, 2)).toEqual({ x: 10, y: 0 });
    expect(isSmoothCurveNode(result!.path, 2)).toBe(true);
  });

  it('keeps a smooth node smooth while one handle is dragged', () => {
    const moved = moveCurveHandle(
      SMOOTH,
      1,
      'outgoing',
      { x: 13, y: 3 },
      {
        keepSmooth: true,
        mirrorLength: false,
      },
    );
    const { a, b } = handleDirections(moved!, 1);
    expect(b).toEqual({ x: 3, y: 3 });
    expect(cross(a, b)).toBeCloseTo(0, 9);
    expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
    // The other handle kept its own length.
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(4, 9);
  });

  it('mirrors the handle length when asked', () => {
    const moved = moveCurveHandle(
      SMOOTH,
      1,
      'incoming',
      { x: 7, y: -4 },
      {
        keepSmooth: true,
        mirrorLength: true,
      },
    );
    const { a, b } = handleDirections(moved!, 1);
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(-a.y, 9);
  });

  it('moves a corner handle on its own', () => {
    const corner = toggleCurveNodeSmooth(SMOOTH, 1)!;
    const before = curveControlPoint(corner, 1, 'incoming');
    const moved = moveCurveHandle(
      corner,
      1,
      'outgoing',
      { x: 15, y: 5 },
      {
        keepSmooth: true,
        mirrorLength: false,
      },
    );
    expect(curveControlPoint(moved!, 1, 'incoming')).toEqual(before);
    expect(curveControlPoint(moved!, 1, 'outgoing')).toEqual({ x: 15, y: 5 });
  });

  it('bends a straight segment so the grabbed point follows the pointer', () => {
    const bent = bendCurveSegment(CORNER, 0, 0.5, { x: 5, y: -4 });
    const segment = bent?.segments[0];
    expect(segment?.kind).toBe('cubic');
    const point = pointOnSegment(CORNER.start, segment!, 0.5);
    expect(point.x).toBeCloseTo(5, 9);
    expect(point.y).toBeCloseTo(-4, 9);
    // The end nodes stay put.
    expect(curveNodePoint(bent!, 0)).toEqual({ x: 0, y: 0 });
    expect(curveNodePoint(bent!, 1)).toEqual({ x: 10, y: 0 });
  });

  it('reshapes a curve near one end mostly through the nearer handle', () => {
    const bent = bendCurveSegment(SMOOTH, 0, 0.1, { x: 1, y: 6 })!;
    const segment = bent.segments[0];
    const original = SMOOTH.segments[0];
    if (segment?.kind !== 'cubic' || original?.kind !== 'cubic') throw new Error('cubic');
    expect(segment.control2).toEqual(original.control2);
    expect(segment.control1).not.toEqual(original.control1);
  });

  it('keeps smooth end nodes smooth when the segment beside them bends', () => {
    const bent = bendCurveSegment(SMOOTH, 1, 0.5, { x: 15, y: 8 })!;
    expect(isSmoothCurveNode(bent, 1)).toBe(true);
    const from = segmentStartPoint(bent, 1) as Vec2;
    const point = pointOnSegment(from, bent.segments[1]!, 0.5);
    expect(point.x).toBeCloseTo(15, 9);
    expect(point.y).toBeCloseTo(8, 9);
  });

  it('prepares an arc for bending by splitting it into cubics', () => {
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
    expect(bendCurveSegment(arc, 0, 0.5, { x: 5, y: -8 })).toBeNull();
    const prepared = cubicSegmentForBend(arc, 0, 0.75)!;
    expect(prepared.path.segments).toHaveLength(2);
    expect(prepared.segmentIndex).toBe(1);
    expect(prepared.t).toBeCloseTo(0.5, 9);
    expect(
      bendCurveSegment(prepared.path, prepared.segmentIndex, prepared.t, { x: 9, y: -6 }),
    ).not.toBeNull();
  });
});
