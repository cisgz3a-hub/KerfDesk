## ADR-686 Amendment 4 - Copies of an older logo are counted and knocked out one by one, and the count is exactly what Leave white unburned removes (2026-11-09)

**Status:** Accepted. Amends ADR-686 Amendment 2 (Decisions 1, 2, 4 and Consequences). Fixes rolling
audit v12 X2-P1-1 (P1, confirmed by its auditor, refuter and coordinator), X2-P3-1 and X2-P3-2
(`docs/audits/2026-11-09-rolling-v12/X2-returning-user.md`). Tested through File > Open of a project
1.0.29 saved and the store's Duplicate, Paste and Array; not burn-tested. | **Date:** 2026-11-09

### Context

- **Copies were missed (X2-P1-1).** Duplicate, Paste, Array and production nesting copy a part
  without its `svgImport` (`scene-object-copy-dependencies.ts`; only retained arrays, board tiles,
  jig copies and Array's first placement keep it), on 1.0.29 as on main. Amendment 2's count and
  Leave white unburned read only `svgImport` groups. So a 1.0.29 logo copied for a batch was
  counted once. After the button the toast said the white was unburned and the Job Review row and
  the Tools command went away, while every copy still burned its white a second time over the
  black:
  - +1,920 mm lit per copy of U3's logo;
  - +4,920.6 mm (+39.7 %) per copy of the refuter's logo.
- **The parity claim was false (X2-P3-1).** 1.0.29 stored see-through, gradient and masked white as
  plain `#ffffff`. The notice said "as a new import does", but the button cut out what a new import
  (Amendment 1) keeps: 22-33 % of those logos' burn.
- **The count was looser than the knock-out (X2-P3-2).** It counted any unmarked white beside a
  darker fill. Two cases went wrong:
  - An import whose white covers every darker shape (left as parsed, Decision 5) was blamed on
    1.0.29, and the button only silenced the notice.
  - A darker fill with Output off (only the white burns) was called a white burning "over the darker
    fill", and the button emptied the job.

### Decision

1. **Each copy is its own group.** The parts of one import (sharing `svgImport.id`) are still one
   group, in paint order. Every `imported-svg` part without `svgImport` is a group of its own: its
   paths are one paint order, and the per-part rule (a white painted over a darker fill) holds
   within it.
2. **A copy's mode comes from its operations.** A part without `svgImport` counts as Fill artwork
   when every operation its paths use is a Fill operation, or when its own override says Fill. A copy
   on a Line operation stays a cut and is left alone.
3. **The count is the knock-out.** The open notice, the Job Review row and the Tools command count
   what Leave white unburned would actually leave unburned. A cheap test comes first (a burning
   paper white beside a burning darker fill), and only then the knock-out geometry. The result is
   cached per scene, so the command list and Job Review do not recompute it.
   - An import whose white covers every darker shape is left as parsed, as a fresh import leaves
     it, and counts nothing.
   - A white or a darker fill whose operations all have Output off is skipped by both the count and
     the button.
4. **No parity claim.** The notice, the row, the tooltips and the toast no longer say "as a new
   import does". The notice and the row add: "A file saved before this version does not record
   see-through, gradient or masked white, so check the canvas afterwards." The toast is "N white
   shapes are left unburned. Undo burns them again."

### Consequences

- The audit's repros burn as a fresh import with the same copies does, and the counts match the
  white shapes that exist: 4 logos give 4, the refuter's give 12.
- Opening or counting a project with many imported parts does no geometry unless a white can burn.
  An affected project computes the knock-out once per scene version.
- **Update notes (1.0.30):** the Amendment 2 line covers copies once this lands. If a separate line
  is wanted: "Leave white unburned now also reaches copies of an older logo made with Duplicate,
  Paste or Array."
- **Not covered:** a 1.0.29 see-through, gradient or masked white still cannot be told apart from
  solid white, so the button cuts it out; the notice now says so instead of claiming parity.
- **Tests:**
  - `src/ui/state/svg-white-fill-knockout-v12.integration.test.ts`: Duplicate, Paste and Array
    copies of a pre-knock-out logo are all counted, all left unburned, burn as a fresh import's
    copies, and come back with one Undo. A Line copy is left alone. A darker fill with Output off
    and a fully covered import count nothing. Five of its six tests fail on the code before this
    amendment.
  - `src/ui/text/returning-user-white-copies.test.ts` opens `1.0.29-white-logo-copies.lf2.gz`, saved
    by 1.0.29 with Array copies and a moved Duplicate.
