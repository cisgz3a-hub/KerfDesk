## ADR-255 Amendment 1 - Program Health passes rapids into already-cut air and counts only real cuts before the spindle (2026-09-29)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-09-29

Amends ADR-255 decision 5 (Program Health) for two checks. Program Health stays informational:
nothing here blocks Frame, Start, parse, render or export (ADR-228).

### Context

Since ADR-489 and ADR-520 a deeper pass over a path the job has already cut rapids down inside its
own slot to 1 mm above the earlier floor, then feeds the rest (`G0 Z-2.000`, `G1 Z-6.000 F300`).
The air-floor producers keep a floor only for an exactly repeated path (`cnc-pass-air-floors.ts`,
`relief-air-floor-proof.ts`), so an earlier feed move always went through the descent's XY at or
below the floor. The "Rapid plunge below Z0" check still flagged every G0 that ends below Z0. The
second CNC audit (`docs/audits/2026-09-29-cnc-audit-second-pass.md`, P2-preview-1, reproduced) found
it on 7 of 14 KerfDesk programs: multi-pass profiles with and without leads, offset and raster
pockets, a tabbed part and a two-tool job. The warning told operators their own program was wrong
and taught them to ignore the one check that catches a real rapid into stock in an imported file.

The weakness audit (WA-5, handed to the CNC audit) found that "Cutting begins before spindle/laser
on" counted any downward Z-only move as cutting, including a G0 and a feed approach that stops
above the work, so a program that lowers Z before `M3` was flagged.

### Decision

1. **A rapid descent into already-cut air is not a rapid plunge.** A Z-only G0 that ends below Z0
   is flagged only when no earlier feed move went through the same XY (within 0.01 mm) at or below
   the Z it stops at. The Inspector knows no cutter, so the test is the descent's own point, never a
   cutter footprint; a descent beside an earlier cut, below it, or before it is still flagged. The
   finding now says the rapid goes "where no earlier move has cut that deep".
2. **Only a feed move into the work starts cutting.** For "Cutting begins before spindle/laser on" a
   G0 never cuts (the rapid checks cover a rapid into the work), and a feed plunge counts only when it
   ends below Z0. XY feed moves count as before. The other checks keep their own rules.

### Consequences

- KerfDesk's own multi-pass CNC programs no longer carry a false warning. A real rapid into stock
  is still reported, including one that stops any deeper than the earlier cut at that point.
- The check reads only feed moves made before the last such descent, so its cost is bounded by that
  prefix of the program (about 0.1 s for 600,000 one-millimetre segments in a unit probe).
- Every KerfDesk program still gets the informational "No program end" note, because no built-in
  emitter writes M2 or M30. That is left as it is.

### Verification

`src/core/gcode-view/rapid-descent-clearance.test.ts` passes a deeper pass rapiding into its own slot
and a descent onto the middle of an earlier cut, flags a descent deeper than the earlier cut, one
2 mm beside it and one before any cut, and compiles an outside profile, an offset pocket and a
raster pocket 6 mm deep at 2 mm per pass through the real compiler and emitter: each program
contains `G0 Z-` descents and gets no rapid plunge finding. `program-findings.test.ts` shows a G0
and a feed approach above the work before `M3` are not cutting, while a feed plunge into the work
before `M3` is. Without the change these cases fail. No hardware result is claimed.
