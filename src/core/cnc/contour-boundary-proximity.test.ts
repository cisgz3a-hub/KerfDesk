import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { contourBoundaryWithinDistance } from './contour-boundary-proximity';

function square(gap: number): Polyline {
  return {
    closed: true,
    points: [
      { x: gap, y: gap },
      { x: 20 - gap, y: gap },
      { x: 20 - gap, y: 20 - gap },
      { x: gap, y: 20 - gap },
    ],
  };
}

describe('whole polygon-boundary distance envelopes', () => {
  it('uses the actual square corner distance, not its axial gap', () => {
    expect(contourBoundaryWithinDistance(square(0), square(1), 1.4)).toBe(false);
    expect(contourBoundaryWithinDistance(square(0), square(1), 1.42)).toBe(true);
    expect(contourBoundaryWithinDistance(square(1), square(0), 1.01)).toBe(true);
  });

  it.each([0, 23, 90, 173])(
    'is invariant under rotation %s and translated coordinate frames',
    (angle) => {
      const radians = (angle * Math.PI) / 180;
      const transform = (polyline: Polyline): Polyline => ({
        ...polyline,
        points: polyline.points.map((point) => ({
          x: 300.25 + point.x * Math.cos(radians) - point.y * Math.sin(radians),
          y: -191.5 + point.x * Math.sin(radians) + point.y * Math.cos(radians),
        })),
      });
      expect(contourBoundaryWithinDistance(transform(square(0)), transform(square(1)), 1.4)).toBe(
        false,
      );
      expect(contourBoundaryWithinDistance(transform(square(0)), transform(square(1)), 1.42)).toBe(
        true,
      );
    },
  );

  it('covers boundaries subdivided into different segment counts and repeated closures', () => {
    const outer = square(0);
    const inner = square(0.2);
    const dense: Polyline = {
      ...inner,
      points: inner.points.flatMap((a, index) => {
        const b = inner.points[(index + 1) % inner.points.length]!;
        return Array.from({ length: 50 }, (_, step) => ({
          x: a.x + ((b.x - a.x) * step) / 50,
          y: a.y + ((b.y - a.y) * step) / 50,
        }));
      }),
    };
    expect(contourBoundaryWithinDistance(outer, dense, 0.3)).toBe(true);
    expect(contourBoundaryWithinDistance(dense, outer, 0.3)).toBe(true);
    expect(
      contourBoundaryWithinDistance(
        { ...outer, points: [...outer.points, outer.points[0]!] },
        dense,
        0.3,
      ),
    ).toBe(true);
  });
});
