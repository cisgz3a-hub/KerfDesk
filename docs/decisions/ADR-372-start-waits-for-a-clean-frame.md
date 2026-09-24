## ADR-372 - Start stays greyed out until a clean Frame, and never runs one itself (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the Start entry of ADR-237: a Start without a permit no longer runs the Frame. The
Frame-only Start policy of ADR-228/230/232 is unchanged. A completed Frame of the exact job is
still the only Start gate, and a permit still names exact bytes. Hardware qualification remains
separate.

### Context

The maintainer reported a 1 h 31 min job that would not start. The Frame had traced the job's
outline, and the rail then read "Last Start attempt blocked" with two reasons: "Frame traced the
job's outline, but the exact job could not be prepared. No Start permit was issued." and "The job
or machine setup changed during preparation. Preparation was cancelled; try again with the
current job." Nothing about the job or the machine had changed.

The cause was in ADR-353's split Frame. The Frame traces a dense job's outline while the exact
program is still compiling. The preparation owner cancelled that compile on any change to the
status report since the Frame was pressed, comparing state, MPos and WPos exactly. The trace's own
motion is such a change, so on a real controller the Frame cancelled the program it was waiting
for, and no permit could follow. #901 fixed this on `main` by binding the preparation to the exact
Frame operation that owns the motion. This decision's regression test, whose trace reports the
head moving, reproduced both messages before that fix and issues the permit with it.

The primary action made the failure worse. With no permit, Start read **Set up & Frame** and ran
the Frame itself, so the Frame's failure was reported as a blocked Start. Maintainer direction,
2026-09-24: "change the set up & frame button to start. grey it out until a frame is complete. if
a frame finishes without hitting a limit switch start can fire." The same message asked for every
remaining block to be audited again.

### Decision

1. **Start waits for the Frame.**
   - The primary action always reads **Start**. It stays greyed out until a clean Frame of the
     exact current job has issued a permit.
   - Beside it, the status line reads "Not framed — Frame this job to unlock Start" or says why
     the last Frame expired. For a split Frame, the permit arrives with the exact program, and
     the status line says the job is being finished.
   - **Frame job** is the only way to Frame, and it carries the in-place Home, Unlock and Set
     origin offers (ADR-367).
   - Start never runs a Frame. Ctrl+Return without a permit only says what to do.
   - A Frame that finishes cleanly issues the permit. Start then opens the single Job Review
     (ADR-237) and streams those exact bytes.
2. **The expiry reason is kept** (ADR-362 Amendment 1, item 2). It is shown in the status line and
   in the shortcut's message ("… Frame the job again to unlock Start.") until the next Frame
   begins. It no longer says that Start is framing the job again.
3. **The audit found no policy refusal after a clean Frame.** The full inventory is in
   `docs/audits/2026-09-24-post-frame-start-block-audit.md`. Every refusal between a clean Frame
   and the first program byte belongs to one of the three factual classes of rule 7: the
   transport cannot accept work, the program cannot be produced or streamed, or the reviewed
   artifact cannot be handed off consistently. The two defects the maintainer hit came before a
   permit existed, and both are fixed on `main`:
   - the split Frame cancelling its own program (#901);
   - Absolute refusing a work offset reported after homing (#852).

### Evidence and limits

- `use-frame-action.split-frame.test.ts`, against #901's implementation:
  - A trace that reports Jog at another position, then Idle back at the start, before the program
    arrives still issues the permit.
  - Job Review's Frame-first check (`requiredFrameIssueFromPrepared`) accepts that permit.
  - A real WCO change during the trace still issues none.
- `frame-blocker-repair.simulator.test.ts`: Start without a permit makes no offer, sends nothing
  to the controller, and points to Frame job.
- Unit and end-to-end tests that pressed Start twice (once to Frame, once to Start) now call Frame,
  then Start. End-to-end locators use the **Start** name.
- No machine was available. The behaviour is proven with store-level and simulator tests, not on
  the Falcon or any other controller.
- Not addressed here, recorded in the audit:
  - A controller that enters Sleep clears the permit, because Sleep voids position trust. Whether
    the Falcon's `$152` standby reports Sleep is unverified.
  - Any jog after a Frame expires the permit by design, because the Frame is the spatial proof.
