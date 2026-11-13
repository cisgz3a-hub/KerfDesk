# T19 Remove Image Mask — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.remove-image-mask`.

## Map
- **Menu.** Tools → Image → Remove Image Mask (`app-menu-groups.ts:142`). Also on the canvas right-click "more" list (`workspace-context-commands.ts:72`). There is no dialog and no toast.
- **Command.** `imageMaskRemoveCommand` (`command-families.ts:196-211`). It is enabled when `hasMaskedRasterSelection` is true (`use-app-commands.ts:125-126`): the **primary** selection must be a `raster-image` with `imageMaskId`. Disabled reason: "Select an image that already has a mask." Tooltip (`raster-command-help.ts:40-43`): "Remove the selected image mask without changing the original image pixels."
- **Handler.** `removeImageMaskAction` (`image-command-actions.ts:77-84`) calls store `removeImageMask(selected.id)` for the primary selection only.
- **Store.** `removeMask` (`ui/state/image-mask-actions.ts:40-53`) drops `imageMaskId` from the image and nothing else. It pushes one Undo step, clears Redo and sets dirty. It does not change the selection and does not touch the mask object. It is a no-op without an `imageMaskId`. The owned clip (`imageClip`) is never touched.
- **Readers of `imageMaskId` afterwards.** Compile (`compile-job-raster.ts:403-408` → `createImageMaskPixelTest`, `image-mask.ts:47-66`; a missing mask masks nothing). Preview cache keys on the mask (`draw-raster-preview.ts:313-349`). Preflight `image-mask-off-image-issues.ts`. Output scope (`output-scope.ts:41`). SVG export (`export-scene-svg.ts:265-273`). Save Processed Bitmap, Photo Engraving, Stamp source, trace ownership, nesting dependencies and copy remap. Delete repairs a dangling id (`repair-object-dependencies.ts:28-65`).
- **ADRs and workflow.** ADR-480 and Amendment 1 (D3: "Remove Image Mask does not remove [the owned clip]: like LightBurn's Crop, the bake is permanent, and Undo restores the masked image"). ADR-633 Amd 2/3 (preflight offers "use Remove Image Mask"). WORKFLOW.md has no step for Remove itself; the mask workflow is around line 238 and F-A6e (Flatten). Tutorial `image-mask` step "Keep the mask or crop" (`image-tutorials.ts:103-108`).
- **Changes since 2026-10-16.** The store action and command are unchanged. `repair-object-dependencies.ts` was added in 2b1dd06c9 (2026-10-20, major-PR audit). It is the delete-time repair of dangling mask ids.

## October register re-check
Row #26 ("reference-only removal and undo; eligibility/ownership cases; no pixel processing; large scene latency unmeasured"). **Still fixed.**
- Reference-only removal: A1 shows the image JSON after Remove equals the never-masked image, and the mask object JSON is unchanged.
- Undo: exact (A1, 6 variants).
- Eligibility: disabled after Remove and after Crop/Flatten. Locked images cannot be selected (A5).
- Large-scene latency, which was unmeasured: the store action takes 0.7–1.3 ms in a 3,001-object scene (A6). It is O(objects). Preview recompile of the image afterwards was not timed.
- Repo tests: `command-image-mask.test.ts`, `image-command-actions.test.ts`, `image-mask-actions.test.ts`, `command-lock.test.ts` and `trace-part-dependencies.test.ts`. 5 files, 28 tests, all pass.

## Checks run
Script `C:\Users\stolk\kd-t1\zz-t19\t19a.test.ts`, log `t19a.log`, helpers `t19-common.ts` (copied from T17/T18). Everything runs through the real store, the real menu handler `removeImageMaskAction` with the real gate expression, the real `cropMaskedRasterImage` (only the PNG encoder is stubbed) and the real `prepareOutput` → `emitPreparedGcode`.
- **Oracle.** The G-code of the same project that was **never masked**, compared as text. I also decoded G1 S>0 moves into an S map on a 0.05 mm grid with my own decoder.
- **Image setup.** 40×40 px over 20 mm burned at 5 l/mm. This deliberately does not align with the source grid. Every pixel has a distinct value.

| Check | Method | Result |
|---|---|---|
| Burn after Remove = never-masked burn. Variants: grayscale; Negative; Floyd + bidirectional + 3 mm overscan; image rotated 30° + mirrorX + 1.3×0.8; Threshold with the mask on an output Fill op; brightness/contrast/sharpen | A1 | **G-code text identical in all 6**. S map differs by 0 mm², ΣS equal. The masked G-code differed in every case, so the test is live |
| Mask object untouched; its own operation still burns | A1 | Mask JSON unchanged; its Line cut / Fill hatch is in the identical G-code |
| Preview bitmap | A1, `rasterPreviewBitmap` | Byte-equal to the never-masked preview. The cache key moves to `mask:none` |
| Undo / Redo | A1 | Undo: JSON- and G-code-equal to the masked state. Redo: equal to the removed state |
| Second Remove | A1 | No-op, no extra Undo step, command disabled |
| Save → reopen | A1 | G-code = never-masked; no `imageMaskId` |
| Shared mask (2 images) | A2 | Remove on R1: R1 burns as never-masked (3985 segs equal); R2 keeps `imageMaskId`, and its 1116 segs are byte-equal |
| Two masked images both selected | A2 | Only the primary loses its mask; the other stays masked, with no notice → T19-P3-2 |
| Dangling `imageMaskId` loaded from a file | A3 | Kept on open; burns whole (G-code = never-masked); preflight silent; **Export SVG refuses** "The image mask is missing or is not vector artwork."; Remove is enabled, clears it, and SVG export then succeeds → T19-P3-3 |
| Mask deleted in the app | A3 | Delete repairs the id; burns whole |
| After Crop (owned clip, same for Flatten) | A4 | `imageMaskId` gone; Remove disabled; the store call changes nothing. The image is 29×29 px (was 40×40), with 179 of 841 pixels whitened. The full photo comes back only through Undo → T19-P3-1 |
| Owned clip + a second live mask, then Remove | A4 | Burn equals the cropped image's burn exactly; clip kept |
| Pair still selected after Apply, image first / mask first | A5 | Enabled / **disabled**. KNOWN T18-P2-1 (refuter extended it to Remove; PR #1865) |
| Locked mask | A5 | Remove works; mask unchanged; its cut still burns |
| Locked image | A5 | Not selectable, so Remove is unreachable (consistent with Lock) |
| Latency | A6 | Store action 0.7–1.3 ms with 3,001 objects |
| LightBurn | docs.lightburnsoftware.com/2.0/Reference/ApplyMaskToImage | Right-click → "Remove Mask from Image", or delete the mask vector; both "fully restore the original image". After Crop "you will be unable to remove or edit the mask". KerfDesk matches all three (A1, A3 delete, A4) |

## Findings

### T19-P3-1: After Crop or Flatten, Remove is disabled with "Select an image that already has a mask", although the image is drawn in its mask shape; nothing says the bake is permanent or that only Undo brings the full photo back
- **Severity P3 (wording).** The behaviour is decided: ADR-480 Amd 1 D3 says the bake is permanent and Remove leaves the owned clip, the same as LightBurn's Crop. But the reason the user sees is false for this image. The canvas draws it clipped to the shape (D3), so to the user it "has a mask". The tooltip promises "without changing the original image pixels", and those pixels are gone: A4 shows 29×29 px kept of 40×40, with 179 whitened. The tutorial step says "Remove Image Mask shows the full picture again". Its only warning is a tip about saving a copy before Crop.
- **Where.** `command-families.ts:205-210` (one reason for every case); `use-app-commands.ts:125-126`; `image-tutorials.ts:106`.
- **Repro.** `t19a.test.ts` A4: real `cropMaskedRasterImage` → store `cropImage`, then select the image. Remove is disabled, and the store call changes nothing (JSON equal, Undo depth 1 → 1).
- **Oracle.** LightBurn's page states it outright ("you will be unable to remove or edit the mask"). ADR-480 Amd 1 D3.
- **Suggested fix.** When the primary image has an `imageClip` and no `imageMaskId`, use the reason "This image's mask was baked by Crop or Flatten and cannot be removed. Use Undo to get the full image back."

### T19-P3-2: With several masked images selected, Remove unmasks only the primary one and says nothing
- **Severity P3.** No wrong burn that Preview would not show, but the user's intent is half done. A common case is jig or array copies that each carry their own mask (ADR-633 Amd 2). Selecting them all and choosing Remove unmasks one of them. The command has no toast, and the canvas never showed the masks (KNOWN T16-P2-2), so nothing tells the user that the others still burn masked.
- **Where.** `image-command-actions.ts:77-84` acts on `selected` (the primary) only; the gate reads the primary only.
- **Repro.** `t19a.test.ts` A2. R1 and R2 are both masked by M. Select R1, then Shift-select R2, then Remove. Result: R1 removed, R2 still `M`, Undo depth 1.
- **Oracle.** The command's own wording, "Remove the selected image mask". LightBurn's page describes a single image only, so it is silent here.
- **Suggested fix.** Remove the mask from every selected raster that has one (one Undo step). Or enable the command only for a single masked image and say so in the reason.

### T19-P3-3: A project opened with a dangling `imageMaskId` keeps it: the image burns whole and preflight is silent, but Export SVG refuses, and nothing points to Remove Image Mask, which clears it
- **Severity P3.** The burn is right: a missing mask masks nothing, and the G-code equals the never-masked image. Reach is limited to files written before the delete-time repair (2b1dd06c9, 2026-10-20) or edited by hand. In-app Delete repairs the id (A3).
- **Where.** Open path: `deserializeProject` / `setProject` do not run `repairDanglingObjectDependencies`; `project-shape-validator.ts:332` only checks that the field is a string. Refusal: `export-scene-svg.ts:268-269`. Crop and Flatten also do nothing silently on such an image (T18 limits; `image-command-actions.ts:137`). Stamp refuses with "Repair or remove the mask" (`stamp-source.ts:55-57`).
- **Repro.** `t19a.test.ts` A3. Serialize an image with `imageMaskId: 'GONE'` and no such object, then reopen.
  - The id is kept, the G-code equals the never-masked image, and preflight gives `[]`.
  - `exportSceneSvg` returns the error "The image mask is missing or is not vector artwork."
  - Remove is enabled. After it the id is gone and the SVG export succeeds (the log's "err undefined" is my harness reading `.ok` on a `kind:'ok'` Result).
- **Oracle.** The app's own rule that a deleted mask releases its image (`repair-object-dependencies.ts`), and LightBurn's "delete the vector … fully restore the original image".
- **Suggested fix.** Run `repairDanglingObjectDependencies` when a project opens (as delete does). Or have SVG export skip a missing mask the way compile does.

## Not a defect / limits
- **Known, not re-raised.**
  - T18-P2-1: Remove is disabled with the pair selected when the mask comes first in scene order (A5 confirms it for Remove; PR #1865).
  - T16-P2-2: the canvas never shows a live mask, so Remove makes no visible change and has no toast. That is why the tutorial line "shows the full picture again" describes nothing the user sees.
  - T16-P2-1 and T16R-P2-1 (mask region rule) and T17-*: they do not affect Remove, which restores the unmasked burn exactly.
- **Remove keeps the mask object and its operation.** By design, and LightBurn's right-click Remove does the same (its separate route is deleting the vector).
- **Remove does not reselect.** The selection stays on the image. Fine.
- **Locked image.** It cannot be selected, so it cannot be unmasked until unlocked. This is consistent with Lock.
- **Not checked.**
  - Browser UI and keyboard (no browser run, by the task).
  - Retained-array or registration-jig regeneration after Remove on a source image.
  - Phone remote (it has no mask command).
  - Preview recompile time after Remove on a 24 MP image.
  - Hardware.

## Totals
Raised 3; P1 0; P2 0; P3 3; known 2 (T18-P2-1 reaches Remove too, per the T18 refuter; T16-P2-2 means Remove gives no visible feedback).
