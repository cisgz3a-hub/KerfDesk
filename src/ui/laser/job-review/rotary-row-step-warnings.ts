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
// Amendment 2 (rolling audit v13 Y5-P1-3): the check and the advice model the
// rows as the emitter writes them and the controller steps them
// (rotary-row-placement.ts), so a one-step interval that doubles rows warns,
// and the advice names only intervals that land evenly as printed.

import { rotaryYScale } from '../../../core/devices';
import type { RotaryAxis } from '../../../core/devices/rotary';
import { rotaryAxisOf } from '../../../core/devices/rotary-axis';
import type { Job, RasterGroup } from '../../../core/job';
import { rotaryAppliesTo } from '../../../core/job';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import type { Project } from '../../../core/scene';
import {
  fittingRowIntervals,
  rotaryRowPlacement,
  rowsLandEvenly,
  type FittingInterval,
  type RowIntervalAdvice,
} from './rotary-row-placement';

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
  const scale = rotaryYScale(rotary);
  const stepsText = `${axis} step (${AXIS_STEPS[axis].setting} = ${stepsPerUnit} ${AXIS_STEPS[axis].unit})`;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const group of rasters) {
    if (rowPitchMm(group) === null || seen.has(group.layerId)) continue;
    seen.add(group.layerId);
    const warning = rowStepWarning(group, { scale, stepsPerUnit, stepsText });
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

type AxisSteps = {
  readonly scale: number;
  readonly stepsPerUnit: number;
  readonly stepsText: string;
};

function rowStepWarning(group: RasterGroup, axis: AxisSteps): string | null {
  const heightMm = group.bounds.maxY - group.bounds.minY;
  const pitchMm = heightMm / group.pixelHeight;
  const rows = group.pixelHeight;
  const placement = rotaryRowPlacement(rows, pitchMm, axis.scale, axis.stepsPerUnit);
  if (rowsLandEvenly(placement)) return null;
  const stepsPerSurfaceMm = axis.scale * axis.stepsPerUnit;
  const stepMm = 1 / stepsPerSurfaceMm;
  const steps = pitchMm * stepsPerSurfaceMm;
  const gaps = placement.gapSteps.slice(0, 2).map((gap) => mm(gap * stepMm));
  const effect =
    placement.doubled > 0
      ? `so ${placement.doubled} of its ${rows} rows land on the row before and burn twice`
      : `so its rows land ${gaps.join(' or ')} mm apart and band`;
  const advice = intervalAdvice(
    fittingRowIntervals(heightMm, steps, axis.scale, axis.stepsPerUnit),
  );
  return (
    // ADR-699 Amd 1 (Z3-P3-4): a ramped Fill burns as a raster but is a Fill.
    `${group.fillRamp === true ? 'Fill' : 'Image'} layer ${group.layerId} on this rotary: one ${axis.stepsText} turns ` +
    `the part ${mm(stepMm)} mm, and the ${mm(pitchMm)} mm line interval is ` +
    `${steps.toFixed(2)} steps, ${effect}. ${advice}`
  );
}

function intervalAdvice(advice: RowIntervalAdvice): string {
  const best = advice.options[0];
  if (best === undefined)
    return 'No line interval this layer accepts lands every row on its own step.';
  if (!advice.even) {
    return (
      `No line interval this layer accepts lands every row on its own step; ` +
      `${described(best)} comes closest, with ${best.placement.doubled} of ` +
      `${best.placement.rows} rows doubled.`
    );
  }
  return `For even rows, set the line interval to ${advice.options.map(described).join(' or ')}.`;
}

function described(option: FittingInterval): string {
  const plural = option.steps === 1 ? '' : 's';
  return `${option.intervalMm} mm (${option.linesPerMm.toFixed(2)} lines/mm, ${option.steps} step${plural})`;
}

function mm(value: number): string {
  return value.toFixed(4);
}
