import type { ReliefHeightfield, ReliefHeightfieldMapping } from '../../core/scene/relief';
import { POSITIVE_FLOAT64_FORMAT, positiveFloat64Factor } from '../positive-float64';

const ROUND_HALF_MULTIPLIER = 2n;
const BINARY_RADIX = 2;
const PRESERVE_ASPECT: ReliefHeightfieldMapping['aspect'] = 'preserve';
const STRETCH_ASPECT: ReliefHeightfieldMapping['aspect'] = 'stretch';

type WidthResolutionInput = {
  readonly currentWidthMm: number;
  readonly currentHeightMm: number;
  readonly currentAspect: ReliefHeightfieldMapping['aspect'];
  readonly requestedWidthMm: number;
};

type WidthResolution = {
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly aspect: ReliefHeightfieldMapping['aspect'];
};

/** Resolves an accepted Width edit without losing a representable aspect-preserved height. */
export function resolveReliefHeightfieldWidth(input: WidthResolutionInput): WidthResolution {
  if (input.currentAspect === STRETCH_ASPECT) return retainedHeight(input);
  const physicalHeightMm = roundedAspectHeight(input);
  return physicalHeightMm > 0 && Number.isFinite(physicalHeightMm)
    ? { physicalWidthMm: input.requestedWidthMm, physicalHeightMm, aspect: PRESERVE_ASPECT }
    : retainedHeight(input);
}

/** Resolves an optional Width patch from the canonical field authority. */
export function resolveReliefHeightfieldWidthPatch(
  source: ReliefHeightfield,
  requestedWidthMm: number | undefined,
): WidthResolution | undefined {
  if (requestedWidthMm === undefined) return undefined;
  return resolveReliefHeightfieldWidth({
    currentWidthMm: source.physicalWidthMm,
    currentHeightMm: source.physicalHeightMm,
    currentAspect: source.mapping.aspect,
    requestedWidthMm,
  });
}

function retainedHeight(input: WidthResolutionInput): WidthResolution {
  return {
    physicalWidthMm: input.requestedWidthMm,
    physicalHeightMm: input.currentHeightMm,
    aspect: STRETCH_ASPECT,
  };
}

function roundedAspectHeight(input: WidthResolutionInput): number {
  const width = positiveFloat64Factor(input.requestedWidthMm);
  const height = positiveFloat64Factor(input.currentHeightMm);
  const divisor = positiveFloat64Factor(input.currentWidthMm);
  return roundedPositiveBinaryRational(
    width.significand * height.significand,
    divisor.significand,
    width.exponent + height.exponent - divisor.exponent,
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
