# Track MA (Marlin) — final report

Scope: Marlin replies, M114, laser power (`M3 I` inline and fan `M106`), jog and Frame, stream-side
Pause, Abort, post-job settle, Console, and the Marlin parts of resume transform 3 (ADR-364).

- **Upstream:** Marlin 2.1.2.8 (`1cd56c4c`), cited as
  `https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/...`, and bugfix-2.1.x
  (`3b2b9ca6`), cited as `https://github.com/MarlinFirmware/Marlin/blob/3b2b9ca6907dab36943e6850db9a89511f71a84d/Marlin/...`.
- **Configuration:** the stock `Configuration.h` / `Configuration_adv.h`. The laser findings also
  assume `LASER_FEATURE` (commented out in stock, `Configuration_adv.h` L3334) for the inline
  dialect, or a fan output for the fan dialect. Every other option is left at its stock value.
- **Evidence:** code traces, the repo simulators, and `src/__audit_repro__/MA/marlin-fifo-model.ts`.
  That is a small model of Marlin's 4-line command buffer and 16-block planner. It also models
  busy keepalives, `M410` and `LASER_SAFETY_TIMEOUT_MS`, with each rule cited to its upstream line.
  This session added the one-second quickstop cleaning window to its `synchronize()`, because a
  control test showed the old model let `M5 I` run immediately after `M410`. No hardware was used.
- **Repros:** run `cd /home/user/KerfDesk && pnpm vitest run src/__audit_repro__/MA/ma-*.test.ts`.
  Every finding's repro fails on the audited code: 12 files, 22 failing tests. Two tests pass by
  design: MA-2's precondition, and MA-7's control, which shows the model stops within 1 s when it
  gets `M410`. `_explore.test.ts` is leftover scratch and is not part of this report. The test
  files type-check and pass ESLint. ESLint still flags the FIFO model for its function size and
  complexity (`boundaries/no-unknown-files`, `max-lines-per-function`, `complexity`), so restructure
  it before promoting it to a fixture.
- **Baseline:** the existing Marlin tests pass: `resume-program.native*.test.ts`,
  `core/controllers/marlin/`, `marlin-strategy*.test.ts` and `marlin-*raster*.test.ts`
  (7 files, 62 tests).

## Summary

| id | severity | verdict | status | title |
|---|---|---|---|---|
| MA-1 | critical | CONFIRMED | new | Stream-side Pause leaves the laser lit over the stopped head |
| MA-7 | critical | CONFIRMED | new | ABORT JOB / ABORT MOTION does not stop Marlin; `M410` exists and is never sent |
| MA-4 | medium | CONFIRMED | new | Post-job `M400` settle times out after 30 s while Marlin keeps reporting busy |
| MA-9 | medium | CONFIRMED | new | A normal `M5 I` drain is shown as a held controller "reporting Idle", then raises the stream-stalled notice |
| MA-12 | medium | CONFIRMED | new | Marlin's "Unknown command" is accepted as success, so a skipped job line (air assist, laser mode) goes unnoticed |
| MA-3 | medium | CONFIRMED | new | Abort (and Reset origin on stock builds) records "no origin" while Marlin keeps its G92 shift |
| MA-2 | medium (was high) | CONFIRMED | new | After Set origin, User Origin / Current Position / Absolute never resolve on Marlin |
| MA-8 | medium | CONFIRMED | new | Marlin G0 runs at the last G1 feed; KerfDesk times it as a rapid |
| MA-5 | medium | CONFIRMED | new (same class as ADR-361 decision 2) | A comment-only Console line wedges the Marlin session |
| MA-6 | medium | CONFIRMED | new | M114 from a Marlin build without Z is not parsed; the board is reported as not answering |
| MA-10 | low | CONFIRMED (board-reset detail PLAUSIBLE) | new | After M112 or any `kill()`, the guidance says reconnect / wait for Idle; Marlin needs a reset or power cycle |
| MA-11 | low | CONFIRMED | new | The repo's Marlin simulator hides FIFO order, planner limits, busy keepalives and comment handling |

Changes from `MA-partial.md`:

- **MA-2 downgraded from high to medium.** The refusal fails closed: nothing moves or burns
  wrongly, and Verified Origin still works.
- **MA-7 extended.** ABORT MOTION (jog and Frame) uses the same path. The correct-behaviour bound
  was corrected from under 0.5 s to about 1 s, because `M410` leaves a continuous-mode output on
  until `LASER_SAFETY_TIMEOUT_MS`.
- **MA-3 extended** with the stock-build `G92.1` no-op.
- **MA-9, MA-11 and MA-12** are written up here for the first time. MA-11 replaces the
  "Simulator fidelity" note.
- **MA-10** is the new M112/`kill()` guidance finding, which fills the number.
- **Dropped:** nothing. Every finding survived a refutation attempt; details are under each one.

**Overlaps with track CG** (their repros, read but not re-verified here; merge when consolidating):

- **CG-11** (`src/__audit_repro__/CG/marlin-stock-reset-origin.test.ts`) is the same defect as the
  Reset-origin part of MA-3.
- **CG-10** (`marlin-stop-leaves-air-on.test.ts`): Marlin's stop lines have no `M9`, so Abort
  leaves air assist on. It belongs with MA-7's stop sequence.
- **CG-12** (`stop-shortcut-without-jog-cancel.test.ts`): Ctrl+. calls `cancelJog`, which writes
  nothing on Marlin. It is the keyboard twin of MA-7's ABORT MOTION case.
- **CG-2** (`g92-only-origin-frame.test.ts`): the first Frame sends `G54` to Marlin and records the
  origin as gone. It interacts with MA-2 and MA-3.

**bugfix-2.1.x:** every finding applies to bugfix-2.1.x unchanged. The one relevant difference
strengthens the fix for MA-7. bugfix acts on `M108`/`M112`/`M410` when the line is read, whether or
not `EMERGENCY_PARSER` is on (`queue.cpp` L538-L543, the `#if DISABLED(EMERGENCY_PARSER)` guard is
gone), and it always compiles those handlers (`gcode.cpp` L601-L603). The `M3` `O<power>` parameter
and the fan/motion class refactors do not change any behaviour cited here. Per-finding bugfix lines
are given under each finding.

---

## MA-1 — Stream-side Pause leaves the laser lit over the stopped head

- **severity:** critical.
  - **Fan dialect:** the fan-header laser stays on over a stationary head with no timeout, until
    Resume or Abort.
  - **Inline dialect:** the last burn power stays on for about 1 s (stock `LASER_SAFETY_TIMEOUT_MS`),
    or indefinitely on a build that disables that timeout.
- **verdict:** CONFIRMED (repro on the repo simulator and ADR-364's upstream-ported power model)
- **status:** new. ADR-095 designed a stream-side Pause without checking the beam after the drain.
- **failure scenario:** a Marlin job is burning and the operator presses Pause. KerfDesk only stops
  sending.
  - **Fan dialect:** every burn run is `M106 S<n>` followed by G1 moves. The buffered moves finish,
    then Marlin drives fan 0 from the current `fan_speed`, which is the burn power. The laser burns
    a spot in place until Resume or Abort. It does not matter whether Pause lands just after an
    `M106` or anywhere inside a burn run.
  - **Inline dialect (`M3 I`):** continuous mode blanks nothing when the planner runs dry, so the
    last block's power stays applied for 1 s.
  - **Copy:** the Pause text only says buffered motion may finish.
- **kerfdesk evidence:**
  - `src/ui/state/laser-job-pause-resume.ts:108-111` —
    ``if (pauseByte === null) { freezeStreamer(context); context.get().pushSystemNotice(`[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`); return; }``.
    `freezeStreamer` (L208-L218) only sets the streamer to paused. Nothing is written.
  - `src/ui/state/laser-job-pause-resume.ts:63-64` — "Pause is stream-side only: sending stops, but
    buffered motion finishes." Also `src/ui/laser/job-control-copy.ts:6-7`: "Pause stops sending;
    buffered firmware motion may finish."
  - `src/core/output/marlin-fan-transform.ts:54-56,61` —
    `if (power >= 0) setFanPower(ctx, power); ctx.out.push(stripped);` and
    ``ctx.out.push(power === 0 ? 'M107' : `M106 S${power}`);``. `M106` is written on the line before
    each burn move.
  - `src/core/controllers/marlin/driver.ts:34,55` — `realtimePause: false`, `hold: null`.
- **upstream evidence (2.1.2.8):**
  - `Marlin/src/module/planner.cpp` L1388-L1399. When no block is queued, the fan follows the
    current speed: `const uint8_t spd = thermalManager.scaledFanSpeed(i);` (L1394).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1388-L1399
  - This runs at 10 Hz from `idle()`: `MarlinCore.cpp` L738-L742, `planner.check_axes_activity();`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/MarlinCore.cpp#L738-L742
  - `M106` sets the speed at once: `Marlin/src/gcode/temp/M106_M107.cpp` L91,
    `thermalManager.set_fan_speed(pfan, speed);`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/temp/M106_M107.cpp#L85-L91
  - Only dynamic mode blanks the cutter: `Marlin/src/module/stepper.cpp` L2341-L2346,
    `else { // !current_block … if (cutter.cutter_mode == CUTTER_MODE_DYNAMIC) cutter.apply_power(0);`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/stepper.cpp#L2341-L2346
  - The safety timeout: `Marlin/src/module/temperature.cpp` L3518-L3520,
    `if (cutter.last_power_applied && ELAPSED(millis(), gcode.previous_move_ms + (LASER_SAFETY_TIMEOUT_MS))) { cutter.power = 0; cutter.apply_power(0);`.
    Its clock is refreshed only while blocks are queued: `MarlinCore.cpp` L429,
    `if (has_blocks) gcode.reset_stepper_timeout(ms);`. The stock value is
    `#define LASER_SAFETY_TIMEOUT_MS 1000` (`Marlin/Configuration_adv.h` L3432).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/temperature.cpp#L3516-L3521
  - There is no fan timeout. With `LASER_SYNCHRONOUS_M106_M107` (off in stock), the sync block
    sets the same speed and nothing clears it either.
- **bugfix-2.1.x:** same.
  - `planner.cpp` L1266-L1278: `const uint8_t spd = fan.scaled_speed();`
  - `stepper.cpp` L2782-L2789: dynamic-only blanking.
  - `temperature.cpp` L4122-L4127.
  - `Configuration_adv.h` L3900.
- **reproduction:** `src/__audit_repro__/MA/ma-1-pause-standing-beam.test.ts`, 2 tests FAIL.
  - **Fan:** `fanPower` is still 128 with 0 pending motions, 8 s after Pause.
  - **Inline:** the power model's output is 128 with the planner empty.
- **fix:** local. On a Marlin stream-side Pause, queue a beam-off line behind the buffered motion,
  and re-arm on Resume in the program's own dialect (ADR-364 transform-3 rules). Also correct the
  Pause copy.
  - **Fan:** `M107`. It is not synchronised, but each queued block keeps its captured fan speed, so
    the buffered burns finish normally and the fan drops to 0 when the planner empties. On Resume,
    send `M106 S<held>` immediately before the next move.
  - **Inline:** `M5 I`, which synchronises. On Resume, send `M3 I S0` and restate the held S on the
    next burn move. Note that `M3` without `I` does not re-enable the output (`M3-M5.cpp` L84-L88).

## MA-7 — ABORT JOB / ABORT MOTION does not stop Marlin; `M410` exists and is never sent

- **severity:** critical. A stop does not stop: the beam stays on for the rest of the planned moves
  (about 200 s in the repro), and a jog or Frame keeps moving.
- **verdict:** CONFIRMED (FIFO-model repro; upstream traced)
- **status:** new. ADR-095 stops with "stop sending + M5/M107" on the premise that Marlin has no
  immediate stop.
- **failure scenario:** a slow vector cut, say 300 mm/min with long edges.
  - Marlin sends `ok` as soon as a move is planned, so ping-pong streaming keeps up to 16 moves
    queued.
  - ABORT JOB writes `M5 I` and `M107`. `M5` calls `planner.synchronize()` first, so the beam stays
    on through every queued move.
  - In the fan dialect, `M107` zeroes `fan_speed` but each queued block keeps its captured fan
    speed, with the same result.
  - ABORT MOTION on the Live Motion bar is the same `stopJob` call. During a jog or Frame the head
    finishes the whole move: 38 s of a 40 s jog in the repro. No notice is raised, because the
    notice is set only for an active job.
  - The job notice claims KerfDesk "could only stop sending and queue beam-off commands". Marlin's
    `M410` acts when the line is read, drops the planner without a reset, and cuts the move in
    progress.
- **kerfdesk evidence:**
  - `src/ui/state/laser-job-actions.ts:314-327` — the `softReset === null` branch.
    `if (isActiveJob(get().streamer)) { set({ safetyNotice: disconnectStopUnconfirmedNotice() }); }`
    is followed by ``for (const line of driver().commands.stopLaserLines) await safeWrite(`${line}\n`, 'stop');``.
  - `src/core/controllers/marlin/commands.ts:14-17` — "Both are queued commands, not an emergency
    stop." `MARLIN_STOP_LASER_LINES = ['M5 I', 'M107']`. The Frame uses the same lines
    (`driver.ts:70-71`).
  - `src/ui/state/laser-safety-notice.ts:134-138` — "This controller has no realtime reset, so
    KerfDesk could only stop sending and queue beam-off commands."
  - `src/ui/laser/LiveMotionBar.tsx:64` —
    `const abort = description.abortLabel === 'LASER OFF' ? () => setFireActive(false) : stopJob;`.
    ABORT MOTION is `stopJob`.
- **upstream evidence (2.1.2.8):**
  - Stock builds act on `M410` when the line is read: `Marlin/src/gcode/queue.cpp` L538-L545,
    `case '0': if (command[1] == '4' && command[2] == '1') quickstop_stepper(); break;` (L543).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L538-L545
  - Lines are read even while a G1 waits for a planner slot:
    - `planner.h` L777, `while (moves_free() < count) { idle(); }`
    - `MarlinCore.cpp` L408-L410, `manage_inactivity(...) { queue.get_available_commands();`
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/MarlinCore.cpp#L408-L410
  - The emergency parser covers builds that enable it: `feature/e_parser.h` L217,
    `case EP_M410: quickstop_by_M410 = true;`, and `temperature.cpp` L1876-L1878.
  - `quick_stop()` drops every block and blocks moves for one second:
    `Marlin/src/module/planner.cpp` L1678-L1705
    (`block_buffer_nonbusy = block_buffer_planned = block_buffer_head = block_buffer_tail;` and
    `cleaning_buffer_counter = TEMP_TIMER_FREQUENCY;`). The G1 that was waiting is then refused:
    L1827-L1830, `if (cleaning_buffer_counter) return false;`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L1678-L1705
  - `Marlin/src/gcode/control/M108_M112_M410.cpp` L46-L53 says the carriages "will be out of sync
    with the stepper position after this".
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M108_M112_M410.cpp#L44-L53
  - `M5` waits for the planner: `Marlin/src/gcode/control/M3-M5.cpp` L142-L145,
    `void GcodeSuite::M5() { planner.synchronize(); cutter.power = 0; cutter.apply_power(0);`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L142-L154
  - `ok` is sent when the handler returns (`gcode.cpp` L1122), and the planner holds 16 blocks
    (`Configuration_adv.h` L2396).
  - `M410` leaves a continuous-mode output on. `Planner::busy()` counts the cleaning window
    (`planner.cpp` L1735-L1739), so a following `M5 I` runs about 1 s later, and
    `LASER_SAFETY_TIMEOUT_MS` also ends the beam about 1 s after the planner empties. About one
    second is the floor.
- **bugfix-2.1.x:** the early `M410` is unconditional (`queue.cpp` L538-L543), and `quick_stop` is
  the same (`planner.cpp` L1514-L1540).
- **reproduction:** `src/__audit_repro__/MA/ma-7-abort-keeps-burning.test.ts`.
  - `turns the beam off promptly after ABORT` FAILS: the beam is on for 200 069 ms after ABORT.
  - `ABORT MOTION stops a long jog within about a second` FAILS: motion continues 38 000 ms.
  - The control `the model stops a planned burn within about a second when it receives M410`
    PASSES: the beam is off at 1 000 ms after `M410`, `M5 I`, `M107`.
- **fix:** needs decision.
  - **Proposal:** on Marlin, ABORT JOB and ABORT MOTION send `M107`, then `M410`, then `M5 I`.
    - `M107` goes first so a fan laser is off as soon as the planner is dropped. If it followed
      `M410`, the queued `M410` handler's own one-second `synchronize()` would hold it back. This
      ordering is traced from source, not modelled.
    - `M410` is read immediately, as long as the 4-line buffer has room, which ping-pong
      guarantees.
    - Add `M9` when KerfDesk switched air on (CG-10), and route Ctrl+. through the same stop (CG-12).
    - Then treat position, homing and origin as unverified, and fix the notice text.
  - **Why a decision is needed:** Abort would then lose position certainty on Marlin, as GRBL's
    reset already does. The product owner should accept that trade over the current behaviour,
    which keeps burning.

## MA-4 — Post-job `M400` settle times out after 30 s while Marlin keeps reporting busy

- **severity:** medium
- **verdict:** CONFIRMED (repro on the repo simulator and on the FIFO model with KerfDesk's own
  program)
- **status:** new
- **failure scenario:** the moves still buffered after the last `ok` take more than 30 s. The
  normal case is KerfDesk's closing `G0 X0 Y0 S0` park, which runs at the cut feed (MA-8): 328 mm
  at 300 mm/min is 66 s.
  - Marlin answers `M400` only after the drain and prints `echo:busy: processing` every 2 s.
  - KerfDesk discards busy lines, and no M114 is polled while `M400` is owed, so the timer is never
    re-armed.
  - The run then gets "Post-job controller settle failed: post-job settle marker timed out." and a
    controller-error safety notice.
  - Run timing becomes "controller completion settlement could not be confirmed". The run is not a
    clean completion, so variables do not advance and the recovery ledger records it as
    interrupted.
- **kerfdesk evidence:**
  - `src/ui/state/laser-post-job-settle.ts:26` — `const SETTLE_MARKER_ACTIVITY_TIMEOUT_MS = 30_000;`.
  - L68-L76 — `settleDwell` is sent with `timeoutMode: 'non-idle-status-activity'`.
  - L111-L121 — the failure patch sets `controllerErrorNotice(...)`, the log line and the timing
    message.
  - `src/ui/state/laser-interactive-command.ts:393` — the only keepalive is
    `if (report.state === 'Idle' || report.state === 'Alarm' || report.state === 'Sleep') return;`.
    L215 — a busy line is only collected: `request.responses.push(rawLine.trim());`.
  - `src/core/controllers/marlin/response.ts:50` — every Marlin report has `state: 'Idle'`.
  - `src/ui/state/laser-status-polling-policy.ts:28` — no poll while a command is owed:
    `if (refs.controllerCommand !== null) return false;`.
  - `src/ui/state/laser-line-handler.ts:139` — `if (cls.kind === 'busy') return;`.
  - `src/ui/state/post-job-clean-settle.ts:1-7` — completion requires the clean settle.
- **upstream evidence (2.1.2.8):**
  - `Marlin/src/gcode/motion/M400.cpp` L29-L33, `planner.synchronize();`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/M400.cpp#L29-L33
  - `planner.cpp` L1803, `void Planner::synchronize() { while (busy()) idle(); }`.
  - `MarlinCore.cpp` L836, `TERN_(HOST_KEEPALIVE_FEATURE, gcode.host_keepalive());`.
  - `gcode.cpp` L329, `KEEPALIVE_STATE(IN_HANDLER);`.
  - `gcode.cpp` L1204-L1229, host_keepalive: `SERIAL_ECHO_MSG(STR_BUSY_PROCESSING);` (L1213).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
  - `Marlin/Configuration.h` L2228-L2229, `#define HOST_KEEPALIVE_FEATURE` and
    `#define DEFAULT_KEEPALIVE_INTERVAL 2`.
- **bugfix-2.1.x:** same (`M400.cpp` identical; `gcode.cpp` L1267-L1276; `Configuration.h`
  L2541-L2542).
- **reproduction:** `src/__audit_repro__/MA/ma-4-post-job-settle-busy.test.ts`, 2 tests FAIL.
  - A 72 s final move on the simulator with busy keepalives logs "Post-job controller settle
    failed".
  - KerfDesk's own program on the FIFO model gets the notice with raw "post-job settle marker timed
    out.".
- **fix:** local. Let a Marlin `echo:busy: processing` re-arm an owned command whose mode is
  `non-idle-status-activity`; the line already reaches `consumeControllerCommandResponse`. The same
  applies to an owned `G28`. MA-8's fix also shortens the park.

## MA-9 — A normal `M5 I` drain is shown as a held controller "reporting Idle", then raises the stream-stalled notice

- **severity:** medium. A false safety notice appears during healthy jobs. It offers "Reconnect
  controller…" and suggests aborting.
  - Following that advice ruins the job.
  - On a board that resets when the port opens, reconnecting also resets Marlin mid-job. This
    detail is board-dependent: PLAUSIBLE.
- **verdict:** CONFIRMED (FIFO-model repro)
- **status:** new. ADR-345's hold naming assumes a controller that answers status queries.
- **failure scenario:** KerfDesk's inline program ends every pass and layer with `M5 I`, and
  `M3 I S0`, `M8` and `M9` also synchronise.
  - With ping-pong, the planner holds the last 16 moves when `M5 I` is sent, so its `ok` comes only
    after they have run: 122 s for the repro's 610 mm at 300 mm/min. A G1 that waits for a full
    planner is delayed by one block the same way.
  - Marlin prints `echo:busy: processing` every 2 s throughout. KerfDesk ignores it and does not
    poll M114 while a stream line is unacknowledged.
  - After 3 s the live bar reads "CONTROLLER HOLDING PROGRAM — The controller reports Idle and has
    not acknowledged the last 1 sent lines for N s". That Idle is the stale pre-job M114.
  - After 90 s the `stream-stalled` notice says the controller "has not acknowledged … while still
    answering status queries (reporting Idle)", which Marlin is never asked. The notice also
    advises "abort the job, check the machine and the USB link".
  - The 3 s bar shows at every pass or layer boundary whose buffered tail runs longer than 3 s,
    and on any G1 that waits longer than 3 s for a planner slot. The notice fires on slow cuts
    whose buffered tail is 90 s or more, for example one 150 mm edge at 100 mm/min.
- **kerfdesk evidence:**
  - `src/ui/state/laser-line-handler.ts:139` — `if (cls.kind === 'busy') return;`.
  - `src/ui/state/laser-status-polling-policy.ts:26` —
    `if (hasUnsettledStreamAcks(state.streamer)) return false;`.
  - `src/ui/state/laser-stream-hold.ts:48,50` — `STREAM_HOLD_VISIBLE_MS = 3_000`, and
    `STREAM_HOLD_NOTICE_MS = STREAM_STALL_RUNNING_TIMEOUT_MS`, which is 90 000
    (`laser-stream-stall.ts:19`).
  - `laser-stream-hold.ts:80` — `controllerState: state.statusReport?.state ?? null`. L158 —
    "while still answering status queries". L171 — "The controller reports ${state} and has not
    acknowledged".
  - `src/ui/laser/SafetyNoticeBanner.tsx:40-43` — `stream-stalled` recommends Reconnect.
  - `src/core/output/marlin-inline-transform.ts:11-24` — `M5 I` at each boundary.
- **upstream evidence (2.1.2.8):**
  - `M3-M5.cpp` L142-L145: `M5` synchronises.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L142-L154
  - `M3-M5.cpp` L80-L81 and L111: inline `M3` synchronises when `LASER_POWER_SYNC` is off, as it is
    in stock.
  - `M7-M9.cpp` L35, L50, L65: `planner.synchronize(); // Wait for move to arrive`.
  - Busy keepalives as in MA-4: `gcode.cpp` L1204-L1229; `planner.h` L777 idles while waiting for
    a planner slot.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
- **bugfix-2.1.x:** same (`M3-M5.cpp` L147-L148, `M5` synchronises; `gcode.cpp` L1267-L1276).
- **reproduction:** `src/__audit_repro__/MA/ma-9-stream-hold-false-alarm.test.ts` FAILS. At 100 s,
  with `M5 I` in flight and busy lines in the transcript, `safetyNotice.kind` is `stream-stalled`.
- **fix:** local.
  - On queued-poll drivers, a `busy` line restarts the stall probe the way an acknowledgement does.
  - The hold copy must not name a status report the app did not poll ("no status is polled while
    Marlin streams").
  - The 90 s notice remains for silence without acks and without busy lines.

## MA-12 — Marlin's "Unknown command" is accepted as success, so a skipped job line goes unnoticed

- **severity:** medium. The firmware skips part of the operator's setup and the job runs on.
  - A build without `AIR_ASSIST` cuts with the selected air assist off.
  - A build without `LASER_FEATURE` runs an inline program dark.
  - It is limited to a mismatch between the profile and the firmware build, and the echo reaches
    the Laser Log.
- **verdict:** CONFIRMED (repro; upstream traced)
- **status:** new
- **failure scenario:** a profile uses `M8` air assist on a Marlin build without `AIR_ASSIST` or
  `COOLANT_FLOOD`. Neither is enabled in stock.
  - Marlin answers `echo:Unknown command: "M8"` and then `ok`.
  - KerfDesk classifies the echo as a plain message, advances on the `ok` and completes the job
    cleanly with no notice. On the GRBL family the same mismatch is `error:20` and stops the job.
  - The repo's own test models the reply wrongly, as a terminal `Error:Unknown command` with no
    `ok`: `src/ui/state/laser-lifecycle-marlin.simulator.test.ts:311-324`. The tested behaviour
    therefore never happens on real Marlin (see MA-11).
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/response.ts:16,32-33` — `const ECHO_RE = /^echo:\s*(.*)$/i;` and
    `if (echo !== null) return { kind: 'message', tag: 'echo', body: echo[1] ?? '' };`.
  - `src/ui/state/laser-line-handler.ts:156` — `routeAcknowledgement` begins
    `if (kind !== 'ok') return;`.
  - There is no "Unknown command" handling anywhere in `src/ui` or `src/core` (grep).
- **upstream evidence (2.1.2.8):**
  - Dispatch guards in `Marlin/src/gcode/gcode.cpp`:
    - L489-L493: `#if HAS_CUTTER case 3: … case 5: M5();`
    - L499-L501: `#if ANY(AIR_ASSIST, COOLANT_FLOOD) case 8: M8();`
    - L503-L505: `#if ANY(AIR_ASSIST, COOLANT_CONTROL) case 9: M9();`
    - L591-L594: `#if HAS_FAN case 106 … case 107`
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L489-L506
  - Everything else falls to `default: parser.unknown_command_warning();` (L1101, L1119) and then
    `if (!no_ok) queue.ok_to_send();` (L1122).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
  - The warning is printed by `parser.cpp` L390-L392,
    `SERIAL_ECHO_MSG(STR_UNKNOWN_COMMAND, command_ptr, "\"");`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/parser.cpp#L390-L392
  - `SERIAL_ECHO_MSG` prefixes `echo:`: `core/serial.h` L286 and `core/serial.cpp` L76.
  - Stock `Configuration_adv.h` has `//#define LASER_FEATURE` (L3334), `//#define AIR_ASSIST`
    (L3353) and `//#define COOLANT_CONTROL` (L3513).
- **bugfix-2.1.x:** same (`gcode.cpp` L491-L507, L594-L595, L1167, L1185-L1188; `parser.cpp`
  L400-L402).
- **reproduction:** `src/__audit_repro__/MA/ma-12-unknown-command-accepted.test.ts` FAILS. The echo
  is in the log, `G1 X20 S200` is sent after the skipped `M8`, and `safetyNotice` is null.
- **fix:** needs decision. Classify `echo:Unknown command:` as its own event and attribute it to the
  in-flight line; Marlin is FIFO and the echo comes before that line's `ok`. Then either:
  - stop the stream as GRBL's `error:20` does, or
  - raise a notice naming the command and continue.

  The repro checks only the part both answers share: a notice that names `M8`. Also correct the
  repo test at L311-L324.

## MA-3 — Abort (and Reset origin on stock builds) records "no origin" while Marlin keeps its G92 shift

- **severity:** medium. The origin record is wrong: Absolute placement then plans in the wrong
  frame, and the job and its Frame run displaced by the old origin. The Frame shows the displaced
  path physically, so frame-first review can catch it.
- **verdict:** CONFIRMED (repro for Abort; Reset origin traced here, and reproduced by track CG as
  CG-11)
- **status:** new. The Reset-origin part duplicates CG-11.
- **failure scenario:**
  - **Abort:** Set origin (`G92 X0 Y0`), run, ABORT. `runStopJob` applies
    `originUnknownAfterControllerReset`, which was built for GRBL's soft reset. That records
    `workOriginSource: 'none'`, although Marlin was not reset and keeps its shift. Absolute then
    resolves with no offset, while Marlin runs every coordinate in the shifted frame.
  - **Reset origin:** the same record follows Reset origin on a build without
    `CNC_COORDINATE_SYSTEMS`, which is stock. `G92.1` is acknowledged and does nothing, and KerfDesk
    records the origin as cleared. The driver comment documents this build requirement; nothing
    checks it.
- **kerfdesk evidence:**
  - `src/ui/state/laser-job-actions.ts:339` — `...originUnknownAfterControllerReset(state),`
    applies on every Abort, including the no-reset branch at L314.
  - `src/ui/state/laser-status-line.ts:337-342` — `workOriginActive: false, workOriginSource: 'none'`
    for a `g92` origin.
  - `src/ui/job-placement.ts:208-213` — `if (!customOriginIsActive(machine)) return { ok: true };`.
  - Reset origin:
    - `src/core/controllers/marlin/driver.ts:74` — `clearOrigin: 'G92.1'`.
    - `src/ui/state/laser-origin-actions.ts:221-224` — `clearedOriginPatch()` whatever the firmware
      did.
    - `driver.ts:40-43` — "Marlin 2.1.2.6 compiles G92.1 only with that prerequisite … a documented
      build requirement, not detected firmware evidence".
- **upstream evidence (2.1.2.8):**
  - The G92 shift persists: `Marlin/src/gcode/geometry/G92.cpp` L95-L98,
    `position_shift[i] += d; update_workspace_offset((AxisEnum)i);`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/geometry/G92.cpp#L60-L112
  - It is cleared only by:
    - `G92.1` under `#if ENABLED(CNC_COORDINATE_SYSTEMS) && !IS_SCARA` (L64-L70);
    - homing (`module/motion.cpp` L2346-L2349, `position_shift[axis] = 0;`);
    - a reboot.
  - `M5` and `M107` do not touch it (`M3-M5.cpp` L142-L154; `M106_M107.cpp` L102-L115).
  - On a stock build `G92.1` is a no-op either way:
    - Sub-codes are compiled only with `G38_PROBE_TARGET`, `CNC_COORDINATE_SYSTEMS` or
      `POWER_LOSS_RECOVERY` (`inc/Conditionals_post.h` L3178-L3180). Without them `G92.1` parses as
      a bare G92 with no axis words.
    - With sub-codes but no `CNC_COORDINATE_SYSTEMS`, `default: return; // Ignore unknown G92.x`
      applies (L62).
    - `Configuration_adv.h` L3600 is `//#define CNC_COORDINATE_SYSTEMS`.
- **bugfix-2.1.x:** same.
  - `G92.cpp` L64-L66 (`case 1` under the same guard), L91-L94.
  - `Conditionals-5-post.h` L3236-L3237 adds only `HAS_ROTATIONAL_AXES`.
- **reproduction:** `src/__audit_repro__/MA/ma-3-abort-forgets-g92.test.ts` FAILS: after Abort,
  with no `\x18` and no `G92.1` sent, `workOriginSource` is `'none'`.
- **fix:**
  - **Abort — local.** Apply the reset-origin patch only when a reset byte was sent. On Marlin keep
    the `g92` record, or mark it `'unknown'`.
  - **Reset origin on builds without `CNC_COORDINATE_SYSTEMS` — needs decision.** Options:
    - verify with the position line that `G92.1` echoes (`G92.cpp` L131
      `report_current_position()`);
    - restore the frame with a `G92` computed from the shift KerfDesk wrote (see MA-2);
    - stop offering Reset origin on Marlin unless the build is confirmed.

## MA-2 — After Set origin, User Origin / Current Position / Absolute never resolve on Marlin

- **severity:** medium, downgraded from high.
  - The default Marlin workflow is blocked, and the refusal's advice ("Wait a moment and try again,
    or Reset origin and set it again") cannot work.
  - It fails closed and nothing moves wrongly. Verified Origin still resolves; it needs only an
    origin, plus the Verified Frame.
- **verdict:** CONFIRMED (repro)
- **status:** new
- **failure scenario:** on the Generic Marlin profile, homing is off, so the default placement is
  User Origin.
  - The operator jogs, clicks Set origin (`G92 X0 Y0`) and Frames. The Frame waits for a work
    offset, then refuses: "The work origin is set, but the controller has not reported where it is
    yet."
  - Marlin never reports a work offset. M114 prints the logical position, which is already the
    shifted work position.
  - Current Position and Absolute refuse too.
  - On a homing profile, Set origin switches Absolute to User Origin, which then refuses. Only
    Verified Origin works.
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/response.ts:49-57` — the M114 value is filed as
    `mPos: { x, y, z }, wPos: null, … wco: null`.
  - `src/ui/state/laser-origin-actions.ts:343-344` —
    `inferredMachinePosition === null || priorWco === null ? null`, so `wcoCache` stays null.
  - `src/ui/job-placement.ts`:
    - L247-L249 — `CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE`;
    - L262-L263 — `if (wco === null) { return { ok: false, messages: [CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE] }; }`;
    - L221-L233 — Current Position "needs a live machine position and work-coordinate offset";
    - L208-L219 — Absolute: `ABSOLUTE_WORK_OFFSET_REQUIRED_MESSAGE`;
    - L28-L38 — `startFrom: device.homing.enabled ? 'absolute' : 'user-origin'`.
  - `src/ui/laser/OriginRow.tsx:234-237` —
    `if (startFrom === 'absolute') setJobPlacement({ startFrom: 'user-origin' });`.
  - `src/ui/laser/frame-position-readiness.ts:45-55` — the Frame waits for an offset, then refuses.
- **upstream evidence (2.1.2.8):**
  - M114 prints the logical position: `Marlin/src/module/motion.cpp` L192-L212,
    `const xyze_pos_t lpos = rpos.asLogical();`, through `report_current_position_projected()`
    (L243-L246; `gcode/host/M114.cpp` L147).
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/motion.cpp#L192-L212
  - G92 moves the workspace so that the reported position becomes the given value:
    `gcode/geometry/G92.cpp` L41-L42, "G92 : Modify Workspace Offsets so the reported position
    shows the given X …", and L95-L98.
- **bugfix-2.1.x:** same (`motion.cpp` L246-L254 `rpos.asLogical()`, L285-L288; `G92.cpp` L94
  `motion.workspace_offset[i] += d;`).
- **reproduction:** `src/__audit_repro__/MA/ma-2-marlin-origin-placement.test.ts`.
  - `User Origin resolves after Set origin here` FAILS, refused with
    `CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE` after 10 s of M114 polls.
  - The precondition test (Generic Marlin defaults to User Origin) passes.
- **fix:** needs decision. Either:
  - treat Marlin's M114 X/Y as the work position and track the G92 shift KerfDesk itself wrote
    (machine = work + recorded shift; a reboot or homing clears it), or
  - stop offering placements that cannot resolve on Marlin, and point the refusal at Verified
    Origin.

## MA-8 — Marlin G0 runs at the last G1 feed; KerfDesk times it as a rapid

- **severity:** medium.
  - The Job Review time and the live countdown are wrong. In the repro the estimate is 18.5 s and
    the model takes 82 s.
  - Travel and the closing park crawl at the cut feed, which drives MA-4.
- **verdict:** CONFIRMED (repro; upstream traced)
- **status:** new
- **failure scenario:** stock Marlin has no `G0_FEEDRATE`, so G0 moves at the modal feed.
  - KerfDesk writes Marlin travel and the park as `G0 X.. Y.. S0` with no F. After the first cut,
    every travel and the final park run at the cut feed, for example 300 mm/min.
  - The estimator times each rapid at the profile's `maxFeed`.
  - The first travel runs at whatever feed is modal: a Frame's F, a jog's F, or 4000 mm/min at
    power-on.
- **kerfdesk evidence:**
  - `src/core/output/grbl-strategy.ts:55-56` —
    ``const base = `G0 X${…} Y${…}`; return dialect.requiresS0OnRapid ? `${base} S0` : base;``.
    That produces the Marlin body through `marlin-inline-transform.ts`, which passes G0 through
    unchanged.
  - `src/core/gcode-time/segment-blocks.ts:35-36` —
    `targetVelocity: isRapid ? limits.maxFeedMmPerMin / SECONDS_PER_MINUTE`.
  - `src/core/job/estimate-duration.ts:70-84` — Job Review uses this timeline.
- **upstream evidence (2.1.2.8):**
  - `Marlin/Configuration_adv.h` L3721, `//#define G0_FEEDRATE 3000 // (mm/min)`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/Configuration_adv.h#L3721
  - `gcode/motion/G0_G1.cpp` L47-L73: every G0-specific feed is under `#ifdef G0_FEEDRATE`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/motion/G0_G1.cpp#L47-L73
  - `gcode.cpp` L213-L214, `if (parser.floatval('F') > 0) { feedrate_mm_s = parser.value_feedrate();`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L213-L217
  - `module/motion.cpp` L131-L134, power-on `DEFAULT_FEEDRATE_MM_M 4000`.
- **bugfix-2.1.x:** same (`Configuration_adv.h` L4204; `gcode.cpp` L209-L214).
- **reproduction:** `src/__audit_repro__/MA/ma-8-g0-modal-feed.test.ts` FAILS: `expected 82 to be
  less than 23.15`. This session reworked the repro, which previously compared a count-down plan
  built on the GRBL default profile. The plan is now `estimateJobDuration` on the Generic Marlin
  profile, about 18.5 s. The actual time is the same program streamed by KerfDesk into the FIFO
  model, measured until every line is acknowledged and the planner is empty.
- **fix:** local. Prefer giving Marlin travel its own `F<travel>` and restating the cut F on the
  next G1; the GRBL body already writes F on the first G1 after each travel. If the bytes must not
  change, time Marlin G0 at the modal feed instead.

## MA-5 — A comment-only Console line wedges the Marlin session

- **severity:** medium. The owed `ok` never comes, so polls, Console, Jog, Frame and Start are
  refused until Disconnect. The trigger is narrow: typing a comment in the Console.
- **verdict:** CONFIRMED (repro with a `queue.cpp`-faithful fake)
- **status:** new. It is the same class as ADR-361 decision 2, a line that owes an
  acknowledgement the controller will never send.
- **failure scenario:** the operator sends `; note`, or `(note)` on a `PAREN_COMMENTS` build.
  Marlin drops the line without replying. KerfDesk's ledger never expires an owed ack (ADR-362
  Amendment 1, decision 4). The job streamer already skips `;` lines (`streamer.ts:139-142`); the
  Console does not.
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/console-command.ts:31-48` — only empty input, multiple lines,
    non-ASCII text and `M500`/`M502` are refused. `; note` reaches
    `return command('gcode', normalized, true, true, marlinStateEffect(normalized));`.
  - `src/ui/state/console-command-transport.ts:85` —
    `return write(command.wire, actionForConsoleCommand(command.kind), source);` writes with one
    owed ack.
- **upstream evidence (2.1.2.8):**
  - `Marlin/src/gcode/queue.cpp` L369-L372, `else if (c == ';') { sis = PS_EOL; return; }`.
  - L399, `const bool is_empty = (ind == 0);`.
  - L466-L468, `if (process_line_done(serial.input_state, serial.line_buffer, serial.count)) continue;`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L396-L405
  - A line with a leading space before `;` would still be answered, but the Console trims it.
    `PAREN_COMMENTS` is off in stock (`Configuration_adv.h` L3717).
- **bugfix-2.1.x:** same (`queue.cpp` L369-L370, L396-L399, L467).
- **reproduction:** `src/__audit_repro__/MA/ma-5-console-comment-wedge.test.ts`, 2 tests FAIL.
  `prepareMarlinConsoleCommand('; note').ok` is true, and after it `pendingUntrackedAcks` is 1 and
  `M105` is refused.
- **fix:** local. Refuse, or skip, Marlin Console lines that are empty once `;` and `(...)`
  comments are removed.

## MA-6 — M114 from a Marlin build without Z is not parsed; the board is reported as not answering

- **severity:** medium. It fails closed, but an XY-only Marlin laser cannot be used, and the
  diagnosis sends the operator to check the cable and baud rate.
- **verdict:** CONFIRMED (unit repro and a store probe)
- **status:** new
- **failure scenario:** an XY-only build, `NUM_AXES 2` with no `Z_DRIVER_TYPE`, answers
  `X:10.00 Y:5.00 Count X:800 Y:400`. It adds ` E:` when extruders are configured.
  - `POSITION_RE` requires `Z:`, so every poll's position line is `unknown`, although each is
    answered with `ok`.
  - A store probe run for this report found:
    - qualification failed with "No controller response was received at 250000 baud. Check the
      cable and controller profile, then retry.";
    - the log reads "No controller response within 8 s. Check baud rate (250000) and that the
      device is Marlin.";
    - Jog is refused with "Controller status is not known yet".
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/response.ts:15` —
    `const POSITION_RE = /^X:(-?\d+(?:\.\d+)?)\s+Y:(-?\d+(?:\.\d+)?)\s+Z:(-?\d+(?:\.\d+)?)/;`.
  - L43-L48 — no match means no report.
  - `src/ui/state/laser-controller-silence.ts:50,57` — the silence messages.
- **upstream evidence (2.1.2.8):**
  - `NUM_AXES` comes from the defined driver types: `inc/Conditionals_LCD.h` L233-L262,
    `#elif defined(Y_DRIVER_TYPE) #define NUM_AXES 2`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/inc/Conditionals_LCD.h#L233-L262
  - M114 prints one label per axis: `module/motion.cpp` L195-L207,
    `LIST_N(DOUBLE(NUM_AXES), X_LBL, lpos.x, SP_Y_LBL, lpos.y, SP_Z_LBL, …)`, with E only
    `#if HAS_EXTRUDERS`.
  - The counts come from `module/stepper.cpp` L3260-L3274.
  - `inc/SanityCheck.h` L1020-L1023 forbids only leveling and `CNC_WORKSPACE_PLANES` without Z.
- **bugfix-2.1.x:** same.
  - `inc/Conditionals-1-axes.h` L286-L287.
  - `motion.cpp` L246-L254: `NUM_AXIS_PAIRED_LIST`, then E, so E is still printed after the axes.
- **reproduction:** `src/__audit_repro__/MA/ma-6-m114-without-z.test.ts`, 2 tests FAIL: both lines
  classify as `unknown`.
- **fix:** local. Make `Z:` optional in the M114 pattern, with z as 0 or unknown.

## MA-10 — After M112 or any `kill()`, the guidance says reconnect / wait for Idle; Marlin needs a reset or power cycle

- **severity:** low. The text misleads the operator; the stop itself works.
- **verdict:** CONFIRMED against Marlin's own source. Whether reconnecting resets a given board
  depends on its USB hardware and is PLAUSIBLE.
- **status:** new
- **failure scenario:**
  - The Console's M112 quick command says "halts firmware; reconnect required".
  - After `Error:Printer halted. kill() called!`, the generic controller-error notice says "Check
    the Laser Log, wait for Idle, and home before continuing". A probe run for this report
    confirmed that exact text.
  - The next M114 poll is never answered, so its owed ack blocks every command until Disconnect.
  - Marlin, after `kill()`, disables interrupts and waits for the RESET button, the KILL button, or
    a power cycle. Reopening the port resets only boards whose USB-serial hardware pulses reset on
    open (DTR auto-reset). A native-USB board is not reset by it.
  - The same notice follows a failed Home on a stock build, because `VALIDATE_HOMING_ENDSTOPS`
    kills on a missed endstop. That path is traced, not reproduced.
- **kerfdesk evidence:**
  - `src/core/controllers/marlin/driver.ts:92-96` —
    `hint: 'EMERGENCY STOP (halts firmware; reconnect required)'`.
  - `src/ui/state/laser-safety-notice.ts:237-248` — `controllerErrorNotice`, whose message ends
    "Check the Laser Log, wait for Idle, and home before continuing if position is uncertain.".
  - `src/__fixtures__/controllers/marlin-simulator.ts:158-162` — the simulator clears the halt on
    port open (MA-11).
- **upstream evidence (2.1.2.8):**
  - `Marlin/src/MarlinCore.cpp` L891, "After this the machine will need to be reset."
  - L899 prints `echo:M112 Shutdown` and L910 prints `Error:Printer halted. kill() called!`.
  - L924, `cli(); // Stop interrupts`.
  - L941-L952: with `HAS_KILL` or `SOFT_RESET_ON_KILL`, wait for the button, then reboot.
  - L956, `for (;;) hal.watchdog_refresh();  // Wait for RESET button or power-cycle`.
    https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/MarlinCore.cpp#L889-L957
  - M112 runs at read time (`queue.cpp` L542) or as a command (`M108_M112_M410.cpp` L42-L44).
  - Failed homing: `module/endstops.cpp` L455-L458, `else kill(GET_TEXT_F(MSG_KILL_HOMING_FAILED));`,
    with `#define VALIDATE_HOMING_ENDSTOPS` (`Configuration.h` L2136).
- **bugfix-2.1.x:** same (`MarlinCore.cpp` L921, L954, L986).
- **reproduction:** `src/__audit_repro__/MA/ma-10-m112-recovery-guidance.test.ts`, 2 tests FAIL.
  The hint does not mention reset or power, and the notice says "wait for Idle".
- **fix:** local.
  - Change the hint to "halts the firmware; press the controller's reset button or power-cycle it,
    then reconnect".
  - Recognise `kill() called!` on Marlin as a halted-controller notice carrying the same advice.

## MA-11 — The repo's Marlin simulator hides FIFO order, planner limits, busy keepalives and comment handling

- **severity:** low. This is test infrastructure: the Marlin store tests pass on behaviour Marlin
  does not have. MA-4, MA-5, MA-7 and MA-9 appear only on `marlin-fifo-model.ts`, and MA-12 is
  hidden by a test that models the reply wrongly.
- **verdict:** CONFIRMED (repro)
- **status:** new. This replaces the "Simulator fidelity" note in `MA-partial.md`.
- **failure scenario:** `src/__fixtures__/controllers/marlin-simulator.ts` differs from Marlin in
  these ways:
  - It answers `; note` with `ok`: comments are not stripped, so the line falls to `handleMotion`
    (L155), which always replies `ok` (L104). An empty line gets `ok` too (L114-L117).
  - It answers a later `M114` while an `M400` or `M5` waits (L134-L140); Marlin is FIFO.
  - It ends every move `motionMs` after it was queued (L101-L102), so moves overlap. It has no
    16-block limit, so an `ok` is never delayed.
  - Its `rejectLines` send `Error:` with no `ok` (L109-L112). Marlin sends `ok` after a handler
    error. `laser-lifecycle-marlin.simulator.test.ts:311-324` uses this to model "Unknown command"
    as a terminal `Error:`, a reply Marlin never sends (MA-12).
  - It never prints `echo:busy: processing`, although its header promises "`echo:busy:` while long
    operations run".
  - It clears an M112 halt when the port reopens (L158-L162), which holds only for boards that
    reset on open.
  - It treats `G92 X0 Y0` as a zero-time move, and G92/G28 print no position line
    (`G92.cpp` L131; `G28.cpp` L619).

  ADR-364's burn oracle is not affected: the power model is order-based, not time-based.
- **kerfdesk evidence:** as listed above, all in `src/__fixtures__/controllers/marlin-simulator.ts`.
  Four store tests depend on it: `laser-lifecycle-marlin`, `laser-countdown-marlin`,
  `laser-marlin-fresh-status` and `laser-resume-dialect`.
- **upstream evidence (2.1.2.8):**
  - `queue.cpp` L369-L372, L396-L405, L466-L468.
  - `M400.cpp` L29-L33 and `M3-M5.cpp` L142-L145.
  - `planner.h` L774-L777.
  - `gcode.cpp` L1122 with `motion/G2_G3.cpp` L487, `SERIAL_ERROR_MSG(STR_ERR_ARC_ARGS);`.
  - `gcode.cpp` L1204-L1229.
  - `MarlinCore.cpp` L956.
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
- **reproduction:** `src/__audit_repro__/MA/ma-11-simulator-fidelity.test.ts`, 5 tests FAIL:
  - it answers a comment line;
  - it answers M114 behind a waiting M400;
  - it runs two 1 s moves in 1 s;
  - it sends `Error:` without `ok`;
  - it prints no busy line in 4.5 s of M400.
- **fix:** local. Bring the simulator in line (FIFO command queue, sequential 16-block planner, no
  reply to comment-only lines, `Error:` then `ok`, busy every 2 s while a handler waits, M112 halt
  kept across reopen unless a test opts into reset-on-open). Alternatively, promote
  `marlin-fifo-model.ts` as the timing oracle. Then re-run the four Marlin store tests and fix the
  test at L311-L324.

---

## Checked and correct

- `M5 I` ends inline mode and zeroes the output after the planner drains, and `M3 I S0` re-enters
  continuous mode at power 0. KerfDesk's program brackets each pass that way.
  `M3-M5.cpp` L84-L88, L142-L154 —
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M3-M5.cpp#L75-L154
- Inline power is S0-255 with stock `CUTTER_POWER_UNIT PWM255` (`Configuration_adv.h` L3372), set
  by the S of G1 (`gcode.cpp` L233-L241). The Generic Marlin profile uses `maxPowerS: 255`.
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L229-L251
- G0 zeroes the inline power (`gcode.cpp` L243-L247), and the emitted program restates S on the
  first G1 after every G0.
- `M7`/`M8`/`M9` synchronise first, so the program's `M9` before the final `M5 I` does not cut air
  during the last buffered burns.
  `M7-M9.cpp` L34-L75 —
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M7-M9.cpp#L34-L75
- Fan-dialect timing while moving is right. `M106` sets `fan_speed` at once, each planned block
  captures it (`planner.cpp` L2252-L2254), and the executing block drives the fan
  (`planner.cpp` L1355-L1362). So `M106 S<n>` right before the burn move and `M107` right before
  travel switch with the moves.
  https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/module/planner.cpp#L2252-L2254
- M114 on 3-axis builds parses correctly (`motion.cpp` L192-L212; `stepper.cpp` L3260-L3274). It
  is the projected position (`M114.cpp` L146-L147), and KerfDesk relies on it only after an owned
  `M400` (`response.ts` L37-L41).
- `M400` is the right settle marker (`M400.cpp` L29-L33); only its timeout is wrong (MA-4).
- `G21` is a silent NOOP without `INCH_MODE_SUPPORT` (`gcode.cpp` L392, `case 21: NOOP;`).
- `G28 X Y` homes only X/Y and answers after the homing moves (`G28.cpp`, position report at L619).
- The boot lines `start` (`MarlinCore.cpp` L1185) and `Marlin 2.1.2.8` (L1285) both classify as a
  welcome, and the store still qualifies. Checked by the earlier session with 0, 15 and 400 ms gaps.
- A handler `Error:` followed by `ok` (`gcode.cpp` L1122) leaves the FIFO ack ledger consistent.
  Checked by the earlier session.
- The jog `G21 / G91 / G0 X.. F.. / G90` runs at the requested feed, because an F on G0 sets the
  shared feed (`gcode.cpp` L213-L214). Press-and-hold jog is disabled on Marlin (`JogPad.tsx:45`,
  `jogCancel: false`), which is correct: Marlin has no jog cancel.
- Ping-pong streaming (`profile-catalog.ts:99`) fits Marlin's 4-command buffer
  (`Configuration_adv.h` L2405). Un-numbered lines are accepted, because only a line starting with
  `N` is checked (`queue.cpp` L472-L473).
- Resume transform 3 matches Marlin for the modes KerfDesk writes (`native-laser-resume.ts`,
  `native-laser-resume-beam.ts`, `laser-resume-dialect.ts`):
  - `M5 I` hard-off;
  - `G0 X Y S0` re-entry, since G0 zeroes inline power;
  - `M3 I S0` re-arm, because `M3` without `I` would not re-enable the output (`M3-M5.cpp` L84-L88);
  - `G1 F<feed>`, because a bare F is an unknown command without `GCODE_MOTION_MODES`
    (`parser.cpp` `default: return;`);
  - the held S restated on the first burn move, because a G1 after `M3 I S0` runs at 0;
  - fan `M107` before the re-entry and `M106 S<held>` immediately before the first move.

  The existing oracle tests pass (`resume-program.native-oracle.test.ts` and
  `resume-program.native.test.ts`).
- Stock builds act on `M410`/`M112` when the line is read (`queue.cpp` L538-L545), which is the
  basis for MA-7's fix. bugfix does this unconditionally.

## Not covered

- Hardware of any kind, including whether particular boards reset on port open (MA-9, MA-10).
- Checksum and line-number mode (`N…*cs`, `Resend:`). KerfDesk never sends numbered lines, and
  ADR-095 makes `Resend:` terminal; not re-verified.
- Behaviour outside stock options:
  - `ADVANCED_OK` flow control;
  - `LASER_POWER_SYNC`;
  - `LASER_POWER_TRAP`;
  - dynamic inline mode (`M4 I`);
  - `SOFT_FEED_HOLD`;
  - the `REALTIME_REPORTING_COMMANDS` `S000/P000/R000` of `EMERGENCY_PARSER` builds, which could
    give real status and hold on such builds. That is an improvement, not a defect.

  `LASER_SYNCHRONOUS_M106_M107` was read only as far as MA-1 needs; the finding holds with it.
- Fan-dialect raster scaling (`marlin-fan-raster.ts`) beyond the transform's power words.
- The Home flow after a homing `kill()`: traced only (MA-10).
- `M115` `Cap:` lines, multi-serial and SD-print states.
- The Smoothieware stream-side Pause, which shares MA-1's code path; that belongs to track SM.
