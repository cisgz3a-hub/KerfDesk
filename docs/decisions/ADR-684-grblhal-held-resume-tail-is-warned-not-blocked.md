## ADR-684 - A laser Resume that leaves grblHAL Idle at the end of a job warns that the controller may still hold the paused move (2026-11-01)

**Status:** Accepted on 2026-11-01 (maintainer: "warnings are fine, but no start blockers").
Unit-tested through the real store, Job Review rows and the machine-rail notice. The firmware
behaviour was reproduced in the grblHAL Simulator on the real core; not hardware-tested. |
**Relates to:** ADR-180 Amendment 2 (Pause sends the safety-door byte), ADR-224 (Job Review
controller facts), PROJECT.md non-negotiable 21 and ADR-565 (frame-first Start), unchanged.

### Context

The live-loops audit (`docs/audits/2026-11-01-live-loops/LL1-upstream-drift.md`, finding
LL1-P1-1, refuter-confirmed in `LL1-C1-refuter.md`) pulled grblHAL's changelog at head
`4ec1ae44`. Build 20260928 says: "Fix for potential loss of position after a feed hold during end
of move. Ref. issue #1024." (fix commit `451a539c6`).

- **The defect.** A hold that completes in the last ~90 ms of the last planned block clears the
  whole step control (`state_machine.c:491-492` at core `04a5edcf`). Segment preparation then
  finishes the block, and the planner discards it. Cycle start finds no planner block, so the
  controller goes Idle short of the block's end. The prepared segments stay in the segment buffer,
  each with its own laser PWM (`stepper.c:409-410`), and run when the next motion starts.
- **Field firmware.** Core `04a5edcf` is the only mainline commit with `GRBL_BUILD 20231005`, the
  build the published Falcon A1 Pro units report (`[VER:1.1f.20231005:]`). It has this code.
- **KerfDesk reaches it.** A laser Pause sends `0x84` and goes through the same hold code.
  Pause stays offered after the last line is acknowledged while the controller runs (WORKFLOW
  F-B7, step 4). Resume accepts a fresh `Idle` as confirmation (`laser-job-pause-resume.ts`).
- **Reproduction.** The refuter built the grblHAL Simulator on core `04a5edcf` and on the fixed
  head, then drove it the way KerfDesk does. On the old core, 13 of 15 end-of-job pauses went Idle
  short of the burn's end. With M4 and the "After a job: Stay where the job ends" finish, 11 of 15
  then replayed the leftover burn at PWM up to 800 (S800) for 26-78 ms at the start of the next
  Frame, after the job's `M5`. On the fixed core, 0 of 15 did either.
- **No warning reached the operator.**

### Decision

1. **Record, then warn; never block.** A laser Resume is recorded as possibly holding the paused
   move's tail when all of the following hold:
   - it was confirmed through the safety door;
   - it had no stream bytes left to send;
   - the report that confirmed it was `Idle`, not `Run`;
   - the controller is grblHAL, by the driver or by the session's grblHAL evidence
     (`grblhal-evidence.ts`);
   - its `$I` does not report a build of 20260928 or later. KerfDesk does not read `$I` on the
     grblHAL driver, so the build is usually unknown, and an unknown build counts as affected.

   Pause stays offered exactly as before. Start, Frame, jog, Save and Job Review's Start button
   are not gated. This is a warning under AGENTS.md "Machine and output policy", not a refusal.
2. **Where the warning shows.**
   - A console line, written once.
   - A machine-rail notice with a **Reset (Ctrl-X)** button. The button is the existing soft reset
     (`wakeController`) and is disabled while a stream or controller operation is active. A soft
     reset empties the firmware's segment buffer. The operator chooses whether to press it.
   - A Job Review controller fact "Paused move" in the warning tone. The collapsed Controller
     summary also reads "may hold a paused move, reset first".
3. **The warning retires itself.** It stops showing when the controller session changes (any soft
   reset, reboot banner or reconnect) or when the machine position moves more than 0.001 mm from
   where Resume confirmed. In both cases the tail is gone: a reset clears it, and a motion has
   already run it.
4. **Wording.** The warning says what happened ("Resume ended with the controller Idle before it
   moved again") and what grblHAL builds before 20260928 can do. It does not claim the beam will
   fire, because that depends on the finish, the dialect and the timing.

### Consequences

- An operator who pauses at the very end of a grblHAL job sees why the last line may be short,
  and gets a one-click way to empty the controller before the next Frame. No workflow loses a
  step.
- **False positives.** A Pause pressed after motion had already finished also resumes to `Idle`,
  so it shows the warning too. The warning reads "may" and retires at the next motion.
- **Not covered.** A standalone Frame or jog has no dialog before it moves. The rail notice is
  the only warning there, and it is not shown while the machine panel is collapsed.
  - Builds that report `$I` on a stock-GRBL profile are judged by their `[VER:` date.
  - The one-step loss of #1023 (0.0125 mm on the A1 Pro) is not detected.
- No new Start guard, account, licence or entitlement check is added.
