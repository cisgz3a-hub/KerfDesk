const SURFACING_DECIMAL_PLACES = 3;

/** Preserve a finite JavaScript number as ordinary decimal text, never E notation. */
export function formatSurfacingExactNumber(value: number): string {
  const text = String(value);
  const exponentIndex = text.search(/[eE]/);
  if (exponentIndex < 0) return text;

  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [coefficient = '', exponentText = '0'] = unsigned.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const [integer = '', fraction = ''] = coefficient.split('.');
  const digits = integer + fraction;
  const decimalIndex = integer.length + exponent;
  const sign = negative ? '-' : '';

  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

/** Match the surfacing emitter's three-decimal contract without E notation. */
export function formatSurfacingNumber(value: number): string {
  const fixed = value.toFixed(SURFACING_DECIMAL_PLACES);
  if (!/[eE]/.test(fixed)) return fixed === '-0.000' ? '0.000' : fixed;
  return `${formatSurfacingExactNumber(value)}.000`;
}

/** Match integer-valued G-code words such as S without E notation. */
export function formatSurfacingInteger(value: number): string {
  return formatSurfacingExactNumber(Math.round(value));
}
