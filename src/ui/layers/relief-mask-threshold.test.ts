import { describe, expect, it } from 'vitest';
import { parseReliefMaskThreshold } from './relief-mask-threshold';

describe('parseReliefMaskThreshold', () => {
  it.each([
    ['1', 1],
    ['255', 255],
    ['00042', 42],
    ['+42', 42],
    ['42.0', 42],
    ['4.2e1', 42],
    ['2550e-1', 255],
  ])('accepts exact in-domain integer notation %s', (input, expected) => {
    expect(parseReliefMaskThreshold(input, 128)).toBe(expected);
  });

  it.each([
    '',
    ' ',
    '-0',
    '0',
    '-1',
    '256',
    '1.5',
    '1.0000000000000001',
    '255.0000000000000001',
    '1e-324',
    '1e309',
    'NaN',
    'Infinity',
    '0x10',
  ])('returns the prior threshold for invalid notation %s', (input) => {
    expect(parseReliefMaskThreshold(input, 128)).toBe(128);
  });

  it('preserves exact long compensated notation and rejects a compensated out-of-domain value', () => {
    const exponent = 100_000;
    const exactOne = `1${'0'.repeat(exponent)}e-${exponent}`;
    const exactTooLarge = `256${'0'.repeat(exponent)}e-${exponent}`;

    expect(parseReliefMaskThreshold(exactOne, 128)).toBe(1);
    expect(parseReliefMaskThreshold(exactTooLarge, 128)).toBe(128);
  });
});
