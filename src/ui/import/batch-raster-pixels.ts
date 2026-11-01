// Multi-File Trace's TIFF (page 1, as TIFF import reads it) and Netpbm decode,
// and the resample to a planned working grid (ADR-409). Pure: the import
// worker runs both off the UI thread (ADR-357 Amendment 2), and
// ui/commands/batch-raster-decode.ts runs them in place only where no Worker
// exists, as in the node test environment.

import { resampleBuffer } from '../../core/image-resample';
import type { RawImageData } from '../../core/trace';
import { decodePnm } from '../../io/pnm/decode-pnm';
import { decodeTiffPage } from '../../io/tiff/tiff-page';
import { tiffPageCount } from '../../io/tiff/tiff-structure';

export type BatchRasterFormat = 'tiff' | 'pnm';

export type DecodedBatchRaster = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  /** The file's own physical size (TIFF resolution tags); null, default DPI. */
  readonly sizeMm: { readonly widthMm: number; readonly heightMm: number } | null;
  /** A multi-page TIFF's page count; only page 1 is traced. */
  readonly pageCount?: number;
};

export function decodeBatchRasterBytes(
  bytes: Uint8Array,
  format: BatchRasterFormat,
): DecodedBatchRaster {
  if (format === 'pnm') return { ...decodePnm(bytes), sizeMm: null };
  const page = decodeTiffPage(bytes, 1);
  const pageCount = tiffPageCount(bytes);
  return {
    ...(pageCount > 1 ? { pageCount } : {}),
    width: page.width,
    height: page.height,
    rgba: page.rgba,
    sizeMm:
      page.densitySource === 'embedded' ? { widthMm: page.widthMm, heightMm: page.heightMm } : null,
  };
}

/** The raster resampled to exactly width x height. */
export function resampleBatchRaster(
  raster: Pick<DecodedBatchRaster, 'width' | 'height' | 'rgba'>,
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
