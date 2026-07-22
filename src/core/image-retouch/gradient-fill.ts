// Gradient fill (ADR-246, V2 plan B1): foreground→background ramp along a
// dragged axis (linear) or out from the drag origin (radial), written
// opaque, selection-clamped with the established feathered alpha-lerp.

import { RGBA_CHANNELS, type PaintColor, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';

const MAX_BYTE = 255;

export type GradientSpec = {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly shape: 'linear' | 'radial';
};

/**
 * Fill the whole document (mask permitting) with the fg→bg gradient. A
 * degenerate zero-length drag paints solid foreground.
 */
export function fillGradientInPlace(
  doc: RgbaBuffer,
  spec: GradientSpec,
  foreground: PaintColor,
  background: PaintColor,
  mask?: SelectionMask,
): void {
  const dx = spec.to.x - spec.from.x;
  const dy = spec.to.y - spec.from.y;
  const lengthSq = dx * dx + dy * dy;
  for (let y = 0; y < doc.height; y += 1) {
    for (let x = 0; x < doc.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === undefined ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const t = gradientT(spec, x, y, dx, dy, lengthSq);
      writeBlended(doc, idx * RGBA_CHANNELS, foreground, background, t, alpha);
    }
  }
}

function gradientT(
  spec: GradientSpec,
  x: number,
  y: number,
  dx: number,
  dy: number,
  lengthSq: number,
): number {
  if (lengthSq === 0) return 0;
  const px = x + 0.5 - spec.from.x;
  const py = y + 0.5 - spec.from.y;
  const raw =
    spec.shape === 'linear'
      ? (px * dx + py * dy) / lengthSq
      : Math.sqrt(px * px + py * py) / Math.sqrt(lengthSq);
  return Math.max(0, Math.min(1, raw));
}

function writeBlended(
  doc: RgbaBuffer,
  base: number,
  fg: PaintColor,
  bg: PaintColor,
  t: number,
  alpha: number,
): void {
  const channels = [fg.r + (bg.r - fg.r) * t, fg.g + (bg.g - fg.g) * t, fg.b + (bg.b - fg.b) * t];
  for (let c = 0; c < channels.length; c += 1) {
    const mapped = Math.round(channels[c] ?? 0);
    const source = doc.data[base + c] ?? 0;
    doc.data[base + c] =
      alpha === MAX_BYTE ? mapped : source + Math.round(((mapped - source) * alpha) / MAX_BYTE);
  }
  // Gradients paint opaque ink; a feathered mask still softens via the lerp.
  const srcAlpha = doc.data[base + 3] ?? 0;
  doc.data[base + 3] = Math.max(srcAlpha, alpha);
}
