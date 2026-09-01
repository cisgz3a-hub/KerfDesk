// Source-faithful model of stock GRBL's `read_float` for fixed-decimal CNC
// coordinate words. GRBL captures at most eight digits into an integer, casts
// that integer to its 32-bit float, then applies the decimal exponent through
// rounded 0.01/0.1 multiplications. A direct Math.fround of the final
// JavaScript number is not equivalent near float boundaries.

export const GRBL_MAX_PARSED_DIGITS = 8;

export function parseGrblCncCoordinate(formatted: string): number {
  const captured = captureGrblFixedDecimal(formatted);
  if (captured === null) return Number.NaN;
  let value = Math.fround(captured.integerValue);
  let exponent = captured.exponent;
  if (value !== 0) {
    while (exponent <= -2) {
      value = multiplyFloat32(value, 0.01);
      exponent += 2;
    }
    if (exponent < 0) {
      value = multiplyFloat32(value, 0.1);
    } else {
      while (exponent > 0) {
        value = multiplyFloat32(value, 10);
        exponent -= 1;
      }
    }
  }
  return captured.negative ? -value : value;
}

function multiplyFloat32(left: number, right: number): number {
  return Math.fround(Math.fround(left) * Math.fround(right));
}

function captureGrblFixedDecimal(formatted: string): {
  readonly integerValue: number;
  readonly exponent: number;
  readonly negative: boolean;
} | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?/.exec(formatted);
  if (match === null) return null;
  const integerDigits = match[2] ?? '';
  const fractionalDigits = match[3] ?? '';
  const digits = integerDigits + fractionalDigits;
  if (digits.length === 0) return null;
  const capturedFractionDigits = Math.max(
    0,
    Math.min(fractionalDigits.length, GRBL_MAX_PARSED_DIGITS - integerDigits.length),
  );
  return {
    integerValue: Number(digits.slice(0, GRBL_MAX_PARSED_DIGITS)),
    exponent:
      integerDigits.length > GRBL_MAX_PARSED_DIGITS
        ? integerDigits.length - GRBL_MAX_PARSED_DIGITS
        : -capturedFractionDigits,
    negative: match[1] === '-',
  };
}
