import {
  POSITIVE_FLOAT64_FORMAT,
  positiveFloat64Factor,
  type PositiveFloat64Factor,
} from './positive-float64';

const ROUND_HALF_MULTIPLIER = 2n;
const BINARY_RADIX = 2;

/** Correctly rounds a positive product divided by another positive product into binary64. */
export function positiveFloat64ProductQuotient(
  numerators: ReadonlyArray<number>,
  denominators: ReadonlyArray<number>,
): number {
  const numerator = combinedFactor(numerators);
  const denominator = combinedFactor(denominators);
  return roundedPositiveBinaryRational(
    numerator.significand,
    denominator.significand,
    numerator.exponent - denominator.exponent,
  );
}

function combinedFactor(values: ReadonlyArray<number>): PositiveFloat64Factor {
  return values.reduce<PositiveFloat64Factor>(
    (combined, value) => {
      const factor = positiveFloat64Factor(value);
      return {
        significand: combined.significand * factor.significand,
        exponent: combined.exponent + factor.exponent,
      };
    },
    { significand: 1n, exponent: 0 },
  );
}

function roundedPositiveBinaryRational(
  numerator: bigint,
  denominator: bigint,
  binaryExponent: number,
): number {
  let resultExponent = floorBinaryExponent(numerator, denominator, binaryExponent);
  if (resultExponent < POSITIVE_FLOAT64_FORMAT.minNormalExponent) {
    const subnormalSignificand = roundedScaledQuotient(
      numerator,
      denominator,
      binaryExponent - POSITIVE_FLOAT64_FORMAT.subnormalExponent,
    );
    return float64FromBits(subnormalSignificand);
  }
  if (resultExponent > POSITIVE_FLOAT64_FORMAT.maxNormalExponent) {
    return Number.POSITIVE_INFINITY;
  }

  let significand = roundedScaledQuotient(
    numerator,
    denominator,
    binaryExponent - resultExponent + Number(POSITIVE_FLOAT64_FORMAT.fractionBits),
  );
  if (significand === POSITIVE_FLOAT64_FORMAT.significandLimit) {
    significand = POSITIVE_FLOAT64_FORMAT.hiddenBit;
    resultExponent += 1;
  }
  if (resultExponent > POSITIVE_FLOAT64_FORMAT.maxNormalExponent) {
    return Number.POSITIVE_INFINITY;
  }
  const exponentBits = BigInt(resultExponent + POSITIVE_FLOAT64_FORMAT.exponentBias);
  const fractionBits = significand - POSITIVE_FLOAT64_FORMAT.hiddenBit;
  return float64FromBits((exponentBits << POSITIVE_FLOAT64_FORMAT.fractionBits) | fractionBits);
}

function roundedScaledQuotient(
  numerator: bigint,
  denominator: bigint,
  binaryShift: number,
): bigint {
  const scaledNumerator = binaryShift >= 0 ? numerator << BigInt(binaryShift) : numerator;
  const scaledDenominator = binaryShift < 0 ? denominator << BigInt(-binaryShift) : denominator;
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const doubledRemainder = remainder * ROUND_HALF_MULTIPLIER;
  const roundsUp =
    doubledRemainder > scaledDenominator ||
    (doubledRemainder === scaledDenominator && (quotient & 1n) === 1n);
  return quotient + (roundsUp ? 1n : 0n);
}

function floorBinaryExponent(
  numerator: bigint,
  denominator: bigint,
  binaryExponent: number,
): number {
  const significandExponent = bitLength(numerator) - bitLength(denominator);
  return binaryRatioAtLeastPowerOfTwo(numerator, denominator, significandExponent)
    ? significandExponent + binaryExponent
    : significandExponent + binaryExponent - 1;
}

function binaryRatioAtLeastPowerOfTwo(
  numerator: bigint,
  denominator: bigint,
  exponent: number,
): boolean {
  return exponent >= 0
    ? numerator >= denominator << BigInt(exponent)
    : numerator << BigInt(-exponent) >= denominator;
}

function bitLength(value: bigint): number {
  return value.toString(BINARY_RADIX).length;
}

function float64FromBits(bits: bigint): number {
  const buffer = new ArrayBuffer(POSITIVE_FLOAT64_FORMAT.byteLength);
  const view = new DataView(buffer);
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}
