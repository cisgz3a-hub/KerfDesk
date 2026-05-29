// Raster preview data — Phase F.2.c. Converts a per-pixel S-value
// schedule (the dither output) into a grayscale RGBA buffer that
// simulates the engrave result LightBurn shows in its preview:
// darker pixel = more laser power = deeper burn, white = unburned
// material (LIGHTBURN-STUDY.md §1.4, "shade according to power").
//
// This is the inverse of the dither convention: dither emits high S
// for dark (full-burn) pixels; here high S renders as a dark gray so
// the preview reads like a finished burn rather than a power map.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM. The UI
// (draw-raster-preview.ts) wraps the returned buffer in an ImageData
// and blits it onto the canvas at the image's placement.

const MAX_CHANNEL = 255;
const CHANNELS_PER_PIXEL = 4;

// Map a power-scaled S-value buffer (row-major, length width*height,
// each in [0, sMax]) to an opaque grayscale RGBA buffer (length
// width*height*4). sMax 0 (layer power 0) means nothing burns, so the
// whole image renders white. Out-of-range S is tolerated by the
// Uint8ClampedArray clamp, so a malformed buffer degrades to black/
// white rather than throwing.
// Return type is the non-shared `<ArrayBuffer>` form (not the default
// `<ArrayBufferLike>`) so the result drops straight into `new ImageData(...)`,
// which rejects a possibly-shared buffer. `new Uint8ClampedArray(n)` is
// always backed by a plain ArrayBuffer, so this is accurate, not a cast.
export function rasterPreviewRgba(
  sValues: Uint16Array,
  sMax: number,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * CHANNELS_PER_PIXEL);
  for (let i = 0; i < pixelCount; i += 1) {
    const s = sValues[i] ?? 0;
    const gray = sMax > 0 ? MAX_CHANNEL - Math.round((MAX_CHANNEL * s) / sMax) : MAX_CHANNEL;
    const offset = i * CHANNELS_PER_PIXEL;
    rgba[offset] = gray;
    rgba[offset + 1] = gray;
    rgba[offset + 2] = gray;
    rgba[offset + 3] = MAX_CHANNEL;
  }
  return rgba;
}
