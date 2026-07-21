// Unsharp Mask (ADR-242, PP-E) — the classic sharpen: push each pixel away
// from its Gaussian-blurred neighbourhood. Threshold skips low-contrast
// differences so flat areas (paper grain, dither noise) stay quiet — the
// setting that matters for photo engraves.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { blurredRect, writeMasked } from './gaussian-blur';
import { clampRectToDoc } from './lut';

const RGB_CHANNELS = 3;
const PERCENT = 100;

export type UnsharpParams = {
  /** Strength 1..500 (percent of the difference added back). */
  readonly amountPercent: number;
  /** Gaussian sigma in pixels ("radius" in the Photoshop dialog). */
  readonly sigma: number;
  /** Minimum channel difference (0..255) that gets sharpened. */
  readonly threshold: number;
};

export function unsharpMaskInPlace(
  doc: RgbaBuffer,
  params: UnsharpParams,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const target = clampRectToDoc(doc, rect);
  if (target.width <= 0 || target.height <= 0 || params.sigma <= 0) return;
  const blurred = blurredRect(doc, params.sigma, target);
  const values = new Float32Array(blurred.length);
  const amount = params.amountPercent / PERCENT;
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const srcBase = ((target.y + y) * doc.width + (target.x + x)) * RGBA_CHANNELS;
      const outBase = (y * target.width + x) * RGB_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        const source = doc.data[srcBase + c] ?? 0;
        const diff = source - (blurred[outBase + c] ?? 0);
        values[outBase + c] = Math.abs(diff) < params.threshold ? source : source + amount * diff;
      }
    }
  }
  writeMasked(doc, target, values, mask);
}
