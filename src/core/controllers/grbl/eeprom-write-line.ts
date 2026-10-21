// Lines that make a GRBL-family controller write its non-volatile store
// (ADR-644). Stock GRBL disables the serial receive interrupt while it writes
// EEPROM, so bytes arriving during the write can be lost; its interface notes
// say these lines are safe only with send-response streaming. The streamer
// therefore sends such a line alone, with nothing in flight before or after it.
//
// - `$` lines that assign (`$10=`, `$N0=`, `$I=`, `$RST=`), except `$J=`, which
//   is a jog, not a write.
// - G10 (L2/L20 coordinate systems; grblHAL's L1/L10/L11 tool table).
// - G28.1 and G30.1 (stored positions). G28 and G30 only read them.
//
// Words are found with the shared scanner, so `G10L20`, `G 10 L 2` and
// `G010.0` match, and comments are stripped the way GRBL reads them, so
// `G0 X0 ; G10 L2` does not.

import { scanGcodeWords, stripControllerComments } from '../../gcode/word-scan';

export function isEepromWriteLine(line: string): boolean {
  const code = stripControllerComments(line);
  if (code.startsWith('$')) return isAssignment(code);
  for (const word of scanGcodeWords(code)) {
    if (word.letter !== 'G') continue;
    const tenths = Math.round(word.value * 10);
    if (tenths === 100 || tenths === 281 || tenths === 301) return true;
  }
  return false;
}

/** A `$` line that can change what `$$` or `$I` reports (ADR-648): any `$`
 * assignment, and FluidNC's `$NVX` (`$Settings/Erase`), which erases every
 * stored setting with or without a value (see fluidnc/driver.ts). */
export function isStoredSettingWriteLine(line: string): boolean {
  if (!line.includes('$')) return false;
  const code = stripControllerComments(line);
  if (!code.startsWith('$')) return false;
  return isAssignment(code) || /^\$(NVX|Settings\/Erase)(=|$)/i.test(code.replace(/\s+/g, ''));
}

/** A write that can change what `$I` reports: `$I=` sets its build string, and
 * `$RST=` (FluidNC `$Settings/Restore=`) can restore it (ADR-648). GRBL drops
 * whitespace before it parses a line, so `$I =x` and `$RST = *` count too. */
export function isBuildInfoWriteLine(line: string): boolean {
  if (!isStoredSettingWriteLine(line)) return false;
  const compacted = stripControllerComments(line).replace(/\s+/g, '');
  return /^\$(I|RST|Settings\/Restore)=/i.test(compacted);
}

function isAssignment(code: string): boolean {
  return code.includes('=') && !/^\$J=/i.test(code);
}
