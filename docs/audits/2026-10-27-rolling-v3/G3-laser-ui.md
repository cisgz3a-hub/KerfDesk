# Rolling audit v3 — Laser UI

- **When:** 2026-10-27 08:55–09:40 +0800   **Tree:** origin/main @ `9a2bf6b13` (worktree HEAD `c2aca5c68`, later `51e7e2cd8`; `git diff 9a2bf6b13 HEAD -- src` is empty)
- **Scope:** `src/ui/laser/**` and `src/ui/layers/**`.
  - Changes since rolling v2: 57 first-parent merges from `git log --first-parent --since=2026-10-21T00:00 origin/main -- src/ui/laser src/ui/layers`, #1287 to #1452, read diff by diff. The value-shaping ones got the most time: #1367 (Cut Settings apply, Job Review one-step Save), #1322/#1325/#1334 (edit glow), #1287 (speed entry, spin boxes, slider), #1386 (Falcon laser dot), #1400 (FluidNC power-scale warning), #1440 (Job Review contour entry), #1351, #1390.
  - Hotspots merged just before the window and read as well: #1301 (ADR-638), #1302 (ADR-348 Amd 1), #1293 (ADR-634), #1299.
  - Branch-side merges with conflict hunks in scope, read with `git show --cc`: `c7c06c9d5`, `81505e32a`, `b230b1cde`, `8f99c231a`, `52a2dc5fe`, `9ebb03831`.
  - Followed into the store actions these screens call: `layer-param-actions.ts`, `laser-recipe-seeding.ts`, `object-properties-actions.ts`, `layer-settings-clipboard.ts`, `laser-dot-light.ts`, `laser-fire-power.ts`, `effective-output.ts`, `object-operation-settings.ts`.
  - Governing ADRs: ADR-317, ADR-496 Amd 1, ADR-638 Amd 1–2, ADR-646 and Amd 1, ADR-348 Amd 1, ADR-629, ADR-664, ADR-670 item 6, ADR-567 Amd 1–2.
- **Lenses run:** L8 (main), L3, L4, L7.
  - L1, L2, L5 and L6 were not assigned.
  - Repros were temporary Vitest files, run one at a time with `node ../../../node_modules/vitest/vitest.mjs run <file>` and deleted afterwards:
    - `src/ui/layers/zz-g3-siblings.test.tsx` drove the real `SelectedOperationInspector`, its Cut Settings dialog and the feed-ceiling note against the real store. Its oracle was `emittedBurn` (`__fixtures__/operation-gcode.ts`, which runs `emitGcode`).
    - `src/ui/state/zz-g3-paste-curve.test.ts` used the real store's copy and paste, then `compileRasterGroupsForLayer`.
    - `src/ui/layers/zz-g3-entry.test.ts` checked `dimensionEntry` and `validateEnglishDecimalInput` on 23 strings.
  - Existing tests re-run at this tree (L7), all passing: 77 tests in 10 files. See Verified clean.
- **Counts:** 2 raised → 0 refuted → P1 0 / P2 1 / P3 1 (+ 5 KNOWN still open: 06-P2-5's feed-ceiling half, 06-P3-1, 06-P3-3 and 06-P3-5 re-observed by REPRO, 06-P3-2 by READ). The refuter raised G3-P3-2 to P2 and kept its ID: a UI path does put a curve on an operation.

## Headline

The value paths changed since rolling v2 hold on every sibling tried. A value typed or applied in the inspector, in Cut Settings (operation, one artwork or several) or in a Job Review card reaches the G-code as shown. Checked against the emitted program, it reached it in every case except the KNOWN 06-P3-1.

One thing needs the ledger's attention. Rolling v2 finding 06-P2-5 is recorded as "fixed, #1367 merged", but #1367 fixed only its Job Review half. The feed-ceiling **Raise Output max feed** button that 06-P2-5 named as the same pattern still writes two undo steps (REPRO below).

The two new findings, after the refuter:
- **P2 (G3-P3-2):** Copy and Paste settings ignores the ADR-670 tone curve. The auditor rated this P3 as latent. The refuter found a UI path: **Save process recipe** on a calibrated photo, then **Apply**, writes the curve onto an operation. A paste from that operation then silently changes burn tones.
- **P3 (G3-P3-1):** The edit glow lights artwork that an operation edit will not change.

## Findings

### G3-P3-1 — The edit glow lights a sibling artwork that owns the edited field, which the edit will not change
- **Where:**
  - `src/ui/layers/SelectedOperationInspector.tsx:177-196`. `useOperationEditGlow` lights `whole`: every object that uses the operation, whether or not it owns the field.
  - The same root as the scope text at `src/ui/layers/OperationInspectorControls.tsx:50` ("Shared by N artworks. Edits apply to all of them.").
- **Anchor:** Contract + Twin.
  - **Contract:** `docs/decisions/ADR-646-editing-settings-lights-up-the-artwork.md`, Decision item 3: "**Exactly the artwork the edit changes, never widened.**" Its first sub-bullet reads "every piece the operation runs … so the operator sees everything the change reaches". The code follows that sub-bullet's letter, which is wider than the heading whenever a sibling owns the field (ADR-317 precedence).
  - **Twin:** compile resolves the sibling through its own override (`effectiveOperationForObject`, `src/core/effective-output/effective-output.ts:14-22`), so it keeps its value.
- **Scenario:**
  1. Operation `op` at 80 % runs artwork `a` and `b`. Artwork `a` owns `{ power: 30 }`, from any earlier inspector edit while it was selected.
  2. Select `b` and focus Power. The panel says "Shared by 2 artworks. Edits apply to all of them.", and both `a` and `b` glow on the canvas.
  3. Type 50. Only `b` changes: `a` still burns S300.
  - The glow, which ADR-646 introduced to show exactly what an edit changes, shows `a` as changing.
  - Display only: no S, F or coordinate is wrong.
- **Evidence:** REPRO, `zz-g3-siblings.test.tsx` "edit glow lights a sibling that owns the edited field". Output:
  ```
  scope text: Shared by 2 artworks. Edits apply to all of them.
  editedArtwork while Power focused: {"owner":"operation-editor:op","objectIds":["a","b"],"operationIds":["op"]}
  after Power 50: a S [300] b S [500]
  ```
  - **Novelty:** 06-P3-4 (rolling v2) reported the scope text, not the glow. No audit or open PR (#1455, #1456) mentions the glow and override owners.
  - **Test gap:** `SelectedOperationInspector.edit-glow.test.tsx` never seeds a sibling that owns a field.
- **Refuter:** **CONFIRMED, P3.**
  - **What would make it false:**
    - The canvas filters the edit's `objectIds` by field ownership.
    - ADR-646 clearly requires every piece.
    - No sibling can own a field in practice.
  - **Own repro** (`zz-g3r-glow.test.tsx`, real `SelectedOperationInspector`; op 80 %, `a` owns `{ power: 30 }`, `b` selected):
    ```
    G3R edited {"owner":"operation-editor:op","objectIds":["a","b"],"operationIds":["op"]}
    G3R scope text Shared by 2 artworks. Edits apply to all of them.
    G3R effective power a=30 b=50 op power 50
    ```
  - **Overlay:** `editPulseTarget` (`src/ui/workspace/artwork-pulse.ts:195-218`) lights every id in `seed.objectIds` that uses the operation, with no ownership filter. So `a` really glows.
  - **Contract:**
    - ADR-646 Decision 3's first sub-bullet ("Operation editor, no per-artwork override") contrasts with the second one ("while the selected artwork overrides"). It therefore covers the selected artwork, and its stated purpose is "everything the change reaches", which `a` is not.
    - ADR-646 Amendment 1, Decision 5 ("A control lights what it changes, not what its editor usually does") points the same way.
  - **Reach:** ordinary, not latent.
    - The Photo engraving window's Apply writes `ditherAlgorithm`, `linesPerMm`, `negativeImage`, `passThrough` and `mode` into a photo's own override (`src/ui/raster/photo-engraving-apply.ts:98-107`).
    - Traced artwork also carries one (`rasterized-trace-mutation.ts:120`).
    - So editing DPI on a sibling photo lights that calibrated photo too.
  - **Severity:** P3 stands. It is display only: S, F and the program are unchanged.
  - **Novelty:** no open PR touches these files (`gh pr list`, #1456 and #1457).
- **Fix direction:** Build the operation-scope glow from the artworks that do not own the field being edited. Alternatively, light owners differently. Fix 06-P3-4's scope text in the same change.

### G3-P3-2 (refuter: now P2, reachable) — Copy and Paste settings drops the ADR-670 tone curve, and a paste that differs only in the curve is a silent no-op
- **Where:**
  - `src/ui/state/layer-settings-clipboard.ts:9-56`: `LAYER_SETTING_KEYS` has no `photoToneCurve`.
  - `:58-113`: `layerSettingsFrom` never copies it.
  - `:124-135`: `layerSettingsEqual` ignores it.
  - The paste action is `src/ui/state/layer-actions.ts:147-156`. It is reached from **Copy** and **Paste** in the operation row's More menu (`src/ui/layers/LayerSettingsClipboardButtons.tsx`).
- **Anchor:** Contract + Twin.
  - **Contract:** `docs/decisions/ADR-670-photo-tone-calibration.md`, Decision item 6: "`photoToneCurve` is a new optional operation setting (operation, sub-operation and artwork override; captured by operation-settings copies and process recipes)".
  - **Twin:** the other operation-settings copies carry the curve:
    - `captureLayerOperationSettings` lists it in `OPTIONAL_CUT_SETTING_KEYS` (`src/core/scene/layer.ts:310`);
    - `layerOperationOutputEqual` compares it (`:217`, `:365`);
    - Make unique and Add operation copy the whole source operation (`src/ui/state/clone-artwork-operations.ts:30-36`).
- **Scenario:**
  - Operation A (Image, grayscale, 50 %) carries a Birch tone curve. Operation B is identical except that it has none. Copy A, then Paste onto B: every other setting arrives, but B burns uncorrected tones.
  - The reverse is worse. Copy an uncorrected operation and Paste it onto one that carries a curve. The paste finds "nothing to change" and pushes no undo step, while the two operations still burn different tones.
  - **Reach:** the app's own editors write a curve only into a photo's artwork override (`src/ui/raster/photo-engraving-apply.ts:98-107`). An operation-level curve therefore comes from a project file, which project load accepts and validates (`src/io/project/project-cut-extras-validator.ts:40`). This audit found no UI path that writes one, so P3 (latent). *(Refuted by the refuter: the process recipe path below writes one.)*
- **Evidence:** REPRO, `zz-g3-paste-curve.test.ts`. The fixture had two Image operations of one 64 × 8 grey ramp each, and the curve was fitted as in `compile-job-raster-tone-curve.test.ts`. Output:
  ```
  clipboard has photoToneCurve key: false
  after paste A->B: B.power 50 B.photoToneCurve absent undo 1
  compiled sum S: A 543000 B 797440
  after paste A(no curve)->B(curve): B.photoToneCurve present undo steps 0
  compiled sum S: A 797440 B 543000
  ```
  - **Novelty:** no audit mentions the clipboard and the curve. `layer-settings-clipboard.test.ts` has no curve case. The only open PRs (#1455, #1456) do not touch the clipboard.
- **Refuter:** **CONFIRMED. Raised P3 → P2. The reach claim is refuted.**
  - **What would make it false:**
    - The clipboard carries the curve some other way.
    - No path puts a curve on an operation.
    - A dropped curve has no effect on output.
  - **The defect itself.** By reading:
    - `LAYER_SETTING_KEYS` (`layer-settings-clipboard.ts:9-56`), `layerSettingsFrom` (`:58-113`) and `layerSettingsEqual` (`:124-135`) never name `photoToneCurve`.
    - `pasteLayerSettings` returns `{}` on "equal" (`layer-actions.ts:147-156`), so a no-op paste is silent and adds no undo step.
    - Sub-operation curves do travel inside `subLayers` (`layerOperationSettingsEqual`). Only the operation's own curve is lost.
  - **Reach: a UI path writes a curve onto an operation.** It runs through the Material Library's **Process recipes** (`ProcessRecipePanel`, `use-process-recipe-controls.ts:29-31`).
    1. **Photo engraving → Material tone calibration → Apply** writes the curve into the photo's override (ADR-670 item 7).
    2. **Save process recipe** with that photo selected captures `captureLayerOperationSettings(effectiveOperationForObject(…))` (`src/core/material-library/capture-process-recipe.ts:66-68`). The effective operation includes the override's curve, which `OPTIONAL_CUT_SETTING_KEYS` lists, and `parseProcessRecipes` accepts it.
    3. **Apply** the recipe and `applyProcessRecipe` builds a new operation from `...step.settings` (`apply-process-recipe.ts:50-53`). It also drops the artwork override (`cleanTarget`, `:97`). So the curve now sits on the **operation**.

    ADR-670 item 6 itself names process recipes as a capture of the curve. Make unique and Add operation then copy that operation with its curve.
  - **Own repro** (`zz-g3r-curve-reach.test.ts`; real store actions `saveSelectedProcessRecipe`, `applyProcessRecipeToSelection`, `copyLayerSettings` and `pasteLayerSettings`; library and project serialize round trips; `compileRasterGroupsForLayer` on one 64 × 8 grey ramp, grayscale, 50 %; paste target at 40 %):
    ```
    G3R photoOp.photoToneCurve absent
    G3R saved recipe step curve [ 'present' ]
    G3R library round-trip step curve present
    G3R new operation operation-target mode image photoToneCurve on OPERATION: present target override: null
    G3R project round-trip op curve present
    G3R clipboard has photoToneCurve key false
    G3R after paste: plain-op power 50 dither grayscale curve absent undo added 1
    G3R compiled sum S: source op 1086000 pasted op 1594880
    G3R reverse paste: curve op curve present undo added 0 sum S 1086000 vs source plain 1594880
    ```
  - **Severity: P2 under §3.**
    - **Reachable today.** Calibrate, Apply in Photo engraving, save and apply a process recipe, then Copy and Paste settings. All of these are shipped UI. The library file also carries the curve to other computers.
    - **Misleading result.**
      - After the paste, the target burns 47 % more total S than the source.
      - Every number the operator compares is identical: power, speed, DPI and dither. No operation surface shows the curve: nothing under `src/ui/layers` or `src/ui/laser` mentions it.
      - The reverse paste says nothing and leaves the curve in place.
    - **Broken contract:** ADR-670 item 6, "captured by operation-settings copies".
    - **Why not P1:**
      - Every S is what the target operation's stored settings command.
      - The app's own views of that photo agree with the burn. The canvas processed bitmap applies the effective curve (`src/ui/raster/processed-bitmap.ts:54,68`), and the Photo engraving window shows the effective curve (`photo-engraving-settings.ts:45`).
      - The fault is a settings copy that drops a field, not output that diverges from what the app shows.
      - This matches 06-P2-2, a settings edit that does not reach an artwork, which meta v1 M2 kept at P2. It also matches G1-P3-2's refuter ("every S is as commanded and shown").
      - Coordinator: borderline. Reconsider P1 only if a wrong burn tone with no operation-level indicator counts as "silent".
  - **Novelty:** no other audit mentions the clipboard and the curve. No open PR touches `layer-settings-clipboard.ts` (`gh pr list --state open`: #1456, #1457).
- **Fix direction:** Add `photoToneCurve` to the clipboard keys, to `layerSettingsFrom` (explicitly undefined when absent, like the other optional cut settings) and to `layerSettingsEqual` (by value, `photoToneCurvesEqual`). A test that compares the clipboard key list with `captureLayerOperationSettings` would stop the next new field slipping past.

### KNOWN, re-observed

- **06-P2-5, feed-ceiling half: still two undo steps; the ledger row says "fixed, #1367 merged".**
  - **Where:** `src/ui/layers/feed-ceiling.tsx:93-96` (`updateDeviceProfile({ maxFeed })`, then `props.onRaise`). It is mounted at `LayerRowFields.tsx:120-123`.
  - **History:** rolling v2 named this exact line ("Same pattern: `src/ui/layers/feed-ceiling.tsx:94-95`") and asked to "do the same for the feed-ceiling Raise". #1367 (ADR-638 Amendment 2) changed only Job Review's Save, and `feed-ceiling.tsx` is unchanged since.
  - **REPRO** (`zz-g3-siblings.test.tsx`; artwork `b`, Output max feed 6000; Speed typed 8000, then Raise clicked):
    ```
    after typing 8000: speed 6000 maxFeed 6000 undo 1
    raise button Raise Output max feed to 8,000 mm/min
    after Raise: speed 8000 maxFeed 8000 undo steps added by Raise 2
    after ONE undo: speed 6000 maxFeed 8000 emitted b [6000]
    note text after undo: (none)
    speed box after undo: 6000
    ```
  - One Undo leaves the profile raised and the speed reverted. Unlike the Job Review half, nothing then misreports: the box reads 6000 and the program runs F6000. On its own this half is therefore P3.
  - **Ledger action:** reopen 06-P2-5 as partly fixed, or record the feed-ceiling half as an open P3. The store already has a pattern for this: `inOneUndoStep` in `src/ui/remote-control/design-operations.ts:58,196`.
  - **Refuter:** **CONFIRMED, still open, P3. The ledger record is wrong.**
    - **Code:**
      - `feed-ceiling.tsx` last changed in #868 (`git log origin/main -- src/ui/layers/feed-ceiling.tsx`).
      - #1367's merge (`2f18639b1`) has 27 files, and `feed-ceiling.tsx` and `LayerRowFields.tsx` are not among them.
      - `updateDeviceProfile` (`store-actions.ts:88-99`) and `setLayerParam` (`:65-75`) each call `pushUndo`, and `pushUndo` has no grouping (`undo-stack.ts:61-68`).
      - ADR-638 Amendment 2 and the `layer-param-actions.ts:1-4` header scope the fix to Job Review's Save only.
    - **Own repro** (`zz-g3r-known.test.tsx`, real inspector; stored speed 8000 above Output max feed 6000, Raise clicked):
      ```
      G3R raise button Raise Output max feed to 8,000 mm/min
      G3R after Raise: speed 8000 maxFeed 8000 undo steps added 2
      G3R after ONE undo: speed 8000 maxFeed 8000 emitted F [8000]
      ```
      - Here the first Undo only removes the redundant speed step (06-P3-8: `setLayerParam` pushes even when nothing changes), so Ctrl+Z appears to do nothing. The second Undo lowers the ceiling.
      - The auditor's typed-8000 path shows the other order: speed reverted, ceiling still raised.
    - **Ledger:** rolling-v2 `LEDGER.md:97` says "fixed, #1367 merged" for all of 06-P2-5. That is wrong.
      - The P2 Job Review half is fixed. The refuter verified `setLayerParamWithArtworkOverrides`, one `pushUndo`, at `layer-param-actions.ts:38-51`, used by `JobReviewOperations.tsx:149`.
      - The feed-ceiling half named in the finding's Where and Fix direction is still open.
      - The row should read "partly fixed (#1367: Job Review); feed-ceiling Raise half open, P3".
- **06-P3-1: Cut Settings rewrites a stored speed above Output max feed to the ceiling on an unrelated Apply.**
  - **Where:** the operation path is unchanged by #1367. The box shows `min(speed, maxFeed)` (`CutSettingsCommonFields.tsx:24-25`), `numberField` (`cut-settings-number-field.ts:16-17`) treats the shown value as an edit because it differs from the stored one, and `CutSettingsDialog.tsx:70` sends the whole form.
  - **REPRO** (`zz-g3-siblings.test.tsx`; stored 8000, ceiling 6000, Passes → 2 in More cut settings): `stored speed after Passes-only Apply 6000 passes 2`.
  - The artwork paths are not affected (`onlyChangedFields`).
  - **Refuter:** **CONFIRMED, still open, P3.**
    - **Own repro** (`zz-g3r-known.test.tsx`; real inspector, then More cut settings, then Passes 2, then Apply; stored 8000, ceiling 6000): `G3R 06-P3-1 stored speed after Passes-only Apply 6000 passes 2`.
    - `numberField` (`cut-settings-number-field.ts`) still treats the shown capped value as an edit on the operation path. The operation path does not pass `onlyChangedFields` (`SelectedLaserOperationFields.tsx:88-97`).
- **Still open by READ, unchanged since rolling v2:**
  - **06-P3-2:** Job Review card values come from the scene, not the compiled job (`job-review-operation-edit.ts:30-43`).
    - **Refuter:** **CONFIRMED by reading, P3.**
      - `reviewRowSettings` (`job-review-operation-edit.ts:30-43`) keeps the base value for any field the artworks disagree on and never reads `powerScale`.
      - The card has no Mixed or capped marker (`grep` for mixed, powerScale and capped in `JobReviewLaserOperationCard.tsx` finds only the post-save feed toast, `:274`).
      - The file's last changes predate the window (`e8b713476`, `261f3c534`).
  - **06-P3-3:** a negative or zero speed is silently stored as 1 mm/min (`LayerSpeedInput.tsx:90`).
    - **Refuter:** **CONFIRMED, P3.**
      - **Own repro** (`zz-g3r-known.test.tsx`, inspector Speed `-1500`, then blur): `G3R 06-P3-3 stored speed 1 box 1 alerts [] invalid false`.
      - `dimensionEntryError` only refuses unparsable text (`dimension-entry.ts:15-22`). `-1500` parses, and the commit clamps it to 1 (`LayerSpeedInput.tsx:88-92`).
  - **06-P3-5:** in/min shows one decimal, and 1 mm/min reads 0 (`LayerSpeedInput.tsx:46`). #1287 rewrote this file and kept both 06-P3-3 and 06-P3-5.
    - **Refuter:** **CONFIRMED, P3.**
      - **Own repro** (Inches, stored 1 mm/min): `G3R 06-P3-5 stored 1 mm/min shows "0"`.
      - `toDisplay` is `Number((mmPerMin / MM_PER_INCH).toFixed(1))` (`LayerSpeedInput.tsx:46`).

## Refuted

The refuter refuted no raised finding. Only G3-P3-2's reach sub-claim ("no UI path") fell, which raised that finding to P2.

These candidates were checked and dropped by the auditor before raising.
- **A Cut Settings density typed and then submitted with Enter is lost because the hidden field is stale.** `DraftNumberInput` commits every keystroke (`debounceMs = 0`) and flushes on Enter (`src/ui/kit/DraftNumberInput.tsx:25,62-65`). The hidden `hatchSpacingMm` and `linesPerMm` fields are current before submit.
- **A speed typed the vendor way ("60mm/s") is read as 60 mm/min.** REPRO (`zz-g3-entry.test.ts`): `60mm/s`, `60 mm/s`, `60mm/sec`, `2in/s`, `60/s` and `1000mm/m` are each refused, for example "\"s\" isn't a unit or function this box knows".
  - `3600mm/min` gives 3600, `1.5in` gives 38.1 mm/min, `10cm` gives 100, and an inch box's `1e3` gives 25400.
  - Commas and `%` are refused, so no feed string tried is silently misread.
- **One-artwork Cut Settings (now `onlyChangedFields`) drops the minimum-power reconciliation when Power is lowered.** The dialog's own `minPower` is filtered out as unedited. The store's `reconcileArtworkBounds` lowers the artwork's minimum anyway (`object-properties-actions.ts:215-230`).
- **An artwork-override key Cut Settings writes is ignored by compile.**
  - Every key the dialog can submit passes `sanitizeOperationOverridePatch` (`object-properties-actions.ts:267-313`) and is in `SETTING_KEYS` (`src/core/scene/object-operation-settings.ts:4-51`).
  - `effectiveOperationForObject` merges them.
- **After a Process-switch preview remount, the stale `mode` entry makes later edits misclassified.** `editedBesidesProcess` counts only connected controls other than `mode` (`CutSettingsDialog.tsx:189-191`), and `changedCutSettingsPatch` requires `form.contains(control)`.
- **The laser dot fires harder when the controller's `$30` exceeds the profile's.** `currentFirePowerS` takes `Math.min(profile, observed)` (`src/ui/state/laser-fire-power.ts:20-23`), so a mismatch only dims the dot. `laserDotIssue` refuses a power at or below 0 or above 5 % (`src/core/devices/positioning-light.ts:127-141`).
- **The Live Motion bar says "Momentary Fire" if the profile loses its dot while lit.** The bar still offers LASER OFF. A stray momentary release then sends `M5`, which is the safe direction (`MomentaryFireControl.tsx:76-82`).
- **Run again replays bytes under a changed `$30`.** Run again re-prepares through `runFreshFramedJobFlow` (`start-job-flow.ts:216-232`), and authorization checks `laserPowerScaleStillCurrent` (`start-job-authorization.ts:57`).
- **Ctrl+Enter starts a job before a debounced inline edit lands.** The Start shortcut ignores editable targets and open modals (`src/ui/laser/use-job-shortcuts.ts:47-50`), so focus must leave the field, and its blur commits first.

## Verified clean

- **#1367 Cut Settings apply (06-P2-2, -3, -4):**
  - **One or many artworks:** Apply sends only edited controls (`SelectedLaserOperationFields.tsx:94`, `cut-settings-field-edits.ts:26-37`). Control names map to patch keys: the `data-setting` and `lineIntervalMm`/`imageDpi` → `linesPerMm` mapping (`:16-19`) was checked against every control name in the dialog.
  - **Process switch:** reseeds through the same `sceneWithModeSwitchRecipe` as the inspector. The preview appears only on the operation path (`LayerRowCutSettings.tsx:25-29`), and edits made before a switch are kept (ADR-496 Amd 1 items 1–3).
  - **Stored values:** they are admitted. Boxes use `step="any"` with `boundsAdmitting`, `numberField` keeps an untouched stored value, and fill and image density ride exact hidden fields.
  - **Tests re-run:** `CutSettingsDialog.one-artwork`, `.process-reseed` and `.stored-values` pass.
- **#1367 Job Review Save (06-P2-5, Job Review half):** `setLayerParamWithArtworkOverrides` writes the operation and its owners in one `pushUndo` (`src/ui/state/layer-param-actions.ts:38-51`). Owners gain only fields they already held (`job-review-operation-edit.ts:53-78`). `JobReviewOperations.save-undo` and `.editing` pass.
- **Inline inspector entry (#1287):**
  - The Speed box parses through `dimensionEntry`, so a typed unit wins (ADR-629 item 3). The inch commit round trip is exact (`fromDisplay` rounds to µm/min), and the spin arrows only set text that the draft then validates.
  - Power, Passes, hatch and runway fields clamp as before.
  - A selection change remounts the fields (`key={selectionKey}`) and drops pending timers. An external store change cancels a stale timer (`use-debounced-commit.ts:104-126`).
- **Hover readout (ADR-348 Amd 1) against compile:**
  - Power is `effectiveObjectPowerPercent` on the effective run, as compile computes it (`vector-group-fields.ts:21`, `compile-job-raster.ts:161`).
  - The speed cap is `Math.min(speed, maxFeed)`, as in `vector-group-fields.ts:16` and `compile-job-raster.ts:198`.
  - The minimum-power range shows only when `imageDitherAlgorithm` is grayscale, as in `compile-job-raster.ts:316`.
  - Runs are filtered as compile filters them (`artwork-output-runs.ts:55-60`).
  - `hover-output-settings.test.ts` passes.
- **Falcon laser dot UI (ADR-664):**
  - The editor's power box feeds `laserDotIssue`. The transaction refuses an invalid light before taking the controller (`devicePositioningLightIssue` in `positioning-light-actions.ts:243-257`), then checks the dot's own refusals (`assertLaserDotAllowed`, `positioning-light-on.ts:34-42`).
  - LED on/off and Artwork centre are exempt only from the dot's own latch (`withoutLaserDotLatch`).
  - The Live Motion bar names the dot and keeps LASER OFF.
  - `PositioningLightEditor.test.tsx` passes.
- **FluidNC and small-`$30` warnings (#1400, #1351):** `laserPowerScaleWarnings` adds `fluidncPowerStepWarning` beside the source warning. The `S max $30` fact now shows a reported 0 (`reportedMaxPowerS`). The emitted S words are G1's (verified clean there).
- **Edit glow (#1322, #1325, #1334):** display only. `SelectedOperationInspector.edit-glow.test.tsx` passes. The blur-commit ordering (`use-settings-edit-glow.ts:55-74`) lets a field that commits on blur land before the edit ends. The one gap is G3-P3-1.
- **Merges without CI (#1442, #1444), their in-scope tests:** `job-review-cnc-reach.test.ts` (2), `job-review-model.test.ts` and `DitherSwatchPicker.test.tsx` pass.
- **Conflict resolutions** (read with `git show --cc`):
  - `c7c06c9d5` keeps main's `manualRestartNotes(…)` and the branch's `prepared` argument in both `ManualLaserRestartDialog.tsx` and `start-job-flow.ts`.
  - `81505e32a` keeps ADR-642's canvas card and ADR-611 Amd 2's `controllerStoppedResponding` prop and status text.
  - The other four in-scope hunks (`b230b1cde`, `8f99c231a`, `52a2dc5fe`, `9ebb03831`) were spot-read. Each keeps both sides.
- **Tests that read the program (L7):** the #1367 tests use the emitted program as their oracle (`__fixtures__/operation-gcode.ts`). This closes most of 06-P3-9 for the paths #1367 touched.
- **Refuter spot-checks (all hold):**
  - **Hover readout vs compile.**
    - **Power:** `runLine` uses `effectiveObjectPowerPercent(run.effective, object)`. That is the same function vector compile calls (`vector-group-fields.ts:21`) and raster compile calls (`compile-job-raster.ts:161`).
    - **Speed:** `capped ? maxFeed : speed` equals `Math.min(layer.speed, device.maxFeed)` (`vector-group-fields.ts:16`, `compile-job-raster.ts:198`).
    - **Minimum power:** it shows only for `runUsesMinPower`, which is Image with `imageDitherAlgorithm` grayscale, Pass-through included (`image-processing.ts:30-31`).
      - Only `ditherGrayscale` and the grayscale independent row read `sMin` (`dither.ts:90,122,205-210`).
      - Threshold and ordered dithers return `sMax` or 0, and error diffusion and blue noise never take `sMin`.
  - **#1367 changed-only Apply.** Every `name` and `data-setting` in the Cut Settings components equals a key that `cut-settings-draft.ts` builds. The two exceptions are `lineIntervalMm` and `imageDpi`, which `cutSettingField` maps to `linesPerMm`, and the display-only `autoOverscanShown`. So no edited control is filtered out.
  - **Job Review half of 06-P2-5:** one `pushUndo` (`layer-param-actions.ts:38-51`).
  - **Two auditor refutations re-read and upheld:**
    - The Start shortcut returns on editable targets and open modals (`use-job-shortcuts.ts:48-50`).
    - `currentFirePowerS` takes `Math.min(profileMaxS, observedMax)` (`laser-fire-power.ts:20-23`).

## Not verified

- **Layout of the safety toast (ADR-634) and the recovery card over the canvas (ADR-642).** jsdom cannot measure overlap. `e2e/safety-notice-toast.spec.ts` was not run, and whether CI runs it is G8's question.
- **Material Test card (ADR-497 Amd 1) and Run G-code file readiness (ADR-630 Amd 4–8).** Their UI lives in `src/ui/calibration` and `src/ui/gcode-inspector`, outside this area's paths (G6 and G4). Only `laser-mode-start-acknowledgement.ts`'s prompt parameter was read.
- **Board capture and outline-from-photo (#1362, about 3,000 lines), the device-setup wizard (#1399), console and super console (#1425, #1427, #1446), and probe controls (#1378, #1450).** Not read beyond their diffstat. They are machine-setup and CNC-probing surfaces, not laser value paths.
- **CNC fields under `src/ui/layers`** (#1416, #1418, #1420, #1423, #1451). Only `CncLayerPrimitives`' inch parsing was read; it is correct. G5 owns CNC values.
- **Native validity in a real browser.** jsdom `ValidityState` was relied on, as in rolling v2.
- **No hardware.** The Falcon dot was not lit, and nothing was burned.

```json
[
  {"id":"G3-P3-1","severity":"P3","area":"laser-ui","file":"src/ui/layers/SelectedOperationInspector.tsx","line":177,"anchor":"Contract: ADR-646 Decision item 3 'Exactly the artwork the edit changes, never widened'; Twin: effectiveOperationForObject keeps an owner's own field (effective-output.ts:14-22)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (zz-g3r-glow): editedArtwork objectIds [a,b] while a owns power 30; after Power 50, a=30 b=50; editPulseTarget (artwork-pulse.ts:195-218) has no ownership filter; reachable (Photo engraving Apply and traces create owners); P3 kept, display only","known":false,"summary":"With sibling artwork a owning power 30, focusing Power on artwork b lights both a and b (editedArtwork objectIds [a,b]); typing 50 changes only b (a S300, b S500), so the edit glow shows a piece the edit does not reach (same root as 06-P3-4's scope text)"},
  {"id":"G3-P3-2","severity":"P2","area":"laser-ui","file":"src/ui/state/layer-settings-clipboard.ts","line":9,"anchor":"Contract: ADR-670 Decision item 6 'captured by operation-settings copies'; Twin: captureLayerOperationSettings / OPTIONAL_CUT_SETTING_KEYS and layerOperationOutputEqual carry photoToneCurve","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Reach claim refuted: Save process recipe on a calibrated photo captures the effective curve (capture-process-recipe.ts:66-68) and Apply writes it onto a new operation (apply-process-recipe.ts:50-53); own repro (zz-g3r-curve-reach) shows the curve on the operation, surviving library and project round trips; Paste drops it (sum S 1086000 source vs 1594880 target) and the reverse paste is a silent no-op; raised P3 to P2 (broken ADR-670 item 6, misleading result, no operation surface shows the curve); not P1 (every S is what the target's stored settings command, and the canvas processed bitmap and Photo engraving window show it; precedent 06-P2-2, G1-P3-2)","known":false,"summary":"Operation Copy/Paste settings omits photoToneCurve: pasting a calibrated operation leaves the target uncorrected (compiled sum S 1086000 vs 1594880), and pasting an uncorrected one over a calibrated one is a no-op with no undo step; reachable today because a process recipe saved from a calibrated photo puts the curve on an operation when applied"},
  {"id":"G3-K-1","severity":"P3","area":"laser-ui","file":"src/ui/layers/feed-ceiling.tsx","line":93,"anchor":"Contract: rolling-v2 06-P2-5 Where and Fix direction ('do the same for the feed-ceiling Raise'); Twin: setLayerParamWithArtworkOverrides one pushUndo (layer-param-actions.ts:38-51)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro (zz-g3r-known): one Raise click adds 2 undo steps; feed-ceiling.tsx unchanged since #868 and absent from #1367's 27 files","known":"docs/audits/2026-10-21-rolling-v2/06-laser-ui-settings.md P2-5 (ledger row LEDGER.md:97 wrongly records all of 06-P2-5 as fixed by #1367)","summary":"Raise Output max feed writes the profile and the speed as two undo steps; one Undo leaves a half-applied raise. The 06-P2-5 ledger record says fixed, but only the Job Review half was"}
]
```
