import { describe, expect, it } from 'vitest';
import { cube01 } from './fast-cube';

describe('cube01', () => {
  it('matches x ** 3 bit for bit across [0, 1]', () => {
    let state = 123456789;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    let mismatches = 0;
    for (let i = 0; i < 400_000; i += 1) {
      // Uniform, near 0, near 1, products and grid values, and each mirror.
      const r = next() + next() * 2 ** -32;
      const kind = i % 5;
      const t =
        kind === 0
          ? r
          : kind === 1
            ? r * 10 ** (-next() * 60)
            : kind === 2
              ? 1 - r * 10 ** (-next() * 12)
              : kind === 3
                ? r * next()
                : Math.round(r * 4096) / 4096;
      for (const x of [t, 1 - t]) {
        if (!Object.is(cube01(x), x ** 3)) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('handles the ends, tiny values and values outside [0, 1] like x ** 3', () => {
    for (const x of [
      0,
      -0,
      1,
      0.5,
      1 - 2 ** -53,
      2 ** -300,
      2 ** -301,
      1e-320,
      -0.25,
      1.5,
      Infinity,
      Number.NaN,
    ]) {
      expect(Object.is(cube01(x), x ** 3)).toBe(true);
    }
  });
});
