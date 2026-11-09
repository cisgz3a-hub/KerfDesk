// Rotary image rows against the controller's steps (ADR-315 Amendment 1,
// rolling audit v12 X8-P2-3). The controller places every row on a whole step
// of the axis that turns the part. On a flat bed a Y step is 0.0125 mm (80
// steps/mm), which divides any usual line interval. A rotary scales that axis
// by k units per surface mm, so one step turns the part 1 / (k · steps per
// unit) surface mm: 0.0785 mm on an Ø80 glass in the Creality chuck at
// $101 = 80. A 0.1 mm line interval is then 1.27 steps, so rows land 0.079 or
// 0.157 mm apart and band; below one step (an Ø150 bowl) some rows land on
// the row before and burn twice. A rotary on A or Z (ADR-695) is checked
// against $103 or $102 the same way. The program commands the right rows, so
// this is a disclosure with the intervals that fit, never an output change.

import { rotaryYScale } from '../../../core/devices';
import type { RotaryAxis } from '../../../core/devices/rotary';
import { rotaryAxisOf } from '../../../core/devices/rotary-axis';
import type { Job, RasterGroup } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import type { Project } from '../../../core/scene';

/** Within this many steps of a whole number, rows land evenly enough. */
const STEP_FIT_TOLERANCE = 0.02;

/** The controller's steps for each rotary axis, as $$ reports them. */
export type RotaryAxisStepSettings = Pick<
  ControllerSettingsSnapshot,
  'stepsPerMmY' | 'stepsPerMmZ' | 'stepsPerUnitA'
>;

const AXIS_STEPS: Readonly<
  Record<RotaryAxis, { readonly setting: string; readonly unit: string }>
> = {
  Y: { setting: '$101', unit: 'steps/mm' },
  Z: { setting: '$102', unit: 'steps/mm' },
  A: { setting: '$103', unit: 'steps/°' },
};

export function rotaryRowStepsUnknownWarning(axis: RotaryAxis): string {
  return (
    `KerfDesk could not read this controller's ${axis} steps (${AXIS_STEPS[axis].setting}), so ` +
    "it cannot check that the image rows fit the rotary's steps. If rows band or burn twice, " +
    `set the line interval to a whole number of ${axis} steps on the part.`
  );
}

/** Exact prepared-job disclosure only; it never changes output or blocks Start. */
export function detectRotaryRowStepWarnings(
  project: Pick<Project, 'device' | 'machine'>,
  job: Job,
  /** The live controller's settings; null when it reported none, undefined
   *  when the caller has no live controller (nothing is checked). */
  settings: RotaryAxisStepSettings | null | undefined,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const rasters = job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
  if (rasters.length === 0 || settings === undefined) return [];
  const axis = rotaryAxisOf(rotary);
  const stepsPerUnit = settings === null ? undefined : axisSteps(settings, axis);
  if (stepsPerUnit === undefined || !(stepsPerUnit > 0)) {
    return [rotaryRowStepsUnknownWarning(axis)];
  }
  // k is in the axis's own units per surface mm (degrees on A), as its steps are.
  const stepsPerSurfaceMm = rotaryYScale(rotary) * stepsPerUnit;
  const stepsText = `${axis} step (${AXIS_STEPS[axis].setting} = ${stepsPerUnit} ${AXIS_STEPS[axis].unit})`;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const group of rasters) {
    const pitchMm = rowPitchMm(group);
    if (pitchMm === null || seen.has(group.layerId)) continue;
    seen.add(group.layerId);
    const warning = rowStepWarning(group.layerId, pitchMm, stepsPerSurfaceMm, stepsText);
    if (warning !== null) warnings.push(warning);
  }
  return warnings;
}

function axisSteps(settings: RotaryAxisStepSettings, axis: RotaryAxis): number | undefined {
  if (axis === 'A') return settings.stepsPerUnitA;
  return axis === 'Z' ? settings.stepsPerMmZ : settings.stepsPerMmY;
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
  stepsText: string,
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
    `Image layer ${layerId} on this rotary: one ${stepsText} turns ` +
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
