# T16 Apply Mask to Image — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.apply-image-mask`.

## Map
- Menu: Tools → Image → Apply Mask to Image (`app-menu-groups.ts:139`; also the workspace context menu, `workspace-context-commands.ts:70`). Command: `imageMaskApplyCommand` (`command-families.ts:178-193`). It is enabled when `selectedImageMaskPair` (`image-mask-command-state.ts:9-26`) finds exactly 2 selected ids: one `raster-image` and one non-raster object with closed geometry (`hasClosedImageMaskGeometry`). Disabled reason: "Select one image and one closed vector mask." There is no dialog.
- Handler: `applyImageMaskAction` (`image-command-actions.ts:68-75`) → store `applyImageMask` (`ui/state/image-mask-actions.ts:22-38`). The store only sets `image.imageMaskId = mask.id`, with one Undo step. Re-applying the same pair does nothing. Applying a second mask replaces the first.
- Core: `applyImageMaskToLuma` / `createImageMaskPixelTest` (`core/raster/image-mask.ts`). `closedMaskContours` takes every closed polyline with 3 or more points from the mask's paths, mapped to scene coordinates through the mask's transform. Membership is **even-odd over all contours** (`pointInEvenOdd`, `image-mask.ts:161`; row form `maskRowCrossings`/`isInsideRowCrossings`, `mask-scanline.ts`), tested at each burn-cell centre. The path's own `fillRule` is ignored.
- Compile: `compile-job-raster.ts:340-399`. An upright image is masked on the burn grid after resample and sharpen, then oriented and dithered. A rotated image or an angled scan (`raster-rotated-sample.ts:78-120`) is masked **on the source pixel grid** and then sampled. Preview uses the same compile (`draw-raster-preview.ts`, worker `raster-preview-bitmap.ts`). The design canvas (`draw-scene.ts:404-408` → `drawRasterImage`) never reads `imageMaskId`.
- Related: preflight `image-mask-off-image-issues.ts` (ADR-633 Amd 2/3); output scope carries the mask as a dependency (`output-scope.ts:35-47`); copies remap the mask (`scene-object-copy-dependencies.ts`); Crop/Flatten bake an owned even-odd clip (`image-mask-clip.ts`, ADR-480 Amd 1).
- ADRs: ADR-480 (+ Amd 1), ADR-633 Amd 2 and 3, ADR-358 (owned clips), ADR-671 (sharpen and mask order), DECISIONS.md:11817-11830 (streamed masks; "mask applied at source resolution" for rotated images), ADR-286 (text resolves non-zero for fills). WORKFLOW.md F-A6e (Flatten) and the line-5692 copy note. Tutorial `image-mask` (`image-tutorials.ts:78-112`).
- Changes since 2026-10-16 to these files: 2254138ea (ADR-648/671 sharpen order), 19a05d355 (#1471: jig copies carry masks, Crop/Flatten keep the mask shape), 9cb1d4394 (rolling v5 J9: Array on board carries masks), ab3226fd1 (C2-P3-1 helpers).

## October register re-check
Row #23 repaired "editable mask association and preserved source pixels". **Still fixed.**
- C1 (`zz-t16/t16c.test.ts`): Apply sets only `imageMaskId`. The scene still holds 2 objects and the luma is untouched. Undo restores the project byte-exactly (JSON equal) and the G-code equals the unmasked G-code. Redo is exact too.
- `command-image-mask.test.ts`, `image-mask-actions.test.ts`, `mask-scanline-parity.test.ts`, `image-mask-off-image-issues.test.ts`, `image-mask-owned.test.ts` and `draw-raster-preview-compiled.test.ts`: 6 files, 29 tests, all pass.
- The register's open stress items (2 MP crop engine; repeated mask-edit UI) belong to T17/T18 or were not rerun here. No browser run.

## Checks run
Oracle: my own winding-number point-in-polygon test (`t16-common.ts`: `winding`, `inEvenOdd`, `inNonZero`) and my own affine (`xf`), not the app's. Burn: real `prepareOutput` → `emitPreparedGcode`. Every G1 move with S>0 is decoded to scene coordinates (front-left, 400 mm bed). Each move is widened ±pitch/2 into a ribbon and compared with the oracle region (image footprint ∩ mask) on a 0.05 mm grid. "Far" means more than 2 cells from any edge. Image: all black, 40×40 px over 20×20 mm, Threshold, 5 lines/mm. Logs: `C:\Users\stolk\kd-t1\zz-t16\t16a.log` to `t16e.log`.

| Check | Method | Result |
|---|---|---|
| Unmasked baseline | t16a 00 | 400.00 mm² burned = oracle, no leak or miss: the decoder is calibrated |
| Rectangle | t16a 01 | leak and miss ≤0.106 mm (cell quantisation), 0 far |
| Circle r 7.3 | t16a 02 | 167.48 vs 167.33 mm², max 0.105 mm, 0 far |
| Rotated mask (30°), mirrored mask, non-uniform mask (1.6×0.7) | t16a 03-05 | all ≤0.106 mm, 0 far |
| Rect with circular hole (one path) | t16a 06 | even-odd matches (hole kept); non-zero would differ by 61 mm² |
| Self-crossing pentagram, shape with no fill rule | t16a 07 | matches even-odd (centre pentagon unburned), same as that shape's Fill (B2: 62.98 mm²) |
| Pentagram, imported SVG with `fill-rule: nonzero` | t16a 08 + B2 | **mask burns 62.08 mm² even-odd; the same object's Fill burns 91.14 mm² non-zero** → T16-P2-1 |
| Text with two overlapping glyph contours | t16a 09 + B2 | **mask 179.4 mm²; Fill 218.04 mm²**; 23.4 mm² missing far from edges → T16-P2-1 |
| Real Dancing Script "Wedding", 40 mm | t16e | mask 863.71 mm² ≈ even-odd 862.95; Fill 870.34 ≈ non-zero 871.79; join lenses ≈8.8 mm² unburned, up to 0.37 mm wide → T16-P2-1 |
| Two disjoint circles in one path | t16a 10 | matches, 0 far |
| Mask partly outside, entirely outside | t16a 11-12 | partly: only the overlap burns (≤0.106 mm); entirely: 0 segments. Preflight names both (ADR-633 Amd 3, read + existing tests) |
| Open path | t16a 22 | not eligible (pair null) |
| Image rotated 30°, mirrored, scaled 1.5×0.8 | t16a 13-15 | mirrored and scaled ≤0.105 mm; rotated 0.376 mm (source px 0.5 mm) → T16-P3-1 |
| Low-res source (2 mm px), upright / 30° / 90° / 45° scan | t16a 16-19 | upright ≤0.105 mm; rotated or angled: **leak 1.22-1.35 mm past the mask**, 9.5 mm² far → T16-P3-1 |
| Realistic sources 100-300 dpi, 5-10 l/mm, rotated or angled | t16d | max leak 0.10-0.23 mm against 0.056 mm upright → T16-P3-1 |
| Bidirectional + 5 mm overscan | t16a 21 | identical to unidirectional, ≤0.105 mm |
| 45° scan pocket at (16.6, 16.4) | B1 | not a defect: my ribbon at exactly ±0.1 mm against 3-decimal G-code rounding; gone with +0.002 mm (t16d) |
| Mask object's own operation | t16b B3 | mask on a Line layer still cuts (S600 on the circle); on a Fill layer it fills solid over the photo; no notice → T16-P3-2 |
| One mask shared by two images | t16b B4 | union burns = oracle, ≤0.106 mm |
| Move the mask afterwards | t16c C1 | live: burn follows (left edge 12.75 → 15.80 mm) |
| Undo / Redo / re-apply no-op | t16c C1 | exact (JSON- and G-code-equal); re-apply adds no undo step |
| Save → reopen | t16c C1 | `imageMaskId` kept; G-code identical |
| Replace an existing mask | t16c C2 | silently replaced; one Undo restores the first. Fine |
| Group as mask (LightBurn allows) | t16c C2 | refused (3 ids → pair null) → T16-P3-3 |
| Design canvas vs burn | t16c C3 | `drawRasterImage` with a live mask: 0 `clip()` calls; with an owned clip: 1 → T16-P2-2 |
| LightBurn reference | docs.lightburnsoftware.com/2.0/Reference/ApplyMaskToImage | Masked areas "hidden from view"; the mask may be a group, including text, on one Tool or Line layer; the masked area is the area Fill Mode would fill |

## Findings

### T16-P2-1: The mask ignores the shape's non-zero fill rule, so text and SVG masks burn less of the photo than the same shape fills
- **Severity P2.** The burn is wrong inside the artwork: whole regions the shape covers stay unburned. Nothing burns outside it, and Preview shows the result, so it stays below P1. LightBurn defines the masked area as what "would normally be solid-filled in Fill Mode". KerfDesk's own Fill resolves text, and paths that carry `fillRule: 'nonzero'`, by non-zero winding (ADR-286; `layer-fill.ts:231`, `fill-material-components.ts:57`). The mask resolves the same object even-odd, so the two disagree on one object. The design canvas does not show the mask (T16-P2-2), so the operator only sees it in Preview.
- **Where:** `src/core/raster/image-mask.ts:63,94,122-161` (`closedMaskContours` drops the path's `fillRule`; `pointInEvenOdd`); `src/core/raster/mask-scanline.ts:25-45`. The same rule is baked by Crop/Flatten (`image-mask-clip.ts:33,50`, even-odd clip) and measured by preflight (`image-mask-off-image-issues.ts`), so T17/T18 inherit it.
- **Repro** (scripts `C:\Users\stolk\kd-t1\zz-t16\t16a.test.ts`, `t16b.test.ts`, `t16e.test.ts`; logs beside them):
  - Pentagram as an imported SVG with `fill-rule: nonzero`: the mask burns 62.08 mm². Fill of the same object burns 91.14 mm². The non-zero oracle is 91.17 mm². 20.7 mm² of central pentagon is unburned, up to 2.75 mm from any edge.
  - Text object with two overlapping glyph contours, Weld overlaps off (the default): the mask burns 179.4 mm². Fill burns 218.04 mm², which is exactly the non-zero oracle. 23.4 mm² is missing.
  - Real bundled Dancing Script "Wedding", 40 mm high: the mask burns 863.71 mm², matching even-odd (862.95). Fill burns 870.34 mm², matching non-zero (871.79). The letter joins (≈8.8 mm², up to 0.37 mm wide) are left as unburned seams in the photo.
- **Oracle:** an independent winding-number test (`t16-common.ts`). The SVG fill-rule default is `nonzero`. OpenType defines glyph interiors as non-zero (ADR-286 Context). LightBurn's page says the masked area is the Fill-Mode area.
- **Suggested fix:** resolve membership per path the way Fill does (`path.fillRule ?? (text ? 'nonzero' : 'evenodd')`, e.g. a non-zero union of those paths), then combine the paths even-odd. Bake the same region in `bakedImageMaskClip`.

### T16-P2-2: After Apply Mask the design canvas still draws the whole photo; only Preview shows the mask
- **Severity P2.** The operator gets no visual result from the command: the photo looks unmasked, so it looks like it will burn whole. LightBurn's page says masked areas are "hidden from view". KerfDesk's tutorial step says "Choose Apply Mask to Image. Zoom in to check the edge" (`image-tutorials.ts:99`), but there is no edge to check. The canvas does clip an image's *owned* clip after Crop/Flatten (ADR-480 Amd 1 D3, "The image looks like what it burns"), so a live mask and a baked one look different. **Partly known:** the fact is stated as context in H5-P1-1 (rolling v3 LEDGER:109), the J9-P1-1 refuter (`J9-fix-output.md:106,111`) and ADR-633 Amd 2/3 Context. It has never been ledgered, decided or fixed as its own finding.
- **Where:** `src/ui/workspace/draw-scene.ts:404-408` passes the image only, and `src/ui/workspace/draw-raster.ts:115-146,221` clips only `imageClip`.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t16\t16c.test.ts` C3. `drawRasterImage` with a masked image (`imageMaskId: 'M'`) makes 0 `clip()` calls and 1 `drawImage`. With an owned clip it makes 1 `clip()`. Expected: the live mask is clipped like the owned clip.
- **Oracle:** the LightBurn ApplyMaskToImage 2.0 page; ADR-480 Amd 1 D3.
- **Suggested fix:** in `drawObject`, look up the external mask and clip with its closed contours in scene space (same rule as T16-P2-1) before drawing the bitmap. Key the display cache on the mask transform, as Preview already does.

### T16-P3-1: Rotated images and angled scans mask on the source pixel grid, so the edge steps and leaks by up to half a source pixel
- **Severity P3.** At realistic resolutions the excess is small: 100 dpi at 10 l/mm leaks 0.23 mm against 0.056 mm upright, 150 dpi 0.16 mm, 254 dpi 0.11 mm (t16d). It reaches 1.35 mm only for 2 mm source pixels (t16a 17-19). DECISIONS.md:11828-11830 records "the mask applied at source resolution" as the streaming design. It does not weigh the output cost, so this is listed for the maintainer, not as a defect.
- **Where:** `src/core/job/raster-rotated-sample.ts:88-94` masks `obj.pixelWidth × obj.pixelHeight`. The upright path masks the burn grid (`compile-job-raster.ts:382-388`).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t16\t16a.test.ts` cases 16-19 and `t16d.test.ts`. Same circle and image: upright, max leak 0.105 mm; rotated 30°, 1.347 mm (9.5 mm² beyond 2 cells); 45° scan, 1.295 mm.
- **Suggested fix:** in the rotated sampler, test the mask at each scan cell's centre in scene space (`createImageMaskPixelTest`-style on the scan grid) instead of on source pixels.

### T16-P3-2: The mask shape keeps its own operation with no notice; on a Fill layer it engraves solid over the photo
- **Severity P3 (wording/notice).** A mask on a Line layer cutting its outline is plausible and matches LightBurn's Line-layer case. LightBurn only accepts masks on a Tool or Line layer. KerfDesk accepts a mask on a Fill or Image operation and says nothing.
- **Where:** `image-mask-command-state.ts:18-20` (no layer check) and `image-mask-actions.ts:22-38`; no preflight check.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t16\t16b.test.ts` B3. The mask on a Fill layer with output on emits S600 hatch moves across the masked area of the photo; on a Line layer it cuts the circle.
- **Suggested fix:** an Apply toast or a Job Review advisory when a mask's own operation outputs ("The mask outline will also cut/fill on <operation>"), or follow LightBurn and require an output-off operation.

### T16-P3-3: A grouped mask is refused, although LightBurn accepts a group of vectors (including text) on one layer
- **Severity P3 (parity gap, no wrong burn).** The workaround is one compound object (t16a 06 shows a holed single path works).
- **Where:** `image-mask-command-state.ts:13` (`selectedIds.length !== 2`). Group selection expands to members.
- **Repro:** `t16c.test.ts` C2: image plus two shapes gives pair `null`, and the reason shown is "Select one image and one closed vector mask."
- **Suggested fix:** accept image + one group whose members all have closed geometry, as one compound mask, or name the group case in the reason.

## Not a defect / limits
- **Fill rule.** Even-odd itself matches LightBurn, whose raw same-layer fill is even-odd (ADR-286 Context), and matches KerfDesk Fill for shapes and SVG paths without a non-zero rule (B2: the pentagram shape's Fill is 62.98 mm², and so is its mask). Only the non-zero sources differ (T16-P2-1).
- **The mask stays in scene space when the image moves.** By design and the same in LightBurn (its page advises grouping). Moving the image off its mask is named by preflight (ADR-633 Amd 3).
- **Mask partly or wholly outside the image.** It burns only the overlap; preflight names it.
- **45° scan pocket in t16a 20.** A decoder artefact, not a missing row (B1, t16d).
- **Not checked:** browser UI (memory gate about 2-3 GB); device scan-offset tables at the mask edge (bidirectional only, with no offset configured); locked or hidden image and mask (locked objects are skipped by normal selection); 2 MP and repeated-edit latency (T17/T18 scope); a real burn (none; simulated output only).

## Totals
Raised 5; P1 0; P2 2; P3 3; known 0. T16-P2-2 is partly known: the canvas behaviour is stated as context in rolling v3 H5-P1-1, v5 J9-P1-1 and ADR-633 Amd 2/3, but was never ledgered as a finding.
