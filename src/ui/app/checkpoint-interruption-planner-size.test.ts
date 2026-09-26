// OR-3 (2026-09-25 controller audit; incomplete fix of ADR-362 item 8): after
// a stop that discards the planner, the automatic laser restart must not start
// after moves the stop threw away, even when no status report showed a `Bf`
// backlog. Adapted from the audit's reproduction test.
//
// Upstream:
//  - GRBL 1.1h defaults.h:50 `DEFAULT_STATUS_REPORT_MASK 1 // MPos enabled`;
//    report.c:531-537 prints `|Bf:` only with status mask bit 1; planner.h:31
//    BLOCK_BUFFER_SIZE 16 (15 usable, planner.c:500); main.c:94 `plan_reset()`
//    after every soft reset.
//  - FluidNC v4.0.3 SettingsDefinitions.cpp:101 defaults `$10` to 1 and
//    Report.cpp:512-513 prints `|Bf:` only with the Buffer bit;
//    Machine/MachineConfig.h:98 planner_blocks 16.
//  - Smoothieware 38e2cc08: the status string (Kernel.cpp:177-334) has no buffer
//    field; Conveyor.cpp:77 planner_queue_size 32; ^X (Abort's soft reset)
//    halts and flushes the queue (USBSerial.cpp:204-206, Conveyor.cpp:89-96).
//  - Marlin 2.1.2.8: M114 is polled only while idle, so no report comes
//    mid-job; BLOCK_BUFFER_SIZE 16 (Configuration_adv.h:2393-2399), one kept
//    free (planner.h:765); Abort's M410 drops them all (planner.cpp:1688-1689).

import { describe, expect, it } from 'vitest';
import { createStreamer, parseStatusReport } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices';
import type { JobInterruption } from '../../core/recovery';
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
import { statusBufferPatch } from '../state/laser-rx-capacity-evidence';
import { checkpointInterruption, currentRunPlannerBacklog } from './checkpoint-interruption';

// Raw lines 1-5 are setup; 6..45 are forty burn moves; then M5.
const PROGRAM = [
  'G21',
  'G90',
  'G54',
  'G94',
  'M4 S0',
  ...Array.from({ length: 40 }, (_, i) => `G1 X${i + 1} Y0${i === 0 ? ' F1200 S500' : ''}`),
  'M5',
].join('\n');

type EvidenceState = Parameters<typeof statusBufferPatch>[0];

/** The laser state while a job streams, after `completed` acknowledgements. */
function streaming(completed: number, activeControllerKind: ControllerKind) {
  return {
    streamer: { ...createStreamer(PROGRAM), status: 'streaming' as const, completed },
    pendingUntrackedAcks: 0,
    controllerSessionEpoch: 1,
    rxCapacityEvidence: null,
    // No report carries Bf, so no idle planner capacity was ever learned.
    plannerCapacityEvidence: null,
    streamerEpoch: 1,
    streamPlannerSnapshot: null,
    activeControllerKind,
  };
}

/** The recorded Abort, as use-job-checkpoint writes it, and its restart line.
 *  A null status line is a controller that sent no status report mid-job. */
function abortRestart(
  state: ReturnType<typeof streaming>,
  statusLine: string | null,
  acked: number,
): number {
  const live = statusLine === null ? state : withStatusReport(state, statusLine);
  const interruption = checkpointInterruption(
    'cancelled',
    null,
    { reason: 'operator', streamerEpoch: 1 },
    currentRunPlannerBacklog(live),
  );
  return automaticRestart(PROGRAM, acked, interruption ?? undefined).line;
}

function withStatusReport(state: ReturnType<typeof streaming>, statusLine: string) {
  const report = parseStatusReport(statusLine);
  if (report === null) throw new Error('status report did not parse');
  return { ...state, ...statusBufferPatch(state as unknown as EvidenceState, report, 0) };
}

describe('OR-3: an Abort restart steps back over the planner without a Bf backlog', () => {
  it('stock GRBL ($10=1, no Bf): steps back the 15-block planner', () => {
    // 5 setup lines + 30 moves acknowledged; the soft reset discarded up to 15
    // of those moves, so the earliest that may not have run is raw 6 + 15 = 21.
    const line = abortRestart(
      streaming(35, 'grbl-v1.1'),
      '<Run|MPos:12.000,0.000,0.000|FS:1200,500>',
      35,
    );
    expect(line).toBeLessThanOrEqual(21);
    expect(line).toBe(21);
  });

  it('stock FluidNC ($10=1, no Bf): steps back its default 15-block planner', () => {
    const line = abortRestart(
      streaming(35, 'fluidnc'),
      '<Run|MPos:12.000,0.000,0.000|FS:1200,500>',
      35,
    );
    expect(line).toBe(21);
  });

  it('Smoothieware (no buffer field at all): steps back its 32-block queue', () => {
    // 5 setup lines + 37 moves acknowledged (raw 6..42): raw 6 + (37 - 32) = 11.
    const line = abortRestart(
      streaming(42, 'smoothieware'),
      '<Run|MPos:36.0000,0.0000,0.0000|WPos:36.0000,0.0000,0.0000|F:1200.0,1200.0,100.0|L:0.4000|S:0.5000>',
      42,
    );
    expect(line).toBeLessThanOrEqual(6 + 37 - 32);
  });

  it('Marlin (no status report mid-job): steps back the 15 blocks its M410 quick stop drops', () => {
    // Marlin answers a G1 once it is in the planner, and Abort's M410 drops
    // every planned move (planner.cpp:1688-1689). 5 setup lines + 30 moves
    // acknowledged: raw 6 + (30 - 15) = 21.
    expect(abortRestart(streaming(35, 'marlin'), null, 35)).toBe(21);
  });

  it('a last report with an empty planner still steps back over moves acknowledged after it', () => {
    const backlog = currentRunPlannerBacklog({
      streamerEpoch: 1,
      // 5 setup lines + 15 moves acknowledged when the report showed Bf equal
      // to the idle capacity (nothing queued, e.g. the stream had just caught up).
      streamPlannerSnapshot: { streamerEpoch: 1, sessionEpoch: 1, ackedLines: 20, queuedBlocks: 0 },
    });
    const aborted: JobInterruption = {
      kind: 'cancelled',
      message: 'Stopped by the operator (Abort).',
      ...(backlog === undefined ? {} : { plannerBacklog: backlog }),
    };
    // 15 more moves were acknowledged (35 lines) before the Abort; none of them
    // is proven to have run. First move acknowledged after the report: raw 21.
    expect(automaticRestart(PROGRAM, 35, aborted).line).toBe(21);
  });
});
