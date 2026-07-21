// High Pass (ADR-242, PP-E): keep only detail above the blur scale, centred
// on mid-grey — with Threshold after it, the standard way to pull clean
// line-art out of unevenly-lit photos before tracing.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { blurredRect, writeMasked } from './gaussian-blur';
import { clampRectToDoc } from './lut';

const RGB_CHANNELS = 3;
const MID_GRAY = 128;

export function highPassInPlace(
  doc: RgbaBuffer,
  sigma: number,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const target = clampRectToDoc(doc, rect);
  if (target.width <= 0 || target.height <= 0 || sigma <= 0) return;
  const blurred = blurredRect(doc, sigma, target);
  const values = new Float32Array(blurred.length);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const srcBase = ((target.y + y) * doc.width + (target.x + x)) * RGBA_CHANNELS;
      const outBase = (y * target.width + x) * RGB_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        values[outBase + c] = (doc.data[srcBase + c] ?? 0) - (blurred[outBase + c] ?? 0) + MID_GRAY;
      }
    }
  }
  writeMasked(doc, target, values, mask);
}
