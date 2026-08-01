import {
  RGBA_CHANNELS,
  type PaintColor,
  type PixelRect,
  type RgbaBuffer,
} from '../../core/image-edit';
import { fillMaskedInPlace, maskBounds, type SelectionMask } from '../../core/image-select';

const OPAQUE_WHITE: PaintColor = { r: 255, g: 255, b: 255 };
const MAX_BYTE = 255;
const ALPHA_CHANNEL = 3;
const EMPTY_RECT: PixelRect = { x: 0, y: 0, width: 0, height: 0 };

/** Stable identity for the editor's opaque-white base layer. */
export const BACKGROUND_LAYER_ID = 'background';

/**
 * Clear transformed source pixels according to the active layer contract:
 * Background becomes opaque white; every upper layer becomes transparent.
 */
export function clearEditorLayerInPlace(
  buffer: RgbaBuffer,
  activeLayerId: string,
  mask: SelectionMask,
): PixelRect {
  return activeLayerId === BACKGROUND_LAYER_ID
    ? fillMaskedInPlace(buffer, mask, OPAQUE_WHITE)
    : clearToTransparentInPlace(buffer, mask);
}

function clearToTransparentInPlace(buffer: RgbaBuffer, mask: SelectionMask): PixelRect {
  const bounds = maskBounds(mask);
  if (bounds === null) return EMPTY_RECT;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const maskAlpha = (mask.alpha[y * mask.width + x] ?? 0) / MAX_BYTE;
      if (maskAlpha === 0) continue;
      const alphaIndex = (y * buffer.width + x) * RGBA_CHANNELS + ALPHA_CHANNEL;
      const currentAlpha = buffer.data[alphaIndex] ?? 0;
      buffer.data[alphaIndex] = Math.round(currentAlpha * (1 - maskAlpha));
    }
  }
  return bounds;
}
