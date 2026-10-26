// display-length — converts millimetres to the operator's display unit and
// back (ADR-629). The model stays in millimetres; these helpers run only where
// a number is shown or typed. Feeds use the same factor: mm/min ↔ in/min.

import { formatDisplayMillimetres } from './format-display-millimetres';

export type DisplayLengthUnit = 'mm' | 'in';

export const MM_PER_INCH = 25.4;
const INCH_DECIMALS = 4;

export function lengthUnitLabel(unit: DisplayLengthUnit): string {
  return unit;
}

export function feedUnitLabel(unit: DisplayLengthUnit): string {
  return `${unit}/min`;
}

/** Millimetres in the display unit, unrounded. */
export function toDisplayLength(mm: number, unit: DisplayLengthUnit): number {
  return unit === 'in' ? mm / MM_PER_INCH : mm;
}

/** A value typed in the display unit, in millimetres. */
export function fromDisplayLength(value: number, unit: DisplayLengthUnit): number {
  return unit === 'in' ? value * MM_PER_INCH : value;
}

/** Compact number in the display unit, without the unit: up to 3 decimals in
 * mm and 4 in inches, trailing zeros removed, never rounding nonzero to 0. */
export function formatDisplayLength(mm: number, unit: DisplayLengthUnit): string {
  if (unit === 'mm') return formatDisplayMillimetres(mm);
  const inches = mm / MM_PER_INCH;
  const fixed = Number(inches.toFixed(INCH_DECIMALS));
  if (fixed !== 0 || inches === 0) return String(fixed === 0 ? 0 : fixed);
  return inches.toExponential(INCH_DECIMALS - 1).replace(/\.?0+(?=e)/, '');
}

/** A number with a fixed count of decimals in the display unit (rulers, status). */
export function formatDisplayLengthFixed(
  mm: number,
  unit: DisplayLengthUnit,
  mmDecimals: number,
): string {
  const decimals = unit === 'in' ? mmDecimals + 2 : mmDecimals;
  const value = toDisplayLength(mm, unit).toFixed(decimals);
  return value === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : value;
}

/** "12.5 mm" or "0.4921 in". */
export function formatLengthWithUnit(mm: number, unit: DisplayLengthUnit): string {
  return `${formatDisplayLength(mm, unit)} ${lengthUnitLabel(unit)}`;
}

/** Area: mm² or in², with the same decimals as a length. */
export function formatDisplayArea(mm2: number, unit: DisplayLengthUnit): string {
  if (unit === 'mm') return `${formatDisplayMillimetres(mm2)} mm²`;
  return `${formatDisplayLength(mm2 / MM_PER_INCH, 'in')} in²`;
}
