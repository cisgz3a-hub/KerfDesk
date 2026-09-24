## ADR-343 Amendment 1 - Absolute placement after Home (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

### Context

Moved verbatim from DECISIONS.md, which ADR-344 froze: new decisions and
amendments are one file each under docs/decisions/.

### Decision

Home establishes the machine reference but does not prove that G54 or G92 became zero.
Keep previous origin provenance unknown until fresh WCO arrives. Fresh zero XY WCO clears
that unknown state; deliberate app-set zero origins remain meaningful for User Origin.
Classify reported offsets in millimetres, including when `$13` reports inches.

Absolute preparation compensates the observed WCO instead of refusing any custom origin.
With a known native frame, program XY equals bed XY minus native-to-bed translation minus
WCO. With an unknown frame, subtract WCO from the existing native-coordinate target and
retain the unknown-bed advisory. Preview, Frame, worker preparation and Start share this
translation. No G92/G10 clearing is added. An unresolved live custom offset waits briefly
for fresh Idle coordinates and otherwise reports the missing observation.

Preparation and Frame-readiness checks compare equivalent controller positions rather
than the optional MPos/WPos field shape. The first zero WCO is equivalent to an existing
no-origin zero assumption. Actual movement, offset changes, report-unit changes, session
replacement, origin/Z-reference changes and output changes still invalidate ownership.
The post-Home wait captures known WCO before Frame; completion and the final Start handoff
retain their existing exact-offset contract. At those boundaries a representation conversion
allows one reporting tick on nonzero-offset axes (0.001 mm or 0.0001 inch), including arithmetic
roundoff. Direct observations retain the existing 0.001 mm tolerance. Start also binds report
units even at zero coordinates.

### Evidence and limits

Regression evidence is software and simulated-controller evidence, not hardware qualification.
