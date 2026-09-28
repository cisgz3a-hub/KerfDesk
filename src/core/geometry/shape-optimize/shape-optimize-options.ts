// Settings for Optimize Shapes (LightBurn gap LBG-T22): smooth the outline
// with corners kept sharp, then fit it with lines, circular arcs and cubic
// Béziers within a tolerance. Every distance is in world millimetres, after
// the object's placement, so the numbers mean the same on any scaled object.

export type ShapeOptimizeFitWith = 'lines-arcs-curves' | 'lines-arcs';

export type ShapeOptimizeOptions = {
  readonly smooth: boolean;
  /** Gaussian smoothing distance (the kernel's sigma along the outline), mm. */
  readonly smoothingMm: number;
  /** A point turning more than this is a corner: it stays put and stays sharp. */
  readonly cornerAngleDeg: number;
  readonly fit: boolean;
  /** Largest distance the fitted outline may lie from the (smoothed) points, mm. */
  readonly fitToleranceMm: number;
  readonly fitWith: ShapeOptimizeFitWith;
};

export const DEFAULT_SHAPE_OPTIMIZE_OPTIONS: ShapeOptimizeOptions = {
  smooth: true,
  smoothingMm: 0.25,
  cornerAngleDeg: 30,
  fit: true,
  fitToleranceMm: 0.05,
  fitWith: 'lines-arcs-curves',
};

export const SMOOTHING_RANGE_MM = { min: 0.02, max: 5 } as const;
export const CORNER_ANGLE_RANGE_DEG = { min: 5, max: 175 } as const;
export const FIT_TOLERANCE_RANGE_MM = { min: 0.005, max: 1 } as const;

/** The options with every number inside its range; a non-number takes the default. */
export function clampShapeOptimizeOptions(options: ShapeOptimizeOptions): ShapeOptimizeOptions {
  return {
    smooth: options.smooth,
    smoothingMm: clamp(
      options.smoothingMm,
      SMOOTHING_RANGE_MM,
      DEFAULT_SHAPE_OPTIMIZE_OPTIONS.smoothingMm,
    ),
    cornerAngleDeg: clamp(
      options.cornerAngleDeg,
      CORNER_ANGLE_RANGE_DEG,
      DEFAULT_SHAPE_OPTIMIZE_OPTIONS.cornerAngleDeg,
    ),
    fit: options.fit,
    fitToleranceMm: clamp(
      options.fitToleranceMm,
      FIT_TOLERANCE_RANGE_MM,
      DEFAULT_SHAPE_OPTIMIZE_OPTIONS.fitToleranceMm,
    ),
    fitWith: options.fitWith === 'lines-arcs' ? 'lines-arcs' : 'lines-arcs-curves',
  };
}

function clamp(
  value: number,
  range: { readonly min: number; readonly max: number },
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, value));
}
