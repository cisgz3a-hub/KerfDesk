// The image a headless trace (ADR-477) hands the tracer, prepared the way the
// app's own import prepares it: decoded on the stored grid, turned by a
// JPEG's EXIF Orientation (as the browser decode does), RGB composited onto
// white with alpha kept (compositeRgbOverWhitePreservingAlpha), and sized in
// millimetres from the density the Multi-File Trace reads (image-density),
// the TIFF header's own resolution, or an explicit --dpi.

import type { RawImageData } from '../../core/trace';
import { decodeRaster, sniffRasterFormat } from '../../io/raster-decode/decode-raster';
import { densityFromBytes, type ImageDensity } from '../common/image-density';
import { rasterImportGeometry, type RasterImportGeometry } from '../common/image-import';
import { compositeRgbOverWhitePreservingAlpha } from '../trace/image-loader';
import { jpegExifOrientation, type ExifOrientation } from '../trace/jpeg-header';

export type TraceCliSource = {
  readonly image: RawImageData;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly densitySource: RasterImportGeometry['densitySource'] | 'option';
};

export async function traceCliSource(
  bytes: Uint8Array,
  dpiOverride: ImageDensity | null,
): Promise<TraceCliSource> {
  const decoded = await decodeRaster(bytes);
  const orientation = sniffRasterFormat(bytes) === 'jpeg' ? jpegExifOrientation(bytes) : 1;
  const oriented = orientRaster(decoded, orientation);
  const image = compositeRgbOverWhitePreservingAlpha(oriented);
  const embedded =
    densityFromBytes(bytes) ??
    (decoded.dpi === undefined ? null : { xDpi: decoded.dpi.x, yDpi: decoded.dpi.y });
  const geometry = rasterImportGeometry({
    naturalWidth: image.width,
    naturalHeight: image.height,
    sampledWidth: image.width,
    sampledHeight: image.height,
    density: dpiOverride ?? embedded,
  });
  return {
    image,
    widthMm: geometry.bounds.maxX - geometry.bounds.minX,
    heightMm: geometry.bounds.maxY - geometry.bounds.minY,
    densitySource: dpiOverride === null ? geometry.densitySource : 'option',
  };
}

/** Turn a stored-grid raster upright for its EXIF Orientation (1-8). */
export function orientRaster(image: RawImageData, orientation: ExifOrientation): RawImageData {
  if (orientation === 1) return image;
  const { width: w, height: h } = image;
  const swap = orientation >= 5;
  const outWidth = swap ? h : w;
  const outHeight = swap ? w : h;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const [sx, sy] = sourcePixel(orientation, x, y, w, h);
      const from = (sy * w + sx) * 4;
      data.set(image.data.subarray(from, from + 4), (y * outWidth + x) * 4);
    }
  }
  return { width: outWidth, height: outHeight, data };
}

function sourcePixel(
  orientation: ExifOrientation,
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number] {
  switch (orientation) {
    case 2:
      return [w - 1 - x, y];
    case 3:
      return [w - 1 - x, h - 1 - y];
    case 4:
      return [x, h - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [y, h - 1 - x];
    case 7:
      return [w - 1 - y, h - 1 - x];
    case 8:
      return [w - 1 - y, x];
    default:
      return [x, y];
  }
}
