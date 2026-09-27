import { describe, expect, it } from 'vitest';

import type { ColoredPath } from '../scene';
import { restoreFromWorkingGrid } from './auto-upscale';

// A fractional working grid restores with different x and y ratios. Per-axis
// radius scaling is only right for an arc at 0 or 180 degrees; any other
// rotation needs the axes of the scaled ellipse.
describe('restoreFromWorkingGrid elliptical arcs', () => {
  it('maps an elliptical arc to the exact scaled ellipse at any rotation', () => {
    // Working grid 2x wide, 1x tall: x shrinks by 0.5 on restore.
    const source = { width: 100, height: 100 };
    const working = { width: 200, height: 100 };
    const arcPath = (rotationDeg: number): ColoredPath => ({
      color: '#000000',
      polylines: [],
      curves: [
        {
          start: { x: 0, y: 0 },
          closed: false,
          segments: [
            {
              kind: 'elliptical-arc',
              radiusX: 10,
              radiusY: 4,
              rotationDeg,
              largeArc: false,
              sweep: true,
              to: { x: 20, y: 8 },
            },
          ],
        },
      ],
    });
    // The ellipse's shape matrix E = M M^T with M = R(θ) diag(rx, ry).
    const shape = (rx: number, ry: number, deg: number): number[] => {
      const t = (deg * Math.PI) / 180;
      const [c, s] = [Math.cos(t), Math.sin(t)];
      return [
        c * c * rx * rx + s * s * ry * ry,
        c * s * (rx * rx - ry * ry),
        s * s * rx * rx + c * c * ry * ry,
      ];
    };
    for (const rotationDeg of [0, 30, 90, 135]) {
      const segment = restoreFromWorkingGrid([arcPath(rotationDeg)], source, working)[0]
        ?.curves?.[0]?.segments[0];
      if (segment?.kind !== 'elliptical-arc') throw new Error('arc lost');
      const [xx, xy, yy] = shape(10, 4, rotationDeg);
      const expected = [xx! * 0.25, xy! * 0.5, yy!];
      const actual = shape(segment.radiusX, segment.radiusY, segment.rotationDeg);
      actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
      expect(segment.to).toEqual({ x: 10, y: 8 });
      expect(segment.sweep).toBe(true);
      expect(segment.largeArc).toBe(false);
    }
  });
});
