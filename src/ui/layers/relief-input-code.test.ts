import { describe, expect, it } from 'vitest';
import { parseReliefInputCode } from './relief-input-code';

describe('parseReliefInputCode', () => {
  it.each([
    ['0', 0],
    ['65535', 65_535],
    ['00042', 42],
    ['+42', 42],
    ['42.0', 42],
    ['4.2e1', 42],
    ['420e-1', 42],
    ['655350e-1', 65_535],
    ['-0', 0],
  ])('accepts exact integer notation %s', (input, expected) => {
    expect(parseReliefInputCode(input, 123)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '-1',
    '65536',
    '1.5',
    '1.0000000000000001',
    '65535.0000000000000001',
    '1e-324',
    '1e309',
    '1e9999999',
    'NaN',
    'Infinity',
    '0x10',
  ])('returns the prior value for non-exact or out-of-domain notation %s', (input) => {
    expect(parseReliefInputCode(input, 123)).toBe(123);
  });

  it('accepts exact integers whose long exponents are compensated by their mantissas', () => {
    const exponent = 1_000_000;
    const negativeCompensation = `1${'0'.repeat(exponent)}e-${exponent}`;
    const positiveCompensation = `0.${'0'.repeat(exponent - 1)}1e${exponent}`;

    expect(parseReliefInputCode(negativeCompensation, 123)).toBe(1);
    expect(parseReliefInputCode(positiveCompensation, 123)).toBe(1);
  });
});
