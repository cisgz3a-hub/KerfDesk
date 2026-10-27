// The image a headless trace (ADR-477) hands the tracer, prepared the way the
// app's own import prepares it: decoded on the stored grid, turned by a
// JPEG's or PNG's EXIF Orientation (as the browser decode does), RGB composited onto
// white with alpha kept (compositeRgbOverWhitePreservingAlpha), and sized in
// millimetres from the density the Multi-File Trace reads (image-density),
// the TIFF header's own resolution, or an explicit --dpi.

import type { RawImageData } from '../../core/trace';
import { decodeRaster, sniffRasterFormat } from '../../io/raster-decode/decode-raster';
import {
  densityFromBytes,
  IMAGE_DENSITY_PROBE_BYTES,
  type ImageDensity,
} from '../common/image-density';
import { rasterImportGeometry, type RasterImportGeometry } from '../common/image-import';
import {
  orientationSourcePixel,
  pngExifOrientation,
} from '../../io/raster-decode/exif-orientation';
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
  const oriented = orientRaster(decoded, rasterOrientation(bytes));
  const image = compositeRgbOverWhitePreservingAlpha(oriented);
  const embedded =
    headerDensity(bytes) ??
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

// The header prefix Multi-File Trace reads (readImageHeaderDensity), with its
// "unreadable means no density" rule, so a density block beyond the prefix
// sizes the image the same way on both paths.
function headerDensity(bytes: Uint8Array): ImageDensity | null {
  try {
    return densityFromBytes(bytes.subarray(0, IMAGE_DENSITY_PROBE_BYTES));
  } catch {
    return null;
  }
}

// The Orientation the browser applies: a JPEG's Exif APP1 or a PNG's eXIf.
function rasterOrientation(bytes: Uint8Array): ExifOrientation {
  const format = sniffRasterFormat(bytes);
  if (format === 'jpeg') return jpegExifOrientation(bytes);
  return format === 'png' ? (pngExifOrientation(bytes) ?? 1) : 1;
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
      const [sx, sy] = orientationSourcePixel(orientation, x, y, w, h);
      const from = (sy * w + sx) * 4;
      data.set(image.data.subarray(from, from + 4), (y * outWidth + x) * 4);
    }
  }
  return { width: outWidth, height: outHeight, data };
}
