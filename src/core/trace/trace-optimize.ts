// The trace dialog's Optimize knob as a geometry-tolerance scale, shared by
// every finisher (contour, edge, centerline) so one setting means one thing.
// Kept in its own module because the centerline stage cannot import the
// contour tracer (which itself imports the centerline package).

const DEFAULT_OPTIMIZE = 0.2;
const OPTIMIZE_TOLERANCE_SLOPE = 0.75;

/** Optimize scales geometry tolerances around the established neutral 0.2. */
export function optimizationToleranceScaleFromOptimize(optimize: number | undefined): number {
  const value = Number.isFinite(optimize) ? (optimize as number) : DEFAULT_OPTIMIZE;
  const bounded = Math.min(2, Math.max(0, value));
  return Math.max(0.25, 1 + (bounded - DEFAULT_OPTIMIZE) * OPTIMIZE_TOLERANCE_SLOPE);
}
