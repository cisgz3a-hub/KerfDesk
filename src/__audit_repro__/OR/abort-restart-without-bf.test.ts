// Audit track OR, finding OR-3 (repro; expected to FAIL on current code).
// Incomplete fix of ADR-362 item 8 (controller audit recovery-6).
//
// Correct behaviour: after an Abort (soft reset) on stock GRBL 1.1h, the
// automatic laser restart must not start after moves the reset threw away.
// When the status reports carry no `Bf:` field, the backlog is unknown, and the
// restart should step back over the controller's whole planner (15 blocks on
// stock GRBL, also reported by `$I` as `[OPT:...,15,128]`) instead of starting
// at the first unacknowledged line.
//
// Upstream proof (gnea/grbl 1.1h, bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e):
//  - defaults.h:50 `#define DEFAULT_STATUS_REPORT_MASK 1 // MPos enabled`;
//    report.c:531-537 prints `|Bf:` only when status_report_mask bit 1 is set
//    (settings.h:53). The wiki (Grbl-v1.1-Configuration, $10) says buffer data
//    "should be disabled by default" and the default is `$10=1`.
//  - planner.h:31 BLOCK_BUFFER_SIZE 16; planner.c:500 leaves 15 usable blocks;
//    motion_control.c:57-62 queues each motion line before its `ok`.
//  - main.c:94 `plan_reset(); // Clear block buffer and planner variables`
//    runs after every soft reset, discarding every acknowledged, unexecuted move.
// KerfDesk: laser-rx-capacity-evidence.ts:95 and :165-166 take no planner
// snapshot without `Bf:`; checkpoint-interruption.ts:56-63 then records no
// backlog; automatic-restart-line.ts:74-80 keeps the acknowledgement frontier.
// The simulator's own default settings table has `[10, '1']`
// (src/__fixtures__/controllers/grbl-sim-settings.ts:12).
//
// The same gap on other stock controllers (added 2026-09-25, second session):
//  - FluidNC v4.0.3 (25ae119b) SettingsDefinitions.cpp:101
//    `new IntSetting("What to include in status report", GRBL, WG, "10",
//    "Report/Status", 1, 0, 3)` defaults `$10` to 1, and Report.cpp:512-513
//    prints `|Bf:` only with the Buffer bit, so stock FluidNC reports no Bf
//    either (planner_blocks default 16, Machine/MachineConfig.h:98).
//  - Smoothieware edge (38e2cc08) never reports a buffer field: the status
//    string built in Kernel.cpp:177-334 has no buffer field (MPos/WPos/F/L/S,
//    temperatures outside grbl_mode). Its `ok` is
//    printed after ON_GCODE_RECEIVED returns (GcodeDispatch.cpp:383 then
//    :404-421), and a G1 only returns once Conveyor::queue_head_block() has
//    room (Conveyor.cpp:159-163) in a queue of planner_queue_size blocks,
//    default 32 (Conveyor.cpp:77). KerfDesk's Abort sends ^X
//    (smoothieware/driver.ts realtime.softReset), which Smoothie turns into
//    ON_HALT (USBSerial.cpp:204-206, :304-306), and Conveyor::on_halt flushes
//    the queue (Conveyor.cpp:89-96). Up to 32 acknowledged moves are discarded
//    and the automatic restart still starts after them.

import { describe, expect, it } from 'vitest';
import { automaticRestart } from '../../core/recovery/automatic-restart-line';
import type { JobInterruption } from '../../core/recovery';
import { currentRunPlannerBacklog } from '../../ui/app/checkpoint-interruption';
import { statusBufferPatch } from '../../ui/state/laser-rx-capacity-evidence';
import { createStreamer, parseStatusReport } from '../../core/controllers/grbl';

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
const STOCK_GRBL_PLANNER_BLOCKS = 15;
// Smoothieware Conveyor.cpp:77 planner_queue_size default.
const SMOOTHIE_DEFAULT_QUEUE_BLOCKS = 32;

describe('OR-3: Abort restart on stock GRBL ($10=1, no Bf) steps back over the planner', () => {
  it('a stock status report (no Bf) yields no backlog, and the restart skips queued moves', () => {
    // What stock GRBL 1.1h prints with $10=1 while streaming.
    const report = parseStatusReport('<Run|MPos:12.000,0.000,0.000|FS:1200,500>');
    if (report === null) throw new Error('status report did not parse');
    const patch = statusBufferPatch(
      {
        // An active stream with 35 lines acknowledged.
        streamer: { ...createStreamer(PROGRAM), status: 'streaming', completed: 35 },
        pendingUntrackedAcks: 0,
        controllerSessionEpoch: 1,
        rxCapacityEvidence: null,
        // Even an idle-capacity reading could not exist: no report carries Bf.
        plannerCapacityEvidence: null,
        streamerEpoch: 1,
        streamPlannerSnapshot: null,
      } as unknown as Parameters<typeof statusBufferPatch>[0],
      report,
      0,
    );
    expect(patch.streamPlannerSnapshot).toBeUndefined();
    const backlog = currentRunPlannerBacklog({
      streamerEpoch: 1,
      streamPlannerSnapshot: patch.streamPlannerSnapshot ?? null,
    });
    const aborted: JobInterruption = {
      kind: 'cancelled',
      message: 'Stopped by the operator (Abort).',
      ...(backlog === undefined ? {} : { plannerBacklog: backlog }),
    };
    // 5 setup lines + 30 moves acknowledged; the soft reset discarded up to
    // 15 of those moves, so the earliest move that may not have run is the
    // 16th-from-last acknowledged move: raw 6 + (30 - 15) = raw 21.
    const acked = 35;
    const restart = automaticRestart(PROGRAM, acked, aborted);
    expect(restart.line).toBeLessThanOrEqual(6 + 30 - STOCK_GRBL_PLANNER_BLOCKS);
  });

  // Added 2026-09-25 (second session). checkpoint-interruption.ts:62
  // (`if (snapshot.queuedBlocks === 0) return undefined;`) treats a report that
  // showed an empty planner as "no backlog". But lines acknowledged AFTER that
  // report were queued into the planner (motion_control.c:60-68 queues a line
  // before its `ok`) and the reset discards them (main.c:94), so the restart
  // must start no later than the first move acknowledged after the report.
  it('a last report with an empty planner still steps back over moves acknowledged after it', () => {
    const backlog = currentRunPlannerBacklog({
      streamerEpoch: 1,
      // 5 setup lines + 15 moves acknowledged when the report showed Bf = idle
      // capacity (nothing queued, e.g. the stream had just caught up).
      streamPlannerSnapshot: { streamerEpoch: 1, sessionEpoch: 1, ackedLines: 20, queuedBlocks: 0 },
    });
    const aborted: JobInterruption = {
      kind: 'cancelled',
      message: 'Stopped by the operator (Abort).',
      ...(backlog === undefined ? {} : { plannerBacklog: backlog }),
    };
    // 15 more moves were acknowledged (35 lines) before the Abort; none of them
    // is proven to have run. First move acknowledged after the report: raw 21.
    const restart = automaticRestart(PROGRAM, 35, aborted);
    expect(restart.line).toBeLessThanOrEqual(21);
  });

  it('Smoothieware (no Bf field at all): an Abort restart skips the moves ^X flushed', () => {
    // What Smoothieware edge prints while running (Kernel.cpp:177-334).
    const report = parseStatusReport(
      '<Run|MPos:36.0000,0.0000,0.0000|WPos:36.0000,0.0000,0.0000|F:1200.0,1200.0,100.0|L:0.4000|S:0.5000>',
    );
    if (report === null) throw new Error('status report did not parse');
    expect(report.buffer ?? null).toBeNull();
    const patch = statusBufferPatch(
      {
        streamer: { ...createStreamer(PROGRAM), status: 'streaming', completed: 42 },
        pendingUntrackedAcks: 0,
        controllerSessionEpoch: 1,
        rxCapacityEvidence: null,
        plannerCapacityEvidence: null,
        streamerEpoch: 1,
        streamPlannerSnapshot: null,
      } as unknown as Parameters<typeof statusBufferPatch>[0],
      report,
      0,
    );
    const backlog = currentRunPlannerBacklog({
      streamerEpoch: 1,
      streamPlannerSnapshot: patch.streamPlannerSnapshot ?? null,
    });
    expect(backlog).toBeUndefined();
    const aborted: JobInterruption = {
      kind: 'cancelled',
      message: 'Stopped by the operator (Abort).',
    };
    // 5 setup lines + 37 moves acknowledged (raw 6..42). With a 32-block
    // conveyor queue the earliest move that may not have run is raw 6 + (37 - 32).
    const restart = automaticRestart(PROGRAM, 42, aborted);
    expect(restart.line).toBeLessThanOrEqual(6 + 37 - SMOOTHIE_DEFAULT_QUEUE_BLOCKS);
  });
});
