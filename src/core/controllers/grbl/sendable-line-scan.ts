// Allocation-light scans over a whole program. Frame readiness, Job Review and
// Start each ask "is there a sendable line?" and "is any sendable line wider
// than the RX window?" of a program that can be 400k lines / 9 MB. Answering
// through splitLines built four arrays and about three strings per line on the
// main thread every time; these walk the string once and allocate only for a
// line long enough to matter. Both keep splitLines' exact definition of a
// sendable line (trimmed, non-empty, not a ';' comment) and of its byte count
// (trimmed length plus the '\n' the streamer appends).

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
