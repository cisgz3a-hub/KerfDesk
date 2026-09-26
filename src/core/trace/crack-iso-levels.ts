// Edge-placement levels for the sub-pixel crack crossing (ADR-453, ADR-456).
//
// The binary mask decides WHAT exists; these levels only decide WHERE each
// crack's edge sits between its two pixel centres. They reach the walker
// through CrackSubPixelField.crackCrossingAt, which saddle decisions and the
// cleanup stages never read, so topology is exactly the mask's.
//
// 1. Plateau mid-level (automatic cut). An anti-aliased or symmetrically
//    blurred step between ink level I and paper level P has value (I+P)/2
//    exactly where the edge is (50% coverage): a symmetric kernel of any
//    width integrates equal halves of each side there. So the crossing level
//    needs only the two plateaus, not the kernel. The automatic (Otsu) cut
//    splits the histogram wherever the class variances balance, which on
//    real art is usually darker than the mid-level: crossings then land
//    inside the ink (measured -0.12 px mean radius on an anti-aliased disc).
// 2. Ribbon level. A stroke narrower than ~2 source px never reaches its
//    plateau, so any fixed level misreads its width. For such a component
//    the level is solved so the traced area equals the component's
//    integrated darkness (paper − luma)/(paper − ink) summed over its pixels
//    and their paper neighbours: traced width = integrated darkness.
// 3. Brightness band (Cutoff > 0) and the alpha route. Ink is a band
//    lo ≤ v ≤ hi, so each crack takes the band edge its paper sample lies
//    beyond: v > hi crosses at hi, v < lo crosses at lo with the polarity
//    reversed. A crack whose ink sample is outside the band (a cleanup flip)
//    keeps the plain midpoint.
//
// Our own design from the coverage model; no third-party tracer code.

import type { CrackSubPixelField } from './contour-boundary';
import { SATURATED_BG_LUMA, SATURATED_INK_LUMA } from './saddle-connectivity';

const T_MIN = 0.1;
const T_MAX = 0.9;
const MID = 0.5;
const MAX_LUMA = 255;
// Plateau estimates: robust quantiles of each Otsu class, so the partial
// (anti-aliased) pixels that sit in a class do not drag its level.
const INK_LEVEL_QUANTILE = 0.25;
const PAPER_LEVEL_QUANTILE = 0.75;
// Mean width 2·area/perimeter below this (SOURCE px) makes a ribbon.
const RIBBON_WIDTH_SOURCE_PX = 2;
const RIBBON_BISECTION_STEPS = 24;

/** Row-major 8-bit plane: the scalar the mask was cut from. */
export type ScalarPlane = {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
};

export type PlateauLevels = { readonly ink: number; readonly paper: number };

/** Ink and paper plateaus of a plane cut at `cut` (ink below the cut), or
 *  null when either class is empty. */
export function plateauLevels(values: Uint8Array, cut: number): PlateauLevels | null {
  const histogram = new Float64Array(MAX_LUMA + 1);
  for (const value of values) histogram[value] = (histogram[value] ?? 0) + 1;
  let inkCount = 0;
  let paperCount = 0;
  for (let v = 0; v <= MAX_LUMA; v += 1) {
    if (v < cut) inkCount += histogram[v] ?? 0;
    else paperCount += histogram[v] ?? 0;
  }
  if (inkCount === 0 || paperCount === 0) return null;
  const ink = quantile(histogram, 0, inkCount * INK_LEVEL_QUANTILE, cut);
  const paper = quantile(histogram, Math.ceil(cut), paperCount * PAPER_LEVEL_QUANTILE, MAX_LUMA + 1);
  return paper > ink ? { ink, paper } : null;
}

function quantile(histogram: Float64Array, from: number, rank: number, to: number): number {
  let seen = 0;
  const start = Math.max(0, from);
  for (let v = start; v < to && v <= MAX_LUMA; v += 1) {
    seen += histogram[v] ?? 0;
    if (seen > rank) return v;
  }
  return Math.min(MAX_LUMA, Math.max(start, Math.ceil(to) - 1));
}

/** Crossing t (0 = paper centre, 1 = ink centre) of a crack against `iso`,
 *  for a mask cut where ink is `value ≤ cut < paper value`. Mirrors the
 *  walker's own gates: saturated steps and cracks the cut does not straddle
 *  keep the midpoint. */
export function isoCrossing(inkValue: number, bgValue: number, cut: number, iso: number): number {
  if (bgValue >= SATURATED_BG_LUMA && inkValue <= SATURATED_INK_LUMA) return MID;
  if (!(bgValue > cut && inkValue <= cut)) return MID;
  return clampT((bgValue - iso) / (bgValue - inkValue));
}

function clampT(t: number): number {
  return Math.min(T_MAX, Math.max(T_MIN, t));
}

type MaskPlane = { readonly width: number; readonly height: number; readonly ink: Uint8Array };

/** Adds the plateau/ribbon crossing to the automatic-cut field. `ink` is the
 *  thresholded mask (1 = ink) the field describes. Returns `field` itself
 *  when the plane has no two plateaus. */
export function withPlateauCrossing(
  field: CrackSubPixelField,
  plane: ScalarPlane,
  ink: Uint8Array,
  cut: number,
  pixelScale: number,
): CrackSubPixelField {
  const levels = plateauLevels(plane.values, cut);
  if (levels === null) return field;
  const mid = (levels.ink + levels.paper) / 2;
  const ribbons = createRibbonLevels(plane, { width: plane.width, height: plane.height, ink }, {
    cut,
    levels,
    maxWidth: RIBBON_WIDTH_SOURCE_PX * Math.max(1, pixelScale),
  });
  const valueAt = (x: number, y: number): number => sample(plane, x, y);
  return {
    ...field,
    crackCrossingAt: (inkX, inkY, bgX, bgY) => {
      const ribbon = ribbons(inkX, inkY);
      return isoCrossing(valueAt(inkX, inkY), valueAt(bgX, bgY), cut, ribbon ?? mid);
    },
  };
}

function sample(plane: ScalarPlane, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= plane.width || y >= plane.height) return MAX_LUMA;
  return plane.values[y * plane.width + x] ?? MAX_LUMA;
}

type RibbonSettings = {
  readonly cut: number;
  readonly levels: PlateauLevels;
  readonly maxWidth: number;
};

// Lazily labels the 8-connected ink component under a crack's ink pixel and
// caches its ribbon level (null = broad shape, which keeps the mid-level).
function createRibbonLevels(
  plane: ScalarPlane,
  mask: MaskPlane,
  settings: RibbonSettings,
): (x: number, y: number) => number | null {
  const labels = new Int32Array(mask.width * mask.height);
  const levelOf: Array<number | null> = [null];
  return (x, y) => {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return null;
    const p = y * mask.width + x;
    if (mask.ink[p] !== 1) return null;
    const known = labels[p] ?? 0;
    if (known !== 0) return levelOf[known] ?? null;
    const label = levelOf.length;
    const pixels = floodComponent(mask, labels, p, label);
    levelOf.push(ribbonLevel(plane, mask, pixels, settings));
    return levelOf[label] ?? null;
  };
}

function floodComponent(mask: MaskPlane, labels: Int32Array, seed: number, label: number): number[] {
  const { width, height } = mask;
  const pixels: number[] = [seed];
  labels[seed] = label;
  for (let head = 0; head < pixels.length; head += 1) {
    const p = pixels[head] as number;
    const px = p % width;
    const py = (p - px) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (mask.ink[q] !== 1 || labels[q] !== 0) continue;
        labels[q] = label;
        pixels.push(q);
      }
    }
  }
  return pixels;
}

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

type Crack = { readonly ink: number; readonly bg: number };

function ribbonLevel(
  plane: ScalarPlane,
  mask: MaskPlane,
  pixels: ReadonlyArray<number>,
  settings: RibbonSettings,
): number | null {
  const cracks = componentCracks(plane, mask, pixels);
  if (cracks.length === 0 || (2 * pixels.length) / cracks.length >= settings.maxWidth) return null;
  const darkness = integratedDarkness(plane, mask, pixels, settings.levels);
  const tracedArea = (iso: number): number => {
    let area = pixels.length;
    for (const crack of cracks) area += MID - isoCrossing(crack.ink, crack.bg, settings.cut, iso);
    return area;
  };
  let low = settings.levels.ink;
  let high = settings.levels.paper;
  if (tracedArea(low) >= darkness) return low;
  if (tracedArea(high) <= darkness) return high;
  for (let step = 0; step < RIBBON_BISECTION_STEPS; step += 1) {
    const iso = (low + high) / 2;
    if (tracedArea(iso) < darkness) low = iso;
    else high = iso;
  }
  return (low + high) / 2;
}

function componentCracks(
  plane: ScalarPlane,
  mask: MaskPlane,
  pixels: ReadonlyArray<number>,
): Crack[] {
  const cracks: Crack[] = [];
  for (const p of pixels) {
    const x = p % mask.width;
    const y = (p - x) / mask.width;
    for (const [dx, dy] of SIDES) {
      if (inkAt(mask, x + dx, y + dy)) continue;
      cracks.push({ ink: sample(plane, x, y), bg: sample(plane, x + dx, y + dy) });
    }
  }
  return cracks;
}

// Darkness of the component's pixels plus every paper pixel touching it
// (8-neighbourhood, each counted once): the ink the ribbon really holds.
function integratedDarkness(
  plane: ScalarPlane,
  mask: MaskPlane,
  pixels: ReadonlyArray<number>,
  levels: PlateauLevels,
): number {
  const counted = new Set<number>();
  let total = 0;
  const span = levels.paper - levels.ink;
  const add = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
    const q = y * mask.width + x;
    if (counted.has(q)) return;
    counted.add(q);
    const value = plane.values[q] ?? MAX_LUMA;
    total += Math.min(1, Math.max(0, (levels.paper - value) / span));
  };
  for (const p of pixels) {
    const x = p % mask.width;
    const y = (p - x) / mask.width;
    add(x, y);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!inkAt(mask, x + dx, y + dy)) add(x + dx, y + dy);
      }
    }
  }
  return total;
}

function inkAt(mask: MaskPlane, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.ink[y * mask.width + x] === 1;
}

/** Brightness-band crossing (ink is lo ≤ value ≤ hi): the paper sample picks
 *  the band edge it lies beyond. Cracks whose ink sample is outside the band
 *  (cleanup flips) keep the midpoint. */
export function bandCrossing(inkValue: number, bgValue: number, lo: number, hi: number): number {
  if (inkValue < lo || inkValue > hi) return MID;
  if (bgValue > hi) {
    if (bgValue >= SATURATED_BG_LUMA && inkValue <= SATURATED_INK_LUMA) return MID;
    return clampT((bgValue - hi) / (bgValue - inkValue));
  }
  if (bgValue < lo) {
    if (bgValue <= SATURATED_INK_LUMA && inkValue >= SATURATED_BG_LUMA) return MID;
    return clampT((lo - bgValue) / (inkValue - bgValue));
  }
  return MID;
}

/** Field for a band cut of `plane` (the luma band or the alpha route's
 *  255 − alpha). No single level describes a band, so thresholdAt is NaN:
 *  the saddle decider then settles every corner on the mask alone, exactly
 *  as it did with no field; only the crack crossing reads the band. */
export function bandCrackField(plane: ScalarPlane, lo: number, hi: number): CrackSubPixelField {
  return {
    lumaAt: (x, y) => sample(plane, x, y),
    thresholdAt: () => Number.NaN,
    crackCrossingAt: (inkX, inkY, bgX, bgY) =>
      bandCrossing(sample(plane, inkX, inkY), sample(plane, bgX, bgY), lo, hi),
  };
}
