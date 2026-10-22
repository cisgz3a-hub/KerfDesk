// storage-command-check — the opened-program lines that reach a controller's
// shell, its files or a program stored on it (ADR-630 Amendment 5). What they
// run is not in the opened file, so the Frame cannot trace it, and some
// rewrite or delete files the controller keeps. An external run refuses them,
// as it refuses a `$` command.
//
// Smoothieware hands a line that starts with a lowercase letter to SimpleShell
// (the Console's rule). GcodeDispatch splits every other line at each G and M,
// so an M-code anywhere on it runs. M1000 passes the rest of the line to the
// shell. M28 writes every later line into an SD-card file until M29. M30 with
// a name deletes a file when grbl_mode is off. M24 and M32 play an SD-card
// file. M374 saves or deletes the levelling grid. M500 and M504 write a
// config-override file, M501 runs one and M502 deletes it.
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/communication/GcodeDispatch.cpp
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/utils/simpleshell/SimpleShell.cpp
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/utils/player/Player.cpp
// https://github.com/Smoothieware/Smoothieware/blob/91fe4286e8ee19f062260abf094b315f9cf6bedf/src/modules/tools/zprobe/CartGridStrategy.cpp
//
// Marlin runs only a line's first command. M28 and M928 write later lines into
// an SD-card file, M30 with a name deletes one, M24 and M32 start an SD print,
// M1000 resumes one after a power loss, M500 saves the settings to EEPROM and
// M997 starts a firmware update.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.cpp
//
// grblHAL runs a macro file from its storage for G65, G66 and M98, and loads
// a named `O<name> call` subroutine from `<name>.macro`.
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/gcode.c
// https://github.com/grblHAL/core/blob/4ec1ae44b857a70d2f9298344feac4b43ed0eb6b/ngc_flowctrl.c
// https://github.com/grblHAL/Plugin_SD_card/blob/d0fe753d622e79a60e54e729ba83f7207276114c/macros.c
//
// grblHAL's and FluidNC's own file commands are `$` or `[ESP…]` lines, which
// the normalizer already refuses, and stock GRBL keeps no files.

import { isSmoothieLowercaseShellLine } from '../controllers/smoothieware/console-command';
import type { ControllerKind } from '../devices';
import { scanGcodeWords } from '../gcode/word-scan';

const SD_UPLOAD = 'writes the lines after it into a file on the SD card instead of running them';
const SD_UPLOAD_END = 'which ends an SD-card upload';
const M30_NAMED = 'is M30 with a file name, which deletes that file from the SD card';

const SMOOTHIE_M_CODES: ReadonlyMap<number, string> = new Map([
  [24, 'which plays a file stored on the SD card'],
  [28, `which ${SD_UPLOAD}`],
  [29, SD_UPLOAD_END],
  [32, 'which plays a file stored on the SD card'],
  [374, 'which saves or deletes the levelling grid file'],
  [500, 'which writes the config-override file'],
  [501, 'which runs the commands in a config-override file'],
  [502, 'which deletes the config-override file'],
  [504, 'which writes a config-override file'],
  [1000, "which passes the rest of the line to Smoothieware's shell"],
]);

const MARLIN_M_CODES: ReadonlyMap<number, string> = new Map([
  [24, 'which starts a print stored on the SD card'],
  [28, `which ${SD_UPLOAD}`],
  [29, SD_UPLOAD_END],
  [32, 'which starts a print stored on the SD card'],
  [500, 'which saves the settings to EEPROM'],
  [928, 'which logs the lines after it into a file on the SD card'],
  [997, 'which starts a firmware update'],
  [1000, 'which resumes a print stored on the SD card'],
]);

/**
 * Why the controller would hand this line, as sent, to its shell, its files or
 * a program stored on it: a clause that follows the line's preview. Null when
 * it would not.
 */
export function storageCommandRefusal(
  line: string,
  kind: ControllerKind | undefined,
): string | null {
  if (kind === 'smoothieware') return smoothieRefusal(line);
  if (kind === 'marlin') return marlinRefusal(line.trimStart());
  if (kind === 'grblhal') return grblHalRefusal(line);
  return null;
}

function smoothieRefusal(line: string): string | null {
  if (isSmoothieLowercaseShellLine(line)) {
    return 'starts with a lowercase letter, so Smoothieware runs it as a shell command, not G-code (G-code letters must be capitals)';
  }
  // Each M with a whole number, as GcodeDispatch splits the line at G and M
  // and Gcode::get_int reads it (strtol: a sign, then digits). The rest of
  // that command, up to the next G or M, is a file name for M30.
  for (const match of line.matchAll(/M([+-]?\d+)(?:\.\d*)?([^GM]*)/g)) {
    const code = Number.parseInt(match[1] ?? '', 10);
    if (code === 30 && match[2] !== '') return M30_NAMED;
    const effect = SMOOTHIE_M_CODES.get(code);
    if (effect !== undefined) return `is M${code}, ${effect}`;
  }
  return null;
}

// Marlin's parser skips spaces, takes the command letter (lowercase too on a
// GCODE_CASE_INSENSITIVE build), its number and an optional subcode, then
// spaces; what follows is M30's file name.
function marlinRefusal(line: string): string | null {
  const match = /^[Mm] *(\d+)(?:\.\d*)? *(.*)$/.exec(line);
  if (match === null) return null;
  const code = Number.parseInt(match[1] ?? '', 10);
  if (code === 30) return match[2] === '' ? null : M30_NAMED;
  const effect = MARLIN_M_CODES.get(code);
  return effect === undefined ? null : `is M${code}, ${effect}`;
}

function grblHalRefusal(line: string): string | null {
  if (/O<[^>]*>CALL/i.test(line)) {
    return 'calls a named subroutine, which grblHAL loads from a .macro file on its storage';
  }
  for (const word of scanGcodeWords(line)) {
    const code = Math.trunc(word.value);
    if (word.letter === 'G' && (code === 65 || code === 66)) {
      return `is G${code}, which runs a macro stored on the controller`;
    }
    if (word.letter === 'M' && code === 98) {
      return 'is M98, which runs a subprogram stored on the controller';
    }
  }
  return null;
}
