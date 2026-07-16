// resolveCncResumePoint (ADR-215) — map the checkpoint's acknowledged-line
// count onto the pass CNC recovery should rewind to, with honest bounds.
//
// An ack proves a line was parsed into the controller's buffers, not that its
// motion physically completed (job-checkpoint.ts). Two corrections bound the
// physical frontier:
//   * Proven (lower) bound: acked minus a per-controller planner reserve —
//     acked lines may still sit unexecuted in the planner when power is lost.
//   * Possible (upper) bound: lines past the last ack that fit the RX buffer
//     can execute unacknowledged after the app dies ('char-counted' keeps the
//     buffer full; 'ping-pong' has at most the one in-flight line).
// The default resume pass contains the first line that is NOT provably
// executed, so rewinding can only recut already-cleared kerf — it can never
// skip uncut material. Both reserves deliberately overestimate: the safe
// failure direction is an earlier boundary and extra recut time.

import { isSendableGcodeLine } from '../controllers/grbl';
import type { ControllerKind } from '../devices';
import type { GrblStreamingMode } from '../grbl-streaming';
import type { CncPassSpan } from '../output';
import { countSendableLines, rawResumeLine } from './job-checkpoint';

// Assumed upper bounds on acked-but-unexecuted lines, in sendable lines.
// These are conservative safety margins (≥2x the firmware family's planner
// block buffer plus stepper-segment prefetch), NOT firmware claims. grblHAL
// planner sizes are driver-configurable and can be large on 32-bit MCUs, so
// its reserve is generous; the operator's "everything before the boundary is
// complete" confirmation remains the load-bearing check on such rigs. Ruida
// is never a CNC target; it gets the most conservative placeholder.
export const CNC_RESUME_PLANNER_RESERVE_LINES: Readonly<Record<ControllerKind, number>> = {
  'grbl-v1.1': 32,
  grblhal: 256,
  fluidnc: 64,
  marlin: 64,
  smoothieware: 64,
  ruida: 256,
};

export type CncResumePointArgs = {
  readonly gcode: string;
  /** Acked SENDABLE lines from the checkpoint (streamer numbering). */
  readonly ackedLines: number;
  readonly spans: ReadonlyArray<CncPassSpan>;
  readonly controllerKind: ControllerKind;
  readonly streamingMode: GrblStreamingMode;
  readonly rxBufferBytes: number;
};

export type CncResumePoint =
  | {
      readonly kind: 'resume-at-pass';
      readonly groupIndex: number;
      readonly passIndex: number;
      /** Spans wholly before the proven frontier (safe for recovery to omit). */
      readonly provenCompletePassCount: number;
      /** First raw line not provably executed (inclusive lower bound). */
      readonly firstUnprovenRawLine: number;
      /** Last raw line that may have executed unacknowledged (upper bound). */
      readonly lastPossiblyExecutedRawLine: number;
    }
  // Every pass line is provably executed; only postamble state is uncertain.
  | { readonly kind: 'after-last-pass' }
  | { readonly kind: 'no-pass-spans' }
  | { readonly kind: 'invalid-spans' };

export function resolveCncResumePoint(args: CncResumePointArgs): CncResumePoint {
  const spans = [...args.spans].sort((a, b) => a.firstRawLine - b.firstRawLine);
  if (spans.length === 0) return { kind: 'no-pass-spans' };
  const rawLines = args.gcode.split('\n');
  if (!spansAreValid(spans, rawLines.length)) return { kind: 'invalid-spans' };

  const sendableTotal = countSendableLines(args.gcode);
  const acked = Math.min(Math.max(Math.floor(args.ackedLines), 0), sendableTotal);
  const reserve = CNC_RESUME_PLANNER_RESERVE_LINES[args.controllerKind];
  const proven = Math.max(0, acked - reserve);
  if (proven >= sendableTotal) return { kind: 'after-last-pass' };

  const firstUnprovenRawLine = rawResumeLine(args.gcode, proven);
  const defaultSpan = spans.find((span) => span.lastRawLine >= firstUnprovenRawLine);
  if (defaultSpan === undefined) return { kind: 'after-last-pass' };
  return {
    kind: 'resume-at-pass',
    groupIndex: defaultSpan.groupIndex,
    passIndex: defaultSpan.passIndex,
    provenCompletePassCount: spans.filter((span) => span.lastRawLine < firstUnprovenRawLine).length,
    firstUnprovenRawLine,
    lastPossiblyExecutedRawLine: lastPossiblyExecutedRawLine(rawLines, args, acked, sendableTotal),
  };
}

// Ascending, non-overlapping, in-range spans — anything else means the sidecar
// does not describe this program, and no mapping may be derived from it.
function spansAreValid(spans: ReadonlyArray<CncPassSpan>, rawLineCount: number): boolean {
  let previousLast = 0;
  for (const span of spans) {
    if (!Number.isInteger(span.firstRawLine) || !Number.isInteger(span.lastRawLine)) return false;
    if (span.firstRawLine <= previousLast) return false;
    if (span.lastRawLine < span.firstRawLine || span.lastRawLine > rawLineCount) return false;
    previousLast = span.lastRawLine;
  }
  return true;
}

// Upper bound on the physical frontier. After the last recorded ack, the
// streamer may already have handed the controller more lines: a full RX
// buffer's worth under 'char-counted', exactly one line under 'ping-pong'.
// Sendable lines are emitted verbatim plus a single '\n' terminator, so
// line.length + 1 is the bytes each occupies in the buffer.
function lastPossiblyExecutedRawLine(
  rawLines: ReadonlyArray<string>,
  args: CncResumePointArgs,
  acked: number,
  sendableTotal: number,
): number {
  const firstUnackedRaw = rawResumeLine(args.gcode, acked);
  if (acked >= sendableTotal || args.streamingMode === 'ping-pong') return firstUnackedRaw;
  let budget = Math.max(0, args.rxBufferBytes);
  let last = firstUnackedRaw;
  for (let raw = firstUnackedRaw; raw <= rawLines.length; raw += 1) {
    const line = rawLines[raw - 1] ?? '';
    if (!isSendableGcodeLine(line)) continue;
    const bytes = line.length + 1;
    if (bytes > budget) break;
    budget -= bytes;
    last = raw;
  }
  return last;
}
