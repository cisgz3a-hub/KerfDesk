# Rolling audit v4 — Image burn journey

- **When:** 2026-10-27   **Tree:** origin/main @ `a59f74ff9` (audit worktree `claude/rolling-audit-v3`, HEAD
  `ee43b3296`; its `src/` equals `a59f74ff9`).
  - Re-checked against newer main `105d6374c` (`git fetch`, `git show origin/main:<path>`), which adds
    #1464 (ADR-670 Amd 1: G1-P3-2, G3-P3-2, G9-P2-1). `git diff a59f74ff9 origin/main` is empty for
    every file cited below, except `PhotoEngravingDialog.tsx`, `PhotoEngravingFields.tsx`,
    `tone-calibration-draft.ts`, `tone-calibration-store.ts`, `layer-settings-clipboard.ts` and
    `draw-raster-preview.ts`. Those are cited at their `105d6374c` lines, marked "(main)".
- **Scope:** the photo → Image Studio → trace or raster → Material Test → burn journey.
  - Code read: `src/core/job/compile-job-raster*.ts`, `src/core/raster/image-processing.ts`,
    `src/core/effective-output`, `src/ui/raster/**` (Photo engraving, Adjust Image, Save Processed
    Bitmap, Crop / Flatten, stamp), `src/ui/calibration/tone-calibration-*`,
    `src/core/material-library` and `src/ui/state/material-library-actions.ts`,
    `src/ui/image-editor` (Apply), `src/ui/workspace/draw-raster*.ts`,
    `src/ui/state/registration-jig-artwork-actions.ts`, `src/ui/camera/trace-from-camera.ts`,
    `src/core/camera/model/bed-image.ts`, `rotary-transform.ts`, `similarity-transform.ts`,
    `src/core/preflight/layer-mode-preflight.ts`, `src/ui/laser/job-intent-warnings.ts`.
  - Governing ADRs: ADR-317, ADR-480 #9, ADR-581, ADR-670 and Amd 1, ADR-671, ADR-673, ADR-599,
    ADR-606; background ADR-026, ADR-359, ADR-440.
- **Lenses run:** L9 (main), then L3 and L1 on what L9 found.
  - L9 paths diffed for the same photo:
    - the layer's image settings, the Photo engraving window, Image Studio Apply;
    - Material Library preset and process recipe, Copy/Paste settings, tone calibration Apply;
    - Crop Image and Flatten Image Mask, Replace Image, a camera capture used as the image;
    - the jig (Centre + copy), stamp preparation, rotary raster, Print-and-Cut raster;
    - Save Processed Bitmap.
  - Previews diffed: canvas Preview, the Photo engraving preview, the hover card, Job Review
    preflight and advisories, and the Inspector advisory.
  - Trace paths: the Trace dialog, Trace from camera (the same dialog) and the jig tracer.
  - The Material Test card has no image mode (`material-test-grid.ts` builds Fill or Line rows only),
    so that path is only the Photo engraving guide's advice. It is not a code path.
  - L2, L5 and L6 were skipped. The one outside assumption, LightBurn's Negative Image on a flattened
    mask, could not be fetched (see Not verified).
- **Repros:** temporary `zz-h5-*.test.ts` Vitest files, all deleted. They used the real store actions
  and the real `compileJob` / `compileRasterGroupsForLayer` on images of 20–600 px, run one file at a
  time with `node ../../../node_modules/vitest/vitest.mjs run <file>`.
- **Counts:** 7 raised → 0 refuted → P1 1 / P2 3 / P3 3 (+ 4 KNOWN still present; 3 KNOWN fixed on
  `105d6374c`). Refuter: 6 CONFIRMED, 1 PLAUSIBLE (H5-P3-3), 0 refuted, no severity change.
- **Refuter pass (2026-10-27):** fresh context, own `zz-h5r-*` Vitest repros (all deleted), same
  runner. Every cited file in H5-P1-1, H5-P2-1, H5-P2-2, H5-P3-x and the KNOWN items is unchanged
  between `a59f74ff9` and `origin/main` `105d6374c` (`git diff --stat` empty). `gh pr list --state
  open` returns `[]`.

## Headline

The main burn pipeline is consistent. Every preview the operator uses before a burn compiles through
the same `compileRasterGroupsForLayer` with the photo's effective settings: canvas Preview, the Photo
engraving preview and the hover card. #1464's three tone-calibration fixes hold on `105d6374c`.

The defects are in the side paths that create or move a photo, or move its settings:

- **H5-P1-1.** The jig editor's **Centre + copy** gives every copy of a masked photo the first
  outline's mask. Copies 2..N burn nothing, while the canvas draws all of them.
- **H5-P2-1.** **Crop Image** and **Flatten Image Mask** bake the masked-out area as white source
  pixels before Negative and brightness run. The live mask whitens after them. On a light-mark
  material, the corners outside the mask then burn at full power.
- **H5-P2-2.** Assigning or linking a Material Library preset keeps the operation's old tone curve.
  The new material burns corrected for the old one: 32 % fewer dots in the repro.
- **H5-P2-3.** A Grayscale tone calibration can be burned and recorded, but the only place to choose
  one turns the photo to Jarvis.

## Findings

### H5-P1-1 — Jig **Centre + copy** gives every copy of a masked photo the first outline's mask, so copies 2..N burn nothing

- **Where:**
  - `src/ui/state/registration-jig-artwork-actions.ts:179-180` and `:297-311`.
    `buildJigArtworkLayout` makes each copy with `translatedObject`, which changes only `id` and
    `transform`. The copy's `imageMaskId` still names the original mask, which sits in outline 1.
  - Reached from the jig editor's **Centre + copy artwork to all N** button
    (`JigEditorSidebar.tsx:187` → `centerJigArtwork`, `jig-editor-session.ts:171-175`) and from the
    store's `centerSelectionInRegistrationBox` (`selection-transform-actions.ts:141-142`).
- **Anchor:**
  - Twin: every other copy path remaps the mask to the copied mask with
    `remapSceneObjectCopyDependencies` (`scene-object-copy-dependencies.ts:36-38`). Those paths are
    Duplicate, Copy and Paste, Array, Copy along path, nesting and variable arrays; ADR-673 Decision 6
    lists them.
  - Compile resolves the mask by id across the whole scene (`compile-job-raster.ts:357-363`).
  - The design canvas clips a photo only by its own `imageClip` (`draw-raster.ts:221`), never by the
    external mask. So the canvas shows the photo in every outline.
- **Scenario:**
  1. A 3-outline jig (50 × 50 mm). A photo has a 40 mm circle mask (Apply Mask to Image).
  2. In the jig editor, select the photo and the circle, then click **Centre + copy artwork to all 3**.
  3. The canvas shows the photo in all three outlines. Job Review says nothing.
  4. The burn engraves the photo in outline 1 only. Outlines 2 and 3 get nothing, or only the circle
     if the mask's operation outputs.
  - Only the canvas Preview (P) shows the gap. Frame traces all three outlines.
- **Evidence:** REPRO (`zz-h5-jig-mask.test.ts`).
  - Setup: real `replaceRegistrationJigSet` (1 × 3), `applyImageMask`,
    `centerSelectionInRegistrationBox`, then `compileJob`.
  - The copies are `registration-jig-copy:photo:…` with `imageMaskId=mask`. The mask copies
    `registration-jig-copy:mask:…` exist, but nothing references them.
  - Burned cells per raster group:
    - `photo` x 117.5–162.5: **1344 / 2025**;
    - copy at x 177.5–222.5: **0 / 2025**;
    - copy at x 237.5–282.5: **0 / 2025**.
- **Severity reasoning:** wrong physical output: no engraving on N−1 pieces. No warning reaches the
  operator, and the design canvas shows the photos. Preview reveals it, but the operator has to look
  unprompted, as with Frame (METHOD §3, 2026-10-27; H8-P1-2 precedent: "the canvas showing … is not
  a warning").
  - A refuter that treats Preview as sufficient would place it at P2.
  - Masked portraits on round coasters or slates in a jig are a standard use of the jig.
- **Novelty:** no audit names `buildJigArtworkLayout`, `translatedObject` or jig mask copies.
  `gh pr list --state open` returns `[]`.
- **Refuter:** CONFIRMED, P1 kept.
  - **What would make it false:** a remap in `withRegistrationJigChild` or `addObject`; compile or
    Preview resolving the mask per outline; or a Job Review check on a masked raster that burns
    nothing. None exists:
    - `withRegistrationJigChild` (`registration-jig-artwork.ts:100-117`) only adds `registrationJig`.
    - `repairDanglingObjectDependencies` sees nothing to repair, because the original mask still
      exists.
    - `imageMaskId` appears in no preflight or Job Review file. `stackedCopyWarnings` keys on it but
      fires only on overlapping copies.
  - **REPRO** (`zz-h5r-jig-mask.test.ts`): real `replaceRegistrationJigSet` (1 × 3, 50 × 50 mm),
    a 40 × 40 px photo with a 40 mm ellipse mask on a visible output-off Line operation,
    `applyImageMask`, both selected, then `applyCenterArtworkInRegistrationJigSet`, which is the
    function `centerJigArtwork` calls.
    - Both copies have `imageMaskId=mask`.
    - Real `compileJob`: `photo` x 117.5–162.5 burns **1587/2025** cells. The copies at
      177.5–222.5 and 237.5–282.5 burn **0/2025**.
    - The Preview path (`compileRasterGroupsForLayer` with `sceneObjects`, as `buildPreviewCanvas`
      calls it on main): the same 1587 / 0 / 0.
  - **Canvas (not Preview):** it shows all three photos, and they look identical.
    - `drawBitmapAtTransform` clips only by `imageClip` (`draw-raster.ts:221`).
    - `draw-raster.ts` never reads `imageMaskId`, so even outline 1 is drawn unmasked as a full
      rectangle.
    - Outline 1 therefore looks the same as 2 and 3 on the canvas, and the canvas gives no cue.
  - **Preview:** outlines 2 and 3 show no burn simulation, only the faint mask outline. Preview
    never draws rasters faintly (`draw-preview.ts:90-92` returns false for `raster-image`).
    - So Preview does show the result, but only if the operator opens it and notices unprompted.
      It shows the result without naming the cause: no message says the copies use outline 1's
      mask.
    - Under METHOD §3 (2026-10-27), only the app naming the specific mismatch can lower a P1. Like
      Frame, an optional view the operator must read unprompted does not count. The Job Review jig
      section (`JobReviewRegistrationJig.tsx`) covers outline/artwork order and focus only.
- **Fix direction:** Build jig copies through `remapSceneObjectCopyDependencies` with the batch's
  `copiedIds`, as Duplicate and Array do. That one change also covers path-text guides. Add a jig test
  with a masked photo that compiles all N copies. `traceSourceId` is not remapped either, and the same
  helper fixes it.

### H5-P2-1 — Crop Image and Flatten Image Mask bake the mask as white **before** Negative, brightness and the curve; the live mask whitens **after** them

- **Where:**
  - `src/ui/raster/crop-image.ts:28-29` (`UNMASKED_PIXEL = 255`) and `:53-65`. The source luma is
    masked to 255 and cropped, then stored as the image's own pixels. `imageMaskId` is dropped
    (`:61`).
  - Callers: `cropImageAction` and `flattenImageMaskAction`, both through `bakeImageMaskAction`
    (`image-command-actions.ts:86-156`).
- **Anchor:**
  - Twin: compile runs `prepareImageLuma` first (adjust → Negative → curve,
    `image-processing.ts:17-28`; `compile-job-raster.ts:159`). It applies the mask afterwards
    (`applyImageMaskToLuma`, `compile-job-raster.ts:337-343`), so a masked-out pixel never burns.
  - Contract: ADR-480 Decision 9 says Flatten "bakes the mask into the image and crops it exactly as
    Crop Image does". ADR-480's Context quotes LightBurn's Flatten as "leaving you with only an image
    in the shape it had been masked" (`docs/decisions/ADR-480-design-tools-lightburn-gap-batch-5.md:34-35`,
    `:123-126`). The help text says Crop "Bake[s] the selected image mask into pixels"
    (`raster-command-help.ts:38`).
- **Scenario:**
  1. A portrait on slate, with Material marking "Light marks" (Negative) and a circular or oval mask.
  2. Preview shows the oval.
  3. The user runs **Crop Image** to tidy the bounds, or **Flatten Image Mask** to drop the shape.
  4. The four corners of the crop rectangle outside the oval are now white source pixels. Negative
     turns them black, and they burn at full power: on a round slate, off the slate and onto the jig
     or bed.
  - A negative brightness does the same at partial power.
- **Evidence:** REPRO (`zz-h5-crop-negative.test.ts`).
  - Setup: real `cropMaskedRasterImage` and `compileRasterGroupsForLayer`. A 40 × 40 px luma-200
    photo over 20 × 20 mm, an ellipse mask of 20 × 16 mm, 2 lines/mm, power 50 %.

    | Settings | Live mask: burned cells, ΣS | After Crop/Flatten: burned cells, ΣS |
    |---|---|---|
    | Negative, Threshold | 1004 / 1600, 502000 | **1280 / 1280**, 640000 |
    | Negative, Jarvis | 801 / 1600, 400500 | **1077 / 1280**, 538500 (+34 %) |
    | Negative, Grayscale | 1004, 393568 | **1280**, 531568 (+138000 = 276 corner cells × S500) |
    | Brightness −50, Grayscale | 1004, 358428 | 1280, 427152 |
    | Plain (control) | 0 / 203 / 1004 | identical |

- **Severity reasoning: P2.**
  - The burn changes outside the shape the operator masked. Neither the toast nor the canvas says so.
  - The canvas shows white corners. Under Negative, white burns, so the view is literally true but
    not a warning.
  - Kept at P2, not P1, for two reasons:
    - Preview shows the black corners.
    - Rolling-v2 20 refuted "Negative Image burns a transparent background" as LightBurn-equivalent,
      so a refuter may hold the baked result to be LightBurn parity.
  - The defect stands on the twin: one image and one mask burn different areas before and after a
    command described as a bake.
- **Novelty:** new.
  - Rolling-v2 20's refuted item is about transparent pixels of an imported PNG, not a mask that
    KerfDesk itself whitens.
  - The 2026-09-05 F11-01 finding on Crop is about paged pixels.
  - Refuter check: `2026-10-15-tools-image-trace.md` and `2026-10-16-tools-quality-register.md` cover
    Crop/Flatten pixels, bounds and Undo only, not Negative.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** the cropped image keeps a "never burn" clip, Negative skipping
    baked pixels, or LightBurn parity proven. Checked:
    - `crop-image.ts:53-68` drops `imageMaskId` and adds no `imageClip`.
    - `lumaToRgba` writes the corners opaque (`luma-bitmap.ts:46-58`).
    - `prepareImageLuma` inverts every pixel.
  - **REPRO** (`zz-h5r-crop-negative.test.ts`, real `cropMaskedRasterImage` + `compileRasterGroupsForLayer`,
    40 × 40 px luma-200 photo over 20 × 20 mm, ellipse mask 20 × 16 mm, 2 lines/mm, 50 %):
    - The crop is 40 × 32 px with 276 corner pixels at luma 255 and no mask.
    - Plain Threshold: 0 → 0 cells.
    - Negative Threshold: **1004/1600 → 1280/1280** cells (ΣS 502000 → 640000).
    - Negative Jarvis: 801 → 1077 cells (ΣS 400500 → 538500).
    - This matches the auditor's table exactly.
  - **Canvas after Crop:** the corners are opaque white pixels inside the image rectangle, and the
    selection box and Frame cover them.
    - On the light-theme bed (`#ffffff`, `canvas-theme.ts:25-27`) they are white on white, visible
      only because they hide the grid lines. On the dark bed they are plainly visible.
    - The design canvas never shows an operation's Negative, for any photo
      (`raster-adjusted-display.ts:10-11`). Preview shows the corners as burned.
  - **LightBurn (SOURCE, versioned path, fetched 2026-10-27):**
    https://docs.lightburnsoftware.com/2.0/Reference/ApplyMaskToImage/ says a mask "doesn't output
    those parts to the machine". With Crop, "the part of the image outside of your shape will be
    removed". The 1.7 page (`/1.7/Reference/ApplyMaskToImage/`) has the first sentence and "permanently
    remove the hidden areas".
    - None of the 1.7 or 2.0 masking pages, nor the 1.7 Image mode page
      (`/1.7/Reference/CutSettingsEditor/ImageMode/`: Negative "will invert your image during
      engraving"), says how Negative treats a removed area.
    - Forum threads found were anecdotal and not staff statements.
    - So whether LightBurn burns the removed corners under Negative stays **UNVERIFIED**.
    - No web.archive.org copy could be fetched. The citation rests on the versioned docs paths.
  - **Why not P1:** P1 needs the output shown wrong against a ground truth, or the absence of a
    warning. Here the burn is exactly what the stored image means under Negative's documented
    whole-image inversion.
    - KerfDesk treats a removed or transparent area as white luma, which Negative burns. Rolling-v2 20
      refuted "Negative burns a transparent background" as by design, citing LightBurn user reports.
    - LightBurn's own treatment is unverified, so the output cannot be shown wrong against ground
      truth.
    - It is wrong only against the twin: the same image and mask, live versus baked, burn
      differently after a command whose help says it bakes the mask.
    - A broken contract with a clear failure scenario is P2.
    - If the coordinator establishes that LightBurn leaves a cropped or flattened image's removed area
      unburned under Negative, this becomes P1, because nothing names the change.
- **Fix direction:** Bake masked-out pixels as a value that stays blank after the image's own
  adjustments, Negative and curve. Alternatively, keep a "never burn" mask with the cropped image (an
  owned `imageClip` from the mask geometry), which compile applies after `prepareImageLuma`.

### H5-P2-2 — Assigning or linking a Material Library preset keeps the operation's previous tone curve (calibrated for another material)

- **Where:**
  - `src/core/material-library/material-library.ts:107-120`. `applyMaterialRecipe` spreads the
    layer, then the recipe. `MaterialRecipe` (`:3-33`) has no `photoToneCurve`, so the old curve
    survives.
  - Every preset path calls it:
    - Assign (`material-library-actions.ts:75-97`);
    - Link, Refresh and Apply best recipes (`linkedPresetLayer`, `laser-recipe-seeding.ts:20-35`);
    - remote and MCP `apply_material_recipe` (`design-operations.ts:107-121` → Assign).
  - The link snapshot `lastResolved` records the stale curve as part of the preset
    (`laser-recipe-seeding.ts:32`).
- **Anchor:**
  - Twin: ADR-670 Amendment 1 Decision 2 (main) has Copy settings clear a curve the source leaves
    unset: "So pasting an uncalibrated operation removes a curve"
    (`ADR-670-amendment-1-…md:46-47`).
  - Contract: ADR-670 Decision 7 treats a curve as valid only for the dither, DPI, marking, power and
    speed it was measured with.
  - ADR-670 "Verification and limits" says only that a `MaterialRecipe` "does not hold a tone curve
    yet". It does not say that assigning a preset keeps the previous one.
- **Scenario:**
  1. An operation carries a Birch curve, from a process recipe saved from a calibrated photo (ADR-670
     item 6) or from Copy/Paste settings since #1464.
  2. The user switches material by assigning a "Slate" photo preset: Stucki, 8 lines/mm, 70 %,
     2000 mm/min, light marks.
  3. Everything changes except the curve. The slate photo burns corrected for birch, with no notice
     in Cuts, Job Review or the preset link status.
  4. The Photo engraving window would flag it, but only if the photo is opened there and the curve is
     in this computer's saved list.
- **Evidence:** REPRO (`zz-h5-material-curve.test.ts`).
  - The real `applyMaterialRecipe` gives `dither=stucki l/mm=8 neg=true power=70
    curve=Birch Jarvis 254 DPI dark`. `linkedPresetLayer` gives `lastResolved.curve=Birch…`.
  - A 64 × 16 px ramp photo over 32 × 8 mm (256 × 64 cells), compiled:
    - as assigned (Birch curve kept): **5559 dots, ΣS 3891300**;
    - the preset alone: **8194 dots, ΣS 5735800** (−32.2 %).
- **Severity reasoning:** P2, by the precedent of G3-P3-2 (Copy/Paste dropping the curve, about
  47 % more S) and G1-P3-2. Both were tone errors without notice, rated P2. Preview shows the
  corrected tones, but nothing says they belong to another material.
- **Novelty:** new. The G3 and G1 reports, ADR-670 Amd 1 and #1464 cover Copy/Paste and the seeds,
  not Material Library assignment.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** (a) an ADR that says a preset keeps the curve; (b) another step on
    the Assign or Link path that clears it; (c) no way for a curve to reach an operation, as opposed
    to a photo override.
  - **(a) ADR text.**
    - ADR-670 item 6 (`ADR-670-photo-tone-calibration.md:66-68`) makes the curve an operation setting
      "captured by operation-settings copies and process recipes".
    - "Verification and limits" (`:104-106`) says only that `MaterialRecipe` "does not hold a tone
      curve yet".
    - ADR-670 Amd 1 Decision 2 (main) clears a curve the paste source leaves unset.
    - No ADR says preset assignment keeps the old curve.
  - **(b) Assign and Link.** `assignMaterialPresetToLayer` (`material-library-actions.ts:74-97`)
    and `linkedPresetLayer` (`laser-recipe-seeding.ts:20-35`) both go straight through
    `applyMaterialRecipe`.
    - That function already strips the old `powerMode` and `bidirectionalScanOffsetMm` (`:111-115`).
      Its comment says keeping them "would carry one preset's dynamic power into the next preset's
      cut".
    - The curve is the one per-material field it leaves behind. This is an in-function twin.
  - **(c) Reach.** `applyProcessRecipe` writes `step.settings` (`apply-process-recipe.ts:50-52`) onto
    a new operation. Those settings are captured from the photo's effective operation, curve
    included (`capture-process-recipe.ts:68`).
    - The ledger already accepts this path for G3-P3-2.
    - No operation or Cut Settings screen shows a curve (`git grep` for tone curve and calibration in
      `src/ui/layers`, `src/ui/laser` and `src/ui/material-library` on main: 0 hits).
  - **REPRO** (`zz-h5r-curve-gray.test.ts`, real `applyMaterialRecipe` / `linkedPresetLayer` /
    `compileRasterGroupsForLayer`):
    - Assigning a "slate" recipe (Stucki, 8 l/mm, Negative, 70 %, 2000 mm/min) over a Birch-curved
      Jarvis operation gives `dither=stucki lpm=8 neg=true power=70 curve=Birch`.
    - The link's `lastResolved` curve is Birch.
    - A 64 × 8 px ramp burns **2473 dots, ΣS 1731100**, against 4049 dots and ΣS 2834300 for the
      preset alone (−39 % S).
  - **Severity:** kept at P2 for consistency with the ledger. G1-P3-2 and G3-P3-2 are silent
    tone-curve errors from an ADR-670 path, both ledgered at P2.
- **Fix direction:** When a preset is applied, clear `photoToneCurve` (the preset is a different
  measurement), or store the curve in `MaterialRecipe` (ADR-670's open item). Say so when a curve is
  dropped.
- **Refuter note:** the defect needs the curve on the **operation**. A curve applied from the Photo
  engraving window sits in the photo's own override, which a preset never reaches (ADR-317, see
  Refuted).

### H5-P2-3 — A Grayscale tone calibration can be burned and recorded, but the only place to apply one turns the photo to Jarvis

- **Where:**
  - The wedge offers Grayscale: `toneWedgeDithers` (main `tone-calibration-draft.ts:85-90`). The
    Tools seed copies the photo's Grayscale (main `tone-calibration-store.ts:44-54`).
  - The only calibration chooser is in the Photo engraving window
    (`PhotoToneCalibrationField.tsx`, main). Its processing picker offers `PHOTO_DITHERS` only (main
    `PhotoEngravingFields.tsx:39-45`).
  - Its draft maps Grayscale to Jarvis on open (`photo-engraving-settings.ts:42`, `:51`).
  - Apply writes that dither into the photo's override (`photo-engraving-apply.ts:99-107`).
- **Anchor:**
  - Contract: ADR-670 Decision 5 says the curve "applies to every dither including Grayscale"
    (`ADR-670-photo-tone-calibration.md:61`). Decision 2: the wedge burns with "the dialog's dither"
    (`:35`). Verification claims a Grayscale gain of "0.213 to 0.006" (`:98`). Decision 7 makes the
    Photo engraving window the place to choose a calibration.
  - ADR-581 Decision 2 ("Unsupported photo modes start with Jarvis", `:48-49`) predates ADR-670 and
    does not reconcile the two.
- **Scenario:**
  1. A Grayscale photo (a diode on a material that shades well).
  2. Tools → Calibrate → Tone Calibration burns and records a Grayscale wedge.
  3. Photo engraving: the processing swatch already shows Jarvis. Choosing the calibration shows
     "measured with a different photo processing. Burn a new wedge with these settings".
  4. Apply turns the photo to Jarvis with a Grayscale curve. The Grayscale minimum power is dropped,
     because dithers burn at peak.
  - No path keeps Grayscale with a curve, except re-selecting Grayscale afterwards in the artwork's
    own settings.
- **Evidence:** REPRO (`zz-h5-gray-cal.test.ts`).
  - Setup: real seed, draft, `toneWedgeOptions`, `initialPhotoEngravingDraft`,
    `toneCalibrationMismatches`, `photoEngravingImage` and compile. A 60 × 20 px ramp on Grayscale,
    60 %, min 10 %, 2 lines/mm.
  - Steps:
    - The wedge offers `blue-noise,jarvis,stucki,floyd-steinberg,grayscale` and burns
      `dither=grayscale`.
    - The Photo engraving draft opens as `jarvis`. The notice is `["photo processing"]`.
    - After Apply: `dither=jarvis curve=Maple grayscale`.
  - Compiled results:
    - Grayscale with the curve (the ADR's promise): 60 S levels, mean S 268.9.
    - What Apply burns: **2 levels, mean S 201.5** (−25 %).
- **Severity reasoning:** P2 as a broken contract with a clear failure scenario. The window does
  warn, so it is not silent. But the advice it gives ("burn a new wedge with these settings", meaning
  Jarvis) cannot lead to a Grayscale calibration.
- **Novelty:** new. G1 used a Grayscale wedge only to test the power multiplier.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** a second calibration chooser that keeps Grayscale (Tone
    Calibration dialog, Cut Settings), or an ADR that removes Grayscale from the wedge. Neither
    exists:
    - On main the tone-calibration UI (`ToneCalibrationDialog.tsx`, `tone-calibration-*.ts`) has no
      apply-to-photo step.
    - `PhotoToneCalibrationField` is the only chooser.
    - `toneWedgeDithers` (main `tone-calibration-draft.ts:85-89`) explicitly appends `grayscale`.
    - The picker offers `PHOTO_DITHERS` only (main `PhotoEngravingFields.tsx:39-45`), and `photoDither`
      maps everything else to Jarvis (`photo-engraving-settings.ts:41`, `:49-51`).
  - **REPRO** (`zz-h5r-curve-gray.test.ts`): `initialPhotoEngravingDraft` on a Grayscale operation
    with a curve gives `ditherAlgorithm=jarvis`, curve kept.
  - **Severity:** the notice (main `PhotoToneCalibrationField.tsx:67-71`, "measured with a different
    photo processing … Burn a new wedge with these settings") rules out P1, because the change is
    named before output.
    - It stays P2 as a broken contract with a clear failure scenario. ADR-670 Decision 2 lets the
      user burn and record a Grayscale wedge, and Decision 7 makes this window the place to choose a
      calibration, but the window cannot apply one to a Grayscale photo.
    - The notice's remedy points to a Jarvis wedge.
    - The only route to Grayscale plus curve is re-selecting Grayscale in the artwork's own settings
      after Apply. Nothing documents it.
    - P3 would fit only if the coordinator reads this as ADR-581 vs ADR-670 drift with no user
      contract.
- **Fix direction:** Offer Grayscale in the Photo engraving processing picker when the photo already
  uses it, or let Cut Settings / artwork settings choose a saved calibration. Alternatively, amend
  ADR-670 to drop Grayscale from the wedge.

### H5-P3-1 — Six raster checks read the operation's own mode and DPI, not the photo's own settings that compile burns

- **Where:**
  - Job Review layer-mode preflight: `objectCanEmitOnLayer` (`src/core/preflight/layer-mode-preflight.ts:46-60`,
    raw `layer.mode`).
  - The Preview command: `hasPreviewableContent` (`src/ui/commands/previewable-content.ts:27-31`).
  - The upsample advisory: `rasterUpsampleWarning` (`src/ui/laser/job-intent-warnings.ts:232-252`;
    raw `layer.mode`, `passThrough`, `linesPerMm`).
  - Frame bounds for Centre light: `src/core/job/frame-bounds.ts:69-76`.
  - Overscan allowance: `maxOutputOverscanMm` (`src/core/preflight/laser-off-motion-policy.ts:31-33`).
  - Preview status: `sceneHasOutputRaster` (`src/ui/workspace/preview-status.ts:44-53`, raw mode
    plus colour).
- **Anchor:**
  - Contract: ADR-317 Decision 4: "All effective laser settings consumers use the existing
    effective-operation helper" (`DECISIONS.md:20033`).
  - Twin: these consumers do use it:
    - compile (`compile-job-raster.ts:83-84`);
    - the hover card (`hover-output-settings.ts`);
    - the energy and threshold advisories (`raster-energy-warnings.ts:70`,
      `raster-threshold-warnings.ts:35`);
    - the Inspector advisory (`SelectedOperationInspector.tsx:286-290`, with the effective operation).
  - Photo engraving Apply always writes `mode`, DPI and dither into the photo's own settings
    (`photo-engraving-apply.ts:99-107`).
- **Scenario and evidence:** REPRO (`zz-h5-raw-mode.test.ts`; real `compileJob`,
  `detectJobIntentWarnings`, `findLayerModeMismatchIssues`, `hoverOutputSettings`,
  `hasPreviewableContent`).
  - **A.** A 600 px photo over 50 mm on a 10 lines/mm operation. Photo engraving sets 645 DPI.
    Compile is 1270 × 1270 cells (2.1× upsampled), but the upsample advisory stays silent: it checks
    10 lines/mm, 500 ≤ 600. (The Photo engraving window has its own "beyond the source resolution"
    hint.)
  - **B.** A photo on a Line operation, after Photo engraving Apply. Compile burns a 500 × 500
    raster, and the hover card says "30 %, 1500 mm/min".
    - Job Review says "Layer op is in Line mode but has an image assigned; it will not be engraved".
    - `hasPreviewableContent` is false, so Preview is disabled when the photo is the only output.
  - **C.** A photo whose own settings are Line, on an Image operation. Nothing compiles and Job
    Review is silent. The upsample advisory warns about an image that will not burn, and Preview
    stays enabled. (The Inspector warned when the mode was set.)
- **Severity reasoning:** P3. B and C need a photo whose own mode differs from its operation's, which
  is uncommon: the mounted rebind path clears own settings (`operation-actions.ts:141`). A is
  advisory-only and mitigated by the window's own hint.
- **Novelty:** new. G10's Verified clean lists the energy and threshold advisories as effective;
  these six were not covered.
- **Refuter:** CONFIRMED, P3 kept. READ of two of the six sites on `a59f74ff9` (unchanged on main):
  `objectCanEmitOnLayer` tests raw `layer.mode` (`layer-mode-preflight.ts:46-60`) and
  `objectHasOutputGeometry` tests raw `layer.mode === 'image'` (`previewable-content.ts:27-31`).
  Their twins use the effective operation: compile (`compile-job-raster.ts:83-84`) and
  `drawRasterPreview` (main `draw-raster-preview.ts:83-84`). This read, together with the
  auditor's REPRO, makes two independent lines. P3 holds: the mounted rebind clears the own
  settings (`operation-actions.ts:141`), so B and C need an uncommon state, and A is advisory only.
- **Fix direction:** Route all six through `effectiveOperationForObject`, as their siblings do. A
  test should put a photo with its own Image mode on a Line operation, and the reverse.

### H5-P3-2 — Trace from camera stores the bed the camera cannot see as black luma, which burns at full power if the capture's output is turned on

- **Where:**
  - `src/core/camera/model/bed-image.ts:7-8` and `rgba-image.ts:24-29`: "bed points the camera cannot
    see stay transparent", written as `0,0,0,0`.
  - `src/ui/camera/trace-from-camera.ts:80` stores `extractLumaBase64(...)` of that RGBA.
    `extractLumaBase64` ignores alpha (`src/ui/trace/image-loader.ts:397-405`).
- **Anchor:**
  - Twin: every other luma producer composites over white first:
    - import (`compositeRgbOverWhitePreservingAlpha`, `image-loader.ts:249`);
    - PSD (`psd-import-preparation.ts:58-69`);
    - Image Studio Apply (its composite is white-backed, `editor-session-layers.ts:227-230`).
  - The canvas's own rule: "Transparent source burns as white" (`raster-adjusted-display.ts:62`).
  - ADR-673 Decision 7 keeps the capture on an Output-off operation that "the operator can still
    turn ... on deliberately".
- **Scenario:**
  1. Trace from camera of the whole bed, with a camera that does not see part of it (beyond the frame
     or the lens fold).
  2. The capture is kept and its Output is turned on, to engrave the captured drawing.
  3. The canvas shows the unseen area as transparent, but compile burns it solid at the operation's
     full power.
  - The Trace dialog itself reads the PNG composited over white, so traces are unaffected.
- **Evidence:** REPRO (`zz-h5-capture-luma.test.ts`).
  - Setup: the real `warpFrameToBedImage` and `extractLumaBase64`, on a lens with fx 700 at 640 px,
    300 mm above the bed centre, over a 400 × 400 bed. The frame is luma 230.
  - **69.8 %** of the capture is transparent, every pixel with luma 0.
  - Engraved at Threshold, 40 %: **111668 / 160000 cells at S400**, exactly the unseen share. The
    seen bed burns nothing.
- **Severity reasoning:** P3. The capture is Output-off by default, Preview shows the black area, and
  the stock fixture camera sees the whole bed (0 % transparent). The effect is full power where the
  canvas shows nothing.
- **Novelty:** related to the rolling-v2 20 drop "`fitDecodeToStoredGrid` turns transparent pixels
  black … extractLumaBase64 ignores alpha", which was unreachable. This producer is reachable by
  design.
- **Refuter:** CONFIRMED, P3 kept. READ: `bed-image.ts:7-8` leaves unseen bed points
  transparent; `extractLumaBase64` (`image-loader.ts:397-405`) reads R, G and B only, so RGBA 0,0,0,0
  becomes luma 0. `trace-from-camera.ts:80` stores that as-is. All three files are unchanged on main,
  even though #1463 changed other camera files. This read, together with the auditor's REPRO, makes
  two lines. P3 holds: the capture sits on an Output-off operation (ADR-673 Decision 7), and Preview
  shows the black area.
- **Fix direction:** Composite the warped capture over white (or set unseen luma to 255) before
  `extractLumaBase64`, like every other producer.

### H5-P3-3 — A stamp prepared from a photo burns at the photo's import-time 10 lines/mm, not its operation's DPI or the dialog's

- **Where:** `src/ui/state/stamp-preparation-actions.ts:53` and `:74`. The new "Stamp height intent"
  operation takes `linesPerMm: image.linesPerMm`.
  - `RasterImage.linesPerMm` is set once at import (10, in `import-image-action.ts:134` and
    `trace-from-camera.ts:79`). No settings editor writes it; compile reads the operation's.
- **Anchor:** Twin: a stamp from vectors uses the dialog's DPI (`buildBitmapFromVectors` →
  `bitmap-assembly.ts:279`). Convert to Bitmap uses its chosen DPI (`convert-to-bitmap.ts:59`). The
  dialog says "raster sources retain their exact pixels" (`StampPreparationDialog.tsx:114-115`).
- **Scenario:** A logo photo on a 25 lines/mm operation becomes a stamp. Its operation is created at
  10 lines/mm, so the stamp burns at 2.5× coarser rows than the photo it came from. The dialog's
  "Vector raster DPI" does not apply.
- **Evidence:** READ (pure field read; no other writer found by `grep` for `linesPerMm` on raster
  objects).
- **Refuter:** PLAUSIBLE, P3 kept (READ only). The chain checks out: for a raster source
  `prepareStampSource` passes the photo itself (`stamp-source.ts:43-45`);
  `stamp-preparation-actions.ts:53` and `:74` copy its `linesPerMm` to the stamp image and to the new
  operation; import writes 10 (`src/ui/commands/import-image-action.ts:134`); compile reads the
  operation's DPI (`compile-job-raster.ts:169-172`). Not reproduced. P3 holds: the result is a
  separate new "Stamp height intent" operation whose DPI is an ordinary, editable operation setting.
- **Fix direction:** Seed the stamp operation from the source photo's effective operation
  (`effectiveOperationForObject`), as `rasterized-trace-mutation.ts:319-325` does.

## Known (not raised as new)

- **G10-P3-1** (rotated sharpening on a coarse source): `raster-rotated-sample.ts` is unchanged on
  `105d6374c`. It also reaches the Print-and-Cut path, where a registration angle triggers rotated
  sampling.
- **G10-P3-2** and **07-P3-3** (jig tracer fairs Photo shading on CNC and skips colour powers):
  `jig-trace-import.ts` and `jig-image-trace.ts` are unchanged. These are the jig-trace twins of
  L9 item 3.
- **20-K-1 / F20** (Save Processed Bitmap dithers the image-oriented grid): unchanged
  (`processed-bitmap.ts:106-109`).
- **Rolling-v2 20, refuted item:** "Negative Image burns a transparent background". It is related
  to H5-P2-1 but distinct: there KerfDesk's own mask produces the white.
- **Fixed on `105d6374c` and verified by reading:**
  - **G9-P2-1:** Preview keys the curve (`draw-raster-preview.ts:166`, `toneCurveKey` `:172-175`,
    main).
  - **G3-P3-2:** Copy settings reads `LAYER_OPERATION_SETTING_KEYS` (`layer-settings-clipboard.ts:15-31`,
    main).
  - **G1-P3-2:** both seeds use `photoBurnSettings` (`tone-calibration-draft.ts:40-49`, main;
    `PhotoEngravingDialog.tsx:160-175`).
- **Refuter (KNOWN):**
  - `git diff --stat a59f74ff9 origin/main` is empty for `raster-rotated-sample.ts`,
    `jig-trace-import.ts`, `jig-image-trace.ts` and `processed-bitmap.ts`.
  - `processed-bitmap.ts:106-109` still dithers `maskedLuma` before any machine orientation.
  - On main, `photoBurnSettings` is used by `tone-calibration-store.ts:53` and
    `PhotoEngravingDialog.tsx:168`.
  - Main's `previewSettingsKey` line (`draw-raster-preview.ts:166`) includes
    `toneCurveKey(layer.photoToneCurve)`.
  - `layerSettingsFrom` loops over `LAYER_OPERATION_SETTING_KEYS`.
  - Every KNOWN status above holds.

## Refuted

No raised finding was refuted by the refuter.

Auditor-dropped candidates (checked and not raised):

- **"Assign selection" leaves the photo's own settings keyed to a pruned operation, so Save and
  reopen refuse the project.**
  - Reproduced on the store action: `byOperation.op-a` dangles, and `deserializeProject` returns
    "dangling or ambiguous operation id".
  - Dropped as unreachable: `AssignSelectionButton` has no production mount (only its own file
    imports it). The mounted rebind (`operation-actions.ts:131-156`) clears own settings and prunes.
  - It is latent: H7 may want a guard.
- **A material preset assigned to an operation does not reach a photo with its own settings.** By
  design: ADR-317 artwork-owned settings, and the Inspector says "This artwork has its own settings".
- **Image Studio Apply's luma ignores alpha.** No: `compositeSession` fills white and composites over
  it (`editor-session-layers.ts:227-230`), so transparent pixels bake to 255.
- **The tone calibration notice ignores Grayscale minimum power.** ADR-670 Decision 7 lists only
  dither, DPI, marking, power and speed. Not raised.
- **The Photo engraving preview shows only the parent operation's first scan.** This is ADR-581
  Decision 5.
- **The design canvas does not show Negative, the curve or sharpening.** Documented
  (`raster-adjusted-display.ts` header). ADR-670 lists Preview, not the design view.
- **Rasterized trace output inherits a slate photo's Negative.** No: it is forced off in the object's
  own settings (`rasterized-trace-mutation.ts:213-218`, `:239-254`).

## Verified clean

- **One compile for every pre-burn view.**
  - Canvas Preview (`draw-raster-preview.ts:275`, main) and the Photo engraving preview
    (`photo-engraving-preview.ts:29`) compile through `compileRasterGroupsForLayer` with the
    effective operation.
  - The hover card uses effective runs.
  - The Photo engraving preview builds from the same `photoEngravingImage` as Apply.
- **Save Processed Bitmap** resolves the effective operation, power multiplier, controller scale,
  curve, sharpening and mask in compile order (`processed-bitmap.ts:54-109`). The only exception is
  orientation (20-K-1).
- **Image Studio Apply** keeps tones, sharpening, own settings, mask and clip
  (`image-edit-actions.ts:43-52`), and bakes a white-backed composite.
- **Replace Image** keeps the same fields (`raster-replace.ts:50-72`).
- **Rotary raster.** The scan is forced along X with a diagnostic (`compile-job-raster.ts:136-147`).
  The Y scale and reverse are applied to bounds and row order at emit (`rotary-transform.ts:123-139`).
  Previews stay surface-true by design.
- **Print-and-Cut raster.** `applySimilarityProject` transforms every scene object, the photo and
  its external mask included (`similarity-transform.ts:81-117`). Rotation then uses the rotated
  sampler.
- **Copies.** Paste and Duplicate remap own settings and masks (`remapSceneObjectOperationBindings`,
  `remapSceneObjectCopyDependencies`). Only the jig copy misses this (H5-P1-1).
- **Trace from camera** opens the normal Trace dialog (`use-trace-from-camera.ts:68`), so laser and
  CNC conditioning match the dialog. The jig tracer differences are the KNOWN items above.
- **The tone wedge** copies the photo's whole effective operation except the curve: passes, scan
  angle, overscan, dot width and scan offset. Pass-through is forced off.

## Not verified

- No browser run. The jig editor's **Centre + copy** was exercised through the store action that its
  button calls (`centerJigArtwork` → `applyCenterArtworkInRegistrationJigSet`), not by clicking.
- LightBurn's behaviour for Negative Image on a flattened mask was not fetched, so that part of
  H5-P2-1's anchor is UNVERIFIED. The finding rests on the twin.
  - Refuter: the versioned 2.0 and 1.7 `ApplyMaskToImage` pages and the 1.7 Image mode page were
    fetched. They state that the outside area is removed and that Negative inverts the image, but not
    how the two interact. It is still UNVERIFIED, and web.archive.org was not reachable from this
    session.
- Refuter: the H5-P1-1, H5-P2-1, H5-P2-2 and H5-P2-3 repros ran through the real store and compile
  functions, not by clicking. The canvas and Preview views were judged by reading `draw-raster.ts`,
  `draw-preview.ts` and main's `draw-raster-preview.ts`, not on screen.
- Real camera coverage: the stock fixture sees the whole bed. Only a narrowed lens produced unseen
  area for H5-P3-2.
- Not checked:
  - jig copies of text on a path (same `translatedObject`, guide id not remapped; belongs to G9/H9);
  - Design Studio's own `assignSelectionToLayer`;
  - large or paged images;
  - remote and MCP image paths beyond `apply_material_recipe`.
- No hardware was operated; no PR was opened.

```json
[
  {"id":"H5-P1-1","severity":"P1","area":"image-burn-journey","file":"src/ui/state/registration-jig-artwork-actions.ts","line":179,"anchor":"Twin: remapSceneObjectCopyDependencies remaps imageMaskId for Duplicate/Paste/Array/Copy along path/nesting/variable arrays (scene-object-copy-dependencies.ts:36-38; ADR-673 Decision 6 list); compile resolves the mask by id (compile-job-raster.ts:357-363); canvas clips only imageClip (draw-raster.ts:221)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Jig editor Centre + copy builds copies with translatedObject (id and transform only), so every copy of a masked photo keeps the first outline's imageMaskId; real compileJob on a 1x3 jig: outline 1 burns 1344/2025 cells, outlines 2 and 3 burn 0/2025, while the design canvas draws all three photos"},
  {"id":"H5-P2-1","severity":"P2","area":"image-burn-journey","file":"src/ui/raster/crop-image.ts","line":53,"anchor":"Twin: compile applies prepareImageLuma (adjust, Negative, curve) then the mask (compile-job-raster.ts:159, 337-343); Contract: ADR-480 Decision 9 (Flatten bakes the mask exactly as Crop) and its LightBurn quote 'an image in the shape it had been masked' (ADR-480:34-35, 123-126); Ground truth UNVERIFIED: LightBurn docs 2.0/1.7 ApplyMaskToImage say the outside part is removed but not how Negative treats it","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Crop Image and Flatten Image Mask bake masked-out pixels as white source luma before Negative/brightness/curve; on a Negative (light-mark) photo the crop-rectangle corners outside the mask then burn at full power: Threshold 1004 -> 1280/1280 cells, Jarvis 801 -> 1077 (+34% S), Grayscale +276 cells at S500; plain images unchanged"},
  {"id":"H5-P2-2","severity":"P2","area":"image-burn-journey","file":"src/core/material-library/material-library.ts","line":107,"anchor":"Twin: ADR-670 Amd 1 Decision 2 (Copy settings clears a curve the source leaves unset); Contract: ADR-670 Decision 7 (a curve belongs to the dither, DPI, marking, power and speed it was measured with)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"applyMaterialRecipe (Assign, Link, Refresh, Apply best recipes, remote apply_material_recipe) replaces every recipe field but keeps the operation's photoToneCurve, and the link snapshot records it; a Slate preset over a Birch-calibrated operation burns 5559 dots vs 8194 for the preset alone (-32%)"},
  {"id":"H5-P2-3","severity":"P2","area":"image-burn-journey","file":"src/ui/raster/photo-engraving-settings.ts","line":51,"anchor":"Contract: ADR-670 Decision 5 'applies to every dither including Grayscale', Decision 2 (wedge burns the dialog's dither, which offers Grayscale), Decision 7 (Photo engraving is where a calibration is chosen); conflicts with ADR-581 Decision 2 (photo dithers only)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A Grayscale wedge can be burned and recorded, but the only calibration chooser (Photo engraving) opens a Grayscale photo as Jarvis and Apply writes Jarvis plus the Grayscale curve; notice ['photo processing']; burn drops from 60 S levels mean 268.9 (grayscale + curve) to 2 levels mean 201.5"},
  {"id":"H5-P3-1","severity":"P3","area":"image-burn-journey","file":"src/core/preflight/layer-mode-preflight.ts","line":54,"anchor":"Contract: ADR-317 Decision 4 'All effective laser settings consumers use the existing effective-operation helper' (DECISIONS.md:20033); Twin: compile, hover card, energy/threshold advisories and Inspector advisory use effectiveOperationForObject","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Layer-mode preflight, hasPreviewableContent, the upsample advisory, frame-bounds, maxOutputOverscanMm and sceneHasOutputRaster read the operation's raw mode/DPI: a Photo-engraved photo on a Line op burns 500x500 while Job Review says 'will not be engraved' and Preview is disabled; a 645 DPI photo upsampled 2.1x gets no upsample advisory; a photo set to Line on its own burns nothing with no preflight note"},
  {"id":"H5-P3-2","severity":"P3","area":"image-burn-journey","file":"src/ui/camera/trace-from-camera.ts","line":80,"anchor":"Twin: import, PSD and Image Studio composite over white before luma (image-loader.ts:249, psd-import-preparation.ts:58-69, editor-session-layers.ts:227-230); raster-adjusted-display.ts:62 'Transparent source burns as white'; ADR-673 Decision 7 (output can be turned on deliberately)","evidence":"REPRO","verdict":"CONFIRMED","known":"related to rolling-v2 20 dropped fitDecodeToStoredGrid item (unreachable there)","summary":"Trace from camera stores bed points the camera cannot see (RGBA 0,0,0,0) as luma 0 because extractLumaBase64 ignores alpha; with the kept capture's output on, the unseen area burns solid at full power (69.8% unseen -> 111668/160000 cells at S400) while the canvas shows it transparent"},
  {"id":"H5-P3-3","severity":"P3","area":"image-burn-journey","file":"src/ui/state/stamp-preparation-actions.ts","line":74,"anchor":"Twin: vector stamps and Convert to Bitmap use the chosen DPI (bitmap-assembly.ts:279, convert-to-bitmap.ts:59); rasterized trace seeds from the source's effective operation (rasterized-trace-mutation.ts:319-325)","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"A stamp prepared from a photo gets an operation at RasterImage.linesPerMm, an import-time 10 lines/mm no editor updates, instead of the photo's effective DPI or the dialog's DPI"},
  {"id":"G10-P3-1","severity":"P3","area":"image-raster-trace","file":"src/core/job/raster-rotated-sample.ts","line":167,"anchor":"Twin: upright vs rotated sharpen","evidence":"READ","verdict":"KNOWN","known":"G10-P3-1","summary":"Unchanged on 105d6374c; also reached by Print-and-Cut registration rotation"},
  {"id":"G10-P3-2","severity":"P3","area":"image-raster-trace","file":"src/ui/workspace/registration-jig/jig-trace-import.ts","line":103,"anchor":"ADR-349","evidence":"READ","verdict":"KNOWN","known":"G10-P3-2","summary":"Jig tracer still CNC-fairs Photo shading ribbons"},
  {"id":"07-P3-3","severity":"P3","area":"trace (jig)","file":"src/ui/workspace/registration-jig/jig-image-trace.ts","line":84,"anchor":"ADR-461","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 07-P3-3","summary":"Jig trace still skips colour-layer powers"},
  {"id":"20-K-1","severity":"P3","area":"raster","file":"src/ui/raster/processed-bitmap.ts","line":106,"anchor":"Twin: compile orients then dithers","evidence":"READ","verdict":"KNOWN","known":"2026-07-17 F20 / rolling-v2 20-K-1","summary":"Save Processed Bitmap still dithers the image-oriented grid"}
]
```
