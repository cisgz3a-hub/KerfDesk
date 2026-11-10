// Rounding helpers shared by core, io and ui (code quality audit C1,
// C2-P3-1). Every copy replaced by an import had the same body.

/** Rounded to one decimal place. */
export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Rounded to three decimal places (one micron when the value is in mm). */
export function roundToThousandth(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Rounded to `digits` decimal places, with trailing zeros dropped. */
export function roundToDecimals(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/** The value, with negative zero turned into zero so it never prints as "-0". */
export function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
