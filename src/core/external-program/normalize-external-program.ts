// normalize-external-program — turns an opened G-code file into the exact
// bytes an external run streams (ADR-630). Each line is put in the form stock
// GRBL itself reads: comments, spaces, tabs and the '/' block-delete mark are
// removed, as GRBL discards them while collecting a line, so the review parses
// the same words the controller runs (`G 1 X1 0 0` is `G1X100`). Other control
// characters GRBL discards the same way (a DOS end-of-file Ctrl-Z, a form
// feed) go too. '%' tape markers and blank lines are dropped, and one baseline
// line, `G21G90`, goes first, so a millimetre/absolute mode left by an earlier
// program cannot change what was framed.
//
// Refusals are factual (what the controller would act on, or cannot take as a
// job line) with one policy refusal the maintainer kept: a `$` controller
// command. GRBL runs those only while Idle (error:8 otherwise), and the Frame
// cannot trace what they move, so they belong in the Console (ADR-630
// Amendment 1).
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

export type ExternalProgram = {
  /** One line per sent line, each ending in '\n', the baseline first. */
  readonly gcode: string;
  readonly lineCount: number;
  readonly byteCount: number;
  /** Source lines dropped because they held only a comment, '%' or nothing. */
  readonly droppedLineCount: number;
  readonly commentsRemoved: boolean;
};

export type ExternalProgramResult =
  | { readonly kind: 'ok'; readonly program: ExternalProgram }
  | { readonly kind: 'refused'; readonly reasons: ReadonlyArray<string> };

/** Millimetres and absolute distance, the modes the review parses from. */
export const EXTERNAL_PROGRAM_BASELINE = 'G21G90';

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
export function createExternalProgramNormalizer(): ExternalProgramNormalizer {
  const reasons: string[] = [];
  const lines: string[] = [EXTERNAL_PROGRAM_BASELINE];
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
      const line = canonicalLine(stripped);
      if (line === '' || line === '%') {
        droppedLineCount += 1;
        return;
      }
      if (reason === null && line.startsWith('$'))
        reasons.push(controllerCommand(line, lineNumber));
      lines.push(line);
    },
    finish: () => {
      if (sawNul) return refused([NUL_REASON]);
      if (reasons.length > 0) return refused(summarize(reasons));
      if (lines.length === 1) return refused(['The file has no G-code line to send.']);
      const gcode = lines.map((line) => `${line}\n`).join('');
      return {
        kind: 'ok',
        program: {
          gcode,
          lineCount: lines.length,
          byteCount: gcode.length,
          droppedLineCount,
          commentsRemoved,
        },
      };
    },
  };
}

export function normalizeExternalProgram(text: string): ExternalProgramResult {
  const normalizer = createExternalProgramNormalizer();
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

// A policy refusal, recorded as one in ADR-630 Amendment 1.
function controllerCommand(line: string, lineNumber: number): string {
  return `Line ${lineNumber} is a $ controller command (${preview(line)}). KerfDesk does not send those inside a job: the controller runs them only while Idle, and the Frame cannot trace what they move. Send it from the Console instead.`;
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
