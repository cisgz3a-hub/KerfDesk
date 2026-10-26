// Spot heal (ADR-246, V2 plan B2): the patent-safe masked-median variant —
// the blemish disc is replaced by the per-channel MEDIAN of an annulus ring
// sampled outside it, blended through a soft tip so the repair feathers
// into the surround. PatchMatch-style synthesis stays deliberately out
// (Adobe patent territory); this is the honest despeckle-grade heal.
//
// Layers carry straight alpha, and a transparent pixel's RGB means nothing
// (Clean up white paper leaves paper as 0,0,0 at low alpha). So the colour
// median is weighted by alpha, the repair carries the ring's median alpha,
// and the disc blends toward it premultiplied: a transparent surround heals
// to transparency, never to an opaque black disc (audit 23-P2-1).

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';

const MAX_BYTE = 255;
const COLOUR_CHANNELS = 3;
// The sampling ring sits just outside the blemish.
const RING_INNER_FACTOR = 1.2;
const RING_OUTER_FACTOR = 1.8;
const RING_ANGLES = 32;
const RING_RADII = 3;
// Fully solid repair out to this fraction of the radius, then cosine ramp.
const SOLID_FRACTION = 0.6;

/** Straight-alpha repair pixel: colour 0..255 per channel, alpha 0..255. */
export type HealRepair = {
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
};

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

/**
 * The repair a dab at `centre` would paint, sampled from `source`'s ring:
 * the alpha-weighted median colour and the median alpha. Null when the whole
 * ring falls outside the document.
 */
export function healRepairFrom(
  source: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radiusPx: number,
): HealRepair | null {
  const { colours, alphas } = sampleRing(source, centre, Math.max(1, radiusPx));
  if (alphas.length === 0) return null;
  const [r = 0, g = 0, b = 0] = colours.map((channel) => weightedMedian(channel, alphas));
  return { rgb: [r, g, b], alpha: weightedMedian(alphas, null) };
}

// Ring samples that land inside the document, per colour channel and alpha.
function sampleRing(
  source: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radius: number,
): { readonly colours: readonly number[][]; readonly alphas: readonly number[] } {
  const colours: number[][] = [[], [], []];
  const alphas: number[] = [];
  for (let ring = 0; ring < RING_RADII; ring += 1) {
    const r =
      radius *
      (RING_INNER_FACTOR + ((RING_OUTER_FACTOR - RING_INNER_FACTOR) * ring) / (RING_RADII - 1));
    for (let a = 0; a < RING_ANGLES; a += 1) {
      const angle = (2 * Math.PI * a) / RING_ANGLES;
      const sx = Math.round(centre.x + r * Math.cos(angle));
      const sy = Math.round(centre.y + r * Math.sin(angle));
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const base = (sy * source.width + sx) * RGBA_CHANNELS;
      for (let c = 0; c < COLOUR_CHANNELS; c += 1) colours[c]?.push(source.data[base + c] ?? 0);
      alphas.push(source.data[base + COLOUR_CHANNELS] ?? 0);
    }
  }
  return { colours, alphas };
}

/** Heal one dab: the disc blends toward the ring's repair through a soft tip. */
export function healSpotInPlace(
  doc: RgbaBuffer,
  centre: { readonly x: number; readonly y: number },
  radiusPx: number,
  clip?: SelectionMask,
  repair: HealRepair | null = healRepairFrom(doc, centre, radiusPx),
): void {
  if (repair === null) return;
  const radius = Math.max(1, radiusPx);
  const x0 = Math.max(0, Math.floor(centre.x - radius));
  const y0 = Math.max(0, Math.floor(centre.y - radius));
  const x1 = Math.min(doc.width - 1, Math.ceil(centre.x + radius));
  const y1 = Math.min(doc.height - 1, Math.ceil(centre.y + radius));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const strength = healCoverage(x, y, centre, radius) * clipAlpha(clip, doc, x, y);
      if (strength <= 0) continue;
      blendTowardRepair(doc.data, (y * doc.width + x) * RGBA_CHANNELS, repair, strength);
    }
  }
}

// Premultiplied interpolation: alpha moves toward the repair's alpha (up or
// down), and colour is weighted by coverage. Opaque pixels and an opaque
// repair reduce to the plain straight-RGB blend.
function blendTowardRepair(
  data: Uint8ClampedArray,
  base: number,
  repair: HealRepair,
  strength: number,
): void {
  const alpha = (data[base + COLOUR_CHANNELS] ?? 0) / MAX_BYTE;
  const repairAlpha = repair.alpha / MAX_BYTE;
  const outAlpha = alpha + (repairAlpha - alpha) * strength;
  for (let c = 0; c < COLOUR_CHANNELS; c += 1) {
    const premultiplied = (data[base + c] ?? 0) * alpha;
    const target = (repair.rgb[c] ?? 0) * repairAlpha;
    const blended = premultiplied + (target - premultiplied) * strength;
    data[base + c] = outAlpha > 0 ? Math.round(blended / outAlpha) : 0;
  }
  data[base + COLOUR_CHANNELS] = Math.round(outAlpha * MAX_BYTE);
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

// Lower weighted median: the first sorted value whose cumulative weight
// reaches half the total. Null weights count every sample once, which is the
// plain lower median. A ring with no weight at all (fully transparent) has no
// colour, so it reports 0.
function weightedMedian(values: readonly number[], weights: readonly number[] | null): number {
  const order = values.map((_, index) => index).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
  const weightOf = (index: number): number => (weights === null ? 1 : (weights[index] ?? 0));
  const total = order.reduce((sum, index) => sum + weightOf(index), 0);
  if (total <= 0) return 0;
  let cumulative = 0;
  for (const index of order) {
    cumulative += weightOf(index);
    if (cumulative * 2 >= total) return values[index] ?? 0;
  }
  return values[order[order.length - 1] ?? 0] ?? 0;
}
