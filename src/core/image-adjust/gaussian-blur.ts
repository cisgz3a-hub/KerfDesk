// Separable Gaussian blur for the Image Studio filters (ADR-242, PP-E).
//
// Photoshop's filter-on-selection rule: the kernel READS surrounding pixels
// outside the selection (and clamps at document edges), but WRITES only
// selected pixels, alpha-weighted. The blur itself runs over the target rect
// expanded by the kernel radius so rect-edge pixels see true neighbours.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, MAX_BYTE } from './lut';

const RGB_CHANNELS = 3;
// Beyond three sigmas the Gaussian tail is visually zero.
const KERNEL_SIGMAS = 3;
export const MAX_BLUR_SIGMA = 100;

/** Blur RGB inside the rect (null = whole doc), writing only masked pixels. */
export function gaussianBlurInPlace(
  doc: RgbaBuffer,
  sigma: number,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const target = clampRectToDoc(doc, rect);
  if (target.width <= 0 || target.height <= 0 || sigma <= 0) return;
  const blurred = blurredRect(doc, Math.min(MAX_BLUR_SIGMA, sigma), target);
  writeMasked(doc, target, blurred, mask);
}

/**
 * Blurred RGB floats for the rect, row-major, length rect.w * rect.h * 3.
 * Shared by Unsharp Mask and High Pass, which combine rather than replace.
 */
export function blurredRect(doc: RgbaBuffer, sigma: number, rect: PixelRect): Float32Array {
  const kernel = buildKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  // Horizontal pass covers extra rows above/below so the vertical pass has
  // true (not clamped) neighbours for every target pixel.
  const top = Math.max(0, rect.y - radius);
  const bottom = Math.min(doc.height, rect.y + rect.height + radius);
  const horizontal = horizontalPass(doc, kernel, rect, top, bottom);
  return verticalPass(horizontal, kernel, rect, top, bottom - top);
}

function buildKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * KERNEL_SIGMAS));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}

// Horizontal convolution over rows [top, bottom), columns of the rect only,
// sampling the full document width with edge clamping.
function horizontalPass(
  doc: RgbaBuffer,
  kernel: Float32Array,
  rect: PixelRect,
  top: number,
  bottom: number,
): Float32Array {
  const radius = (kernel.length - 1) / 2;
  const out = new Float32Array(rect.width * (bottom - top) * RGB_CHANNELS);
  for (let y = top; y < bottom; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const outBase = ((y - top) * rect.width + (x - rect.x)) * RGB_CHANNELS;
      for (let k = -radius; k <= radius; k += 1) {
        const sx = Math.min(doc.width - 1, Math.max(0, x + k));
        const w = kernel[k + radius] ?? 0;
        const srcBase = (y * doc.width + sx) * RGBA_CHANNELS;
        for (let c = 0; c < RGB_CHANNELS; c += 1) {
          out[outBase + c] = (out[outBase + c] ?? 0) + (doc.data[srcBase + c] ?? 0) * w;
        }
      }
    }
  }
  return out;
}

// Vertical convolution of the horizontal-pass buffer down to the rect rows,
// clamping row samples to the buffer (which itself clamps at document edges).
function verticalPass(
  horizontal: Float32Array,
  kernel: Float32Array,
  rect: PixelRect,
  top: number,
  rows: number,
): Float32Array {
  const radius = (kernel.length - 1) / 2;
  const out = new Float32Array(rect.width * rect.height * RGB_CHANNELS);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const outBase = (y * rect.width + x) * RGB_CHANNELS;
      for (let k = -radius; k <= radius; k += 1) {
        const sy = Math.min(rows - 1, Math.max(0, rect.y + y + k - top));
        const w = kernel[k + radius] ?? 0;
        const srcBase = (sy * rect.width + x) * RGB_CHANNELS;
        for (let c = 0; c < RGB_CHANNELS; c += 1) {
          out[outBase + c] = (out[outBase + c] ?? 0) + (horizontal[srcBase + c] ?? 0) * w;
        }
      }
    }
  }
  return out;
}

/** Alpha-weighted write of rect-shaped RGB floats into the document. */
export function writeMasked(
  doc: RgbaBuffer,
  rect: PixelRect,
  values: Float32Array,
  mask: SelectionMask | null,
): void {
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const idx = (rect.y + y) * doc.width + (rect.x + x);
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const srcBase = (y * rect.width + x) * RGB_CHANNELS;
      const dstBase = idx * RGBA_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        const source = doc.data[dstBase + c] ?? 0;
        const mapped = Math.round(values[srcBase + c] ?? 0);
        doc.data[dstBase + c] =
          alpha === MAX_BYTE ? mapped : source + Math.round(((mapped - source) * alpha) / MAX_BYTE);
      }
    }
  }
}
