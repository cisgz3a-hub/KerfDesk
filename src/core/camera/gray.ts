// Grayscale conversion for the checkerboard detector (ADR-107, v2.b). The
// detector and the sub-pixel refiner both work on a single-channel intensity
// image; camera frames arrive as RGBA bytes. Pure core: buffers in, buffers out.

import type { RgbaImage } from './cpu-rectify';
import type { GrayImage } from './corner-subpix';

// Rec. 601 luma weights — the standard perceptual gray for 8-bit video frames.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/** Convert an RGBA frame to single-channel luma intensity (0..255, Float32). */
export function toGrayImage(source: RgbaImage): GrayImage {
  const pixelCount = source.width * source.height;
  const data = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    data[i] =
      LUMA_R * (source.data[offset] ?? 0) +
      LUMA_G * (source.data[offset + 1] ?? 0) +
      LUMA_B * (source.data[offset + 2] ?? 0);
  }
  return { data, width: source.width, height: source.height };
}
