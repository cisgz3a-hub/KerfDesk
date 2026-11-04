## ADR-341 Amendment 11 - After the operator's Abort, the Alarm 3 card says what happened and restores the origin (2026-11-03)

**Status:** Accepted (new-user experience audit U1, area U4, finding U4-P2-3, confirmed by an
independent refuter; the maintainer's standing instruction to fix confirmed audit findings). |
**Date:** 2026-11-03

### Context

ABORT JOB on a GRBL-family controller sends the realtime soft reset at once, so stock GRBL,
FluidNC and grblHAL answer `ALARM:3`. The rail then showed the ordinary alarm card: "Alarm 3:
Reset during motion — The controller was reset while still moving. Position is lost. Re-home the
machine ($H) before resuming work.", with **Set up homing** first on a machine whose homing is off.
Nothing said the operator had stopped the job or that the laser was off.

Stock GRBL and FluidNC also clear a Set origin here origin (G92) at that reset (ADR-053 Decision 3,
ADR-375). After **$X — Unlock** the next Frame offered to set the origin "at the current head
position", which is where the job stopped. In the audit the re-run framed 5 to 69 mm away from the
first, over half-burnt material. The plain sentence ("Set origin here would put the origin where
the head is now, not where the job started.") and **Restore saved origin** (Amendment 5) existed
only in the interrupted job's Review recovery.

### Decision

1. **The Abort records the origin before its reset.** The operator Abort's stop request
   (`JobStopRequest.originAtStopMm`) keeps the XY work offset in mm when a G92 origin was set, read
   in the same store update that records the request, before the reset clears the session's
   offset. Marlin stops without a reset (`runNoResetStop`) and is unchanged.
2. **That Alarm 3 gets its own card.** When `ALARM:3` answers an operator Abort that reset the
   current stream (`operatorAbortAlarm`), the rail shows "You stopped the job" with: "The laser is
   off. The controller reset, so your origin was cleared. It was at X …, Y … mm from machine zero."
   On grblHAL, which keeps G92 through a reset, it says the origin was kept. Any other ALARM:3,
   and every other alarm, keeps the ordinary card.
3. **Restore saved origin is the main action.** Without homing it sends Unlock, waits for a fresh
   Idle report and writes the saved offset back with one G92 (Amendment 5), without moving the head.
   With homing it is **Home, then restore origin**: the cycle measures the machine again first. On
   grblHAL the same write re-confirms the origin KerfDesk stopped trusting at Unlock.
   **Set origin here** (Unlock, then G92 X0 Y0 at the head) is the alternative, beside the Review
   recovery's sentence. **Unlock** alone stays for an operator who wants to jog first. A CNC is told
   that work Z was cleared too; its Frame already asks for it (`cnc-frame-lines.ts`).
4. **A machine without homing is not told to home.** With no saved origin the card says to unlock
   and move the head, and offers Home only when homing is on.
5. **Restore can aim from the withheld position.** After Unlock KerfDesk withholds the reported
   position until Home or an origin write (ADR-367 Context 2). `G92 X(m - s)` needs only the
   controller's own count m, which `$X` leaves as it was, so Restore saved origin reads the MPos
   withheld from the latest report (`withheldControllerMPos`), as Set origin here's `G92 X0 Y0`
   needs none. The written origin re-establishes position evidence like Set origin here does.

### Consequences

- No refusal is added, widened or removed (ADR-228). The actions write only the Unlock, Home and
  G92 the operator presses; the program and the Frame are unchanged.
- The restore is exact in the controller's own count. If steps were lost when the reset killed the
  motion, the count is off by them; the Frame that Start already needs shows where the job lands,
  and the success toast says to Frame first.
- Verified against the repository's GRBL simulator (stock GRBL and grblHAL firmware), not on
  hardware: `src/ui/laser/abort-unlock-frame.simulator.test.tsx`.
