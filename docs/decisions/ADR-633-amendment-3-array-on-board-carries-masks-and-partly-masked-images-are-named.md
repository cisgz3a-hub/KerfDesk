## ADR-633 Amendment 3 - Array on board carries each photo's mask, and Job Review names a photo that reaches only part of its mask (2026-10-28)

**Status:** Accepted. Amends ADR-633 Amendment 2 (its Context and Decision 4) and ADR-125
Decision 2 (Array on board, "single-design only"). Fixes rolling audit v5 finding J9-P1-1 (P1),
confirmed by the auditor, an independent refuter and the coordinator
(`docs/audits/2026-10-27-rolling-v5/J9-fix-output.md`). Frame (ADR-565), Start, output policy and
licences are unchanged. No guard is added (ADR-228). | **Date:** 2026-10-28

### Context

Amendment 2 said Duplicate, Copy and Paste, Array, Copy along path and nesting "already copy a
photo's mask", and "Only the jig did not". That was wrong: **Array on board**
(`tileSelectionIntoBoard`, `src/ui/state/board-tile-actions.ts`) did not either. It moved the
selected photo into the first slot and copied it into the others with a new id and a new position,
and nothing else. The mask stayed where it was, and every copy still named it. Only one design
could be selected, so the operator could not take the mask along. The remote `place_on_board`
command with `action: 'array'` calls the same action.

Compile finds a mask by id anywhere in the scene, so each tile burned only where it overlapped the
original mask. With a 40 mm photo under a 40 mm circle centred on a 200 × 100 mm board, a 2 × 2
array burned 239, 236, 239 and 236 cells, against 1,070 before: about 22 % of the masked photo in
each tile. The design canvas draws a photo without its external mask, so it showed four whole
photos. Amendment 2's advisory compared bounding boxes and named only a mask that missed its image
entirely, so it said nothing here: each tile's box still overlapped the circle's box.

### Decision

1. **Array on board carries each photo's mask.** The design is the selected object and what it
   needs with it (`sceneObjectCopyClosure`): a photo's mask and a path text's guide. The original's
   mask or guide moves into the first slot with it. Each other slot gets fresh copies of all of
   them, remapped with that slot's ids (`remapSceneObjectCopyDependencies`), so each photo copy
   names the mask copy beside it, as Duplicate, Array and the jig do. The tile footprint is still
   the selected design's own box. A board used as the mask is never copied or moved, so every tile
   still burns through it. Board copies keep their SVG re-import identity, as before. The remote
   `place_on_board` array goes through the same action.
2. **A photo selected with its own mask is one design.** Array on board accepts a selection that is
   one design plus objects that travel with it anyway (`selectedBoardArrayDesign`), whichever was
   clicked first. Two designs are still refused. **Fit to board** scales one object, so it still
   takes the photo alone (`selectedBoardFitDesign`); the panels enable the two controls separately.
   After an array, the copies of what was selected are selected, as Duplicate does.
3. **Job Review names a photo that reaches only part of its mask.** The `image-mask-off-image`
   advisory now measures how much of the mask's area lies on the image's rectangle, on 128 rows
   across the mask, with the even-odd rule compile uses (`maskShareOnImage`). A share of 0 keeps
   Amendment 2's wording ("nothing of it will be engraved"). A share under 95 % adds "Only N % of
   the mask over "photo.png" lies on the image, so only that part of the mask shape will be
   engraved", one entry per image, in the same single warning. It replaces Amendment 2 Decision 4's
   box test, which this amendment withdraws: a ring whose hole holds the photo is now named as
   missing it, and a photo turned 45° is measured by its own rectangle, not its box. The warning
   stays advisory (rule 7, ADR-228, ADR-565): the job runs as drawn.

### Consequences

- A masked photo arrayed on a board burns whole in every tile, from the board panel and from the
  remote. Compile is unchanged, so `EMITTER_REVISION` does not move.
- A project saved with the old copies still burns the fragments, and Job Review now names every
  tile with its share: the audit's 2 × 2 layout reads "4 images lie on only part of their masks
  ("portrait.png" 22 %, …)" (checked by running `main`'s array action with this advisory).
- Up to 5 % of a mask may hang off its image unnamed, so a hand-drawn shape that slightly overlaps
  the photo's edge raises nothing. A mask drawn larger than its photo on purpose, or one mask
  shared on purpose by several photos that each cover part of it, is named too. The warning says
  what will burn, and the job runs as drawn.
- **Fit to board** and **Center on board** still move one object without its mask, like a drag
  (the audit's "related, not raised"). The new advisory names the result when the photo leaves
  more than 5 % of its mask.
- Tests:
  - `src/ui/state/board-array-masks.test.ts`: the real store and `compileJob`. With the photo, the
    photo and mask, or the mask and photo selected, a 2 × 2 array burns 1,070 cells in all four
    tiles, each with its own mask exactly over it, and the advisory is silent. The array is
    selected and undoes in one step, and Fit to board refuses the photo and mask together.
  - `src/ui/remote-control/board.test.ts`: the same through `place_on_board`.
  - `src/core/preflight/image-mask-off-image-issues.test.ts`: half and quarter coverage are named
    with their shares, a sliver under 5 % is not, a ring around the photo misses it, a turned photo
    is measured by its rectangle, and a miss and a partial share one warning.
- Red check: with `main`'s `board-tile-actions.ts`, the three array cases fail.
- These are code and test results. No board was burned and no controller was operated.
