// Exact decimal quantization for vector export (ADR-403).
//
// A coordinate is snapped to an integer multiple of a power-of-ten step and
// printed from that integer, so the text never carries binary-float noise
// ("0.30000000000000004") and relative path commands can be written as
// integer differences without accumulating rounding drift.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

/** Default export precision: one micrometre. Below every laser/CNC resolution. */
export const DEFAULT_EXPORT_PRECISION_MM = 0.001;

// Keep integer grid indices well inside the exactly-representable range.
const MAX_SAFE_INDEX = 2 ** 52;
const MIN_EXPONENT = -12;
const MAX_EXPONENT = 6;

export type DecimalGrid = {
  /** Base-ten exponent of the step: step = 10^exponent. */
  readonly exponent: number;
  readonly step: number;
};

/**
 * The coarsest power-of-ten grid whose step does not exceed `maxStep`.
 * Snapping to it moves each coordinate by at most half a step.
 */
export function decimalGridAtMost(maxStep: number): DecimalGrid {
  const safe = Number.isFinite(maxStep) && maxStep > 0 ? maxStep : 10 ** MIN_EXPONENT;
  // The epsilon keeps exact decades (0.001) from falling one decade low
  // through log10 rounding (log10(0.001) = -2.9999999999999996).
  const raw = Math.floor(Math.log10(safe) + 1e-9);
  const exponent = Math.max(MIN_EXPONENT, Math.min(MAX_EXPONENT, raw));
  return { exponent, step: 10 ** exponent };
}

/** Integer index of the grid point nearest to `value`. Throws on non-finite input. */
export function gridIndex(value: number, grid: DecimalGrid): number {
  if (!Number.isFinite(value)) throw new Error('Artwork contains a non-finite coordinate.');
  const index =
    grid.exponent >= 0 ? Math.round(value / grid.step) : Math.round(value * 10 ** -grid.exponent);
  if (Math.abs(index) > MAX_SAFE_INDEX) {
    throw new Error('Artwork coordinate is too large for the requested export precision.');
  }
  return index === 0 ? 0 : index; // normalise -0
}

/** Shortest plain decimal text for `index` grid steps ("-0.25", "12", "0.001"). */
export function formatGridIndex(index: number, grid: DecimalGrid): string {
  if (index === 0) return '0';
  const negative = index < 0;
  const digits = String(Math.abs(index));
  let text: string;
  if (grid.exponent >= 0) {
    text = digits + '0'.repeat(grid.exponent);
  } else {
    const decimals = -grid.exponent;
    const padded = digits.padStart(decimals + 1, '0');
    const whole = padded.slice(0, padded.length - decimals);
    const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
    text = fraction === '' ? whole : whole + '.' + fraction;
  }
  return negative ? '-' + text : text;
}

/** Snap and print in one step. */
export function formatOnGrid(value: number, grid: DecimalGrid): string {
  return formatGridIndex(gridIndex(value, grid), grid);
}

/** The grid value nearest to `value`, as a number. */
export function snapToGrid(value: number, grid: DecimalGrid): number {
  return Number(formatOnGrid(value, grid));
}

/** Grid indices of an interval rounded outward so it still contains [min, max]. */
export function outwardGridIndices(
  min: number,
  max: number,
  grid: DecimalGrid,
): { readonly lo: number; readonly hi: number } {
  // The epsilon absorbs binary noise in value * 10^k so an exact grid value
  // (10 * 1000) is not pushed one step outward.
  const scaled = (value: number): number =>
    grid.exponent >= 0 ? value / grid.step : value * 10 ** -grid.exponent;
  const lo = Math.floor(scaled(min) + 1e-9);
  const hi = Math.ceil(scaled(max) - 1e-9);
  return { lo: lo === 0 ? 0 : lo, hi: hi === 0 ? 0 : hi };
}

/** Round an interval outward to the grid so it still contains [min, max]. */
export function outwardOnGrid(
  min: number,
  max: number,
  grid: DecimalGrid,
): { readonly min: number; readonly max: number } {
  const { lo, hi } = outwardGridIndices(min, max, grid);
  return {
    min: Number(formatGridIndex(lo, grid)),
    max: Number(formatGridIndex(hi, grid)),
  };
}
