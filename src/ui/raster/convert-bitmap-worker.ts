// Convert-to-Bitmap worker. It runs the expensive vector rasterization,
// luma base64 encode, and PNG encode away from the React/UI thread.
//
// Vite bundles this via the direct
// `new Worker(new URL('./convert-bitmap-worker.ts', import.meta.url), { type: 'module' })`
// call in convert-bitmap-worker-client.ts.

/// <reference lib="webworker" />

import type { VectorRaster } from '../../core/raster';
import { assembleBitmapAsync } from './bitmap-assembly';
import { lumaToBase64, lumaToRgba, type BitmapFields } from './luma-bitmap';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from './convert-bitmap-worker-protocol';

const PNG_MIME = 'image/png';

self.onmessage = (e: MessageEvent<ConvertBitmapWorkerRequest>): void => {
  const { id, rasterId, vectors, options } = e.data;
  void (async (): Promise<void> => {
    try {
      const raster = await assembleBitmapAsync(vectors, encodeRasterInWorker, rasterId, options);
      const response: ConvertBitmapWorkerResponse = { id, kind: 'ok', raster };
      self.postMessage(response);
    } catch (err) {
      const response: ConvertBitmapWorkerResponse = {
        id,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(response);
    }
  })();
};

async function encodeRasterInWorker(raster: VectorRaster): Promise<BitmapFields> {
  const rgba = lumaToRgba(raster);
  const canvas = new OffscreenCanvas(raster.width, raster.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Could not create worker canvas context for bitmap encoding.');
  const imageData = ctx.createImageData(raster.width, raster.height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: PNG_MIME });
  return { dataUrl: blobToDataUrl(blob), lumaBase64: lumaToBase64(raster.luma) };
}

function blobToDataUrl(blob: Blob): string {
  return new FileReaderSync().readAsDataURL(blob);
}
