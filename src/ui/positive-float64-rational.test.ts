import { describe, expect, it } from 'vitest';
import { positiveFloat64ProductQuotient } from './positive-float64-rational';

describe('positiveFloat64ProductQuotient', () => {
  it.each([
    [[3], [2], 1.5],
    [[Number.MIN_VALUE, 0.5], [1], 0],
    [[1], [Number.MIN_VALUE], Number.POSITIVE_INFINITY],
    [[Number.MAX_VALUE], [Number.MAX_VALUE], 1],
  ] as const)('rounds %j divided by %j to binary64', (numerators, denominators, expected) => {
    expect(positiveFloat64ProductQuotient(numerators, denominators)).toBe(expected);
  });
});
