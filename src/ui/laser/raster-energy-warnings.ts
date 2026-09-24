import type { Job, RasterGroup } from '../../core/job';
import { compiledLinesPerMm } from '../../core/raster/luma-resample';
import {
  LAYER_DEFAULTS,
  outputOperationLayers,
  type Layer,
  type LayerOperationSettings,
  type Project,
} from '../../core/scene';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/scene/effective-operation';

// Image-mode energy advisory (ADR-359). Every raster row burns at the
// operation's power and speed, and rows sit 1/(lines/mm) apart, so energy per
// area is power × lines/mm × passes / speed: 25 lines/mm at unchanged power
// and speed is 2.5x the dose of 10. Raising lines/mm "for quality" therefore
// overburns: the char spreads into the white lines and dots between burned
// runs and the image comes out darker than the canvas, which cannot show
// dose, suggests. Pass-Through burns at the source's own density (40-60 px/mm
// on dense art) and so multiplies the dose further. Warning only — never a
// gate (rule 7).

// Warn once the burn carries at least half again the energy per area of the
// settings it is measured against.
const ENERGY_ADVISORY_RATIO = 1.5;

type Dose = {
  readonly power: number;
  readonly linesPerMm: number;
  readonly passes: number;
  readonly speed: number;
};

export function rasterEnergyWarnings(job: Job, project: Project): ReadonlyArray<string> {
  if (project.machine?.kind === 'cnc') return [];
  const operations = project.scene.layers.flatMap(outputOperationLayers);
  // One warning per distinct message: copies of an image on one operation say
  // the same thing once.
  const warnings = new Set<string>();
  for (const group of job.groups) {
    if (group.kind !== 'raster') continue;
    const warning = describeRasterEnergy(group, operations, project);
    if (warning !== null) warnings.add(warning);
  }
  return [...warnings];
}

type EnergyContext = {
  readonly source: string;
  readonly operationName: string;
  readonly dose: Dose;
  readonly ratio: number;
  readonly maxFeed: number;
  // The artwork's own override, not the operation, holds this setting.
  readonly powerOverridden: boolean;
  readonly speedOverridden: boolean;
};

function describeRasterEnergy(
  group: RasterGroup,
  operations: ReadonlyArray<Layer>,
  project: Project,
): string | null {
  const layer = operations.find((operation) => operation.id === group.layerId);
  const obj = project.scene.objects.find((candidate) => candidate.id === group.sourceObjectId);
  if (layer === undefined || obj === undefined) return null;
  const op = effectiveOperationForObject(layer, obj);
  // group.power is the burned power after the artwork's Power scale.
  if (!(op.power > 0) || !(group.power > 0)) return null;
  const linesPerMm = burnDensity(group, op);
  if (linesPerMm === null) return null;
  const maxFeed = project.device.maxFeed;
  const dose: Dose = { ...op, linesPerMm, speed: Math.min(op.speed, maxFeed) };
  const preset = presetDose(layer.materialBinding?.lastResolved, maxFeed);
  const ratio =
    preset === null
      ? linesPerMm / LAYER_DEFAULTS.linesPerMm
      : energyPerArea(dose) / energyPerArea(preset);
  if (!(ratio >= ENERGY_ADVISORY_RATIO)) return null;
  const override = operationOverrideForObject(layer, obj);
  const context: EnergyContext = {
    source: group.source ?? 'image',
    operationName: layer.name,
    dose,
    ratio,
    maxFeed,
    ...overriddenFields(override),
  };
  const body = preset === null ? defaultMessage(context) : presetMessage(context, preset);
  return `${body}${fillIn(project, linesPerMm)} ${advice(context, preset)} and confirm with an Interval Test.`;
}

function overriddenFields(override: ReturnType<typeof operationOverrideForObject>): {
  readonly powerOverridden: boolean;
  readonly speedOverridden: boolean;
} {
  return {
    powerOverridden: override?.power !== undefined,
    speedOverridden: override?.speed !== undefined,
  };
}

// The operation's compiled density, or the source's own for Pass-Through.
function burnDensity(group: RasterGroup, op: LayerOperationSettings): number | null {
  const linesPerMm = op.passThrough
    ? group.pixelHeight / (group.bounds.maxY - group.bounds.minY)
    : compiledLinesPerMm(op.linesPerMm);
  return Number.isFinite(linesPerMm) && linesPerMm > 0 ? linesPerMm : null;
}

function defaultMessage(context: EnergyContext): string {
  const { dose } = context;
  return (
    `Image "${context.source}" on "${context.operationName}" burns ${formatCount(dose.linesPerMm)} lines/mm ` +
    `(rows ${formatMm(1 / dose.linesPerMm)} mm apart): ${formatCount(context.ratio)}× the energy per area ` +
    `of ${LAYER_DEFAULTS.linesPerMm} lines/mm at the same power and speed.`
  );
}

// Both settings in full, so the operator sees which of lines/mm, power, speed
// or passes departs from the preset rather than a blame on density alone.
function presetMessage(context: EnergyContext, preset: Dose): string {
  return (
    `Image "${context.source}" on "${context.operationName}" burns ${formatCount(context.ratio)}× the energy ` +
    `per area of its material preset: ${describeDose(context.dose)}, where the preset uses ` +
    `${describeDose(preset)}.`
  );
}

function describeDose(dose: Dose): string {
  const passes = Math.max(1, Math.floor(dose.passes));
  const passText = passes > 1 ? `, ${passes} passes` : '';
  return `${formatCount(dose.linesPerMm)} lines/mm at ${formatCount(dose.power)}% and ${formatCount(dose.speed)} mm/min${passText}`;
}

function advice(context: EnergyContext, preset: Dose | null): string {
  return preset === null ? relativeAdvice(context) : presetAdvice(context);
}

// A linked preset is a dose reference only when it describes an ordinary
// image operation: a Pass-Through or non-image preset was tuned for something
// else.
function presetDose(settings: LayerOperationSettings | undefined, maxFeed: number): Dose | null {
  if (settings === undefined || settings.mode !== 'image' || settings.passThrough) return null;
  if (!(settings.power > 0) || !(settings.speed > 0) || !(settings.linesPerMm > 0)) return null;
  return {
    power: settings.power,
    linesPerMm: compiledLinesPerMm(settings.linesPerMm),
    passes: settings.passes,
    speed: Math.min(settings.speed, maxFeed),
  };
}

function energyPerArea(dose: Dose): number {
  return (dose.power * dose.linesPerMm * Math.max(1, Math.floor(dose.passes))) / dose.speed;
}

function fillIn(project: Project, linesPerMm: number): string {
  const spotMm = project.device.laserSubProfile?.spotSizeMm?.y;
  const effect = 'white lines and dots fill in and the image burns darker than the canvas shows.';
  if (spotMm === undefined || !(spotMm > 0)) return ` Fine ${effect}`;
  return ` The ${formatMm(spotMm)} mm beam sweeps each point about ${formatCount(spotMm * linesPerMm)} times, so fine ${effect}`;
}

// With a preset there is a real reference dose, so the advice is absolute and
// following it brings the ratio back to 1, which clears this warning.
function presetAdvice(context: EnergyContext): string {
  const { dose, ratio } = context;
  const speed = Math.round(dose.speed * ratio);
  const powerField = context.powerOverridden ? "the artwork's power override" : 'power';
  const speedField = context.speedOverridden ? "the artwork's speed override" : 'speed';
  const speedRoute =
    speed <= context.maxFeed ? ` or raise ${speedField} to about ${speed} mm/min` : '';
  return `To match the preset, lower ${powerField} to about ${formatPercent(dose.power / ratio)}%${speedRoute},`;
}

// Without one, KerfDesk cannot know what density the power and speed were
// chosen for, so the advice stays relative to that unknown choice instead of
// cutting an already-compensated power again.
function relativeAdvice(context: EnergyContext): string {
  const { ratio } = context;
  const speedRoute =
    context.dose.speed * ratio <= context.maxFeed
      ? ` or about ${formatCount(ratio)}× that speed`
      : '';
  return `If this power and speed were chosen for ${LAYER_DEFAULTS.linesPerMm} lines/mm, use about ${Math.round(100 / ratio)}% of that power${speedRoute},`;
}

function formatCount(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function formatMm(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function formatPercent(value: number): string {
  return value >= 1 ? Math.round(value).toString() : Number(value.toPrecision(1)).toString();
}
