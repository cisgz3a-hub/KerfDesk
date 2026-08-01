// Clone stamp (ADR-246, V2 plan B2): stamp pixels from a frozen source
// snapshot at a fixed offset through a soft brush tip — the aligned
// Photoshop clone. The snapshot is the composite at stroke start, so the
// stroke never feeds back into its own source.

import { RGBA_CHANNELS, type PaintPoint, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';

const MAX_BYTE = 255;
// Stamp spacing along the stroke, as a fraction of the brush diameter.
const SPACING_FRACTION = 0.25;

export type CloneStroke = {
  readonly points: readonly PaintPoint[];
  readonly diameterPx: number;
  /** 0..1 soft-tip hardness (1 = hard disc). */
  readonly hardness: number;
  /** 0..1 stamp strength. */
  readonly opacity: number;
};

/** Bounding rect of the stroke inflated by the brush radius (for capture). */
export function cloneStrokeDirtyRect(stroke: CloneStroke, doc: RgbaBuffer): PixelRect {
  const radius = stroke.diameterPx / 2 + 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x - radius);
    minY = Math.min(minY, point.y - radius);
    maxX = Math.max(maxX, point.x + radius);
    maxY = Math.max(maxY, point.y + radius);
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return {
    x,
    y,
    width: Math.max(0, Math.min(doc.width, Math.ceil(maxX)) - x),
    height: Math.max(0, Math.min(doc.height, Math.ceil(maxY)) - y),
  };
}

/**
 * Paint the stroke by copying `source` pixels displaced by `offset` (doc
 * point + offset = source point). Selection-clamped when a clip is given.
 */
export function cloneStrokeInPlace(
  doc: RgbaBuffer,
  source: RgbaBuffer,
  offset: { readonly x: number; readonly y: number },
  stroke: CloneStroke,
  clip?: SelectionMask,
): void {
  for (const centre of dabCentres(stroke)) {
    stampCloneDab(doc, source, offset, stroke, centre, clip);
  }
}

// Quarter-diameter spacing along the polyline (single points dab once).
function dabCentres(stroke: CloneStroke): readonly PaintPoint[] {
  const spacing = Math.max(1, stroke.diameterPx * SPACING_FRACTION);
  const centres: PaintPoint[] = [];
  let carried = 0;
  let previous: PaintPoint | null = null;
  for (const point of stroke.points) {
    if (previous === null) {
      centres.push(point);
      previous = point;
      continue;
    }
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.hypot(dx, dy);
    let travelled = spacing - carried;
    while (travelled <= length) {
      const t = travelled / length;
      centres.push({ x: previous.x + dx * t, y: previous.y + dy * t });
      travelled += spacing;
    }
    carried = length - (travelled - spacing);
    previous = point;
  }
  return centres;
}

function stampCloneDab(
  doc: RgbaBuffer,
  source: RgbaBuffer,
  offset: { readonly x: number; readonly y: number },
  stroke: CloneStroke,
  centre: PaintPoint,
  clip?: SelectionMask,
): void {
  const radius = stroke.diameterPx / 2;
  const x0 = Math.max(0, Math.floor(centre.x - radius));
  const y0 = Math.max(0, Math.floor(centre.y - radius));
  const x1 = Math.min(doc.width - 1, Math.ceil(centre.x + radius));
  const y1 = Math.min(doc.height - 1, Math.ceil(centre.y + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const coverage = tipCoverage(x, y, centre, radius, stroke.hardness) * stroke.opacity;
      if (coverage <= 0) continue;
      const idx = y * doc.width + x;
      const clipAlpha = clip === undefined ? 1 : (clip.alpha[idx] ?? 0) / MAX_BYTE;
      const strength = coverage * clipAlpha;
      if (strength <= 0) continue;
      copyClonePixel(doc, source, offset, x, y, strength);
    }
  }
}

// Soft-tip falloff: solid to hardness·radius, cosine ramp to the edge.
function tipCoverage(
  x: number,
  y: number,
  centre: PaintPoint,
  radius: number,
  hardness: number,
): number {
  const distance = Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y);
  if (distance >= radius) return 0;
  const solid = radius * Math.min(1, Math.max(0, hardness));
  if (distance <= solid) return 1;
  const t = (distance - solid) / Math.max(radius - solid, 1e-6);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

function copyClonePixel(
  doc: RgbaBuffer,
  source: RgbaBuffer,
  offset: { readonly x: number; readonly y: number },
  x: number,
  y: number,
  strength: number,
): void {
  const sx = Math.round(x + offset.x);
  const sy = Math.round(y + offset.y);
  if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) return;
  const dst = (y * doc.width + x) * RGBA_CHANNELS;
  const src = (sy * source.width + sx) * RGBA_CHANNELS;
  for (let c = 0; c < 3; c += 1) {
    const d = doc.data[dst + c] ?? 0;
    const s = source.data[src + c] ?? 0;
    doc.data[dst + c] = Math.round(d + (s - d) * strength);
  }
  const dstAlpha = doc.data[dst + 3] ?? 0;
  const srcAlpha = source.data[src + 3] ?? 0;
  doc.data[dst + 3] = Math.max(dstAlpha, Math.round(srcAlpha * strength));
}
