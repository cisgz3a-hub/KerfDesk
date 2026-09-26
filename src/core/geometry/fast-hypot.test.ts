import { describe, expect, it } from 'vitest';
import { hypot2 } from './fast-hypot';

describe('hypot2', () => {
  it('matches Math.hypot bit for bit over eight decades', () => {
    let state = 987654321;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let mismatches = 0;
    for (let i = 0; i < 200_000; i += 1) {
      const x = (next() - 0.5) * 10 ** (next() * 8 - 4);
      const y = (next() - 0.5) * 10 ** (next() * 8 - 4);
      if (!Object.is(hypot2(x, y), Math.hypot(x, y))) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it('handles zeros, axes and non-finite values like Math.hypot', () => {
    for (const [x, y] of [
      [0, 0],
      [-0, 0],
      [3, 4],
      [-5, 0],
      [0, -7.5],
      [1e-300, 1e-300],
      [1e300, 1e300],
      [Infinity, 1],
      [1, -Infinity],
      [Number.NaN, 1],
      [Infinity, Number.NaN],
    ] as const) {
      expect(hypot2(x, y)).toBe(Math.hypot(x, y));
    }
  });
});
