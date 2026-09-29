// Shared types and leg constants of the corner dial (contour-corners.ts,
// ADR-439).

import type { Vec2 } from '../scene';
import type { CrackSubPixelField } from './saddle-connectivity';

/** Rounding cost of a one-pixel lattice step: tan(22.5°). */
export const LATTICE_STEP_COST_PX = Math.tan(Math.PI / 8);
// Legs longer than this add no information and would only cost scan time.
export const LEG_CAP_PX = 24;
// Crack chains carry ~1-1.4 points per px of arc (diagonal steps are 0.707).
export const POINTS_PER_PX = 1.5;
export const MIN_LEG_POINTS = 3;
// Below this turn two legs are one slanted line (their intersection is
// ill-conditioned and the fillet cost is noise).
export const MIN_LEG_TURN_RAD = (15 * Math.PI) / 180;
// Barrier kinds at lattice vertices (see latticeBarriers).
export const PIXEL_CORNER = 1;
export const KEPT_FEATURE = 2;

export type ContourCorner = {
  /** Last crack of the incoming leg. */
  readonly from: number;
  /** Cracks between `from` and the outgoing leg that the apex replaces. */
  readonly skip: number;
  /** Corner vertex (a fresh object; downstream stages pin it by reference). */
  readonly apex: Vec2;
  /** Rounding cost in SOURCE px; the corner is kept while cost > threshold. */
  readonly cost: number;
};

export type CornerDialInput = {
  /** Closed lattice staircase: crack i runs staircase[i] → staircase[i+1]. */
  readonly staircase: ReadonlyArray<Vec2>;
  /** One point per crack (mid-crack or sub-pixel measured). */
  readonly cracks: ReadonlyArray<Vec2>;
  /** True when most cracks were measured from the pre-threshold field. */
  readonly measured: boolean;
  readonly pixelScale: number;
  /** Source-px threshold from {@link cornerThresholdFromSmoothness}. */
  readonly thresholdPx: number;
  /** Edge-wobble amplitude (source px) the finishing stages will straighten
   *  away; 0 or omitted = none. Only re-seats the decided apexes on the lines
   *  the flattener will draw; which corners exist does not depend on it. */
  readonly edgeNoisePx?: number;
  /** The pre-threshold field the measured cracks came from, which confirms
   *  measured apexes the crack chain alone cannot (contour-corner-field.ts). */
  readonly field?: CrackSubPixelField;
};

export type Candidate = ContourCorner & {
  /** Straight-leg extent in cracks, for compatibility tests. */
  readonly legBack: number;
  readonly legAhead: number;
  /** A lattice corner of a pixel feature (see pixelFeatureHeights). */
  readonly feature?: boolean;
};
