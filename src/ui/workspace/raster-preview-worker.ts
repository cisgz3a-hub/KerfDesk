/// <reference lib="webworker" />

import { rasterPreviewBitmap, type RasterPreviewBitmapInput } from './raster-preview-bitmap';

self.onmessage = (event: MessageEvent<RasterPreviewBitmapInput>): void => {
  const bitmap = rasterPreviewBitmap(event.data);
  self.postMessage(bitmap, bitmap === null ? [] : [bitmap.rgba.buffer]);
};
