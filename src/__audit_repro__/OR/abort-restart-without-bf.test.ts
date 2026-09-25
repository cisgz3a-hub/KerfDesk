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
});
