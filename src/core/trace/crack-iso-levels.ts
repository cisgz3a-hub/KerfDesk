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
// 2. Thin features keep the cut. Where the ink or the paper side of a crack
//    holds no uniform 3x3-source-px block (a hairline, a narrow counter), the
//    samples never reach a plateau and pushing the edge past the mask's own
//    crack can fold a loop onto itself at a saddle, so those cracks keep the
//    crossing of the cut exactly as before. (A per-component ribbon level
//    that sets traced width to integrated darkness was measured and dropped
//    for now; ADR-453 records why.)
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
// Half-size (SOURCE px) of the uniform block a broad edge needs on each
// side of its crack; anything thinner keeps the cut's own crossing.
const BROAD_RADIUS_SOURCE_PX = 1;

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
  const paper = quantile(
    histogram,
    Math.ceil(cut),
    paperCount * PAPER_LEVEL_QUANTILE,
    MAX_LUMA + 1,
  );
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

/** Adds the plateau crossing to the automatic-cut field. `ink` is the
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
  const mask: MaskPlane = { width: plane.width, height: plane.height, ink };
  const radius = Math.max(1, Math.round(BROAD_RADIUS_SOURCE_PX * Math.max(1, pixelScale)));
  return {
    ...field,
    crackCrossingAt: (inkX, inkY, bgX, bgY) => {
      // Thin ink or a narrow paper gap never reaches its plateau, and moving
      // such an edge past the mask's crack can fold the loop onto itself at
      // a saddle: those cracks keep the crossing of the cut itself.
      const dx = inkX - bgX;
      const dy = inkY - bgY;
      const broad =
        uniformBlock(mask, inkX + dx * (radius + 1), inkY + dy * (radius + 1), radius, true) &&
        uniformBlock(mask, bgX - dx * (radius + 1), bgY - dy * (radius + 1), radius, false);
      return isoCrossing(
        sample(plane, inkX, inkY),
        sample(plane, bgX, bgY),
        cut,
        broad ? mid : cut,
      );
    },
  };
}

// Every pixel of the (2r+1)² block centred on (cx, cy) has class `ink`
// (outside the image is paper). The block sits just past the crack's own
// pixel (whose row may hold staircase steps) and reaches 2r + 2 pixels along
// the normal, so a stroke or gap narrower than that in ANY direction fails
// it — a diagonal hairline too.
function uniformBlock(mask: MaskPlane, cx: number, cy: number, r: number, ink: boolean): boolean {
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) if (inkAt(mask, x, y) !== ink) return false;
  }
  return true;
}

function sample(plane: ScalarPlane, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= plane.width || y >= plane.height) return MAX_LUMA;
  return plane.values[y * plane.width + x] ?? MAX_LUMA;
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
