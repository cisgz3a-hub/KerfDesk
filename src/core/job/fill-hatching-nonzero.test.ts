import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { square } from '../../__fixtures__/square';
import { fillHatching } from './fill-hatching';

function reversed(polyline: Polyline): Polyline {
  return { ...polyline, points: [...polyline.points].reverse() };
}

describe('fillHatching nonzero fill rule', () => {
  it('unions overlapping same-wound contours instead of toggling the overlap off', () => {
    const result = fillHatching({
      polylines: [square(10), square(10, 5, 0)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 1,
      fillRule: 'nonzero',
    });
    const middleHatches = result.filter((pl) => pl.points[0]?.y === 5);

    expect(middleHatches).toHaveLength(1);
    const [a, b] = middleHatches[0]?.points ?? [];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a !== undefined && b !== undefined) {
      expect(Math.abs(b.x - a.x)).toBeCloseTo(15);
    }
  });

  it('still skips counters when the inner contour has opposite winding', () => {
    const result = fillHatching({
      polylines: [square(10), reversed(square(4, 3, 3))],
      hatchAngleDeg: 0,
      hatchSpacingMm: 1,
      fillRule: 'nonzero',
    });
    const middleHatches = result.filter((pl) => {
      const y = pl.points[0]?.y;
      return y !== undefined && y >= 4 && y <= 6;
    });

    expect(middleHatches.length).toBeGreaterThanOrEqual(4);
    expect(middleHatches.length).toBeLessThanOrEqual(8);
    for (const pl of middleHatches) {
      const [a, b] = pl.points;
      if (a === undefined || b === undefined) continue;
      expect(Math.abs(b.x - a.x)).toBeLessThan(7);
    }
  });
});
