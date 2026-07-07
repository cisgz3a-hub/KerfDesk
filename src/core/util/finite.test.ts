import { describe, expect, it } from 'vitest';
import { finiteOr, finitePositiveOr, isFinitePositive } from './finite';

describe('finiteOr', () => {
  it('returns the value when finite, including zero and negatives', () => {
    expect(finiteOr(0, 7)).toBe(0);
    expect(finiteOr(-3.5, 7)).toBe(-3.5);
    expect(finiteOr(42, 7)).toBe(42);
  });

  it('returns the fallback for NaN and infinities', () => {
    expect(finiteOr(NaN, 7)).toBe(7);
    expect(finiteOr(Infinity, 7)).toBe(7);
    expect(finiteOr(-Infinity, 7)).toBe(7);
  });
});

describe('finitePositiveOr', () => {
  it('returns the value only when finite and strictly positive', () => {
    expect(finitePositiveOr(2.5, 1)).toBe(2.5);
  });

  it('returns the fallback for zero, negatives, NaN, and infinities', () => {
    expect(finitePositiveOr(0, 1)).toBe(1);
    expect(finitePositiveOr(-2, 1)).toBe(1);
    expect(finitePositiveOr(NaN, 1)).toBe(1);
    expect(finitePositiveOr(Infinity, 1)).toBe(1);
  });
});

describe('isFinitePositive', () => {
  it('is true only for finite positive numbers', () => {
    expect(isFinitePositive(0.001)).toBe(true);
    expect(isFinitePositive(0)).toBe(false);
    expect(isFinitePositive(-1)).toBe(false);
    expect(isFinitePositive(NaN)).toBe(false);
    expect(isFinitePositive(Infinity)).toBe(false);
  });
});
