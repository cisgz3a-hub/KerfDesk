// Alpha-channel scan for a decoded raster. Lives in its own module (extracted
// from use-trace-preview) so the hook can cache the verdict per decoded image:
// the scan touches every pixel — ~4M px at the preview decode cap — which is
// far too expensive to repeat synchronously on every trace-options change.

import type { RawImageData } from '../../core/trace';

const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const OPAQUE_ALPHA = 255;

/** True when any pixel in the RGBA buffer is not fully opaque. */
export function rawImageHasTransparency(image: RawImageData): boolean {
  for (let i = ALPHA_CHANNEL_OFFSET; i < image.data.length; i += RGBA_CHANNELS) {
    if ((image.data[i] ?? OPAQUE_ALPHA) < OPAQUE_ALPHA) return true;
  }
  return false;
}
