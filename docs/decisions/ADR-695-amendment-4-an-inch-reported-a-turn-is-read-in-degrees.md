## ADR-695 Amendment 4 - An A turn reported in inches is read in degrees (2026-11-12)

**Status:** Accepted; firmware-source evidence and unit tests. No hardware. | **Date:** 2026-11-12

Follows Oracle audit O1 finding O12-P1-1
(`docs/audits/2026-11-11-oracle-o1/O12-research-reverify.md`). It settles the "`$13=1` with an A
axis" item that rolling audit v14 Z2 left as not traced. Amends Amendment 1 (the saved start turn
and Start from line) and Amendment 2 (the turn since an Abort).

### Context

Amendment 1 records the turn an A or Z job started from, which is that axis's work offset. Start
from line sends it back as `G53 G0 A<start>` under G21. The turn-back and Job Review read the turn
now from the status report. KerfDesk already multiplies a reported Z by 25.4 when `$13=1` asks the
controller to report in inches, but it took A as degrees whatever `$13` said.

grblHAL's `report.c` does not work that way. With `$13=1` it divides every reported axis by 25.4,
except an axis past Z whose bit is set in `$376` (Rotary axes). The Falcon A1 Pro ships `$376=0`.
On such a machine with `$13=1`, a job started at machine A 254° is recorded as 10.000. Start from
line then turns the part to 10°, and its tail burns 244° round the part from the half-burned piece.
The turn-back jogs 1/25.4 of the turn it needs.

FluidNC never converts A to C (`Report.cpp`, `is_linear`), and stock GRBL has no A axis. Neither
lists `$376`.

### Decision

1. The `$$` dump's `$376` is kept as `rotaryAxesMask`.
2. A reported A position (MPos, or WPos plus WCO, and the WCO kept at an Abort) is multiplied by
   25.4 only when `$13=1` and `$376` was reported with the A bit (8) clear. Z keeps its existing
   rule: × 25.4 whenever `$13=1`.
3. One helper, `reportedTurnScale` (`src/core/controllers/grbl/reported-turn-units.ts`), applies
   this at both readers: `currentMachineTurn` and the Abort's start-turn record.

### Consequences

- On grblHAL with `$13=1` and A not flagged rotary, Start from line, the turn-back and Job Review's
  "turned … since" all work in degrees.
- A controller that does not list `$376`, or marks A rotary, or reports in millimetres, behaves
  exactly as before.
- Emitted programs are unchanged. Only the reading of reported A positions changes.
