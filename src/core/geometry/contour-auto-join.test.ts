import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene';
import { joinTouchingContours } from './contour-auto-join';

const line = (x0: number, y0: number, x1: number, y1: number): CurveSubpath => ({
  start: { x: x0, y: y0 },
  segments: [{ kind: 'line', to: { x: x1, y: y1 } }],
  closed: false,
});

describe('joinTouchingContours', () => {
  it('joins the anchored contour to a partner meeting it at a trim point, then closes the loop', () => {
    const a = line(0, 0, 10, 0);
    const b = {
      ...line(10, 0.0004, 10, 10),
      segments: [
        ...line(10, 0.0004, 10, 10).segments,
        { kind: 'line' as const, to: { x: 0, y: 0.0002 } },
      ],
    };
    const result = joinTouchingContours(
      [
        { curve: a, anchored: true },
        { curve: b, anchored: false },
      ],
      [
        { x: 10, y: 0 },
        { x: 0, y: 0 },
      ],
      0.001,
    );
    expect(result.joins).toBe(2);
    const [joined] = result.contours;
    expect(result.contours).toHaveLength(1);
    expect(joined?.sources).toEqual([0, 1]);
    expect(joined?.curve.closed).toBe(true);
    // The partner's end was snapped, so no hairline bridge was added.
    expect(joined?.curve.segments.map((segment) => segment.to)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });

  it('never joins ends away from the allowed points or between two unanchored contours', () => {
    const result = joinTouchingContours(
      [
        { curve: line(0, 0, 10, 0), anchored: true },
        { curve: line(10, 0, 20, 0), anchored: false },
        { curve: line(30, 0, 40, 0), anchored: false },
        { curve: line(40, 0, 50, 0), anchored: false },
      ],
      [{ x: 40, y: 0 }],
      0.001,
    );
    expect(result.joins).toBe(0);
    expect(result.contours).toHaveLength(4);
  });
});
