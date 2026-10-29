## ADR-590 Amendment 2 - An applied Studio drawing the opened project does not hold is kept

**Status:** Accepted; tested with the real persistence hook, the Studio's Apply and project round
trips, not in a packaged build. |
**Date:** 2026-10-29

Fixes rolling audit v8 N5-P2-2, raised to P1 by its refuter
(`docs/audits/2026-10-29-rolling-v8/N5-fix-studio-io.md`). Amendment 1 lists "an Apply, after
the last 30 s autosave" among the routes it fixes, but its item 1 keeps only a drawing with work
not yet applied.

### Context

- Amendment 1 item 1 says: "A drawing with nothing unapplied is not kept: its project's own
  document holds it." That is not true after a crash. The Studio saves its drawing within 400 ms;
  the project autosaves every 30 s (`AUTOSAVE_INTERVAL_MS`). A drawing applied in the 30 s before
  a crash is in the saved drawing and not in the autosave.
- Restoring that autosave opened the Studio on its older drawing and saved it over the only copy
  of the newer one. Opening the Studio on the blank start-up project first (the restore hidden or
  declined) did the same. Nothing named the drawing: the recovery offer reads "Saved less than a
  minute ago. Restore it to continue where you left off."
- A kept drawing restored onto a project kept its own apply record, which names objects that the
  older project does not hold. Its next Apply added every shape beside the project's own Studio
  artwork, so a shape in both burned twice.

### Decision

1. **Item 1 is corrected.** A saved drawing whose shapes were all applied is kept too, when the
   project the Studio opens does not hold it and may be an earlier state of the project it was
   applied to. "Holds it" means the project's own Studio drawing has the same shapes. "May be an
   earlier state" means one of three things:
   - the project has no Studio drawing of its own: the blank start-up project, or an autosave or
     file from before the first Apply;
   - its Studio drawing shares a shape with the saved one;
   - its operations include one that the saved drawing's Apply used.

   Another project's own Studio drawing shares neither a shape nor an operation, and that
   project's file holds it. So switching between two projects keeps only unapplied work, as
   before, and the Studio does not offer each project's drawing in the other. A kept drawing
   that was applied is dropped once the Studio opens a project that holds it, because that
   project gives it back.
2. **The bar says which kind it is.** A kept drawing that was applied reads "An applied drawing
   this project does not hold was kept: …". An unapplied one still reads "A drawing you had not
   applied was kept: …".
3. **Restore takes the project's place.** A restored drawing replaces the project's own Studio
   drawing, so it takes over that drawing's apply record. Its next Apply replaces that drawing's
   artwork rather than adding beside it. A restored drawing the project does not hold counts as
   not applied, so Apply is on until it is applied here. A replaced drawing worth keeping by item
   1 is kept in its place, as before.

### Consequences

- After a crash, the Studio offers back a drawing applied after the last autosave, whether the
  autosave is restored or not. Restore, then Apply, puts back exactly the artwork the crash lost:
  three shapes give three objects, not four.
- A drawing a restart finds on the blank start-up project is offered there even when its file
  holds it. It leaves the list when that file opens in the Studio: by itself with the same key
  (Amendment 1 item 3), or as a drawing the file holds (item 1).
- Other projects are unchanged. An applied drawing set aside for a project with its own,
  unrelated Studio drawing is still not kept.
- `holdsUnappliedWork` is replaced by `worthKeeping(drawing, project)`,
  `projectHoldsDrawing(project, drawing)` and `discardKeptDrawingsHeldBy(project)` in
  `design-kept-drawings.ts`.
- Tests: `design-kept-drawings.test.tsx` covers a restored autosave (Restore, then Apply), the
  blank start-up project, another project, and a project that holds a kept drawing. It uses the
  real persistence hook and the Studio's Apply.
