// Allocation-light scans over a whole program. Frame readiness, Job Review and
// Start each ask "is there a sendable line?" and "is any sendable line wider
// than the RX window?" of a program that can be 400k lines / 9 MB. Answering
// through splitLines built four arrays and about three strings per line on the
// main thread every time; these walk the string once and allocate only for a
// line long enough to matter. Both keep splitLines' exact definition of a
// sendable line (trimmed, non-empty, not a ';' comment) and of its byte count
// (trimmed length plus the '\n' the streamer appends).

import {
  MAX_LINE_CODE_UNIT,
  wireEncodingError,
  type WireEncodingError,
} from '../serial-wire-encoding';

// String.prototype.trim strips exactly the characters \s matches.
const TRIM_WHITESPACE = /\s/;

function isTrimWhitespace(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  if (code === 32 || (code >= 9 && code <= 13)) return true;
  if (code < 128) return false;
  return TRIM_WHITESPACE.test(text.charAt(index));
}

/** Index of the first character of [start, end) that trim() would keep, or end. */
function firstKept(text: string, start: number, end: number): number {
  let index = start;
  while (index < end && isTrimWhitespace(text, index)) index += 1;
  return index;
}

function visitSendableLines(gcode: string, visit: (first: number, end: number) => boolean): void {
  let start = 0;
  while (start <= gcode.length) {
    const newline = gcode.indexOf('\n', start);
    const end = newline === -1 ? gcode.length : newline;
    const first = firstKept(gcode, start, end);
    if (first < end && gcode.charCodeAt(first) !== 59 /* ; */ && visit(first, end)) return;
    start = end + 1;
  }
}

/** Index after the last character of [first, end) that trim() would keep. */
function lastKept(text: string, first: number, end: number): number {
  let index = end;
  while (index > first && isTrimWhitespace(text, index - 1)) index -= 1;
  return index;
}

export function countSendableGcodeLines(gcode: string): number {
  let count = 0;
  visitSendableLines(gcode, () => {
    count += 1;
    return false;
  });
  return count;
}

/** The streamer's queue as counts: its lines and their streamed bytes. */
export function measureSendableLines(gcode: string): {
  readonly lines: number;
  readonly bytes: number;
} {
  let lines = 0;
  let bytes = 0;
  visitSendableLines(gcode, (first, end) => {
    lines += 1;
    bytes += lastKept(gcode, first, end) - first + 1;
    return false;
  });
  return { lines, bytes };
}

/** The widest raw sendable line (first kept character to its end, plus the
 * '\n'). findFirstSendableLineOver finds nothing for any limit at or above it,
 * because it measures only lines wider than the limit. */
export function longestSendableLineSpan(gcode: string): number {
  let longest = 0;
  visitSendableLines(gcode, (first, end) => {
    if (end - first + 1 > longest) longest = end - first + 1;
    return false;
  });
  return longest;
}

export function hasSendableGcodeLine(gcode: string): boolean {
  let found = false;
  visitSendableLines(gcode, () => {
    found = true;
    return true;
  });
  return found;
}

export interface OversizedSendableLine {
  /** 1-based index among the sendable lines. */
  readonly lineNumber: number;
  readonly bytes: number;
}

/** The first sendable line whose streamed size exceeds `limit` bytes, if any. */
export function findFirstSendableLineOver(
  gcode: string,
  limit: number,
): OversizedSendableLine | null {
  let lineNumber = 0;
  let oversized: OversizedSendableLine | null = null;
  visitSendableLines(gcode, (first, end) => {
    lineNumber += 1;
    // Trimming can only shorten a line, so only a raw line that could still
    // exceed the limit is measured exactly.
    if (end - first + 1 <= limit) return false;
    const bytes = gcode.slice(first, end).trim().length + 1;
    if (bytes <= limit) return false;
    oversized = { lineNumber, bytes };
    return true;
  });
  return oversized;
}

export interface UnencodableSendableLine {
  /** 1-based index among the sendable lines. */
  readonly lineNumber: number;
  readonly error: WireEncodingError;
}

/** The first sendable line the serial wire cannot carry as a queued line, if any. */
export function findFirstUnencodableSendableLine(gcode: string): UnencodableSendableLine | null {
  let lineNumber = 0;
  let unencodable: UnencodableSendableLine | null = null;
  visitSendableLines(gcode, (first, end) => {
    lineNumber += 1;
    for (let index = first; index < end; index += 1) {
      if (gcode.charCodeAt(index) <= MAX_LINE_CODE_UNIT) continue;
      // Only the trimmed text the streamer sends is measured exactly.
      const error = wireEncodingError(`${gcode.slice(first, end).trim()}\n`);
      if (error === null) return false;
      unencodable = { lineNumber, error };
      return true;
    }
    return false;
  });
  return unencodable;
}

export function unencodableLineMessage(line: UnencodableSendableLine): string {
  return `G-code line ${line.lineNumber}: ${line.error.message}`;
}
