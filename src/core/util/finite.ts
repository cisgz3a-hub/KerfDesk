// Finite-value guards shared by the pure core generators (CNC surfacing,
// removal grid, relief heightmap, feeds, and trace helpers). Exported cores
// must fail closed on NaN/Infinity/negative dimensions instead of trusting
// every caller to sanitize — a non-finite size can hang a row loop, size a
// zero-length buffer, or emit NaN into G-code. Extracted per CLAUDE.md's
// "extract on the second occurrence" rule.

// The value when finite, otherwise the fallback. Rejects NaN and ±Infinity.
export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

// The value when it is a finite number strictly greater than zero, otherwise
// the fallback. Rejects NaN, ±Infinity, zero, and negatives.
export function finitePositiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// True only for a finite number strictly greater than zero.
export function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// The guards below take `unknown`, for values read from files, storage or the
// wire. Each was written out again in six to twenty files (code quality audit
// C1, C2-P3-1); every copy replaced by an import had this exact body.

/** True for a number that is not NaN or infinite. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True for a finite number strictly greater than zero. */
export function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** True for a finite number that is zero or greater. */
export function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** True for a whole number that is zero or greater. */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** True for a whole number from zero up to `Number.MAX_SAFE_INTEGER`. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** True for a whole number greater than zero. */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** True for a finite number greater than zero; `undefined` is false. */
export function isDefinedFinitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/** The value when it is finite and zero or greater; otherwise zero. */
export function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
