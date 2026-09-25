# Track ST (GRBL-family streaming, flow control, job lifecycle) — partial findings

Status: complete (final hand-back sent; this file mirrors it). Upstream root: gnea/grbl 1.1h bfb67f0c, grblHAL core d7aaee3d,
FluidNC v4.0.3. Repro tests live in `src/__audit_repro__/ST/` and all FAIL on current code.

## Findings (most severe first)

### ST-1 — Tool-change Continue streams the next section while the operator's jog is still moving, or while an operator command still owes its `ok`
- severity: high (ruined job + ALARM:3/position loss; wrong machine state accepted as proof; ack ledger corruption / wedge)
- verdict: CONFIRMED (reproduced)
- status: new
- failure scenario:
  (a) CNC tool-change hold, fresh Idle seen, Zero Z done → operator jogs Z up (`$J=`) → presses
  Continue while the jog is still running. Continue is enabled; it writes the resumed window; GRBL
  answers every G-code line in Jog with `error:9`; the stream goes `errored`; the auto-stop sends
  0x18 while jogging → ALARM:3, steppers killed, job lost at the tool change.
  (b) Continue while an operator line's `ok` is still owed (second Zero Z `G10 L20 P1 Z0`, or the
  jog owner's `G4 P0.01` settle marker dispatched at Idle): the `ok` arrives before any job line's.
  Jog-marker case: the stream claims it (`inFlight` 6→5 though GRBL answered no job line → RX budget
  freed early, next refill can overrun GRBL's ring), the jog owner never sees its marker ack and
  `pendingUntrackedAcks` stays 1. Zero-Z case: the owned command takes the `ok` but the ledger keeps
  1 owed ack forever → after the job Start, Jog, Frame, Home and origin writes are refused until
  reconnect; if the worker refill was armed first, the worker pumps that `ok` as a job ack
  (serial-worker-core.ts:161-176) while the main thread does not (traced only), so the worker runs
  one line ahead of the main thread's copy; after a later hand-back (Pause releases the refill
  first) the main thread re-sends the line the worker already sent (duplicate execution).
- kerfdesk evidence:
  - `src/ui/state/laser-store-helpers.ts:110-134` `toolChangeContinueBlockMessage` checks only MPG,
    `toolChangeReady`, work-Z evidence, plate removal, tool id — no motion/controller operation, no
    owed ack, no current Idle.
  - `src/ui/state/laser-store-helpers.ts:96-100` `toolChangeReady` = drained tail + latched
    `toolChangeIdleSeen`; `src/ui/state/laser-status-line.ts:307-316` "Latches; only tool-change
    entry resets."
  - `src/ui/state/laser-job-actions.ts:450-469` Continue checks that gate, then `safeWrite(toSend, 'resume')`.
  - `src/ui/laser/LiveMotionBar.tsx:131-135` Continue enabled when the gate is null.
  - `src/ui/state/laser-safe-write.ts:135` operator `$J=` allowed in the drained hold.
  - `src/ui/state/laser-stream-ack.ts:70-71` every terminal ack belongs to the stream while
    `hasUnsettledStreamAcks` (always true while `streaming`).
  - `src/ui/state/laser-line-handler.ts:108-112` an owned command consumes its `ok` without settling
    the ledger when the settlement chose `stream`.
  - `src/ui/state/laser-error-line.ts:110-152` stream `error:N` → auto soft reset.
  - `src/ui/state/laser-owned-motion-settlement.ts:24-30` already documents "GRBL rejects the G4
    marker while jogging".
- upstream evidence:
  - grbl/protocol.c:99-101 `} else if (sys.state & (STATE_ALARM | STATE_JOG)) { ... report_status_message(STATUS_SYSTEM_GC_LOCK);`
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L99-L101
  - grbl/motion_control.c:380-385 mc_reset during STATE_JOG → `system_set_exec_alarm(EXEC_ALARM_ABORT_CYCLE); st_go_idle();`
    https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L385
  - grblHAL core protocol.c:256-263 same lock-out (`Status_SystemGClock`); FluidNC v4.0.3
    ProcessSettings.cpp:1242-1243 `state_is(State::Jog)` → `Error::SystemGcLock`.
  - grbl/protocol.c:78-110 one response per line in receive order (ledger ordering).
- reproduction: `src/__audit_repro__/ST/tool-change-continue-during-jog.test.ts` (fails: gate null,
  resumed lines written while Jog, stream `errored`, 0x18 sent, ALARM:3);
  `src/__audit_repro__/ST/tool-change-continue-owed-ack.test.ts` (2 cases fail: owed-ack ledger stuck
  at 1 after the job; jog-marker ok claimed by the stream, inFlight 6→5).
- fix (local): make `toolChangeContinueBlockMessage` also refuse while `motionOperation !== null`,
  `controllerOperation !== null`, `hasPendingControllerWrite(state)`, or the current
  `statusReport.state !== 'Idle'` (same facts `jogFrameCommandBlockMessage`/Start's queue fence
  use). These are transport/handoff facts, not a policy gate.

### ST-4 — Home on stock GRBL 1.1h is declared failed after 120 s although the machine is still homing
- severity: medium
- verdict: CONFIRMED (reproduced)
- status: new
- failure scenario: stock GRBL router, $25=500 (default), 1000 mm axis, Home from the far end →
  XY search alone ≈120 s, plus Z and locate passes. GRBL answers no `?` during the cycle, so the
  Home command's 120 s timer is never refreshed → "home timed out" safety notice worded as "The
  controller rejected a command", homingState unknown, while the machine keeps homing.
- kerfdesk evidence: `src/ui/state/laser-home-action.ts:44-51` (`HOME_COMMAND_TIMEOUT_MS = 120_000`,
  relies on "<Home|...> poll replies keep the command alive"), `:152-159` timeoutMode
  `non-idle-status-activity`; `src/ui/state/laser-interactive-command.ts:386-396`
  `keepCommandAliveFromStatus` only refreshes on a non-Idle status report;
  `src/ui/state/laser-home-action.test.ts:253-292` assumes `<Home|...>` replies.
- upstream evidence: grbl/limits.c:319-320 "Exit routines: No time to run protocol_execute_realtime()
  in this loop." https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L319-L320 ;
  wiki Interface: `?` answered "immediately (exception: while homing)"
  https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface . (grblHAL differs: machine_limits.c:445-447
  answers EXEC_STATUS_REPORT during homing.)
- reproduction: `src/__audit_repro__/ST/grbl-home-without-status.test.ts` (fails: homingState
  `unknown` + timeout notice at 130 s with no status replies).
- fix (local): for stock GRBL (`grbl-v1.1`), do not time out `$H` on status silence alone (e.g.
  bound it by the configured travel/seek-rate estimate, or keep waiting while the transport is up and
  report "still homing"), and word the timeout as a timeout, not a rejection.

### ST-2 — The shared GRBL simulator is more forgiving than GRBL 1.1h in ways that hide ST-1/ST-4-class defects
- severity: medium (test-infrastructure fidelity)
- verdict: CONFIRMED (reproduced against the simulator)
- status: new
- failure scenario: store/simulator tests pass for behaviour real GRBL rejects or times differently.
  Deviations (each a failing case): G-code accepted in Jog (GRBL error:9 → hides ST-1); `\r` not an
  end of line (GRBL answers `G21\r\n` twice); M0 acked at once with no Hold:0; G4 acked at once
  (GRBL: after planner drain + dwell); lines acked during a completed feed hold; software door
  reported as Door:1 ("ajar") yet resumed by `~` (GRBL without door input reports Door:0; Door:1
  refuses `~`); status answered after ALARM:1 (GRBL's critical loop answers nothing until reset);
  planner modelled as 16 blocks (GRBL holds 15, `Bf:15,128`). Also: `<Home|...>` answered during
  homing (hides ST-4); `triggerAlarm` flushes RX for every code (ALARM:4/5 do not); override bytes
  0x90-0xA1 are not picked off as realtime; RX "127 usable" comment is wrong (ring holds 128,
  serial.c:24 `RX_RING_BUFFER (RX_BUFFER_SIZE+1)`), conservative so harmless.
- kerfdesk evidence: `src/__fixtures__/controllers/grbl-sim-machine.ts:147-156` (Hold:0/Door:1
  labels), `:166-196` realtime handling, `:366-394` G-code accepted unless locked;
  `grbl-simulator.ts:30` REALTIME_BYTES (6 bytes only), `:68-80` only `\n` ends a line,
  `:179-184` triggerAlarm; `grbl-sim-planner.ts:31` `GRBL_PLANNER_BLOCKS = 16`;
  `grbl-sim-rx-window.ts:10-28`.
- upstream evidence: protocol.c:79, :93-95, :99-101, :208, :226-236, :546; gcode.c:1084-1090;
  motion_control.c:195-200; system.c:87-93; report.c:491-500; planner.c:250-254, 498-502;
  serial.c:24, :37-42, :150-196; limits.c:319-320 (all at bfb67f0c).
- reproduction: `src/__audit_repro__/ST/grbl-simulator-fidelity.test.ts` (8 cases, all fail).
- fix (local, fixtures only): model protocol.c:99 lock-out, `\r` EOL, M0/G4/M3-M9 sync, Hold:0
  parse suspension, Door:0 vs Door:1, silent critical alarm, 15-block planner; keep `<Home>`
  replies behind a grblHAL flag.

### ST-3 — Every `<Alarm|...>` status report wipes the owed-ack ledger and cancels the owned exchange in flight, although GRBL still answers lines sent in Alarm
- severity: low (spurious "Unlock failed"; self-corrects on the next Idle report)
- verdict: CONFIRMED (reproduced)
- status: new
- failure scenario: controller in Alarm; operator presses Unlock (`$X`); a status query served at
  the `$X` end-of-line check point returns `<Alarm|...>` before `$X` executes → KerfDesk rejects the
  Unlock ("Controller entered Alarm."), keeps alarmCode, zeroes pendingUntrackedAcks and advances
  the write epoch; GRBL then prints `[MSG:Caution: Unlocked]` + `ok` (orphaned). In a
  probe-alarmed tool-change hold an `error:N` reply to that `$X` would be attributed to the held
  stream (traced only): auto-stop soft reset + job errored.
- kerfdesk evidence: `src/ui/state/laser-status-line.ts:252-293` `handleInvalidatingStatus` runs on
  every Alarm/Sleep report: `advanceWriteEpoch`, `pendingUntrackedAcks: 0`,
  `cancelControllerLifecycleRefs(...'Controller entered Alarm.')`; only Home has a stale-reply
  window (`laser-home-alarm-reply.ts:27-37`); `src/ui/state/laser-autofocus-actions.ts:28-44`
  `unlockAlarm` owned exchange.
- upstream evidence: protocol.c:79-105 (end-of-line check point runs protocol_execute_realtime,
  then executes the line; `$` lines run in Alarm); system.c:160-168 `$X`; main.c:88 RX flushed only on reset.
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L79-L105
- reproduction: `src/__audit_repro__/ST/alarm-report-drops-owed-ack.test.ts` (fails: outcome
  "Controller entered Alarm.", alarmCode 1).
- fix (local): invalidate only on the transition into Alarm/Sleep (previous report not Alarm), and
  do not zero owed acks for lines written after that transition; ALARM:N lines and reboot banners
  already own the ledger reset.

### ST-5 — A programmed spindle spin-up dwell is announced as "CONTROLLER HOLDING PROGRAM"
- severity: low (misleading live-bar text and log line)
- verdict: CONFIRMED (reproduced on the pure stall/hold functions)
- status: new
- failure scenario: every CNC job start and tool-change Continue writes `M3 S…` then
  `G4 P<spinup>`; GRBL reports Idle and withholds the G4 `ok` for the whole dwell. With a spin-up
  ≥3 s (default 3 s; VFD spindles commonly 5-10 s) the bar switches to "CONTROLLER HOLDING PROGRAM
  — The controller reports Idle and has not acknowledged the last N sent lines…" and the log records
  "[lf2] Controller holding program … KerfDesk is connected and waiting" although the controller is
  executing the program.
- kerfdesk evidence: `src/ui/state/laser-stream-hold.ts:48` `STREAM_HOLD_VISIBLE_MS = 3_000`,
  `:66-82` `streamHoldFromProbe` ignores what the head in-flight line is;
  `src/ui/state/laser-stream-stall.ts:30-55`; `src/core/output/cnc-grbl-transitions.ts:116-129`
  `appendSpindleStart` writes `G4 P<spinupSec>`; `src/core/scene/machine.ts:274` default 3 s.
- upstream evidence: motion_control.c:195-200 mc_dwell (sync then delay);
  nuts_bolts.c delay_sec serves realtime every 50 ms (state Idle).
  https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L195-L200
- reproduction: `src/__audit_repro__/ST/stream-hold-during-dwell.test.ts` (fails: hold reported at 4 s
  into a 5 s dwell).
- fix (local): when the oldest in-flight line is `G4 P<s>` (or `M3`/`M4` sync) and less than its
  programmed time plus a margin has elapsed, report "Dwelling (spindle spin-up)" instead of a hold.

## Checked and correct (so far)
- RX window: GRBL ring holds 128 bytes (serial.c:24, :37-42); KerfDesk default 120, `Bf:` free − 8,
  count includes the `\n`, never sends `\r`, realtime bytes excluded, oversized lines refused at Start.
- grblHAL `Bf:` RX value is free bytes of the driver ring (report.c:1341-1346; stream.h RX 1024);
  KerfDesk latches it only with nothing in flight and bounds the window by it.
- `error:N` mid-stream: GRBL keeps parsing RX lines (wiki reservation); KerfDesk pops the head line,
  goes terminal, soft-resets at once, absorbs trailing acks. grblHAL COMPATIBILITY_LEVEL 0 repeats
  the error for later G-code lines (protocol.c:266-286) — absorbed identically.
- ALARM:1/2 enter the critical loop until reset, RX flushed at re-init (protocol.c:226-236,
  main.c:88); ALARM:3/6-9 come from mc_reset; KerfDesk wipes in-flight on ALARM:N — consistent.
- Soft-reset paths (Abort, error auto-stop, disconnect transaction, probe recovery, wake) all end in
  the banner handler that zeroes the ledger, bumps the epoch and wipes in-flight.
- Pause = 0x84: honoured without a door input (serial.c:158, system.c:87-93); settled Door:0/1 or
  Hold:0 plus `Ov:`-without-`A:` beam-off proof; `~` only acts on a completed hold (protocol.c:336-349).
- G4/M3/M5/M8/M9 sync via protocol_buffer_synchronize (motion_control.c:195-200, gcode.c:942-958);
  G4 `ok` proves the planner drained, not that an M3 laser is off (stepper.c:397 only M4); KerfDesk
  relies on M5 in the postamble and on `A:` for pause proof, not on G4.
- `?` served every 50 ms during dwells (nuts_bolts.c delay_sec) → 2 s heartbeat safe; 4 Hz poll ≤ wiki 5 Hz.
- Jog cancel 0x85 only in STATE_JOG (serial.c:159-163); KerfDesk re-sends only after a fresh Jog report.
- Worker refill parity: same pure onAck/step and the same classifier; divergence only via ST-1(b).

## Not covered / leads for other tracks
- grblHAL MPG takeover (lead, PLAUSIBLE): console recovery lines and manual air-off are allowed while
  MPG owns control, but grblHAL disables host RX in MPG mode and resets the read buffer on exit
  (grblHAL core stream.c:818-849); their owed acks may never arrive, and a paused stream claims any
  terminal ack while `status === 'paused'` (laser-store-helpers.ts:149). Driver-level `disable_rx`
  semantics were not traced.
- grblHAL sticky G-code error (lead for console/grblHAL tracks): with COMPATIBILITY_LEVEL 0
  (config.h:97 default) a failed G-code line leaves `gc_state.last_error` set, so every later G-code
  line is skipped and answered with the same `error:N` until a `$` command, empty line or reset
  (protocol.c:246-286). Mid-stream this is absorbed (terminal stream + reset), but G-code-only
  operations after a console error (Frame's M5/M9 prelude, Zero Z, air) can fail with a stale error.
- FluidNC: 120-byte profile window is below its 256-byte UART ring and its channel queues bytes
  while the planner is full (Channel.cpp:211-240); not exercised further.
- Frame-first modules (framed-run*.ts, laser-frame-status.ts, laser-frame-dispatch.ts) were read for
  stream interplay only; permit logic left to the Frame track.
