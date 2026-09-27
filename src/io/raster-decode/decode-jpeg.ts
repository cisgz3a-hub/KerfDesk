// Baseline and progressive JPEG decoding for headless tracing (ADR-477),
// through the JPEG decoder pdf.js already ships to the app (pdfjs-dist,
// Apache-2.0; no new dependency). Pixels stay on the stored grid: the caller
// applies the EXIF Orientation the shared JPEG header reader finds, as the
// browser does for an import.

import type { DecodedRaster } from './decoded-raster';
import { assertRasterSize } from './decoded-raster';

type JpegImageInstance = {
  readonly width: number;
  readonly height: number;
  parse(data: Uint8Array): void;
  getData(options: {
    readonly width: number;
    readonly height: number;
    readonly forceRGBA: boolean;
  }): Uint8ClampedArray;
};

type ImageDecodersModule = {
  readonly JpegImage: new (options?: Record<string, unknown>) => JpegImageInstance;
};

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export async function decodeJpeg(bytes: Uint8Array): Promise<DecodedRaster> {
  // @ts-expect-error pdfjs-dist ships no declarations for its image decoders.
  const decoders = (await import('pdfjs-dist/image_decoders/pdf.image_decoders.mjs')) as ImageDecodersModule;
  const jpeg = new decoders.JpegImage();
  jpeg.parse(bytes);
  assertRasterSize(jpeg.width, jpeg.height);
  const data = jpeg.getData({ width: jpeg.width, height: jpeg.height, forceRGBA: true });
  return { width: jpeg.width, height: jpeg.height, data: new Uint8ClampedArray(data) };
}
