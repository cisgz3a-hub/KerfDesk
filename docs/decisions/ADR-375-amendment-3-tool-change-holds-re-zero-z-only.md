## ADR-375 Amendment 3 - A tool-change hold re-zeroes Z only, and the store follows the G54 KerfDesk selects (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

Amends ADR-375 decision 1 (origins around the probe cycles) and ADR-184/ADR-185 (probe transactions
and the corner commit). Fixes controller audit v2 findings C2-P1-1 and C2-P2-1
(`docs/audits/2026-10-22-controller-v2/C2-ctl-probing.md`). Both were reproduced through the real
store before the fix (a fake GRBL 1.1 controller and the GRBL simulator). No hardware was used.

### Context

1. **C2-P1-1.** The setup gate opens in a drained CNC tool-change hold so the operator can touch off
   the new bit (`setupBlockingJobCommandBlockMessage`). The gate did not ask what the action would
   change. The XYZ corner probe ran there and committed `G92.1` and `G10 L20 P0 X Y Z`, and Continue
   then streamed the rest of the job in the new X/Y frame with no warning. Continue checks Work-Z
   evidence only. Set origin was disabled only by its button: the store's `setOriginHere`, and the
   phone remote's `set_work_origin`, which calls it, ran in the hold. The Probe panel kept the XYZ
   mode remembered from the morning setup, so the touch-off for the second bit could be a corner
   cycle. WORKFLOW F-CNC15, the M0 comment and the hold banner all describe a Z re-zero only.
2. **C2-P2-1.** Both probe cycles start with `G54`. In GRBL a G54-G59 word is a persistent modal
   change, and `G10 L20 P0` writes the system that is then active (gnea/grbl `gcode.c`, as read in
   the audit). The store kept the active WCS it knew before. When that was G55 (a `$N` startup line,
   or the Console), the next Frame "selected" G54 again, warned "Controller was using G55", voided the
   fresh probe Work-Z and asked for Zero Z with the bit parked 20 mm above the stock. Zero Z and the
   other GRBL-family origin writes put `G54` in their block too and had the same stale record.

### Decision

1. **Only a Z re-zero runs in a tool-change hold.** For the whole hold, drained or not:
   - The probe preflight refuses every request that is not the Z cycle
     (`toolChangeXyOriginBlockMessage`). Nothing is written.
   - Origin readiness (`assertOriginActionReady`) takes the axes the action can move, and refuses an
     X/Y action. Only Zero Z declares `'z'`. Set origin, Reset origin, Set and Clear persistent
     origin, Release motors, the recovery origin restore and Set origin at a program point keep the
     default `'xy'`. The refusal sets `lastWriteError` and logs "Origin command blocked", as the
     other origin refusals do. A new origin action is refused in the hold unless it says it is
     Z-only.
   - The phone remote's X/Y `set_work_origin` reaches the same store action, so it is refused with
     the same message. Its Z form (Zero Z) still runs.
   - The Probe panel offers "Z only" in a hold, with "XYZ corner" disabled and a one-line note. The
     remembered draft mode is kept, so the corner mode returns after the job.
   - Re-probing the same corner behind a confirmation was considered and not adopted. The touch-off
     has no use the Z cycle does not cover, the plate in a hold sits wherever the operator put it
     for the Z touch, and a confirm that a stressed operator clicks through would move the job. To
     change X/Y, the operator stops the job.
   - This refusal is a handoff fact under PROJECT.md non-negotiable 21 (c): the rest of the held job
     was reviewed and framed against the X/Y origin it started with, and an origin change mid-job
     cannot be handed off consistently. It is not a Start gate; Start, Frame and Job Review are
     unchanged.
2. **The store's active WCS follows a G54-G59 word KerfDesk sends itself.** Once the controller
   acknowledges a line of a probe cycle or of an origin transaction, `acknowledgedWcsPatch` records
   the system its last G54-G59 word selects:
   - Already that system: nothing changes.
   - Previous system unknown: the system is recorded and the offset kept. GRBL-family firmware
     reports the new offset in its next status report after a change of system, as Frame's own
     selection already relies on (frame-wcs-selection.ts).
   - Known different system: as after Frame's selection, the WCO, compatibility Frame evidence,
     the exact Frame candidate and trace and Work-Z evidence are void, and the trusted-position
     epoch moves on. The Work-Z reference epoch does not move: Zero Z captures its evidence before
     its `G54 G92 Z0` and records it after, and that zero is taken in the new system.
   - KerfDesk keeps probing into G54 rather than into the active system. The prepared program pins
     G54, so a touch-off written into G55 would not be the Z the program cuts at.

### Consequences

- The touch-off for a second bit can no longer move the job's X/Y origin, and the rest of the job
  cuts where it was framed. An operator who needs a different X/Y must stop the job.
- After a probe or Zero Z on a controller left in G55, Frame finds G54 already active. The probe's
  Work-Z survives, Frame gives no false "Controller was using G55" warning, and Job Review no longer
  shows "Active WCS G55".
- No backstop on Continue compares the X/Y origin version with the one the job started with. Every
  KerfDesk X/Y writer is refused in the store, and a new origin action is refused by default. An X/Y
  word typed in the Console during the hold is still the operator's own G-code.

### Evidence

- `src/ui/state/laser-tool-change-xy-origin.test.ts` (real store, fake GRBL 1.1): in a drained hold
  the corner probe returns `preflight-failed` and writes nothing; the Z probe settles; Continue then
  streams the rest of the job with no `G92.1`, no G92 X/Y and no G10 X/Y on the wire, and the origin
  version unchanged. Set origin, Reset origin and Set persistent origin are refused with nothing
  written; Zero Z still sends `G54 G92 Z0`. With the gate disabled the corner probe returned `ok`,
  as in the audit.
- `src/ui/state/probe-active-wcs.simulator.test.ts` (GRBL simulator): after a Console `G55`, a Z
  probe leaves `activeWcs` at G54 and Frame's WCS step keeps the probe Work-Z; Zero Z's Work-Z
  survives the same way; Set origin from G55 voids Work-Z measured in G55 and logs the change.
- `src/ui/laser/ProbeControls.tool-change.test.tsx`: in a hold the panel shows Z only, runs the Z
  cycle from an XYZ draft, and shows the XYZ mode again after the job.
- `src/ui/laser/frame-wcs-normalization-falcon.test.ts` (controller audit 2026-09-25 CG-2) relied
  on Set origin leaving the WCS unknown. Set origin now records the G54 it selects, so the test
  marks the WCS unknown again, as a Home whose `$G` gets a bare `ok` leaves it, before the Frame's
  selection it covers.
