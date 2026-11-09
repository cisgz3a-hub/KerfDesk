## ADR-480 Amendment 4 - A cut with a lead-in or lead-out is still an outline, so it is warned before the engraving inside it (2026-11-09)

**Status:** Accepted. Amends ADR-480 Amendment 3 Decision 2 (what counts as an outline). Fixes
rolling audit v12 finding X3-P2-1 (P2,
`docs/audits/2026-11-09-rolling-v12/X3-fix-design-text-import.md`). Tested on the prepared job
through Job Review's prepare, Save G-code and Start, and on the compiled job with the real lead
step; not burn-tested. The warning's words, Cut last, the ranking (ADR-687), leads (ADR-626),
Frame, G-code and licences are unchanged. | **Date:** 2026-11-09

### Context

Amendments 2 and 3 count a cut segment as an outline only when it is `closed`. Job Review, Save
G-code and Start read the **prepared** job, and preparation turns a closed contour whose operation
(or artwork) asks for a lead-in or lead-out into one open burn: lead-in, the contour, lead-out
(ADR-626, `apply-laser-leads.ts`). It keeps the contour's place in that burn as `leadContour`
(`from`, `to`). So any led cut dropped out of the check: the v12 auditor and refuter reproduced
one coaster, two coasters and a round coaster with lead-in, lead-out or both, with 3 passes, with
an overcut, with straight leads, with a lead too long to fit, and with leads set on the artwork
alone. Every one burned cut-then-engrave with no warning on any route, while the same jobs
without leads were warned. The tests had checked `compileJob` only, which runs before leads.

### Decision

1. **A led contour's range is its outline.** A cut segment carrying `leadContour` is read as the
   closed ring `polyline[from..to]`, the contour the leads were added to. A lead holds nothing: it
   runs in the scrap, and the contour still frees the part. Plain closed contours count as before;
   open paths, tab pieces and perforation dashes (which get no leads) still do not.
2. **Tested where the operator sees it.** Route tests run the real Job Review prepare, Save G-code
   and Start (`cut-order-warnings-prepared.test.ts`) for a plain cut and each lead case above, and
   the core tests run `applyLaserLeads` before the check.

### Consequences

- The lead's own path, which leaves the part into the scrap, is not part of the outline, so it
  never makes an engraving beside the part count as inside.
- A future preparation step that rewrites closed contours must keep a way back to the contour, as
  `leadContour` does, or this check goes quiet again; the route tests would catch it.
