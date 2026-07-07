// ADR-029 Convert to Bitmap public UI entrypoint.
//
// The expensive production path now prefers a Web Worker so vector
// rasterization and PNG/luma encoding do not pin the React thread. The pure
// assembly helpers stay exported for tests and worker reuse.

import type { RasterImage } from '../../core/scene';
import { estimateBitmapConversion } from './bitmap-conversion-plan';
import {
  assembleBitmap,
  assembleBitmapAsync,
  bitmapConversionTarget,
  isConvertibleVector,
  sourceLabel,
  type BitmapConversionOptions,
  type BitmapLayerSetting,
  type ConvertibleVector,
  type ConvertToBitmapRenderType,
} from './bitmap-assembly';
import { canConvertBitmapInline, convertBitmapInWorker } from './convert-bitmap-worker-client';
import { lumaToBitmap } from './luma-bitmap';

export {
  DEFAULT_CONVERT_TO_BITMAP_DPI,
  MAX_CONVERT_TO_BITMAP_DPI,
  MIN_CONVERT_TO_BITMAP_DPI,
  assertBitmapConversionFits,
  estimateBitmapConversion,
} from './bitmap-conversion-plan';
export {
  assembleBitmap,
  assembleBitmapAsync,
  bitmapConversionTarget,
  isConvertibleVector,
  sourceLabel,
};
export type {
  BitmapConversionOptions,
  BitmapLayerSetting,
  ConvertibleVector,
  ConvertToBitmapRenderType,
};

export async function buildBitmapFromVector(
  o: ConvertibleVector,
  options: BitmapConversionOptions = {},
): Promise<RasterImage> {
  const id = crypto.randomUUID();
  const plan = estimateBitmapConversion(bitmapConversionTarget(o), options.dpi);
  if (plan.verdict.kind !== 'ok') {
    throw new Error(
      `Converted bitmap would be ${plan.pixelWidth}x${plan.pixelHeight} px (${plan.verdict.reason}). Lower DPI or scale the artwork down before converting to bitmap.`,
    );
  }
  const workerResult = convertBitmapInWorker(o, options, id);
  if (workerResult !== null) {
    try {
      return await workerResult;
    } catch (err) {
      if (!canConvertBitmapInline(plan)) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }
  if (!canConvertBitmapInline(plan)) {
    throw new Error(
      'Convert to Bitmap worker is unavailable for this large conversion. Reload the app and try again, or lower DPI before converting.',
    );
  }
  return assembleBitmapAsync(o, lumaToBitmap, id, options);
}
