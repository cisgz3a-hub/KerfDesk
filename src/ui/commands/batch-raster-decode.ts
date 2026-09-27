// Multi-File Trace inputs the browser cannot decode: TIFF (page 1, as TIFF
// import reads it) and Netpbm P1-P6. Each is decoded once at its own grid and
// then resampled to the working grid the batch plans, so it gets the same
// max-edge handling as a PNG or JPEG (ADR-409).

import { resampleBuffer } from '../../core/image-resample';
import type { RawImageData } from '../../core/trace';
import { decodePnm, isPnmFileName } from '../../io/pnm/decode-pnm';
import { decodeTiffPage } from '../../io/tiff/tiff-page';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from '../trace/trace-decode-cap';

export type DecodedBatchRaster = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
  /** The file's own physical size (TIFF resolution tags); null, default DPI. */
  readonly sizeMm: { readonly widthMm: number; readonly heightMm: number } | null;
};

export const BATCH_TIFF_EXTENSIONS = ['.tif', '.tiff'] as const;
export const BATCH_PNM_EXTENSIONS = ['.pbm', '.pgm', '.ppm', '.pnm'] as const;

function isTiffFile(file: File): boolean {
  return /\.(tif|tiff)$/i.test(file.name) || file.type === 'image/tiff';
}

/** Decode a TIFF or Netpbm file; null for a format the browser decodes. */
export async function decodeBatchRasterFile(file: File): Promise<DecodedBatchRaster | null> {
  const tiff = isTiffFile(file);
  if (!tiff && !isPnmFileName(file.name)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!tiff) return { ...decodePnm(bytes), sizeMm: null };
  const page = decodeTiffPage(bytes, 1);
  return {
    width: page.width,
    height: page.height,
    rgba: page.rgba,
    sizeMm:
      page.densitySource === 'embedded' ? { widthMm: page.widthMm, heightMm: page.heightMm } : null,
  };
}

/** The decode resampled to fit maxEdge, as the browser loader caps a decode. */
export function batchRasterAtMaxEdge(
  raster: DecodedBatchRaster,
  maxEdge: number = PREVIEW_MAX_EDGE_PX,
): RawImageData {
  const target = scaleToCap(raster.width, raster.height, maxEdge);
  const source = { width: raster.width, height: raster.height, data: raster.rgba };
  const sampled = resampleBuffer(source, target.width, target.height);
  return { width: sampled.width, height: sampled.height, data: sampled.data };
}
