# Rolling audit v3 — Job output

- **When:** 2026-10-27 07:50–08:50 +0800   **Tree:** origin/main @ `9a2bf6b13` (worktree HEAD `ee34f5f8a`; its `src/` is identical to `9a2bf6b13`)
- **Scope:** `src/core/job`, `src/core/output`, `src/io/gcode`, `src/core/raster`, `src/core/external-program`, `src/core/laser-second-pass`.
  - Changes since rolling v2: 42 first-parent merges from `git log --first-parent --since=2026-10-21T00:00 origin/main -- <paths>`, from #1287 to #1452. Also every branch-side merge (`main` into a PR branch) that touches these paths, read with `git show --cc`.
  - Followed into the twins and seeds: `src/ui/calibration/tone-calibration-store.ts`, `src/ui/raster/PhotoEngravingDialog.tsx`, `src/core/effective-output`, `src/core/preflight/laser-off-motion-policy.ts`, `src/io/rd/emit-rd.ts` and `src/core/controllers/ruida/rd-motion-plan.ts`.
  - Governing ADRs: ADR-127 Amd 1, ADR-239 Amd 1, ADR-415 Amd 1, ADR-096 Amd 1 (#1440); ADR-567 Amd 1–2; ADR-398 Amd 1–2; ADR-626 Amd 8–10; ADR-669 (#1431); ADR-670 (#1442, merged without CI); ADR-671 (#1443); ADR-052 Amd 1; ADR-497 Amd 1; ADR-630 Amd 4–8; ADR-282 Amd 1 item 5 (emitter revision process).
- **Lenses run:** L8 (main lens), L3, L1, L4, L7.
  - L2 was light. No new firmware sources were fetched; the firmware facts are taken from the ADRs' pinned links, and every finding here rests on Contract or Twin anchors.
  - L5 and L6 were not assigned.
  - Repros:
    - Five whole-pipeline node scripts (`prepareOutput` / `emitGcode` bundled with the repo's esbuild 0.28.1), about 2,200 generated projects in all.
    - Focused Vitest runs of 13 existing test files. Vitest workers could not start for the first 20 minutes because the PC had 0 GB free memory; later runs passed.
- **Counts:** 2 raised → 0 refuted → P1 0 / P2 1 / P3 1 (+ 1 KNOWN re-observed). The refuter raised G1-P3-2 to P2 and kept its ID.

## Headline

The emitter changes merged since rolling v2 hold on every sibling path tried. The siblings were ADR-669's part-by-part inside-first order, ADR-398's Marlin and job-end darkness, ADR-567's small and FluidNC `$30` power, and ADR-127's rotary anchor. Every variant was crossed with leads, tabs, passes, overcut, rasters and air. No repro found a hole cut after its part, a lit planner drain, a laser-on rapid, a collapsed or fractional-where-forbidden S word, or a motion outside the Frame.

There are two findings:
- **G1-P3-1 (P3).** Nine merges changed laser bytes without advancing `EMITTER_REVISION`, so the header's emitter line cannot tell those programs apart.
- **G1-P3-2 (P2 after the refuter).** The ADR-670 tone wedge is burned at the operation's power. It ignores the photo's own object power scale (the Power multiplier), which the compiled photo applies. A calibration can therefore be measured at a different power than the photo burns at, and the window gives no mismatch notice. The notice also fires on a calibration measured at the photo's real power.

The branch-side conflict resolutions in scope kept both sides' code. For example, #1440 against #1447 kept `withRotaryAnchor` and the Amd 10 output scope, and #1443 kept the ADR-670 curve and the ADR-671 sharpen.

## Findings

### G1-P3-1 — Nine laser-output-changing merges did not advance `EMITTER_REVISION`, so the provenance header names one revision for different programs
- **Where:** `src/io/gcode/gcode-metadata.ts:31` (docstring "Bump when the emitter's G-code-shaping behavior changes."), `:157` (`EMITTER_REVISION`).
- **Anchor:** Contract + Twin.
  - **Contract:** DECISIONS.md, ADR-282 Amendment 1, "Findings and corrections" item 5, names a missing bump as a defect: "Output shaping changed without a revision bump." The docstring at `gcode-metadata.ts:31` is cited as code, not as ADR text.
  - **Twin:** other laser changes in the same week did bump the revision: ADR-398 Amd 1 and Amd 2 ("advances to `marlin-dark-air-changes-20261021-v22`" / "`…-v23`") and ADR-415 Amd 1 ("The emitter revision is bumped.").
- **Scenario:** The following merges change emitted laser bytes but leave `gcode-metadata.ts` untouched:

  | PR | Merge | Change | Header still reads |
  |---|---|---|---|
  | #1431 | `95bbdb922` | ADR-669 route and inside-first order. Its Consequences say G-code changes "for most jobs with more than a few contours". | `cnc-drill-plunge-feed-20261023-v29` |
  | #1443 | `ad3f7e8f7` | ADR-671 tones | `cnc-drill-plunge-feed-20261023-v29` |
  | #1447 | `4789497aa` | ADR-626 Amd 10 leads | `cnc-drill-plunge-feed-20261023-v29` |
  | #1345 | `d9a9aa0a6` | ADR-626 Amd 8 | v24 |
  | #1374 | `17efcd7f4` | Lead review fixes | v23 |
  | #1400 | `78001392e` | ADR-567 Amd 2: FluidNC whole S | v24 |
  | #1398 | `e5194f3b5` | ADR-052 Amd 1: placement | v24 |
  | #1351 | `99d8743b7` | ADR-567 Amd 1 small `$30` and the comment sanitiser | v23 |
  | #1411 | `48f3d8b5a` | ADR-497 Amd 1 Material Test | v25 |

  A laser program saved before #1431 on 2026-10-24 and one saved after #1443 and #1447 on 2026-10-27, before #1440, both carry `; emitter: cnc-drill-plunge-feed-20261023-v29`. Yet they differ in cut order, lead placement and image tones, and their emitter line names a CNC drill change.

  The impact is provenance only. `EMITTER_REVISION`'s only consumer is `src/ui/app/build-info.ts:15`, and the header's `; commit:` SHA still identifies the build. P3.
- **Evidence:** READ (git history). For each merge `m` above:
  - `git diff --name-only m^1 m -- src/io/gcode/gcode-metadata.ts` prints nothing.
  - `git show m:src/io/gcode/gcode-metadata.ts | grep "export const EMITTER_REVISION"` prints the unchanged value: v29 at `95bbdb922`, `ad3f7e8f7` and `4789497aa`; v24 at `d9a9aa0a6`, `78001392e` and `e5194f3b5`; v23 at `99d8743b7` and `17efcd7f4`; v25 at `48f3d8b5a`.
  - #1329 (blue-noise dither, `ac3fe4113`, v21) also adds a new algorithm without a bump. It changes no existing bytes, so it is listed for completeness only.
- **Refuter:** CONFIRMED.
  - **What would make it false:** a merge that did touch `gcode-metadata.ts`, a merge that changes no existing bytes, an ADR that waives the bump, or another header line that already tells the programs apart.
  - **Line 1, git:** re-ran both commands for all nine merges and got the same values. A later bump only came with #1440 (v30), #1451 (v31) and #1452 (v32).
  - **Line 2, the ADRs say bytes change:**
    - ADR-669 Consequences: "G-code changes for jobs with nested Line work".
    - ADR-671 "Measured change for existing projects": tones with two or more controls move.
    - ADR-497 Amd 1 item 3 and its Verification: a Cut grid is cut in generated order, "Before the change, eight of its ten cases failed". Item 3 says grids saved earlier change too.
    - ADR-567 Amd 1–2 and ADR-052 Amd 1 change small-`$30`, FluidNC and placed-job bytes.
    - None of these ADRs mentions the emitter revision.
  - **Shipped case:** desktop 1.0.22 (`b9202d5aa`) and 1.0.23 (`87ecb4f24`) both carry `cnc-tile-files-per-bit-20261023-v25`, but only 1.0.23 contains #1411. The same saved Material Test project therefore cuts in a different order under the same emitter line.
  - **Header:** `gcodeMetadataHeader` writes no power-scale version. Only `; version:` and `; commit:` tell the builds apart.
  - **Anchor caveat:** ADR-282 Amd 1 is "Superseded by ADR-285; retained as historical", so its item 5 is weak as a Contract anchor. The finding stands on the Twin anchor (ADR-398 Amd 1/2, ADR-415 Amd 1, ADR-486 Amd 2 "advances once to v17") and the code docstring at `:31`.
  - **Novelty:** none of the 2 open PRs (#1455, #1456) touches `gcode-metadata.ts`, and no audit raises this.
  - **Severity:** P3 kept. This is provenance only: no S, F or coordinate is wrong, and the `; version:` and `; commit:` lines still identify the build.
- **Fix direction:** Advance `EMITTER_REVISION` once, naming ADR-669, ADR-671, ADR-626 Amd 8/10, ADR-567 Amd 2 and ADR-052 Amd 1. Consider a check that fails when a golden laser snapshot changes but `EMITTER_REVISION` does not.

### G1-P3-2 — The tone calibration wedge burns at the operation's power, while the photo burns at that power times its object power scale; the mismatch notice stays silent
- **Where:**
  - `src/ui/calibration/tone-calibration-store.ts:44-53` (`selectedPhotoSeed` captures `effectiveOperationForObject(operation, image)`, which holds no object `powerScale`);
  - `src/core/job/tone-calibration-wedge.ts:112-126` (`wedgeOperation`) and `:151-165` (the wedge image carries no `powerScale`);
  - the compile twin at `src/core/job/compile-job-raster.ts:161` (`effectiveObjectPowerPercent(layer, obj)` = layer power × `objectPowerScalePercent(obj)`, `src/core/effective-output/effective-output.ts:54-57`);
  - the mismatch notice at `src/ui/calibration/tone-calibration-library.ts:93`, fed `effective.power` from `src/ui/raster/PhotoEngravingDialog.tsx:32,66`.
- **Anchor:** Twin + Contract.
  - **Twin:** compile burns the photo at `effectiveObjectPowerPercent`, but the seed and the notice use the bare operation power.
  - **Contract:** ADR-670 Decision item 2 says the wedge uses "the selected photo's effective operation (object overrides included)" so that "the burn measures the raw response to those exact settings". Item 7 says that when a calibration "was measured with another dither, DPI, marking, power or speed, the window says so".
- **Scenario:** A photo on an Image operation at 40% has Advanced Artwork Settings → power scale 50%, so it engraves at 20%.
  1. Tools → Calibrate → Tone Calibration with the photo selected seeds Power 40. The wedge's solid patch burns at S400 while the photo's black burns at S200.
  2. The user records the wedge and applies the curve.
  3. The Photo engraving window compares 40 with 40 and gives no "measured with a different power" notice.

  The curve was fitted to the material's response at twice the photo's power, so the corrected photo's tones are off. They come out too light where dot gain at 40% exceeds dot gain at 20%. Laser power, Frame and position are unaffected. The Tone Calibration dialog shows the wedge's power (40). The photo's 20% appears only under Advanced artwork settings → Resulting power. The auditor rated this P3, as a calibration-quality twin that needs an object power scale on a photo. The refuter raised it to P2 (see Refuter).

  The reverse case also misleads. A user who sets the wedge to the photo's real 20% gets the notice "measured with a different power. Burn a new wedge with these settings". That window's **Calibrate a material…** button then seeds 40 again (`PhotoEngravingDialog.tsx:153-170`).
- **Evidence:** REPRO. A node script, bundled with esbuild, ran `compileJob` on the worktree source:
  - Input: a solid-black 16 × 4 px photo with `powerScale: 50` on a 40% grayscale Image layer. The wedge came from `generateToneCalibrationWedge({ patchCount: 6, patchSizeMm: 5, operation: captureLayerOperationSettings(effectiveOperationForObject(layer, photo)) })`.
  - Output: `{"layerPower":40,"photoPowerScale":50,"seedPower":40,"photoGroupPower":20,"photoSolidS":200,"wedgeGroupPower":40,"wedgeSolidPatchS":400,"maxPowerS":1000}`.
  - Code read confirmed that the notice compares `measured.power` (40) with `effective.power` (40).
  - Novelty: open PR #1455 edits `selectedPhotoSeed` for another reason (trace-source photos); no audit or PR mentions the power scale.
- **Refuter:** CONFIRMED, severity raised P3 → P2 (ID kept).
  - **What would make it false:** any of these would refute it.
    - The power multiplier does not reach a photo's compiled S.
    - The UI cannot set the multiplier on a photo.
    - Some seed path applies the multiplier.
    - The notice compares the scaled power.
    - ADR-670 limits "power" to the operation's power.
  - **Repro (independent, esbuild-bundled node script):**
    - Setup: an 8 × 8 px black photo with `powerScale: 25` on a 60% grayscale Image operation. The script calls `compileRasterGroupsForLayer` and seeds exactly as `selectedPhotoSeed` does.
    - Output: `{"seedPower":60,"photoGroupPower":15,"photoMaxS":150,"wedgeGroupPower":60,"wedgeMaxS":600,"noticeWithSeededCalibration":[],"noticeWithCalibrationAtTruePower15":["power"]}`.
    - Result: the seeded calibration gets no notice. A calibration measured at the true 15% is flagged.
  - **Code read:** both entry points seed the bare operation power. `tone-calibration-store.ts:51-53` and `PhotoEngravingDialog.tsx:32,70,153-170` use `effectiveOperationForObject`, which resolves `operationOverride` only. Its docstring at `effective-output.ts:13` says it runs "before power scaling is applied".
    - The notice gets `effective.power` (`PhotoToneCalibrationField.tsx:29-38`).
    - The multiplier is reachable on any laser artwork, photos included: Advanced artwork settings → Power multiplier (`SelectedObjectProperties.tsx:164-170`, `AdvancedArtworkSettings.tsx:25-42`).
    - The grayscale minimum is unscaled the same way.
  - **ADR-670:**
    - Item 2's letter ("effective operation (object overrides included)") matches the code, because the multiplier is not an operation override. Its stated purpose does not: "the burn measures the raw response to those exact settings".
    - Item 7 promises the notice when the calibration "was measured with another … power". The photo burns at another power, and no notice appears.
    - No other warning links the two powers.
  - **Severity, P2 not P3:** under §3 this is a broken contract (ADR-670 item 7) with a clear failure scenario. The result also misleads: the notice is silent on a mismatched calibration, and on a correctly measured one it tells the user to re-burn at the wrong power. Narrow reach does not make a reachable defect latent.
  - **Severity, not P1:** every S word equals what the operation, the multiplier and the chosen curve command. Both powers are on screen: the wedge's Power field, and Resulting power for the photo. The tone error comes from a mis-fitted correction curve, of the same kind as a calibration from another material. ADR-670's limits name that kind of error ("real materials may respond differently"). It is not a wrong power, position, depth or scale.
  - **Novelty:** confirmed. PR #1455's diff to `selectedPhotoSeed` only drops the trace-source guard.
- **Fix direction:** Seed the wedge power, and compare the notice's power, with `effectiveObjectPowerPercent(effective, image)`. Alternatively, copy the photo's `powerScale` onto the wedge image and record it in the calibration's "measured with" settings. Cross-area: the seed and the notice live in `src/ui/calibration` and `src/ui/raster` (G6/G10). Fix both seed paths, the Tools menu (`selectedPhotoSeed`) and the Photo engraving window's **Calibrate a material…** (`toneCalibrationSeed`). Scale the grayscale minimum power too.

### KNOWN, re-observed
- **20-P3-1** (rolling v2 raster): a non-finite tone still resolves to the darkest burn after ADR-671's single-rounding rewrite. `src/core/raster/luma-adjust.ts:26-28` (`?? 0` / `?? 1` let NaN through) with `clampLevel(NaN) = 0`. REPRO: `applyLumaAdjustments([0,64,128,200,255], {brightness: NaN})` → `[0,0,0,0,0]`, and the same for `{gamma: NaN}` and `{contrast: NaN}`. ADR-671 neither changed nor mentions this. It is still open.
  - **Refuter: KNOWN confirmed.**
    - Re-ran it (esbuild node script): `{brightness: NaN}`, `{contrast: NaN}` and `{gamma: NaN}` each give `0,0,0,0,0`.
    - `gamma: NaN` passes through `Math.max(0.1, Math.min(5, NaN))` as NaN, so the gamma stage runs and clamps to 0.
    - `luma-adjust.ts` was last changed by ADR-671 (`2254138ea`, `bf2600ba0`). `raster-adjustment-actions.ts` is unchanged since rolling v2. No commit on `origin/main` names 20-P3-1, and no open PR touches either file.
    - ADR-671 line 44's "validates them as finite numbers" is about the sharpen fields, not the tones.
    - Rolling v2's P3 (from its refuter's ruling) still applies.

## Refuted
These candidates were considered and dropped by the auditor before raising.
- **Variable-text anchor asymmetry (#1359):** `variable-text-anchor.ts:62-64` subtracts `placed.minX` but not the record's `minX`. Dropped: the record keeps its render frame (`prepare-output-snapshot.ts:173-183` stores `rendered.paths` and `rendered.bounds` unchanged), so `record.anchor` is already in its geometry's frame.
- **ADR-415 Amd 1 runway marker breaking the S rewriters:**
  - The Marlin fan transform strips only the S word and keeps the comment (`marlin-fan-transform.ts:44-55`).
  - Smoothieware's `rescaleSWords` splits at `;` (`smoothieware-strategy.ts:39-49`).
  - The second-pass source parser strips inline comments (`laser-second-pass/source-block.ts:1`).
  - The drains repro below was clean on Marlin inline and fan.
- **Inconsistent missing-version fallback:** `emit-gcode.ts:154` uses `?? CURRENT_LASER_POWER_SCALE_VERSION`, while `archivedLaserPowerScaleVersion(undefined)` returns 1. Unreachable: `completePreparedOutput` always sets the version (`prepare-output.ts:287`), and `hydratePreparedExecutionOutput` writes an explicit version before any re-emit (`prepared-output-persistence.ts:31-36`, `recovery-artifact-binding.ts:19`).
- **Amd 10 uncut-part obstacles mapped to machine coordinates twice:** `sceneLeadSideGeometry` returns scene points (`laser-lead-sides.ts:181`, `applyTransform` only), and `uncutInJob` maps them once through `toMachineCoords` + offset.
- **ADR-669 2-opt / Or-opt breaking a hold:** `canReverse` rejects a container inside the reversed stretch. `canMove` checks `holds` forwards and `heldBy` backwards, and `chunkReversible` checks within the chunk (`route-refine.ts:205-217, 291-318`). The fuzz below agrees.
- **"Blank stays blank" overclaim in ADR-670:** near-white luma (254) maps to about the first-visible patch's tone. This is the intended inverse of a recorded first-visible run (IDENTITY_BLEND, `photo-tone-curve.ts:31-35`), not a defect.
- **FluidNC `$30=1` traces a 37.3% Line as `G1 … S0` with `long-blank-feed` warnings:** this is the behaviour ADR-567 Amd 2 items 1 and 4 document (whole S, plus a `fluidncPowerStepWarning`). The misleading "regenerate" wording is known from 03-P2-4 and 03-P2-7.

## Verified clean
- **Inside-first through the whole pipeline (ADR-669 × ADR-486 Amd 2 × ADR-626).**
  - Setup: 900 generated projects (3 seeds × 300) of 1–12 parts, each with 0–2 holes, islands and island holes. Shapes were drawn as one object or as separate objects.
  - Settings varied: passes 1–3, kerf ±0.1, tabs (with and without inner), perforation, leads, overcut, Remove overlapping lines, Allow reverse/Preserve, three start points, three closed-shape starts, Cut in direction order, and a manual Job start on a part or a hole.
  - Oracle: rectangle arithmetic on the source, applied to the prepared job's group × pass × segment order.
  - Result: 0 holes whose last burn follows their container's last burn, and 0 even against the container's first burn, over 11,142 containment pairs with 284 job starts. (`done failures 0 pairs 3722 strict 0 jobStarts 98` and similar.)
- **Darkness (ADR-398 Amd 1–2, ADR-462 Amd 1) across dialects.**
  - Setup: 1,050 random 2–4-layer jobs through `emitGcode` on GRBL dynamic, compatible and raster dialects, FluidNC, grblHAL, and Marlin inline and fan.
  - Content: Line (arc and line leads, overcut, tabs with 0/20% tab power, sub-0.001 mm squares), Fill, Offset Fill, and Image (threshold, grayscale and Jarvis, 0 or 5 mm overscan, bidirectional or not).
  - Variations: power 0, 0.03%, 10%, 50% and 100%; Constant/Dynamic overrides; air M7/M8/none; and air keep-alive.
  - Checks: `findM3LitPlannerDrains`, `findMarlinLitPlannerDrains` and `findLaserOnTravelIssues`.
  - Result: 0 issues.
  - **Refuter spot-check: holds.**
    - Setup: an independent esbuild script ran 600 random 2–4-layer jobs through `prepareOutput` → `emitPreparedGcode`, 120 each on GRBL dynamic, FluidNC, grblHAL, Marlin inline and Marlin fan.
    - Content: Line with tabs at 0/20% tab power, overcut and 1–2 passes; Fill with 0/2 mm overscan; Image (threshold, grayscale and Jarvis, 0 or 5 mm overscan, bidirectional or not).
    - Variations: power 0, 0.03, 10, 50 and 100%; Constant/Dynamic overrides; device air M7, M8 or none; air restart unreliable.
    - Result: 0 lit drains and 0 laser-on travel issues. The output held 107 M7/M8 and 238 M3/M4 lines, and 1,244 M106 lines on Marlin fan.
    - Both checkers flag a planted `M8` between lit G1 moves, so they do fire.
- **Power words (ADR-567 Amd 1–2).** Tested with `$30` ∈ {1, 2, 20, 99, 255, 1000} on GRBL v1.1, grblHAL and FluidNC, for a 37.3% Line with 20% tab spans, a 61.7% Fill and a 70%/10% grayscale image.
  - GRBL and grblHAL below 100 use the virtual 0.1% range (`$30=1`: `0.075, 0.373, 0.617`; image `0.119..0.7`).
  - At 255 and 1000 the bytes are whole and unchanged.
  - FluidNC never writes a fractional S on any group kind (`frac=0` in all six cases).
  - **Refuter spot-check: holds, also with the Power multiplier.**
    - Setup: an independent esbuild script used `$30` ∈ {1, 20, 99, 255, 1000} × FluidNC, GRBL v1.1 and grblHAL. Each project had a 37.3% Line with 20% tab power, plus a Line object with `powerScale: 43`; a 61.7% Fill plus a Fill object with `powerScale: 27`; and a 70%/10% grayscale image with `powerScale: 37`.
    - FluidNC: 0 fractional S at every `$30`, power-scale version 4.
    - GRBL and grblHAL: fractional below 100 (`$30=1`: lowest 0.032, highest 0.617); whole at 255 and 1000.
    - No S word is above `$30` anywhere.
    - Code read: every vector `scaleS` caller and `rasterCompilationPowerScale` take the version through `powerScaleVersionForDevice`, which maps FluidNC version 4 to 1 (`laser-power-scale-version.ts:40`, `grbl-strategy.ts:454`, `controller-power-scale.ts:27`, `job-start-power.ts:29`, `focus-test-power.ts:9`).
- **Rotary anchor (ADR-127 Amd 1).**
  - Setup: 24 combinations of 6 placements (Absolute; Current Position centre at Y 80 and back-right at Y 5; User Origin front-left and back-left; Verified Origin centre) × Reverse on/off × GRBL/Marlin inline. Each job had a leaded, overcut Line part with a hole and a 5 mm-overscan image.
  - Result: every emitted motion endpoint lies inside `computeFrameJobMotionBounds(machineSpaceJob(prepared.job))`, with 0 outside.
  - The anchors are 80, 5 and 0 as specified; Absolute has none. Current Position parks at the anchor, and Reverse mirrors about it.
- **Comment injection (03-P1-1 fix):** checked on every sibling, namely the cut, offset-fill, scanline-fill and raster headers, operation provenance, and the lead comment (style and side are enum-normalised, `laser-lead-settings.ts:99-107`, `normalize-layer.ts:296`). CNC tool and tool-name comments go through `sanitizeGcodeCommentValue`. Ruida handles `finalPassBurn` (`rd-motion-plan.ts:41-44`).
- **Tone pipeline (ADR-670/671):**
  - The curve applies once, in `prepareImageLuma`, after the tones and Negative. Pass-through is untouched.
  - The wedge's Negative source inverse returns the intended burn luma.
  - The only other brightness/contrast implementation is trace's documented one (`core/trace/raster-prep.ts`).
  - Project load validates the curve (`project-cut-extras-validator.ts:40-48`).
- **Tests that hold at `9a2bf6b13` (L7).** All pass:
  - #1442, merged without CI: `tone-calibration-wedge`, `photo-tone-curve`, `compile-job-raster-tone-curve`, `compile-job-raster-tone-curve-stream`, `perceptual/photo-tone-calibration` and `project-photo-tone-curve` (43 tests).
  - #1443: `compile-job-raster-sharpen`, `luma-sharpen` and `luma-adjust` (29 tests).
  - The late-merged rolling-v2 fixes: `emit-gcode-rotary-placement`, `image-runway-blank-feed`, `laser-leads-uncut-parts` and `laser-leads-open-gaps` (24 tests).
- **Conflict resolutions:** each kept both sides' code.
  - `8eaa4907e`: #1440's rotary anchor around #1447's Amd 10 lead scope.
  - `bf2600ba0`: ADR-671 sharpen in the materialized, streamed and rotated raster paths.
  - `a3f4d1991`, `d98e7ebe9` and `5c300bc05`: the `EMITTER_REVISION` chain v22→v24 and v29→v30, keeping every ADR comment line.
  - **Refuter spot-check: holds** (read with `git show --cc`).
    - `8eaa4907e` wraps `applyLaserLeads(…, { output: leadOutputScope(…) })` in `withRotaryAnchor`. `prepare-output.ts:294-298` still has both at `9a2bf6b13`.
    - `bf2600ba0` keeps main's `rescaleRasterValuesForVersion` beside the sharpen hunks in `compile-job-raster.ts`. `prepareImageLuma` still applies tones → Negative → curve.
    - The three emitter merges each took a value newer than both sides: `a3f4d1991` resolves two v22s to `…-20261021-v23`, `d98e7ebe9` resolves two v23s to v24, and `5c300bc05` goes v29/v26 → v30. Every ADR comment line on both sides survives.
- **ADR-415 Amd 1:** the preflight allowance takes the 0° automatic runway, the longest possible (`laser-off-motion-policy.ts:31-58`). The marker is only on S0 run-ins and run-outs (`emit-raster-sweep.ts:140-162, 243-246`).

## Not verified
- No hardware, air-cut or material runs. In particular, no wedge or photo was burned, and rotary anchors were not checked on a rotary.
- Ruida `.rd` output of a placed rotary job: whether a Ruida controller's own rotary handling composes with the anchor scaling. The `.rd` export runs `machineSpaceJob` the same way.
- `e2e/photo-tone-calibration.e2e.ts` (#1442) was not run. It is not in `PR_SMOKE_CORE` (`scripts/run-pr-browser-smoke.mjs:15-27`), so whether it ever ran in CI is G8's question.
- External program (ADR-630 Amd 4–8): read only.
  - Covered by reading: `lit-rapids.ts`, `evaluated-syntax.ts`, `program-stops.ts` and `storage-command-check.ts`.
  - Controller audit v4 E4 audited these; the UI wiring (`external-run-readiness.ts`) belongs to G4.
- The Material Test cell order under ADR-669 refinement was read only (`compile-vector-operation.ts:68-70` gives each cell its own scope).
- Streamed rasters above `STREAMED_RASTER_PIXEL_THRESHOLD` with sharpening and a tone curve were not run independently; the repo's stream-equals-materialized tests pass.

```json
[
  {"id":"G1-P3-1","severity":"P3","area":"job-output","file":"src/io/gcode/gcode-metadata.ts","line":157,"anchor":"Twin: ADR-398 Amd 1/2, ADR-415 Amd 1 and ADR-486 Amd 2 bumped; Contract (weak, superseded historical): DECISIONS.md ADR-282 Amd 1 Findings item 5","evidence":"READ","verdict":"CONFIRMED","refuter":"Re-ran the git checks for all nine merges; ADR-669/671/497 Amd 1/567 Amd 1-2/052 Amd 1 each state byte changes and none mentions the revision; shipped 1.0.22 (b9202d5aa) and 1.0.23 (87ecb4f24) both carry v25 though only 1.0.23 has #1411; header has no other output-version line; P3 kept (provenance only)","known":false,"summary":"Nine laser-byte-changing merges (#1431 ADR-669, #1443 ADR-671, #1447/#1345/#1374 leads, #1400 FluidNC S, #1398 placement, #1351 small $30, #1411 Material Test) left EMITTER_REVISION unchanged, so different programs carry the same emitter line"},
  {"id":"G1-P3-2","severity":"P2","area":"job-output","file":"src/core/job/tone-calibration-wedge.ts","line":112,"anchor":"Twin: compile-job-raster.ts:161 effectiveObjectPowerPercent vs tone-calibration-store.ts:53 and PhotoEngravingDialog.tsx:153-170 seeds; Contract: ADR-670 items 2 (purpose) and 7","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Independent repro (60% op, powerScale 25): seed 60, wedge S600, photo S150, notice [] for the seeded calibration and ['power'] for one measured at the true 15%; multiplier reachable via Advanced artwork settings on photos; raised P3 to P2 (broken ADR-670 item 7 with a clear, misleading failure scenario); not P1 (every S is as commanded and shown; the error is a mis-fit correction curve)","known":false,"summary":"Tone wedge is seeded and burned at the operation power, ignoring the photo's object power scale (wedge S400 vs photo S200 at scale 50%); the measured-with mismatch notice compares the same unscaled power, stays silent, and flags a calibration measured at the photo's real power"}
]
```
