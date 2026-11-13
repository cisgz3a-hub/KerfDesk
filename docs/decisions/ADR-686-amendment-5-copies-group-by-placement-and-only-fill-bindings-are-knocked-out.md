## ADR-686 Amendment 5 - Copies made together are one group, every path is judged by its Fill operations, and only Fill bindings are knocked out (2026-11-13)

**Status:** Accepted. Amends ADR-686 Decision 5 and Amendment 4 (Decisions 1 and 2). Fixes tools
audit T1 findings T09-P1-1, T09R-P1-1, T09R-P1-2 (P1) and T09-P2-1 (P2), all confirmed by the
auditor, the refuter and the coordinator on main 2b6217970
(`docs/audits/2026-11-13-tools-t1/T09-leave-white-unburned.md` and `-refuter.md`). Tested through
the store's import, Duplicate, Paste, Array, Add operation and Leave white unburned, the compiled
burn, and both 1.0.29 project goldens. Not burn-tested on a machine. | **Date:** 2026-11-13

### Context

Amendment 4 made Leave white unburned reach copies of a logo saved before the knock-out. It was
tested only on logos that import as one part, and it judged originals and copies by different
rules. The T1 audit found four ways the button still burned white over the black, or changed a cut:

- **Copies of a logo in several parts (T09-P1-1).** The SVG parser starts a new part whenever a
  stroked element or an image comes between filled ones. An outline ring, or any element with a
  stroke (Illustrator writes `stroke-miterlimit` on every stroked object), splits a logo into a dark
  part, a line part and a white part. Copies drop `svgImport`, and Amendment 4 made each such part
  its own group. So a copied white had no darker fill beside it and was neither counted nor
  knocked out. After the button, every surface read 0 while each copy kept burning its white:
  3,864 mm per copy of the refuter's badge, and 86,526 of 89,778 mm on a copy of the library's own
  `laser-in-use.svg`.
- **Copies that are also cut out (T09R-P1-1).** A copy counted as Fill only when *every* operation
  it used was Fill. "Engrave and cut out" (a Line cut added to each logo) made every copy "not
  Fill": on the real `1.0.29-white-logo-copies` project the count went 4 → 1, and 3 copies kept
  burning 1,881 mm each inside the diamond.
- **An original switched to Line (T09R-P1-2).** An original was judged by its import mode, whatever
  its operations had become. With black set to a 100 % cut and white to a 15 % score, the button
  made the score part of the cut (94.21 → 134.21 mm on the real `1.0.29-white-logos` project, so
  the diamond drops out of the piece) and deleted the score operation. A copy of the same logo was
  left alone.
- **Line operations on a knocked part (T09-P2-1).** The knock-out rewrote a darker path for all of
  its operations and dropped a white path whatever else it fed. A cut on the dark part gained the
  hole outline (120 → 176.57 mm), and a score on the white part was deleted along with its
  operation. The toast said nothing about either.

### Decision

1. **Copies made together form one group.** The parts of one import (sharing `svgImport.id`) are
   still one group in paint order. Parts without `svgImport` are grouped by their `source` and
   their exact placement (`transform`), in scene order. Copying several parts in one action
   (Duplicate, Paste, Array, a moved or rotated group) gives every copied part the same
   placement, because the parts of one import share one placement and each copy applies the same
   change to it. A logo saved by 1.0.29 with such copies is therefore grouped correctly when it is
   opened, with no new field in the project file. Parts that only happen to be stacked exactly on
   each other paint over each other in the same scene order, so grouping them gives the same burn.
   The knock-out already compared only parts with an equal placement (`sameTransform`), so a group
   never mixes geometry from different placements.
2. **Every path is judged by the Fill operations it burns through.** Originals and copies follow one
   rule. A path takes part in the knock-out when it uses a Fill operation (after the object's own
   override, `effectiveOperationForObject`) with Output on. The import's mode and the path's other
   operations no longer decide it. A white whose Fill operations all have Output off, and a darker
   fill with Output off, are still left alone (Amendment 4 Decision 3). An original whose operations
   were all switched to Line is no longer named at open, in Job Review or by the Tools command.
3. **Only Fill bindings are knocked out.** A darker path that also feeds a non-Fill operation is
   split in two. The knocked-out shape is bound to its Fill operations, and an unchanged copy of the
   path follows it, bound to the other operations. A white path that also feeds a non-Fill operation
   keeps its geometry for those operations and leaves its Fill operations. A cut or score keeps the
   outline it had. A fresh import and Re-import do not split: they bind each colour to one operation
   of the import's mode, so they keep the import's own rule (Decision 5).
4. **The toast names removed operations.** An operation the knock-out leaves with nothing to burn
   (normally the white's own Fill operation) is still removed (Decision 5). The success toast now
   names it, for example: "1 white shape is left unburned. Removed the operation “White”, which only
   the white used. Undo burns it again." After three names it says "and N more".

### Consequences

- Copies of a logo in several parts burn as the original does after the button, and the count
  names every one of them. "Engrave and cut out" copies are counted and knocked out, and their cut
  is unchanged. An operator who turned a logo into cuts and scores keeps them as they are.
- A path split by Decision 3 now has explicit per-path `operationIds`, where it may have relied on
  the object's bindings or on colour matching before. The burn is the same; only the binding
  representation is more explicit.
- **Not covered:**
  - A white part moved apart from its own import (T09-P3-1) is still dropped without cutting the
    fill under it, because its placement differs. It is ledgered as a P3.
  - A Fill operation's sub-layers follow their parent binding, so a Line sub-layer under a Fill
    operation gets the knocked-out shape. Sub-layers cannot be bound apart from their parent.
  - Laser and CNC tab anchors that name a path index are not remapped when the knock-out removes or
    adds a path. This was already the case when a white path was removed (Decision 5).
- **Tests:** `src/ui/state/svg-white-fill-knockout-t09.integration.test.ts` has nine cases, and all
  nine fail on the code before this amendment:
  - Array, Duplicate and Paste copies of a logo split by a stroke are all counted, and no burn is
    left inside any white.
  - A Fill + Line copy is counted and knocked out with its cut unchanged, both on a store-built logo
    and on the real `1.0.29-white-logo-copies` project.
  - A Line/Line original counts 0 and is left unchanged. The real `1.0.29-white-logos` project counts
    one logo fewer once U3's logo is switched to Line, and keeps its cut and score lengths.
  - A cut on the dark part only keeps its 120 mm. A score on the white part only keeps its 56.57 mm
    and its operation, and the toast names the removed white Fill operation.
  - The existing white-knockout suites (`svg-white-fill-knockout*`, `returning-user-white-*`) pass
    unchanged.
