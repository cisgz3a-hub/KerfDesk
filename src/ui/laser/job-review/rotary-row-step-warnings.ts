// Rotary image rows against the controller's Y steps (ADR-315 Amendment 1,
// rolling audit v12 X8-P2-3). The controller places every row on a whole Y
// step. On a flat bed a step is 0.0125 mm (80 steps/mm), which divides any
// usual line interval. A rotary scales Y by k machine mm per surface mm, so one
// step turns the part 1 / (k · steps/mm) surface mm: 0.0785 mm on an Ø80
// glass in the Creality chuck at $101 = 80. A 0.1 mm line interval is then
// 1.27 steps, so rows land 0.079 or 0.157 mm apart and band; below one step
// (an Ø150 bowl) some rows land on the row before and burn twice. The program
// commands the right rows, so this is a disclosure with the intervals that
// fit, never an output change.

import { rotaryYScale } from '../../../core/devices';
import type { Job, RasterGroup } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { Project } from '../../../core/scene';

/** Within this many steps of a whole number, rows land evenly enough. */
const STEP_FIT_TOLERANCE = 0.02;

export const ROTARY_ROW_STEPS_UNKNOWN_WARNING =
  "KerfDesk could not read this controller's Y steps per mm ($101), so it cannot check that " +
  "the image rows fit the rotary's steps. If rows band or burn twice, set the line interval " +
  'to a whole number of Y steps on the part.';

/** Exact prepared-job disclosure only; it never changes output or blocks Start. */
export function detectRotaryRowStepWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  job: Job,
  /** The live controller's $101; null when it reported none, undefined when
   *  the caller has no live controller (nothing is checked). */
  stepsPerMmY: number | null | undefined,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const rasters = job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
  if (rasters.length === 0 || stepsPerMmY === undefined) return [];
  if (stepsPerMmY === null || !(stepsPerMmY > 0)) return [ROTARY_ROW_STEPS_UNKNOWN_WARNING];
  const stepsPerSurfaceMm = rotaryYScale(rotary) * stepsPerMmY;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const group of rasters) {
    const pitchMm = rowPitchMm(group);
    if (pitchMm === null || seen.has(group.layerId)) continue;
    seen.add(group.layerId);
    const warning = rowStepWarning(group.layerId, pitchMm, stepsPerSurfaceMm, stepsPerMmY);
    if (warning !== null) warnings.push(warning);
  }
  return warnings;
}

/** Surface mm between the image's rows, or null for a one-row image. */
function rowPitchMm(group: RasterGroup): number | null {
  const height = group.bounds.maxY - group.bounds.minY;
  if (group.pixelHeight < 2 || !(height > 0)) return null;
  return height / group.pixelHeight;
}

function rowStepWarning(
  layerId: string,
  pitchMm: number,
  stepsPerSurfaceMm: number,
  stepsPerMmY: number,
): string | null {
  const steps = pitchMm * stepsPerSurfaceMm;
  const whole = Math.round(steps);
  if (whole >= 1 && Math.abs(steps - whole) <= STEP_FIT_TOLERANCE) return null;
  const stepMm = 1 / stepsPerSurfaceMm;
  const fewer = Math.max(1, Math.floor(steps));
  const effect =
    steps < 1
      ? `so about ${Math.round((1 - steps) * 100)} % of its rows land on the row before and burn twice`
      : `so its rows land ${mm(fewer * stepMm)} or ${mm((fewer + 1) * stepMm)} mm apart and band`;
  return (
    `Image layer ${layerId} on this rotary: one Y step ($101 = ${stepsPerMmY} steps/mm) turns ` +
    `the part ${mm(stepMm)} mm, and the ${mm(pitchMm)} mm line interval is ` +
    `${steps.toFixed(2)} steps, ${effect}. For even rows, set the line interval to ` +
    `${linesPerMm(fewer, stepsPerSurfaceMm)} or ${linesPerMm(fewer + 1, stepsPerSurfaceMm)}.`
  );
}

function linesPerMm(steps: number, stepsPerSurfaceMm: number): string {
  const lines = stepsPerSurfaceMm / steps;
  return `${lines.toFixed(2)} lines/mm (${mm(1 / lines)} mm, ${steps} step${steps === 1 ? '' : 's'})`;
}

function mm(value: number): string {
  return value.toFixed(3);
}
