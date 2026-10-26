## ADR-540 Amendment 6 — A tapered V-bit inlay pair is V-carve, a Pro tool (2026-10-22)

**Status:** Implemented in source | **Amends:** ADR-540 tool list, ADR-540 Amendment 1 items 2 and 4

On 2026-10-22 the maintainer ruled that a "Tapered V-bit pair" inlay is Pro. The
rolling audit of 2026-10-21 (02-P2-2) found that it was classed as Free:

- Both halves are cut with `vcarveMedialPasses`, which produces passes identical to
  a Pro V-carve of the same outline.
- Browser Free strips that engine, so the choice failed at Preview with the Pro
  message.
- Desktop Free created those V-bit passes without asking for Pro.

1. `operationProFeature` classes an `inlay-pair` operation with `taperedInlay` as
   `vcarve`. Every check that uses it treats a tapered pair as V-carve:
   - creating and copying Pro work;
   - Free's settings-only editing of existing Pro work;
   - project admission.
2. The cut type "Inlay pair" and the straight end-mill pair stay Free. Choosing
   "Tapered V-bit pair" asks for Pro, and Free menus mark that choice "(Pro)". An
   operation that already has a tapered pair stays editable, as V-carve does.
3. Browser Free keeps stripping the V-carve engine. Its build test now checks
   that a tapered pair cannot compile there.

This changes tool choice and admission only. Preview, estimates, Frame, Start,
Save G-code and running jobs keep their existing policies, and an admitted project
keeps running its saved tapered inlay.
