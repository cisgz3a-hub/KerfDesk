import { describe, expect, it } from 'vitest';
import { POSITIVE_FLOAT64_FORMAT, positiveFloat64Factor } from './positive-float64';

type FactorCase = {
  readonly label: string;
  readonly value: number;
  readonly expected: {
    readonly significand: bigint;
    readonly exponent: number;
  };
};

const FACTOR_CASES: ReadonlyArray<FactorCase> = [
  {
    label: 'smallest subnormal',
    value: Number.MIN_VALUE,
    expected: { significand: 1n, exponent: POSITIVE_FLOAT64_FORMAT.subnormalExponent },
  },
  {
    label: 'one',
    value: 1,
    expected: {
      significand: POSITIVE_FLOAT64_FORMAT.hiddenBit,
      exponent: -Number(POSITIVE_FLOAT64_FORMAT.fractionBits),
    },
  },
  {
    label: 'largest finite value',
    value: Number.MAX_VALUE,
    expected: {
      significand: POSITIVE_FLOAT64_FORMAT.significandLimit - 1n,
      exponent:
        POSITIVE_FLOAT64_FORMAT.maxNormalExponent - Number(POSITIVE_FLOAT64_FORMAT.fractionBits),
    },
  },
];

describe('positive Float64 factor', () => {
  it.each(FACTOR_CASES)('decomposes the $label exactly', ({ value, expected }) => {
    expect(positiveFloat64Factor(value)).toEqual(expected);
  });
});
