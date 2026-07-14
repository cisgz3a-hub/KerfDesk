import type { DitherAlgorithm } from '../scene';

export const MAX_RASTER_WORKING_BYTES = 64 * 1024 * 1024;
export const MAX_RASTER_WORK_UNITS = 50_000_000;
export const STREAMED_RASTER_PIXEL_THRESHOLD = 4_000_000;
/** @deprecated Use MAX_RASTER_WORK_UNITS; retained for API compatibility. */
export const MAX_RASTER_PIXELS = MAX_RASTER_WORK_UNITS;
export const MAX_RASTER_LINES_PER_MM = 25;
export const WARN_RASTER_LINES_PER_MM = 20;

const DEFAULT_MATERIALIZED_BYTES_PER_PIXEL = 8;
const DEFAULT_SOURCE_PEAK_BYTES_PER_PIXEL = 3;
const STREAMED_ROW_BYTES_PER_PIXEL = 4;

export type RasterBudgetMode = 'materialized' | 'streamed-rows';

export type RasterBudgetOptions = {
  readonly sourcePixelCount?: number;
  readonly sourceWorkingBytesPerPixel?: number;
  readonly ditherAlgorithm?: DitherAlgorithm;
  readonly passes?: number;
  readonly streamedRows?: boolean;
};

export type RasterBudget = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly pixelCount: number;
  readonly workUnits: number;
  readonly mode: RasterBudgetMode;
  readonly estimatedWorkingBytes: number;
};

export type RasterBudgetVerdict =
  | { readonly kind: 'ok'; readonly budget: RasterBudget }
  | { readonly kind: 'too-large'; readonly budget: RasterBudget; readonly reason: string };

export function rasterBudget(
  pixelWidth: number,
  pixelHeight: number,
  options: RasterBudgetOptions = {},
): RasterBudget {
  const width = finiteExtent(pixelWidth);
  const height = finiteExtent(pixelHeight);
  const pixelCount = width * height;
  const passes = Math.max(1, Math.floor(options.passes ?? 1));
  const mode = options.streamedRows === true ? 'streamed-rows' : 'materialized';
  const sourcePixels = Math.max(0, Math.floor(options.sourcePixelCount ?? 0));
  const sourceBytesPerPixel = Math.max(
    0,
    options.sourceWorkingBytesPerPixel ?? DEFAULT_SOURCE_PEAK_BYTES_PER_PIXEL,
  );
  return {
    pixelWidth: width,
    pixelHeight: height,
    pixelCount,
    workUnits: pixelCount * passes,
    mode,
    estimatedWorkingBytes:
      mode === 'streamed-rows'
        ? sourcePixels * sourceBytesPerPixel + width * STREAMED_ROW_BYTES_PER_PIXEL
        : sourcePixels * sourceBytesPerPixel +
          pixelCount * materializedBytesPerPixel(options.ditherAlgorithm),
  };
}

export function evaluateRasterBudget(
  pixelWidth: number,
  pixelHeight: number,
  options: RasterBudgetOptions = {},
): RasterBudgetVerdict {
  const budget = rasterBudget(pixelWidth, pixelHeight, options);
  if (budget.pixelCount <= 0) {
    return { kind: 'too-large', budget, reason: 'invalid raster pixel dimensions' };
  }
  if (budget.workUnits > MAX_RASTER_WORK_UNITS) {
    return {
      kind: 'too-large',
      budget,
      reason: `${budget.workUnits} pixel-pass work units exceed the ${MAX_RASTER_WORK_UNITS} work-unit budget`,
    };
  }
  if (budget.estimatedWorkingBytes > MAX_RASTER_WORKING_BYTES) {
    const estimatedMb = Math.ceil(budget.estimatedWorkingBytes / (1024 * 1024));
    return {
      kind: 'too-large',
      budget,
      reason: `~${estimatedMb} MB ${budget.mode} working set exceeds the ${MAX_RASTER_WORKING_BYTES / (1024 * 1024)} MB budget`,
    };
  }
  return { kind: 'ok', budget };
}

export function supportsStreamedRasterRows(algorithm: DitherAlgorithm): boolean {
  return algorithm === 'threshold' || algorithm === 'ordered' || algorithm === 'grayscale';
}

function finiteExtent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function materializedBytesPerPixel(algorithm: DitherAlgorithm | undefined): number {
  return isErrorDiffusion(algorithm) ? 9 : DEFAULT_MATERIALIZED_BYTES_PER_PIXEL;
}

function isErrorDiffusion(algorithm: DitherAlgorithm | undefined): boolean {
  return (
    algorithm !== undefined &&
    algorithm !== 'threshold' &&
    algorithm !== 'ordered' &&
    algorithm !== 'grayscale'
  );
}
