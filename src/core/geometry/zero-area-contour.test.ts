// ADR-486 Amendment 4 (tools audit T1, T30-P1-2 / T30R-P2-1): a closed loop
// that encloses no area is told apart from thin and self-crossing shapes that
// do, and the shared endpoint pairing (Join paths, DXF import) leaves a chain
// open when closing it would make such a loop.
import { describe, expect, it } from 'vitest';
import type { CurveSubpath, Vec2 } from '../scene';
import { joinCurveEndpointsWithin } from './path-endpoint-join';
import { closedContourEnclosesNoArea } from './zero-area-contour';

const p = (x: number, y: number): Vec2 => ({ x, y });
const line = (from: Vec2, ...to: Vec2[]): CurveSubpath => ({
  start: from,
  segments: to.map((point) => ({ kind: 'line', to: point })),
  closed: false,
});

describe('closedContourEnclosesNoArea', () => {
  it('a line drawn out and back, or two points, encloses nothing', () => {
    expect(closedContourEnclosesNoArea([p(10, 12), p(40, 12)])).toBe(true);
    expect(closedContourEnclosesNoArea([p(10, 12), p(40, 12), p(10, 12)])).toBe(true);
    expect(closedContourEnclosesNoArea([p(0, 0), p(10, 5), p(20, 0), p(10, 5)])).toBe(true);
  });

  it('a square, a 0.05 mm slot and a figure eight enclose area', () => {
    expect(closedContourEnclosesNoArea([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(false);
    expect(closedContourEnclosesNoArea([p(10, 12), p(40, 12), p(40, 12.05), p(10, 12.05)])).toBe(
      false,
    );
    // Signed area zero: the lobes cancel, but each still has an inside.
    expect(closedContourEnclosesNoArea([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(false);
  });
});

describe('joinCurveEndpointsWithin with retraced chains', () => {
  it('leaves a line drawn twice as two open pieces, either direction', () => {
    for (const second of [line(p(10, 12), p(40, 12)), line(p(40, 12), p(10, 12))]) {
      const joined = joinCurveEndpointsWithin(
        [
          { curve: line(p(10, 12), p(40, 12)), signature: 's' },
          { curve: second, signature: 's' },
        ],
        0.05,
      );
      expect(joined.replacements.size).toBe(0);
      expect([joined.joins, joined.closures, joined.retraced]).toEqual([0, 0, 1]);
    }
  });

  it('leaves a single out-and-back path open', () => {
    const joined = joinCurveEndpointsWithin(
      [{ curve: line(p(10, 12), p(40, 12), p(10, 12)), signature: 's' }],
      0.05,
    );
    expect(joined.replacements.size).toBe(0);
    expect(joined.retraced).toBe(1);
  });

  it('a cubic and its exact reverse stay open too', () => {
    const out: CurveSubpath = {
      start: p(0, 0),
      segments: [{ kind: 'cubic', control1: p(5, 10), control2: p(15, -10), to: p(20, 0) }],
      closed: false,
    };
    const back: CurveSubpath = {
      start: p(20, 0),
      segments: [{ kind: 'cubic', control1: p(15, -10), control2: p(5, 10), to: p(0, 0) }],
      closed: false,
    };
    const joined = joinCurveEndpointsWithin(
      [
        { curve: out, signature: 's' },
        { curve: back, signature: 's' },
      ],
      0.05,
    );
    expect([joined.replacements.size, joined.retraced]).toEqual([0, 1]);
  });

  it('still closes a frame drawn as four lines', () => {
    const joined = joinCurveEndpointsWithin(
      [
        { curve: line(p(0, 0), p(60, 0)), signature: 's' },
        { curve: line(p(60, 0), p(60, 30)), signature: 's' },
        { curve: line(p(0, 30), p(60, 30)), signature: 's' },
        { curve: line(p(0, 30), p(0, 0)), signature: 's' },
      ],
      0.05,
    );
    expect([joined.joins, joined.closures, joined.retraced]).toEqual([3, 1, 0]);
    expect(joined.replacements.get(0)?.closed).toBe(true);
  });
});
