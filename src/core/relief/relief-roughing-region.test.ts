import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { inRegion, onBoundary } from './relief-roughing-region.test-support';

function rect(x0: number, y0: number, x1: number, y1: number): Polyline {
  return {
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

describe('closed link-region test oracle', () => {
  it('admits exact link-region boundaries without admitting adjacent excluded points', () => {
    const region = [rect(0, 0, 30, 30), rect(10, 10, 20, 20)];
    expect(inRegion({ x: 10, y: 10 }, region)).toBe(true);
    expect(inRegion({ x: 10, y: 15 }, region)).toBe(true);
    expect(inRegion({ x: 10 + 1e-8, y: 15 }, region)).toBe(false);
    expect(inRegion({ x: -1e-8, y: 15 }, region)).toBe(false);
    expect(inRegion({ x: 15, y: 15 }, region)).toBe(false);
  });

  it.each([1e-6, 1, 1e6])(
    'recognises interpolation roundoff at scale %s without admitting nearby excluded points',
    (scale) => {
      // The audited seed -1505390208 rounded this t=0.75 link sample just
      // outside a diagonal boundary, although the link follows that edge.
      const from = { x: 4.200000000000001 * scale, y: 18.400000000000002 * scale };
      const to = { x: 2.8000000000000003 * scale, y: 19.8 * scale };
      const point = {
        x: from.x + 0.75 * (to.x - from.x),
        y: from.y + 0.75 * (to.y - from.y),
      };
      const edge = [
        { x: 3.2 * scale, y: 19.400000000000002 * scale },
        { x: 3 * scale, y: 19.6 * scale },
      ];
      expect(onBoundary(point, edge)).toBe(true);
      expect(onBoundary({ x: point.x, y: point.y + 1e-8 * scale }, edge)).toBe(false);
    },
  );
});
