import { describe, expect, it } from 'vitest';
import { formatDisplayMillimetres } from './format-display-millimetres';

describe('formatDisplayMillimetres', () => {
  it.each([
    { value: 59, expected: '59' },
    { value: 0.137, expected: '0.137' },
    { value: 0.0001, expected: '1e-4' },
  ])('formats $value mm as $expected without hiding a positive value', ({ value, expected }) => {
    expect(formatDisplayMillimetres(value)).toBe(expected);
  });
});
