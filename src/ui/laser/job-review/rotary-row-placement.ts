// Where a rotary image's rows really land (ADR-315 Amendment 2, rolling audit
// v13 Y5-P1-3). The emitter puts row i at minY + (i + 0.5) × pitch in the
// rotary axis's units (emit-raster.ts), writes it to 3 decimals, and the
// controller rounds that to a whole step. A one-step pitch puts every row
// centre on a half step, where the 3-decimal rounding breaks ties both ways,
// so rows double; the step arithmetic alone called that pitch even. This
// models the rows as written and stepped, from work zero on a whole step
// (an Absolute job's rebase, or an origin set at the head).

import { pixelExtentForMm } from '../../../core/raster/luma-resample';
import { lineIntervalMmToLinesPerMm } from '../../../core/raster/raster-units';
import { maxOf } from '../../../core/util';

const EMITTED_DECIMALS = 3;
// A pitch the compiler rounds to whole rows drifts off an exact step count, so
// a long image gets an occasional one-step edge (the refuter's 0-17 in 380
// rows). Up to this share of off gaps, with no doubled row, is even enough.
const OFF_GAP_SHARE = 0.02;
const MAX_SUGGESTED_STEPS = 8;

export type RowPlacement = {
  /** Rows that land on the step of the row before and burn twice. */
  readonly doubled: number;
  /** The distinct non-zero gaps between rows, in steps, smallest first. */
  readonly gapSteps: ReadonlyArray<number>;
  /** Gaps that differ from the most common one. */
  readonly offGaps: number;
  readonly rows: number;
};

/** Rows of a `pitchMm` (surface) image as the controller steps them. */
export function rotaryRowPlacement(
  rows: number,
  pitchMm: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
): RowPlacement {
  let doubled = 0;
  const gaps = new Map<number, number>();
  let previous: number | null = null;
  for (let i = 0; i < rows; i += 1) {
    const written = Number(((i + 0.5) * pitchMm * unitsPerSurfaceMm).toFixed(EMITTED_DECIMALS));
    const step = Math.round(written * stepsPerUnit);
    if (previous !== null) {
      const gap = Math.abs(step - previous);
      if (gap === 0) doubled += 1;
      else gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
    }
    previous = step;
  }
  const counts = [...gaps.values()];
  const common = counts.length === 0 ? 0 : maxOf(counts);
  const offGaps = counts.reduce((sum, count) => sum + count, 0) - common;
  return { doubled, gapSteps: [...gaps.keys()].sort((a, b) => a - b), offGaps, rows };
}

export function rowsLandEvenly(placement: RowPlacement): boolean {
  const allowed = Math.max(1, Math.floor(placement.rows * OFF_GAP_SHARE));
  return placement.doubled === 0 && placement.offGaps <= allowed;
}

export type FittingInterval = {
  /** As the operator types it into Line interval: 4 decimals. */
  readonly intervalMm: string;
  readonly linesPerMm: number;
  readonly steps: number;
  readonly placement: RowPlacement;
};

export type RowIntervalAdvice = {
  /** Intervals whose rows land evenly; when none does, the closest one. */
  readonly options: ReadonlyArray<FittingInterval>;
  readonly even: boolean;
};

/** Line intervals for this image, each checked as typed (4 decimals) through
 *  the compiler's own row count and the layer's stored range: the nearest
 *  even one at or below the current step count and the nearest above. When
 *  no settable interval lands every row (a large part with coarse steps), the
 *  one that doubles the fewest rows. */
export function fittingRowIntervals(
  heightMm: number,
  currentSteps: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
): RowIntervalAdvice {
  const candidates = settableIntervals(heightMm, currentSteps, unitsPerSurfaceMm, stepsPerUnit);
  const fitting = candidates.filter((option) => rowsLandEvenly(option.placement));
  if (fitting.length === 0) {
    const closest = [...candidates].sort(
      (a, b) =>
        a.placement.doubled - b.placement.doubled || a.placement.offGaps - b.placement.offGaps,
    )[0];
    return { options: closest === undefined ? [] : [closest], even: false };
  }
  const atOrBelow = fitting.filter((option) => option.steps <= currentSteps);
  const below = atOrBelow[atOrBelow.length - 1];
  const above = fitting.find((option) => option.steps > currentSteps);
  const chosen = [below, above].filter((option): option is FittingInterval => option !== undefined);
  return { options: chosen.length === 2 ? chosen : fitting.slice(0, 2), even: true };
}

function settableIntervals(
  heightMm: number,
  currentSteps: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
): FittingInterval[] {
  const stepsPerSurfaceMm = unitsPerSurfaceMm * stepsPerUnit;
  const options: FittingInterval[] = [];
  const last = Math.max(MAX_SUGGESTED_STEPS, Math.ceil(currentSteps) + 3);
  for (let steps = 1; steps <= last; steps += 1) {
    const intervalMm = (steps / stepsPerSurfaceMm).toFixed(4);
    const linesPerMm = lineIntervalMmToLinesPerMm(Number(intervalMm));
    // The layer clamps its density (5 to 25 lines/mm); a clamped entry burns another pitch.
    if (Math.abs(1 / linesPerMm - Number(intervalMm)) > 0.00005) continue;
    const rows = pixelExtentForMm(heightMm, linesPerMm);
    const placement = rotaryRowPlacement(rows, heightMm / rows, unitsPerSurfaceMm, stepsPerUnit);
    options.push({ intervalMm, linesPerMm, steps, placement });
  }
  return options;
}
