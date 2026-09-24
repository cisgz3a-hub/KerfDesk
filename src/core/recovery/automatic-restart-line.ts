// The raw line an automatic laser recovery restarts from (ADR-341 Amendment 3).
//
// Normally that is the first line after the acknowledged count, exactly as
// rawResumeLine() maps it. A controller answers a line it rejects with error:N,
// and the stream counts that answer as an acknowledgement although the
// controller discarded the line, so the plain rule silently skipped the
// rejected burn. For a controller-error interruption the restart is the
// rejected line itself, found by its exact streamed text at or just before the
// acknowledged count.

import { isSendableGcodeLine } from '../controllers/grbl';
import type { JobInterruption } from './job-interruption';
import { plannerFrontierRawLine } from './planner-backlog-restart';

// Answers that can follow the rejected one before the stop takes effect: the
// controller keeps parsing its receive buffer until the reset byte arrives.
// A grblHAL receive buffer of 1024 bytes holds fewer than 256 short lines.
const REJECTED_LINE_SEARCH_WINDOW = 256;

export type AutomaticRestart = {
  /** 1-based raw line number of the first replayed line. */
  readonly line: number;
  /** True when the restart replays the line the controller rejected. */
  readonly replaysRejectedLine: boolean;
  /** Planner blocks the stop discarded, when the restart steps back over them
   *  (planner-backlog-restart.ts). */
  readonly plannerBacklogBlocks?: number;
};

type RestartScan = {
  sendable: number;
  lastSendableRaw: number;
  nextRaw: number;
  rejectedRaw: number;
  rejectedSendable: number;
};

/** One forward pass over `\n`-separated lines, the numbering the resume
 * builder uses, without materializing every line of a large program. */
export function automaticRestart(
  gcode: string,
  ackedSendableLines: number,
  interruption: JobInterruption | undefined,
): AutomaticRestart {
  const rejectedText =
    interruption?.kind === 'controller-error' ? interruption.rejectedLine?.trim() : undefined;
  const target = rejectedText === '' ? undefined : rejectedText;
  const scan: RestartScan = {
    sendable: 0,
    lastSendableRaw: 0,
    nextRaw: 0,
    rejectedRaw: 0,
    rejectedSendable: 0,
  };
  let rawNumber = 0;
  let start = 0;
  while (start <= gcode.length && scan.nextRaw === 0) {
    const newline = gcode.indexOf('\n', start);
    const end = newline === -1 ? gcode.length : newline;
    rawNumber += 1;
    visitLine(scan, gcode.slice(start, end), rawNumber, ackedSendableLines, target);
    if (newline === -1) break;
    start = newline + 1;
  }
  return withPlannerBacklog(gcode, restartFrom(scan, ackedSendableLines), interruption);
}

// A stop that discarded the planner also discarded moves acknowledged before
// the restart line; step back over them when that is earlier.
function withPlannerBacklog(
  gcode: string,
  restart: AutomaticRestart,
  interruption: JobInterruption | undefined,
): AutomaticRestart {
  const backlog = interruption?.plannerBacklog;
  if (backlog === undefined) return restart;
  const frontier = plannerFrontierRawLine(gcode, backlog);
  if (frontier === null || frontier >= restart.line) return restart;
  return { ...restart, line: frontier, plannerBacklogBlocks: backlog.queuedBlocks };
}

function visitLine(
  scan: RestartScan,
  raw: string,
  rawNumber: number,
  ackedSendableLines: number,
  rejectedText: string | undefined,
): void {
  if (!isSendableGcodeLine(raw)) return;
  scan.sendable += 1;
  scan.lastSendableRaw = rawNumber;
  if (scan.sendable > ackedSendableLines) {
    scan.nextRaw = rawNumber;
    return;
  }
  if (rejectedText !== undefined && raw.trim() === rejectedText) {
    scan.rejectedRaw = rawNumber;
    scan.rejectedSendable = scan.sendable;
  }
}

function restartFrom(scan: RestartScan, ackedSendableLines: number): AutomaticRestart {
  const rejectedInWindow =
    scan.rejectedRaw > 0 &&
    ackedSendableLines - scan.rejectedSendable < REJECTED_LINE_SEARCH_WINDOW;
  if (rejectedInWindow) return { line: scan.rejectedRaw, replaysRejectedLine: true };
  // rawResumeLine(): the first unacknowledged sendable line, else the last
  // sendable line, else line 1.
  if (scan.nextRaw !== 0) return { line: scan.nextRaw, replaysRejectedLine: false };
  return { line: Math.max(1, scan.lastSendableRaw), replaysRejectedLine: false };
}
