// Physical/setup impact of an operator-entered console command. Console
// commands bypass the guided Home/Origin/Probe actions, so the store must know
// which cached evidence becomes stale immediately after the bytes are written.

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
const TOOL_COMMAND_RE = /(?:G(?:43\.1|49)|M0?6|T\d+)(?=$|[^0-9.])/;
const ACCESSORY_COMMAND_RE = /M0?[345789](?=$|[^0-9.])/;
const MOTION_COMMAND_RE = /G(?:0|1|2|3|38\.[2345])(?=$|[^0-9.])/;
const DWELL_COMMAND_RE = /G4(?=$|[^0-9.])/;

/** Classify the G/M-code vocabulary shared by GRBL, Marlin, and Smoothieware. */
export function commonConsoleStateEffect(input: string): ConsoleStateEffect {
  const code = stripGcodeComments(input).toUpperCase();
  if (TOOL_COMMAND_RE.test(code)) return 'tool';
  if (!COORDINATE_COMMAND_RE.test(code)) {
    if (MOTION_COMMAND_RE.test(code)) return 'machine-state';
    if (hasAccessoryCommand(code)) return 'accessories';
    if (DWELL_COMMAND_RE.test(code)) return 'non-positional';
    return 'machine-state';
  }
  if (FULL_COORDINATE_COMMAND_RE.test(code)) return 'coordinates-all';

  const changesXy = /[XY][+-]?(?:\d|\.)/.test(code);
  const changesZ = /Z[+-]?(?:\d|\.)/.test(code);
  if (changesXy && !changesZ) return 'coordinates-xy';
  if (changesZ && !changesXy) return 'coordinates-z';
  return 'coordinates-all';
}

/** Return whether uncommented G-code contains a spindle, laser, or coolant command. */
export function hasAccessoryCommand(input: string): boolean {
  return ACCESSORY_COMMAND_RE.test(stripGcodeComments(input).toUpperCase());
}

function stripGcodeComments(input: string): string {
  return input.replace(/\([^)]*\)/g, ' ').split(';', 1)[0] ?? '';
}
