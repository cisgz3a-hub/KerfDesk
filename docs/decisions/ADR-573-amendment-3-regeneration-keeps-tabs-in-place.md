## ADR-573 Amendment 3 - Regeneration keeps a tab in its place, not only on its path

**Status:** Accepted; store-tested on emitted G-code and CNC cuts, not hardware-tested. |
**Date:** 2026-11-02

Fixes rolling audit v9 R3-P1-1 (`docs/audits/2026-11-02-rolling-v9/R3-fix-tabs-jig.md`). ADR-573 says
"Regeneration preserves machining settings and tabs through uniquely recoverable semantic path
identity". That sentence now also covers where a tab sits on its path: a regenerated part or sketch
carries each tab to the same place on its own contour, and the review says which ones it cannot keep.
The rule is ADR-494 Amendment 4 D1 and D2. Path identity itself is unchanged.
