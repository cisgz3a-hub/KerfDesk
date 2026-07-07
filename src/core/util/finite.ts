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
