// line-buffer-limit — the longest line stock GRBL and grblHAL will parse
// (controller audit S-3, ADR-375).
//
// The RX window (findOversizedLine) bounds what the host may have in flight.
// The parser's line buffer bounds one collected line, and it is smaller than
// most windows. A line longer than that buffer is answered error:11 (overflow)
// at its end and never runs, so a job holding one stops there.
//
// Stock GRBL 1.1 stores only significant characters. It drops every byte at
// or below a space, ignores '/', skips '(...)' and ';' comments, and keeps 79
// (LINE_BUFFER_SIZE 80 less the terminator):
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.h#L31-L32
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L113-L148
// with the error reported at the end of the line (protocol.c#L90-L92).
//
// grblHAL drops only control characters and leading whitespace, so inner
// spaces and comments count, and keeps 256 (LINE_BUFFER_SIZE 257):
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.h#L35-L36
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L291-L328
// with the error reported at the end of the line (protocol.c#L245-L246).
//
// Stock GRBL takes '?', '!', '~' and every byte above 0x7F as realtime
// commands before a line is collected (serial.c#L150-L156), and grblHAL drops
// most of them there too (protocol.c#L993-L1016). None of them is counted, and
// a carriage return ends a line on both, so a count can only err low: a line
// reported here really overflows a stock build. Both sizes are compile-time
// defaults, and no report names another, so the stock size stands.

import type { ControllerKind } from '../../devices';
import { isSendableGcodeLine } from './streamer';

/** Characters stock GRBL 1.1 keeps for one line. */
export const GRBL_LINE_BUFFER_CHARS = 79;
/** Characters grblHAL keeps for one line. */
export const GRBLHAL_LINE_BUFFER_CHARS = 256;

type LineBufferFirmware = Extract<ControllerKind, 'grbl-v1.1' | 'grblhal'>;

export type LineBufferOverflow = {
  readonly firmware: LineBufferFirmware;
  /** 1-based line number within the emitted program. */
  readonly lineNumber: number;
  /** Characters the firmware would store for the line, as sent. */
  readonly storedChars: number;
  readonly limit: number;
};

const SPACE = 0x20;
const DELETE = 0x7f;
const REALTIME_TEXT_CHARS = '?!~';
// grblHAL takes a backspace or DEL as an edit that also clears the overflow
// flag (protocol.c#L88-L92 and #L319-L325), so whether a line holding one
// overflows depends on where the edit lands. Such a line is never reported.
const GRBLHAL_LINE_EDIT = /[\b\x7f]/;

/**
 * The first sendable line the controller's line buffer cannot hold, or null.
 * Only stock GRBL and grblHAL are described; any other controller gets null.
 */
export function findLineBufferOverflow(
  gcode: string,
  controllerKind: ControllerKind | undefined,
): LineBufferOverflow | null {
  if (controllerKind !== 'grbl-v1.1' && controllerKind !== 'grblhal') return null;
  const limit = controllerKind === 'grblhal' ? GRBLHAL_LINE_BUFFER_CHARS : GRBL_LINE_BUFFER_CHARS;
  // One pass without splitting, like sendable-line-scan.ts: a program can be
  // 400k lines. No line stores more characters than it has, so only a line
  // longer than the limit needs a count.
  let lineNumber = 0;
  let start = 0;
  while (start <= gcode.length) {
    lineNumber += 1;
    const newline = gcode.indexOf('\n', start);
    const end = newline === -1 ? gcode.length : newline;
    if (end - start > limit) {
      const storedChars = sentLineChars(gcode.slice(start, end), controllerKind);
      if (storedChars > limit) return { firmware: controllerKind, lineNumber, storedChars, limit };
    }
    start = end + 1;
  }
  return null;
}

/** The overflow in operator words; the caller adds what it did not do. */
export function lineBufferOverflowMessage(overflow: LineBufferOverflow): string {
  const { firmware, lineNumber, storedChars, limit } = overflow;
  return firmware === 'grblhal'
    ? `G-code line ${lineNumber} has ${storedChars} characters — grblHAL accepts at most ${limit} per line before error:11.`
    : `G-code line ${lineNumber} has ${storedChars} significant characters — stock GRBL accepts at most ${limit} per line (spaces and comments do not count) before error:11.`;
}

// The streamer sends a sendable line trimmed, then a newline. A carriage
// return left inside it ends a line on either firmware, so each part counts
// on its own.
function sentLineChars(rawLine: string, firmware: LineBufferFirmware): number {
  const line = rawLine.trim();
  if (!isSendableGcodeLine(line)) return 0;
  return line.split('\r').reduce((most, part) => Math.max(most, storedCharsFor(part, firmware)), 0);
}

function storedCharsFor(line: string, firmware: LineBufferFirmware): number {
  if (firmware === 'grbl-v1.1') return grblStoredChars(line);
  return GRBLHAL_LINE_EDIT.test(line) ? 0 : grblhalStoredChars(line);
}

/** Characters stock GRBL stores for `line`: comments and whitespace are not kept. */
export function grblStoredChars(line: string): number {
  let stored = 0;
  let comment: '(' | ';' | null = null;
  for (const ch of line) {
    if (comment !== null) {
      if (comment === '(' && ch === ')') comment = null;
    } else if (ch === '(' || ch === ';') {
      comment = ch;
    } else if (isGrblStoredChar(ch)) {
      stored += 1;
    }
  }
  return stored;
}

/** Characters grblHAL stores for `line`, comments and inner spaces included.
 * Backspace and DEL are edits to grblHAL, not text, so neither is counted. */
export function grblhalStoredChars(line: string): number {
  let stored = 0;
  for (const ch of line) {
    if (isGrblhalStoredChar(ch, stored)) stored += 1;
  }
  return stored;
}

// DEL is text to stock GRBL: it reaches the line buffer like a letter.
function isGrblStoredChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code > SPACE && code <= DELETE && ch !== '/' && !REALTIME_TEXT_CHARS.includes(ch);
}

function isGrblhalStoredChar(ch: string, stored: number): boolean {
  const code = ch.charCodeAt(0);
  if (code < SPACE || code >= DELETE || REALTIME_TEXT_CHARS.includes(ch)) return false;
  return code !== SPACE || stored > 0;
}
