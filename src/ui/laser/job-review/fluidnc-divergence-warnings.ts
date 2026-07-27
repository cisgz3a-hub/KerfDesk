// Job Review disclosures for two FluidNC behaviours KerfDesk does not
// otherwise model: silent long-line truncation, and numeric $ settings that
// are read-only mirrors of the YAML config.
//
// Advisory only, never a gate (rule 7). KerfDesk still compiles and streams
// every line exactly as emitted, and still sends any $ write the operator
// asks for; these strings only tell the operator what the firmware will do
// with them. Neither is a transport precondition — a truncated line is a
// fidelity problem, not a channel that cannot accept the stream.

import {
  findFluidncOverlongLines,
  FLUIDNC_MAX_LINE_CHARS,
} from '../../../core/controllers/fluidnc/fluidnc-line-limit';
import {
  FLUIDNC_READ_ONLY_SETTING_ERROR_CODE,
  FLUIDNC_READ_ONLY_SETTING_IDS,
} from '../../../core/controllers/fluidnc/fluidnc-read-only-settings';
import type { ControllerKind } from '../../../core/devices';

export const FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX = 'FluidNC line-length divergence:';
export const FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX = 'FluidNC read-only settings:';

export type FluidncDivergenceInput = {
  readonly configured: ControllerKind;
  readonly active: ControllerKind;
  readonly detected: ControllerKind | null;
  /** The exact prepared program, so the count matches what would stream. */
  readonly gcode: string;
};

/**
 * Builds the non-blocking FluidNC divergence disclosures for one prepared job.
 * @param input Controller identities for this Start plus the exact prepared program.
 * @returns Job Review warning strings, job-specific first; empty for non-FluidNC targets.
 */
export function detectFluidncDivergenceWarnings(
  input: FluidncDivergenceInput,
): ReadonlyArray<string> {
  if (!targetsFluidnc(input)) return [];
  return [...lineTruncationWarnings(input.gcode), readOnlySettingWarning()];
}

// Any FluidNC signal is enough. A mismatch between these identities is
// separately disclosed by controllerIdentityWarnings; here a false positive
// costs one collapsed line, while a miss lets a silently different job run.
function targetsFluidnc(input: FluidncDivergenceInput): boolean {
  return (
    input.configured === 'fluidnc' || input.active === 'fluidnc' || input.detected === 'fluidnc'
  );
}

function lineTruncationWarnings(gcode: string): ReadonlyArray<string> {
  const overlong = findFluidncOverlongLines(gcode);
  const first = overlong[0];
  if (first === undefined) return [];
  const longest = overlong.reduce((worst, line) => (line.length > worst.length ? line : worst));
  return [
    `${FLUIDNC_LINE_TRUNCATION_WARNING_PREFIX} ${overlong.length} line(s) in this program are ` +
      `longer than the ${FLUIDNC_MAX_LINE_CHARS} characters FluidNC keeps per line ` +
      `(first: line ${first.lineNumber} at ${first.length} characters; ` +
      `longest: line ${longest.lineNumber} at ${longest.length} characters). ` +
      `FluidNC stores the first ${FLUIDNC_MAX_LINE_CHARS} characters, discards the rest, and ` +
      'returns no error, so the controller would run a different move than the one prepared here. ' +
      'KerfDesk streams every line exactly as compiled and never shortens, splits, or drops one — ' +
      'simplify the geometry at the source if this job depends on those moves.',
  ];
}

function readOnlySettingWarning(): string {
  return (
    `${FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX} FluidNC exposes ${settingList()} as read-only ` +
    'mirrors of its YAML configuration. A write such as $32=1 answers ' +
    `error:${FLUIDNC_READ_ONLY_SETTING_ERROR_CODE} (ReadOnlySetting) and changes nothing, so the ` +
    '$30/$32 remedy named in the laser-mode acknowledgement cannot be applied from KerfDesk — set ' +
    'laser mode and max spindle speed in the FluidNC YAML config instead, then re-read the ' +
    'controller. KerfDesk still sends any $ write you ask for.'
  );
}

function settingList(): string {
  const ids = [...FLUIDNC_READ_ONLY_SETTING_IDS].sort((a, b) => a - b).map((id) => `$${id}`);
  const last = ids[ids.length - 1];
  return last === undefined ? '' : `${ids.slice(0, -1).join(', ')} and ${last}`;
}
