// normalize-external-program — turns an opened G-code file into the exact
// bytes an external run streams (ADR-630). Each line is put in the form stock
// GRBL itself reads: comments, spaces, tabs and the '/' block-delete mark are
// removed, as GRBL discards them while collecting a line, so the review parses
// the same words the controller runs (`G 1 X1 0 0` is `G1X100`). Other control
// characters GRBL discards the same way (a DOS end-of-file Ctrl-Z, a form
// feed) go too. '%' tape markers and blank lines are dropped, and one baseline
// line goes first, setting every mode the review reads the program in that the
// controller keeps between programs (`G17G21G90G94G0` on GRBL), so a plane,
// unit, distance, feed or motion mode left by the Console or an earlier
// program cannot change what was framed.
//
// Refusals are factual (what the controller would act on, or cannot take as a
// job line) with two policy refusals. A `$` controller command: GRBL runs
// those only while Idle (error:8 otherwise), and the Frame cannot trace what
// they move, so they belong in the Console (ADR-630 Amendment 1). And a line
// the controller hands to its shell, its files or a program stored on it
// (storage-command-check.ts, ADR-630 Amendment 5).
//
// GRBL treats '?', '!', '~', Ctrl-X and every byte above 0x7F as realtime
// commands before a line is collected, even inside a comment, and throws away
// every other byte at or below a space, and '/':
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L150-L156
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L113-L148
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands
// grblHAL also takes Ctrl-C, Ctrl-T after ESC and Ctrl-Y as commands, and
// backspace or DEL as a line edit; DEL is text to stock GRBL. Those stay
// refused. grblHAL offers other control bytes to plugins before dropping
// them; KerfDesk sends none of them:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/grbl.h
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L291-L328

import type { ControllerKind } from '../devices';
import { controllerBlockRejection } from './controller-block-check';
import { storageCommandRefusal } from './storage-command-check';

export type ExternalProgram = {
  /** The parser used for this executable; absent on legacy GRBL callers. */
  readonly controllerKind?: ControllerKind;
  /** One line per sent line, each ending in '\n', the baseline first. */
  readonly gcode: string;
  /** The baseline line sent first (externalProgramBaseline). */
  readonly baseline: string;
  readonly lineCount: number;
  readonly byteCount: number;
  /** Source lines dropped because they held only a comment, '%' or nothing. */
  readonly droppedLineCount: number;
  readonly commentsRemoved: boolean;
};

export type ExternalProgramResult =
  | { readonly kind: 'ok'; readonly program: ExternalProgram }
  | { readonly kind: 'refused'; readonly reasons: ReadonlyArray<string> };

/**
 * The modes the review parses from, on a GRBL-family controller: XY plane,
 * millimetres, absolute distance, feed per minute and rapid motion. GRBL keeps
 * all five between programs, and a bare axis line moves in the kept motion
 * mode, so a G2/G3 or G19 left behind would bend a path the review read as
 * straight.
 */
export const EXTERNAL_PROGRAM_BASELINE = 'G17G21G90G94G0';

/**
 * Smoothieware's laser power scale. Laser.cpp burns every G1-G3 at
 * S x scale, `M221 S` sets the scale in percent and only a reboot resets it
 * to 100; M120/M121 do not save it. The Frame, a jog and Home send `M221 S0`
 * (SMOOTHIE_FRAME_TOOL_OFF_LINES), as does the end of KerfDesk's own job, so a
 * program that sets its power only with S would burn nothing, while the review
 * reads it at the power-up scale (ADR-630 Amendment 3).
 * https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/tools/laser/Laser.cpp
 */
const SMOOTHIE_BASELINE_POWER_SCALE = 'M221 S100';

/**
 * The baseline a controller accepts. Marlin stops a job at a command its
 * build lacks (G94 always, G17 without CNC_WORKSPACE_PLANES). Its units and
 * distance commands must be separate lines; optional motion/plane behavior
 * is disclosed by the Marlin reader. Smoothieware has no G94, and keeps its
 * laser power scale between programs.
 */
export function externalProgramBaseline(kind: ControllerKind): string {
  if (kind === 'grbl-v1.1' || kind === 'grblhal' || kind === 'fluidnc') {
    return EXTERNAL_PROGRAM_BASELINE;
  }
  return kind === 'smoothieware' ? `G17G21G90G0\n${SMOOTHIE_BASELINE_POWER_SCALE}` : 'G21\nG90';
}

/** The baseline's words with what each sets, for the Run review. */
export const BASELINE_WORD_MEANINGS: Readonly<Record<string, string>> = {
  G17: 'XY plane',
  G21: 'millimetres',
  G90: 'absolute moves',
  G94: 'feed per minute',
  G0: 'rapid motion',
  M221: 'full laser power scale',
};

/** The refusals listed before "and more", so a bad file stays readable. */
const MAX_REASONS = 5;
const REALTIME_CHARS = new Set(['?', '!', '~']);
/** Ctrl-C, backspace, Ctrl-T, Ctrl-X, Ctrl-Y, ESC and DEL (see above). */
const ACTED_ON_CONTROL_CODES: ReadonlySet<number> = new Set([
  0x03, 0x08, 0x14, 0x18, 0x19, 0x1b, 0x7f,
]);
const SPACE = 0x20;
const NUL_REASON = 'The file holds a NUL byte, so it is not a text G-code program.';

export type ExternalProgramNormalizer = {
  /** One source line, without its line terminator. */
  readonly push: (raw: string) => void;
  readonly finish: () => ExternalProgramResult;
};

/** Line-at-a-time normalization, so a large file can be fed in chunks. */
export function createExternalProgramNormalizer(
  baseline: string = externalProgramBaseline('grbl-v1.1'),
  controllerKind?: ControllerKind,
): ExternalProgramNormalizer {
  if (baseline === EXTERNAL_PROGRAM_BASELINE && controllerKind !== undefined) {
    baseline = externalProgramBaseline(controllerKind);
  }
  // Retain compatibility with callers supplying externalProgramBaseline(kind).
  const dialect = controllerKind ?? baselineKind(baseline);
  const marlin = dialect === 'marlin';
  const reasons: string[] = [];
  const lines: string[] = baseline.split('\n');
  const baselineLines = lines.length;
  let lineNumber = 0;
  let droppedLineCount = 0;
  let commentsRemoved = false;
  let sawNul = false;
  return {
    push: (raw) => {
      lineNumber += 1;
      if (raw.includes('\0')) {
        sawNul = true;
        return;
      }
      const stripped = stripComments(raw);
      if (stripped !== raw) commentsRemoved = true;
      const reason = characterRefusal(stripped, lineNumber);
      if (reason !== null) reasons.push(reason);
      // Marlin parses the first command, then its parameters. Whitespace
      // terminates a number there: X1 0 0 must not be rewritten as X100.
      const line = marlin ? stripped.trim() : canonicalLine(stripped);
      if (line.trim() === '' || line.trim() === '%') {
        droppedLineCount += 1;
        return;
      }
      if (reason === null) {
        const lineRefusal = lineRefusalOf(marlin ? line.trimStart() : line, lineNumber, dialect);
        if (lineRefusal !== null) reasons.push(lineRefusal);
      }
      lines.push(line);
    },
    finish: () => {
      if (sawNul) return refused([NUL_REASON]);
      if (reasons.length > 0) return refused(summarize(reasons));
      if (lines.length === baselineLines) return refused(['The file has no G-code line to send.']);
      const gcode = lines.map((line) => `${line}\n`).join('');
      return {
        kind: 'ok',
        program: {
          gcode,
          baseline,
          ...(controllerKind === undefined
            ? marlin
              ? { controllerKind: 'marlin' as const }
              : {}
            : { controllerKind }),
          lineCount: lines.length,
          byteCount: gcode.length,
          droppedLineCount,
          commentsRemoved,
        },
      };
    },
  };
}

export function normalizeExternalProgram(
  text: string,
  baseline: string = EXTERNAL_PROGRAM_BASELINE,
  controllerKind?: ControllerKind,
): ExternalProgramResult {
  const normalizer = createExternalProgramNormalizer(baseline, controllerKind);
  for (const line of sourceLines(text)) normalizer.push(line);
  return normalizer.finish();
}

/** The file's lines split on CR, LF or CRLF, without building one big array.
 * A final line terminator ends the last line; it is not a blank line. */
export function* sourceLines(text: string): Generator<string> {
  let start = 0;
  while (start < text.length) {
    let end = start;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end += 1;
    yield text.slice(start, end);
    if (text[end] === '\r' && text[end + 1] === '\n') end += 1;
    start = end + 1;
  }
}

/** Removes '(...)' and ';' comments. An unclosed '(' runs to the line end. */
export function stripComments(line: string): string {
  let kept = '';
  let inParen = false;
  for (const char of line) {
    if (inParen) {
      if (char === ')') inParen = false;
      continue;
    }
    if (char === '(') {
      inParen = true;
      continue;
    }
    if (char === ';') break;
    kept += char;
  }
  return kept;
}

/** The line as stock GRBL collects it: spaces, tabs, the other control
 * characters it discards, and '/' are left out. */
export function canonicalLine(line: string): string {
  let kept = '';
  for (const char of line) {
    if (char === '/' || isDiscardedControl(char.charCodeAt(0))) continue;
    kept += char;
  }
  return kept;
}

/** A byte at or below a space that GRBL throws away and none acts on. */
function isDiscardedControl(code: number): boolean {
  return code <= SPACE && !ACTED_ON_CONTROL_CODES.has(code);
}

function characterRefusal(line: string, lineNumber: number): string | null {
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (REALTIME_CHARS.has(char)) {
      return `Line ${lineNumber} holds "${char}", which the controller takes as a realtime command, not part of the line.`;
    }
    if (ACTED_ON_CONTROL_CODES.has(code) || code > 0x7f) {
      return `Line ${lineNumber} holds a control or non-ASCII character (code ${code}), which the controller would act on or refuse.`;
    }
  }
  return null;
}

/** The controller kind a legacy caller's baseline names, if it names one. */
function baselineKind(baseline: string): ControllerKind | undefined {
  if (baseline === externalProgramBaseline('marlin')) return 'marlin';
  return baseline === externalProgramBaseline('smoothieware') ? 'smoothieware' : undefined;
}

// Policy refusals, recorded as such in ADR-630 Amendments 1 and 5.
// A '$' line, or FluidNC's bracket form of one ('[J]' and '[Jog]' run as
// '$J=', fluidnc-line-limit.ts), is a controller command, and a shell, file
// or stored-program command runs what the file does not hold; any other line
// the controller rejects as a block would leave the framed outline wrong.
function lineRefusalOf(
  line: string,
  lineNumber: number,
  dialect: ControllerKind | undefined,
): string | null {
  const marlin = dialect === 'marlin';
  if (line.startsWith('$')) return controllerCommand(line, lineNumber, '$');
  if (line.startsWith('[')) return controllerCommand(line, lineNumber, 'bracket');
  const storage = storageCommandRefusal(line, dialect);
  if (storage !== null) {
    return `Line ${lineNumber} (${preview(line)}) ${storage}. KerfDesk does not send shell, file or stored-program commands inside a job: the Frame cannot trace what they run. Remove it from the program.`;
  }
  // Marlin queue.cpp requires line sequence/checksum handling for every
  // leading N line. The ordinary sender implements neither resend protocol.
  // https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L438-L470
  if (marlin && line.startsWith('N')) {
    return `Line ${lineNumber} (${preview(line)}) uses Marlin's numbered checksum protocol. KerfDesk streams unnumbered lines, so save the program without line numbers and checksums.`;
  }
  // Marlin's line-number checksum framing (`N1 G1 X10*42`): GRBL rejects the
  // '*', and normalizing the line breaks the checksum Marlin would verify.
  if (line.includes('*')) {
    return `Line ${lineNumber} (${preview(line)}) carries a checksum (*), framing for a line protocol KerfDesk does not stream. GRBL rejects the line and Marlin would ask for it again, so save the program without checksums.`;
  }
  const rejected = marlin ? null : controllerBlockRejection(line);
  if (rejected === null) return null;
  return `Line ${lineNumber} (${preview(line)}) is one the controller rejects whole: ${rejected}. The Frame would trace it as if it ran, so fix it in the program.`;
}

function controllerCommand(line: string, lineNumber: number, form: '$' | 'bracket'): string {
  const kind =
    form === '$'
      ? 'a $ controller command'
      : 'a bracket controller command, which FluidNC runs as a $ command and stock GRBL rejects';
  return `Line ${lineNumber} is ${kind} (${preview(line)}). KerfDesk does not send those inside a job: the controller runs them only while Idle, and the Frame cannot trace what they move. Send it from the Console instead.`;
}

function preview(line: string): string {
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

function summarize(reasons: ReadonlyArray<string>): ReadonlyArray<string> {
  if (reasons.length <= MAX_REASONS) return reasons;
  const more = reasons.length - MAX_REASONS;
  return [
    ...reasons.slice(0, MAX_REASONS),
    `…and ${more} more line${more === 1 ? '' : 's'} like these.`,
  ];
}

function refused(reasons: ReadonlyArray<string>): ExternalProgramResult {
  return { kind: 'refused', reasons };
}
