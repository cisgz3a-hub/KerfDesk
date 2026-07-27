// FluidNC silently truncates over-long input lines, so a line KerfDesk emits
// can execute as a different move with no signal at all.
//
// Verified against FluidNC v4.0.3 (released 2026-04-20):
//   Channel.h    `static constexpr int maxLine = 255;` / `char _line[maxLine] = {};`
//   Channel.cpp  Channel::lineComplete() appends a character only while
//                `_linelen < (Channel::maxLine - 1)`; the else branch holds
//                nothing but a commented-out
//                `//  report_status_message(Error::Overflow, this);`
//
// `_linelen` therefore stops at 254: FluidNC keeps the first 254 characters,
// discards every character after them, and returns no error — the overflow
// report that would have signalled it is commented out upstream.
//
// The terminator is NOT part of the budget. lineComplete() completes the line
// on '\r' or '\n' instead of storing it, and KerfDesk streams each line as
// `${line}\n`, so the payload FluidNC measures is exactly the text between
// newlines.

/** Characters FluidNC retains per line; the 255th onward are dropped. */
export const FLUIDNC_MAX_LINE_CHARS = 254;

export type FluidncOverlongLine = {
  /** 1-based line number within the emitted program. */
  readonly lineNumber: number;
  /** Payload characters, excluding the line terminator. */
  readonly length: number;
};

/**
 * Finds the program lines FluidNC would silently truncate.
 * @param gcode Emitted program text, newline separated.
 * @returns One entry per line longer than FluidNC's retained-character budget, in program order.
 */
export function findFluidncOverlongLines(gcode: string): ReadonlyArray<FluidncOverlongLine> {
  return gcode
    .split('\n')
    .map((line, index) => ({ lineNumber: index + 1, length: payloadLength(line) }))
    .filter((candidate) => candidate.length > FLUIDNC_MAX_LINE_CHARS);
}

// A CRLF program leaves a trailing '\r' on each split line. FluidNC completes
// the line on that '\r' rather than storing it, so it never spends budget.
function payloadLength(line: string): number {
  return line.endsWith('\r') ? line.length - 1 : line.length;
}
