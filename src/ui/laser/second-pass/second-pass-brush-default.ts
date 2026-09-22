export interface DrawingBoundsMm {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const MIN_BRUSH_DIAMETER_MM = 0.1;
const BRUSH_FRACTION_OF_SHORTER_SIDE = 1 / 12;

/** Default brush for a saved engraving: a twelfth of its shorter side, never
 * below 0.1 mm, rounded to hundredths so the field shows a readable number
 * instead of floating-point noise such as 0.8249999999999981. */
export function defaultSecondPassBrushDiameterMm(bounds: DrawingBoundsMm): number {
  const shorter = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const rounded = Math.round(shorter * BRUSH_FRACTION_OF_SHORTER_SIDE * 100) / 100;
  return Math.max(MIN_BRUSH_DIAMETER_MM, rounded);
}
