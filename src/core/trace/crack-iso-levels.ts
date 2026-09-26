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
//    needs only the two LOCAL plateaus, not the kernel (a global pair of
//    levels misplaces an edge against grey paper by up to +0.09 px). The automatic (Otsu) cut
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
// Half-size (SOURCE px) of the uniform block a broad edge needs on each
// side of its crack; anything thinner keeps the cut's own crossing.
const BROAD_RADIUS_SOURCE_PX = 1;
// A cut this close to the plateau mid-level (fraction of the local step)
// keeps its own crossing; see crossingLevel.
const PLATEAU_DEADBAND = 0.02;

/** Row-major 8-bit plane: the scalar the mask was cut from. */
export type ScalarPlane = {
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
};

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
 *  thresholded mask (1 = ink) the field describes. Each broad crack crosses
 *  at the mid-level of the two LOCAL plateaus (the extreme value of a uniform block
 *  just past it on each side), so an edge against grey paper and one against
 *  white paper both land at 50% coverage. */
export function withPlateauCrossing(
  field: CrackSubPixelField,
  plane: ScalarPlane,
  ink: Uint8Array,
  cut: number,
  pixelScale: number,
): CrackSubPixelField {
  const mask: MaskPlane = { width: plane.width, height: plane.height, ink };
  const radius = Math.max(1, Math.round(BROAD_RADIUS_SOURCE_PX * Math.max(1, pixelScale)));
  return {
    ...field,
    crackCrossingAt: (inkX, inkY, bgX, bgY) => {
      const dx = inkX - bgX;
      const dy = inkY - bgY;
      const reach = radius + 1;
      const inkLevel = plateauLevel(
        plane,
        mask,
        inkX + dx * reach,
        inkY + dy * reach,
        radius,
        true,
      );
      const paperLevel =
        inkLevel === null
          ? null
          : plateauLevel(plane, mask, bgX - dx * reach, bgY - dy * reach, radius, false);
      return isoCrossing(
        sample(plane, inkX, inkY),
        sample(plane, bgX, bgY),
        cut,
        crossingLevel(cut, inkLevel, paperLevel),
      );
    },
  };
}

// Thin ink or a narrow paper gap never reaches its plateau, and moving such
// an edge past the mask's crack can fold the loop onto itself at a saddle:
// those cracks keep the crossing of the cut itself. So does a cut that
// already sits at the mid-level to within PLATEAU_DEADBAND of the step: the
// move would be under ~0.02 px, and the finishing fits react to such a
// uniform nudge by re-choosing vertices (a -0.003 IoU swing on a clean
// r = 40 ring, ADR-453) rather than by moving the edge.
function crossingLevel(cut: number, inkLevel: number | null, paperLevel: number | null): number {
  if (inkLevel === null || paperLevel === null || !(paperLevel > inkLevel)) return cut;
  const mid = (inkLevel + paperLevel) / 2;
  return Math.abs(mid - cut) <= PLATEAU_DEADBAND * (paperLevel - inkLevel) ? cut : mid;
}

// Plateau level of the (2r+1)^2 block centred on (cx, cy) when every pixel of
// it has mask class `ink` (outside the image is paper), else null. The block
// sits just past the crack's own pixel (whose row may hold staircase steps)
// and reaches 2r + 2 pixels along the normal, so a stroke or gap narrower
// than that in ANY direction fails it (a diagonal hairline too). The level
// is the block's extreme (darkest ink, lightest paper): the ramp of this or
// an opposite edge reaching into the block only pulls the other way (a block
// median widened a clean 8 px bar by 3.5% area, ADR-453).
function plateauLevel(
  plane: ScalarPlane,
  mask: MaskPlane,
  cx: number,
  cy: number,
  r: number,
  ink: boolean,
): number | null {
  let level = ink ? MAX_LUMA : 0;
  for (let y = cy - r; y <= cy + r; y += 1) {
    for (let x = cx - r; x <= cx + r; x += 1) {
      if (inkAt(mask, x, y) !== ink) return null;
      const value = sample(plane, x, y);
      level = ink ? Math.min(level, value) : Math.max(level, value);
    }
  }
  return level;
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
