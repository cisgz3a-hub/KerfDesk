import type { RasterImage, SceneObject } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import { createImageMaskPixelTest } from '../../core/raster/image-mask';
import { clipTraceResultToMask } from './trace-mask-result';
import type { TraceResult } from './use-trace-worker-client';

type SourceMask = { readonly image: RasterImage; readonly maskObject?: SceneObject };
const masks = new WeakMap<File, SourceMask>();

/** A fresh trace-only File owns this immutable mask context, never the stored bitmap. */
export function bindTraceSourceMask(
  file: File,
  image: RasterImage,
  maskObject: SceneObject | undefined,
): File {
  if (image.imageClip !== undefined || image.imageMaskId !== undefined)
    masks.set(file, { image, ...(maskObject === undefined ? {} : { maskObject }) });
  return file;
}

export function traceSourceHasMask(file: File): boolean {
  return masks.has(file);
}

export function traceSourceMaskMatches(
  file: File,
  image: RasterImage,
  maskObject?: SceneObject,
): boolean {
  const source = masks.get(file);
  return source === undefined
    ? image.imageClip === undefined && image.imageMaskId === undefined
    : source.image === image && source.maskObject === maskObject;
}

export function maskTraceSourceResult(file: File, result: TraceResult): TraceResult {
  const source = masks.get(file);
  return source === undefined
    ? result
    : clipTraceResultToMask(result, source.image, source.maskObject);
}

/** Use the engraving compiler's pixel-centre/even-odd test on each decoded grid. */
export function maskTraceSourcePixels(file: File, pixels: RawImageData): RawImageData {
  const source = masks.get(file);
  return source === undefined
    ? pixels
    : applyTraceSourceMask(pixels, source.image, source.maskObject);
}

export function applyTraceSourceMask(
  pixels: RawImageData,
  image: RasterImage,
  maskObject?: SceneObject,
): RawImageData {
  const contains = createImageMaskPixelTest(image, maskObject, pixels.width, pixels.height);
  if (contains === null) return pixels;
  const data = new Uint8ClampedArray(pixels.data);
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      if (contains(x, y)) continue;
      const offset = (y * pixels.width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = 0;
    }
  }
  return { ...pixels, data };
}

/** The comparison image uses the same masked decode as preview geometry. */
export function maskedTracePreviewDataUrl(file: File, pixels: RawImageData): string | undefined {
  if (!traceSourceHasMask(file)) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (context === null) return undefined;
  const decoded = context.createImageData(pixels.width, pixels.height);
  decoded.data.set(pixels.data);
  context.putImageData(decoded, 0, 0);
  return canvas.toDataURL('image/png');
}
