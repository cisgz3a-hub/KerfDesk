// Image-level preprocessing operator levers implemented for parity with
// LaserForge 1's src/core/image/ImageProcessing.ts math. Four pure
// functions over RawImageData:
//
//   - adjustBrightness  (delta −100..+100, 0 = no-op)
//   - adjustContrast    (delta −100..+100, 0 = no-op)
//   - adjustGamma       (gamma 0.1..5, 1 = no-op; clamp-protected)
//   - invertImage       (255 − v per channel)
//
// All four read RGBA input and return a new RawImageData. None mutate.
// Composable with our existing preprocess.ts chain:
//   brightness → contrast → gamma → invert → median → threshold/Otsu
//   → despeckle → tracer.
//
// All math is public-domain image processing. Algorithm references and
// constants match LF1 exactly so matching per-channel input values
// produce the same adjusted bytes.
//
// Pure-core compliant: no clock, no random, no I/O.

import type { RawImageData } from './trace-image';

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// Apply a per-channel byte transform to every RGB triplet, copying
// alpha through unchanged. Centralised so the four pixel-level ops
// share one loop shape — each just supplies the transform.
function mapRgb(image: RawImageData, transform: (v: number) => number): RawImageData {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i] = transform(image.data[i] ?? 0);
    out[i + 1] = transform(image.data[i + 1] ?? 0);
    out[i + 2] = transform(image.data[i + 2] ?? 0);
    out[i + 3] = image.data[i + 3] ?? 255;
  }
  return { width: image.width, height: image.height, data: out };
}

// brightness: −100..+100. Each channel becomes clamp(v + brightness * 2.55).
// LF1 used 2.55 (= 255/100) so +100 brightness saturates a black pixel
// to white. Linear addition — preserves contrast, just shifts the level.
export function adjustBrightness(image: RawImageData, brightness: number): RawImageData {
  if (brightness === 0) return image;
  const delta = brightness * 2.55;
  return mapRgb(image, (v) => clampByte(v + delta));
}

// contrast: −100..+100. Each channel becomes clamp(((v − 128) * factor) + 128)
// where factor = 1 + contrast / 100. +100 doubles contrast (factor 2.0);
// −100 collapses everything to mid-grey (factor 0). Centres on 128 so
// the operation pivots around the midpoint of the byte range.
export function adjustContrast(image: RawImageData, contrast: number): RawImageData {
  if (contrast === 0) return image;
  const factor = 1 + contrast / 100;
  return mapRgb(image, (v) => clampByte((v - 128) * factor + 128));
}

// gamma: 0.1..5 typical, 1 = no-op. Power curve in normalised space:
// out = (in / 255) ^ (1/gamma) * 255. gamma > 1 brightens midtones,
// gamma < 1 darkens. Clamped to [0.1, 5] so a 0 input doesn't divide-
// by-zero and extreme values don't produce useless output.
export function adjustGamma(image: RawImageData, gamma: number): RawImageData {
  const g = Math.max(0.1, Math.min(5, gamma));
  if (g === 1) return image;
  const invG = 1 / g;
  return mapRgb(image, (v) => {
    const norm = Math.max(0, Math.min(1, v / 255));
    return clampByte(Math.pow(norm, invG) * 255);
  });
}

// Invert each colour channel; alpha untouched. Useful when the source
// is a white-on-black logo / dark-mode screenshot and the user wants
// it to engrave as black-on-white (the convention every laser tool
// assumes).
export function invertImage(image: RawImageData): RawImageData {
  return mapRgb(image, (v) => 255 - v);
}
