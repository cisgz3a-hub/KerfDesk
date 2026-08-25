const EXACT_NUMBER_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

/** Largest exact source code representable by the canonical U16 heightfield mapping. */
export const MAX_RELIEF_INPUT_CODE = 0xffff;
const MAX_INPUT_CODE_DIGITS = String(MAX_RELIEF_INPUT_CODE).length;

/** Parses an exact decimal U16 value without rounding or floating-point underflow. */
export function parseReliefInputCode(input: string, priorValue: number): number {
  const match = EXACT_NUMBER_PATTERN.exec(input.trim());
  if (match === null) return priorValue;
  const [, sign, whole, fractionalAfterWhole, fractionalWithoutWhole, rawExponent] = match;
  const fractional = fractionalAfterWhole ?? fractionalWithoutWhole ?? '';
  const digits = `${whole ?? ''}${fractional}`.replace(/^0+/, '');
  if (digits === '') return 0;
  if (sign === '-') return priorValue;

  const minimumExponent = fractional.length - digits.length + 1;
  const maximumExponent = minimumExponent + MAX_INPUT_CODE_DIGITS - 1;
  const exponent = parseExponentWithin(rawExponent, minimumExponent, maximumExponent);
  if (exponent === null) return priorValue;
  const scale = exponent - fractional.length;
  const integerDigits = exactIntegerDigits(digits, scale);
  if (integerDigits === null || integerDigits.length > 5) return priorValue;
  const value = Number(integerDigits);
  return value <= MAX_RELIEF_INPUT_CODE ? value : priorValue;
}

function parseExponentWithin(
  raw: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  if (raw === undefined) return 0 >= minimum && 0 <= maximum ? 0 : null;
  const negative = raw.startsWith('-');
  const digits = raw.replace(/^[+-]/, '').replace(/^0+/, '');
  if (digits === '') return 0 >= minimum && 0 <= maximum ? 0 : null;
  const maximumMagnitude = negative ? Math.max(0, -minimum) : Math.max(0, maximum);
  if (!decimalMagnitudeAtMost(digits, maximumMagnitude)) return null;
  const magnitude = Number(digits);
  const exponent = negative ? -magnitude : magnitude;
  return exponent >= minimum && exponent <= maximum ? exponent : null;
}

function decimalMagnitudeAtMost(digits: string, maximum: number): boolean {
  const limit = String(maximum);
  return digits.length < limit.length || (digits.length === limit.length && digits <= limit);
}

function exactIntegerDigits(digits: string, scale: number): string | null {
  if (scale >= 0) {
    if (digits.length + scale > MAX_INPUT_CODE_DIGITS) return null;
    return `${digits}${'0'.repeat(scale)}`;
  }
  const trailingZeros = -scale;
  if (trailingZeros >= digits.length) return null;
  const integerLength = digits.length - trailingZeros;
  return /^0+$/.test(digits.slice(integerLength)) ? digits.slice(0, integerLength) : null;
}
