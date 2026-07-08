// Local-contrast ink mask: a pixel is ink when it is darker than its own
// neighbourhood, not darker than a global cut-off.
//
// Adaptive (local-mean) thresholding is a textbook binarization technique
// (Bradley/Roth 2007; Sauvola/Wellner): subtracting the local box-mean
// turns a global threshold into a LOCAL contrast test, so faint-but-real
// strokes (grey letters on white, luma well above 128) are detected on any
// background level. A pure highpass reads ~0 deep inside large solid
// regions, which would hollow them out — so the mask is the UNION of the
// local test and the plain global threshold: the global pass keeps solid
// interiors filled, the local pass adds the faint detail the global
// threshold drops.
//
// Chosen over Canny-loop filling for the Edge Detection rebuild (ADR-115):
// filling enclosed edge loops needs the loops closed, and closing them
// morphologically consumes small interior holes (letter counters) — the
// exact detail the edge preset exists to keep. The local-contrast test has
// no morphology, so a 3px counter survives untouched.

import type { RawImageData } from './trace-image';

/** A bilevel raster: `data[i]` is 1 for foreground ink, 0 for background.
 *  The neutral bitmap shape the contour finisher consumes as an InkMask;
 *  defined here (its producer) after potrace's own bitmap module was
 *  removed (ADR-123). */
export type TraceBitmap = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

// The 8-bit luma midpoint — the same global cut-off Line Art's own mask
// uses, so the union's backbone agrees with the filled-contour lane's
// notion of ink.
const GLOBAL_INK_LUMA = 128;
const OPAQUE_PAPER_LUMA = 255;

export type LocalContrastMaskOptions = {
  /** Neighbourhood half-width of the local mean (box blur radius), px. */
  readonly radiusPx: number;
  /** How much darker than the local mean a pixel must be to count as ink. */
  readonly delta: number;
};

/** Build a bilevel ink bitmap: local-contrast test ∪ global threshold. */
export function localContrastInkBitmap(
  image: RawImageData,
  options: LocalContrastMaskOptions,
): TraceBitmap {
  const { width, height } = image;
  const luma = lumaPlane(image);
  const mean = boxBlur(luma, width, height, Math.max(1, Math.round(options.radiusPx)));
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i += 1) {
    const l = luma[i] as number;
    if (l < (mean[i] as number) - options.delta || l < GLOBAL_INK_LUMA) ink[i] = 1;
  }
  return { width, height, data: ink };
}

// Fully transparent pixels read as paper so alpha-backed art keeps its shape.
function lumaPlane(image: RawImageData): Float32Array {
  const { data } = image;
  const luma = new Float32Array(image.width * image.height);
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    luma[i] =
      (data[o + 3] ?? OPAQUE_PAPER_LUMA) === 0
        ? OPAQUE_PAPER_LUMA
        : 0.299 * (data[o] ?? OPAQUE_PAPER_LUMA) +
          0.587 * (data[o + 1] ?? OPAQUE_PAPER_LUMA) +
          0.114 * (data[o + 2] ?? OPAQUE_PAPER_LUMA);
  }
  return luma;
}

// Separable box blur with edge-clamped sampling, O(n) per axis via running
// sums. A box mean (not Gaussian) is the exact local-mean the adaptive
// threshold wants and keeps the mask reproducible in float math
// (deterministic across runs).
function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const window = 2 * radius + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += src[y * width + clampIndex(x, width)] as number;
    }
    for (let x = 0; x < width; x += 1) {
      tmp[y * width + x] = sum / window;
      sum -= src[y * width + clampIndex(x - radius, width)] as number;
      sum += src[y * width + clampIndex(x + radius + 1, width)] as number;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += tmp[clampIndex(y, height) * width + x] as number;
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum -= tmp[clampIndex(y - radius, height) * width + x] as number;
      sum += tmp[clampIndex(y + radius + 1, height) * width + x] as number;
    }
  }
  return out;
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value;
}
