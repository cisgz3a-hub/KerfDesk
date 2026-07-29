// FluidNC v4.0.3 has two relevant direct-serial text boundaries. Channel
// retention happens before G-code parsing, so its 254-character collector is
// not executable G-code capacity.
//
// Current Web Serial sends one byte for every accepted JavaScript code unit.
// This model is deliberately limited to that current ASCII-safe emitted path;
// high-byte policy remains an approval-dependent follow-up.

/** Maximum G-code-parser payload bytes FluidNC accepts before `error:14`. */
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
  /** Whether the G-code-parser payload is accepted or returns `error:14`. */
  readonly parserResult: 'accepted' | 'error:14';
};

/**
 * Reports program lines routed beyond FluidNC's executable G-code-parser boundary.
 * @param gcode Emitted program text, newline separated.
 * @returns One entry per ASCII-safe line that FluidNC rejects as `error:14`.
 */
export function findFluidncNonExecutableLines(gcode: string): ReadonlyArray<FluidncLineBoundary> {
  return gcode
    .split('\n')
    .map((rawLine, index) => ({ lineNumber: index + 1, line: rawLine.trim() }))
    .filter((candidate) => isSendableGcodeLine(candidate.line))
    .map((candidate) => ({
      lineNumber: candidate.lineNumber,
      length: executableParserPayloadLength(candidate.line),
    }))
    .filter(
      (candidate): candidate is { readonly lineNumber: number; readonly length: number } =>
        candidate.length !== null,
    )
    .map((candidate) => fluidncLineBoundary(candidate.lineNumber, candidate.length))
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

// Pinned FluidNC ProcessSettings routes settings commands before G-code parsing.
// Jog forms are the exception: their case-insensitive J/Jog key and value are
// reconstructed as `$J=` plus the value before entering the G-code parser.
function executableParserPayloadLength(line: string): number | null {
  const settingsParts = parseSettingsCommand(line);
  if (settingsParts !== null) {
    const normalizedKey = settingsParts.key.toLowerCase();
    const isJog = normalizedKey === 'j' || normalizedKey === 'jog';
    if (!isJog || settingsParts.value.length === 0) return null;
    return '$J='.length + settingsParts.value.length;
  }
  return payloadLength(line);
}

function parseSettingsCommand(
  line: string,
): { readonly key: string; readonly value: string } | null {
  if (line.startsWith('$')) {
    const separator = line.indexOf('=');
    if (separator < 0) return { key: line.slice(1).trim(), value: '' };
    return { key: line.slice(1, separator).trim(), value: line.slice(separator + 1) };
  }
  if (line.startsWith('[')) {
    const separator = line.indexOf(']');
    if (separator < 0) return { key: line.slice(1).trim(), value: '' };
    return { key: line.slice(1, separator).trim(), value: line.slice(separator + 1) };
  }
  return null;
}
import { isSendableGcodeLine } from '../grbl/streamer';
