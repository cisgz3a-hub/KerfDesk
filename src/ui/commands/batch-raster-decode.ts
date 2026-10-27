// Multi-File Trace inputs the browser cannot decode: TIFF (page 1, as TIFF
// import reads it) and Netpbm P1-P6. Each is decoded once at its own grid and
// then resampled to the working grid the batch plans, so it gets the same
// max-edge handling as a PNG or JPEG (ADR-409).
//
// Both run in the import worker, as File > Import decodes a TIFF in its own
// worker (ADR-357 item 6 and Amendment 1). Decoding a TIFF takes about 1 us
// per pixel, so on this thread a 24 MP scan froze the window, Abort and
// Ctrl+. with it, for 15-24 s during a job (rolling audit v5 J6-P2-3). The
// batch's Cancel aborts the worker request, which stops the worker. Only
// where no Worker exists (the node test environment) do they run in place.

import type { RawImageData } from '../../core/trace';
import { isPnmFileName } from '../../io/pnm/decode-pnm';
import {
  decodeBatchRasterBytes,
  resampleBatchRaster,
  type BatchRasterFormat,
  type DecodedBatchRaster,
} from '../import/batch-raster-pixels';
import { decodeBatchRasterOffThread, resampleRgbaOffThread } from '../import/import-worker-client';
import { PREVIEW_MAX_EDGE_PX, scaleToCap } from '../trace/trace-decode-cap';

export type { DecodedBatchRaster } from '../import/batch-raster-pixels';

export const BATCH_TIFF_EXTENSIONS = ['.tif', '.tiff'] as const;
export const BATCH_PNM_EXTENSIONS = ['.pbm', '.pgm', '.ppm', '.pnm'] as const;

function batchRasterFormat(file: File): BatchRasterFormat | null {
  if (/\.(tif|tiff)$/i.test(file.name) || file.type === 'image/tiff') return 'tiff';
  return isPnmFileName(file.name) ? 'pnm' : null;
}

/** Decode a TIFF or Netpbm file; null for a format the browser decodes. */
export async function decodeBatchRasterFile(
  file: File,
  signal?: AbortSignal,
): Promise<DecodedBatchRaster | null> {
  const format = batchRasterFormat(file);
  if (format === null) return null;
  signal?.throwIfAborted();
  const offThread = decodeBatchRasterOffThread(
    file,
    format,
    signal === undefined ? {} : { signal },
  );
  if (offThread !== null) return offThread;
  return decodeBatchRasterBytes(new Uint8Array(await file.arrayBuffer()), format);
}

/** The decode resampled to fit maxEdge, as the browser loader caps a decode. */
export function batchRasterAtMaxEdge(
  raster: DecodedBatchRaster,
  maxEdge: number = PREVIEW_MAX_EDGE_PX,
): RawImageData {
  const target = scaleToCap(raster.width, raster.height, maxEdge);
  return resampleBatchRaster(raster, target.width, target.height);
}

/** batchRasterAtMaxEdge in the import worker, so a large scan never resamples on this thread. */
export async function sampleBatchRaster(
  raster: DecodedBatchRaster,
  maxEdge: number = PREVIEW_MAX_EDGE_PX,
  signal?: AbortSignal,
): Promise<RawImageData> {
  signal?.throwIfAborted();
  const target = scaleToCap(raster.width, raster.height, maxEdge);
  const image = { width: raster.width, height: raster.height, data: raster.rgba };
  const options = signal === undefined ? {} : { signal };
  const offThread = resampleRgbaOffThread(image, target.width, target.height, options);
  return offThread ?? resampleBatchRaster(raster, target.width, target.height);
}
