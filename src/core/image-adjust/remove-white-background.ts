// Adapted from PhotoCraft's color_to_alpha.rs (MIT), commit
// 79261615956ab21334e49ca1d384390272e647da. Copyright (c) 2026 ArtCraft Team
// and the PhotoCraft contributors. See docs/licensing/photocraft-color-to-alpha.txt.
// Specialised to white RGBA8 artwork, with KerfDesk selection/rectangle support.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, MAX_BYTE } from './lut';

/** Remove paper white while preserving the partial coverage of antialiased ink. */
export function removeWhiteBackgroundInPlace(
  doc: RgbaBuffer,
  cleanupPercent: number,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const target = clampRectToDoc(doc, rect);
  const threshold = Number.isFinite(cleanupPercent)
    ? Math.min(0.95, Math.max(0, cleanupPercent / 100))
    : 0;
  for (let y = target.y; y < target.y + target.height; y += 1) {
    for (let x = target.x; x < target.x + target.width; x += 1) {
      const index = y * doc.width + x;
      const coverage = mask === null ? 1 : (mask.alpha[index] ?? 0) / MAX_BYTE;
      if (coverage > 0) unmixPixel(doc.data, index * RGBA_CHANNELS, threshold, coverage);
    }
  }
}

function unmixPixel(
  data: Uint8ClampedArray,
  base: number,
  threshold: number,
  coverage: number,
): void {
  const oldAlpha = data[base + 3] ?? 0;
  if (oldAlpha === 0) return;
  // The minimum opacity that can reproduce this pixel over a white background.
  const opacity =
    1 - Math.min(data[base] ?? 0, data[base + 1] ?? 0, data[base + 2] ?? 0) / MAX_BYTE;
  const factor = opacity <= threshold ? 0 : (opacity - threshold) / (1 - threshold);
  // Blend selection edges in premultiplied space: straight RGB interpolation
  // would create a grey fringe when the operation also changes transparency.
  const mixedFactor = 1 - coverage + coverage * factor;
  for (let channel = 0; channel < 3; channel += 1) {
    const original = data[base + channel] ?? 0;
    const unmixed =
      factor === 0 ? MAX_BYTE : Math.max(0, MAX_BYTE + (original - MAX_BYTE) / factor);
    data[base + channel] =
      mixedFactor === 0
        ? MAX_BYTE
        : (original * (1 - coverage) + unmixed * coverage * factor) / mixedFactor;
  }
  data[base + 3] = oldAlpha * mixedFactor;
}
