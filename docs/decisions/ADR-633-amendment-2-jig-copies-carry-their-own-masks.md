## ADR-633 Amendment 2 - Jig copies carry their own masks, and Job Review names a mask that misses its image (2026-10-27)

**Status:** Accepted. Amends ADR-633 Decision 3 and the **Centre + copy** of ADR-606 and ADR-057.
Fixes rolling audit v4 finding H5-P1-1 (P1). Frame (ADR-565), Start, output policy and licences
are unchanged. No guard is added (ADR-228). | **Date:** 2026-10-27

### Context

**Centre + copy** fits the selected artwork into the first outline and copies it into every other
outline. Each copy was the original with a new id and a new position. A copy of a masked photo
(Apply Mask to Image) therefore still named the first outline's mask. Compile finds a mask by id
anywhere in the scene, so outlines 2 to N burned only where they overlapped a mask in outline 1,
which is nowhere. In the audit's 1 × 3 jig, outline 1 burned 1344 of 2025 cells and outlines 2
and 3 burned none. When only the photo was selected, the mask was not moved at all, so outline 1
burned nothing either.

Nothing said so. The design canvas draws a photo without its external mask (`draw-raster.ts`), so
all three photos looked the same, and no Job Review check looked at masks. Duplicate, Copy and
Paste, Array, Copy along path and nesting already copy a photo's mask and point the copy at it
(`sceneObjectCopyClosure`, `remapSceneObjectCopyDependencies`). Only the jig did not.

### Decision

1. **A mask goes where its photo goes.** Centre + copy widens the selection the same way Duplicate
   and Array do: a selected photo's mask and a selected path text's guide are fitted, moved and
   copied with it. Jig outlines never move. As in Duplicate and Array, the mask travels even when it
   is locked or its operation is hidden, because the photo burns only through it.
2. **Each copy uses its own outline's mask.** Copies go through the shared dependency remap with
   that outline's ids. A photo copy names the mask copy in the same outline, and a path text copy
   follows its own guide. A trace's Re-trace link follows its picture only when the picture is
   copied too (ADR-673). Jig copies keep their SVG re-import identity, as before.
3. **Repeating Centre + copy refreshes the mask copies.** They are jig copies like the photo copies
   (ADR-057), so a second click replaces them instead of adding more.
4. **Job Review names a mask that misses its image.** A new advisory, `image-mask-off-image`, lists
   the output images whose mask's closed shape lies wholly outside the image. It says that nothing
   of them will be engraved and offers moving the mask or **Remove Image Mask**. It compares
   bounding boxes, so it never warns about a mask that reaches its image. A mask whose box overlaps
   the image while its shape misses it, such as a ring around a photo, is not named. The warning is
   advisory only (rule 7, ADR-228, ADR-565): the job runs as drawn.

### Consequences

- A jig of masked photos burns every outline. Compile is unchanged, so `EMITTER_REVISION` does not
  move. A project saved with the old copies still burns outline 1 only until Centre + copy is run
  again, and Job Review now names those copies.
- Tests: `registration-jig-artwork-masks.test.ts` uses the real store and `compileJob`. With the
  photo and mask selected, or the photo alone, all three outlines burn the same cells. Before this
  change the counts were `[1344, 0, 0]` and `[0, 0, 0]`. Each outline holds its own mask copy, a
  second click adds nothing, and the advisory fires only for a mask moved off its photo.
- These are code and test results. No jig was burned and no controller was operated.
