const FLOAT64_BYTE_LENGTH = 8;
const FLOAT64_FRACTION_BITS = 52n;
const FLOAT64_EXPONENT_BIAS = 1023;
const FLOAT64_MIN_NORMAL_EXPONENT = -1022;
const FLOAT64_MAX_NORMAL_EXPONENT = 1023;
const FLOAT64_SUBNORMAL_EXPONENT = -1074;
const FLOAT64_EXPONENT_MASK = 0x7ffn;
const FLOAT64_HIDDEN_BIT = 1n << FLOAT64_FRACTION_BITS;
const FLOAT64_SIGNIFICAND_LIMIT = FLOAT64_HIDDEN_BIT << 1n;
const FLOAT64_FRACTION_MASK = FLOAT64_HIDDEN_BIT - 1n;

type PositiveFloat64Format = {
  readonly byteLength: number;
  readonly fractionBits: bigint;
  readonly exponentBias: number;
  readonly minNormalExponent: number;
  readonly maxNormalExponent: number;
  readonly subnormalExponent: number;
  readonly hiddenBit: bigint;
  readonly significandLimit: bigint;
};

/** Binary64 representation constants shared by exact positive-magnitude calculations. */
export const POSITIVE_FLOAT64_FORMAT: PositiveFloat64Format = {
  byteLength: FLOAT64_BYTE_LENGTH,
  fractionBits: FLOAT64_FRACTION_BITS,
  exponentBias: FLOAT64_EXPONENT_BIAS,
  minNormalExponent: FLOAT64_MIN_NORMAL_EXPONENT,
  maxNormalExponent: FLOAT64_MAX_NORMAL_EXPONENT,
  subnormalExponent: FLOAT64_SUBNORMAL_EXPONENT,
  hiddenBit: FLOAT64_HIDDEN_BIT,
  significandLimit: FLOAT64_SIGNIFICAND_LIMIT,
};

/** Exact significand and power-of-two exponent of a positive finite binary64 value. */
export type PositiveFloat64Factor = {
  readonly significand: bigint;
  readonly exponent: number;
};

/** Decomposes a positive finite binary64 value without decimal conversion. */
export function positiveFloat64Factor(value: number): PositiveFloat64Factor {
  const buffer = new ArrayBuffer(FLOAT64_BYTE_LENGTH);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> FLOAT64_FRACTION_BITS) & FLOAT64_EXPONENT_MASK);
  const fraction = bits & FLOAT64_FRACTION_MASK;
  if (exponentBits === 0) {
    return { significand: fraction, exponent: FLOAT64_SUBNORMAL_EXPONENT };
  }
  return {
    significand: FLOAT64_HIDDEN_BIT | fraction,
    exponent: exponentBits - FLOAT64_EXPONENT_BIAS - Number(FLOAT64_FRACTION_BITS),
  };
}
