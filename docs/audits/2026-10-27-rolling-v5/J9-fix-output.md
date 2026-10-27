# Rolling audit v5 — Output fixes

- **When:** 2026-10-28, early morning +0800   **Tree:** origin/main @ `93334429e` (#1484 merged; re-fetched at the end, unchanged).
  - Merge commits: #1459 `ce0548938`, #1464 `105d6374c`, #1471 `19a05d355`, #1476 `09f7c0087`, #1475 `0db717973`, #1453 `3323c5c3f`, #1477 `f730f5b03`.
  - Later PRs on the same files: only #1471 (on #1464's `PhotoEngravingDialog.tsx`, `PhotoEngravingFields.tsx`) and #1472 `41eb5a88d` (on #1453's `CncSetupDocumentExport.tsx`; J1 owns #1472). No later commit touches the files of #1459, #1471, #1475, #1476 or #1477.
  - **Repros ran on main's exact tree,** the J7 extract `…\scratchpad\j7-main\` (all 10,119 tracked files hash-match `93334429e`, per the J7 refuter), with its NTFS junction to the repo's `node_modules`. No repo file was touched.
  - **Test truth** was checked by swapping the merge's first-parent version of a file in with `vi.mock`, in that same copy.
- **Scope:** fix verification (L10) and twin/entry-point parity (L3, L9) of:
  - #1459 (ADR-250 Amd 4, ADR-433 Amd 5, emitter v34): stacked On path copies keep their wall; the cross-operation line names a finish allowance; tile files give no position. Findings fixed: G5-P1-1, G5-P3-1, G5-P3-2.
  - #1464 (ADR-670 Amd 1): the wedge and the notice at the photo's burn power; Copy settings carries the curve; Preview keys the curve. Findings fixed: G1-P3-2, G3-P3-2, G9-P2-1 (all P2).
  - #1471 (ADR-633 Amd 2, ADR-480 Amd 1, ADR-670 Amd 2): jig copies carry their own masks; Crop/Flatten keep the mask shape; presets drop the curve; Photo engraving keeps Grayscale; Trace from camera composites over white. Findings fixed: H5-P1-1, H5-P2-1, H5-P2-2, H5-P2-3, H5-P3-2.
  - #1476 (ADR-388 Amd 2, ADR-673 Amd 1): LightBurn shape Power Scale; older kept trace photos open with Output off; every reader says so. Findings fixed: H7-P1-1, H7-P1-2, H7-P3-1.
  - #1475 (ADR-547 Amd 1): a failed licence confirmation is `licence-unconfirmed`, not `not-covered`. Finding fixed: H10-P2-1.
  - #1453 (ADR-392 Amd 3): setup package defaults to one file per bit, with a bit header. Findings fixed: F8-P2-1, F8-P3-5.
  - #1477 (ADR-392 Amd 5): Run G-code file reads a tile's bit line below its metadata header; a stopped bit file ends its bit at the next Idle; the restart hint wording. Findings fixed: J1-P2-1, J1-P3-1, J1-P3-4.
- **Lenses run:** L10 (all seven PRs), L9/L3 (copy and placement commands for masked photos; Start / Save / tiles / setup package / recovery for the CNC walls and positions; Tools seed / Photo engraving seed / notice; Preview / Photo engraving preview / canvas; File > Open / Recent / drop / worker / template / autosave / sheet switch / library / production readers; manual, download-page and signed update lanes; tile vs package vs single-file bit files), L8 (conflict survival of every added line; neighbours of each fix), L7 (pre-fix swaps).
  - Not run: L5 (J3/J4 own trust boundaries), L2 beyond reading the cited sources in the ADRs.
- **Repros:** two temporary Vitest files plus seven pre-fix swaps and 32 existing test files, one at a time, from `…\scratchpad\j7-main\` with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2560" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`. The files are listed under "Repro files" at the end.
- **Counts:** 2 raised → 0 refuted → P1 1 / P2 1 / P3 0 (+ 4 KNOWN re-observed).
  - **Refuter (fresh context):** both CONFIRMED by the refuter's own REPRO on main's tree (`origin/main` re-fetched: still `93334429e`). **Severity change:** J9-P3-1 is raised to P2. It is a wrong operational instruction ("Change to bit 2") on an ordinary event, on what is now the default multi-bit path, and it contradicts ADR-392 Amd 5's own recovery. It stays below P1: obeying it skips bit 1's remaining paths, but it does not cut them with the wrong bit (see the finding).
  - **Refuter spot-check of two "fully hold" verdicts:** `emit-gcode-cnc-lead-stacked-on-path.test.ts` (#1459) 5/5 and `lbrn-power-scale.test.ts` (#1476) 6/6, both on main's tree. Both agree with the table.

## Headline

Every finding the seven PRs name is fixed on main for the path it reported. Every added source line survives on main (0 missing of 670), and every regression test swapped against its parent version fails there. The emitter revision moved where output moved (#1459, v34) and nowhere else. Each ADR amendment describes what its code does, with two gaps below.

Two gaps remain on siblings:

- **J9-P1-1 (twin of H5-P1-1, missed by #1471).** **Array on board** (ADR-125, `tileSelectionIntoBoard`) still copies a masked photo with the original's `imageMaskId`, and moves the original off its mask. Only one design can be selected for it, so the mask can never travel with the photo. ADR-633 Amd 2 says "Only the jig did not" copy masks; Array on board does not either. With the photo centred on the board and a 2 × 2 array, each of the four tiles burns about 22 % of the masked engraving (237 of 1,070 cells, a quarter of the circle; 15 % of the photo's 1,600 cells). The canvas shows four whole photos, and no preflight issue or warning appears at all. The new `image-mask-off-image` advisory fires only for tiles whose box misses the mask entirely, and it does not name the partly masked ones. (Refuter: CONFIRMED with a fresh REPRO, desktop and remote `place_on_board`; P1 kept.)
- **J9-P3-1 (L8, from #1477's J1-P3-1 fix).** After an Abort or an alarm part-way through a per-bit file, the machine panel now says "Bit 1 of 2 (…) has run. Change to bit 2 …". ADR-392 Amd 5 itself expects the operator to re-run the same file. (Refuter: CONFIRMED; raised to P2.)

## Fix verification (L10)

| PR | Original finding | Fixed on main? | Siblings (L9/L3) | Regression (L8) | ADR matches code | Test fails pre-fix |
|---|---|---|---|---|---|---|
| #1459 | G5-P1-1 (P1): two On path copies cancel even-odd, so a neighbour's lead plunges 0.675 mm into the part | **Yes.** `emit-gcode-cnc-lead-stacked-on-path.test.ts` 5/5 (independent cutter-disk model; 2.5/3 mm, reversed, doubled path, three copies, 1/4" lead at 5 mm, 1/4" profile at 4 mm); `profile-lead-kept-walls.test.ts` 3/3; `cnc-part-size-review.test.ts` 5/5 (real Start path and Job Review, one and two copies) | Both wall readers follow: the lead obstacles (`profile-lead-job-walls.ts:52`) and the cross-operation check (`compile-cnc-job.ts:170,211`), plus the inlay groups that take `leadWalls`. `profileLeadKeptWalls` has one caller. Start, Save, tiles, setup package and recovery all compile through `compileCncJob` (G5 verified clean) | None. Filled cut types keep the contours their offset reads (`profile-lead-kept-walls.ts:97-99`) | ADR-250 Amd 4 D1–D4 yes; `EMITTER_REVISION` is `cnc-on-path-copy-walls-20261027-v34` on main | **Yes, run:** 4 of 5 fail with the parent `profile-lead-kept-walls.ts` (−0.675, −2.9375, −3.175 mm; the "still cuts every copy" control passes); 2 of 3 wall-model tests fail |
| #1459 | G5-P3-1 (P3): the line blames spacing for a finish-allowance reach | **Yes.** `emit-gcode-cnc-kept-part-cuts.test.ts` 7/7. `onlyRoughingReaches` (`cnc-kept-part-cuts.ts:135-137`) is exactly "finishing alone would clear it": reach 2r + a − g ≤ a ⇔ g ≥ 2r; the clearing figure floor((a − depth)·100)/100 gives 0.42 for the audit's case | The allowance is the clamped effective one (`finish-allowance.ts:25-30`), as ADR-433 Amd 5 D1 says | None | Yes, D1 | By reasoning (the text is new) |
| #1459 | G5-P3-2 (P3): tile files print whole-job positions | **Yes.** `tile-kept-part-positions.test.ts` 1/1 through `prepareOutput` + `finalizeTiledOutput` | `runCncPreflight` has two callers: `emitGcode` (hides positions for relative-origin or an offset) and `emitTileFiles` (now `compiledPositionsHold: false`). Setup-package and two-sided programs run in their compiled coordinates | None | Yes, D2 | By reasoning (new option) |
| #1464 | G1-P3-2 (P2): wedge and notice ignore the power multiplier | **Yes.** `tone-calibration-seed.test.ts` 4/4, `PhotoEngravingDialog.tone-power.test.tsx` 3/3 | Both seeds (`tone-calibration-store.ts:53`, `PhotoEngravingDialog.tsx:170`) use `photoBurnSettings`; `openToneCalibration` has two callers (Tools, Photo engraving). `toneCalibrationMismatches` has one caller, fed the scaled power (`PhotoEngravingDialog.tsx:71`); the `power` prop is used for nothing else | None | ADR-670 Amd 1 D1 yes | By reasoning (pre-fix seed is 60, the test wants 15) |
| #1464 | G3-P3-2 (P2): Copy/Paste settings drops the curve | **Yes.** `layer-settings-clipboard.test.ts` 7/7 | `LAYER_OPERATION_SETTING_KEYS` now equals the `LayerOperationSettings` type's keys exactly (diffed); sub-operations, binding and CNC handled beside it. The clipboard is the only operation-settings clipboard | Pasting now also carries the scan offset and clears an unset power mode: intended and stated (Amd 1 D2) | D2 yes | **Yes, run:** 2 of 7 fail with the parent clipboard (the two new tests) |
| #1464 | G9-P2-1 (P2): Preview cache key omits the curve | **Yes.** `draw-raster-preview-processing-overrides.test.ts` 10/10 | Key built from the effective operation (`draw-raster-preview.ts:83,406-408`). Other S-grid inputs already keyed; dot width correction acts only in the sweep emitter (`compile-job-raster.ts:209` → `emit-raster-sweep.ts:83`). The Photo engraving preview rebuilds from its draft | None | D3 yes | **Yes, run:** the curve test fails with the parent `draw-raster-preview.ts` (9 others pass) |
| #1471 | H5-P1-1 (P1): jig Centre + copy keeps outline 1's mask | **Yes for the jig.** `registration-jig-artwork-masks.test.ts` 6/6; both entry points (`centerJigArtwork`, `centerSelectionInRegistrationBox`) reach `buildJigArtworkLayout` | **Gap: Array on board (J9-P1-1)**, desktop and remote `place_on_board`. Duplicate, Paste, Array, Copy along path, nesting (`nest-dependencies.ts`), variable arrays and remote duplicate use the closure and remap (grep) | None | D1–D4 yes; the Context's "Only the jig did not" is false (J9-P1-1) | **Yes, run:** 4 of 6 fail with the parent actions: `[1344, 0, 0]`, `0`, one mask instead of three, and the off-image advisory |
| #1471 | H5-P2-1 (P2): Crop/Flatten bake white before Negative | **Yes.** `crop-image-mask-clip.test.ts` 6/6 | Both commands go through `cropMaskedRasterImage` (`image-command-actions.ts:91,109,145`). The owned clip is applied in `createImageMaskPixelTest` (`image-mask.ts:52-67`), the same point as a live mask, for compile, Preview and Save Processed Bitmap; even-odd on both. No remote crop/flatten | None | ADR-480 Amd 1 D1–D3 yes (SVG export of the clip read only) | By reasoning (the H5 table is what the test rejects) |
| #1471 | H5-P2-2 (P2): presets keep the old curve | **Yes.** `material-preset-tone-curve.test.ts` 5/5 | `applyMaterialRecipe` is the only preset applier: Assign, Link/Refresh/Apply best (`laser-recipe-seeding.ts:25`), remote `apply_material_recipe`, the wizard (fresh layer). `recipeMatchesLayer` and the recipe preview name the curve | None. An artwork-override curve is untouched by design (ADR-317; H5 Refuted) | ADR-670 Amd 2 D1 yes | By reasoning |
| #1471 | H5-P2-3 (P2): Grayscale calibration turns the photo to Jarvis | **Yes.** `PhotoEngravingDialog.grayscale.test.tsx` 3/3 | Only chooser is the Photo engraving window | None | D2 yes | By reasoning |
| #1471 | H5-P3-2 (P3): unseen bed burns black | **Yes.** `trace-from-camera.test.ts` 7/7 | The other luma producers already composite over white (H5 twin list) | None | — | By reasoning |
| #1476 | H7-P1-1 (P1): LightBurn Power Scale dropped | **Yes.** `lbrn-power-scale.test.ts` 6/6 | Every `.lbrn`/`.lbrn2` route reaches `importLbrnGeometry` (Open, Recent, drop, the worker and the streamed parser: `project-open-parser.ts:53,58`, `document-import-parse.ts:50`, `document-import-source.ts:162`). Vector and raster compile both scale by `effectiveObjectPowerPercent`. No LightBurn exporter exists | None | ADR-388 Amd 2 D1–D3 yes; the Min Power limit is stated | **Yes, run:** 5 of 6 fail with the parent `lbrn-geometry.ts` |
| #1476 | H7-P1-2 (P1): 1.0.27 kept photo reopens engraving | **Yes.** `project-legacy-trace-source.test.ts` 10/10 | The settle is in `deserializeProject`, so every reader keeps the 1.0.27 job, the library, production, recipe-sheet, retained-array and nest readers included; `withImageOutputOff` moves a shared-operation photo to an output-off copy | None | ADR-673 Amd 1 D1–D4 yes; its Limits list the silent readers | By reasoning (H7's repro is what the test rejects) |
| #1476 | H7-P3-1 (P3): template and autosave drop notices | **Yes.** `project-load-notices.test.ts` 7/7, `use-autosave.test.ts` 10/10 | Open, template, autosave and sheet switch call `pushProjectLoadNotices` | None | Yes | By reasoning |
| #1475 | H10-P2-1 (P2): failed confirmation shown as "updates ended" | **Yes.** `licensing-update-confirmation.test.ts` 8/8, `commercial-update.test.ts` 23/23, `platform-manual-update.test.ts` 11/11, `update-status.test.ts` 9/9, `update-status-text.test.ts` 15/15, `licensing.test.ts` 8/8 | All three lanes use `heldReleaseState`; eligibility stays `covered` only, and download re-validates (`manual-update.ts:174,182`). No other text says "ended on" (grep) | None | ADR-547 Amd 1 D1–D5 yes | By reasoning (the state is new) |
| #1453 | F8-P2-1 (P2): package defaults to an M0 single file | **Yes.** `cnc-setup-tool-package.test.ts` 5/5, `CncSetupDocumentExport.test.tsx` 16/16 | One builder caller (`CncSetupDocumentExport.tsx:155`); #1472 kept the mode logic. The Run review remedy names the package (`kerfdesk-bit-changes.ts:12-16`). The Save G-code M0 single file stays a decided residual (ADR-392 Amd 2) | None. No reader needs the provenance header on line 1 (grep) | ADR-392 Amd 3 D1–D4 yes | By reasoning (the ADR's red checks) |
| #1453 | F8-P3-5 (P3): per-bit files carry no bit header | **Yes.** `cnc-tool-programs.test.ts` 9/9 | Tile files had it; package files now too | None | Yes | By reasoning |
| #1477 | J1-P2-1 (P2): tile bit line below line 4 | **Yes.** `tiled-bit-files.test.ts` 12/12 (real tiled save), `kerfdesk-bit-file.test.ts` 8/8 | The bit line sits at line 13 at most: 5 metadata + ≤4 profile + 2 CNC assumption lines + the tile line (`gcode-metadata.ts:191-212`, `tile-emission.ts:107-109`); the header has no blank line | None | ADR-392 Amd 5 D1 yes | **Yes, run:** "names each bit file … below the metadata header" fails with the parent reader (`null`) |
| #1477 | J1-P3-1 (P3): a stopped bit file never ends its bit | **Yes.** `external-run-bit-files.simulator.test.ts` 5/5 | The end patch is idempotent (`bit-file-sequence.ts:39-49` clears `bitFileRun`) | **J9-P3-1:** the panel then says the stopped file "has run" | D2 yes; Consequences' "re-running the same file" is not what the panel says (J9-P3-1) | By reasoning (the ADR's red check) |
| #1477 | J1-P3-4 (P3): restart hint blames the controller | **Yes** (`laser-recovery-automatic-restart.ts:58-59`) | — | — | — | — |

**Conflict survival (L8).** For each merge, every added non-comment line under `src/` and `electron/` (tests excluded) was grepped in main's version of its file:

| PR | Added lines | Missing on main |
|---|---|---|
| #1459 | 65 | 0 |
| #1464 | 57 | 0 |
| #1471 | 163 | 0 |
| #1476 | 161 | 0 |
| #1475 | 126 | 0 |
| #1453 | 71 | 0 |
| #1477 | 27 | 0 |

**Emitter revision.** Only #1459 changes emitted motion (a lead becomes a plunge), and it moved `EMITTER_REVISION` to v34, still current on main. #1464, #1471, #1476, #1475 and #1477 change no emitter output. #1453 prepends comment lines in the package writer, not the emitter, and its ADR says so.

## Findings

### J9-P1-1 — Array on board copies a masked photo with the original's mask and moves the original off it; each tile burns a fragment, with no warning (twin of H5-P1-1 that #1471 missed)

- **Where:**
  - `src/ui/state/board-tile-actions.ts:51-56`: `movedOriginal = translated(target, firstSlot)`, and each copy is `{ ...translated(target, slot), id: crypto.randomUUID() }`. There is no `sceneObjectCopyClosure` and no `remapSceneObjectCopyDependencies`, so every copy keeps `imageMaskId` of the original mask, and the mask itself does not move.
  - `selectedBoardArrayDesign` (`board-tile-actions.ts:78-93`) accepts exactly one selected design (`:87`), so the operator cannot take the mask along.
  - Entry points: the desktop board placement panel (`use-board-placement.ts:17,25` → `BoardArrayForm`) and the remote `place_on_board` command with `action: 'array'` (`src/ui/remote-control/board.ts:66-93`).
  - Compile resolves a mask by id anywhere in the scene (H5-P1-1), and the design canvas never reads `imageMaskId` (`draw-raster.ts`, per the H5 refuter), so the canvas shows every tile as a whole photo.
- **Anchor:**
  - **Twin (L9):** ADR-633 Amendment 2 D1 ("A mask goes where its photo goes") and D2 ("Each copy uses its own outline's mask") for the jig's Centre + copy, which has the same shape: move the original into slot 1, copy it into the others. Its Context (`ADR-633-amendment-2-jig-copies-carry-their-own-masks.md:19-20`) says Duplicate, Paste, Array, Copy along path and nesting "already copy a photo's mask" and "Only the jig did not". Array on board does not either.
  - **Twin:** ADR-125 Decision 2 (`DECISIONS.md:6838-6841`) adds each copy "matching the duplicate action's id minting"; the duplicate action remaps masks.
  - **Parent:** H5-P1-1 (P1, fixed for the jig by #1471).
- **Scenario:**
  1. A 40 × 40 mm photo has a 40 mm circle mask (Apply Mask to Image). A board is placed, and the photo is centred on it.
  2. The operator selects the photo (only one design may be selected) and chooses **Array on board**, 2 rows × 2 columns, 2 mm gap.
  3. The canvas shows four whole photos. Job Review and Start show no warning: each tile's box still overlaps the circle's box, so `image-mask-off-image` stays silent, and the tiles do not overlap, so the stacked-copy advisory stays silent.
  4. Each coaster burns one quarter of the circle, about 22 % of the masked engraving (15 % of the photo).
  - With a 1 × 3 array the advisory fires, but it names one image ("The image "portrait.png" is masked by a shape that does not overlap it"), while tiles 1 and 2 burn 41 % and 17 % of the masked engraving unnamed.
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\state\zz-j9-board-array-mask.test.ts` (copy kept at `…\scratchpad\j9\j9-board-array-mask.test.ts.txt`), 5 passed. Real store: `addCapturedBoardBox(200, 100)`, `applyImageMask('photo', 'mask')`, `tileSelectionIntoBoard`, then `compileJob`, `runPreflight` and `stackedCopyWarnings`. Board at X 100–300, Y 150–250; photo luma 40, Threshold, 1 line/mm.
  - **2 × 2, gap 2, photo centred (180, 180):** before `burned 1070`; after, tiles at (159,159), (201,159), (159,201), (201,201) with `"mask":"mask"` and `burned 239 / 236 / 239 / 236`; `"offImageAdvisory":[]`, `"allPreflight":[]`, `"stacked":[]`.
  - **1 × 3, gap 10, photo at (150, 190):** tiles burn `434 / 186 / 0`; the advisory names one image.
  - **1 × 3, photo off the board (300, 300):** tiles burn `0 / 0 / 0`; the advisory names all three. This is the case #1471's advisory covers.
  - **1 × 1 (a single slot), photo 6 mm off centre:** `burned 970` of 1070, no advisory.
- **Severity:** P1. A reachable wrong burn (each piece gets a fragment of the engraving, or none), shown whole on the canvas, with no warning in the centred layout. That is H5-P1-1's rating for the same defect class. Preview reveals it only if the operator looks unprompted (METHOD §3, 2026-10-27). In layouts where a tile misses the mask box entirely, #1471's advisory does reach Start review; a refuter may weigh that for those layouts only.
- **Novelty:** new. `git grep` of `docs/audits` finds `board-tile-actions` only in the July competitive audit, with no mask. No v3, v4, v5 or quality-round report mentions Array on board with a mask. No open PRs touch the file.
- **Related, not raised separately:** **Fit to board** and **Center on board** (`selection-transform-actions.ts:175-202`) also move or scale one design without its mask, and Fit admits only one design. They are moves, like a drag, which never carries a mask; the copies are what this finding is about. A path text's guide has the same gap in Array on board (Not verified).
- **Fix direction:**
  - Treat a photo and its closure as one design: widen with `sceneObjectCopyClosure` (as #1471 did in `selectedArtwork`), translate the whole closure per slot, and remap each copy with `remapSceneObjectCopyDependencies` using that slot's copied ids.
  - Let `selectedBoardArrayDesign` accept a selection that is one design plus its closure.
  - Add a test that arrays a masked photo through `tileSelectionIntoBoard` and compiles every tile, as `registration-jig-artwork-masks.test.ts` does for the jig.
- **Refuter:** **CONFIRMED (own REPRO). P1 kept.**
  - **What would make it false.**
    - Selecting the photo also selects its mask, so the action is disabled or carries the mask.
    - `applyImageMask` groups the two, or the mask follows the photo some other way.
    - The design canvas clips the photo to its external mask.
    - Start or Job Review warns about partly masked tiles.
    - An ADR accepts the behaviour for Array on board.
  - **None of these holds.**
    - `applyMask` only sets `imageMaskId` (`image-mask-actions.ts:22-38`). It does not group the two.
    - `selectObjects` expands groups only (`scene-group-actions.ts:28-49`). The remote `placeOnBoard` selects exactly `artworkIds` (`board.ts:68`), and `editableArtwork` has no mask check (`transforms.ts:44-53`).
    - The design canvas calls `drawRasterImage` with `imageClip` only (`draw-raster.ts:115-146,221`). `imageMaskId` is read in `src/ui/workspace` only by the Preview renderer (`draw-raster-preview.ts:293-299`), which is drawn only in Preview mode (`draw-scene.ts:150-151,214`). So Preview shows the fragments, but only if the operator opens it.
    - `imageMaskOffImageIssues` compares bounding boxes and reports only a mask box that misses the image box (`image-mask-off-image-issues.ts:36-37`). Its header comment and ADR-633 Amd 2 D4 say a mask that reaches the image is never reported.
    - `detectJobIntentWarnings` and `detectMachineJobWarnings` contain no mask check.
    - The Start path has no picture of the job (no preview in `framed-run-start-review.ts` or `start-job-flow.ts`).
    - ADR-125 D2 says only "Single-design only, like auto-fit" (`DECISIONS.md:6833-6842`). No ADR or amendment mentions Array on board with a mask (`git grep`).
  - **REPRO** (`src/ui/state/zz-j9r-board-array-mask.test.ts`, deleted). It was written fresh: a different photo (50 × 30 mm, 100 × 60 px, all black, Threshold) and a 26 mm circle centred on it. The real `importRasterImage`, `drawShape`, `applyImageMask` and `addCapturedBoardBox` were used. The photo was selected alone with `selectObjects(['pic'])`, as a canvas click does. The burn was counted with `compileJob`. Start-path messages came from `prepareOutput(...).advisories`, `emitGcode(...).preflight.issues` and `detectMachineJobWarnings`. 3 passed.
    - **Selection:** `selectedBoardArrayDesign` returns the photo alone (the panel's button is enabled). With the photo and the mask both selected it returns `undefined`, so the mask can never be taken along.
    - **Desktop 2 × 2, gap 4, board 130 × 80 centred on the photo:**
      - The mask box stays at 187–213 before and after.
      - The original moves to (148, 168)–(198, 198), and every tile has `"mask":"ring"`.
      - Each of the four tiles burns **8,446 of the 52,848 cells the masked photo burned before (16 %)**.
      - The Start path gives only the uncalibrated-defaults, scan-offset and upsample advisories. None mentions a mask.
    - **Desktop fill, gap 2, board 170 × 80** (3 × 2 tiles): the two middle tiles burn 23,832 each (45 %), and the four outer tiles burn 0. `image-mask-off-image` names the 4 empty images, and the two partly burned ones are not named. That matches the auditor's 1 × 3 case.
    - **Remote** `adapter.execute('place_on_board', {artworkIds:['pic'], action:'array', rows:2, cols:2, gapMm:4})`: `{"status":"placed","action":"array","artworkCount":1}`. The four tiles each burn 8,446, with mask `ring`, and no message mentions a mask.
  - **Severity under §3.** The output is wrong: each coaster gets a corner fragment. For every layout where each tile's box still overlaps the mask's box, no warning reaches the operator. Preview is not a warning, by the same reasoning as the Frame clarification. The canvas still shows the mask outline at its old place across the tiles, but that is an unexplained shape, not the app naming the mismatch. Where some tile misses the mask box entirely, the advisory does reach Job Review; it names only the empty tiles, but it would lead an operator to the mask. Reach (Pro board capture, or the remote) does not lower a P1.
  - **ADR-633 Amd 2 Context.** "Only the jig did not" (`:19-20`) is false: `board-tile-actions.ts` has no `sceneObjectCopyClosure` or `remapSceneObjectCopyDependencies` (`git grep` lists every caller, and this file is not one). D1's "the same way Duplicate and Array do" refers to the Array dialog (`array-actions.ts:181`), which does copy the mask.
  - **Corrections.**
    - "22 % of the photo" is 22 % of the *masked engraving* (237 / 1,070); of the photo's 1,600 cells it is 15 %.
    - The remote command is `place_on_board`, not `place_board`.
    - The ADR-125 D2 twin anchor is weak: it matches only the copies' id minting, not their dependencies. The finding rests on ADR-633 Amd 2 D1/Context and H5-P1-1.
  - **Novelty.** `git grep` of `docs/audits` (v3 G7 mentions `place_on_board` only for the outline and array caps) and H5's twin list (which does not include Array on board) find nothing. `gh pr list --state open` shows only #1478, which does not touch these files.

### J9-P3-1 — After an Abort or alarm part-way through a per-bit file, the machine panel says the file "has run" and to change to the next bit

- **Where:**
  - `src/ui/state/laser-terminal-stream-release.ts:31-48` (#1477): at the first Idle after a `cancelled` per-bit stream, `stoppedBitFileRunEndsAtIdle` applies `bitFileRunEndPatch`.
  - That patch sets `bitFileSequence` to the stopped file whenever later bits remain (`bit-file-sequence.ts:39-49`).
  - `bitFileSequenceNotice` (`bit-file-sequence.ts:67-75`) has one wording: "Bit N of M (…) has run. Change to bit N+1, then Zero Z …". `BitFileSequenceNotice` shows it in Job Controls (`JobControls.tsx:129`).
- **Anchor:**
  - **Contract:** ADR-392 Amendment 5, Consequences (`ADR-392-amendment-5-tile-bit-files-and-stopped-bit-files-end-their-bit.md:47-48`): after an Abort or alarm part-way through a bit file, the X/Y origin stays refused "so re-running the same file keeps its X/Y zero". The notice tells the operator to move on instead.
  - **Twin:** the same notice after a completed file is true.
  - **L8:** before #1477 a stopped bit file left no notice at all (J1-P3-1); the fix added the hold, and with it this wording.
- **Scenario:**
  1. The operator runs bit 1 of 2 through Run G-code file and presses Abort mid-cut (or a limit alarm stops it, and they unlock).
  2. At Idle the panel reads "Bit 1 of 2 (3.175 mm (1/8") end mill) has run. Change to bit 2, then Zero Z …".
  3. Following it skips bit 1's unfinished cuts. The hold and the Work Z void themselves are right.
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\gcode-inspector\zz-j9-abort-notice.simulator.test.ts` (copy at `…\scratchpad\j9\j9-abort-notice.simulator.test.ts.txt`), 1 passed. It is the setup of `external-run-bit-files.simulator.test.ts` (GRBL simulator, real external Start, `stopJob`, `unlockAlarm`): `{"streamer":"cancelled","sequence":{"order":1,"count":2,…},"notice":"Bit 1 of 2 (3.175 mm (1/8\") end mill) has run. Change to bit 2, then Zero Z on the stock top or probe it before its file: Work Z from the last bit no longer applies. The X/Y origin stays where it is until the last bit has run.","xy":true,"workZ":false}`.
- **Severity:** P3, wording drift introduced by a P3 fix. Nothing burns wrong: the next file's Frame still needs a new Z zero, and the operator pressed Abort or saw the alarm. A refuter may weigh P2 as "a misleading instruction on an ordinary action".
- **Novelty:** new. J1-P3-1 asked for the end patch; it did not cover the notice text. No open PRs.
- **Fix direction:** record on the sequence that the file stopped (the patch already knows the streamer was `cancelled`), and word that case as "Bit 1 of 2 (…) stopped before it finished. Run its file again to finish it, or change to bit 2 …".
- **Refuter:** **CONFIRMED (own REPRO plus READ). Severity P3 → P2.**
  - **What would make it false.**
    - The notice is hidden while a `cancelled` streamer remains.
    - Another message says that the file stopped and should be re-run.
    - The stop path sets a different wording.
    - ADR-392 accepts "has run" for a stopped file.
  - **None of these holds.**
    - `BitFileSequenceNotice` hides only while `isActiveJob`, which covers `streaming`, `paused`, `tool-change`, `done` and `errored`, not `cancelled` (`laser-store-helpers.ts:70-80`, `BitFileSequenceNotice.tsx:12-14`).
    - `bitFileSequenceNotice` has one wording (`bit-file-sequence.ts:67-75`). `bitFileSequence` is read only by the notice, the X/Y block and the session reset (`git grep`).
    - Amd 5 Consequences say the hold is kept "so re-running the same file keeps its X/Y zero" (`:47-48`). The notice never mentions re-running.
  - **REPRO** (`src/ui/gcode-inspector/zz-j9r-abort-notice.simulator.test.tsx`, deleted). It was written fresh: a 3-bit set with a V-bit file 1, the GRBL simulator, the real external Frame and Start, `stopJob` and `unlockAlarm`. The real `<BitFileSequenceNotice />` was mounted with `createRoot`.
    - **Result:** streamer `cancelled`, Work Z not current.
    - **Rendered text:** "Bit 1 of 3 (60deg V-bit) has run. Change to bit 2, then Zero Z on the stock top or probe it before its file: … End bit sequence".
    - The follow-on Frame (for bit 2, or bit 1 again) was refused in the simulator because the post-reset status had no position (`mPos: null`). That is the ALARM:3 position loss, and it is not evidence either way.
  - **The coordinator's question: does obeying the panel cut the rest of file 1 with the wrong bit? No.**
    - External programs keep no recovery record (ADR-630; `external-run.ts:243-245`), so there is no "continue file 1" to run with bit 2 in.
    - The notice sends the operator to bit 2's *own* file. Obeying it skips bit 1's remaining paths. It does not cut them with the wrong bit.
    - A wrong-bit cut needs the operator to re-run file 1 after swapping, against the notice's own words. Nothing would stop that: external Start's CNC attestation is the generic workholding prompt (`cnc-setup-acknowledgement.ts:28-41`), and no Start path compares the file's bit with `bitFileSequence`. But the panel does not lead there.
    - So this is not a P1 wrong cut.
  - **Why P2, not P3.**
    - It is a wrong operational instruction ("Change to bit 2"), not cosmetic drift, after an ordinary event (Abort or an alarm mid-file).
    - It sits on what #1453 made the default multi-bit path, the one-file-per-bit package.
    - After an alarm the operator may not know how far the file got, and the panel says it "has run".
    - Obeying leaves bit 1's paths uncut while bit 2's file, often the profile, may cut the part free, so the part cannot be finished.
    - That is METHOD §3 P2: "wrong behaviour an ordinary user will hit, with a misleading result", and a broken contract (Amd 5 Consequences) with a clear failure scenario.
    - It is not P1: the operator has seen the Abort or the alarm, and no cut is made at the wrong position, depth or scale.
  - **Novelty.** J1-P3-1 asked for the end patch; its scenario ("stops it during the final park and moves on to bit 2") is the case where "has run" is close to true. No audit names the notice text (`git grep "has run. Change to bit"` finds only this report), and no open PR touches `bit-file-sequence.ts`.

## KNOWN re-observed

- **J7-P2-2 (P2).** The park-lift Z-top check is still absent from Run G-code file. #1453 makes per-bit package files the default, so that path is now the default one for a multi-bit job.
- **H5-P3-1 (P3).** `objectCanEmitOnLayer` still reads raw `layer.mode` (`layer-mode-preflight.ts:46-60`); no commit since `a59f74ff9` touches it. Not fixed by #1471, which did not claim it.
- **H5-P3-3 (P3).** The stamp operation still takes `linesPerMm: image.linesPerMm` (`stamp-preparation-actions.ts:53,74`). Not claimed by #1471.
- **ADR-359 Amd 3 / ADR-250 Amd 4 limit (documented).** Near copies (over 0.001 mm apart, or the same ring with different vertices) still cancel in the On path wall model. The ADR lists it; not raised.

## Refuted

Candidates the auditor checked and dropped:

- **#1464's clipboard now pastes the scan offset and clears an unset power mode.** Intended and stated in ADR-670 Amd 1 D2; before, a paste left the two operations burning differently while `layerSettingsEqual` called them different.
- **#1464's Preview key omits dot width correction and scan offsets.** They act in the sweep emitter, not on the S grid Preview draws (`compile-job-raster.ts:209`); Amd 1 D3 says so.
- **#1459's allowance line prints a clamped allowance.** `profileFinishAllowanceMm` caps it at the cutter radius, and ADR-433 Amd 5 D1 says the effective allowance is named.
- **#1453's bit header pushes the provenance header off line 1.** No reader parses the metadata at a fixed line (`git grep` for `profile-name`, `emitter:`, `; KerfDesk`, `assumes:` outside the writer).
- **#1477's 64-line read could miss a tile header.** The longest leading block is 12 comment lines, and the metadata header has no blank line (`gcode-metadata.ts:191-212`).
- **#1475's eligibility and wording are asked in two calls, so a confirmation landing between them shows `not-covered`.** Transient; the next check corrects it. Not raised.
- **#1476 leaves library, production, recipe-sheet, retained-array and nest readers silent about a settled kept photo.** ADR-673 Amd 1 Limits list them, and each keeps its 1.0.27 job (Output off), so nothing burns differently.
- **#1471's mask closure moves a mask shared with an unselected second photo.** The same as moving a shared mask by hand; the off-image advisory names the second photo when it is left without overlap. Not raised.

## Verified clean

- **Every added line survives** (table above); the only later rewrites are #1471's intended ones in the Photo engraving files and #1472's in the setup-package dialog.
- **#1459:** the kept-wall model has one caller and two readers, and both follow the copy rule. The lead falls back to a plunge beside two, three and reversed copies, and the 1/4" profile reach is named for two copies as for one.
- **#1464:** both tone seeds and the notice use the burn power; the clipboard's key list equals the operation type's keys; the Preview key carries the effective curve's points (a renamed curve reuses the canvas).
- **#1471:** both jig entry points; both bake commands; every preset applier; the Grayscale picker; the camera trace luma.
- **#1476:** every LightBurn route reaches the one importer; every project reader settles legacy kept photos inside `deserializeProject`; Open, template, autosave and sheet switch show the notices.
- **#1475:** all three update lanes; download re-validates eligibility; "ended on" only for a past date.
- **#1453 and #1477:** the package defaults to one file per bit with a header on line 1; real tile files are read as bit files; a stopped bit file ends its bit once (idempotent patch).

## Not verified

- **Hardware:** none was used. The GRBL behaviour comes from the repo's simulator.
- **Browser:** no click-through. Array on board was driven through the store action its button calls (`tileSelectionIntoBoard`); the remote `place_on_board` array was read, not run (the refuter ran it through `adapter.execute`: same result as the desktop). The canvas view of the tiles rests on the H5 refuter's reading of `draw-raster.ts`, re-read by this refuter (`imageClip` only).
- **A path text's guide under Array on board** (copies keep the original guide id). Not traced.
- **An older `.lbrn` (not `.lbrn2`) file with Power Scale.** None was available; ADR-388 Amd 2 says the same.
- **SVG export of a cropped image's clip** (ADR-480 Amd 1 D3): read in the file list only.
- **#1459, #1464, #1471 (except the jig), #1475, #1476 (except Power Scale) and #1453 pre-fix runs:** judged by reasoning from the original audits' repros, because the parent code lacks the new symbols or spans several files.

## Repro files

No file was created in the repo. All temporary files were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and deleted one by one at the end (the `node_modules` junction was not touched). Copies of the two finding repros are kept in `…\scratchpad\j9\`.

| File (under `j7-main\`) | Purpose |
|---|---|
| `src\ui\state\zz-j9-board-array-mask.test.ts` | J9-P1-1: masked photo through Array on board (1 × 3 in three positions, 2 × 2 centred, 1 × 1) |
| `src\ui\gcode-inspector\zz-j9-abort-notice.simulator.test.ts` | J9-P3-1: the panel notice after Abort of bit 1 of 2 |
| `src\core\cnc\zz-j9-prefix-profile-lead-kept-walls.ts` + `zz-j9-prefix-kept-walls.test.ts` | #1459 wall-model test against the parent module |
| `src\io\gcode\zz-j9-prefix-onpath.test.ts` | #1459 emitted-program test with the parent wall module mocked in |
| `src\ui\state\zz-j9-prefix-clipboard.ts` + `zz-j9-prefix-clipboard.test.ts` | #1464 clipboard test against the parent |
| `src\ui\workspace\zz-j9-prefix-draw-raster-preview.ts` + `zz-j9-prefix-preview.test.ts` | #1464 Preview key test against the parent |
| `src\ui\state\zz-j9-prefix-jig-artwork-actions.ts` + `zz-j9-prefix-jig-masks.test.ts` | #1471 jig mask test against the parent actions |
| `src\io\lightburn\zz-j9-prefix-lbrn-geometry.ts` + `zz-j9-prefix-power-scale.test.ts` | #1476 Power Scale test against the parent importer |
| `src\core\external-program\zz-j9-prefix-kerfdesk-bit-file.ts` + `src\ui\app\zz-j9-prefix-tiled-bit-files.test.ts` | #1477 tiled-save test against the parent reader |

```json
[
  {"id":"J9-P1-1","severity":"P1","area":"fix-output","file":"src/ui/state/board-tile-actions.ts","line":51,"anchor":"Twin: ADR-633 Amd 2 D1-D2 (jig Centre + copy: the mask goes where its photo goes; each copy uses its own mask) and its Context claim 'Only the jig did not' (ADR-633-amendment-2:19-20); ADR-125 D2 (DECISIONS.md:6838-6841) copies like Duplicate; parent H5-P1-1 (P1)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Array on board (tileSelectionIntoBoard, desktop and remote place_on_board array) moves the original photo into slot 1 and adds copies via translated() with no sceneObjectCopyClosure or remapSceneObjectCopyDependencies; only one design may be selected, so the mask stays put and every copy keeps its imageMaskId. Photo centred on the board, 2x2 gap 2: tiles burn 239/236/239/236 of 1070 cells, canvas shows four whole photos, runPreflight issues [] and stackedCopyWarnings []; 1x3 near the photo burns 434/186/0 and the off-image advisory names one image. Refuter own REPRO (50x30 photo, 26 mm circle, real import/draw/applyImageMask/selectObjects): 2x2 desktop and remote each tile 8446/52848 (16%) with no mask message on the Start path; fill 3x2 burns 0/45/0 per column and the advisory names only the 4 empty tiles; P1 kept"},
  {"id":"J9-P3-1","severity":"P2","area":"fix-output","file":"src/ui/state/bit-file-sequence.ts","line":71,"anchor":"Contract: ADR-392 Amd 5 Consequences (after an Abort or alarm part-way through a bit file, the hold is kept 'so re-running the same file keeps its X/Y zero', :47-48); Twin: the notice after a completed file; L8 of #1477 (J1-P3-1 fix)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"After Abort (or an alarm and unlock) part-way through per-bit file 1 of 2, #1477's stoppedBitFileRunEndsAtIdle sets bitFileSequence, and the Job Controls notice reads 'Bit 1 of 2 (...) has run. Change to bit 2, then Zero Z ...', although the file stopped early and the ADR expects it to be re-run. Refuter: rendered BitFileSequenceNotice shows it with the streamer cancelled (not hidden by isActiveJob). Raised P3 -> P2 as a wrong operational instruction on an ordinary event on the default per-bit path; not P1 because obeying it skips bit 1's remaining paths (external runs have no resume, ADR-630) rather than cutting them with the wrong bit"}
]
```
