// Power and speed for the hover readout (ADR-348 Amendment 1): what output
// would run for the hovered piece, not only what its operation row says. A
// per-artwork override, the artwork's power scale, an Image's minimum power
// and the machine's Output max feed all change the numbers output uses, so
// they change these too. Pure: no DOM, no store.

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
 * and "power" is not a CNC setting.
 */
export function hoverOutputSettings(
  project: Project,
  object: SceneObject,
): HoverOutputSettings | null {
  if (machineKindOf(project.machine) !== 'laser') return null;
  // A trace's source bitmap is a reference: output skips it whatever its operation says.
  if (object.kind === 'raster-image' && object.role === 'trace-source')
    return { kind: 'note', text: 'Trace source, not output' };
  const operations = project.scene.layers.filter((layer) =>
    sceneObjectUsesOperation(object, layer),
  );
  if (operations.length === 0) return { kind: 'note', text: 'No operation' };
  const lines: HoverSettingsLine[] = [];
  for (const operation of operations) {
    // The operation and each enabled sub-operation, as output runs them.
    for (const run of outputOperationLayers(operation)) {
      const line = runLine(run, object, project.device.maxFeed, operation.color);
      if (!lines.some((seen) => seen.power === line.power && seen.speed === line.speed))
        lines.push(line);
    }
  }
  if (lines.length === 0) return { kind: 'note', text: 'Output off' };
  return {
    kind: 'runs',
    lines: lines.slice(0, MAX_LINES),
    more: Math.max(0, lines.length - MAX_LINES),
  };
}

function runLine(
  run: Layer,
  object: SceneObject,
  maxFeed: number,
  color: string,
): HoverSettingsLine {
  const effective = effectiveOperationForObject(run, object);
  const power = effectiveObjectPowerPercent(effective, object);
  // Only an Image modulates between a floor and the peak; Line and Fill burn at the peak.
  const minPower =
    effective.mode === 'image' ? effectiveObjectMinPowerPercent(effective, object) : 0;
  const capped = effective.speed > maxFeed;
  return {
    color,
    power:
      minPower > 0 && minPower < power
        ? `${format(minPower)}–${format(power)}%`
        : `${format(power)}%`,
    speed: `${format(capped ? maxFeed : effective.speed)} mm/min${capped ? ' (capped)' : ''}`,
  };
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}
