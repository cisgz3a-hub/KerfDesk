## ADR-411 - CNC Pause lifts the bit out of the cut, and Resume re-enters from above (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Narrows ADR-180 Amendment 2 ("No retract") for one case: a same-session CNC Pause whose hold
has fully settled. Leaves ADR-143 and ADR-215 unchanged for everything they cover: a job that
ends (Abort, alarm, reboot, lost port) still recovers only as a new pass-boundary job. The
Frame-first Start contract (PROJECT.md non-negotiable 21) is unchanged; nothing here adds a Start
guard.

### Context

The maintainer's requirement: a paused router job continues where it stopped instead of
restarting, and the bit never starts spinning inside the wood. It must retract, spin up, then
continue.

ADR-180 Amendment 2 met the first half. Pause sends the safety-door byte, GRBL stops in place and
switches the spindle off, and Resume restores the spindle and continues the same line. It did not
meet the second half. Stock GRBL has no parking, so the spindle restarts with the bit still in the
cut. Amendment 2 rejected a host-side lift because it "would require abandoning the door hold for
a drain-to-Idle pause, reintroducing a re-entry seam." This decision builds that seam and bounds it.

GRBL cannot move while it holds a job. The only way out of a Door or Hold state that keeps the
job is cycle start, which restarts the spindle in place. The other way out is a soft reset, which
discards the job. So a lift means a reset, and a reset means the host must replay the job.

What a reset does at a settled hold was read from the firmware (gnea/grbl `bfb67f0c`, grblHAL
core `d7aaee3d`):

- **No alarm.** `mc_reset` raises ALARM:3 only when the machine is moving or still executing a
  hold (`STEP_CONTROL_EXECUTE_HOLD` or `STEP_CONTROL_EXECUTE_SYS_MOTION`). When the hold completes,
  `EXEC_CYCLE_STOP` in `protocol_exec_rt_system` clears both flags, so a reset at Door:0 or Hold:0
  finds nothing to kill. This holds even with motion still queued. grblHAL's `mc_reset` has the
  same test. The GRBL simulator used to raise ALARM:3 here; it is corrected and tested.
- **Position is kept.** `sys_position` survives the reset, and the controller comes back Idle
  (`protocol_main_loop`), unless the door input is physically open.
- **The frame may not come back.** GRBL clears the G92 offset and any tool length offset. A `$N`
  startup block runs and may change modal state. grblHAL can keep G92.
- **Laser mode.** With `$32=1`, M3 does not turn the spindle while the machine is idle, so a
  spin-up above the cut is only possible with `$32=0`.
- **Parking.** A build with parking (`P` in `$I`) already retracts in its door state and restores
  on resume.

### Decision

1. **When the lift runs.** After a confirmed CNC Pause, KerfDesk lifts only if all of these are
   true. Otherwise it logs why and keeps the ordinary door pause (ADR-180 Amendment 2):
   - the controller is GRBL 1.1 or grblHAL;
   - `$32=0` is confirmed;
   - the build has no parking;
   - no pendant (MPG) is in control;
   - the latest report is Door:0 or Hold:0;
   - the work offset is known;
   - the re-entry below has a plan.
2. **Where the job re-enters.** The stop point is the paused work position. It is matched, within
   0.1 mm in 3D, against the toolpath of the lines the controller may still have been running.
   These are the acknowledged lines inside the pass-recovery planner window (ADR-215), plus the
   first unacknowledged line. GRBL acknowledges an arc only when all its segments are planned, so
   an arc can already be moving. The window stops at an acknowledged tool change. The **earliest**
   matching line wins: replaying too early only recuts, while replaying too late could skip
   material. A straight line re-enters at the stop point. An arc re-enters at its start and must
   name its own G2/G3.
3. **What the program must give.** These come from the program itself, never guessed:
   - The safe height is the highest rapid Z before the resume line.
   - The spin-up time is the `G4 P` dwell after the latest M3/M4. There is no lift without one.
   - The plunge feed is the feed of the latest straight-down G1.
   - The program must stay inside a supported subset of codes.

   There is no lift when:
   - the spindle is off;
   - the bit already stopped at or above safe height;
   - the program uses anything outside G0-G4, G17, G21, G40, G54, G90, G91.1, G94, M0/M1 and
     M3-M9.
4. **The lift.**
   1. KerfDesk soft-resets the settled hold.
   2. It waits for the reboot and a fresh Idle report.
   3. It checks the machine position is unchanged within 0.01 mm.
   4. It restates `G21 G90 G54 G94 G17`.
   5. If the work offset changed, it writes one `G92` that puts it back, and verifies it.
   6. It sends `G0 Z<safe>`.

   Every line goes through the command arbiter one at a time and must reach its target on a fresh
   Idle report. The paused stream survives the reset, because the boot banner that answers the
   lift's own reset is recognised and does not end the job.
5. **The re-entry.** Resume on a lifted job first re-checks: the controller is Idle, no pendant,
   and the work offset is unchanged. Then it sends, one at a time:
   - the modal line;
   - `G0 Z<safe>`;
   - `M3`/`M4 S<rpm>`;
   - the program's `G4 P<spin-up>`;
   - its M7/M8;
   - `G0 X Y` over the entry point;
   - `G1 Z<entry> F<plunge>`;
   - the motion mode and feed that were in effect.

   Then it rewinds the stream to the resume line and sends on as a resumed stream.
6. **Failure.** Before the reset, anything that fails leaves the ordinary door pause. After the
   reset, the controller no longer holds the job, so any failure ends it with Abort's reset. This
   includes a refused line, a timeout, an alarm, a moved frame, or a lost port. The notice "Pause
   and lift stopped" says what failed. Pass recovery (ADR-215) takes over from the Interrupted job
   card.

   The lift's own moves run while the stream stays paused, so a status report one poll behind can
   read Idle while the bit travels. A reset sent while the lift is lifting or returning, by Abort
   or by a failed lift, is therefore recorded as one that may have cost position (ADR-215
   Amendment 1), and pass recovery asks for a re-zero. Two cases keep the report's verdict: a lift
   whose line the controller refused, because that line never ran and every lift move before it
   was seen to arrive; and Abort once the bit is parked above the cut.
7. **Controls.** While lifting or returning, the primary control reads **Lifting…** or
   **Returning…** and is disabled; only Abort interrupts. A lifted job ignores a second Pause. The
   advice beside Resume describes the lift, not the door resume.

### Consequences

- A paused router job no longer spins up with the bit in the cut, and it continues from where it
  stopped. The bit spins up at safe height with the program's own dwell and goes back down into
  its own kerf at the program's plunge feed.
- A lifted job is no longer held by the controller. Any failure after the reset costs the job, not
  just the pause. This trade is accepted because the alternative is the in-cut spin-up the
  maintainer ruled out.
- The reset clears Work-Z evidence (ADR-203) and homing proof, as every reset does. The lift
  restores the XY work origin it verified, but not the Z evidence. The next job asks for a Z zero
  as usual.
- The replay recuts from the start of the matched line. For an arc, that means from the arc's
  start.
- **Not hardware-verified.** The lift and re-entry are tested against the GRBL simulator only.
  Check it with an air cut before cutting material.
