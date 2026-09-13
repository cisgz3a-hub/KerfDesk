import {
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
  MM_PER_INCH,
  type RasterBudgetVerdict,
} from '../../core/raster';
import { transformedBounds, type Bounds, type Transform } from '../../core/scene';
import { bitmapConversionBounds } from './bitmap-conversion-bounds';
import {
  bitmapConversionResources,
  type BitmapGeometryResources,
} from './bitmap-conversion-resources';

const MIN_PIXEL_DIM = 1;
const DEFAULT_LINES_PER_MM = 10;

export const DEFAULT_CONVERT_TO_BITMAP_DPI = DEFAULT_LINES_PER_MM * MM_PER_INCH;
// The conversion DPI becomes the created image layer's linesPerMm (the swap in
// applyConvertToBitmap stamps it onto the layer), so the legal range derives
// from the app-wide raster density limits — otherwise Convert mints layers the
// Cuts panel clamps to a different density on the next edit. LightBurn's
// dialog offers 10–2000 DPI; ours is narrower by design because LightBurn
// keeps image resolution and layer interval independent while our model
// couples them (deliberate divergence, ADR-029 amendment 2026-07-07).
export const MIN_CONVERT_TO_BITMAP_DPI = MIN_RASTER_LINES_PER_MM * MM_PER_INCH;
export const MAX_CONVERT_TO_BITMAP_DPI = MAX_RASTER_LINES_PER_MM * MM_PER_INCH;

export type BitmapConversionTarget = {
  readonly bounds: Bounds;
  readonly transform: Transform;
  readonly geometryStats?: BitmapGeometryResources;
};

export type BitmapConversionPlan = {
  readonly bounds: Bounds;
  readonly maxFlattenedSegments: number;
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
  // Full-transform AABB (not extent × |scale|): rotation widens the physical
  // footprint, and the builder rasterizes into exactly this baked AABB — the
  // dialog estimate and the conversion must agree or the dialog approves
  // conversions the builder then refuses (2026-07-07 audit finding).
  const displayed = conversionBoundsInScene(target, linesPerMm);
  const physicalWidthMm = Math.max(0, displayed.maxX - displayed.minX);
  const physicalHeightMm = Math.max(0, displayed.maxY - displayed.minY);
  const pixelWidth = convertedPixelExtent(physicalWidthMm, linesPerMm);
  const pixelHeight = convertedPixelExtent(physicalHeightMm, linesPerMm);
  const resources = bitmapConversionResources(pixelWidth, pixelHeight, target.geometryStats);
  return {
    bounds: displayed,
    maxFlattenedSegments: resources.maxFlattenedSegments,
    pixelWidth,
    pixelHeight,
    linesPerMm,
    dpi: normalizedDpi,
    verdict: resources.verdict,
  };
}

export function assertBitmapConversionFits(plan: BitmapConversionPlan): void {
  if (plan.verdict.kind === 'ok') return;
  throw new Error(
    `Converted bitmap would be ${plan.pixelWidth}x${plan.pixelHeight} px (${plan.verdict.reason}). Lower DPI, scale the artwork down, or simplify its geometry before converting to bitmap.`,
  );
}

export function normalizeConvertToBitmapDpi(dpi: number): number {
  const finite = Number.isFinite(dpi) ? dpi : DEFAULT_CONVERT_TO_BITMAP_DPI;
  return Math.max(MIN_CONVERT_TO_BITMAP_DPI, Math.min(MAX_CONVERT_TO_BITMAP_DPI, finite));
}

function convertedPixelExtent(mm: number, linesPerMm: number): number {
  return Math.max(MIN_PIXEL_DIM, Math.round(Math.max(0, mm) * Math.max(0, linesPerMm)));
}

function conversionBoundsInScene(target: BitmapConversionTarget, linesPerMm: number): Bounds {
  const { bounds } = target;
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.maxX < bounds.minX ||
    bounds.maxY < bounds.minY
  ) {
    return { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
  }
  return bitmapConversionBounds(transformedBounds(bounds, target.transform), linesPerMm);
}
