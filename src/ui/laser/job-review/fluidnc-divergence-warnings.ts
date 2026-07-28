// Job Review disclosures for FluidNC's direct-channel/parser boundary and
// numeric $ settings that are read-only YAML configuration mirrors.
//
// Advisory only, never a gate (rule 7). The active driver owns numeric-write
// behavior, and these strings only make current identity evidence explicit.

import {
  findFluidncNonExecutableLines,
  FLUIDNC_GCODE_MAX_PAYLOAD_BYTES,
  FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS,
} from '../../../core/controllers/fluidnc/fluidnc-line-limit';
import {
  FLUIDNC_READ_ONLY_SETTING_ERROR_CODE,
  FLUIDNC_READ_ONLY_SETTING_IDS,
} from '../../../core/controllers/fluidnc/fluidnc-read-only-settings';
import type { ControllerKind } from '../../../core/devices';

export const FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX = 'FluidNC line-length boundary:';
export const FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX = 'FluidNC read-only settings:';
export const FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX = 'FluidNC identity mismatch:';

export type FluidncDivergenceInput = {
  readonly configured: ControllerKind;
  readonly active: ControllerKind;
  readonly detected: ControllerKind | null;
  /** The exact prepared program, so the count matches what would stream. */
  readonly gcode: string;
};

/**
 * Builds non-blocking FluidNC evidence disclosures for one prepared job.
 * @param input Controller identities for this Start plus the exact prepared program.
 * @returns Job Review warning strings, job-specific first; empty for non-FluidNC targets.
 */
export function detectFluidncDivergenceWarnings(
  input: FluidncDivergenceInput,
): ReadonlyArray<string> {
  if (!targetsFluidnc(input)) return [];
  return [...lineBoundaryWarnings(input), ...settingWarnings(input)];
}

function targetsFluidnc(input: FluidncDivergenceInput): boolean {
  return (
    input.configured === 'fluidnc' || input.active === 'fluidnc' || input.detected === 'fluidnc'
  );
}

function lineBoundaryWarnings(input: FluidncDivergenceInput): ReadonlyArray<string> {
  if (input.active !== 'fluidnc' && input.detected !== 'fluidnc') return [];
  const nonExecutable = findFluidncNonExecutableLines(input.gcode);
  const first = nonExecutable[0];
  if (first === undefined) return [];
  const longest = nonExecutable.reduce((worst, line) =>
    line.length > worst.length ? line : worst,
  );
  return [
    `${FLUIDNC_LINE_BOUNDARY_WARNING_PREFIX} ${nonExecutable.length} ordinary G-code line(s) ` +
      `exceed FluidNC's ${FLUIDNC_GCODE_MAX_PAYLOAD_BYTES}-byte parser limit ` +
      `(first: line ${first.lineNumber} at ${first.length} characters; ` +
      `longest: line ${longest.lineNumber} at ${longest.length} characters). ` +
      `FluidNC returns error:14 for ordinary G-code above that parser limit. Its direct Lineedit ` +
      `collector can retain up to ${FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS} printable characters, ` +
      'but that does not raise executable G-code capacity. CurveDesk does not shorten, split, or ' +
      'drop the prepared line.',
  ];
}

function settingWarnings(input: FluidncDivergenceInput): ReadonlyArray<string> {
  if (input.active === 'fluidnc') return [activeFluidncSettingWarning()];
  if (input.detected === 'fluidnc') return [detectedFluidncMismatchWarning(input.active)];
  return [configuredFluidncSettingWarning(input.active)];
}

function activeFluidncSettingWarning(): string {
  return (
    `${FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX} FluidNC exposes ${settingList()} as read-only ` +
    'mirrors of its YAML configuration. A write such as $32=1 answers ' +
    `error:${FLUIDNC_READ_ONLY_SETTING_ERROR_CODE} (ReadOnlySetting) and changes nothing, so the ` +
    '$30/$32 remedy named in the laser-mode acknowledgement cannot be applied from CurveDesk. ' +
    'Set laser mode and max spindle speed in the FluidNC YAML config, then re-read the controller. ' +
    'With FluidNC active, CurveDesk does not send numeric $ setting writes.'
  );
}

function detectedFluidncMismatchWarning(active: ControllerKind): string {
  return (
    `${FLUIDNC_IDENTITY_MISMATCH_WARNING_PREFIX} The connected banner looks like FluidNC, but the ` +
    `active ${active} driver remains authoritative and CurveDesk does not switch it automatically. ` +
    'Numeric $ setting-write behavior therefore follows the active driver; verify the selected ' +
    'controller profile before sending a setting command.'
  );
}

function configuredFluidncSettingWarning(active: ControllerKind): string {
  return (
    `${FLUIDNC_READ_ONLY_SETTING_WARNING_PREFIX} The configured profile is FluidNC, but the active ` +
    `${active} driver owns this session. Numeric $ setting-write behavior follows the active driver; ` +
    'verify the selected controller profile before sending a setting command.'
  );
}

function settingList(): string {
  const ids = [...FLUIDNC_READ_ONLY_SETTING_IDS].sort((a, b) => a - b).map((id) => `$${id}`);
  const last = ids[ids.length - 1];
  return last === undefined ? '' : `${ids.slice(0, -1).join(', ')} and ${last}`;
}
