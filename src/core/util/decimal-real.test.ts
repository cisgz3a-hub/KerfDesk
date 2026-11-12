import { describe, expect, it } from 'vitest';
import { parseDecimalReal } from './decimal-real';

// Oracle audit O8-P2-2: the whole token or NaN, never a numeric prefix.
describe('parseDecimalReal', () => {
  it.each([
    ['12.5', 12.5],
    [' 12.5 ', 12.5],
    ['-.5', -0.5],
    ['+5', 5],
    ['5.', 5],
    ['1.0E+02', 100],
    ['1e-7', 1e-7],
    ['-0', -0],
  ])('reads %j as %d', (text, value) => {
    expect(parseDecimalReal(text)).toBe(value);
  });

  it.each([
    '12,5',
    '1.234,5',
    '1.#QNAN',
    '-1.#IND',
    '0x10',
    '',
    ' ',
    'NaN',
    'Infinity',
    '12.5mm',
    '1 2',
    '.',
    'e5',
  ])('refuses %j', (text) => {
    expect(parseDecimalReal(text)).toBeNaN();
  });
});
