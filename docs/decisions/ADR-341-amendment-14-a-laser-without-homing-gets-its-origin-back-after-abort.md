## ADR-341 Amendment 14 - After the operator's Abort, a laser without homing gets its origin back by itself (2026-11-11)

**Status:** Accepted (user annoyance audit A1, area A3, decision A3-D-1; approved by the maintainer
on 2026-11-11). Amends Amendment 11 Decision 3. Leaves ADR-398 Amendment 8 and ADR-215 Amendment 1
as they are. |
**Date:** 2026-11-11

### Context

- ABORT JOB sends the realtime soft reset at once, so the beam is off at once. That is deliberate:
  ADR-398 Amendment 8 did not adopt a feed hold first, because it keeps the beam on while the head
  slows, and ADR-215 Amendment 1 deferred hold-then-reset for Abort.
- Stock GRBL and FluidNC then report `ALARM:3` and forget a Set origin here origin (G92). The rail
  shows "You stopped the job" with **Restore saved origin**, **Set origin here** and
  **$X — Unlock** (Amendment 11).
- On a laser without homing the main action moves nothing: Unlock, a fresh Idle report, one `G92`.
  Yet every Abort cost a click before the next Frame, and the plain Unlock beside it leaves the
  position withheld (audit finding A3-P2-1). The audit listed it as the maintainer's own earlier
  choice; the maintainer approved the change.

### Decision

1. **The card's main action runs by itself, once, when it is the motion-free one.**
   `abort-auto-restore.ts` calls the card's own `restoreOriginAfterAbort(saved, false)`: Unlock,
   wait for Idle, one `G92`. It adds no second way to restore, and it sends no Home, no jog and no
   rotary turn. All of the following must hold (`abort-auto-restore-eligibility.ts`):
   - the alarm is `ALARM:3`, and it answers the operator's Abort of the current stream
     (`operatorAbortAlarm`), which KerfDesk recorded as a reset into motion;
   - the stopped job was a laser job (`JobStopRequest.jobMachineKind`, read with the origin before
     the stop clears it), and the open project is a laser project;
   - the Abort saved a G92 origin (`originAtStopMm`);
   - no rotary is active, on Y or on its own axis;
   - the profile has homing off;
   - machine zero has not moved since (Amendment 13);
   - no reset is required, and the controller has an Unlock command;
   - the controller is stock GRBL or FluidNC, the two that clear the origin;
   - there is no safety notice, and the status report shows no door or E-stop input;
   - no origin is set and the position is not withheld, either of which means someone has already
     unlocked or set an origin.
2. **It waits for the controller to settle.** The alarm must be seen on two status reports with
   the controller connected, reporting Alarm, no job, no controller or motion operation and no
   reply owed. On the simulator the first Alarm report came about 0.6 s after the Abort, and the
   idle poll asks once a second. Before the first command it judges the same conditions once more.
   A controller whose alarm has not arrived and settled 10 s after the Abort keeps the card.
3. **Once per Abort.** The decision is keyed by the stop request and watched from the Abort itself.
   - It never runs again for that Abort, whether the restore worked, failed, or was not allowed.
   - A press on any card button before it starts makes the recovery the operator's, and it does
     not run.
   - The stop request stays the current stream's until the next job, so a later `ALARM:3` (an
     aborted Frame) shows the card for it again. That alarm never restores: the first alarm being
     cleared, the 10 s passing, or a newer stream each end the watch for good.
   - An Abort that was already on screen when the watcher was installed (a remount) is left alone.
     After a reload the stop request is gone and the connection is new, so nothing runs.
4. **The operator is told in one toast:** "Stopped. The laser is off and your origin is restored.
   Frame to check before starting again." The interrupted job's card and its Review recovery stay
   in the rail as before.
5. **A restore that does not happen is told.** The toast reads "Stopped. The laser is off, but
   your origin was not restored automatically: …" with the reason. When the alarm is still there,
   the card stays with its normal buttons and the line "Your origin was not restored
   automatically: … Use the buttons above." When the Unlock went through and the `G92` did not,
   Frame's offer puts the saved origin back (Amendment 12 Decision 5).
6. **Everything else keeps the card as it was:** a CNC job (work Z must be zeroed again), a profile
   with homing (Home moves the head), a rotary, a moved machine zero, grblHAL (it keeps the
   origin), a controller that raises no alarm, any other alarm code, and every stop that was not
   the operator's own Abort (crash stop, watchdog stop, app closing, disconnect, a controller
   alarm).
7. **The Pause tooltip names the stop that keeps position.** For a laser job on a controller with
   a realtime hold, the Pause button's tooltip adds: "For a stop that is not urgent, Pause first,
   wait for the head to stop, then ABORT JOB: the controller then keeps its position." This is
   ADR-215 Amendment 1's rule (a reset after a finished hold raises no alarm). The safety sentence
   stays first. It speaks of position only: that reset still clears a G92 origin on stock GRBL and
   FluidNC, and Frame offers it back.

### Consequences

- Abort itself is unchanged: the same reset, at the same moment, with the same cleanup. No Start
  permit is issued or kept. The reset cleared the Frame evidence, so Start still needs a Frame.
- No refusal is added, widened or removed (ADR-228).
- The automatic step unlocks a controller the operator stopped, as their own click on the card
  would. It sends only `$X` and one `G92`, and neither is a motion or a spindle command.
- The restored origin is exact in the controller's own count. Steps lost when the reset killed the
  motion are not in that count (Amendment 11 Consequences); the toast asks for a Frame.
- A Pause followed by Abort raises no alarm, so this amendment does not apply to it. On stock GRBL
  and FluidNC the origin is still cleared there, and the next Frame offers it back as before.

### Alternatives considered

- **Hold first, then reset, so the alarm never happens.** Not adopted, for the reasons in ADR-398
  Amendment 8 and ADR-215 Amendment 1: the beam would stay on while the head slows.
- **Run it on machines with homing too.** Rejected: there the restore homes first, and a head that
  moves by itself after an Abort is not acceptable.
- **Unlock only.** Rejected: it leaves the position withheld and the origin cleared, which is the
  chore this removes.

### Verification

- `abort-auto-restore.test.ts`: the verdict for the eligible case and for each excluded case; the
  two-report settle; once per Abort; never after a card button; the 10 s window from the Abort; a
  later alarm on the same stop request; an Abort already on screen; the second judgement before
  the command; a failure's toast and record; the Pause tooltip.
- `abort-auto-restore.simulator.test.tsx`, on the GRBL simulator with the real store, checkpoint
  tracker, Frame and Abort:
  - **Laser, no homing:** after ABORT JOB the controller ends Idle with the work offset the job
    ran with. After the reset byte only the cleanup, one `$X` and one `G92` are sent: no jog, no
    Home, no motion word, no `M3`/`M4`, no non-zero `S`. The head has not moved, the toast is
    shown once, the interrupted job keeps its recovery record, no Frame evidence came back, 15 s
    more sends nothing, and the next Frame runs from the restored origin.
  - **Homing on, a CNC job, machine zero moved:** the alarm and the card stay, and no `$X` or
    `G92` is sent. The CNC case sets the job's recorded kind on a simulated laser run; a CNC job
    was not run end to end. The moved machine zero is set in the store.
- `AbortStoppedCard.test.tsx`: the card holds its buttons while the restore runs, shows a failure
  with its buttons enabled, and a press on Unlock stops the automatic restore.
- No hardware was operated; the controller is simulated. FluidNC shares the stock GRBL path here
  and was not simulated separately.
