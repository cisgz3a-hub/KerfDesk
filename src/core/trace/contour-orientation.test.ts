import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
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

  it('keeps the exact sign when the floating-point filter answers', () => {
    // Independent exact reference: every finite double is an integer times a
    // power of two, so scale all six coordinates to one common exponent.
    const exact = (a: Vec2, b: Vec2, c: Vec2): number => {
      const parts = [a.x, a.y, b.x, b.y, c.x, c.y].map(toDyadic);
      const low = Math.min(...parts.map((part) => part.exponent));
      const [ax, ay, bx, by, cx, cy] = parts.map(
        (part) => part.mantissa << BigInt(part.exponent - low),
      ) as [bigint, bigint, bigint, bigint, bigint, bigint];
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      return det > 0n ? 1 : det < 0n ? -1 : 0;
    };
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const orientation = new ContourOrientation();
    for (let trial = 0; trial < 4000; trial += 1) {
      const a = { x: random() * 1200, y: random() * 1200 };
      const b = { x: random() * 1200, y: random() * 1200 };
      const t = random() * 2 - 0.5;
      // Nearly collinear third points: on the line, then nudged by a few ulps
      // or by a sub-nanopixel offset, so most need the exact fallback.
      const onLine = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const nudge = trial % 3 === 0 ? 0 : (random() - 0.5) * (trial % 3 === 1 ? 1e-12 : 1e-3);
      const c = { x: onLine.x + nudge, y: onLine.y - nudge };
      expect(contourOrientation(a, b, c)).toBe(exact(a, b, c));
      expect(orientation.sign(a, b, c)).toBe(exact(a, b, c));
    }
  });
});

function toDyadic(value: number): { readonly mantissa: bigint; readonly exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const sign = bits >> 63n === 0n ? 1n : -1n;
  return biased === 0
    ? { mantissa: sign * fraction, exponent: -1074 }
    : { mantissa: sign * (fraction + (1n << 52n)), exponent: biased - 1075 };
}
