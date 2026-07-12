import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from './scene-object';
import {
  breakCurveAtNode,
  convertCurveSegment,
  curveNodeCount,
  joinCurveSubpaths,
  moveCurveAnchor,
  moveCurveControl,
  setCurveStartNode,
  smoothCurveNode,
} from './curve-edit';

const CLOSED: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    {
      kind: 'cubic',
      control1: { x: 2, y: 0 },
      control2: { x: 8, y: 0 },
      to: { x: 10, y: 0 },
    },
    {
      kind: 'cubic',
      control1: { x: 10, y: 2 },
      control2: { x: 2, y: 10 },
      to: { x: 0, y: 0 },
    },
  ],
  closed: true,
};

describe('curve editing', () => {
  it('moves an anchor with its attached controls', () => {
    const moved = moveCurveAnchor(CLOSED, 1, { x: 3, y: 4 });
    expect(moved?.segments[0]).toMatchObject({
      control2: { x: 11, y: 4 },
      to: { x: 13, y: 4 },
    });
    expect(moved?.segments[1]).toMatchObject({ control1: { x: 13, y: 6 } });
  });

  it('moves controls independently and smooths their tangent', () => {
    const controlled = moveCurveControl(CLOSED, 1, 'outgoing', { x: 12, y: 4 });
    expect(controlled?.segments[1]).toMatchObject({ control1: { x: 12, y: 4 } });
    const smoothed = smoothCurveNode(controlled!, 1);
    const incoming = smoothed?.segments[0];
    const outgoing = smoothed?.segments[1];
    expect(incoming?.kind).toBe('cubic');
    expect(outgoing?.kind).toBe('cubic');
    if (incoming?.kind === 'cubic' && outgoing?.kind === 'cubic') {
      const anchor = incoming.to;
      const cross =
        (incoming.control2.x - anchor.x) * (outgoing.control1.y - anchor.y) -
        (incoming.control2.y - anchor.y) * (outgoing.control1.x - anchor.x);
      expect(cross).toBeCloseTo(0, 10);
    }
  });

  it('converts line segments to editable cubics and back', () => {
    const line: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 9, y: 0 } }],
      closed: false,
    };
    const cubic = convertCurveSegment(line, 0, 'cubic');
    expect(cubic?.segments[0]).toEqual({
      kind: 'cubic',
      control1: { x: 3, y: 0 },
      control2: { x: 6, y: 0 },
      to: { x: 9, y: 0 },
    });
    expect(convertCurveSegment(cubic!, 0, 'line')?.segments[0]).toEqual({
      kind: 'line',
      to: { x: 9, y: 0 },
    });
  });

  it('rotates a closed start node and breaks there', () => {
    expect(curveNodeCount(CLOSED)).toBe(2);
    const rotated = setCurveStartNode(CLOSED, 1);
    expect(rotated?.start).toEqual({ x: 10, y: 0 });
    expect(rotated?.segments.at(-1)?.to).toEqual({ x: 10, y: 0 });
    const broken = breakCurveAtNode(CLOSED, 1);
    expect(broken?.closed).toBe(false);
    expect(broken?.start).toEqual({ x: 10, y: 0 });
    expect(broken?.segments).toHaveLength(1);
  });

  it('joins two open subpaths with a deterministic bridge', () => {
    const first: CurveSubpath = {
      start: { x: 0, y: 0 },
      segments: [{ kind: 'line', to: { x: 2, y: 0 } }],
      closed: false,
    };
    const second: CurveSubpath = {
      start: { x: 5, y: 0 },
      segments: [{ kind: 'line', to: { x: 8, y: 0 } }],
      closed: false,
    };
    const joined = joinCurveSubpaths(first, second);
    expect(joined?.segments).toEqual([
      { kind: 'line', to: { x: 2, y: 0 } },
      { kind: 'line', to: { x: 5, y: 0 } },
      { kind: 'line', to: { x: 8, y: 0 } },
    ]);
  });
});
