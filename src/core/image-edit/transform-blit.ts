// Free-transform compositing (ADR-242 PP-D, Top-20 item 11): resample a
// floating RGBA region through an affine (translate/scale/rotate about the
// region centre) into the working document. Inverse mapping with bilinear
// sampling and alpha-weighted blending, so commits are smooth and
// deterministic. The live preview draws the same affine through Canvas2D;
// this function is the byte-authoritative commit.

import { RGBA_CHANNELS, type RgbaBuffer } from './rgba-buffer';
import type { PixelRect } from './tiles';

export type FloatingPixels = {
  readonly rect: PixelRect;
  /** RGBA8 crop of rect, row-major. */
  readonly pixels: Uint8ClampedArray;
  /** Mask alpha crop of rect, row-major. */
  readonly alpha: Uint8Array;
};

/** Translate + scale + rotate, all about the floating rect's centre. */
export type AffineTransform = {
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotateDeg: number;
};

export const IDENTITY_AFFINE: AffineTransform = {
  translateX: 0,
  translateY: 0,
  scaleX: 1,
  scaleY: 1,
  rotateDeg: 0,
};

/** Document-space AABB the transformed region can touch (history capture). */
export function transformedBounds(floating: FloatingPixels, affine: AffineTransform): PixelRect {
  const cx = floating.rect.x + floating.rect.width / 2 + affine.translateX;
  const cy = floating.rect.y + floating.rect.height / 2 + affine.translateY;
  const hw = (floating.rect.width / 2) * Math.abs(affine.scaleX);
  const hh = (floating.rect.height / 2) * Math.abs(affine.scaleY);
  const rad = (affine.rotateDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rx = hw * cos + hh * sin;
  const ry = hw * sin + hh * cos;
  return {
    x: Math.floor(cx - rx) - 1,
    y: Math.floor(cy - ry) - 1,
    width: Math.ceil(rx * 2) + 2,
    height: Math.ceil(ry * 2) + 2,
  };
}

/**
 * Composite the floating region through the affine (mutates the buffer in
 * place). Returns the document-clamped touched rect — capture history for
 * `transformedBounds` BEFORE white-filling the source and calling this.
 */
export function blitTransformedInPlace(
  buffer: RgbaBuffer,
  floating: FloatingPixels,
  affine: AffineTransform,
): PixelRect {
  const bounds = transformedBounds(floating, affine);
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(buffer.width, bounds.x + bounds.width);
  const bottom = Math.min(buffer.height, bounds.y + bounds.height);
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 0, height: 0 };

  const cx = floating.rect.x + floating.rect.width / 2 + affine.translateX;
  const cy = floating.rect.y + floating.rect.height / 2 + affine.translateY;
  const rad = (-affine.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const invSx = 1 / (affine.scaleX === 0 ? 1e-6 : affine.scaleX);
  const invSy = 1 / (affine.scaleY === 0 ? 1e-6 : affine.scaleY);
  const halfW = floating.rect.width / 2;
  const halfH = floating.rect.height / 2;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      // Inverse-map the destination pixel centre into floating-local space.
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const rx = (dx * cos - dy * sin) * invSx + halfW;
      const ry = (dx * sin + dy * cos) * invSy + halfH;
      const sampled = sampleBilinear(floating, rx - 0.5, ry - 0.5);
      if (sampled === null || sampled.a === 0) continue;
      const base = (y * buffer.width + x) * RGBA_CHANNELS;
      const alpha = sampled.a / 255;
      blend(buffer, base, sampled.r, alpha);
      blend(buffer, base + 1, sampled.g, alpha);
      blend(buffer, base + 2, sampled.b, alpha);
      buffer.data[base + 3] = 255;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function blend(buffer: RgbaBuffer, index: number, target: number, alpha: number): void {
  const current = buffer.data[index] ?? 0;
  buffer.data[index] = Math.round(target * alpha + current * (1 - alpha));
}

type Sample = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

// Bilinear sample of the floating pixels weighted by the mask alpha; null
// outside the region entirely.
function sampleBilinear(floating: FloatingPixels, fx: number, fy: number): Sample | null {
  const { width, height } = floating.rect;
  if (fx <= -1 || fy <= -1 || fx >= width || fy >= height) return null;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const acc = { r: 0, g: 0, b: 0, a: 0 };
  const addTap = (ox: number, oy: number, w: number): void => {
    if (ox < 0 || oy < 0 || ox >= width || oy >= height || w === 0) return;
    const idx = oy * width + ox;
    const pa = ((floating.alpha[idx] ?? 0) / 255) * w;
    const base = idx * RGBA_CHANNELS;
    acc.r += (floating.pixels[base] ?? 0) * pa;
    acc.g += (floating.pixels[base + 1] ?? 0) * pa;
    acc.b += (floating.pixels[base + 2] ?? 0) * pa;
    acc.a += pa;
  };
  addTap(x0, y0, (1 - tx) * (1 - ty));
  addTap(x0 + 1, y0, tx * (1 - ty));
  addTap(x0, y0 + 1, (1 - tx) * ty);
  addTap(x0 + 1, y0 + 1, tx * ty);
  if (acc.a === 0) return null;
  return { r: acc.r / acc.a, g: acc.g / acc.a, b: acc.b / acc.a, a: Math.round(acc.a * 255) };
}
