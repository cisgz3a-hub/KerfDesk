# Rolling audit v2 — Raster image processing

- **When:** 2026-10-21 23:00–2026-10-22 01:30 +0800   **Tree:** origin/main @ `902f1d0c0` (worktree
  HEAD `e07120cc6`, no `src/` difference; `git fetch` at the end still showed `902f1d0c0`).
- **Scope:** `src/core/raster/**` except `emit-raster*` (report 03), `src/core/image-adjust/**`,
  `src/core/image-resample/**`, `src/ui/raster/**`. Followed into the twins and entry points:
  - compile: `src/core/job/compile-job-raster.ts`, `compile-job-raster-stream.ts`,
    `raster-luma-decode.ts`, `raster-rotated-sample.ts` (read only; angles are report 03's)
  - previews: `src/ui/workspace/compiled-raster-preview.ts`, `draw-raster-preview.ts`,
    `raster-adjusted-display.ts`; export `src/ui/app/save-processed-bitmap.ts`
  - import luma: `src/ui/trace/image-loader.ts` (`extractLumaBase64`,
    `compositeRgbOverWhitePreservingAlpha`), `src/ui/import/png-row-luma-sampler.ts`,
    `png-decoded-row-consumer.ts`, `psd-import-preparation.ts`
  - adjustment writers: `src/ui/state/raster-adjustment-actions.ts`,
    `src/ui/layers/SelectedImageAdjustments.tsx`, `src/io/project/project-shape-validator.ts`

  Pipeline mapped: source decode (RGB composited over white, BT.601 luma) → `lumaBase64` →
  brightness → contrast → gamma (each rounded to a byte) → negative → area/centre resample to the
  burn grid → mask (burn grid; source grid when rotated) → machine orientation flips → dither on the
  machine grid → S values → emitter.

  Governing: ADR-020, ADR-028 (+ Amd 1), ADR-029, ADR-243, ADR-359, ADR-390 (consequences note),
  ADR-492, ADR-567, ADR-581, ADR-649. ADR-052, ADR-492 and ADR-567 emission clauses were audited in
  report 03. Prior audits: `docs/audits/rolling/2026-07-17-1050-perceptual-raster-fidelity.md`,
  `2026-07-17-burn-quality-findings-register.md` / `2026-07-17-laser-burn-quality-audit.md`
  (F11/BQ-14, F20, BQ-18), `2026-09-27-speed-quality-remediation.md`.
- **Lenses run:** L1, L2 (primary sources fetched; see below), L3, L4, L7 as separate passes; L5 on
  the two untrusted inputs in scope (`.lf2` adjustment fields, Adjust Image preset files); L6 light
  (decode and worker error paths). Repros were temporary `zz-20-*.test.ts` files (deleted), run one
  file at a time on images no larger than 96 × 96 px.
- **Counts:** 4 raised → refuter: 4 confirmed / 0 plausible / 0 refuted → P1 0 / P2 0 / P3 4
  (+ 6 KNOWN re-observed). No severity changes; the refuter ruled P3-1 on P1/P2 explicitly and
  kept P3.

## Headline

The dither algorithms are right. All eight fixed kernels, the Bayer 4 × 4 matrix and all 128
Ostromoukhov rows behind Blue Noise match their published values; the Ostromoukhov table was
diffed row by row against the paper's own Appendix I. Serpentine scanning, edge handling,
streamed-equals-full and mean tone (within 0.007 on flat fields for every diffusion kernel except
Atkinson, whose clipping is documented) all hold. The previews that matter (job Preview, Photo
engraving) consume the compiled raster, so they equal the burn by construction.

What remains is small and mostly about adjustment inputs:
- A non-finite brightness or gamma resolves to the darkest setting, not the neutral one.
- A `.lf2` can carry a contrast of −200, which inverts the burn.
- No test pins any dither table to its published values.
- Image Studio and the engrave stage give "Brightness"/"Contrast" with the same range different
  curves.

Re-observed and still open: the exported processed bitmap is dithered on a different grid
orientation from the burn (F20). Byte-proportional coverage is the tone model that ADR-390 left
out of scope.

## Findings

### P3-1 — A non-finite brightness, contrast or gamma resolves to the darkest setting (full burn), not to neutral

- **Where:**
  - `src/core/raster/luma-adjust.ts:10-24`: `?? 0` / `?? 1` let NaN through. `clampByte(NaN)`
    stays NaN, and a `Uint8Array` stores it as 0, which is black and burns at full power.
  - `src/ui/state/raster-adjustment-actions.ts:94-96`: `clamp` maps a non-finite value to `min`,
    so brightness becomes −100 (solid black) and gamma becomes 0.1 (darkest).
  - `src/ui/raster/AdjustImageDialog.form-utils.ts:3-5`: `numberValue` falls back to `min`. It
    runs on the initial draft and on every applied preset (`AdjustImageDialog.tsx` `normalizeDraft`).
  - `src/ui/raster/AdjustImageDialog.user-presets.ts:218-220`: `typeof … === 'number'` admits
    `Infinity`, which a preset file can carry as a JSON literal such as `1e999`.
- **Anchor:** Twin.
  - `SelectedImageAdjustments.tsx` falls back to the neutral `fallback` (0 / 0 / 1).
  - The Adjust Image `NumberField` falls back to the current value.
  - ADR-390 §4 made the same choice for Photo shading: "A cleared Midtones field returns to 1
    rather than clamping 0 to its darkest setting."
- **Scenario:**
  1. A shared Adjust Image preset file contains `"brightness": 1e999, "gamma": 1e999`. Import
     accepts it.
  2. Choosing the preset sets Brightness −100 and Gamma 0.1.
  3. The whole photo burns solid black at full power. The dialog's processed pane does show
     black.
  4. Any NaN that reaches `applyLumaAdjustments` or the store action behaves the same way.

  Today's typed fields cannot produce this: they guard to neutral or keep the current value. So
  this is reachable only through a preset file or a future caller.
- **Evidence:** REPRO (temp Vitest, deleted).
  - `applyLumaAdjustments([0,64,128,192,255], {brightness: NaN})` → `0,0,0,0,0`; the same for
    `contrast: NaN` and `gamma: NaN`.
  - `importUserImagePresetsFile` → `kind=ok`, stored `brightness=Infinity gamma=Infinity`.
  - The dialog normalizes these to `brightness=-100 gamma=0.1`.
  - `numberValue('NaN', -100, 100)` → `-100`.
- **Refuter:** CONFIRMED, severity stays P3. Reproduced end to end in the real dialog: preset file
  → Import (mock platform) → choose preset → OK → `compileJob`, 4 × 1 image `[0, 60, 200, 255]`,
  Threshold, 100 %. `1e999` and `-1e999` both become fields −100 / 0.1 and burn `S 1000 ×4`
  (baseline `1000,1000,0,0`). The Processed pane draws luma `0,0,0,0` before OK.
  - Why not P1: nothing fires unexpectedly. The operator imports, chooses the preset, sees black
    in the Processed pane, on the canvas and in the job Preview, then presses OK and Start.
  - Why not P2: an ordinary user cannot hit it. KerfDesk's own Export cannot write `Infinity`:
    `JSON.stringify` gives `null`, and Import refuses that file as damaged. The imported preset is
    also stored as `null`, so it is gone when the dialog next opens (re-read count 0). Only a
    hand-edited file reaches it, and only during the import session.
  - The bug adds no new power to a crafted file. A valid preset with brightness −100 and gamma 0.1
    is accepted and burns the identical `S 1000 ×4`. The defect is only the direction of the
    fallback: `+1e999` means "brightest" and gives the darkest result.
  - Job Review does not warn about an all-black raster: no preflight or review check looks at
    raster tone. That is equally true of a legitimate −100, so it does not raise this finding.
- **Fix direction:** Map non-finite values to the neutral value (0 / 0 / 1) in all three places.
  Require `Number.isFinite` in `isImagePresetSettings`. Add a finite guard in
  `applyLumaAdjustments`.

### P3-2 — A `.lf2` loads any finite brightness or contrast; contrast below −100 inverts the burn

- **Where:**
  - `src/io/project/project-shape-validator.ts:328-330`: `optionalNumber` checks only that the value
    is finite.
  - `src/core/raster/luma-adjust.ts:16-19`: brightness and contrast are not clamped (gamma is,
    at `:21`). `factor = 1 + contrast/100` is negative below −100.
- **Anchor:** Contract and Twin.
  - Contract: `scene-object.ts:382-384` documents −100..100, −100..100 and 0.1..5.
  - Twin: every UI writer holds those ranges (`raster-adjustment-actions.ts:86-92`,
    `photoEngravingPatchIsValid`, the Adjust Image normalizer).
- **Scenario:** A third-party or hand-edited `.lf2` gives an image `contrast: -200`. It loads, and
  dark areas stop burning while light areas burn at full power. `brightness: 1e6` loads and burns
  nothing.
  - The canvas adjusted display uses the same curve, so the inversion is visible on screen.
  - Opening Adjust Image and pressing OK silently rewrites it to −100, a flat 50 % grey.
- **Evidence:** REPRO (temp Vitest through `serializeProject` → raw edit → `deserializeProject` →
  `compileRasterGroupsForLayer`, Threshold, 4 × 1 image `[0, 60, 200, 255]`):
  - `{}` → `S 1000,1000,0,0`
  - `{"contrast":-200}` → `0,0,1000,1000`
  - `{"brightness":1000000}` → `0,0,0,0`
  - `{"contrast":-150,"brightness":20}` → `0,0,1000,1000`
  - All four loaded with `kind: 'ok'`.
- **Refuter:** CONFIRMED, P3. Repro of my own through `serializeProject` → raw edit →
  `deserializeProject` → `compileJob`, using the same image, gave the auditor's four results
  exactly. `contrast: 500` also loads (`1000,1000,0,0`).
  - Through `applyLumaAdjustments`, which the canvas adjusted display uses
    (`raster-adjusted-display.ts:58`), the curve for −200 is `255,196,56,1`, so the screen shows
    the inversion.
  - `brightness: 1e6` burns the same as the valid +100. Contrast below −100 is the only
    out-of-range value that gives a burn no in-range setting can give, and Negative Image comes
    close to it.
  - Out-of-range gamma (`0`, `-5`, `1e6`) also loads, but compile clamps it to 0.1..5, so gamma is
    within the contract.
  - Reaching it needs a hand-edited `.lf2`. Every UI writer clamps.
- **Fix direction:** Validate the documented ranges on load, or clamp brightness and contrast in
  `applyLumaAdjustments` as gamma already is.

### P3-3 — (L7) No test pins any dither table to its published values; ADR-649 overstates the table test

- **Where:**
  - The tables: `src/core/raster/dither.ts:302-416` (eight kernels and `BAYER_4X4`) and
    `dither-blue-noise-tables.ts:13-142`.
  - The tests:
    - `dither.test.ts:145-165` asserts only black/white invariants, binary output and determinism.
    - `dither-rows.test.ts` asserts streamed == full.
    - `dither-blue-noise.test.ts:19-33` checks that the Ostromoukhov table has 128 rows of
      non-negative integers with a positive sum. It checks no values.
- **Anchor:** Contract. ADR-649, Verification and limits: "Unit tests cover the published table".
  Ground truth: the published kernels and the Appendix I table (see Verified clean).
- **Scenario:** Any of these transcription slips would leave every dither test green:
  - a divisor typo (Jarvis 46), a swapped weight or a mirrored offset;
  - a Bayer entry;
  - an Ostromoukhov row with two columns swapped.

  Error-diffusion kernels conserve tone only approximately anyway, so the tone-tracking and
  perceptual tests would not reliably catch a small slip. All values are correct today.
- **Evidence:** READ (tests) + SOURCE (values verified below).
- **Refuter:** CONFIRMED, with a correction to the scenario. I ran a mutation test with a temporary
  test file that imported `dither.test`, `dither-rows.test`, `dither-blue-noise.test` and the
  perceptual `dither-texture` and `raster-photo-fidelity` tests. The kernels were edited at run
  time through `errorDiffusionKernel()`, and an Ostromoukhov row was swapped before the level
  tables were built.
  - Three slips together left all 76 tests green: Jarvis ÷ 46, Floyd–Steinberg's next-row 3 and 1
    swapped, and Ostromoukhov row 20 columns swapped.
  - Some slips are caught, but only by chance:
    - Swapping Floyd–Steinberg's 7 and 5 fails the 1 × 3 test `dither-rows.test.ts:40-55`.
    - Mirroring Stucki's ahead tap, and swapping Ostromoukhov row 16, fail `dither-texture`. That
      test samples only greys 16, 32, …, 240.
  - Rows 49–127 of the Ostromoukhov table are never read at run time (the tables file comment
    says so). A slip there cannot change a burn.
  - `BAYER_4X4` is module-private, so its values could not be mutated and were checked only by
    reading.
- **Fix direction:**
  - Pin each kernel's offsets, weights and divisor, and the Bayer thresholds, to the published
    matrices.
  - Pin the 128 Ostromoukhov rows, for example the full table or spot rows plus a checksum.

### P3-4 — Two "Brightness" / "Contrast" controls with the same −100..100 range apply different curves

- **Where:** The engrave-stage `src/core/raster/luma-adjust.ts:16-19` (brightness × 2.55 luma;
  contrast factor `1 + c/100`) and Image Studio's `src/core/image-adjust/tone-luts.ts:15-25`
  (brightness ±128 luma; contrast slope `tan`).
- **Anchor:** Twin. Both model "Brightness / Contrast, −100..100":
  - engrave stage: `SelectedImageAdjustments.tsx`, Adjust Image and Photo engraving;
  - Image Studio: Brightness / Contrast, `editor-adjustments.ts:80-81`.
- **Scenario:** The same setting gives different results in the two tools.
  - Brightness 50 at the engrave stage: 64→192 and 128→255. In Image Studio: 64→128 and 128→192.
  - Contrast 50 at the engrave stage: slope 1.5 (64→32, 192→224). In Image Studio: slope 2.41
    (64→0, 192→255).

  An operator who finds "Brightness 20" right in one tool gets twice (or half) the shift in the
  other.
- **Evidence:** REPRO (temp Vitest): `engrave b50=192,255,255 studio b50=128,192,255 engrave
  c50=32,128,224 studio c50=0,128,255` for inputs 64, 128, 192.
- **Refuter:** CONFIRMED as fact, P3 polish. I worked the numbers by hand from both sources:
  - `luma-adjust.ts:16-19`: +2.55 per step; factor `1 + c/100`.
  - `tone-luts.ts:16-25`: offset `b/100 × 128`; slope `tan((c+100)/200 · π/2)`, which is 2.414 at
    50.

  Both give the auditor's values exactly.
  - The anchor is weaker than "twin" implies. Each control follows a different reference:
    `tone-luts.ts` declares "Photoshop-legacy" and is a destructive per-channel RGB edit, and the
    engrave stage is a non-destructive luma adjustment. No ADR records either choice or the
    difference.
  - The likely fix is a hint on each control, not merging the two curves.
- **Fix direction:** Choose one convention and use it in both places, or say in each control's
  hint what a step does. Image Studio documents "Photoshop-legacy"; the engrave stage documents
  nothing.

## KNOWN re-observed (still open on `902f1d0c0`)

- **K-1 (F20, 2026-07-17 register):** the dot pattern in **Save Processed Bitmap** differs from
  the burn.
  - `src/ui/raster/processed-bitmap.ts:93` dithers the image-oriented grid. Compile flips to
    machine orientation first, then dithers (`compile-job-raster.ts:326-336`).
  - The canvas preview has since moved to the compiled group, so only the export remains.
  - Re-measured (temp Vitest): 40 × 30 noisy gradient, default front-left origin, compiled rows
    un-flipped. The Threshold control differs in 0 px. The other modes differ by:

    | Mode | Differing pixels (of 1200) |
    |---|---|
    | Jarvis | 464 |
    | Floyd–Steinberg | 511 |
    | Blue Noise | 534 |
    | Ordered | 785 |

    Burned counts agree within 6, so tone matches and placement does not.
  - The code comment "The bitmap `image` burns as on `operation`" and ADR-359 §1 ("the image-export
    … previews use the same resampler and kernel, so they match the burn") claim more than this.
    LightBurn's Save Processed Bitmap saves the image with "any dithering mode applied"
    (docs.lightburnsoftware.com/latest/Reference/SaveProcessedBitmap/).
- **K-2 (BQ-14 / F11):** `luma-adjust.ts:15-26` rounds to a byte after each of brightness,
  contrast and gamma. Brightness 10 + contrast 30 + gamma 1.4 leaves 181 of 256 levels.
- **K-3 (BQ-18):** Grayscale maps luma 255 to S0 whatever Min Power is set to (`dither.ts:122,
  210`).
  - Re-checked against LightBurn's developer (forum, 2020-03-19): "White is engraved at whatever
    the Min Power setting is"; transparency is the way to leave an area blank.
  - It is still flagged "confirm intent", not as a defect.
- **K-4 (ADR-390, Consequences):** the Image-mode dithers set dot coverage from the sRGB bytes.
  - Measured: luma 128 burns 49.8–50.0 % dots in every diffusion mode.
  - ADR-390's Murray–Davies derivation needs 78.4 %. Wikipedia's Floyd–Steinberg article says
    values "should be linearized first".
  - ADR-390 explicitly left this out of scope. Photo engraving (ADR-581) and Blue Noise (ADR-649)
    inherit it. This needs a maintainer decision, not a new finding.
- **K-5 (ADR-581, Context):** the Adjust Image "Processed" pane dithers a thumbnail of at most
  420 px, not the burn grid (`AdjustImageDialog.preview.ts:65-74, 127-143`). The Photo engraving
  dialog fixes this for its own flow only.
- **K-6 (03-P3-4):** `pixelExtentForMm` rounds each axis to whole cells; 0.25 mm at 10 lines/mm
  gives 3 px (0.0833 mm).

## Refuted

- **Grey+alpha (PNG colour type 4) misread by the qualified luma sampler** (`channels: 1 | 3 | 4`).
  Refuted: `sampleFallbackReason` qualifies only 8-bit types 0, 2 and 6. Types 4, 16-bit,
  palette and interlaced PNGs fall back to the browser route, which composites over white.
- **Streamed error diffusion replays O(H²·W) under the rotary `descending-y` order.** Refuted:
  every consumer pulls provider rows in ascending provider order: `emit-raster`
  `inputRowsInProviderOrder`, `rasterRowsInProviderOrder` and the Image Studio run-loss scan. The
  previews compile without the rotary transform.
- **Negative Image burns a transparent background.** Not a defect: transparency is stored as white
  luma, so Negative burns it. LightBurn users report the same and are told to flatten or trace
  (forum "Newbie needs help", "Difficulty engraving a negative image").
- **`fitDecodeToStoredGrid` turns transparent pixels black** (`resampleBuffer` writes `0,0,0,0`
  for alpha 0 while `rgbCompositedOnWhite` is kept, and `extractLumaBase64` ignores alpha).
  Dropped as unreachable in practice: it runs only for pre-ADR-404 grids transposed by EXIF
  Orientation, which are JPEGs and have no alpha.
- **Stale preview cache.** The key (`draw-raster-preview.ts:158-167`) covers every setting that
  changes the S grid: adjustments, negative, pass-through, dither, power range, density, grid,
  scan angle, transform, origin, bed and mask geometry. `controllerKind` is missing but changes
  only grayscale quantization (1/255 versus 1/1000), which is below display resolution.

## Verified clean

- **Fixed kernels (L2):**
  - Floyd–Steinberg 7/3/5/1 ÷ 16 (Wikipedia, citing Floyd & Steinberg 1976).
  - Jarvis–Judice–Ninke ÷ 48, Stucki ÷ 42, Burkes ÷ 32, Sierra-3 ÷ 32, two-row Sierra ÷ 16,
    Sierra Lite ÷ 4.
  - Atkinson six taps of 1/8, deliberately dropping 2/8. This and the previous line were checked
    against tannerhelland.com, "Dithering: eleven algorithms", tap by tap.
  - Probe: weight sums equal the divisors (Atkinson 6/8).
- **Bayer:** the thresholds equal (M + ½) × 16 for the standard M₄ `[0 8 2 10; 12 4 14 6; 3 11 1 9;
  15 7 13 5]` (Wikipedia, Ordered dithering). Luma 128 gives 8 of 16; 0 burns all and 255 none.
- **Ostromoukhov (ADR-649):**
  - Sources: the paper's PDF was text-extracted with pdfjs, and the Appendix I rows
    ("i : A10 A−11 A01") were diffed against `dither-blue-noise-tables.ts`. 128 of 128 rows are
    identical, and libpipi's `ostromoukhov.c` table is identical too.
  - Column order ahead / behind-below / below and the A4 mirroring above 127 are correct.
  - Weights are chosen by the original input level, as in the paper ("for each of the 256 input
    intensity levels"). The threshold is fixed at 128 for g ≤ 48 and g ≥ 207. The key levels join
    the published row 48.
  - Zhou & Fang's tables are closed-access, and ADR-649 claims none of their numbers.
- **Scan and edges:** serpentine on odd rows with mirrored offsets, error leaving the image dropped
  (as libpipi does), Float32 accumulators shared by both paths.
- **Streamed == full:** for 1 × 1, 1 × 7, 7 × 1 and 2 × 3 grids in all nine diffusion modes (temp
  probe), on top of the existing 301 × 77 property test.
- **Tone on 96 × 96 flat fields at 16 levels:**

  | Mode | Worst \|error\| |
  |---|---|
  | Grayscale | 0.000 |
  | Blue Noise | 0.003 |
  | Floyd–Steinberg, Sierra Lite | 0.004 |
  | Burkes | 0.005 |
  | Sierra-2 | 0.006 |
  | Jarvis, Stucki, Sierra-3 | 0.007 |

  - The extreme-highlight shortfall is the ordinary error-diffusion start-up transient: Jarvis,
    Stucki and Sierra-3 place no dot at luma 254 within 96 px.
  - Atkinson clips at ≤ 32 and ≥ 224, as its picker text says ("The darkest and lightest tones turn
    solid").
  - Ordered has 17 levels.
- **Boundary inputs:**
  - 1 × 1 at 0, 100, 127, 128, 200 and 255 in all 12 modes: black burns, white does not, and
    127/128 split at the 128 cutoff. Blue Noise's 128 depends on the position hash.
  - 1-row and 1-column fields hold 50 % at luma 128.
  - All-white and all-black hold in every mode.
  - An empty or short luma source resamples to white.
  - Corrupt `lumaBase64` is refused by compile, with a `raster-source-luma-mismatch` diagnostic or
    a throw.
  - The validator caps sources at 256 M pixels; compile streams above 4 M burn pixels; the
    processed export is budgeted.
- **Resampling:**
  - Area means are exact (6 → 4: 85, 255, 0, 170).
  - Upscaling takes the centre sample at (t + ½)·src/tgt (2 → 5: 0, 0, 255, 255, 255).
  - Non-square grids work, as in 3 × 2 → 2 × 3.
  - Threshold keeps the nearest sample (ADR-359 §2).
  - The mask is tested at pixel centres (x + ½) before orientation in both the materialized and
    the streamed path.
- **Luma and alpha:**
  - BT.601 is stated (`scene-object.ts`) and used, on gamma-encoded RGB. That is Rec. 601 luma Y′
    by definition (Wikipedia, Luma (video)).
  - Alpha is composited over white in the canvas `getImageData` route
    (`compositeRgbOverWhitePreservingAlpha`), the qualified PNG route (including tRNS key colour)
    and PSD import.
  - 16-bit, palette and grey+alpha PNGs use the browser route.
  - Transparent areas never burn unless Negative is on (see Refuted).
- **Twins (L3):**
  - The job Preview (`draw-raster-preview.ts` → `compiledRasterPreview`) and the Photo engraving
    preview both consume the compiled `RasterGroup`.
  - Display reduction averages blocks (ADR-028 Amd 1).
  - The canvas adjusted tone uses the same curve and honours Pass-Through (ADR-359 §6).
  - The Photo engraving Apply writes exactly the previewed settings (ADR-581 §7).
- **Other modules:**
  - Stamp distance transform: exact against brute force in 30 random anisotropic cases (max error
    2.2e-16 mm).
  - BMP encoder: header, 4-byte stride, bottom-up rows, BGR order, white matte.
  - Halftone: dot area = ink · s²; holes on the dual grid above 50 %; line width = ink · s.
  - DPI ↔ lines/mm: `toFixed(6)`, about 1e-8 relative error.
- **Novelty:** no open PR touches the files behind P3-1 to P3-4. Open PRs #1349 and #1351 touch
  only `controller-power-scale.ts`; #1346 touches only `PhotoEngravingDialogHost.tsx`.

## Not verified

- No material burn, air-cut or controller run. The tone and texture results are statistics of the
  binary pattern on the burn grid, not burned samples, so dot gain is not modelled.
- No browser run. Real decodes of 16-bit, CMYK, EXIF-rotated and very large images were traced in
  code only.
- Convert to Bitmap assembly, stamp UI and Image Studio filters other than halftone, LUTs and
  brightness/contrast (area 23). The existing fidelity tests were not re-run.
- Rotated and angled-scan sampling accuracy (bilinear on the reduced grid) was read but not
  measured; report 03 covers the angles.
- LightBurn's numeric conventions for brightness, contrast and gamma: no primary source found.
  ADR-581 already says that gamma differs.
- Zhou & Fang 2003 tables (closed access); ADR-649 does not use them.
- Performance at large sizes was deliberately not run (shared machine).

```json
[
  {"id":"P3-1","severity":"P3","area":"raster","file":"src/core/raster/luma-adjust.ts","line":10,"anchor":"Twin: SelectedImageAdjustments neutral fallback, Adjust Image NumberField keeps current value; ADR-390 s4 cleared Midtones returns to 1","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Reproduced via real dialog Import -> preset -> OK -> compileJob: 1e999 and -1e999 burn S1000 x4, Processed pane black; a valid -100/0.1 preset burns identically and KerfDesk Export cannot write Infinity; P3 kept (not P1: visible, operator-driven; not P2: hand-edited file only)","known":false,"summary":"Non-finite brightness/contrast/gamma resolves to the darkest setting (luma 0, or brightness -100 / gamma 0.1) instead of neutral; an imported preset file with 1e999 sets the photo to solid full-power black"},
  {"id":"P3-2","severity":"P3","area":"raster","file":"src/io/project/project-shape-validator.ts","line":328,"anchor":"Contract: scene-object.ts documented ranges (-100..100, 0.1..5); Twin: every UI writer clamps","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own .lf2 round-trip repro matches; canvas curve shows inversion; brightness 1e6 equals valid +100; gamma clamped at use; P3 kept","known":false,"summary":".lf2 loads any finite brightness/contrast; contrast -200 inverts the burn (black stops, white burns full power), brightness 1e6 burns nothing"},
  {"id":"P3-3","severity":"P3","area":"raster","file":"src/core/raster/dither.ts","line":302,"anchor":"Contract: ADR-649 Verification 'Unit tests cover the published table'; Ground truth: published kernels, Bayer M4, Ostromoukhov 2001 Appendix I","evidence":"READ","verdict":"CONFIRMED","refuter":"Mutation run: Jarvis /46, FS next-row 3<->1 swap, Ostromoukhov row 20 swap keep 76 dither/perceptual tests green; FS 7<->5, Stucki mirrored ahead tap and row 16 swap are caught incidentally; rows 49-127 unused at run time","known":false,"summary":"No test pins the 8 fixed kernels, the Bayer matrix or the 128 Ostromoukhov rows to their published values; a transcription slip would keep every dither test green"},
  {"id":"P3-4","severity":"P3","area":"raster","file":"src/core/raster/luma-adjust.ts","line":16,"anchor":"Twin: src/core/image-adjust/tone-luts.ts brightnessContrastLut (Image Studio Brightness/Contrast, same -100..100 range)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Values re-derived by hand from both sources; anchor weak (Photoshop-legacy vs engrave-stage conventions), hint-text polish","known":false,"summary":"Engrave-stage and Image Studio Brightness/Contrast use different curves for the same numbers (Brightness 50: +128 vs +64 luma; Contrast 50: slope 1.5 vs 2.41)"},
  {"id":"K-1","severity":"P3","area":"raster","file":"src/ui/raster/processed-bitmap.ts","line":93,"anchor":"Twin: compile-job-raster.ts orients then dithers; ADR-359 s1; LightBurn Save Processed Bitmap","evidence":"REPRO","verdict":"PENDING","known":"2026-07-17 burn-quality register F20 (residual in Save Processed Bitmap)","summary":"Saved processed bitmap is dithered on the image-oriented grid; 39-65% of pixels differ from the burned dots (tone equal)"},
  {"id":"K-2","severity":"P3","area":"raster","file":"src/core/raster/luma-adjust.ts","line":15,"anchor":"Contract: continuous curve","evidence":"REPRO","verdict":"PENDING","known":"2026-07-17 BQ-14 / F11","summary":"Brightness, contrast and gamma each round to a byte; stacked adjustments leave 181 of 256 levels"},
  {"id":"K-3","severity":"P3","area":"raster","file":"src/core/raster/dither.ts","line":210,"anchor":"Ground truth: LightBurn developer forum 2020-03-19 'White is engraved at whatever the Min Power setting is'","evidence":"SOURCE","verdict":"PENDING","known":"2026-07-17 BQ-18 (confirm intent)","summary":"Grayscale maps white to S0 regardless of Min Power"},
  {"id":"K-4","severity":"P3","area":"raster","file":"src/core/raster/dither.ts","line":251,"anchor":"ADR-390 Consequences (out of scope note); Ground truth: Wikipedia Floyd-Steinberg 'should be linearized first'","evidence":"REPRO","verdict":"PENDING","known":"ADR-390 Consequences","summary":"Image-mode dithers set coverage from sRGB bytes (luma 128 -> 50% dots) where ADR-390's model needs 78.4%; maintainer decision"},
  {"id":"K-5","severity":"P3","area":"raster","file":"src/ui/raster/AdjustImageDialog.preview.ts","line":65,"anchor":"ADR-581 Context","evidence":"READ","verdict":"PENDING","known":"ADR-581 Context","summary":"Adjust Image processed pane dithers a <=420 px thumbnail, not the burn grid"},
  {"id":"K-6","severity":"P3","area":"raster","file":"src/core/raster/luma-resample.ts","line":37,"anchor":"Twin: raster-units.ts interval claim","evidence":"REPRO","verdict":"PENDING","known":"03-P3-4","summary":"Per-axis whole-cell rounding: 0.25 mm at 10 lines/mm burns 3 px (0.0833 mm pitch)"}
]
```
