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
// Below this paper-to-ink contrast (luma) the coverage estimate is noise.
const MIN_CONTRAST_LUMA = 48;
// Source pixels whose centres lie within this box round the apex are compared.
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
 * mean coverage error over the source pixels round the apex; null when the
 * field cannot say (too little contrast, or levels that contradict the legs).
 */
export function wedgeFieldFit(
  field: CrackSubPixelField,
  apex: Vec2,
  back: WedgeLine,
  ahead: WedgeLine,
  scale: number,
): WedgeFieldFit | null {
  const luma = (x: number, y: number): number => field.lumaAt(Math.floor(x), Math.floor(y));
  const offset = LEVEL_OFFSET_PX * scale;
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
  const convex = back.dx * ahead.dy - back.dy * ahead.dx > 0;
  const inkAt = (x: number, y: number): boolean => {
    const onBack = back.dx * (y - apex.y) - back.dy * (x - apex.x) > 0;
    const onAhead = ahead.dx * (y - apex.y) - ahead.dy * (x - apex.x) > 0;
    return convex ? onBack && onAhead : onBack || onAhead;
  };
  const ax = apex.x / scale;
  const ay = apex.y / scale;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let py = Math.ceil(ay - WINDOW_PX - 0.5); py + 0.5 <= ay + WINDOW_PX; py += 1) {
    for (let px = Math.ceil(ax - WINDOW_PX - 0.5); px + 0.5 <= ax + WINDOW_PX; px += 1) {
      let covered = 0;
      for (let sy = 0; sy < COVERAGE_SAMPLES; sy += 1) {
        for (let sx = 0; sx < COVERAGE_SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / COVERAGE_SAMPLES) * scale;
          const y = (py + (sy + 0.5) / COVERAGE_SAMPLES) * scale;
          if (inkAt(x, y)) covered += 1;
        }
      }
      const model = covered / (COVERAGE_SAMPLES * COVERAGE_SAMPLES);
      const seen = (paper - luma((px + 0.5) * scale, (py + 0.5) * scale)) / contrast;
      const error = Math.abs(Math.min(1, Math.max(0, seen)) - model);
      max = Math.max(max, error);
      sum += error;
      count += 1;
    }
  }
  return count === 0 ? null : { max, mean: sum / count };
}

/** True when the field corroborates the wedge (see {@link wedgeFieldFit}). */
export function fieldConfirmsWedge(fit: WedgeFieldFit | null): boolean {
  return fit !== null && fit.max <= MAX_COVERAGE_ERROR && fit.mean <= MEAN_COVERAGE_ERROR;
}
