// LUT builders for the basic tone adjustments (ADR-242, parity plan PP-E):
// brightness/contrast, invert, posterize, threshold, and grayscale.

import { LUT_SIZE, MAX_BYTE } from './lut';

const MID_GRAY = 128;
const BRIGHTNESS_RANGE = 100;
const CONTRAST_RANGE = 100;
const MIN_POSTERIZE_LEVELS = 2;

/**
 * Photoshop-legacy brightness/contrast, both -100..100. Brightness offsets
 * every value (±100 ≈ ±128 bytes); contrast pivots the slope about mid-grey
 * via tan, so -100 flattens to grey and +100 approaches a hard step.
 */
export function brightnessContrastLut(brightness: number, contrast: number): Uint8Array {
  const offset = (clampSigned(brightness) / BRIGHTNESS_RANGE) * MID_GRAY;
  const angle = ((clampSigned(contrast) + CONTRAST_RANGE) / (2 * CONTRAST_RANGE)) * (Math.PI / 2);
  // Cap the slope so contrast +100 is a usable hard step, not Infinity.
  const slope = Math.min(LUT_SIZE, Math.tan(angle));
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    lut[i] = clampByte(Math.round((i - MID_GRAY) * slope + MID_GRAY + offset));
  }
  return lut;
}

/** Ctrl+I: photographic negative per channel. */
export function invertLut(): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = MAX_BYTE - i;
  return lut;
}

/** Quantize to `levels` evenly-spaced tones (Photoshop Posterize, 2..255). */
export function posterizeLut(levels: number): Uint8Array {
  const n = Math.max(MIN_POSTERIZE_LEVELS, Math.min(MAX_BYTE, Math.floor(levels)));
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    lut[i] = clampByte(Math.round((Math.floor((i * n) / LUT_SIZE) * MAX_BYTE) / (n - 1)));
  }
  return lut;
}

/**
 * Hard black/white split at `level` (0..255) — applied via the luma path so
 * the result is pure line-art the tracer and engraver read unambiguously.
 */
export function thresholdLut(level: number): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = i >= level ? MAX_BYTE : 0;
  return lut;
}

/** Identity luma map — with the luma apply path this is Desaturate. */
export function grayscaleLut(): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = i;
  return lut;
}

function clampSigned(value: number): number {
  return Math.max(-BRIGHTNESS_RANGE, Math.min(BRIGHTNESS_RANGE, value));
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(MAX_BYTE, value));
}
