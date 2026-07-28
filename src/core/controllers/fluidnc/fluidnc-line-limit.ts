// FluidNC v4.0.3 has two relevant direct-serial text boundaries. Channel
// retention happens before G-code parsing, so its 254-character collector is
// not executable G-code capacity.
//
// Current Web Serial sends one byte for every accepted JavaScript code unit.
// This model is deliberately limited to that current ASCII-safe emitted path;
// high-byte policy remains an approval-dependent follow-up.

/** Maximum ordinary G-code payload bytes FluidNC parses before `error:14`. */
export const FLUIDNC_GCODE_MAX_PAYLOAD_BYTES = 127;

/** Maximum ordinary printable payload characters the direct Lineedit retains. */
export const FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS = 254;

/** Compatibility alias for the direct-channel retention boundary. */
export const FLUIDNC_MAX_LINE_CHARS = FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS;

export type FluidncLineBoundary = {
  /** 1-based line number within the emitted program. */
  readonly lineNumber: number;
  /** Current ASCII-safe payload length, excluding a terminal CR. */
  readonly length: number;
  /** The direct collector keeps this many printable payload characters. */
  readonly retainedLength: number;
  /** Whether ordinary G-code reaches the parser or returns `error:14`. */
  readonly parserResult: 'accepted' | 'error:14';
};

/**
 * Reports ordinary G-code lines beyond FluidNC's executable parser boundary.
 * @param gcode Emitted program text, newline separated.
 * @returns One entry per ASCII-safe line that FluidNC rejects as `error:14`.
 */
export function findFluidncNonExecutableLines(gcode: string): ReadonlyArray<FluidncLineBoundary> {
  return gcode
    .split('\n')
    .map((rawLine, index) => ({ lineNumber: index + 1, line: rawLine.trim() }))
    .filter((candidate) => isSendableGcodeLine(candidate.line))
    .map((candidate) => fluidncLineBoundary(candidate.lineNumber, payloadLength(candidate.line)))
    .filter((candidate) => candidate.parserResult === 'error:14');
}

/**
 * Classifies one ASCII-safe ordinary G-code payload against pinned FluidNC limits.
 * @param lineNumber 1-based source line number.
 * @param length Payload bytes excluding a terminator on the current serial path.
 */
export function fluidncLineBoundary(lineNumber: number, length: number): FluidncLineBoundary {
  return {
    lineNumber,
    length,
    retainedLength: Math.min(length, FLUIDNC_LINEEDIT_MAX_RETAINED_CHARS),
    parserResult: length <= FLUIDNC_GCODE_MAX_PAYLOAD_BYTES ? 'accepted' : 'error:14',
  };
}

// A CRLF program leaves a trailing '\r' on each split line. FluidNC completes
// the line on that CR rather than storing it, so it never spends payload budget.
function payloadLength(line: string): number {
  return line.endsWith('\r') ? line.length - 1 : line.length;
}
import { isSendableGcodeLine } from '../grbl/streamer';
