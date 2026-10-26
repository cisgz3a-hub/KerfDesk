## ADR-648 - Settings are read in Alarm, step jogs queue, grblHAL sends WCO at once, and Marlin's Reset origin says what it sends

**Status:** Accepted; unit-tested, not hardware-tested. | **Date:** 2026-10-20

Amends the qualification scheduler of ADR-400 (connection, TC-1). The Frame-first Start contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged: nothing here adds
or removes a Start guard.

### Context

Two audits found convenience gaps that need no maintainer decision:
`docs/audits/2026-10-19-controller-behaviour-audit.md` (F-4) and
`docs/audits/2026-10-20-controller-protocol-audit.md` (P-3, P-4, and CS-05 carried over from the
2026-07-26 controller systems audit).

- **F-4.** Stock GRBL with homing enabled (`$22=1`) boots locked in Alarm and answers `$$` there
  (GRBL accepts `$` system commands in Alarm). The manual settings read allowed Alarm, but the
  automatic qualification scheduler required a fresh Idle
  (`automaticSettingsReadBlockReason`), so the common first connect sat at "Waiting to read
  controller settings…" until the operator unlocked or homed. `resumeQualificationInSession`
  also set the `reset-cleanup` phase for an in-session Alarm, so the notice said "Controller reset
  detected" when nothing had reset.
- **P-3.** Every jog proved a fresh Idle (`confirmFreshManualMotionIdle`), and the jog pad was
  disabled while any motion operation ran (`isJogPadDisabled`). Tapping an arrow three times
  quickly moved one step.
- **P-4.** After connecting to a board that does not reset on open, and after an origin change,
  KerfDesk waited for `WCO:` with bursts of `?`. GRBL sends `WCO:` only every few reports.
  grblHAL's `CMD_STATUS_REPORT_ALL` (0x87) loads every report flag and requests a status report
  (grblHAL core `grbl.h`; `protocol.c`, `protocol_enqueue_realtime_command`).
- **CS-05.** The Marlin driver declared `clearOrigin: 'G92.1'`. Marlin compiles G92.1 only with
  `CNC_COORDINATE_SYSTEMS` (off in stock builds), and a stock build acknowledges it while keeping
  the shift. The store already avoided it (Reset origin on Marlin writes a G92 that restores
  machine coordinates, audit CG-11), but the driver data, the Reset origin tooltip and its success
  toast all still said G92.1.

### Decision

1. **Automatic settings reads accept a fresh Alarm on a `$$` controller.** The scheduler
   (`laser-controller-qualification.ts`) records whether it saw the current Alarm report arrive
   in this controller session. An Alarm report carries no status observation, so only the
   scheduler can know it is fresh; a report that arrived before the schedule started does not
   count. `machineSettingsReadBlockReason` takes that as `freshAlarmObserved` and lets the read
   go ahead. This applies only to drivers with a settings dump (`commands.settingsQuery`, the
   GRBL family), and not after a halting reset (Smoothieware, `afterAlarm`), whose board refuses
   commands until M999 and still qualifies on the Idle after its Alarm. Sleep, Hold, Door and a
   running jog still wait for Idle. The build-information (`$I`) and modal-state (`$G`) reads
   that follow `$$` are `$` commands that GRBL also answers in Alarm.

   An in-session Alarm or Sleep that ends the connect handshake now sets a new qualification
   phase, `awaiting-ready` ("Waiting for the controller to be ready before reading its
   settings…"), instead of `reset-cleanup`. The persisted execution-provenance validator accepts
   the new phase.

2. **Step presses join a running operator step jog.** A step press from the jog arrows or the XY
   jog keys calls `jog(params, undefined, { queueStep: true })`. The first press runs as before,
   with its fresh-Idle proof, and marks its jog operation with `stepJogQueue` (controller session
   and planned end position). While that operation runs, a further step press on a native-jog
   controller with a jog-cancel byte (`canQueueStepJog`, `step-jog-queue.ts`) appends its `$J=`
   line to the operation's `pendingLines`, ahead of the planner-drain marker. At most three steps
   may be owed at once, the running one included.

   KerfDesk holds a queued step itself: it is dispatched like a Frame leg, after the step before
   it reached Idle and its acknowledgement and transport settled. It is not written into the
   controller's buffer at once, as the audit's note on GRBL's own jog queue suggested, because
   stock GRBL's 0x85 empties only the planner and leaves received but unparsed lines to run
   (`serial.c`). Holding the step in KerfDesk means Cancel stops everything on every GRBL-family
   firmware: its `cancelRequested` keeps every pending line from being dispatched, and 0x85
   stops the running step. Steps therefore run one after another with a short stop between them.

   While such a jog runs, the jog pad keeps only the XY arrows and keys live, as single steps.
   Press-and-hold continuous jog, Z focus, the step and speed rows and every other control wait
   for it to finish, as before. A press-and-hold, a jog to a point and an owned (remote or
   rotary-test) jog start no queue. The warn-only bounds and no-go checks of a queued step start
   from the planned end of the steps before it.

3. **grblHAL sends its complete report on request.** `ControllerRealtime` gains an optional
   `completeStatusQuery` (grblHAL `'\x87'`; absent for every other driver).
   `requestControllerStatus({ complete: true })` sends it where the driver has one, and the
   ordinary status query otherwise. KerfDesk sends it once at the end of the connect handshake,
   and at the start of `waitForUnreportedFrameWorkOffset` (Frame) and `waitForOriginWcoFrame`
   (Set origin). The byte is a single realtime byte, inert to the planner, and owes no
   acknowledgement. No UI code holds the byte.

4. **"Can clear G92" is its own capability.** `ControllerCapabilities.transientOriginClear` says
   how Reset origin clears a transient origin: `'g92.1'` (GRBL family, Smoothieware; the default)
   or `'machine-frame-g92'` (Marlin). `wcs` keeps saying whether an origin can be set. Marlin's
   `clearOrigin` is now `null`, because no fixed line clears its origin on a stock build.
   `resetOrigin` takes the restoring-G92 path on `transientOriginClear`, not on
   `workOffsetSource`. The Reset origin button keeps Clear origin for Marlin rather than hiding
   it, because the restoring G92 is correct whenever KerfDesk recorded the shift (Set origin
   writes `G92 X0 Y0` at a known machine position, and homing or a restart clears it); it is
   disabled, with the existing "does not know the machine position" message, until a position
   report makes that position known. Its tooltip and success toast name the G92 it sends instead
   of G92.1. A shift set before KerfDesk connected stays invisible to it, as before.

### Consequences

- A stock GRBL board that boots in Alarm is qualified within about a second of connecting, while
  its Alarm banner still asks the operator to Home or Unlock before motion.
- Quick taps on a jog arrow move the head as many steps as were tapped, up to three at a time.
- On grblHAL, a Frame or Set origin right after connecting no longer waits for GRBL's report
  count to bring the work offset.
- Marlin's Reset origin describes the command it really sends.

### Needs a hardware check

- F-4: connect to a stock GRBL board with `$22=1` that boots in Alarm; settings should read before
  Unlock, and the notice should not mention a reset.
- P-3: tap a jog arrow three times quickly on GRBL, grblHAL and FluidNC; then tap three times and
  press Cancel during the first step: the head should stop and no queued step should run.
- P-4: on grblHAL, check that 0x87 answers with a report that carries `WCO:` (the parser already
  reads grblHAL's extra fields).
- CS-05: Reset origin on a stock Marlin build after Set origin.
