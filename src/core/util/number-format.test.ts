import { describe, expect, it } from 'vitest';
import {
  formatFixed3Decimals,
  formatGroupedUpTo1Decimal,
  formatGroupedUpTo3Decimals,
  formatRoundedTo2Decimals,
  formatUpTo2Decimals,
  formatUpTo3Decimals,
} from './number-format';
import { roundToDecimals, roundToTenth, roundToThousandth, withoutNegativeZero } from './rounding';

// These pin what each shared format prints, so the six can be compared side by
// side (code quality audit C1, C6-P3-1) and none drifts unnoticed.
describe('number-format', () => {
  it.each([
    [formatUpTo2Decimals, '1234.57', '1.5', '2'],
    [formatRoundedTo2Decimals, '1234.57', '1.5', '2'],
    [formatUpTo3Decimals, '1234.568', '1.5', '2'],
    [formatFixed3Decimals, '1234.568', '1.500', '2.000'],
    [formatGroupedUpTo1Decimal, '1,234.6', '1.5', '2'],
    [formatGroupedUpTo3Decimals, '1,234.568', '1.5', '2'],
  ])('%o prints 1234.5678, 1.5 and 2 as expected', (format, long, half, whole) => {
    expect(format(1234.5678)).toBe(long);
    expect(format(1.5)).toBe(half);
    expect(format(2)).toBe(whole);
  });
});

describe('rounding', () => {
  it('rounds to one, three and a chosen number of decimals', () => {
    expect(roundToTenth(1.26)).toBe(1.3);
    expect(roundToThousandth(1.23456)).toBe(1.235);
    expect(roundToDecimals(1.23456, 2)).toBe(1.23);
    expect(roundToDecimals(2, 3)).toBe(2);
  });

  it('turns negative zero into zero and leaves other values alone', () => {
    expect(Object.is(withoutNegativeZero(-0), 0)).toBe(true);
    expect(withoutNegativeZero(-1.5)).toBe(-1.5);
  });
});
