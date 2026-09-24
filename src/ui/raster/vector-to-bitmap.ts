// ADR-029 Convert to Bitmap public UI entrypoint.
//
// The expensive production path requires a Web Worker so vector rasterization
// and PNG/luma encoding do not pin the React thread. The pure assembly
// helpers stay exported for tests and worker reuse. Conversion takes the
// whole selection: a multi-selection merges into ONE bitmap, matching
// LightBurn (ADR-029 amendment ii).

import type { RasterImage } from '../../core/scene';
import { assertBitmapConversionFits, estimateBitmapConversion } from './bitmap-conversion-plan';
import {
  assembleBitmap,
  assembleBitmapAsync,
  bitmapConversionTarget,
  conversionSourceLabel,
  isConvertibleVector,
  sourceLabel,
  type BitmapConversionOptions,
  type BitmapLayerSetting,
  type ConvertibleVector,
  type ConvertToBitmapRenderType,
} from './bitmap-assembly';
import { convertBitmapInWorker } from './convert-bitmap-worker-client';

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
  conversionSourceLabel,
  isConvertibleVector,
  sourceLabel,
};
export type {
  BitmapConversionOptions,
  BitmapLayerSetting,
  ConvertibleVector,
  ConvertToBitmapRenderType,
};

export async function buildBitmapFromVectors(
  objects: ReadonlyArray<ConvertibleVector>,
  options: BitmapConversionOptions = {},
  signal?: AbortSignal,
): Promise<RasterImage> {
  if (signal?.aborted === true) throw new DOMException('Bitmap conversion cancelled', 'AbortError');
  const id = crypto.randomUUID();
  const plan = estimateBitmapConversion(
    bitmapConversionTarget(objects, options.photoRibbons),
    options.dpi,
  );
  assertBitmapConversionFits(plan);
  const workerResult = convertBitmapInWorker(objects, options, id, signal);
  if (workerResult === null) {
    throw new Error(
      'Convert to Bitmap worker is unavailable. Reload the app or use a browser that supports Web Workers before converting.',
    );
  }
  return workerResult;
}
