// Physical/setup impact of an operator-entered console command. Console
// commands bypass the guided Home/Origin/Probe actions, so the store must know
// which cached evidence becomes stale immediately after the bytes are written.

import { scanGcodeWords, stripControllerComments } from '../gcode/word-scan';

export type ConsoleStateEffect =
  | 'read-only'
  | 'machine-state'
  | 'accessories'
  | 'non-positional'
  | 'coordinates-xy'
  | 'coordinates-z'
  | 'coordinates-all'
  | 'tool'
  | 'reference'
  | 'configuration'
  | 'configuration-nonpositional';

const COORDINATE_COMMAND_RE = /G(?:10(?:\.0+)?|5[4-9](?:\.[123])?|92(?:\.[123])?)(?=$|[^0-9.])/;
const FULL_COORDINATE_COMMAND_RE = /G(?:5[4-9](?:\.[123])?|92\.[123])(?=$|[^0-9.])/;
// GRBL accepts fractional T values and truncates them to a tool number. They
// still invalidate the same tool-reference evidence as integer selections.
const TOOL_COMMAND_RE = /(?:G(?:43\.1|49)|M0?6|T\d+(?:\.\d+)?)(?=$|[^0-9.])/;
const ACCESSORY_COMMAND_RE = /M0?[345789](?=$|[^0-9.])/;
const MOTION_COMMAND_RE = /G(?:0|1|2|3|38\.[2345])(?=$|[^0-9.])/;
const DWELL_COMMAND_RE = /G4(?=$|[^0-9.])/;

/** Classify the G/M-code vocabulary shared by GRBL, Marlin, and Smoothieware. */
export function commonConsoleStateEffect(input: string): ConsoleStateEffect {
  const code = canonicalEffectWords(input);
  const changesTool = TOOL_COMMAND_RE.test(code);
  if (!COORDINATE_COMMAND_RE.test(code)) {
    if (changesTool) return 'tool';
    if (MOTION_COMMAND_RE.test(code)) return 'machine-state';
    if (hasAccessoryCommand(code)) return 'accessories';
    if (DWELL_COMMAND_RE.test(code)) return 'non-positional';
    return 'machine-state';
  }
  if (FULL_COORDINATE_COMMAND_RE.test(code)) return 'coordinates-all';

  const changesXy = /[XY][+-]?(?:\d|\.)/.test(code);
  // A block can change both XY offsets and tool identity/length. Its effect
  // must include both axes rather than letting the tool tag hide XY changes.
  const changesZ = changesTool || /Z[+-]?(?:\d|\.)/.test(code);
  if (changesXy && !changesZ) return 'coordinates-xy';
  if (changesZ && !changesXy) return 'coordinates-z';
  return 'coordinates-all';
}

/** Return whether uncommented G-code contains a spindle, laser, or coolant command. */
export function hasAccessoryCommand(input: string): boolean {
  return ACCESSORY_COMMAND_RE.test(canonicalEffectWords(input));
}

function canonicalEffectWords(input: string): string {
  // This only classifies evidence; it never rewrites bytes sent to firmware.
  // GRBL ignores horizontal whitespace, accepts padded/signed numeric words,
  // and rounds command fractions to hundredths (gcode.c, gc_execute_line).
  // Use that tolerance conservatively for G/M effects across the shared lane.
  return scanConsoleWords(input)
    .map(({ letter, value }) => {
      const commandValue = letter === 'G' || letter === 'M' ? Math.round(value * 100) / 100 : value;
      return `${letter}${commandValue}`;
    })
    .join(' ');
}

/** Numeric words as written, excluding comments and ignored horizontal blanks. */
export function scanConsoleWords(input: string): ReturnType<typeof scanGcodeWords> {
  return scanGcodeWords(stripControllerComments(input).replace(/[ \t]/g, ''));
}
