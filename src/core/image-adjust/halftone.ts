// Halftone screening (ADR-242, PP-E) — the classic engrave preparation:
// continuous tone becomes pure black/white dots (AM halftone) or lines
// (newsprint screen) that a laser burns cleanly at fixed power.
//
// Per-pixel spot screening: rotate into screen space, find the cell, and
// ink the pixel when it sits inside the spot whose area tracks the local
// ink density (1 - luma). Everything lands as pure 0/255, alpha-weighted
// into the selection like every other filter.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, lumaByte, MAX_BYTE } from './lut';

const RGB_CHANNELS = 3;
// Above half ink, circles can no longer add area without overlapping — the
// classic screen switches to white holes shrinking on the dual grid.
const HOLE_CROSSOVER_INK = 0.5;

export type HalftoneParams = {
  /** Screen cell size in pixels (grid pitch). */
  readonly spacingPx: number;
  /** Screen rotation in degrees (45 is the print classic). */
  readonly angleDeg: number;
  readonly shape: 'dot' | 'line';
};

export function halftoneScreenInPlace(
  doc: RgbaBuffer,
  params: HalftoneParams,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const r = clampRectToDoc(doc, rect);
  if (r.width <= 0 || r.height <= 0) return;
  const spacing = Math.max(2, params.spacingPx);
  const rad = (params.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Screening reads local luma from a snapshot so written dots never feed
  // back into neighbouring decisions.
  const source = new Uint8ClampedArray(doc.data);
  for (let y = r.y; y < r.y + r.height; y += 1) {
    for (let x = r.x; x < r.x + r.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const base = idx * RGBA_CHANNELS;
      const ink =
        1 - lumaByte(source[base] ?? 0, source[base + 1] ?? 0, source[base + 2] ?? 0) / MAX_BYTE;
      const black = isInked(x, y, { spacing, cos, sin, shape: params.shape }, ink);
      writeMono(doc, base, black, alpha);
    }
  }
}

type ScreenSpec = {
  readonly spacing: number;
  readonly cos: number;
  readonly sin: number;
  readonly shape: 'dot' | 'line';
};

// Spot function: inside-the-spot test in rotated screen space. Covered area
// is proportional to ink — dot area (or line thickness) tracks it exactly,
// which is what keeps mid-tones reading as mid-tones after the screen.
function isInked(x: number, y: number, screen: ScreenSpec, ink: number): boolean {
  const u = x * screen.cos + y * screen.sin;
  const v = -x * screen.sin + y * screen.cos;
  const s = screen.spacing;
  if (screen.shape === 'line') {
    const offset = Math.abs(fractionalCell(v, s));
    return offset < (ink * s) / 2;
  }
  if (ink <= HOLE_CROSSOVER_INK) {
    const du = fractionalCell(u, s);
    const dv = fractionalCell(v, s);
    return du * du + dv * dv < (ink * s * s) / Math.PI;
  }
  // Shadow half: white holes at the cell corners shrink toward solid black.
  const hu = fractionalCell(u + s / 2, s);
  const hv = fractionalCell(v + s / 2, s);
  return hu * hu + hv * hv >= ((1 - ink) * s * s) / Math.PI;
}

// Signed distance to the nearest cell centre along one screen axis.
function fractionalCell(value: number, spacing: number): number {
  return value - Math.round(value / spacing) * spacing;
}

function writeMono(doc: RgbaBuffer, base: number, black: boolean, alpha: number): void {
  const target = black ? 0 : MAX_BYTE;
  for (let c = 0; c < RGB_CHANNELS; c += 1) {
    const sourceValue = doc.data[base + c] ?? 0;
    doc.data[base + c] =
      alpha === MAX_BYTE
        ? target
        : sourceValue + Math.round(((target - sourceValue) * alpha) / MAX_BYTE);
  }
}
