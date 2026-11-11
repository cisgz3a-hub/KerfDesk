# Pro loop v3 — C4 Pause, resume, abort

- **When:** 2026-11-08   **Tree:** `devin/pro-loop-v3`
- **Scope:** `src/core/controllers/grbl/streamer.ts` (pause, resume, rewind, alarm), the simulator's
  `!`, `~`, soft-reset and door handling (`grbl-sim-machine.ts`)
- **Lenses run:** L2 (GRBL source), L7 (what the simulator can and cannot prove).
- **Counts:** 1 raised → P3 1 (test fixture fidelity; no app output is wrong).

## Verified

- The streamer sends nothing while paused, keeps a held tail's acks without promoting to done,
  completes on resume, rewinds to an acknowledged line on the same program, and wipes all in-flight
  accounting on an alarm (`streamer.test.ts`, 7 cases).
- The simulator: `!` → `Hold:0`, `~` → `Run`; a Safety Door stops the spindle (`FS:0,0`) and `~`
  resumes; a soft reset during motion raises `ALARM:3` and `$X` unlocks; a soft reset in a completed
  hold raises no alarm (`grbl-simulator.test.ts`).

### C4-P3-1 — The simulator keeps the laser on through a feed hold; GRBL turns it off

- **Where:** `src/__fixtures__/controllers/grbl-sim-machine.ts:250-252`: `!` sets `machine: 'Hold'`
  and nothing else. The Door case at `:297` sets `spindle: 0`.
- **Anchor:** Ground truth. gnea/grbl @ `bfb67f0c7963` `config.h:587`
  `#define DISABLE_LASER_DURING_HOLD // Default enabled.` and `protocol.c:536-540`: in laser mode a
  hold raises `EXEC_SPINDLE_OVR_STOP`, so the laser stops with the motion. On resume GRBL restores
  the programmed power as motion restarts.
- **Scenario:** any test that pauses a burn on the simulator and reads the beam state sees it lit
  during the hold, which real GRBL 1.1 with `$32=1` never shows. The app's own K1 / ADR-676 tests
  (C2) measure stalls, not holds, so no shipped conclusion rests on this; but a future "pause leaves
  the beam off" test would pass or fail for the wrong reason.
- **Evidence:** SOURCE (above) and READ.
- **Fix direction:** on `!` in laser mode (`$32=1`) set `spindle: 0` and `FS:…,0` while held, and
  restore the block's power on `~` when the machine returns to `Run`; keep the spindle running on a
  hold when `$32=0`, as GRBL does for a router.

## Not verified

Pause and resume through the real transport against the simulator end to end (the UI flow); the
streamer and simulator were checked separately.
