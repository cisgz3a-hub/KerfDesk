## ADR-480 Amendment 6 - The mask is the Fill region of the mask object, and the bake keeps real pixels (2026-11-13)

**Status:** Accepted. Amends ADR-480 Amendment 1 Decisions 1 and 3, and the even-odd reading in
ADR-633 Amendment 3 Decision 3. Fixes tools audit T1 findings T16-P2-1, T16R-P2-1, T16-P2-2,
T17-P2-1 and T17R-P2-1 (all P2), and T17-P3-2 in passing. Frame, Start, output policy and licences
are unchanged. | **Date:** 2026-11-13

### Context

**The region.** Apply Mask to Image read every closed contour of every path of the mask object as
one even-odd set. Fill reads the same object differently: each path under its own fill rule (text
and a path that declares `nonzero` by winding, ADR-286; everything else even-odd), and then the
union of the paths (`layer-fill.ts`). So one object masked less than it fills. A non-zero pentagram
masked 62.08 mm² and filled 91.14 mm². Unwelded script text left its letter joins unburned in the
photo (Pacifico: 63 mm²). Two overlapping squares written as separate `fill-rule:evenodd` paths, as
Inkscape writes them, masked 1200 mm² and filled 1500 mm². Welded text, the default since ADR-321,
was unaffected. LightBurn defines the masked area as the area Fill would engrave. No ADR had weighed
the rule: Amendment 1 and ADR-633 Amendment 3 only described what compile did.

**The canvas.** The design canvas drew a live-masked photo whole, while it drew a baked one clipped
(Amendment 1 Decision 3). Only Preview showed the mask, and the image tutorial's "zoom in to check
the edge" had no edge to check.

**The bake.** Crop Image and Flatten Image Mask took the crop box from the source pixels whose
centres fell inside the mask and whitened every other pixel, while compile tests the owned clip at
burn-cell centres. Those agree only when the source pitch equals the line interval (dpi = 25.4 ×
lines/mm). Otherwise a burn cell just inside the edge averaged whitened pixels: at 96 dpi and
10 lines/mm, 46 % of the outermost cells burned at full power under Negative (0 % through the live
mask), a positive photo lost 46 % of its tone there, and a 0.4 mm ring lost 17 % of its burn.
Compile also sharpens the burn grid before it clips (ADR-671), so the whitened pixels gave the edge
a dark rim even on the aligned grid: +32 % in the outermost band at 100 % / radius 1, +7.5 % at the
photo recipe's 30 % / 0.7. Amendment 1 Decision 1 promised the bake burns "exactly what the masked
one did, under every setting"; its test used the one aligned grid.

### Decision

1. **The mask region is the Fill region of the mask object.** `closedMaskContours` resolves each
   path under the rule Fill uses for it (`path.fillRule`, or non-zero for text, even-odd
   otherwise), unions the paths, and returns the result as even-odd contours in scene space, cached
   per object. Every consumer reads that one region: compile and its streamed and rotated paths,
   Preview and the Photo engraving preview, Save Processed Bitmap, Trace's source mask, kerf
   check, preflight's share on the image (ADR-633 Amendment 3), the clip Crop and Flatten bake, and
   the canvas. SVG export writes one clip path per mask path with that path's own `clip-rule`;
   a clip path keeps the union of its children, which is the same region with the curves kept.
   Where it changes nothing, nothing moves: one even-odd path, or even-odd paths whose boxes do not
   overlap, keep their exact contours with no boolean pass. When the boolean engine fails, the raw
   even-odd contours stand in, as they do in Fill.
2. **The canvas clips a photo to its live mask.** The design canvas clips the bitmap to the mask
   region in scene space before it draws it, so a live mask and a baked one look alike (Amendment 1
   Decision 3 now covers both). The canvas redraws every frame, so moving or editing the mask moves
   the clip. Preview's cached burn now also keys on each mask path's fill rule.
3. **The bake keeps real pixels at the edge; the owned clip alone decides what burns.** Crop and
   Flatten whiten nothing. The crop box is the part of the image the baked clip overlaps, measured
   on the clip's geometry rather than on pixel centres, grown by a margin of real pixels of
   2 mm in scene millimetres: three sigmas of the widest sharpen radius (3 burn cells) plus one
   cell, at the coarsest recommended line interval (5 lines/mm). No burn cell inside the mask then
   reads a pixel the bake changed or removed, under any tone, Negative, dither, sharpening or line
   setting in the recommended range. A mask smaller than one pixel now crops to the pixels it
   covers instead of being refused (T17-P3-2).

### Consequences

- Compile changes only for masks with a non-zero path, text, or several paths whose boxes
  overlap: those now burn the area Fill burns, resolved on the boolean engine's 1 µm grid.
  `EMITTER_REVISION` does not move; every other mask keeps its exact contours and its program. Images cropped or flattened before this change keep their whitened
  pixels and still burn them as before; nothing migrates them.
- A cropped image is now up to 2 mm larger on each side than the mask, where the image has it.
  The margin is real photo, hidden on the canvas, in Preview, in output and in SVG export by the
  owned clip. Image Studio and a trace of the cropped bitmap's own pixels see it, as they saw the
  whole photo before Crop.
- The burn grid still restarts at the cropped image's edge (T17-P3-1, unchanged), so cells can
  shift by up to half a line interval; on flat tone the band means agree within 1 %.
- Below 5 lines/mm with sharpening at a wide radius the margin can be narrower than the Gaussian.
  That is outside the recommended range and is recorded rather than covered.
- Tests: `image-mask-fill-region.test.ts` compares the mask with an independent per-path winding
  oracle (non-zero pentagram, unwelded overlapping text, two overlapping even-odd SVG paths
  through the real parser, the baked clip). `draw-scene-live-image-mask.test.ts` records a full
  canvas frame. `crop-image-edge-burn.test.ts` compiles the live mask and the real bake through
  `compileRasterGroupsForLayer` and compares burn cells band by band by distance from the mask
  edge: 96 dpi Negative and positive, a 0.4 mm ring at 96 dpi, and sharpening at 30 % / 0.7,
  100 % / 1 and 60 % / 3 on the aligned grid. All of them fail on main 0ae26dcd2.
- These are code and test results. No image was burned and no controller was operated.
