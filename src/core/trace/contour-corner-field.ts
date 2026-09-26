// Field evidence for a measured corner apex (corner dial, ADR-404).
//
// A measured crack chain is the iso-line of the pre-threshold field, and an
// anti-aliased source is (close to) a box-filtered picture of the drawn shape.
// If two straight legs really meet at an apex, the field round that apex must
// look like the box-filtered wedge they bound: each source pixel's luma sits
// between the paper and ink levels by the fraction of its box the wedge covers.
// A rounded or organic shape whose legs merely extrapolate to a meeting point
// leaves paper where the wedge predicts partial ink, and a neighbouring
// outline puts ink where the wedge predicts paper; either breaks the match.

import type { Vec2 } from '../scene';
import type { CrackSubPixelField } from './saddle-connectivity';

export type WedgeLine = {
  /** A point on the line. */
  readonly cx: number;
  readonly cy: number;
  /** Unit direction of travel; ink lies on its right. */
  readonly dx: number;
  readonly dy: number;
};

// Paper and ink levels are read this far (source px) off each leg's centroid:
// past a pixel box's half-diagonal, so the read pixel is wholly on one side.
const LEVEL_OFFSET_PX = 1.25;
// On a supersampled field each enlarged pixel is a bilinear blend of the
// source pixels round it (auto-upscale.ts upscaleBy), which reaches up to one
// more source pixel across the edge; the levels are read that much further off.
const LEVEL_INTERPOLATION_REACH_PX = 1;
// Below this paper-to-ink contrast (luma) the coverage estimate is noise.
const MIN_CONTRAST_LUMA = 48;
// Each leg's drawn edge is found from the coverage integral of the field
// profile this far (source px) either side of the leg, across it...
const EDGE_PROFILE_PX = 2;
const EDGE_PROFILE_STEP_PX = 0.25;
// ...clear by this much (a pixel box's half-diagonal) of the other leg's edge.
const EDGE_PROFILE_CLEARANCE_PX = 0.75;
// A leg further than this from the edge its profile implies is not the
// iso-line of a straight edge; it is compared where it lies.
const MAX_EDGE_SHIFT_PX = 0.5;
// Field pixels whose centres lie within this box (source px) round the apex
// are compared.
const WINDOW_PX = 2;
// Supersampling of each pixel box for the wedge's coverage.
const COVERAGE_SAMPLES = 8;
// Largest coverage disagreement at any compared pixel, and the mean one (the
// bake-off's anti-aliased wedges, stars and rectangles: at most 0.17 and 0.032).
const MAX_COVERAGE_ERROR = 0.2;
const MEAN_COVERAGE_ERROR = 0.05;

export type WedgeFieldFit = { readonly max: number; readonly mean: number };

/**
 * How well the box-filtered wedge with apex `apex` between the incoming leg
 * `back` and the outgoing leg `ahead` predicts the field, as the largest and
 * mean coverage error over the field pixels round the apex; null when the
 * field cannot say (too little contrast, or levels that contradict the legs).
 *
 * `apex` and the legs are in field pixels; `scale` field pixels span one
 * source pixel. At scale 1 each field pixel is compared with the wedge's
 * coverage of its box. A supersampled field is the pixel-centre bilinear
 * enlargement of the source (auto-upscale.ts upscaleBy), so each field pixel
 * is compared with the same bilinear blend of the SOURCE pixels' coverages.
 */
export function wedgeFieldFit(
  field: CrackSubPixelField,
  apex: Vec2,
  back: WedgeLine,
  ahead: WedgeLine,
  scale: number,
): WedgeFieldFit | null {
  const luma = (x: number, y: number): number => field.lumaAt(Math.floor(x), Math.floor(y));
  const offset = (LEVEL_OFFSET_PX + (scale > 1 ? LEVEL_INTERPOLATION_REACH_PX : 0)) * scale;
  let paper = 0;
  let ink = 0;
  for (const leg of [back, ahead]) {
    // Right of travel (-dy, dx) is ink.
    ink += luma(leg.cx - leg.dy * offset, leg.cy + leg.dx * offset);
    paper += luma(leg.cx + leg.dy * offset, leg.cy - leg.dx * offset);
  }
  paper /= 2;
  ink /= 2;
  const contrast = paper - ink;
  if (!(contrast >= MIN_CONTRAST_LUMA)) return null;
  // The iso-line runs parallel to the drawn edge but off it whenever the
  // threshold is not midway between paper and ink (Otsu on Sharp and Smooth
  // put it at 97 of 255 on an anti-aliased rectangle, ~0.12 px inside the
  // ink). The wedge is compared where the field puts the edges; the apex the
  // dial draws stays the legs' own meeting point.
  const edge = drawnEdgeApex(field, apex, back, ahead, scale, paper, contrast);
  const coverage = sourceCoverage(edge, back, ahead, scale);
  const ax = edge.x / scale;
  const ay = edge.y / scale;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (
    let oy = Math.ceil((ay - WINDOW_PX) * scale - 0.5);
    (oy + 0.5) / scale <= ay + WINDOW_PX;
    oy += 1
  ) {
    for (
      let ox = Math.ceil((ax - WINDOW_PX) * scale - 0.5);
      (ox + 0.5) / scale <= ax + WINDOW_PX;
      ox += 1
    ) {
      const model = bilinear(coverage, (ox + 0.5) / scale - 0.5, (oy + 0.5) / scale - 0.5);
      const seen = (paper - field.lumaAt(ox, oy)) / contrast;
      const error = Math.abs(Math.min(1, Math.max(0, seen)) - model);
      max = Math.max(max, error);
      sum += error;
      count += 1;
    }
  }
  return count === 0 ? null : { max, mean: sum / count };
}

// Where the legs meet once each is moved onto the drawn edge its field
// profile implies (field px). A leg whose profile would reach the other leg's
// edge borrows that leg's shift; with neither, the apex stays.
function drawnEdgeApex(
  field: CrackSubPixelField,
  apex: Vec2,
  back: WedgeLine,
  ahead: WedgeLine,
  scale: number,
  paper: number,
  contrast: number,
): Vec2 {
  const shiftBack = edgeShift(field, back, ahead, scale, paper, contrast);
  const shiftAhead = edgeShift(field, ahead, back, scale, paper, contrast);
  const eb = (Number.isNaN(shiftBack) ? shiftAhead : shiftBack) * scale;
  const ea = (Number.isNaN(shiftAhead) ? shiftBack : shiftAhead) * scale;
  const det = back.dx * ahead.dy - back.dy * ahead.dx;
  if (Number.isNaN(eb) || Math.abs(det) < 1e-6) return apex;
  // Solve n_back . v = eb and n_ahead . v = ea with n = (-dy, dx).
  const vx = (eb * ahead.dx - ea * back.dx) / det;
  const vy = (eb * ahead.dy - ea * back.dy) / det;
  return { x: apex.x + vx, y: apex.y + vy };
}

// How far (source px, towards the ink) the drawn edge lies from the leg: the
// profile across the leg covers R - e of its 2R length with ink when the edge
// is e past the leg, whatever the filter's ramp. NaN when the profile would
// reach the other leg's edge or the shift is too large to be an offset.
function edgeShift(
  field: CrackSubPixelField,
  leg: WedgeLine,
  other: WedgeLine,
  scale: number,
  paper: number,
  contrast: number,
): number {
  const reach = EDGE_PROFILE_PX + (scale > 1 ? LEVEL_INTERPOLATION_REACH_PX : 0);
  const clear = Math.abs(other.dx * (leg.cy - other.cy) - other.dy * (leg.cx - other.cx)) / scale;
  if (!(clear > reach + EDGE_PROFILE_CLEARANCE_PX)) return Number.NaN;
  const coverageAt = (t: number): number => {
    const seen =
      (paper - fieldLuma(field, leg.cx - leg.dy * t * scale, leg.cy + leg.dx * t * scale)) /
      contrast;
    return Math.min(1, Math.max(0, seen));
  };
  let covered = 0;
  const steps = Math.round((2 * reach) / EDGE_PROFILE_STEP_PX);
  for (let i = 0; i <= steps; i += 1) {
    const weight = i === 0 || i === steps ? 0.5 : 1;
    covered += weight * coverageAt(-reach + i * EDGE_PROFILE_STEP_PX);
  }
  const shift = reach - covered * EDGE_PROFILE_STEP_PX;
  return Math.abs(shift) <= MAX_EDGE_SHIFT_PX ? shift : Number.NaN;
}

// The field's luma at a continuous point (field px), bilinear between pixel
// centres.
function fieldLuma(field: CrackSubPixelField, x: number, y: number): number {
  return bilinear((px, py) => field.lumaAt(px, py), x - 0.5, y - 0.5);
}

// The wedge's box coverage of each SOURCE pixel near the apex, memoised.
function sourceCoverage(
  apex: Vec2,
  back: WedgeLine,
  ahead: WedgeLine,
  scale: number,
): (px: number, py: number) => number {
  const convex = back.dx * ahead.dy - back.dy * ahead.dx > 0;
  const inkAt = (x: number, y: number): boolean => {
    const onBack = back.dx * (y - apex.y) - back.dy * (x - apex.x) > 0;
    const onAhead = ahead.dx * (y - apex.y) - ahead.dy * (x - apex.x) > 0;
    return convex ? onBack && onAhead : onBack || onAhead;
  };
  const memo = new Map<string, number>();
  return (px, py) => {
    const key = `${px},${py}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let covered = 0;
    for (let sy = 0; sy < COVERAGE_SAMPLES; sy += 1) {
      for (let sx = 0; sx < COVERAGE_SAMPLES; sx += 1) {
        const x = (px + (sx + 0.5) / COVERAGE_SAMPLES) * scale;
        const y = (py + (sy + 0.5) / COVERAGE_SAMPLES) * scale;
        if (inkAt(x, y)) covered += 1;
      }
    }
    const value = covered / (COVERAGE_SAMPLES * COVERAGE_SAMPLES);
    memo.set(key, value);
    return value;
  };
}

// Bilinear interpolation of per-pixel values at a pixel-centre-indexed point
// (pixel k's centre is k); an integer point reads that pixel exactly.
function bilinear(value: (px: number, py: number) => number, sx: number, sy: number): number {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const top = fx === 0 ? value(x0, y0) : value(x0, y0) * (1 - fx) + value(x0 + 1, y0) * fx;
  if (fy === 0) return top;
  const bottom =
    fx === 0 ? value(x0, y0 + 1) : value(x0, y0 + 1) * (1 - fx) + value(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** True when the field corroborates the wedge (see {@link wedgeFieldFit}). */
export function fieldConfirmsWedge(fit: WedgeFieldFit | null): boolean {
  return fit !== null && fit.max <= MAX_COVERAGE_ERROR && fit.mean <= MEAN_COVERAGE_ERROR;
}
