// Where a rotary job's rows really land (ADR-315 Amendments 2 and 3, rolling
// audits v13 Y5-P1-3 and v14 Z3). The emitter writes each row's position in
// the rotary axis's units to 3 decimals and the controller rounds it to a
// whole step: an image row sits at minY + (i + 0.5) × pitch (emit-raster.ts),
// a 0° Fill's hatch row wherever the hatching put it. A one-step image pitch
// puts every row centre on a half step, where the 3-decimal rounding breaks
// ties both ways, so rows double; the step arithmetic alone called that pitch
// even. A row's place against the step grid (its phase) also depends on where
// the artwork sits, so an interval is only offered when its rows land evenly
// at every phase (Amendment 3, Z3-P3-1).

import { pixelExtentForMm } from '../../../core/raster/luma-resample';
import { lineIntervalMmToLinesPerMm } from '../../../core/raster/raster-units';
import { maxOf } from '../../../core/util';

const EMITTED_DECIMALS = 3;
// A pitch the compiler rounds to whole rows drifts off an exact step count, so
// a long image gets an occasional one-step edge (the refuter's 0-17 in 380
// rows). Up to this share of off gaps, with no doubled row, is even enough.
const OFF_GAP_SHARE = 0.02;
const MAX_SUGGESTED_STEPS = 8;
/** Phases across one step at which an offered interval must land evenly. */
const PHASES = 8;

export type RowPlacement = {
  /** Rows that land on the step of the row before and burn twice. */
  readonly doubled: number;
  /** The distinct non-zero gaps between rows, in steps, smallest first. */
  readonly gapSteps: ReadonlyArray<number>;
  /** Gaps that differ from the most common one. */
  readonly offGaps: number;
  readonly rows: number;
};

/** Rows at these positions (the rotary axis's units, ascending) as written to
 *  3 decimals and stepped by the controller. */
export function steppedRowPlacement(
  positions: ReadonlyArray<number>,
  stepsPerUnit: number,
): RowPlacement {
  let doubled = 0;
  const gaps = new Map<number, number>();
  let previous: number | null = null;
  for (const position of positions) {
    const written = Number(position.toFixed(EMITTED_DECIMALS));
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
  return {
    doubled,
    gapSteps: [...gaps.keys()].sort((a, b) => a - b),
    offGaps,
    rows: positions.length,
  };
}

/** Image rows of a `pitchMm` (surface) pitch, from work zero on a whole step
 *  shifted by `phaseSteps`. */
export function rotaryRowPlacement(
  rows: number,
  pitchMm: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
  phaseSteps = 0,
): RowPlacement {
  return steppedRowPlacement(
    rowPositions(rows, pitchMm, unitsPerSurfaceMm, stepsPerUnit, { centred: true, phaseSteps }),
    stepsPerUnit,
  );
}

export function rowsLandEvenly(placement: RowPlacement): boolean {
  const allowed = Math.max(1, Math.floor(placement.rows * OFF_GAP_SHARE));
  return placement.doubled === 0 && placement.offGaps <= allowed;
}

export type RowKind = 'image' | 'fill';

export type FittingInterval = {
  /** As the operator types it into Line interval or Interval: 4 decimals. */
  readonly intervalMm: string;
  readonly linesPerMm: number;
  readonly steps: number;
  /** The worst of its phases. */
  readonly placement: RowPlacement;
};

export type RowIntervalAdvice = {
  /** Intervals whose rows land evenly; when none does, the closest one. */
  readonly options: ReadonlyArray<FittingInterval>;
  readonly even: boolean;
};

/** Intervals for these rows, each checked as typed (4 decimals) at every
 *  phase: through the compiler's own row count and the layer's stored range
 *  for an image, as hatch rows for a Fill. The nearest even one at or below
 *  the current step count and the nearest above. When no settable interval
 *  lands every row (a large part with coarse steps), the one that doubles the
 *  fewest rows. */
export function fittingRowIntervals(
  heightMm: number,
  currentSteps: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
  kind: RowKind = 'image',
): RowIntervalAdvice {
  const candidates = settableIntervals(
    { heightMm, currentSteps, unitsPerSurfaceMm, stepsPerUnit },
    kind,
  );
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

type RowGrid = {
  readonly heightMm: number;
  readonly currentSteps: number;
  readonly unitsPerSurfaceMm: number;
  readonly stepsPerUnit: number;
};

function settableIntervals(grid: RowGrid, kind: RowKind): FittingInterval[] {
  const stepsPerSurfaceMm = grid.unitsPerSurfaceMm * grid.stepsPerUnit;
  const options: FittingInterval[] = [];
  const last = Math.max(MAX_SUGGESTED_STEPS, Math.ceil(grid.currentSteps) + 3);
  for (let steps = 1; steps <= last; steps += 1) {
    const intervalMm = (steps / stepsPerSurfaceMm).toFixed(4);
    const typed = Number(intervalMm);
    const linesPerMm = kind === 'image' ? lineIntervalMmToLinesPerMm(typed) : 1 / typed;
    // An image layer clamps its density (5 to 25 lines/mm); a clamped entry burns another pitch.
    if (kind === 'image' && Math.abs(1 / linesPerMm - typed) > 0.00005) continue;
    const rows =
      kind === 'image'
        ? pixelExtentForMm(grid.heightMm, linesPerMm)
        : Math.max(2, Math.round(grid.heightMm / typed) + 1);
    const pitchMm = kind === 'image' ? grid.heightMm / rows : typed;
    const placement = worstPhase(rows, pitchMm, grid, kind === 'image');
    options.push({ intervalMm, linesPerMm, steps, placement });
  }
  return options;
}

function worstPhase(rows: number, pitchMm: number, grid: RowGrid, centred: boolean): RowPlacement {
  let worst: RowPlacement | null = null;
  for (let phase = 0; phase < PHASES; phase += 1) {
    const positions = rowPositions(rows, pitchMm, grid.unitsPerSurfaceMm, grid.stepsPerUnit, {
      centred,
      phaseSteps: phase / PHASES,
    });
    const placement = steppedRowPlacement(positions, grid.stepsPerUnit);
    if (worst === null || worse(placement, worst)) worst = placement;
  }
  return worst ?? steppedRowPlacement([], grid.stepsPerUnit);
}

function worse(a: RowPlacement, b: RowPlacement): boolean {
  const aEven = rowsLandEvenly(a);
  if (aEven !== rowsLandEvenly(b)) return !aEven;
  return a.doubled > b.doubled || (a.doubled === b.doubled && a.offGaps > b.offGaps);
}

function rowPositions(
  rows: number,
  pitchMm: number,
  unitsPerSurfaceMm: number,
  stepsPerUnit: number,
  at: { readonly centred: boolean; readonly phaseSteps: number },
): number[] {
  const offset = at.centred ? 0.5 : 0;
  const shift = at.phaseSteps / stepsPerUnit;
  const positions: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    positions.push((i + offset) * pitchMm * unitsPerSurfaceMm + shift);
  }
  return positions;
}
