## ADR-258 Amendment 2 - Tabs skipped because of the stock thickness raise a Job Review warning (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

Amendment 1 made the compiler drop a profile's enabled tabs when the project's stock thickness
leaves a floor at least one tab height thick under the cut (`cutCanFreePart`). Before it, stock
thickness only fed advisories and the preview. Now it removes tabs from the G-code, but nothing
checks it against the material on the machine. The through-cut and spoilboard advisories read the
same number, so a wrong value silences them too. Only a muted Job Review detail line said the tabs
were skipped.

A stock thickness of 12.7 mm left from an earlier ½" job, with ¼" plywood cut 6.8 mm deep, leaves
a computed 5.9 mm floor. No tabs are emitted, nothing warns, and the parts come free on the final
pass under the spindle. Before Amendment 1 the same project kept its tabs. The 2026-09-25 audit of
PRs #845-#904 found this (SET-2).

### Decision

1. When the compiler drops tabs that a profile operation asks for, Job Review shows a warning. It
   names the operation, the stock thickness, the cut depth and the resulting floor, and asks the
   operator to check Stock thickness.
2. The warning uses the compiler's own rule (`cutCanFreePart`), and fires only where tabs were
   actually dropped. It does not fire for a cut no deeper than a tab, for tabs switched off, for
   non-profile cuts, or on the shipped stock thickness.
3. It is a warning only. It never blocks save or Start (PROJECT.md non-negotiable 21).

### Consequences

- A stale stock thickness can no longer remove tabs silently.
- A deliberate groove in thick stock with tabs left on also shows the warning. Turning tabs off on
  that operation clears it.
- The tab-top half of CNC audit TP-1 (tab height measured from the cut floor) is still open.
