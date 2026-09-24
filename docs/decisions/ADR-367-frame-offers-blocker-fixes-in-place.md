## ADR-367 - The ordinary Frame offers its blocker fixes in place (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Follows ADR-228 (frame-first Start) and ADR-237 (Job Review at Start). The
Frame-only Start policy, the exact permit model and every refusal kept by
ADR-228 are unchanged. No refusal is added or widened. Hardware qualification
remains separate: this was verified against the scripted GRBL controller, not
a physical machine.

### Context

ADR-228 kept the transport and placement refusals and promised that they
"offer their fix in place": Alarm offers Home or Unlock, and a placement mode
without its origin offers Set origin. The offers live in
`start-blocked-fix-offers` and run from `runStartJobFlowWithCheckpoint`.

ADR-237 moved every ordinary Start through the dialog-free Frame
(`runFreshFramedJobFlow` → `runFrameNow`), which reports refusals through
`reportFrameRefusal` and never called the offers. Since then a plain Frame or
Start answered an Alarm or a missing origin with a red toast and a banner titled
"Last Start attempt blocked", and the Frame button was disabled in Alarm with
only a tooltip. The offers survived only on the checkpoint-replacement and
Run-again paths.

Replaying the ordinary flows against the GRBL simulator found three more
dead ends on the same path:

1. An origin-relative Frame pressed right after connecting, homing or a reset
   was refused because the controller had not yet sent a work-coordinate
   offset. GRBL reports WCO in one Idle report out of ten, so the answer was
   up to ten idle polls away, and the message asked the operator to "wait for
   an Idle/WCO status report".
2. Unlock voids the reported position until Home or Set origin re-establishes
   it (`controllerUnlockedPatch`). The Unlock offer still said "unlock and
   continue", and the Frame that followed was refused with "Wait for a
   complete status report", which no report could satisfy.
3. After Set origin the status on hand still carries the old offset. A Frame
   that continued at once bound its return point to that stale report and
   completed without a permit ("did not return to its pre-Frame work
   position").

### Decision

1. **`runFrameNow` offers the fixes before it prepares.**
   `offerFrameBlockerFixes` (frame-blocker-repair) runs after the refusal
   banner is cleared and before `prepareFrameContext`. When the machine
   issues are all alarm messages it offers Home on a machine with homing
   enabled and Unlock otherwise (start-blocked-alarm-offers, shared with the
   checkpoint dispatcher). Neither is offered for grblHAL's E-stop alarm
   (ALARM:10), which the controller keeps until the E-stop is released and it
   is reset; stock GRBL 1.1h uses 10 for a failed dual-motor homing, where
   Home is still offered. Otherwise, when the live placement's sole refusal
   has a compile-input remedy, it offers Set origin
   (start-blocked-setup-offers). One offer per press, as the checkpoint Start
   allows: after Home the head sits at the switches, so a missing origin is
   then reported, not set. An alarm left standing (the offer declined,
   unavailable or failed, or another machine blocker beside it) is reported
   at once with the machine messages the Start preparation uses, before the
   G54 selection or CNC Zero Z step reaches a controller that rejects
   commands in Alarm. Everything else continues to the ordinary gates and
   refuses exactly as before. Start with no permit reaches the same offers
   through the Frame.
2. **Unlock hands over to Set origin.** Accepting Unlock clears the alarm and
   stops the Frame with one next step: jog to the job start, click Set origin
   here, and Frame again. The prompt says so before the operator accepts.
3. **Missing report fields are requested, not waited out.** When no status has
   arrived, or a placement refuses while the offset is unknown, the Frame
   sends ordinary realtime status queries every 100 ms for at most 3 s
   (frame-status-wait). The WCO refresh counts reports, not time, so the
   offset arrives within about a second. Controllers without realtime status
   queries are not waited on. The Frame's own gates judge whatever arrives.
4. **A repair is followed by a report taken after it.** After Home or Set
   origin the Frame waits, the same bounded way, for a fresh Idle report with
   a usable work position before it prepares.
5. **The Frame button stays pressable in Alarm**, titled to say it offers Home
   or Unlock first. Other non-Idle states keep it disabled.
6. **Refusals name their remedy.** The Alarm, not-Idle and no-status messages
   say what clears them and end with "try again" instead of "before
   starting", since Frame reports them too; the unknown-origin message drops
   the WCO jargon. The retained banner is titled "Last Frame attempt blocked"
   when the Frame refused.

### Consequences

- No guard is created, re-added or widened (ADR-228 hard rule): every offer
  precedes a refusal that already existed, a declined offer reports that
  refusal unchanged, and the waits end in the same refusal when nothing
  arrives.
- Status queries are realtime bytes the planner ignores; nothing writes a
  setting or an offset except the Home, Unlock or Set origin the operator
  accepted.
- A Frame on a controller that never reports WCO now refuses after up to 3 s
  instead of at once.
