// Procedural ink painters for perceptual trace fixtures — draw known shapes
// into a luma buffer (0 = ink, 255 = paper) and convert to RawImageData.
// Pure, deterministic, test-only.

import type { Vec2 } from '../../core/scene';
import type { RawImageData } from '../../core/trace';

export type Luma = { readonly w: number; readonly h: number; readonly px: Float32Array };

export function paper(w: number, h: number): Luma {
  return { w, h, px: new Float32Array(w * h).fill(255) };
}

export function inkDisc(l: Luma, cx: number, cy: number, r: number, soft = 0): void {
  for (let y = 0; y < l.h; y += 1)
    for (let x = 0; x < l.w; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (soft <= 0) {
        if (d <= r) l.px[y * l.w + x] = 0;
      } else {
        const t = Math.max(0, Math.min(1, (r - d) / soft + 0.5));
        l.px[y * l.w + x] = Math.min(l.px[y * l.w + x] ?? 255, 255 * (1 - t));
      }
    }
}

export function inkRect(l: Luma, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y < Math.min(l.h, y1); y += 1)
    for (let x = Math.max(0, x0); x < Math.min(l.w, x1); x += 1) l.px[y * l.w + x] = 0;
}

export function paperRect(l: Luma, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.max(0, y0); y < Math.min(l.h, y1); y += 1)
    for (let x = Math.max(0, x0); x < Math.min(l.w, x1); x += 1) l.px[y * l.w + x] = 255;
}

/** Capsule (round-capped stroke) between a and b. */
export function inkStroke(l: Luma, a: Vec2, b: Vec2, radius: number): void {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
  const maxX = Math.min(l.w, Math.ceil(Math.max(a.x, b.x) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
  const maxY = Math.min(l.h, Math.ceil(Math.max(a.y, b.y) + radius + 1));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y < maxY; y += 1)
    for (let x = minX; x < maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / len2));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= radius) l.px[y * l.w + x] = 0;
    }
}

/** Paint a cell-grid glyph (pixel-art): rows of '#' cells become ink squares. */
export function inkCellGlyph(
  l: Luma,
  originX: number,
  originY: number,
  cellPx: number,
  rows: ReadonlyArray<string>,
): void {
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r] ?? '';
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] !== '#') continue;
      const x0 = originX + c * cellPx;
      const y0 = originY + r * cellPx;
      inkRect(l, x0, y0, x0 + cellPx, y0 + cellPx);
    }
  }
}

export function toRawImage(l: Luma): RawImageData {
  const data = new Uint8ClampedArray(l.w * l.h * 4);
  for (let i = 0; i < l.w * l.h; i += 1) {
    const v = l.px[i] ?? 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width: l.w, height: l.h, data };
}
