## ADR-411 Amendment 1 - Every Pause of a job can lift, and the lift keeps the operator's overrides (2026-09-27)

**Status:** Accepted (maintainer chose "Fix the lift" on the pause re-audit card). | **Date:** 2026-09-27

### Context

The pause re-audit of 27 September (findings PR-9 to PR-12 and PR-14) ran Pause and lift
against the jobs KerfDesk generates today. Every stop in the cut on 11 job types lifted with the
default settings, but the lift itself had five gaps:

1. **Only the first Pause lifted (PR-9).** The lift's soft reset reboots the controller, and every
   boot banner clears the settings KerfDesk read on connect, including laser mode (`$32`) and the
   `$I` build options. They are read again only after the job ends. Decision 1 requires `$32=0`
   to be confirmed, so the second Pause of a job kept the door pause and Resume spun the bit up
   in the cut. Reproduced on the GRBL simulator.
2. **Overrides came back at 100% (PR-10).** Stock GRBL resets feed, rapid and spindle overrides on
   every reset (`main.c`). grblHAL does the same for the spindle, and for feed and rapid unless its
   keep-override settings are on (`grbllib.c`). A cut the operator had slowed resumed at full feed.
3. **A spin-up time of 0 s turned the lift off (PR-11).** Machine Setup and preflight accept 0 s,
   the output then has no `G4` after `M3`, and ADR-411 decision 3 refused every lift without that dwell.
   The output code's comment still said preflight rejects values of 0 or less.
4. **A skipped lift said why only in the log (PR-12).** The advice beside Resume showed the door
   resume text, and a lift skipped because the door input was open was never tried again.
5. **A failed lift was filed as a controller error (PR-14).** The Interrupted job card then said
   "The controller rejected the stream" and told the operator the spindle might still be
   spinning. After a failed lift, KerfDesk's own stop has switched the spindle off.

### Decision

1. **Settings checked once per job.** When a lift sends its reset, KerfDesk records, for that
   stream only, that `$32=0` and "no parking" were confirmed, and the report units (`$13`) it
   used. A later Pause of the same stream relies on that record while the settings KerfDesk read
   are cleared. This is sound because `$` settings and build options live in the controller's
   non-volatile memory and a soft reset does not change them, setup (`$`) lines are refused while
   a job is active, and any other reboot during the job ends the stream. The record ends with the
   stream. The advice beside Resume uses the same record, so it no longer calls laser mode
   unconfirmed after a lift. (The audit suggested reading `$$` and `$I` again after each lift.
   Setup lines are blocked during a job, and nothing that could change them can run, so the
   record gives the same proof without a mid-job settings read.)
2. **Overrides put back.** The lift records the overrides of the settled pause from the
   controller's own `Ov:` report. Once the bit is at safe height, it sends the realtime override
   bytes that take each override to that value from any starting point: a reset to 100%, then
   10% and 1% steps. Rapid goes back to 100%, 50% or 25%; any other rapid value is left alone.
   It waits for a fresh report that shows the values. If none arrives, the lift logs it and
   still finishes: the bit is up and the overrides stay adjustable while the job is paused.
   A controller that never reported `Ov:` has nothing recorded, and nothing is sent.
3. **Default spin-up.** When the program has no dwell after its latest `M3`/`M4`, the re-entry
   waits 4 s at safe height. This is stock GRBL's own door-resume delay
   (`SAFETY_DOOR_SPINDLE_DELAY`). Waiting above the work costs only time. This replaces "There is
   no lift without one" in ADR-411 decision 3.
4. **A skipped lift is shown and retried.** The reason a Pause left the bit in the cut is kept
   with the stream and shown first in the advice beside Resume, followed by the door-resume
   advice that still applies. Resume on such a pause tries the lift again before anything else.
   If it lifts, Resume continues straight into the re-entry (ADR-411 decision 5). If it is refused
   again, the door resume runs as before. If it fails after its reset, the job ends as in
   ADR-411 decision 6. A retry refused for the same reason is not logged twice.
5. **A failed lift is a stop from the app.** Its interruption is filed as `cancelled`, with the
   lift's own message. The CNC extraction guidance then says the job was stopped from the app
   and the spindle was commanded off, and asks the operator to free a stopped cutter by hand.
   ADR-215 Amendment 1's position-lost rule is unchanged.
6. **Safe height since the last bit change.** The lift height is the highest rapid Z between the
   latest tool-change `M0` and the resume line, not the highest in the whole program. Heights
   from before a bit change were set against the old bit's Z zero, and the retract before a bit
   change may go to a park height far above the cut (ADR-491), which after a Z re-zero on a
   longer bit could run into the top of Z travel. KerfDesk's output lifts to safe height again
   after every `M0`, before its `M3`, so a stop after a bit change always has a height to use.
   This replaces "the highest rapid Z before the resume line" in ADR-411 decision 3. Found while
   checking the lift against the pocket stay-down and park height work.

### Consequences

- Every Pause of a job lifts when the first one could. Resume never spins up in the cut because
  an earlier lift cleared the settings evidence.
- The lift adds realtime override bytes to its reset sequence, and only when the operator had
  moved an override off 100%. They cost no receive buffer space and owe no acknowledgement.
- A job with a spin-up time of 0 s now lifts and waits 4 s above the cut on Resume.
- A Pause after a bit change lifts to the program's safe height, never to the bit-change park
  height. Jobs without a park height lift exactly as before: the output's heights never drop
  across a bit change.
- Resume may now soft-reset the controller when an earlier Pause could not lift. That is the
  same lift the Pause would have run. Its failure costs the job, as ADR-411 decision 6 already accepts.
- The GRBL simulator now models the realtime overrides and a safety-door input switch, so these
  cases are tested end to end: two pauses in one job, overrides at 70% feed and 80% spindle,
  a program with no dwell, and a Pause with the door open that lifts on Resume once it closes.
- **Still not hardware-verified.** Check with an air cut before cutting material.
