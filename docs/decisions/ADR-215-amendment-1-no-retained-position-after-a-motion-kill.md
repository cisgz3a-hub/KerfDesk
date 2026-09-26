## ADR-215 Amendment 1 - Retained position is not offered after a stop that may have killed the motors (2026-09-26)

**Status:** Accepted (maintainer approval in chat, 2026-09-26: "audit it again and then yes", in
reply to the proposal to stop offering "Position retained" after an Abort that lost position). |
**Date:** 2026-09-26

### Context

ADR-215 lets CNC pass recovery skip re-zeroing when the interruption was session-continuous: no
controller reboot was observed and the live work offset matches the offset archived with the run.

The work offset is the wrong evidence after a stop that killed the steppers mid-motion. Abort sends
GRBL's soft reset. In a cycle, a jog, homing, or a hold that is still decelerating, `mc_reset`
calls `st_go_idle()` and raises ALARM:3: "Force kill steppers. Position has likely been lost."
(`motion_control.c`). A hard limit (ALARM:1) does the same. A stored G54 offset survives the reset,
so the live offset still matches the archived one, and recovery offered "Position retained" for a
recut that could now be shifted by the steps the motors never took. KerfDesk's own alarm table
already says ALARM:3 means "Position is lost ... Re-home".

The 2026-09-24 CNC audit found this as MC-3. A re-audit on 2026-09-26 found the same gap on two
more paths: a run stopped by a position-losing alarm such as a hard limit, and the soft reset
KerfDesk sends by itself after a rejected line (`error:N`) while the controller is still running
the moves it had buffered.

The saved interruption cannot wait for the alarm. Abort marks the stream errored, and the
checkpoint tracker records the cause, before the reset byte is written, so ALARM:3 always arrives
after it.

### Decision

1. A stop that may have killed the motors mid-motion is recorded on the interruption as
   `positionLost: true`. It is persisted with the recovery capsule. A record without it reads as
   before, and any value other than `true` is rejected as corrupt.
2. Every soft reset KerfDesk sends against a running stream (Abort, the fail-dark stop, the
   automatic stop after a rejected line) records `streamReset` for that stream epoch, in or before
   the store update that marks the stream errored. It decides from the last status report. A soft
   reset may lose position in `Run`, `Jog`, `Home`, `Hold:1`, `Door:2`, `Door:3`, a `Hold` or
   `Door` report without a substate, and with no report. It keeps position at `Hold:0`, `Door:0`,
   `Door:1`, `Alarm`, `Sleep`, `Check` and `Tool`, and at `Idle` unless lines are still being
   streamed or every line was acknowledged but the planner may not have drained. A Pause or Resume
   still settling counts as moving, because the last report can be one poll behind. Unknown counts
   as moving: a wrong "moving" costs a re-zero, a wrong "stopped" costs a shifted recut. A later
   reset of the same stream never clears an earlier one's loss.
3. A run stopped by an alarm that GRBL or grblHAL documents as losing position (`positionLost` in
   `alarm-codes.ts`; code 10 loses position in either firmware's table) is marked the same way.
4. The retained-position check refuses a marked interruption, as it already refuses a reboot, and
   tells the operator to re-home, re-establish the XY/Z zero, and choose the re-zeroed option. The
   final wire-boundary re-check uses the same function.
5. This narrows when the retained-position evidence exists inside the supervised-recovery flow,
   which ADR-228 keeps as handoff consistency ("Kept - these are not guards"). Re-zeroed recovery
   stays open. Frame, ordinary Start and Job Review are unchanged (PROJECT.md non-negotiable 21).

### Alternatives considered

- **Keep "Position retained" and warn.** Rejected: the option is the operator's attestation that
  session-continuity evidence holds, and the controller's own ALARM:3 says it does not.
- **Record ALARM:3 when it arrives.** Rejected: the stop is already recorded by then, and rewriting
  a terminal record after the fact would race its settlement. The decision is made with the stop.
- **Have CNC Abort send the door byte and wait for the hold before resetting**, so an ordinary
  Abort keeps position (MC-3's second suggestion). Deferred: it changes Abort's timing on every
  controller and needs its own review.

### Consequences

- After an Abort mid-cut, a hard limit, or the automatic reset after a rejected line, pass
  recovery no longer offers "Position retained".
- Pause first, wait for the hold to finish, then Abort: the reset raises no alarm, position is
  kept, and "Position retained" stays available when the offset matches.
- Laser recovery reads the same interruption record and ignores the new field.

### Verification

- `job-stop-request.test.ts`: the moving and stopped verdict for every GRBL state, the stream-epoch
  rule, and that a later reset never clears an earlier loss.
- `checkpoint-interruption.test.ts`: the mark on the recorded cause; alarms 1, 3 and 10 lose
  position, 2 does not.
- `job-interruption.test.ts`: the storage round trip, older records, and corrupt values.
- `cnc-pass-recovery-model.test.ts`: the retained-position refusal and its wording.
- `laser-lifecycle.simulator.test.ts`, against the in-repo GRBL simulator: Abort mid-cut is
  recorded as lost and the simulator raises ALARM:3; Abort after a completed door hold is recorded
  as kept and raises no alarm; `error:N` then the automatic reset is recorded as lost with ALARM:3.
- Based on GRBL 1.1 source (`motion_control.c` `mc_reset`, `protocol.c` hold completion) and the
  simulator, not on hardware.
