import { describe, expect, it } from 'vitest';
import { ContourOrientation, contourOrientation } from './contour-orientation';

describe('prepared exact contour orientation', () => {
  it('retains determinant signs across underflow, overflow and collinearity', () => {
    const orientation = new ContourOrientation();
    for (const scale of [Number.MIN_VALUE, 1e-200, 1, 1e200, Number.MAX_VALUE / 4]) {
      const a = { x: 0, y: -0 },
        b = { x: scale, y: scale },
        c = { x: scale, y: 0 };
      expect(orientation.sign(a, b, c)).toBe(-1);
      expect(orientation.sign(c, b, a)).toBe(1);
      expect(orientation.sign(a, b, b)).toBe(0);
      expect(orientation.sign(a, b, c)).toBe(contourOrientation(a, b, c));
    }
  });

  it('does not reuse a coordinate decomposition after the point changes', () => {
    const orientation = new ContourOrientation();
    const a = { x: 0, y: 0 },
      b = { x: 1, y: 1 },
      c = { x: 0, y: 1 };
    expect(orientation.sign(a, b, c)).toBe(1);
    c.y = -1;
    expect(orientation.sign(a, b, c)).toBe(-1);
    c.x = -1;
    expect(orientation.sign(a, b, c)).toBe(0);
  });
});
