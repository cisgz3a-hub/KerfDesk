## ADR-367 - Start stays greyed out until a clean Frame, and the Frame's own motion never cancels its program (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the Start entry of ADR-237 (a Start without a permit no longer runs the Frame) and fixes
a defect in ADR-353's split Frame. The Frame-only Start policy of ADR-228/230/232 is unchanged:
a completed Frame of the exact job is still the only Start gate, and a permit still names exact
bytes. Hardware qualification remains separate.

### Context

The maintainer reported a 1 h 31 min job that would not start. The Frame had traced the job's
outline, and the rail then read "Last Start attempt blocked" with two reasons: "Frame traced the
job's outline, but the exact job could not be prepared. No Start permit was issued." and "The job
or machine setup changed during preparation. Preparation was cancelled; try again with the
current job." Nothing about the job or the machine had changed.

ADR-353 traces a dense job's outline while its exact program is still compiling off-thread. That
compile is watched by the preparation owner (`ownCurrentStartPreparation`). The owner cancelled
the compile on any change to the controller's status report since the Frame was pressed: state,
MPos and WPos, compared exactly. The trace moves the head, so its first status report was such a
change. On a real controller, the Frame therefore cancelled the program it was waiting for, and
no permit could follow. This hit every job slow enough to be split, which are the jobs ADR-353
was written for. The split-Frame tests traced without reporting any motion, so they never
exercised this. A test whose trace reports the head moving reproduces the maintainer's two
messages exactly.

The primary action then made it worse. With no permit, Start read **Set up & Frame** and ran the
Frame itself, so the Frame's failure was reported as a blocked Start. Maintainer direction,
2026-09-24: "change the set up & frame button to start. grey it out until a frame is complete. if
a frame finishes without hitting a limit switch start can fire." The same message asked for every
remaining block to be audited again.

### Decision

1. **The Frame's own motion is not drift.** When the split Frame dispatches its trace, the
   preparation owner stops reading the live status report. Its controller comparison and its
   coordinate key use the report from before the Frame instead. Every other watched input stays
   live: the project signature, the controller session, WCO, work-origin state and source, the
   trusted-position epoch, and the work-Z reference. A real setup change during the trace still
   cancels the program. From dispatch onward, the head's position is covered where ADR-353
   already covers it. The trace's clean completion requires the unchanged setup and a return to
   the pre-Frame work position within 0.001 mm. The trace's expiry then voids it on any later
   move, so a move after the trace now refuses the permit through the expired trace ("Frame
   completed, but the job or machine setup changed") rather than through a cancelled compile.
2. **Start waits for the Frame.** The primary action always reads **Start**. It stays greyed out
   until a clean Frame of the exact current job has issued a permit. Beside it, the status line
   says either "Not framed — Frame this job to unlock Start" or why the last Frame expired. For a
   split Frame, the permit is issued when the exact program arrives, and the status line says the
   job is being finished. **Frame job** is the only way to Frame. Start never runs a Frame, and
   Ctrl+Return without a permit only says what to do. A Frame that finishes cleanly issues the
   permit, and Start then opens the single Job Review (ADR-237) and streams those exact bytes.
3. **The expiry reason is kept** (ADR-362 Amendment 1, item 2). It is shown in the status line
   and in the shortcut's message ("… Frame the job again to unlock Start.") until the next Frame
   begins. It no longer says that Start is framing the job again.
4. **The audit found no policy refusal after a clean Frame.** The full inventory is in
   `docs/audits/2026-09-24-post-frame-start-block-audit.md`. Every refusal between a clean Frame
   and the first program byte belongs to one of the three factual classes of rule 7: the
   transport cannot accept work, the program cannot be produced or streamed, or the reviewed
   artifact cannot be handed off consistently. The defect the maintainer hit was not a policy
   gate. It was a factual check fed a false fact: the Frame's own motion read as a setup change.

### Evidence and limits

- `use-frame-action.split-frame.test.ts`:
  - A trace that reports Jog at another position, then Idle back at the start, before the program
    arrives: the Frame returns false with exactly the screenshot's two blocker messages before
    this change, and issues a permit after it.
  - Job Review's Frame-first check (`requiredFrameIssueFromPrepared`) accepts that permit.
  - A WCO change during the trace still cancels the program.
  - A move after the trace still refuses the permit.
- Unit and end-to-end tests that pressed Start twice (once to Frame, once to Start) now call Frame,
  then Start. End-to-end locators use the **Start** name.
- No machine was available. The fix is proven with a store-level trace that reports motion, not
  on the Falcon or any other controller.
- Not addressed here, recorded in the audit:
  - A controller that enters Sleep clears the permit, because Sleep voids position trust. Whether
    the Falcon's `$152` standby reports Sleep is unverified.
  - Any jog after a Frame expires the permit by design, because the Frame is the spatial proof.
