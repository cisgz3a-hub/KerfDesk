import { evaluateRasterBudget, type RasterBudgetVerdict } from '../../core/raster/raster-budget';
import type { Bounds, Transform } from '../../core/scene';

const MIN_PIXEL_DIM = 1;
const DEFAULT_LINES_PER_MM = 10;
const MM_PER_INCH = 25.4;

export const DEFAULT_CONVERT_TO_BITMAP_DPI = DEFAULT_LINES_PER_MM * MM_PER_INCH;
export const MIN_CONVERT_TO_BITMAP_DPI = MM_PER_INCH;
export const MAX_CONVERT_TO_BITMAP_DPI = 1200;

export type BitmapConversionTarget = {
  readonly bounds: Bounds;
  readonly transform: Transform;
};

export type BitmapConversionPlan = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly linesPerMm: number;
  readonly dpi: number;
  readonly verdict: RasterBudgetVerdict;
};

export function estimateBitmapConversion(
  target: BitmapConversionTarget,
  dpi: number = DEFAULT_CONVERT_TO_BITMAP_DPI,
): BitmapConversionPlan {
  const normalizedDpi = normalizeConvertToBitmapDpi(dpi);
  const linesPerMm = normalizedDpi / MM_PER_INCH;
  const physicalWidthMm = displayedExtentMm(
    target.bounds.maxX - target.bounds.minX,
    target.transform.scaleX,
  );
  const physicalHeightMm = displayedExtentMm(
    target.bounds.maxY - target.bounds.minY,
    target.transform.scaleY,
  );
  const pixelWidth = convertedPixelExtent(physicalWidthMm, linesPerMm);
  const pixelHeight = convertedPixelExtent(physicalHeightMm, linesPerMm);
  return {
    pixelWidth,
    pixelHeight,
    linesPerMm,
    dpi: normalizedDpi,
    verdict: evaluateRasterBudget(pixelWidth, pixelHeight),
  };
}

export function assertBitmapConversionFits(plan: BitmapConversionPlan): void {
  if (plan.verdict.kind === 'ok') return;
  throw new Error(
    `Converted bitmap would be ${plan.pixelWidth}x${plan.pixelHeight} px (${plan.verdict.reason}). Lower DPI or scale the artwork down before converting to bitmap.`,
  );
}

export function normalizeConvertToBitmapDpi(dpi: number): number {
  const finite = Number.isFinite(dpi) ? dpi : DEFAULT_CONVERT_TO_BITMAP_DPI;
  return Math.max(MIN_CONVERT_TO_BITMAP_DPI, Math.min(MAX_CONVERT_TO_BITMAP_DPI, finite));
}

function displayedExtentMm(localMm: number, scale: number): number {
  return Math.max(0, localMm) * Math.abs(scale);
}

function convertedPixelExtent(mm: number, linesPerMm: number): number {
  return Math.max(MIN_PIXEL_DIM, Math.round(Math.max(0, mm) * Math.max(0, linesPerMm)));
}
