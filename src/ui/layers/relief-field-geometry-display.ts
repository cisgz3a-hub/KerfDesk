import type { Transform } from '../../core/scene';
import type { ReliefHeightfield } from '../../core/scene/relief';

const DISPLAY_SIGNIFICANT_DIGITS = 6;
const FIXED_NOTATION_MIN_EXPONENT = -6;
const FIXED_NOTATION_MAX_EXPONENT = 8;
const DECIMAL_RADIX = 10n;
const ROUND_HALF_MULTIPLIER = 2n;
const FLOAT64_BYTE_LENGTH = 8;
const FLOAT64_FRACTION_BITS = 52n;
const FLOAT64_EXPONENT_BIAS = 1023;
const FLOAT64_SUBNORMAL_EXPONENT = -1074;
const FLOAT64_EXPONENT_MASK = 0x7ffn;
const FLOAT64_FRACTION_MASK = (1n << FLOAT64_FRACTION_BITS) - 1n;
const FLOAT64_HIDDEN_BIT = 1n << FLOAT64_FRACTION_BITS;

/** Preformatted relief-local field measurements and exact collapsed-axis state. */
export type ReliefFieldGeometryDisplay = {
  readonly widthMm: string;
  readonly heightMm: string;
  readonly pitchXMm: string;
  readonly pitchYMm: string;
  readonly collapsedAxes: ReadonlyArray<'X' | 'Y'>;
};

type ExactMagnitude =
  | { readonly kind: 'zero' }
  | {
      readonly kind: 'positive';
      readonly numerator: bigint;
      readonly denominator: bigint;
    };

type BinaryFactor = {
  readonly significand: bigint;
  readonly exponent: number;
};

type RoundedMagnitude = {
  readonly digits: string;
  readonly exponent: number;
};

/** Derives truthful display magnitudes without losing finite extremes to binary64 intermediates. */
export function reliefFieldGeometryDisplay(
  source: ReliefHeightfield,
  transform: Transform,
): ReliefFieldGeometryDisplay {
  const scaleX = Math.abs(transform.scaleX);
  const scaleY = Math.abs(transform.scaleY);
  return {
    widthMm: formatMagnitude(productQuotient([source.physicalWidthMm, scaleX], [])),
    heightMm: formatMagnitude(productQuotient([source.physicalHeightMm, scaleY], [])),
    pitchXMm: formatMagnitude(
      productQuotient([source.physicalWidthMm, scaleX], [source.width, source.mapping.crop.width]),
    ),
    pitchYMm: formatMagnitude(
      productQuotient(
        [source.physicalHeightMm, scaleY],
        [source.height, source.mapping.crop.height],
      ),
    ),
    collapsedAxes: collapsedAxes(transform),
  };
}

function productQuotient(
  numerators: ReadonlyArray<number>,
  denominators: ReadonlyArray<number>,
): ExactMagnitude {
  if (numerators.some((value) => value === 0)) return { kind: 'zero' };
  let numerator = 1n;
  let denominator = 1n;
  let exponent = 0;
  for (const value of numerators) {
    const part = binaryFactor(value);
    numerator *= part.significand;
    exponent += part.exponent;
  }
  for (const value of denominators) {
    const part = binaryFactor(value);
    denominator *= part.significand;
    exponent -= part.exponent;
  }
  return exponent >= 0
    ? { kind: 'positive', numerator: numerator << BigInt(exponent), denominator }
    : { kind: 'positive', numerator, denominator: denominator << BigInt(-exponent) };
}

function binaryFactor(value: number): BinaryFactor {
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

function formatMagnitude(magnitude: ExactMagnitude): string {
  if (magnitude.kind === 'zero') return '0';
  const rounded = roundMagnitude(magnitude);
  return rounded.exponent >= FIXED_NOTATION_MIN_EXPONENT &&
    rounded.exponent <= FIXED_NOTATION_MAX_EXPONENT
    ? formatDecimal(rounded)
    : formatScientific(rounded);
}

function roundMagnitude(
  magnitude: Extract<ExactMagnitude, { readonly kind: 'positive' }>,
): RoundedMagnitude {
  const ratioExponent = decimalRatioExponent(magnitude.numerator, magnitude.denominator);
  const shift = DISPLAY_SIGNIFICANT_DIGITS - 1 - ratioExponent;
  const scaledNumerator =
    shift >= 0 ? magnitude.numerator * powerOfTen(shift) : magnitude.numerator;
  const scaledDenominator =
    shift < 0 ? magnitude.denominator * powerOfTen(-shift) : magnitude.denominator;
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const rounded = quotient + (remainder * ROUND_HALF_MULTIPLIER >= scaledDenominator ? 1n : 0n);
  const carry = rounded >= powerOfTen(DISPLAY_SIGNIFICANT_DIGITS);
  return {
    digits: (carry ? rounded / DECIMAL_RADIX : rounded)
      .toString()
      .padStart(DISPLAY_SIGNIFICANT_DIGITS, '0'),
    exponent: ratioExponent + (carry ? 1 : 0),
  };
}

function decimalRatioExponent(numerator: bigint, denominator: bigint): number {
  const candidate = numerator.toString().length - denominator.toString().length;
  return ratioAtLeastPowerOfTen(numerator, denominator, candidate) ? candidate : candidate - 1;
}

function ratioAtLeastPowerOfTen(numerator: bigint, denominator: bigint, exponent: number): boolean {
  return exponent >= 0
    ? numerator >= denominator * powerOfTen(exponent)
    : numerator * powerOfTen(-exponent) >= denominator;
}

function powerOfTen(exponent: number): bigint {
  return DECIMAL_RADIX ** BigInt(exponent);
}

function formatDecimal(magnitude: RoundedMagnitude): string {
  const point = magnitude.exponent + 1;
  const text =
    point <= 0
      ? `0.${'0'.repeat(-point)}${magnitude.digits}`
      : point >= magnitude.digits.length
        ? `${magnitude.digits}${'0'.repeat(point - magnitude.digits.length)}`
        : `${magnitude.digits.slice(0, point)}.${magnitude.digits.slice(point)}`;
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function formatScientific(magnitude: RoundedMagnitude): string {
  const fraction = magnitude.digits.slice(1).replace(/0+$/, '');
  const coefficient = fraction
    ? `${magnitude.digits.slice(0, 1)}.${fraction}`
    : magnitude.digits.slice(0, 1);
  const exponentSign = magnitude.exponent >= 0 ? '+' : '';
  return `${coefficient}e${exponentSign}${magnitude.exponent}`;
}

function collapsedAxes(transform: Transform): ReadonlyArray<'X' | 'Y'> {
  if (transform.scaleX === 0 && transform.scaleY === 0) return ['X', 'Y'];
  if (transform.scaleX === 0) return ['X'];
  if (transform.scaleY === 0) return ['Y'];
  return [];
}
