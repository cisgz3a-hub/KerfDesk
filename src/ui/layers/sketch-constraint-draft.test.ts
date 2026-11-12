import { describe, expect, it } from 'vitest';
import { sketchConstraintValue } from './sketch-constraint-draft';

// Oracle audit O10-P3-6: a dimension box reads English decimals only. Number()
// also reads hexadecimal, binary and octal literals, so "0x10" became 16 mm.
describe('sketchConstraintValue', () => {
  it.each([
    ['50', 50],
    [' 12.5 ', 12.5],
    ['-.25', -0.25],
  ])('reads %j as %d mm', (text, value) => {
    expect(sketchConstraintValue(text)).toBe(value);
  });

  it.each(['0x10', '0b101', '0o17', 'Infinity', '50,5'])(
    'keeps %j as a parameter name instead of a number',
    (text) => {
      expect(sketchConstraintValue(text)).toEqual({ parameter: text });
    },
  );
});
