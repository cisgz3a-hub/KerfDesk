// The executed frontier behind an acknowledgement (controller audit
// recovery-6). GRBL answers `ok` once a line is parsed into its planner, not
// once it has moved, and a streaming job keeps that planner full: up to 15
// blocks on stock GRBL and 512 on a grblHAL build such as the Falcon's. A stop
// that discards the planner (Abort's soft reset, the auto-abort after a
// rejected line, a reboot) throws those parsed moves away, so restarting at
// the first unacknowledged line skipped them: about 25 s of cutting on a
// grblHAL vector job, left unburned by default.
//
// The status report before the stop says how many planner blocks were still
// waiting (`Bf`, against the idle planner size). Stepping back that many
// movement lines from the acknowledgement count at that report gives the
// first line that may not have moved. It is an estimate: an arc becomes
// several blocks, and the machine kept moving between that report and the
// stop, so it errs toward replaying a little that already burned rather than
// skipping what did not.

// Without a status report that shows the backlog, the stop may have discarded
// a whole planner of acknowledged moves, so the restart steps back by the
// controller's planner size (controller audit OR-3). `$I` or an idle `Bf`
// gives that size when the session saw one; otherwise these usable-block
// defaults apply:
//  - GRBL 1.1h: BLOCK_BUFFER_SIZE 16, one kept free (planner.h:31, planner.c:500);
//  - grblHAL: `$398` default 100 (config.h:906), all usable (planner.c:697-702);
//  - FluidNC v4.0.3: planner_blocks default 16, one kept free
//    (Machine/MachineConfig.h:98, Planner.cpp:445);
//  - Smoothieware: planner_queue_size default 32 (Conveyor.cpp:77), flushed
//    by the ^X halt Abort sends (Conveyor.cpp:89-96);
//  - Marlin 2.1.2.8: BLOCK_BUFFER_SIZE 16 (Configuration_adv.h:2393-2399), one
//    kept free (planner.h:765), all dropped by the M410 quick stop that Abort
//    sends (planner.cpp:1688-1689; ADR-395).
// Ruida is never streamed.

import { isSendableGcodeLine } from '../controllers/grbl';
import type { ControllerKind } from '../devices';
import type { PlannerBacklog } from './job-interruption';

export const DEFAULT_PLANNER_BLOCKS: Readonly<Partial<Record<ControllerKind, number>>> = {
  'grbl-v1.1': 15,
  grblhal: 100,
  fluidnc: 15,
  smoothieware: 32,
  marlin: 15,
};

const COMMENT = /\([^)]*\)|;.*$/g;
const AXIS_WORD = /[XYZ]\s*[-+]?(?:\d|\.\d)/i;
// These G codes consume axis words without queuing a planner move.
const NON_MOTION_AXIS_USE = /\bG0*(?:10|28\.1|30\.1|92(?:\.\d)?)\b/i;

/** Whether a streamed line queues a planner movement block. */
export function isPlannerMotionLine(line: string): boolean {
  const code = line.replace(COMMENT, '');
  return AXIS_WORD.test(code) && !NON_MOTION_AXIS_USE.test(code);
}

/** 1-based raw line of the first movement that may not have run, or null
 *  when no such movement was acknowledged. */
export function plannerFrontierRawLine(gcode: string, backlog: PlannerBacklog): number | null {
  if (backlog.queuedBlocks <= 0) return firstMoveAfter(gcode, backlog.ackedAtStatus);
  // Raw line numbers of the newest `queuedBlocks` movement lines acknowledged
  // by the status report, kept in a ring.
  const ring = new Array<number>(backlog.queuedBlocks);
  let moves = 0;
  let sendable = 0;
  let rawNumber = 0;
  let start = 0;
  while (start <= gcode.length && sendable < backlog.ackedAtStatus) {
    const newline = gcode.indexOf('\n', start);
    const end = newline === -1 ? gcode.length : newline;
    const raw = gcode.slice(start, end);
    rawNumber += 1;
    if (isSendableGcodeLine(raw)) {
      sendable += 1;
      if (isPlannerMotionLine(raw)) {
        ring[moves % backlog.queuedBlocks] = rawNumber;
        moves += 1;
      }
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  if (moves === 0) return null;
  // Fewer moves than queued blocks: every acknowledged move may still have
  // been waiting, back to the first one.
  return moves < backlog.queuedBlocks
    ? (ring[0] ?? null)
    : (ring[moves % backlog.queuedBlocks] ?? null);
}

// An empty planner at the report: every line acknowledged by then had run, so
// the first movement acknowledged after it is the first that may not have.
function firstMoveAfter(gcode: string, ackedAtStatus: number): number | null {
  let sendable = 0;
  let rawNumber = 0;
  let start = 0;
  while (start <= gcode.length) {
    const newline = gcode.indexOf('\n', start);
    const end = newline === -1 ? gcode.length : newline;
    const raw = gcode.slice(start, end);
    rawNumber += 1;
    if (isSendableGcodeLine(raw)) {
      sendable += 1;
      if (sendable > ackedAtStatus && isPlannerMotionLine(raw)) return rawNumber;
    }
    if (newline === -1) break;
    start = newline + 1;
  }
  return null;
}
