// Power and speed for the hover readout (ADR-348 Amendment 1): what output
// would run for the hovered piece, not only what its operation row says. A
// per-artwork override, the artwork's power scale, a Grayscale image's minimum
// power and the machine's Output max feed all change the numbers output uses,
// so they change these too. With Inches on, speed reads in in/min like the
// layer Speed box (ADR-629). Pure: no DOM, no store.

import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../../core/effective-output';
import {
  machineKindOf,
  outputOperationLayers,
  sceneObjectUsesOperation,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  artworkOutputRuns,
  runUsesMinPower,
  type ArtworkOutputRun,
} from '../layers/artwork-output-runs';
import { MM_PER_INCH, type DisplayLengthUnit } from '../display-length';

export type HoverSettingsLine = {
  /** The operation's colour, so a multi-colour piece says which line is which. */
  readonly color: string;
  readonly power: string;
  readonly speed: string;
};

export type HoverOutputSettings =
  | {
      readonly kind: 'runs';
      readonly lines: ReadonlyArray<HoverSettingsLine>;
      /** Distinct settings left out to keep the readout small. */
      readonly more: number;
    }
  | { readonly kind: 'note'; readonly text: string };

const MAX_LINES = 3;

/**
 * The power and speed each run of the piece uses, one line per distinct
 * setting. Null on a CNC machine: its feeds come from stages and recipes,
 * and "power" is not a CNC setting. Null for a relief too, which only a CNC
 * project shows.
 */
export function hoverOutputSettings(
  project: Project,
  object: SceneObject,
  unit: DisplayLengthUnit = 'mm',
): HoverOutputSettings | null {
  if (machineKindOf(project.machine) !== 'laser' || object.kind === 'relief') return null;
  // A trace's source bitmap is a reference: output skips it whatever its operation says.
  if (object.kind === 'raster-image' && object.role === 'trace-source')
    return { kind: 'note', text: 'Trace source, not output' };
  const operations = project.scene.layers.filter((layer) =>
    sceneObjectUsesOperation(object, layer),
  );
  if (operations.length === 0) return { kind: 'note', text: 'No operation' };
  const enabled = operations.flatMap(outputOperationLayers);
  const [firstEnabled] = enabled;
  if (firstEnabled === undefined) return { kind: 'note', text: 'Output off' };
  const runs = artworkOutputRuns(object, operations);
  // Compile burns vectors only on Line or Fill and bitmaps only on Image.
  if (runs.length === 0) return { kind: 'note', text: modeMismatchNote(object, firstEnabled) };
  const lines: HoverSettingsLine[] = [];
  for (const run of runs) {
    const line = runLine(run, object, project.device.maxFeed, unit);
    if (!lines.some((seen) => seen.power === line.power && seen.speed === line.speed))
      lines.push(line);
  }
  return {
    kind: 'runs',
    lines: lines.slice(0, MAX_LINES),
    more: Math.max(0, lines.length - MAX_LINES),
  };
}

// Worded like Job Review's layer-mode-mismatch warning, which says the piece
// "will not be engraved" because its operation "is in Image mode".
function modeMismatchNote(object: SceneObject, run: Layer): string {
  const mode =
    object.kind !== 'raster-image'
      ? 'Image'
      : effectiveOperationForObject(run, object).mode === 'fill'
        ? 'Fill'
        : 'Line';
  return `Not engraved: operation is in ${mode} mode`;
}

function runLine(
  run: ArtworkOutputRun,
  object: SceneObject,
  maxFeed: number,
  unit: DisplayLengthUnit,
): HoverSettingsLine {
  const { effective } = run;
  const power = effectiveObjectPowerPercent(effective, object);
  // Only Grayscale shades between a floor and the peak; dithers, Line and
  // Fill burn at the peak.
  const minPower = runUsesMinPower(effective)
    ? effectiveObjectMinPowerPercent(effective, object)
    : 0;
  const capped = effective.speed > maxFeed;
  return {
    color: run.color,
    power:
      minPower > 0 && minPower < power
        ? `${format(minPower)}–${format(power)}%`
        : `${format(power)}%`,
    speed: `${speedText(capped ? maxFeed : effective.speed, unit)}${capped ? ' (capped)' : ''}`,
  };
}

// In inches, one decimal of in/min, as the layer Speed box shows it.
function speedText(mmPerMin: number, unit: DisplayLengthUnit): string {
  if (unit === 'mm') return `${format(mmPerMin)} mm/min`;
  return `${format(Number((mmPerMin / MM_PER_INCH).toFixed(1)))} in/min`;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
