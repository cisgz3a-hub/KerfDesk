# T15 Photo Engraving — auditor report
Tree: origin/main @ 49ced452b. Command id: `tools.photo-engraving`.
Scratch: `C:\Users\stolk\kd-t1\zz-t15` (`t15-common.ts`, `t15a.test.tsx`, `t15b.test.tsx`, `t15d.test.tsx`, `t15e.test.ts`, `vitest.config.mts`; logs `t15a.log`, `t15b.log`, `t15d.log`, `t15e.log`).
Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t15/vitest.config.mts --maxWorkers=1 <file>`. Free memory was 2.9–3.1 GB at each run. No browser run.

## Map
- **Menu.** Tools → Image → Photo engraving (`app-menu-groups.ts`, `command-raster-family.ts`) → `openPhotoEngraving()` (`src/ui/raster/photo-engraving-store.ts:54-78`).
  - It refuses with "Select one unlocked photo in the laser workspace." unless exactly one unlocked raster is selected in laser mode.
  - It picks the first bound operation with output on (`photoEngravingOperationForImage`).
  - It captures a session: `projectDocumentEpoch`, the image and operation object references, the device, and the scene objects.
- **Host.** `PhotoEngravingDialogHost.tsx` keys the dialog by `sessionId`.
  - `current` is `photoEngravingSessionIsCurrent`: same epoch, `selectedObjectId === image.id`, no extra selection, the same image and operation references, unlocked, a visible layer, the same device, and the same mask object (`photo-engraving-apply.ts:53-65`, `photo-engraving-store.ts:28-40`).
  - Apply re-checks this inside `commitProjectEdit` and makes one Undo step labelled 'Photo Engraving'.
- **Dialog.** `PhotoEngravingDialog.tsx` + `PhotoEngravingFields.tsx`. Controls:
  - Material recipe (ADR-685), Photo processing (Blue Noise / FS / Stucki / Jarvis, plus Grayscale when the photo already uses it).
  - Material marking (Negative), tone calibration (ADR-670).
  - Brightness / Contrast / Midtones, with Auto tones and Reset tones.
  - DPI (5–25 lines/mm).
  - Sharpen amount and radius (ADR-671).
  - Power and speed are not editable here (hint text).
- **Apply.** `photoEngravingImage` (`photo-engraving-apply.ts:80-115`):
  - writes the image tones and sharpening;
  - writes `operationOverride.byOperation[op] = {mode:'image', dither, linesPerMm, negativeImage, passThrough:false, photoToneCurve?}`;
  - pins every sub-pass to its current effective override, or `null` (`:92-96`).
- **Preview.** `use-photo-engraving-preview.ts` waits 150 ms, then sends the same `photoEngravingImage(...)` to a worker (`photo-engraving-preview-worker-client.ts`, one worker per edit, aborted on change, 30 s limit).
  - The worker runs `computePhotoEngravingPreview` (`photo-engraving-preview.ts`). It calls the shipping `compileRasterGroupsForLayer` on the real grid and reduces only for display (≤ 1000 px). It also returns the source histogram for Auto tones.
  - The budget is in `photo-engraving-preview-budget.ts`.
- **Core.** `core/job/compile-job-raster.ts` runs `prepareImageLuma` (tones as one LUT → Negative → tone curve), then area resample (`burnGridKernel`), sharpen (`luma-sharpen.ts`), mask, machine orientation, `dither`, and the S scaling. `core/raster/portrait-auto-tones.ts` computes Auto tones.
- **Governing.** ADR-581 (+ Amd 1), ADR-670 (+ Amd 1, 2), ADR-671 (+ Amd 1), ADR-685 (+ Amd 1, 2), ADR-390, ADR-492 (pass runs share one grid).
- **Changes since 2026-10-16** (git log on these files): a10577fcc swatches; 926cb499c / 8e22f6243 tone calibration; 2254138ea one rounding + sharpen; 105d6374c (#1464 G1-P3-2, G9-P2-1); 19a05d355 (#1471 Grayscale kept); 7fe63ea55; e1cc26fdf ADR-685; 9796ab4e6 (R8-P2-3); 19faee6f1 (#1555 U3-P2-3 phone photo); e5e26cdcb (O6-P2-1 gamma text); 4e6c2a00e (#1787 O6-P3-2 Auto tones round toward the clip).

## October register re-check
Row #22 ("worker preview and exact image/operation apply; extreme dimension/pass/clip guards"), plus the follow-up "Photo Engraving → Adjust Image reads effective per-image settings":
- **Exact image/operation Apply, isolated edits: still fixed.**
  - C1: two photos A and B on one operation. Apply on A (slate recipe, FS, 200 DPI) writes only A's override.
  - The scene layers are byte-identical afterwards.
  - B's G-code is identical, and A's existing override for another operation (`other: {power 33}`) is kept.
  - In all of A1–A5 the operation stays identical (`op unchanged: true`).
- **Single-step Undo: still fixed.** C2: one Undo restores the project JSON exactly and the G-code is identical. Redo restores the applied project exactly.
- **Worker preview: still fixed.**
  - Every edit runs in a cancellable worker; I used a fake `Worker` running the real worker function on a `structuredClone`.
  - While stale, no preview runs (B: "previews while stale 0").
- **Extreme guards: hold.**
  - D2a: a 100000×100000 source gives "This photo has too many pixels to preview (10000 megapixels; the preview reads up to 50)…" without hydrating, and Apply stays available.
  - D2b: 2000×1500 px at 400×300 mm and 635 DPI gives "too big to preview at this size and resolution". Apply stores 25 lines/mm, and `prepareOutput` is ok in 45 ms.
  - D2c: passes 1e9 gives a preview refusal. See T15-P2-2 for the wording and threshold.
- **Adjust Image reads effective per-image settings:** T14 re-checked this in Adjust Image (C2 there). Not re-run.

## Checks run
| Check | Method | Result |
|---|---|---|
| Dialog → Apply → `prepareOutput` → G-code, per cell, vs independent oracle | `t15a.test.tsx`. Real `PhotoEngravingDialogHost` opened with `openPhotoEngraving()`; the recipe select, swatch radio, marking select and number fields are driven, then the form is submitted. The G-code is decoded per burn cell. The oracle is my own: ADR-671 tone curve (B, C, `1/γ`, stage clamps, one rounding), Negative, piecewise-linear tone-curve LUT, exact area mean, separable Gaussian unsharp (3σ, clamped edges, one rounding), FS/Jarvis/Stucki from the published kernels (serpentine, machine-oriented grid), Grayscale `round(sMin+(255−v)/255·(sMax−sMin))` | **0 differing cells in all 4 oracle cases:** A1 wood recipe + FS, 1:1, 10 l/mm; A2 slate recipe + Jarvis, 2:1 reduction, DPI typed 254 over a stored 127; A4 Grayscale, power 70, Min 20, passes 2, op tone curve, typed tones and sharpen 80/1; A5 Stucki, Light marks, curve, sharpen 200/2.5, 4:1 reduction at 127 DPI. A4: each burned cell burned twice (passes 2) |
| Auto tones per ADR-685 (incl. Amd 2 "round toward the clip") | A1/A2: the recipe is picked **before** the first preview (Amd 1 pending tones). My own computation from the ADR text (0.5 % tails, 255 not counted, b floored and c ceiled to a tenth, median-hold γ to 0.01) | Fields show b1.6 c25.7 g0.91 / b1 c23.8 g0.94 = oracle exactly. D3: 20,000 random histograms, real `portraitAutoTones` vs my oracle: **0 mismatches**. The darkest 0.5 % level is solid in every case. For the lightest level see T15-P3-1 |
| Preview pixels vs burn | A1–A5: the last worker result (preview input tones equal the applied tones), machine-oriented RGBA flipped to scene, `255−R` vs `S/sMax·255` | **0 differing cells in all 5**, including Blue Noise (A3) where no independent oracle exists. Preview `scanPasses` 2 for A4 |
| ADR-581 decision 7 binding while open | `t15b.test.tsx` B1–B8. Draft b 40 + FS, then a store write the way the phone/MCP adapter would make it, then a submit (as Enter would) | Selection to C, multi-select, cleared, image deleted, image moved, project switched (`newProject`), operation power changed, device changed, pixels replaced under the same id: **every one** shows the alert "The photo, selection or operation changed…" with Apply disabled. A forced submit writes nothing and no stale preview runs. After restoring the selection or the deleted image, the draft is kept and Apply writes to **A**, not C. An unrelated edit (B moved) keeps the dialog current, and Apply keeps B's move. The T14R-P2-1 retargeting does **not** occur here |
| Cancel | C4: recipe, contrast 70, DPI 400, then Cancel | Closed; project JSON identical; Undo 0; dirty false |
| Apply with nothing changed | C5 | Project identical, no Undo entry, not dirty (the toast still says "applied") |
| Save / reopen | C3 `serializeProject` → `deserializeProject` | ok; G-code identical; override identical; the reopened dialog shows the applied values (b1.6 c25.7 g0.91, 30/0.7, 200 DPI, FS, light) |
| Typed boundaries | D1 (14 entries) | DPI 5000 / 1e9 → 635 (25 l/mm); 0 / −5 / 3 → 127 (5 l/mm); `abc` keeps 254. Brightness 1e9 → 100, −150 → −100; contrast NaN keeps 0; γ 0 → 0.1, 9 → 5; sharpen 9999 → 500; radius 0 → 0.5, Infinity keeps 1. Nothing invalid reaches the project |
| Image sub-pass | D4: `addLayerSubLayer('img')` (real action), then Light marks, Apply | See T15-P2-1 |
| Preview limit vs passes | D5/D6 + `t15e.test.ts` | See T15-P2-2 |
| Non-photo dither on open | C6: operation on Threshold | The dialog opens on Jarvis and Apply writes Jarvis (ADR-581 decision 2, by design) |
| Existing suites | Vitest, 12 files (apply, store, preview, worker, worker-client, sharpen, tone-curve, 3 dialog suites, preview hook, portrait-auto-tones) | 99/99 pass |
| LightBurn | ADR-581/685's cited Image Mode, Adjust Image, Shape Properties and Working With Images pages (not re-fetched) | Min/max power apply to Grayscale only and dithers burn at max S: matches (A4 sMin 200 used, dithers 0/sMax). Negative and DPI semantics match. KerfDesk γ direction is opposite and stated (ADR-671 Amd 1) |

## Findings

### T15-P2-1: Photo engraving leaves an image sub-pass on the old settings and does not say so; with Light marks the photo then burns its negative and its positive on top of each other
- **Severity: P2.** A wrong burn that the window does not warn about.
  - The dialog says "The preview and engraving settings apply to this operation for the selected photo." Its preview compiles only the main operation (`scanPasses 1, scanCount 1`).
  - A sub-pass of that same operation keeps burning the photo with the old marking, dither and DPI.
  - Not P1:
    - ADR-581 decision 7 deliberately says "Preserve … sub-operations", and the code pins them on purpose (`photo-engraving-apply.ts:92-96`).
    - The job Preview shows both passes.
    - It needs an image sub-pass on the photo's operation.
  - A refuter could argue P1 (the burn is ruined) or P3 (ADR-sanctioned).
- **Where:**
  - `src/ui/raster/photo-engraving-apply.ts:92-96`: sub-passes are pinned to their prior settings, or `null`.
  - `src/ui/raster/PhotoEngravingDialog.tsx:183-191`: the operation hint has no mention of sub-passes.
  - `src/ui/raster/photo-engraving-preview.ts:36-39,77-78`: the preview compiles only `input.layer`.
  - READ ONLY, same class: a photo bound to two image operations with output on gets only the first one edited.
- **Repro (ran):** `zz-t15\t15d.test.tsx` D4, log `t15d.log`.
  1. Photo A, 48×32 px at 4.8×3.2 mm, FS, 10 l/mm.
  2. `addLayerSubLayer('img')` makes `sub-1` with mode image, FS, Negative off, enabled.
  3. Before Apply: 593 cells burned, each in both passes.
  4. Open Photo engraving, choose "Light marks on a dark surface", Apply.
  - Override: `{"img:sub-1":null,"img":{…"negativeImage":true…}}`.
  - **After: 1,371 of 1,536 cells (89 %) are burned by some pass.** Pass 1 burns the inverted photo and pass 2 the original positive (163 cells twice), so the portrait comes out as an almost uniform rectangle.
  - The dialog text never mentions a sub- or second pass.
  - Expected from the dialog: both passes burn light marks, or the window says that sub-pass "<name>" keeps its own marking, dither and DPI.
  - The same happens for a DPI or dither change: main and sub-pass then burn different grids.
- **Oracle:**
  - Decoded G-code per cell.
  - The ADR-581 decision 3 meaning of "Light marks" (invert the burn).
  - LightBurn sub-layers have their own cut settings, but LightBurn has no per-photo window that claims to set the photo's marking.
- **Suggested fix:** when the bound operation has enabled image sub-passes, list them in the operation hint, for example "Sub-pass '<name>' keeps its own marking, dither and DPI". Or offer "Apply to its sub-passes too", which writes the same override keys to their `byOperation` entries. Count the sub-passes in the preview's pass line.

### T15-P2-2: The photo preview refuses multi-pass photos as "too big … lower the resolution", although the preview's work does not depend on passes and output accepts the job
- **Severity: P2.** A refusal that should not happen, and its advice points at the wrong cause (resolution or size), which could push a user to change the burn.
  - `scanPlanFits` charges `pixels × passes` work units against 50 M (`evaluateRasterBudget`, `raster-budget.ts:51,62`).
  - The preview compiles one grid per angle, whatever the pass count (ADR-492: "Runs at the same angle share one compiled grid"). ADR-581 decision 5 says the preview shows the first scan.
  - Not P1: Apply and Auto tones still work (the histogram is still read), and the job Preview is unaffected.
  - A refuter could argue P3 (preview only).
- **Where:** `src/ui/raster/photo-engraving-preview-budget.ts:108-119` (message at `:117`) and `:161` (`passes: run.passes` fed into the budget, summed against `MAX_RASTER_WORK_UNITS` at `:176`).
- **Repro (ran):** `zz-t15\t15d.test.tsx` D5 and `t15e.test.ts`. A 1000×750 px photo at 200×150 mm and 10 l/mm (2000×1500 cells):
  - passes 1, 5 and 16: preview ok (1000×750).
  - **passes 17 and 20: "This photo is too big to preview at this size and resolution. Lower the resolution or make the photo smaller."**
  - `prepareOutput` is ok in every case (275–299 ms).
  - `computePhotoEngravingPreview` costs the same at passes 1 and 16 (329 / 289 ms vs 309 / 303 ms).
  - Budget verdict: "51000000 pixel-pass work units exceed the 50000000 work-unit budget".
  - The threshold falls with size: a 300×225 mm photo at 12.5 l/mm refuses from 5 passes (D6 shows 3 still ok).
- **Oracle:** The measured preview cost is flat in passes. Output accepts the same job. ADR-581 decisions 4–5 say the preview shows the first scan, and ADR-492 says one grid per angle.
- **Suggested fix:** budget the preview with passes 1 per distinct angle; it already counts each angle's grid once for bytes. If a limit remains, name its real cause (the pass count).

### T15-P3-1: Auto tones do not always blank the lightest 0.5 %; ADR-685 Amd 2's "still reads 254 or 255" ignores a midtone gamma below 1
- **Severity: P3.** It barely affects the burn: a level of 252–253 dithers to about 1 % dots, only in the lightest 0.5 % of pixels.
- **Where:**
  - `src/core/raster/portrait-auto-tones.ts:52-56`: the brightness is floored, then the median-hold γ is applied afterwards.
  - `docs/decisions/ADR-685-amendment-2-auto-tones-round-toward-the-clip.md:22`.
- **Repro (ran):** `t15d.test.tsx` D3. 20,000 random portrait-like histograms through the real `portraitAutoTones` and `lumaAdjustmentLut`, counting only uncapped stretches (8,303).
  - The 0.995 level maps to 255 in 7,879 cases, to 254 in 395, and **to 253 in 16 and 252 in 1**.
  - Worst case: lo 13, hi 165, median 158 → b15.1 c67.8 γ0.1 → `lut[hi] = 252`.
  - The γ < 1 stage scales a deficit just under 255 by about 1/γ.
  - The darkest level was solid in all cases (Amd 2's actual fix holds).
- **Suggested fix:** compute the midtone γ first, then nudge the contrast up one tenth until `lut[hi] = 255` (or correct the ADR sentence).

## Not a defect / limits
- **T14R-P2-1 class (dialog follows the live selection):** not present. ADR-581 decision 7's binding holds under every phone/MCP-style write tried (B1–B8). Apply never retargets.
- **T14-P2-1 class (shared operation fields):** not present. Apply writes a per-image override and leaves the operation and sibling photos byte-identical (C1). The operation hint names the operation.
- **Recipes never change placement or power, speed, DPI:** by design (ADR-685 decision 2). The clear-from-the-back recipe tells the user to flip the photo, and Apply does not mirror.
- **Threshold / other non-photo dithers open as Jarvis**, and Apply writes it: ADR-581 decision 2.
- **Apply with nothing changed** closes with the "applied" toast but writes nothing (C5). Harmless.
- **The preview shows the first scan only:** ADR-581 decision 5. T15-P2-1 is about the sub-pass that is not disclosed, not about the scan.
- **READ ONLY, not raised:** a recipe picked on a photo whose source exceeds the 50 MP read ceiling never receives a histogram (`limitResult` returns no histogram when `!sourceReadable`). The sentence "Auto tones apply once the preview has read the photo." therefore stays up while the window is open. Rare: such a photo already shows the crop advice.
- **Not checked:**
  - No browser run (memory gate and brief). So keyboard and focus, Enter-to-Apply with a field still focused (React flushing between keydown and submit), real canvas drawing of the preview (`drawPhotoEngravingPreview` orientation), and worker timing in a browser were not exercised.
  - Rotated, mirrored and masked photos were not re-run through the oracle; V5 (rolling v10) and Q1/Q3 covered preview vs burn for these.
  - The On material (beam-spread) view was not compared with an independent model.
  - The tone-calibration picker UI was not driven; the curve was set on the operation and inherited.

## Totals
Raised 3; P1 0; P2 2; P3 1; known 0. T14-P2-1 and T14R-P2-1 were checked here and do not apply to Photo engraving.
