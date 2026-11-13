# T15 Photo Engraving — refuter report
Tree: origin/main @ 49ced452b (read-only). Command id: `tools.photo-engraving`.
Scratch: `C:\Users\stolk\kd-t1\zz-t15r`. It holds `vitest.config.mts`, `r1.test.tsx`, `r2.test.ts`, `r3.test.tsx` and the logs `r1.log`, `r2.log`, `r3.log`.
Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t15r/vitest.config.mts --maxWorkers=1 <file>`.
- Free memory was 1.58–2.3 GB at each run. I waited once at 0.6 GB and again at 1.38 GB.
- No browser run.

I used my own method throughout and did not re-run the auditor's scripts or reuse their G-code decoder:
- **Burn counts:** I counted burned cells per compiled `RasterGroup` taken from `prepareOutput(...).job`.
- **Test image:** a left-to-right grey gradient, so the dark and light sides of each pass can be read directly.
- **Dialog:** I drove the real `PhotoEngravingDialogHost` and submitted its form.
- **Preview budget:** I ran the real `photoEngravingPreviewPlan` and compiled the grid directly with `compileRasterGroupsForLayer` and `compiledRasterPreview`.

## Verdicts
| Claim | Verdict |
|---|---|
| T15-P2-1: image sub-pass keeps old settings, undisclosed; Light marks burns negative + positive | **SEVERITY CHANGED, P2 → P3.** The sub-pass route can only come from legacy or hand-made projects. The same harm is reachable today by another route, raised below as **T15R-P2-1**, so the P2 belongs there. |
| T15-P2-2: preview charges pixels × passes, refuses multi-pass photos as "too big … lower the resolution" | **CONFIRMED, P2**, with a narrower exposure. It never happens at 1 pass. The 17-pass example is unrealistic, but 3–4 passes on A4/A3 at 318–508 DPI do trigger it. |

## Evidence

### T15-P2-1: how an image sub-pass arises today
- **The sub-layer panel has not been mounted since 2026-07-15.**
  - Mounted in `LayerRow` by 5b97c32fc (2026-06-17).
  - Removed by 53f518075 (#193, 2026-07-15); the diff drops `{isCncMachine ? null : <LayerSubLayers layer={layer} />}`.
  - Since then `LayerSubLayers` is imported only by `src/ui/layers/OperationControls.audit.test.tsx`. #828's control inventory lists it as "No current production mount; legacy sub-layer list".
  - The only releases that had the panel are v0.1.0 and v0.1.1 (both 2026-07-12).
- **No production code calls `addLayerSubLayer`.** Callers are `LayerSubLayers.tsx` (unmounted), tests and `e2e/convert-bitmap.spec.ts`, which calls the store directly.
- **Other routes, checked one by one:**
  - **LightBurn import** (`src/io/lightburn/lbrn-layers.ts:113-133`): splits each `<SubLayer>` into a following operation, not a sub-layer. It maps only cut/scan/scan+cut kinds and imports no bitmaps at all.
  - **Process recipes** (`capture-process-recipe.ts:44`): capture sub-layers as separate steps. Applying a recipe creates operations, not sub-layers.
  - **Material Library:** presets carry no `subLayers`.
  - **Phone/MCP** (`ui/remote-control/design-operations.ts`): writes only whitelisted `setLayerParam` fields.
  - **Copy/Paste settings, Add operation and Make unique:** copy existing sub-layers only (`layer-settings-clipboard.ts:35`, `clone-artwork-operations.ts:28`); none creates one.
  - **Old projects:** a project that already holds sub-layers keeps them. The validator accepts `subLayers`, `migrate-v17-focus-intent.ts` maps them, and R1b shows a save/reopen keeps them.
  - So the route exists only for projects saved by builds up to mid-July 2026, or for hand-edited or agent-written project JSON.
- **The harm reproduces when such a sub-pass exists** (R1b, `r1.log`). After Light marks, the override is `{"portrait:sub-1":null,"portrait":{negativeImage:true,…}}`:
  - the main pass burns 11.3 % of the dark quarter and 88.3 % of the light quarter;
  - the sub-pass burns 88.9 % and 11.6 % (the positive);
  - the union is 2,722 of 3,200 cells (85.1 %, against 50 % for one pass).
  - The dialog hint is unchanged ("Operation: Portrait. The preview and engraving settings apply to this operation for the selected photo."). Nothing in the dialog text matches sub-pass, sub-layer or another operation.
- **Severity:** a correct mechanism, but practically unreachable for current users, so P3. The same defect class is reachable today in one click; see T15R-P2-1.
- **Job Review does not show the conflict clearly** (R1a/R1b). The visible detail line of each card reads from the base operation:
  - both cards say "Floyd-Steinberg dither · 10 lines/mm · bidirectional", and neither shows "negative";
  - only the collapsed "Partial compiled summary" of the main card says "effective artwork override: … · negative", and the second card's summary has no "negative".
  - The job Preview canvas was not run (no browser).

### T15-P2-2: preview pass budget (R2, `r2.log`)
- **Mechanism confirmed independently.** Compiling a 1000×750 px photo at 200×150 mm and 10 l/mm with `compileRasterGroupsForLayer` gives one group of 2000×1500 at passes 1, 16, 17 and 40. Only the group's `passes` field changes.
  - `compiledRasterPreview` RGBA is **byte-identical** for 1 vs 17, 16 vs 17 and 1 vs 40.
  - Compile plus display took 668 / 611 / 654 / 717 ms, so it is flat in passes.
  - `computePhotoEngravingPreview` returns ok at 16 (scanPasses 16) and the error "This photo is too big to preview at this size and resolution…" at 17 and 40.
  - The preview the user is refused is exactly what it would have drawn at 16 passes.
- **Realistic pass counts:**
  - The only starter image preset (`neotronics-4040-presets.ts:44-60`, "Engrave 254 DPI") uses passes 1 (`BASE_RECIPE`).
  - ADR-685 portrait recipes never change passes (decision 2; `photo-recipes.ts` has no `passes`).
  - The dialog neither shows nor edits passes (R3: no "pass" text in the window). So the refusal names resolution and size and never the hidden cause.
- **First refused pass count, real plan (material view gives the same):**

| Photo | Burn grid | Refused from | 2 / 3 / 4 passes |
|---|---|---|---|
| 100×100 mm @ 254 DPI | 1.0 M | 51 | ok / ok / ok |
| 150×100 mm @ 254 DPI | 1.5 M | 34 | ok / ok / ok |
| 200×150 mm @ 254 DPI (auditor) | 3.0 M | 17 | ok / ok / ok |
| A4 @ 254 DPI | 6.2 M | 9 | ok / ok / ok |
| A4 @ 318 DPI | 9.75 M | 6 | ok / ok / ok |
| 300×225 mm @ 318 DPI | 10.6 M | 5 | ok / ok / ok |
| A4 @ 381 DPI | 14.0 M | 4 | ok / ok / **refused** |
| A4 @ 508 DPI | 25.0 M | 3 | ok / **refused** / **refused** |
| A3 @ 318 DPI | 19.5 M | 3 | ok / **refused** / **refused** |
| 100×100 mm @ 635 DPI | 6.25 M | 9 | ok / ok / ok |
| 150×150 mm @ 635 DPI | 14.1 M | 4 | ok / ok / **refused** |

- **Exposure:** never at 1 pass. At 2 passes it needs more than 25 M cells (about A4 above 500 DPI). At 3–4 passes it hits A4 at 381–508 DPI, A3 at 318 DPI and 150 mm at 635 DPI. Those are uncommon but real multi-pass photo jobs, and the advice ("lower the resolution") would change the burn needlessly.
- A **3D Sliced** photo (ADR-699: passes = slice count, typically 10–50) opened in this window previews as Jarvis at that pass count, so it hits the limit at small sizes (R2c: 30 passes at 200×150 mm is refused).
- **Not refuted:** the AREAS table puts "a refusal that should not happen" at P2, and the cost model is wrong for this preview. Cross-hatch and angle-step runs do compile one grid per angle, which this budget already distinguishes for bytes. R2c: 8 cross-hatch passes are still ok.

## Extra findings

### T15R-P2-1: A photo with a second operation (Add operation) gets Photo engraving on the first one only, silently; with Light marks it burns its negative and then its positive
- **Severity: P2.** This is a wrong burn the window does not warn about. It is reachable today in one click.
  - Not P1: the job Preview shows both passes' dots, and a near-uniform rectangle is likely to be noticed.
  - ADR-581 decision 7 sanctions picking "the first bound operation with output enabled and name it". It says nothing about disclosing the others.
  - The auditor noted this route as "READ ONLY, same class" and did not raise it.
- **Where:**
  - `src/ui/raster/photo-engraving-store.ts:43-52`: the first output operation is chosen.
  - `src/ui/raster/PhotoEngravingDialog.tsx:183-191`: the hint names only that operation.
  - `src/ui/raster/photo-engraving-apply.ts:80-115`: only `byOperation[operation.id]` is written.
  - The other route is `src/ui/layers/SelectedOperationInspector.tsx:161` (Add operation) → `clone-artwork-operations.ts:15-69`, which clones the photo's operation as "<name> 2", also mode image and output on.
- **Repro (ran):** `zz-t15r\r1.test.tsx` R1a, log `r1.log`.
  1. Photo A is an 80×40 px left-to-right gradient at 8×4 mm, on operation "Portrait" (FS, 10 l/mm, 1 pass).
  2. Call `addOperationForObjects(['A'])`, the action behind the inspector's Add operation button. The operations are now `portrait/"Portrait"` and `operation-A/"Portrait 2"`, both image with output on, and A's `operationIds` is `["portrait","operation-A"]`.
  3. Before Photo engraving, both groups burn 1,601 cells (dark quarter 88.9 %, light quarter 11.6 %), and the union is 1,601 of 3,200 (50 %).
  4. Run `openPhotoEngraving()` and render the dialog. It opens on "Portrait" with the hint quoted above, and its text never mentions "Portrait 2" or another operation.
  5. Choose "Light marks on a dark surface" and submit. The override becomes `{"operation-A":null,"portrait":{negativeImage:true,…}}`.
  - **Actual:** Portrait burns the dark quarter 11.3 % and the light quarter 88.3 % (negative). Portrait 2 burns 88.9 % and 11.6 % (positive). **The union is 2,722 of 3,200 cells (85.1 %).**
  - Job Review's visible detail lines are identical for both ("Floyd-Steinberg dither · 10 lines/mm · bidirectional"). "negative" appears only in the collapsed compiled summary of Portrait.
  - **Expected:** both burns of the photo follow the chosen marking, or the window says that "Portrait 2" also engraves this photo with its own marking, dither and DPI.
- **Oracle:** the gradient's dark/light quarters per compiled group, and ADR-581 decision 3's meaning of Light marks (invert the burn). One operation alone gives the 50 % baseline.
- **Suggested fix:** one fix covers this and T15-P2-1. When the photo has other enabled image burns (other bound operations with output on, or enabled image sub-passes), name them in the operation hint. Optionally offer "Apply to all image burns of this photo".

### T15R-P3-1: Photo engraving converts a 3D Sliced photo to Jarvis × its slice count without showing the pass count, even when Apply is pressed with nothing touched
- **Severity: P3.**
  - ADR-581 decision 2 says unsupported modes start with Jarvis, and the processing control shows Jarvis.
  - Total energy is unchanged on average: 32,000 cell-burns before and 31,980 after.
  - The relief does change character: graded depth becomes dither pits each burned 20 times.
  - The window never shows passes, and ADR-699 (3D Sliced, 2026-11-10) does not mention this window. One could argue P2 for stamp users.
- **Where:**
  - `src/ui/raster/photo-engraving-settings.ts:38-58` (`photoDither` falls back to jarvis);
  - `photo-engraving-apply.ts:167-186` (`matchesCurrentSettings` differs, so the untouched Apply writes);
  - `PhotoEngravingDialog.tsx` (no pass display).
- **Repro (ran):** `zz-t15r\r3.test.tsx`, log `r3.log`. The operation is "Deep photo": image, `3d-sliced`, 20 passes, 10 l/mm, with an 80×40 gradient.
  - **Before:** 20 groups of 1 pass each (slices). The darkest quarter averages 17.6 burns a cell and the lightest 2.4.
  - **Open and Apply with nothing touched:** one Undo entry, and the override becomes `{"mode":"image","ditherAlgorithm":"jarvis",…}`.
  - **After:** 1 group, passes 20. Every Jarvis dot is burned 20 times (darkest quarter mean 17.9, lightest 2.1).
  - The dialog text has no "3D", "slice" or "pass".
  - Job Review's visible detail line still reads "3D Sliced: 20 passes, one slice each, darker burned deeper". It describes the base operation, not what now burns.
- **Suggested fix:** list 3D Sliced as unsupported in this window (refuse, or say it will switch to a dither and burn N passes). Or keep it out of `matchesCurrentSettings` so an untouched Apply does not convert.

## Not a defect / limits
- **Job Review's detail line is built from the base operation, not the per-photo override** (`JobReviewOperations.tsx:106,203-208`). Only the collapsed compiled summary shows the effective override. This is cross-tool and likely by design (ADR-224 v3 cards plus ADR-317 overrides), so I did not raise it here. A Job Review owner should look at it, because it hides the conflicting settings in T15R-P2-1 and T15R-P3-1.
- **Not run:**
  - the job Preview canvas and any browser behaviour (memory gate, brief);
  - a real v0.1.x project file migrated forward. R1b shows a current-schema save/reopen keeps sub-layers, and the migration code (`migrate-v17-focus-intent.ts:23`) maps them.

## Totals
Verdicts: T15-P2-1 SEVERITY CHANGED to P3; T15-P2-2 CONFIRMED P2.
Extra raised: 2 (P1 0, P2 1, P3 1). T15R-P2-1 is the reachable form of the auditor's READ ONLY note. Known: 0; no earlier ledger entry was found for either.
