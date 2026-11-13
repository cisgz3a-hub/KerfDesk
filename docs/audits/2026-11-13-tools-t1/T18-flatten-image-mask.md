# T18 Flatten Image Mask — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.flatten-image-mask`.

## Map
- **Menu.** Tools → Image → Flatten Image Mask (`app-menu-groups.ts`). Command in `design-tools-commands.ts:107-121`. Description: "Bake the mask into the image, crop it, and delete the mask shape". Help tooltip (`design-tools-command-help.ts:56-60`) adds "unless it is locked or still used". There is no dialog.
- **Eligibility.** `hasMaskedRasterSelection` (`use-app-commands.ts:125-126`). It is true only when the **primary** selection is a `raster-image` with `imageMaskId`. Otherwise the reason shown is "Select an image that already has a mask."
- **Handler.** `flattenImageMaskAction` (`image-command-actions.ts:100-121`) calls `bakeImageMaskAction` (`:124-151`), which calls `cropMaskedRasterImage`. This is the same bake and crop as Crop Image.
  - Then store `flattenImageMask` (`src/ui/state/image-mask-flatten-actions.ts:19-41`) replaces the image in place and drops `imageMaskId`.
  - It deletes the mask object unless `maskIsDeletable` (`:43-51`) says otherwise. The mask stays if it is locked, if another raster uses it as `imageMaskId`, or if a text uses it as `pathText.guideObjectId`.
  - The deletion (`withoutObject`, `:53-61`) filters `objects` and `artworkOrder`, removes the mask from groups, and prunes orphan operations.
  - It selects the image only, in one Undo step.
  - Toasts: "Flattened the mask into X and deleted the mask shape." or "… The mask shape stays because it is locked or still in use."
- **What differs from Crop.** Only the mask deletion and the toast. Crop leaves the mask object on the canvas. Flatten does **not** keep the image size: it crops exactly like Crop (ADR-480 D9).
- **ADRs and workflow.** ADR-480 D9 (Flatten) and Amendment 1 (owned clip, D2 intersect with an existing clip, D3 canvas). WORKFLOW.md F-A6e step 5.
- **Changes since 2026-10-16.** One commit: 19a05d355 (#1471, rolling v3/v4 H5-P2-1) added the owned clip.

## October register re-check
Row #25: "shared/locked-mask reference preservation; same 2MP engine; maximum scene/pixel responsiveness open". **Still fixed.**
- Shared mask: kept, and the other image keeps its live mask with an unchanged burn (A2).
- Locked mask: kept (A3).
- Path-text guide: kept (A3).
- Undo restores the live mask byte-exactly (A1).
- Repo tests pass: `image-command-actions.test.ts` and `design-tools-actions.test.ts` (27 tests), plus `crop-image-mask-clip.test.ts` (6 tests).
- **"Responsiveness open" is still open.** It is the same engine T17 measured (24 MP ≈ 4.5 s of main-thread work). Known; not re-measured.

## Checks run
**Method.** Script `C:\Users\stolk\kd-t1\zz-t18\t18a.test.ts`, log `t18a.log`, helpers `t18-common.ts` (copied from T17). Everything runs through the real store, the real `cropMaskedRasterImage` (only the PNG encoder is stubbed) and the real `prepareOutput` → `emitPreparedGcode`. G1 S>0 moves are decoded into an S map on a 0.05 mm grid. The grid is aligned (40 px over 20 mm at 2 l/mm), so the known T17 edge band is absent and any difference would come from Flatten itself.

| Check | Method | Result |
|---|---|---|
| Size after Flatten | A1 | Cropped: 40×40 → 29×29 px, bounds 13–27.5 × 12.5–27 mm; owned clip set; `imageMaskId` gone. Same as Crop, as the description says |
| Image burn before and after Flatten | A1, S-map diff | Identical: 165.5 mm², ΣS 65 834 both; 0 mm² differs |
| Mask object, own output on a Line operation | A1 | Mask deleted; its 96 S500 cut moves disappear; the "Mask cut" operation is pruned → T18-P3-1 |
| Undo / Redo | A1 | Undo restores the project JSON-equal (image, mask, operation) with equal G-code; Redo equal too |
| Save → reopen | A1 | G-code identical; clip kept; mask absent |
| Shared mask (2 images) | A2 | Flatten R1 → `mask-kept`; R2 keeps `imageMaskId`, and its 72 burn segments are byte-equal. Flatten R2 next → `mask-deleted` |
| Locked mask | A3 | Kept; its cut still burns |
| Mask on a hidden operation | A3 | Deleted, and the hidden operation is pruned (same as Delete; LightBurn also removes the shape) |
| Mask grouped with the image only / with 2 other shapes | A3 | Group dissolved (no 1-member group) / group keeps X,Y |
| Mask used as a path-text guide | A3 | Kept |
| Image already owns a clip (Crop with M1, then Apply M2, then Flatten), positive and Negative | A4 | Clip = M1 ∩ M2 (ADR-480 Amd 1 D2); live vs flattened burn identical (67.25 mm², ΣS equal) under Negative too |
| Second mask outside the owned clip (in a ring's hole; or outside the cropped bounds) | A4b/A4c | Refused: "Image mask does not overlap the selected image." The live burn was 0 segments, so the refusal is right but the message is wrong → T18-P3-3 |
| Repeated Flatten (menu fired twice before the first bake resolves) | A5, real action | One toast, one Undo step; the second bake is dropped by `cropOwnerIsCurrent` |
| Stale Crop after Flatten | A5 | Silently dropped (correct) |
| Selection order after Apply Mask | A6, real store selection | Image before mask in scene order: enabled. **Mask before image: primary = mask → Flatten/Crop disabled** → T18-P2-1 |
| Canvas after Flatten vs burn | read + T17 C2 (same `drawRasterImage` clip path) | Owned clip drawn; burn = canvas. Before Flatten the canvas shows the whole photo (KNOWN T16-P2-2) |
| LightBurn reference | docs.lightburnsoftware.com/2.0/Reference/ApplyMaskToImage | Right-click the masked image → Flatten Image Mask; it "also removes the masking shape". Silent on shared or locked masks, image size and Undo. The mask may be on a Tool or Line layer |

## Findings

### T18-P2-1: With the image and its mask both selected (the selection Apply Mask leaves), Flatten and Crop are disabled whenever the mask comes before the image in scene order
- **Severity: P2**, "a refusal that should not happen".
  - The user applies the mask and goes straight to Tools → Image → Flatten with the same selection. Flatten is grey, and the reason says "Select an image that already has a mask." But the image does have a mask and is selected.
  - Harm is limited: the burn is not wrong, and clicking the image alone works. But the message points the user the wrong way.
  - A natural order triggers it: draw the shape first (the coaster circle), then import the photo, or bring the photo to the front.
- **Where.**
  - `src/ui/commands/use-app-commands.ts:125-126` looks only at the primary `selected`.
  - The primary is the first selected id **in scene object order**, not in click order (`src/ui/state/scene-group-actions.ts:176-181`, `orderedLiveIds` `:215-231`).
  - `design-tools-command-context.ts:41` passes the same `selected` to `flattenImageMaskAction`. Crop shares the gate (`command-families.ts:214-230`).
- **Repro.** `C:\Users\stolk\kd-t1\zz-t18\t18a.test.ts` A6, log `t18a.log`. The user clicks R, Shift-clicks M, then runs `applyImageMask('R','M')`.
  - Objects [R, M]: primary R, Flatten enabled.
  - Objects [M, R]: primary M, extra R, R masked by M, **Flatten/Crop enabled = false**.
  - Expected: enabled in both cases, because the selection contains exactly one masked image.
- **Oracle.** LightBurn flattens "the masked image" from its right-click menu. Apply Mask's own gate (`selectedImageMaskPair`) accepts the pair in either order, so the same selection should qualify for the follow-up commands.
- **Suggested fix.** Resolve the target as the one masked raster in the selection (primary first, else the only `raster-image` with `imageMaskId` among the selected ids). Feed it to both the gate and `bakeImageMaskAction`.

### T18-P3-1: Flatten deletes a mask that was cutting and prunes its operation; the notice does not say the cut no longer runs
- **Severity: P3 (notice).** ADR-480 D9 decides the deletion, and the toast says the shape was deleted. But a mask on an output Line operation is a common "cut the coaster out" outline (KNOWN T16-P3-2: the mask keeps its own operation with no notice). After Flatten that cut is gone, and so is the operation with its settings, until Undo.
- **Where.** `image-mask-flatten-actions.ts:28-29,53-61` (`pruneOrphanLayers`); toast at `image-command-actions.ts:114-118`.
- **Repro.** t18a A1: before, 96 S500 cut moves on "Mask cut"; after, 0, and the operations list goes from `img,mask` to `img`.
- **Suggested fix.** When the deleted mask had output, add "Its cut on <operation> was removed too", or keep a mask that is on an output-on operation.

### T18-P3-2: The "kept" notice says "locked or still in use"; ADR-480 D9 and WORKFLOW F-A6e say it names which
- **Severity: P3 (wording).** ADR-480 D9: "the notice says which happened". WORKFLOW F-A6e step 5: "the notice says which." The store returns one `'mask-kept'` outcome for a locked mask, a shared mask and a path-text guide alike (A3), and the toast is one fixed string.
- **Where.** `image-mask-flatten-actions.ts:11,30`; `image-command-actions.ts:117`.
- **Suggested fix.** Return `'mask-locked'` / `'mask-in-use'` and say which, for example "…stays because another image uses it".

### T18-P3-3: After Crop or Flatten, a new mask that misses the image's own clip is refused as "does not overlap the selected image"
- **Severity: P3 (wrong message).** The refusal is correct, since the live mask burns nothing (0 segments), but the reason is false. The mask lies on the image; it misses the clip left by the earlier bake. The probe in `cropMaskedRasterImage` honours the owned clip (`image-mask.ts:52-66`). Same line as KNOWN T17-P3-2, different cause.
- **Where.** `src/ui/raster/crop-image.ts:41-51`.
- **Repro.** t18a A4c: ring-shaped first mask, then Crop, then Apply a square inside the ring's hole, then Flatten. It throws "Image mask does not overlap the selected image."
- **Suggested fix.** When the mask alone overlaps but the mask ∩ clip is empty, say "The mask lies outside the part of the image kept by an earlier crop."

## Not a defect / limits
- **Inherited and KNOWN, not re-raised.** Flatten is a co-site of each of these:
  - T16-P2-1 and T16R-P2-1: the baked clip uses even-odd over all paths.
  - T17-P2-1: the bake whitens on the source grid, and the crop box comes from source centres.
  - T17R-P2-1: a sharpen rim after the bake.
  - T17-P3-1: the grid is re-anchored.
  - T17-P3-2: a sub-pixel mask is refused.
  - T16-P2-2: the canvas does not show a live mask, so before Flatten the photo looks whole.
  - T16-P3-2: the mask's own operation.
  - October row #25 / #24: latency is open.
- **Hidden mask deleted.** It matches LightBurn ("also removes the masking shape"), and the toast says so.
- **Operation pruned with the mask.** Ordinary Delete does the same (`object-delete-actions.ts`).
- **Owned clip plus a new mask.** Flatten intersects (D2) and burns identically under Negative (A4).
- **The deletion does not run `repairDanglingObjectDependencies`.** It is not needed, because `maskIsDeletable` refuses whenever an image or a path text still references the mask.
- **Dangling `imageMaskId`** (mask object missing): the command stays enabled and does nothing, with no toast (`image-command-actions.ts:134-137`; A5). I found no real path that leaves a dangling mask id (Delete repairs it), so it is not raised.
- **Not checked.**
  - Browser UI and keyboard (no browser run, by the task).
  - Rotated or mirrored images (same bake as T17, which covered them).
  - Real PNG encode time.
  - Project sheets.
  - Retained arrays and registration jigs that reference the mask (deletion behaves like ordinary Delete there).
  - Hardware.

## Totals
Raised 4; P1 0; P2 1; P3 3; known 9 (T16-P2-1, T16R-P2-1, T16-P2-2, T16-P3-2, T17-P2-1, T17R-P2-1, T17-P3-1, T17-P3-2, October register row #25 responsiveness open).
