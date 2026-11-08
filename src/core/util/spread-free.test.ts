import { describe, expect, it } from 'vitest';
import { appendAll, maxOf, minOf } from './spread-free';

// The helpers replace spread calls (audit S7-P2-3), so they must agree with
// them on every input a spread could take, and keep working past the point
// where the spread throws.
describe('spread-free extrema and append', () => {
  const cases: ReadonlyArray<ReadonlyArray<number>> = [
    [],
    [3],
    [2, -1, 7],
    [0, -0],
    [-0, 0],
    [1, Number.NaN, -5],
    [Infinity, -Infinity],
  ];

  it('equals Math.min / Math.max over the same values', () => {
    for (const values of cases) {
      expect(Object.is(minOf(values), Math.min(...values))).toBe(true);
      expect(Object.is(maxOf(values), Math.max(...values))).toBe(true);
    }
  });

  it('handles arrays a spread call cannot take', () => {
    const values = Array.from({ length: 500_000 }, (_, index) => index - 1000);
    expect(() => Math.min(...values)).toThrow(RangeError);
    expect(minOf(values)).toBe(-1000);
    expect(maxOf(values)).toBe(498_999);
    const target = [1];
    appendAll(target, values);
    expect(target).toHaveLength(500_001);
    expect(target[500_000]).toBe(498_999);
  });

  it('appends an array to itself once, as push(...items) did', () => {
    const items = [1, 2];
    appendAll(items, items);
    expect(items).toEqual([1, 2, 1, 2]);
  });
});
