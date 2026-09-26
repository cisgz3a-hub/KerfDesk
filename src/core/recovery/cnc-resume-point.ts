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
//
// A tool-change M0 caps that rewind. The stream only moves past it after
// Continue, which waits for the drained planner and a fresh Idle, and firmware
// that is sent the M0 itself (GRBL, Marlin) synchronizes its planner before
// acknowledging it. Everything before an acknowledged M0 has therefore run,
// and rewinding across it would preselect the previous bit's pass while the
// next bit is in the spindle (controller audit cnc-controller-2).

import { isSendableGcodeLine } from '../controllers/grbl';
import { isToolChangeLine } from '../controllers/grbl/streamer';
import type { ControllerKind } from '../devices';
import type { GrblStreamingMode } from '../grbl-streaming';
import type { CncPassSpan } from '../output';
import { countSendableLines, rawResumeLine } from './job-checkpoint';

// Upper bounds on acked-but-unexecuted lines, in sendable lines. A line is
// acknowledged once it is queued, not once it has moved: GRBL's mc_line waits
// for planner room and then queues the block (motion_control.c:57-68), and the
// `ok` follows gc_execute_line (protocol.c:104). So every line still waiting
// in the planner, plus the blocks whose steps sit in the step-segment buffer,
// can be acknowledged and unexecuted when the job stops (controller audit
// OR-2). A pass counts as proven only below that bound.
type PlannerReserve = {
  /** No planner size recorded: the firmware's largest planner plus its
   *  largest step-segment buffer. */
  readonly unmeasured: number;
  /** Floor under a recorded planner size: the historical conservative margin. */
  readonly floor: number;
  /** Step-segment buffer added to a recorded planner size. */
  readonly segmentLag: number;
};

export const CNC_RESUME_PLANNER_RESERVES: Readonly<Record<ControllerKind, PlannerReserve>> = {
  // BLOCK_BUFFER_SIZE 16, 15 usable (grbl planner.h:31, planner.c:500), and
  // SEGMENT_BUFFER_SIZE 6 (stepper.h:26), with a margin.
  'grbl-v1.1': { unmeasured: 32, floor: 32, segmentLag: 6 },
  // `$398` "Planner buffer blocks" accepts 30..1000 (grblHAL settings.c:2485),
  // all of them usable (planner.c:697-702); SEGMENT_BUFFER_SIZE 10 (config.h:392).
  grblhal: { unmeasured: 1010, floor: 256, segmentLag: 10 },
  // `planner_blocks` accepts 10..120 (FluidNC v4.0.3 MachineConfig.cpp:89) and
  // `stepping/segments` 6..20 (Stepping.cpp:216).
  fluidnc: { unmeasured: 140, floor: 64, segmentLag: 20 },
  // Not CNC targets (cncJobs false); Ruida is never streamed. Placeholders.
  marlin: { unmeasured: 64, floor: 64, segmentLag: 0 },
  smoothieware: { unmeasured: 64, floor: 64, segmentLag: 0 },
  ruida: { unmeasured: 256, floor: 256, segmentLag: 0 },
};

/** Sendable lines to rewind from the acknowledged count: the recorded planner
 *  size of the run's controller when there is one, never below the floor;
 *  otherwise the firmware's largest planner. */
export function cncResumePlannerReserveLines(
  controllerKind: ControllerKind,
  plannerBlocks: number | undefined,
): number {
  const reserve = CNC_RESUME_PLANNER_RESERVES[controllerKind];
  if (plannerBlocks === undefined || !Number.isFinite(plannerBlocks) || plannerBlocks <= 0) {
    return reserve.unmeasured;
  }
  return Math.max(reserve.floor, Math.ceil(plannerBlocks) + reserve.segmentLag);
}

export type CncResumePointArgs = {
  readonly gcode: string;
  /** Acked SENDABLE lines from the checkpoint (streamer numbering). */
  readonly ackedLines: number;
  readonly spans: ReadonlyArray<CncPassSpan>;
  readonly controllerKind: ControllerKind;
  readonly streamingMode: GrblStreamingMode;
  readonly rxBufferBytes: number;
  /** Usable planner blocks the run's controller reported (idle `Bf`, `$I`). */
  readonly plannerBlocks?: number | undefined;
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
  const reserve = cncResumePlannerReserveLines(args.controllerKind, args.plannerBlocks);
  const proven = Math.max(0, acked - reserve, lastAcknowledgedToolChange(args.gcode, acked));
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

// The sendable ordinal of the last tool-change M0 within the acknowledged
// lines, or 0. The streamer counts a held M0 complete only when Continue runs.
function lastAcknowledgedToolChange(gcode: string, acked: number): number {
  let sendable = 0;
  let last = 0;
  for (const line of gcode.split('\n')) {
    if (!isSendableGcodeLine(line)) continue;
    sendable += 1;
    if (sendable > acked) break;
    if (isToolChangeLine(line)) last = sendable;
  }
  return last;
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
