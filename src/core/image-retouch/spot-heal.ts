// Spot heal (ADR-246, V2 plan B2): the patent-safe masked-median variant —
// the blemish disc is replaced by the per-channel MEDIAN of an annulus ring
// sampled outside it, blended through a soft tip so the repair feathers
// into the surround. PatchMatch-style synthesis stays deliberately out
// (Adobe patent territory); this is the honest despeckle-grade heal.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';

const MAX_BYTE = 255;
// The sampling ring sits just outside the blemish.
const RING_INNER_FACTOR = 1.2;
const RING_OUTER_FACTOR = 1.8;
const RING_ANGLES = 32;
const RING_RADII = 3;
// Fully solid repair out to this fraction of the radius, then cosine ramp.
const SOLID_FRACTION = 0.6;

/** Dirty rect of one heal dab (for history capture). */
export function healDirtyRect(
  doc: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radiusPx: number,
): PixelRect {
  const x = Math.max(0, Math.floor(centre.x - radiusPx - 1));
  const y = Math.max(0, Math.floor(centre.y - radiusPx - 1));
  return {
    x,
    y,
    width: Math.max(0, Math.min(doc.width, Math.ceil(centre.x + radiusPx + 1)) - x),
    height: Math.max(0, Math.min(doc.height, Math.ceil(centre.y + radiusPx + 1)) - y),
  };
}

/** Heal one dab: annulus median replaces the disc through a soft tip. */
export function healSpotInPlace(
  doc: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radiusPx: number,
  clip?: SelectionMask,
): void {
  const radius = Math.max(1, radiusPx);
  const repair = annulusMedian(doc, centre, radius);
  if (repair === null) return;
  const x0 = Math.max(0, Math.floor(centre.x - radius));
  const y0 = Math.max(0, Math.floor(centre.y - radius));
  const x1 = Math.min(doc.width - 1, Math.ceil(centre.x + radius));
  const y1 = Math.min(doc.height - 1, Math.ceil(centre.y + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const strength = healCoverage(x, y, centre, radius) * clipAlpha(clip, doc, x, y);
      if (strength <= 0) continue;
      const base = (y * doc.width + x) * RGBA_CHANNELS;
      for (let c = 0; c < 3; c += 1) {
        const d = doc.data[base + c] ?? 0;
        doc.data[base + c] = Math.round(d + ((repair[c] ?? 0) - d) * strength);
      }
      doc.data[base + 3] = Math.max(doc.data[base + 3] ?? 0, Math.round(MAX_BYTE * strength));
    }
  }
}

function clipAlpha(clip: SelectionMask | undefined, doc: RgbaBuffer, x: number, y: number): number {
  if (clip === undefined) return 1;
  return (clip.alpha[y * doc.width + x] ?? 0) / MAX_BYTE;
}

function healCoverage(
  x: number,
  y: number,
  centre: { readonly x: number; readonly y: number },
  radius: number,
): number {
  const distance = Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y);
  if (distance >= radius) return 0;
  const solid = radius * SOLID_FRACTION;
  if (distance <= solid) return 1;
  const t = (distance - solid) / Math.max(radius - solid, 1e-6);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

// Per-channel median over ring samples that land inside the document.
function annulusMedian(
  doc: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radius: number,
): readonly number[] | null {
  const samples: number[][] = [[], [], []];
  for (let ring = 0; ring < RING_RADII; ring += 1) {
    const r =
      radius *
      (RING_INNER_FACTOR + ((RING_OUTER_FACTOR - RING_INNER_FACTOR) * ring) / (RING_RADII - 1));
    for (let a = 0; a < RING_ANGLES; a += 1) {
      const angle = (2 * Math.PI * a) / RING_ANGLES;
      const sx = Math.round(centre.x + r * Math.cos(angle));
      const sy = Math.round(centre.y + r * Math.sin(angle));
      if (sx < 0 || sy < 0 || sx >= doc.width || sy >= doc.height) continue;
      const base = (sy * doc.width + sx) * RGBA_CHANNELS;
      for (let c = 0; c < 3; c += 1) samples[c]?.push(doc.data[base + c] ?? 0);
    }
  }
  const first = samples[0];
  if (first === undefined || first.length === 0) return null;
  return samples.map((channel) => {
    const sorted = [...channel].sort((a, b) => a - b);
    return sorted[(sorted.length - 1) >> 1] ?? 0;
  });
}
