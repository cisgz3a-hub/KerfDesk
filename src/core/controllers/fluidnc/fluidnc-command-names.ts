// FluidNC registers every `$` command under two names, a Grbl name and a long
// name, and runs it for either one, ignoring case (v4.0.3 ProcessSettings.cpp
// make_user_commands(), lines 1012-1085; do_command_or_setting(), lines
// 1100-1101). The Console's safety policy is written against the Grbl names,
// so `$Settings/Restore=#` (FluidNC's `$RST=#`, which resets every G54-G59,
// G28 and G30 offset) and `$Home` (`$H`) passed it as ordinary commands (audit
// HF-6). A long name is therefore translated to its Grbl name before the
// shared classifier sees the line.
// https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/ProcessSettings.cpp#L1012-L1085

import { normalizeConsoleSpaces } from '../console-text';

/** [Grbl name, long name] for each command in the pinned v4.0.3 table. The
 * help command (Grbl name "", long name "Help") is left out: its Grbl form is
 * a bare `$`, which the shared classifier already treats conservatively. */
const FLUIDNC_V403_COMMAND_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['GD', 'GPIO/Dump'],
  ['GI', 'GPIO/Input'],
  ['GO', 'GPIO/Output'],
  ['G+', 'GPIO/On'],
  ['G-', 'GPIO/Off'],
  ['GR', 'GPIO/Read'],
  ['CI', 'Channel/Info'],
  ['CD', 'Config/Dump'],
  ['T', 'State'],
  ['$', 'GrblSettings/List'],
  ['L', 'GrblNames/List'],
  ['Limits', 'Limits/Show'],
  ['S', 'Settings/List'],
  ['SC', 'Settings/ListChanged'],
  ['CMD', 'Commands/List'],
  ['A', 'Alarms/List'],
  ['E', 'Errors/List'],
  ['C', 'GCode/Check'],
  ['X', 'Alarm/Disable'],
  ['NVX', 'Settings/Erase'],
  ['V', 'Settings/Stats'],
  ['#', 'GCode/Offsets'],
  ['MD', 'Motor/Disable'],
  ['ME', 'Motor/Enable'],
  ['MI', 'Motors/Init'],
  ['RM', 'Macros/Run'],
  ['PL', 'Parameters/List'],
  ['H', 'Home'],
  ['HX', 'Home/X'],
  ['HY', 'Home/Y'],
  ['HZ', 'Home/Z'],
  ['HA', 'Home/A'],
  ['HB', 'Home/B'],
  ['HC', 'Home/C'],
  ['HU', 'Home/U'],
  ['HV', 'Home/V'],
  ['HW', 'Home/W'],
  ['MU0', 'Msg/Uart0'],
  ['MU1', 'Msg/Uart1'],
  ['MC', 'Msg/Channel'],
  ['LM', 'Log/Msg'],
  ['LE', 'Log/Error'],
  ['LW', 'Log/Warn'],
  ['LI', 'Log/Info'],
  ['LD', 'Log/Debug'],
  ['LV', 'Log/Verbose'],
  ['SLP', 'System/Sleep'],
  ['I', 'Build/Info'],
  ['RST', 'Settings/Restore'],
  ['SA', 'Alarm/Send'],
  ['Heap', 'Heap/Show'],
  ['SS', 'Startup/Show'],
  ['BS', 'Backtrace/Show'],
  ['CRASH', 'Crash/Test'],
  ['UP', 'Uart/Passthrough'],
  ['RI', 'Report/Interval'],
  ['13', 'Report/Inches'],
  ['GS', 'GRBL/Show'],
  ['J', 'Jog'],
  ['G', 'GCode/Modes'],
];

const GRBL_NAME_BY_LONG_NAME: ReadonlyMap<string, string> = new Map(
  FLUIDNC_V403_COMMAND_NAMES.map(([grbl, long]) => [long.toUpperCase(), grbl]),
);

/**
 * The same line with a FluidNC long command name replaced by its Grbl name
 * (`$Settings/Restore=#` becomes `$RST=#`, `$home/x` becomes `$HX`). The key is
 * compared the way the Console sends it: compacted (the shared classifier
 * strips spaces and tabs before '=') and without case. Anything that is not a
 * long command name comes back unchanged.
 */
export function fluidncGrblCommandForm(input: string): string {
  const parts = splitDollarCommand(input);
  const grblName = parts === null ? undefined : GRBL_NAME_BY_LONG_NAME.get(parts.key.toUpperCase());
  return parts === null || grblName === undefined ? input : `$${grblName}${parts.value}`;
}

/** The compacted, upper-case command key of a `$` line (no `$`, no value). */
export function fluidncCommandKey(line: string): string | null {
  return splitDollarCommand(line)?.key.toUpperCase() ?? null;
}

function splitDollarCommand(
  input: string,
): { readonly key: string; readonly value: string } | null {
  const trimmed = normalizeConsoleSpaces(input).trim();
  if (!trimmed.startsWith('$')) return null;
  const equals = trimmed.indexOf('=');
  const end = equals < 0 ? trimmed.length : equals;
  return {
    key: trimmed.slice(1, end).replaceAll(/[ \t]/g, ''),
    value: trimmed.slice(end),
  };
}
