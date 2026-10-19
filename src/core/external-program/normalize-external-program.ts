// normalize-external-program — turns an opened G-code file into the exact
// bytes an external run streams (ADR-630). Comments, '%' tape markers, blank
// lines and ASCII spaces/tabs around each line are removed; nothing else changes.
// Refusals are factual only: what the controller cannot take as a job line.
//
// GRBL treats '?', '!', '~' and every byte above 0x7F as realtime commands
// before a line is collected, even inside a comment, and runs '$' commands only
// while Idle (error:8 otherwise):
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L150-L156
// https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands

export type ExternalProgram = {
  /** One line per sent line, each ending in '\n'. */
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

/** The refusals listed before "and more", so a bad file stays readable. */
const MAX_REASONS = 5;
const REALTIME_CHARS = new Set(['?', '!', '~']);

export function normalizeExternalProgram(text: string): ExternalProgramResult {
  if (text.includes('\0')) {
    return refused(['The file holds a NUL byte, so it is not a text G-code program.']);
  }
  const reasons: string[] = [];
  const lines: string[] = [];
  let droppedLineCount = 0;
  let commentsRemoved = false;
  const sourceLines = text.split(/\r\n|\r|\n/);
  // A final line terminator ends the last source line; it is not a blank line.
  if (sourceLines.at(-1) === '') sourceLines.pop();
  sourceLines.forEach((raw, index) => {
    const stripped = stripComments(raw);
    if (stripped !== raw) commentsRemoved = true;
    // Other whitespace is controller input, not permitted normalization.
    // Leave it present so validation cannot silently erase invalid bytes.
    const line = stripped.replace(/^[ \t]+|[ \t]+$/g, '');
    if (line === '' || line === '%') {
      droppedLineCount += 1;
      return;
    }
    const reason = lineRefusal(line, index + 1);
    if (reason !== null) reasons.push(reason);
    lines.push(line);
  });
  if (reasons.length > 0) return refused(summarize(reasons));
  if (lines.length === 0) return refused(['The file has no G-code line to send.']);
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

function lineRefusal(line: string, lineNumber: number): string | null {
  if (line.startsWith('$')) {
    return `Line ${lineNumber} is a $ controller command (${preview(line)}). The controller runs those only while Idle, so send it from the Console instead.`;
  }
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (REALTIME_CHARS.has(char)) {
      return `Line ${lineNumber} holds "${char}", which the controller takes as a realtime command, not part of the line.`;
    }
    if ((code < 0x20 && char !== '\t') || code >= 0x7f) {
      return `Line ${lineNumber} holds a control or non-ASCII character (code ${code}), which the controller would act on or refuse.`;
    }
  }
  return null;
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
