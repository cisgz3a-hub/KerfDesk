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
// Amendment 3 (rolling audit v14 Z3): a 0° Fill's hatch rows run round the
// part too and are checked the same way, read from the machine-space job; an
// offered interval must land evenly at every phase; layers go by their names,
// and a Fill (ramped or not) is advised on its Interval.
// ADR-705 Amendment 2 (rolling audit v14 Z4-P2-1): a Moshiboard places every
// coordinate on a whole mil of machine Y, so the same check runs on that grid
// for a Moshi Y-port rotary (detectRotaryRowGridWarnings).

import { rotaryYScale } from '../../../core/devices';
import type { RotaryAxis } from '../../../core/devices/rotary';
import { rotaryAxisOf } from '../../../core/devices/rotary-axis';
import type { FillGroup, Job, RasterGroup } from '../../../core/job';
import { machineSpaceJob, rotaryAppliesTo } from '../../../core/job';
import type { ControllerSettingsSnapshot } from '../../../core/preflight';
import type { Project } from '../../../core/scene';
import {
  fittingRowIntervals,
  rotaryRowPlacement,
  rowsLandEvenly,
  steppedRowPlacement,
  type FittingInterval,
  type RowIntervalAdvice,
  type RowKind,
  type RowPlacement,
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
  project: Pick<Project, 'device' | 'machine'> & {
    readonly scene?: Pick<Project['scene'], 'layers'>;
  },
  job: Job,
  /** The live controller's settings; null when it reported none, undefined
   *  when the caller has no live controller (nothing is checked). */
  settings: RotaryAxisStepSettings | null | undefined,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const rasters = job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
  const fills = job.groups.filter(isScanlineFill);
  if ((rasters.length === 0 && fills.length === 0) || settings === undefined) return [];
  const axis = rotaryAxisOf(rotary);
  const stepsPerUnit = settings === null ? undefined : axisSteps(settings, axis);
  if (stepsPerUnit === undefined || !(stepsPerUnit > 0)) {
    return [rotaryRowStepsUnknownWarning(axis)];
  }
  return detectRotaryRowGridWarnings(project, job, {
    stepsPerUnit,
    stepsText: `${axis} step (${AXIS_STEPS[axis].setting} = ${stepsPerUnit} ${AXIS_STEPS[axis].unit})`,
  });
}

/** The positions the controller can place the rotary axis on: `stepsPerUnit`
 *  per mm (or per degree), named in the warning by `stepsText`. */
export type RotaryRowGrid = { readonly stepsPerUnit: number; readonly stepsText: string };

/** The same disclosure for a known position grid, such as a Moshiboard's
 *  whole mils (ADR-705 Amendment 2). It never changes output or blocks Start. */
export function detectRotaryRowGridWarnings(
  project: Pick<Project, 'device' | 'machine'> & {
    readonly scene?: Pick<Project['scene'], 'layers'>;
  },
  job: Job,
  grid: RotaryRowGrid,
): ReadonlyArray<string> {
  const rotary = project.device.rotary;
  if (!rotaryAppliesTo(project.device, project.machine) || rotary === undefined) return [];
  const rasters = job.groups.filter((group): group is RasterGroup => group.kind === 'raster');
  const fills = job.groups.filter(isScanlineFill);
  if (rasters.length === 0 && fills.length === 0) return [];
  // k is in the axis's own units per surface mm (degrees on A), as its steps are.
  const steps: AxisSteps = { scale: rotaryYScale(rotary), ...grid };
  const name = (layerId: string) =>
    project.scene?.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
  const seen = new Set<string>();
  const images = imageWarnings(rasters, steps, name, seen);
  if (fills.length === 0) return images;
  const machineFills = machineSpaceJob(job, project.device, project.machine).groups;
  return [...images, ...fillWarnings(machineFills.filter(isScanlineFill), steps, name, seen)];
}

function imageWarnings(
  rasters: ReadonlyArray<RasterGroup>,
  steps: AxisSteps,
  name: (layerId: string) => string,
  seen: Set<string>,
): string[] {
  const warnings: string[] = [];
  for (const group of rasters) {
    if (rowPitchMm(group) === null || seen.has(group.layerId)) continue;
    seen.add(group.layerId);
    const warning = imageRowWarning(group, steps, name(group.layerId));
    if (warning !== null) warnings.push(warning);
  }
  return warnings;
}

function fillWarnings(
  fills: ReadonlyArray<FillGroup>,
  steps: AxisSteps,
  name: (layerId: string) => string,
  seen: Set<string>,
): string[] {
  const warnings: string[] = [];
  for (const group of fills) {
    if (seen.has(group.layerId)) continue;
    const warning = fillRowWarning(group, steps, name(group.layerId));
    if (warning === null) continue;
    seen.add(group.layerId);
    warnings.push(warning);
  }
  return warnings;
}

function axisSteps(settings: RotaryAxisStepSettings, axis: RotaryAxis): number | undefined {
  if (axis === 'A') return settings.stepsPerUnitA;
  return axis === 'Z' ? settings.stepsPerMmZ : settings.stepsPerMmY;
}

function isScanlineFill(group: Job['groups'][number]): group is FillGroup {
  return group.kind === 'fill' && (group.fillStyle ?? 'scanline') !== 'offset';
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

function imageRowWarning(group: RasterGroup, axis: AxisSteps, name: string): string | null {
  const heightMm = group.bounds.maxY - group.bounds.minY;
  const pitchMm = heightMm / group.pixelHeight;
  const placement = rotaryRowPlacement(group.pixelHeight, pitchMm, axis.scale, axis.stepsPerUnit);
  if (rowsLandEvenly(placement)) return null;
  // A ramped Fill compiles to rows like an image, but its field is the Fill's Interval.
  const kind: RowKind = group.fillRamp === true ? 'fill' : 'image';
  return rowWarning({ name, kind, heightMm, pitchMm, placement }, axis);
}

/** A 0° Fill's hatch rows, read where the machine-space job puts them. */
function fillRowWarning(group: FillGroup, axis: AxisSteps, name: string): string | null {
  const rows = hatchRowPositions(group);
  if (rows.length < 2) return null;
  const placement = steppedRowPlacement(rows, axis.stepsPerUnit);
  if (rowsLandEvenly(placement)) return null;
  const first = rows[0] ?? 0;
  const last = rows[rows.length - 1] ?? 0;
  const heightMm = (last - first) / axis.scale;
  const pitchMm = heightMm / (rows.length - 1);
  return rowWarning({ name, kind: 'fill', heightMm, pitchMm, placement }, axis);
}

/** The distinct rotary-axis positions of a Fill's hatch lines that run along
 *  X (a cross-hatch's other pass and any angled hatch are not rows). */
function hatchRowPositions(group: FillGroup): number[] {
  const rows = new Set<number>();
  for (const segment of group.segments) {
    const from = segment.polyline[0];
    const to = segment.polyline[segment.polyline.length - 1];
    if (from === undefined || to === undefined || Math.abs(to.y - from.y) > 1e-9) continue;
    if (Math.abs(to.x - from.x) > 1e-9) rows.add(Number(from.y.toFixed(9)));
  }
  return [...rows].sort((a, b) => a - b);
}

type RowFacts = {
  readonly name: string;
  readonly kind: RowKind;
  readonly heightMm: number;
  readonly pitchMm: number;
  readonly placement: RowPlacement;
};

function rowWarning(rows: RowFacts, axis: AxisSteps): string {
  const stepsPerSurfaceMm = axis.scale * axis.stepsPerUnit;
  const stepMm = 1 / stepsPerSurfaceMm;
  const steps = rows.pitchMm * stepsPerSurfaceMm;
  const { placement } = rows;
  const gaps = placement.gapSteps.slice(0, 2).map((gap) => mm(gap * stepMm));
  const effect =
    placement.doubled > 0
      ? `so ${placement.doubled} of its ${placement.rows} rows land on the row before and burn twice`
      : `so its rows land ${gaps.join(' or ')} mm apart and band`;
  const field = rows.kind === 'fill' ? 'Interval' : 'line interval';
  const advice = intervalAdvice(
    fittingRowIntervals(rows.heightMm, steps, axis.scale, axis.stepsPerUnit, rows.kind),
    field,
  );
  const label = rows.kind === 'fill' ? 'Fill layer' : 'Image layer';
  return (
    `${label} ${rows.name} on this rotary: one ${axis.stepsText} turns ` +
    `the part ${mm(stepMm)} mm, and the ${mm(rows.pitchMm)} mm ${field} is ` +
    `${steps.toFixed(2)} steps, ${effect}. ${advice}`
  );
}

function intervalAdvice(advice: RowIntervalAdvice, field: string): string {
  const best = advice.options[0];
  if (best === undefined) return `No ${field} this layer accepts lands every row on its own step.`;
  if (!advice.even) {
    return (
      `No ${field} this layer accepts lands every row on its own step; ` +
      `${described(best)} comes closest, with ${best.placement.doubled} of ` +
      `${best.placement.rows} rows doubled.`
    );
  }
  return `For even rows, set the ${field} to ${advice.options.map(described).join(' or ')}.`;
}

function described(option: FittingInterval): string {
  const plural = option.steps === 1 ? '' : 's';
  return `${option.intervalMm} mm (${option.linesPerMm.toFixed(2)} lines/mm, ${option.steps} step${plural})`;
}

function mm(value: number): string {
  return value.toFixed(4);
}
