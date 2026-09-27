// Format sniffing for headless tracing (ADR-477): the trace command reads the
// same raster formats a KerfDesk import accepts (PNG, JPEG, BMP, TIFF) plus
// Potrace's Netpbm, choosing the decoder from the file's magic bytes, never
// its name, so stdin needs no hint.

import { decodeTiffPage } from '../tiff/tiff-page';
import { decodeBmp, decodePnm, isBmp, isPnm } from './decode-bmp-pnm';
import { decodeJpeg, isJpeg } from './decode-jpeg';
import { decodePng, isPng } from './decode-png';
import type { DecodedRaster } from './decoded-raster';

export type { DecodedRaster } from './decoded-raster';
export type RasterFormat = 'png' | 'jpeg' | 'bmp' | 'tiff' | 'pnm';

export function sniffRasterFormat(bytes: Uint8Array): RasterFormat | null {
  if (isPng(bytes)) return 'png';
  if (isJpeg(bytes)) return 'jpeg';
  if (isBmp(bytes)) return 'bmp';
  if (isPnm(bytes)) return 'pnm';
  const tiff = String.fromCharCode(...bytes.subarray(0, 4));
  return tiff === 'II*\u0000' || tiff === 'MM\u0000*' ? 'tiff' : null;
}

export async function decodeRaster(bytes: Uint8Array): Promise<DecodedRaster> {
  const format = sniffRasterFormat(bytes);
  if (format === 'png') return decodePng(bytes);
  if (format === 'jpeg') return decodeJpeg(bytes);
  if (format === 'bmp') return decodeBmp(bytes);
  if (format === 'pnm') return decodePnm(bytes);
  if (format === 'tiff') return decodeTiff(bytes);
  throw new Error('Unrecognised image format: expected PNG, JPEG, BMP, TIFF or PBM/PGM/PPM.');
}

// The first page, oriented, as the TIFF import opens it by default.
function decodeTiff(bytes: Uint8Array): DecodedRaster {
  const page = decodeTiffPage(bytes, 1);
  const base = { width: page.width, height: page.height, data: page.rgba };
  if (page.densitySource !== 'embedded') return base;
  const dpi = { x: (page.width * 25.4) / page.widthMm, y: (page.height * 25.4) / page.heightMm };
  return { ...base, dpi };
}
