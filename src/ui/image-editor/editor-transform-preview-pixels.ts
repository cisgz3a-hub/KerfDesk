import { RGBA_CHANNELS } from '../../core/image-edit';

const MAX_BYTE = 255;
const ALPHA_CHANNEL = 3;

/**
 * Copy floating RGBA pixels and scale intrinsic alpha by selection alpha for
 * the live transform preview.
 */
export function transformPreviewPixels(
  pixels: Uint8ClampedArray,
  maskAlpha: Uint8Array,
): Uint8ClampedArray<ArrayBuffer> {
  const preview = new Uint8ClampedArray(pixels.length);
  preview.set(pixels);
  for (let index = 0; index < maskAlpha.length; index += 1) {
    const alphaIndex = index * RGBA_CHANNELS + ALPHA_CHANNEL;
    const pixelAlpha = preview[alphaIndex] ?? 0;
    preview[alphaIndex] = Math.round((pixelAlpha * (maskAlpha[index] ?? 0)) / MAX_BYTE);
  }
  return preview;
}
