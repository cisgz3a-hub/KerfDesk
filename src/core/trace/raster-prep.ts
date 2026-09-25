// Image-level preprocessing operator levers implemented for parity with
// LaserForge 1's src/core/image/ImageProcessing.ts math. Four pure
// functions over RawImageData:
//
//   - adjustBrightness  (delta −100..+100, 0 = no-op)
//   - adjustContrast    (delta −100..+100, 0 = no-op)
//   - adjustGamma       (gamma 0.1..5, 1 = no-op; clamp-protected)
//   - invertImage       (255 − v per channel; see below for composited input)
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
//
// A decoder image tagged rgbCompositedOnWhite stores c = 255 - a(255 - s)
// for straight colour s and coverage a, so transparency has already become
// paper-white. Invert then has two honest readings, and which one the user
// means depends on the artwork, decided once per image:
//
//   - Dark (or mixed) artwork: the negative of the image as displayed on
//     white, 255 - c, returned OPAQUE. It is byte-identical to inverting the
//     same art on an opaque white background, so a dark logo on a transparent
//     PNG traces the same negative (frame with the logo as a hole) in every
//     lane, including the ones that read fully transparent pixels as paper.
//   - Light artwork: that negative would be a solid slab (a white logo on
//     transparency is invisible on white and its negative is all ink). The
//     artwork itself is inverted instead and composited over the same white:
//     255 - a*s, which in terms of the stored byte is 255(2 - a) - c. The
//     transparent surround stays paper and the logo becomes the ink.
//
// "Light" means the coverage-weighted mean straight luma exceeds mid-grey:
// sum(a*s)/sum(a) = 255 - 255*sum(255 - c)/sum(alpha) > 127.5, i.e.
// 2*sum(255 - c) < sum(alpha) over luma bytes. An image with no artwork at
// all counts as light, so it stays blank. Opaque pixels get 255 - c in both
// readings, so an opaque image is unaffected by the choice. Because the
// choice is per image, inverting twice need not restore the input.
export function invertImage(image: RawImageData): RawImageData {
  if (image.rgbCompositedOnWhite !== true || !hasPartialCoverage(image)) {
    return mapRgb(image, (v) => 255 - v);
  }
  return compositedArtworkIsLight(image)
    ? invertArtworkOverPaper(image)
    : invertAsDisplayedOnWhite(image);
}

function hasPartialCoverage(image: RawImageData): boolean {
  for (let i = 3; i < image.data.length; i += 4) {
    if ((image.data[i] ?? 255) < 255) return true;
  }
  return false;
}

function compositedArtworkIsLight(image: RawImageData): boolean {
  let darkness = 0;
  let coverage = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const luma =
      0.299 * (image.data[i] ?? 255) +
      0.587 * (image.data[i + 1] ?? 255) +
      0.114 * (image.data[i + 2] ?? 255);
    darkness += 255 - luma;
    coverage += image.data[i + 3] ?? 255;
  }
  return 2 * darkness <= coverage;
}

function invertAsDisplayedOnWhite(image: RawImageData): RawImageData {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    out[i] = 255 - (image.data[i] ?? 0);
    out[i + 1] = 255 - (image.data[i + 1] ?? 0);
    out[i + 2] = 255 - (image.data[i + 2] ?? 0);
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

function invertArtworkOverPaper(image: RawImageData): RawImageData {
  const out = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] ?? 255;
    const paper = 510 - alpha;
    out[i] = clampByte(paper - (image.data[i] ?? 0));
    out[i + 1] = clampByte(paper - (image.data[i + 1] ?? 0));
    out[i + 2] = clampByte(paper - (image.data[i + 2] ?? 0));
    out[i + 3] = alpha;
  }
  return { width: image.width, height: image.height, data: out, rgbCompositedOnWhite: true };
}
