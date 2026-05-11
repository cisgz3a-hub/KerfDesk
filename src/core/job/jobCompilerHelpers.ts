/**
 * T1-154: pure number-validation, acceleration-resolution, and mode-
 * mapping helpers extracted from JobCompiler. Pre-T1-154 four pure
 * helpers + the acceleration-bound constants lived inside the
 * 1130-line compiler file.
 *
 *   - `MIN_PLAUSIBLE_ACCEL_MM_PER_S2` / `MAX_PLAUSIBLE_ACCEL_MM_PER_S2`
 *     / `DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2`: bounds for "plausible
 *     machine acceleration" used to detect implausible firmware
 *     reports.
 *   - `isPlausibleMachineAccel(value)`: predicate that returns true
 *     only when value is finite, non-null, and inside the
 *     [MIN, MAX] range. Used by `resolveMaxAccelMmPerS2` and the
 *     compiler's raster-power velocity-curve computation.
 *   - `clampFiniteNumber(value, min, max, fallback)`: coerce
 *     `unknown` to a number, clamp to [min, max], or return
 *     `fallback` when the input is non-finite.
 *   - `mapModeToType(mode)`: maps `LayerMode` ('cut'/'engrave'/
 *     'score'/'image') to `OperationType` ('cut'/'engrave'/'score'/
 *     'raster' — note the image→raster rename).
 *
 * `resolveMaxAccelMmPerS2` (already exported from JobCompiler) is
 * not moved here because it's the public entry point that selects
 * machine vs profile vs default — leaving it in JobCompiler keeps
 * its public-surface contract stable. It will be re-imported below
 * to keep using these helpers.
 */
import type { LayerMode } from '../scene/Layer';
import type { OperationType } from './Job';

/** Lower bound for "plausible machine acceleration" (mm/s²). */
export const MIN_PLAUSIBLE_ACCEL_MM_PER_S2 = 100;

/** Upper bound for "plausible machine acceleration" (mm/s²). */
export const MAX_PLAUSIBLE_ACCEL_MM_PER_S2 = 20000;

/** Default raster-mode acceleration when no plausible value is known. */
export const DEFAULT_RASTER_MAX_ACCEL_MM_PER_S2 = 1000;

/**
 * Return true when `value` is non-null, finite, AND inside the
 * plausible-acceleration bounds [100, 20000] mm/s². Used to filter
 * implausible firmware reports (e.g. `$120 = 0` or `$120 = 1e9`)
 * from the raster-power velocity-curve computation.
 */
export function isPlausibleMachineAccel(value: number | null | undefined): boolean {
  return (
    value != null
    && Number.isFinite(value)
    && value >= MIN_PLAUSIBLE_ACCEL_MM_PER_S2
    && value <= MAX_PLAUSIBLE_ACCEL_MM_PER_S2
  );
}

/**
 * Coerce `value` to a number, then clamp to `[min, max]`. Returns
 * `fallback` when the coerced value is non-finite (Number(undefined)
 * → NaN, etc.). The unknown-typed input lets callers pass raw config
 * fields without pre-checking the type.
 */
export function clampFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Map a Layer's `LayerMode` to a Job `OperationType`. The only
 * non-identity mapping is `image → raster` — the layer panel calls
 * it "Image" because operators think in terms of the artwork they
 * uploaded, but the planner's pipeline calls it "raster" because
 * that's the burn strategy.
 */
export function mapModeToType(mode: LayerMode): OperationType {
  switch (mode) {
    case 'cut':     return 'cut';
    case 'engrave': return 'engrave';
    case 'score':   return 'score';
    case 'image':   return 'raster';
  }
}
