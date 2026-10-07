import type { LaserPowerScaleVersion } from '../output/laser-power-scale-version';

/** Ordinary decimal G-code spelling, preserving the represented numeric value.
 * GRBL does not accept JavaScript's exponent notation in an S or F word. */
export function formatGcodeDecimal(value: number): string {
  const sign = value < 0 ? '-' : '';
  const text = String(Math.abs(value));
  const exponentMarker = text.search(/[eE]/);
  if (exponentMarker < 0) return `${sign}${text}`;
  const coefficient = text.slice(0, exponentMarker);
  const exponent = Number(text.slice(exponentMarker + 1));
  const digits = coefficient.replace('.', '');
  const decimalIndex =
    (coefficient.indexOf('.') < 0 ? coefficient.length : coefficient.indexOf('.')) + exponent;
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

/** Stock GRBL counts the leading zero against its eight-digit S parser.
 * Omit it when it would consume precision; the parser's own lower limit and
 * float/PWM quantization remain controller facts, independent of this spelling. */
export function formatGcodePowerS(value: number, version: LaserPowerScaleVersion = 2): string {
  if (version === 1) return String(value);
  const decimal = formatGcodeDecimal(value);
  return decimal.startsWith('0.') && decimal.length > 9 ? decimal.slice(1) : decimal;
}
