// Rotary surface speed on a Moshiboard (ADR-705 Amendment 1, rolling audit
// v14 Z3-P1-2). A Y-port rotary runs the job in machine space, Y scaled by k
// (ADR-127 Amendment 2), so a stroke round the part at the layer speed moved
// the surface at 1/k of it: 15.9 % of the set dose in the Creality chuck on
// Ø80 glass, 184 % on a geared roller. G-code fixes that per move with
// surfaceMatchedFeed; a Moshi program has one speed header (builder.py
// `vector_speed` L376-397), and a speed change ends a program in MeerK40t too
// (driver.py `plot_start` L304-313). So a vector group on a rotary is split
// into runs of moves that share one matched speed, each its own program.
// Moshi speeds are whole mm/s from 1 to 256, so the match is quantised; the
// dose range that leaves is reported. Like the G-code fix, this assumes the
// board times a move by its commanded XY length.

import {
  surfaceFeedDoseRise,
  surfaceMatchedFeed,
  type RotaryFeedMatch,
} from '../../output/rotary-surface-feed';
import { MOSHI_VECTOR_SPEED_MAX_MM_S } from './moshi-program';
import { milsToMm, type MoshiPoint, type MoshiStep } from './moshi-units';

/** Moves that run as one program at one speed. The first is a laser-off move
 *  to where the run starts. */
export type MoshiSpeedRun = {
  readonly speedMmS: number;
  readonly steps: ReadonlyArray<MoshiStep>;
};

export type MoshiSpeedRuns = {
  readonly runs: ReadonlyArray<MoshiSpeedRun>;
  /** The lowest and highest dose any cut gets, as a share of the set dose. */
  readonly minDose: number;
  readonly maxDose: number;
};

type OpenRun = { speedMmS: number | null; steps: MoshiStep[] };

/** Splits a vector group's moves by the whole-mm/s speed that moves the
 *  part's surface at the layer speed. */
export function moshiSurfaceSpeedRuns(
  steps: ReadonlyArray<MoshiStep>,
  layerFeedMmPerMin: number,
  match: RotaryFeedMatch,
): MoshiSpeedRuns {
  const runs: MoshiSpeedRun[] = [];
  let open: OpenRun = { speedMmS: null, steps: [] };
  let minDose = Number.POSITIVE_INFINITY;
  let maxDose = 0;
  let previous: MoshiPoint | null = null;
  for (const step of steps) {
    if (step.cut && previous !== null) {
      const { speedMmS, dose } = matchedSpeed(previous, step, layerFeedMmPerMin, match);
      minDose = Math.min(minDose, dose);
      maxDose = Math.max(maxDose, dose);
      if (open.speedMmS === null) open.speedMmS = speedMmS;
      else if (open.speedMmS !== speedMmS) {
        runs.push({ speedMmS: open.speedMmS, steps: open.steps });
        open = { speedMmS, steps: [{ x: previous.x, y: previous.y, cut: false }] };
      }
    }
    open.steps.push(step);
    previous = step;
  }
  closeRun(runs, open, layerFeedMmPerMin);
  return { runs, minDose: Number.isFinite(minDose) ? minDose : 1, maxDose: maxDose || 1 };
}

// Trailing laser-off moves join the run before them; a run with no cut at
// all (a group of travels) runs at the layer speed.
function closeRun(runs: MoshiSpeedRun[], open: OpenRun, layerFeedMmPerMin: number): void {
  if (open.steps.length === 0) return;
  const last = runs[runs.length - 1];
  if (open.speedMmS === null && last !== undefined) {
    runs[runs.length - 1] = { speedMmS: last.speedMmS, steps: [...last.steps, ...open.steps] };
    return;
  }
  runs.push({ speedMmS: open.speedMmS ?? wholeSpeed(layerFeedMmPerMin / 60), steps: open.steps });
}

function matchedSpeed(
  from: MoshiPoint,
  to: MoshiPoint,
  layerFeedMmPerMin: number,
  match: RotaryFeedMatch,
): { speedMmS: number; dose: number } {
  const a = { x: milsToMm(from.x), y: milsToMm(from.y) };
  const b = { x: milsToMm(to.x), y: milsToMm(to.y) };
  const held = surfaceMatchedFeed(layerFeedMmPerMin, a, b, match);
  // The feed that would move the surface at the layer speed, before any hold.
  const wanted = (held * surfaceFeedDoseRise(layerFeedMmPerMin, a, b, match)) / 60;
  const speedMmS = wholeSpeed(held / 60);
  return { speedMmS, dose: wanted / speedMmS };
}

/** The nearest speed a vector header can carry. */
export function wholeSpeed(mmS: number): number {
  return Math.min(MOSHI_VECTOR_SPEED_MAX_MM_S, Math.max(1, Math.round(mmS)));
}
