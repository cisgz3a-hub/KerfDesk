## ADR-396 - KerfDesk knows the work offset on Marlin and Smoothieware, and selects G54 only where it can read it (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the origin handling of ADR-053 (hand-set origin, Verified Origin) and ADR-094 (controller
drivers) for the `g92-only` drivers, and the Frame's G54 selection. The Frame-first Start contract
(PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and 372) is unchanged: these changes make
placements resolve and place correctly; they add no gate.

### Context

Controller audit 2026-09-25, findings CG-1, CG-2, CG-11, GP-1, MA-2, MA-3 (Reset origin), MA-6 and
SM-1. KerfDesk learned a work offset only from GRBL's `WCO:` field.

- **Smoothieware** prints `MPos` and `WPos` from one sample in every `?` report and never `WCO:`
  (Smoothieware edge `38e2cc08` Kernel.cpp:207-234 and 262-288; `mcs2wcs` Robot.cpp:448-456). It
  keeps its G92 through a reconnect, a halt, `M999` and Home (Robot registers no halt handler,
  Robot.cpp:131-133; homing resets positions, not offsets, Endstops.cpp:962-971). KerfDesk forgot
  such an origin, so Absolute jobs ran displaced by it (SM-1), and after Set origin a User Origin
  Frame was refused for good (CG-1).
- **Marlin's** `M114` prints the logical position, with the G92 shift applied (Marlin 2.1.2.8
  motion.cpp:192-212), and no offset. KerfDesk filed it as the machine position and waited for an
  offset that never comes: after Set origin, User Origin, Current Position and Absolute were
  refused (MA-2, CG-1). Reset origin sent `G92.1`, which exists only with
  `CNC_COORDINATE_SYSTEMS` (G92.cpp:62-70, off in stock builds); a stock build acknowledges it and
  keeps the shift, and KerfDesk recorded the origin as cleared (CG-11, MA-3). A build without Z
  prints no `Z:` field and was taken for a board that never answers (MA-6).
- **The Frame's G54 selection** ran whenever KerfDesk did not know the active WCS, which is every
  session on the Falcon contract, Marlin and Smoothieware, and applied the Console
  'coordinates-all' effect, dropping the operator's G92 origin record (CG-2). On Marlin, G54 is an
  unknown command on stock builds and, with `CNC_COORDINATE_SYSTEMS`, erases the G92 shift
  (G53-G59.cpp:33-46). After a full `$H`, GRBL runs the `$N` startup lines, which can select
  G55-G59, and KerfDesk kept trusting the WCS it read before the Home (GP-1).

### Decision

1. **Smoothieware:** when a report carries MPos and WPos and no `WCO:`, the work offset is MPos −
   WPos of that report, the same quantity GRBL's `WCO:` carries. GRBL-family controllers report
   one or the other, so they are unaffected. The offset is re-learned on the next report after any
   reconnect, halt, `M999` or Home.
2. **Marlin, `workOffsetSource: 'host-recorded'`:**
   - `M114` is the work position; Z is optional.
   - KerfDesk keeps the shift it writes, with GRBL's meaning (machine = work + offset): none at the
     start of a session and after Home (Marlin homing sets `position_shift` to 0,
     motion.cpp:2346-2349); Set origin and Zero Z record the machine position their G92 is written
     at.
   - The stored report carries the derived machine position, so the DRO, Print and Cut and Job
     Review keep working.
   - Reset origin writes `G92 X<machine x> Y<machine y>` (and Z when KerfDesk shifted Z), which
     restores machine coordinates on every build. With no known position it refuses and says to
     wait for a report or Home.
   - A shift set before KerfDesk connected, without a restart since, is invisible to it; its
     machine frame is the logical frame at connect.
3. **G54 only where the WCS can be read.** The Frame selects G54 only on a driver with a modal-state
   query (`$G`). An unknown WCS is read first (an owned `$G`), and G54 is written only when another
   WCS is active. A selection keeps the XY origin record, because G92 is independent of G54-G59 on
   GRBL, grblHAL, FluidNC and Smoothieware. A known change drops the cached offset, which
   GRBL-family firmware reports again on its next status (gnea/grbl gcode.c:995-999; grblHAL
   gcode.c:4483-4487); an unknown previous WCS keeps it, and the report the Frame waits for
   replaces it if G54 changed it. The Falcon handshake, which reads no settings, now reads `$G`.
4. **After a Home the WCS is read again.** A completed Home and a Console `$H` clear the known WCS
   and re-read it with an owned `$G` (gnea/grbl system.c:198; grblHAL system.c:500).

### Consequences

- On Marlin every placement mode resolves after Set origin, Reset origin really resets, and the
  Frame never sends G54.
- On Smoothieware a board's retained G92 is compensated in Absolute and reachable by User Origin.
- On GRBL-family controllers, a Frame after a Home that ran a `$N0=G55` startup line re-selects
  G54, keeping the G92 record.
- Regression tests: `laser-status-smoothie-offset.test.ts`, `g92-only-origin-frame.test.ts`,
  `marlin-origin-model.test.ts`, `marlin-origin-placement.simulator.test.ts`,
  `marlin-position-report.test.ts`, `frame-wcs-normalization-falcon.test.ts`,
  `laser-home-startup-wcs.test.ts`.
