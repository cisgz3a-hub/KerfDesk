// Multi-File Trace's resample of a decoded TIFF or Netpbm raster to a planned
// working grid (ADR-409). Apart from the decode (batch-raster-pixels.ts) so the
// window can resample without loading the TIFF decoder and its inflate
// library, which belong to the import worker, not the boot bundle (S9-P3-2).

import { resampleBuffer } from '../../core/image-resample';
import type { RawImageData } from '../../core/trace';

/** The raster resampled to exactly width x height. */
export function resampleBatchRaster(
  raster: {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  },
  width: number,
  height: number,
): RawImageData & { readonly data: Uint8ClampedArray<ArrayBuffer> } {
  const source = { width: raster.width, height: raster.height, data: raster.rgba };
  const sampled = resampleBuffer(source, width, height);
  return { width: sampled.width, height: sampled.height, data: toOwnBuffer(sampled.data) };
}

function toOwnBuffer(data: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer
    ? (data as Uint8ClampedArray<ArrayBuffer>)
    : new Uint8ClampedArray(data);
}
