# Quality audit Q1 — Raster geometry

- **When:** 2026-10-27 23:45 – 2026-10-28 01:30 +0800
- **Tree:** origin/main @ `09f7c0087`.
  - The audit worktree HEAD is `ce09bbf18`. `git diff` from it to `09f7c0087` is empty for every file the repros load: `src/core/job`, `src/core/raster`, `src/core/raster-output`, `src/core/scene`, `src/core/devices`, `src/core/output`, `prepare-output.ts`, `emit-gcode.ts`, the raster Preview files and `src/__fixtures__/perceptual`. Its only `src/ui/laser` differences are CNC recovery and power-scale files.
  - A fetch at the end showed origin/main at `ef910deb6`. `git diff 09f7c0087 ef910deb6` is empty for the same raster files.
- **Scope:** where every burned pixel lands, from the stored source luma, through compile and emit, to a simulated burn. Files:
  - grid and resampling: `src/core/job/compile-job-raster.ts`, `raster-rotated-sample.ts`, `raster-bounds.ts`, `src/core/raster/luma-resample.ts`, `raster-scan-frame.ts`;
  - emission: `emit-raster*.ts`, `raster-sweep-plan.ts`, `src/core/raster-output/*`, `src/core/job/scan-offset.ts`, `job-bounds.ts` (placement);
  - Previews: `src/ui/workspace/draw-raster-preview*.ts`, `compiled-raster-preview.ts`, `src/core/job/toolpath-raster-steps.ts`;
  - advisories: `src/ui/laser/job-intent-warnings.ts`, `raster-threshold-warnings.ts`, `scan-quality-warnings.ts`;
  - Image Studio resize: `src/core/image-resample/*`, read only.
  - Governing decisions: ADR-028, ADR-052 with Amd 1, ADR-359, ADR-492 and ADR-495.
- **Lenses run:**
  - **L3 (twins):** Preview against G-code, upright against rotated, pass-through against resampled, canvas against burn.
  - **L4 (adversarial geometry):**
    - non-integer DPI ratios;
    - rotations of 0, 5, 10, 20, 37, 45, 60, 90 and 180°, and mirror;
    - negative non-uniform scale;
    - scan angles of 37° and 90°;
    - front-left, front-right and centre origins;
    - fractional placement;
    - bidirectional scanning with a modelled firing lag;
    - overscan of 0 mm, 5 mm and auto;
    - Dot Width Correction;
    - registration with a vector outline.
  - **L2:** LightBurn sources fetched (cited below).
  - **L1** came only through the cited ADR clauses and UI text. **L5** and **L6** are out of scope.
- **Counts:** 5 raised → 0 refuted → P1 1 / P2 1 / P3 3 (+ 8 KNOWN re-observed). Refuter (2026-10-28, fresh context, same tree; `git diff 09f7c0087 ef910deb6` empty for the raster files): 5 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity changes. One scorecard number corrected (pass-through at exactly 45°, see Q2-P1-1).

## Method: independent burn simulator

1. **Generator.** A temporary Vitest file (`src/core/job/zz-q2-gen.test.ts`, deleted) built 52 projects. It ran each through the shipping `prepareOutput` → `emitPreparedGcode` path, with no placement (Absolute) and the default 400 × 400 front-left profile unless stated otherwise. It wrote the G-code, the design (source luma, bounds, transform, origin) and the compiled raster group to the scratchpad.
2. **Simulator.** `zz-q2-sim.mjs` (scratchpad, deleted) imports nothing from KerfDesk.
   - **Interpreter:** a modal G-code reader (G0/G1, G90/G91, G20/G21, M3/M4/M5, S, X, Y).
   - **Burn:** every lit G1 with S > 0 deposits dose S/Smax along the move on a 0.01 mm grid. The grid is blurred by a Gaussian spot of FWHM 0.1 mm and normalised so that a solid full-power area at the requested line interval reads 1.
   - **Lag model (optional):** each burn is shifted along its own travel by a fixed distance (`--lag`).
3. **Scoring.** The burn is resampled back into source-pixel coordinates through an independent re-statement of `applyTransform` (scale → mirror → rotate → translate) and the origin transform. It is compared with the ideal: the source darkness as box pixels, blurred by the same spot.
   - Per-feature position: centroids of 1 px lines at known columns 4, 13, 25, 38, 49, 59 and rows 6, 18, 31, 45, 57. This target is irregular, like a ruler.
   - Global registration: normalised cross-correlation (NCC) shift at 0.01 px resolution.
   - Scale: slope of measured against design positions.
   - SSIM: per source pixel, with an 11 × 11 Gaussian window. It is reported twice: after the spot blur only, and after an extra 0.2 mm "eye" blur.
   - Preview twin: the compiled group painted where `drawMachineRasterBitmap` draws it, compared with the G-code burn by NCC on the 0.01 mm grid.
4. **Sanity check.** The 1:1 upright case scores 0.000 px on every line, NCC shift 0 and SSIM 0.9922. This shows that the simulator, the ideal and the transform re-statement agree.
5. **Targets:** a 64 × 64 line ruler, a 32 × 32 one-pixel checkerboard, and a 64 × 64 crop of `src/__fixtures__/perceptual/assets/astronaut.png` (source x 190, y 70; luma via `photoLuma`).
6. **Second repro.** A temporary Vitest file (`zz-q2-repro.test.ts`, deleted) ran the pass-through angle sweep, the Threshold decimation sweep and the upsample-advisory check. It also called the real `detectJobIntentWarnings` and `prepareOutput` preflight.
7. **Runs and memory.** Every run was one file at a time with `node ../../../node_modules/vitest/vitest.mjs run <file>`. No image was larger than 64 × 64 px, and no burn grid larger than 160 × 160 cells.

## Headline

**The geometry of an ordinary image burn is exact.** At 1:1 the following all burn every 1 px feature within 0.04 px (0.004 mm) of where the canvas draws it: upright, 90°, 180°, mirrored, a 37° rotation, 37° and 90° scan angles, three origins and fractional placement.
- At 1:1 there is no half-pixel bias, and the scale error is 0.00 % (±0.05 % at 37°).
- A vector outline on the image's bounds registers to 0.000 mm.
- Preview places every pixel where the G-code burns it: 0.000 mm in every scenario without a layer scan offset (50 of 52).
- Resampling to a non-integer line density stays inside its quantisation limit of ±½ burn cell; the worst case is 0.31 cell.

**The one geometry defect that changes the burn (Q2-P1-1) is pass-through at an angle.** "Use original pixels" on an image rotated by any non-quarter angle, or scanned at such an angle, keeps the source's pixel count but spreads it over the rotated bounding box.
- The rows are 1.08× (5°) to 1.41× (45°) further apart than the image's pixels.
- 15–64 % of the source pixels are never burned.
- A pre-dithered 50 % grey burns as about 36 % at 37° (and at 30°, 44° and 46°). At exactly 45° the cell centres land on pixel corners, so the result depends on where the image sits: 18 % to 71 % across six placements (refuter), with up to 43 of 64 rows left blank.
- No warning is shown. The UI says pass-through "keeps original pixels and density", and LightBurn's documentation says a pass-through image cannot be rotated.

**Two advisories mislead about resampling.**
- **Q2-P2-1:** every non-quarter rotated image gets the "engrave will be softer … lower lines/mm" upsample warning, even when the source is denser than the burn grid.
- **Q2-P3-1:** the Threshold decimation warning is silent between 1× and 2× source density, where 16 % (300 DPI) to 51 % of 1 px lines vanish.

**Bidirectional registration.** In the lag model the zipper cancels exactly with a calibrated offset. The image then sits half the measured separation off its vector outline, which is KNOWN as D8-P3-1.

## Scorecard

Simulated burn with a 0.1 mm spot. Positions are in source pixels (0.1 mm unless stated) and in mm; "cell" means one burn cell. Each row lists its verdict first, then the KerfDesk measurement, then the reference value and a short explanation.

**Position of known features at 1:1** (upright, rot 90/180, mirror X, front-right and centre origins, fractional placement at X 50.37 / Y 80.63).
- **Verdict:** Exact.
- **KerfDesk:** mean 0.000 px, max 0.000 px.
- **Reference:** 0 (ideal).
- **Refuter spot-check:** holds. Six isolated dark pixels, a separate G-code reader and its own restatement of `applyTransform` and the four corner origins: 0.0000 px mean and max in all 32 cases (rotations 0/90/180/270, mirror X, mirror Y, 50.37 / 80.63 placement, 90° + mirror X; front-left, front-right, rear-left, rear-right). The centre origin was not re-checked.

**Position at a 37° rotation, a 37° scan angle and a 90° scan angle.**
- **Verdict:** Exact within sampling.
- **KerfDesk:** mean 0.014 / 0.025 px (u / v), max 0.039 px (0.0039 mm). The 90° scan is 0.000.
- **Reference:** ±½ cell (0.05 mm).

**Position when resampled at a non-integer ratio.**
- **Verdict:** Within quantisation.
- **KerfDesk:**
  - upscale 1.37×: mean 0.089 px, max 0.224 px (0.022 mm = 0.31 cell);
  - upscale 2.5×: max 0.100 px (0.25 cell);
  - downscale 0.73: max 0.176 px (0.13 cell);
  - downscale 2:1 (0.05 mm source): max 0.41 px (0.021 mm = 0.21 cell).
- **Reference:** ±½ cell.

**Half-pixel bias** (mean signed error).
- **Verdict:** No bias at 1:1. The bias at an exact half ratio is below ¼ cell.
- **KerfDesk:**
  - 0.000 px at 1:1 in every orientation and origin;
  - ≤ 0.005 px rotated or angled;
  - −0.099 px (−¼ cell, −0.010 mm) at an exact 2.5× upscale. Nearest-centre ties go to the next source pixel. The 1.37× and 0.73 cases show no systematic sign.
- **Reference:** 0.

**Scale error** (fit over 6 + 5 lines).
- **Verdict:** Exact.
- **KerfDesk:** 0.00 % at 1:1; −0.04 / +0.04 % at 37°. The resampled cases scatter ±0.6 % from quantisation of six points and are not systematic.
- **Reference:** 0. The image extent always equals its bounds.

**Line interval against the request.**
- **Verdict:** KNOWN (20-K-6, 03-P3-4).
- **KerfDesk:** rows are spread evenly over the image height, for example 0.0727 mm against a requested 0.0730 at 13.7 lines/mm.
- **Reference:** LightBurn: "DPI is 25.4 / Line Interval" (2.0 Image Mode). It does not say how the last row fits the image.

**Bidirectional misregistration** (lag model 0.05 mm, so a 0.1 mm separation).
- **Verdict:** Zipper cancelled. The placement offset is KNOWN (D8-P3-1).
- **KerfDesk:**
  - offset off: 0.0986 mm between forward and reverse rows;
  - offset −0.1 mm: 0.000 mm between them, but the image sits +0.050 mm from its outline;
  - one-way: +0.050 mm.
- **Reference:** LightBurn moves each line half the separation, so both directions land on design (2.0 Scanning Offset guide).

**Image-to-vector registration** (Line rectangle on the image bounds).
- **Verdict:** Exact.
- **KerfDesk:** vector edges ±0.000 px at 1:1 and ≤ 0.002 px at 37°; image lines 0.000 / 0.004 px. The difference is ≤ 0.0004 mm.
- **Reference:** 0.

**Preview against emitted G-code** (bitmap Preview, NCC on the 0.01 mm grid).
- **Verdict:** Exact twin.
- **KerfDesk:** 0.000 / 0.000 mm in 50 of 52 scenarios (NCC ≥ 0.96). The other 2 carry a layer scan offset, where the bitmap shows design rows (by design; the toolpath Preview carries the shift).
- **Reference:** 0.
- **Refuter spot-check:** consistent; the 52-scenario count was not re-run. The bitmap is built from the same `compileRasterGroupsForLayer` group (`draw-raster-preview.ts:275-278`). It is drawn over the same `rasterScanBounds` the compile uses (`:128`, `compile-job-raster.ts:165`), row 0 at the bounds' minimum (`compiled-raster-preview.ts:73-79`, `draw-raster-preview-bitmap.ts:57-62`). The refuter's own inverse mapping agreed with that row order: 4096/4096 cells in 8 of 9 along-X cases. At exactly 45° it differed only through pixel-corner ties. The refuter's own G-code reader gave the same dose as `sValues` in all 11 cases. `compiledGridDimensions` (`draw-raster-preview.ts:336-347`) leaves out the quarter-turn swap for pass-through, but it feeds only the cache key and the display-size advisory, not the bitmap.

**Resampling quality, Grayscale photo** (SSIM after the spot blur; after the 0.2 mm eye blur in brackets).
- **Verdict:** Good, except pass-through at an angle (Q2-P1-1). Q2-P3-2 covers the 2:1 rotated softening.
- **KerfDesk:**
  - 1:1 0.9994 (1.000);
  - up 1.37× 0.9905 (0.9988);
  - up 2.5× 0.9939 (0.9983);
  - down 2:1 0.9896 (0.9999);
  - rot 37° at 1:1 0.9906 (0.9997);
  - rot 37° at 2:1 0.9595 (0.9996);
  - pass-through rot 37° 0.7771 (0.9134).
- **Reference:** 1.

**Resampling quality, Jarvis photo** (eye-blur SSIM).
- **Verdict:** Comparable across resampling. Dither quality itself is Q3.
- **KerfDesk:** 1:1 0.957; up 2.5× 0.941; down 2:1 0.956; rot 37° 0.969; rot 37° at 2:1 0.963.
- **Reference:** 1.

**Fine-line contrast on a rotated dense source** (peak of a 1 px line at 2:1).
- **Verdict:** Q2-P3-2.
- **KerfDesk:** upright 0.37; rot 37° 0.30 (−19 %). In the refuter's cell-square model the loss is −6 % to −11 % (0.381 against 0.339–0.358).
- **Reference:** the upright area path.

**Pass-through rotated by 5–60°.**
- **Verdict:** Q2-P1-1.
- **KerfDesk:**
  - row pitch ×1.08 to ×1.41;
  - source pixels burned 85 % down to 36 %;
  - areal dose ×0.92 down to ×0.71;
  - 50 % checker burns about 36 % at 37° (and at 30/44/46°). At exactly 45° it burns 18–71 % depending on placement (refuter correction; the auditor's 71 % is one placement).
- **Reference:** 1:1 pitch with every pixel burned, as upright, at a quarter turn, or turned with the scan.

**Threshold, 1-px lines lost from 1.18× to 1.99× density.**
- **Verdict:** Q2-P3-1.
- **KerfDesk:** 16 % to 51 % of the lines, with no advisory.
- **Reference:** the advisory appears only at 2× or more.

**Overscan of 0, 5 mm and auto.**
- **Verdict:** Clean.
- **KerfDesk:** identical burn (all metrics equal).
- **Reference:** the runway is dark and changes no burn.

**Resampling filters on offer.**
- **Verdict:** Matches ADR-359.
- **KerfDesk:**
  - tone modes use area (box) on downscale and the centre sample on upscale;
  - Threshold uses the centre sample;
  - pass-through has none;
  - rotation uses box-reduce then bilinear;
  - Image Studio resize uses area on downscale and centre-aligned linear on upscale (`resample-axis.ts:11`, read).
- **Reference:** ADR-359 §1–3.

## Findings

### Q2-P1-1 — "Use original pixels" (pass-through) on a turned image burns the source pixel count stretched over the rotated bounding box: rows up to 1.41× apart, up to 64 % of pixels never burned, and tone off by −63 % to +41 %, with no warning

- **Where:**
  - `src/core/job/compile-job-raster.ts:167-173` sizes the pass-through grid from the source's pixel count, but its bounds are the rotated box (`rasterScanBounds`). The grid helper `rasterPassThroughDimensions` (`:217-230`) only swaps the axes when `sourceQuarterTurn` returns 1 or 3.
  - `src/core/job/raster-rotated-sample.ts:126-127`: `reducedSampleGrid` returns `null` for pass-through, so the stretched grid reads the source with the centre sample (`:95-103`).
  - Nothing warns:
    - `raster-threshold-warnings.ts:36` and `job-intent-warnings.ts:243` skip pass-through.
    - *Refuter correction:* `raster-energy-warnings.ts:146` skips only a pass-through *preset* as a dose reference. The energy advisory does run on pass-through groups and reads their actual grid (`:106-111`). It warns only at 1.5× or more of the reference dose, though, and a turned pass-through grid is *sparser*, so it cannot fire for this defect.
    - `scan-quality-warnings.ts` has no density check.
- **Anchor:**
  - **Contract:**
    - The Cut Settings text at `src/ui/layers/CutSettingsImageFields.tsx:210` says: "Pass-through keeps original pixels and density".
    - ADR-359 Decision 3 (`docs/decisions/ADR-359-…md:73`): Pass-Through "(by its own flag, whatever the scale)" reads "the source untouched".
    - ADR-492 Decision 5 and its Verification (`ADR-492-…md:50-51, 114`) cover only an image turned with the scan and the quarter-turn swap. No ADR decides any other angle.
  - **Twin:** upright, quarter-turn and scan-aligned pass-through all burn at the image's own 0.1 mm pitch with 100 % of pixels (measured below).
  - **Ground truth:**
    - LightBurn 2.0 Image Mode (https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/ImageMode/): pass-through will "engrave the image as-is, rather than resampling". It also says "Line Interval/DPI will be directly tied to the size of the image."
    - LightBurn's documentation repo, pinned at `1741e66e9b…` (2019-09-07), `EngravingImages.md`: "you cannot rotate the image, as both of these require resampling".
- **Scenario:**
  1. Import a pre-dithered image (pass-through's purpose): 64 × 64 px at 0.1 mm, a 50 % checker.
  2. Tick "Use original pixels" and rotate it 37° to fit the material, or set the operation's scan angle to 37°.
  3. The compiled grid is still 64 × 64, but it now spans the 8.96 mm rotated box, so rows are 0.140 mm apart.
  4. Each burn cell reads the one source pixel under its centre, so 49 % of the pixels never burn.
  5. With a 0.1 mm spot, 0.04 mm unburned bands appear between rows, and the dose per area falls to 0.71×. The 50 % grey burns as about 36 %.
  6. At 45° every cell centre falls on a dark checker pixel: 2044 of about 2048 footprint cells burn. The same 50 % grey therefore burns as about 71 % (solid black at 0.707 row density).
     - *Refuter qualification:* this holds only at some placements. At exactly 45°, each cell centre maps to an exact source-pixel corner, so floating-point rounding picks the pixel.
     - Over six placements the refuter measured 537, 613, 650, 650, 2044 and 2044 burned cells: a dose of 0.185 to 0.706. At the 50 / 50 placement only 32 of 64 rows burn at all.
     - At 44° and 46° every placement gives the generic 0.353.
  7. The design canvas draws the 50 % checker. Job Review and preflight say nothing.
- **Evidence:** REPRO.
  - **Angle sweep** (`zz-q2-repro.test.ts`, real `compileJob` + `detectJobIntentWarnings` + `prepareOutput`; source pixels counted by an independent inverse mapping):

    | Rotation / scan angle | Grid | Row pitch (source 0.1000 mm) | Source pixels burned | Areal dose | Warnings |
    |---|---|---|---|---|---|
    | 0 / 0 | 64 × 64 | 0.1000 (×1.000) | 4096 / 4096 (100 %) | 1.000 | none |
    | 5 / 0 | 64 × 64 | 0.1083 (×1.083) | 3492 (85.3 %) | 0.923 | none |
    | 10 / 0 | 64 × 64 | 0.1158 (×1.158) | 3048 (74.4 %) | 0.863 | none |
    | 20 / 0 | 64 × 64 | 0.1282 (×1.282) | 2488 (60.7 %) | 0.780 | none |
    | 37 / 0 | 64 × 64 | 0.1400 (×1.400) | 2080 (50.8 %) | 0.714 | none |
    | 45 / 0 | 64 × 64 | 0.1414 (×1.414) | 1552 (37.9 %) | 0.707 | none |
    | 60 / 0 | 64 × 64 | 0.1366 (×1.366) | 2192 (53.5 %) | 0.732 | none |
    | 90 / 0 | 64 × 64 | 0.1000 (×1.000) | 4096 (100 %) | 1.000 | none |
    | 0 / scan 37 | 64 × 64 | 0.1400 (×1.400) | 2080 (50.8 %) | 0.714 | none |
    | −37 / scan 37 (turned with scan) | 64 × 64 | 0.1000 | 4096 (100 %) | 1.000 | none |

    The burned cells of the checker were 2048 at 0°, 1040 at 37° and 2044 at 45°. Preflight issue codes: none.
  - **Simulated burn** (`zz-q2-sim.mjs`):
    - `lines-passthrough-rot37`: row pitch 0.1400, mean dose 0.1171 against ideal 0.1637, SSIM 0.8004.
    - `photo-passthrough-rot37`: dose 0.238 against 0.3354, SSIM 0.7771 (eye 0.9134). The same photo upright with pass-through gives SSIM 0.9994 (eye 1.000).
    - `lines-passthrough-rot45-wide` (scale X 2): row pitch 0.2121 mm.
  - **Related history:** this is a sibling of the August ten-loop L3-04 (P1, "Non-square Pass-Through sampling corrupts at 90/270-degree rotation", `docs/audits/2026-08-30-ten-loop-repo-audit/loop-03-laser-compile-and-gcode.md:115`). That fix swaps the grid only on quarter turns (ADR-313 Decision 4, DECISIONS.md:19630-19632: "Exact 90/270-degree pass-through raster rotations swap the pixel grid"). Every other angle was left on the stretched grid.
  - **Tests:** none cover this case. `compile-job-raster-rotation.test.ts:48-64` tests 90/270, and `compile-job-raster-scan-angle.test.ts:233-260` tests only aligned images or a quarter turn.
- **Why P1 (quality rule: "the burn differs in tone, position or scale from what the app shows or promises, with no warning"):**
  - The app promises "original pixels and density". The burn changes density by up to 1.41×, drops up to 62 % of pixels, and moves a 50 % grey to 36 % or 71 % depending on the angle. No advisory, Job Review line or preflight issue names it.
  - The bitmap Preview does draw the compiled coarse grid. At 45° that grid shows the aliased black, but the canvas does not.
  - The Preview never shows the row-density loss: every cell is drawn as fully covered.
  - Under METHOD §3 a Preview that merely differs from the canvas is not a warning (by analogy with the G6 Frame rule).
- **Verdict (refuter):** CONFIRMED. P1 kept.
  - **What would make it false:**
    - a guard that refuses, disables or warns about pass-through at a non-quarter angle;
    - an ADR that accepts the bounding-box grid;
    - a compile path that keeps the source pitch;
    - a misread of LightBurn.
  - **Own repro** (`zz-q2r-pass.test.ts`, deleted): real `compileJob` plus `selectOutputStrategy(dev).emit` on a 64 × 64 checker at 0.1 mm with Use original pixels.
    - **Inverse mapping:** an independent inverse mapping (own restatement of the front-left flip and the rotation) reproduced `sValues` cell for cell: 4096/4096 at 0, 5, 20, 37, 44, 46, 60 and 90°.
    - **G-code reader:** an independent reader summed the lit length × S/Smax. Areal dose: 0.500 at 0° and 90°, 0.462 at 5°, 0.389 at 20°, 0.356 at 37°, 0.353 at 44/46°, 0.366 at 60° and 0.356 with a 37° scan angle. An image turned with the scan (−37° / scan 37°) gave 0.500.
    - **Row pitch and coverage:** G-code row pitch 0.1080 (5°), 0.1400 (37°) and 0.1410 (44/46°). Distinct source pixels sampled: 85.3 %, 60.7 %, 50.8 %, 50.0 % and 53.5 %, plus 35.6 % at exactly 45° (placement 50 / 50).
    - **Exactly 45°:** see the qualification in step 6.
  - **No warning:** a real `detectJobIntentWarnings` on a turned pass-through image (0°, 37°, 45°) returns only the two generic notices (uncalibrated defaults and the bidirectional scan-offset table).
    - Nothing in `src/core/preflight` or `src/ui/laser/job-review` mentions pass-through and rotation.
    - Job Review's detail adds only the word "pass-through", and only in a Line operation's detail line (`job-review-detail-facts.ts:59`).
  - **No ADR decides it.**
    - ADR-359 D3 (`:72-75`) decides only that pass-through reads the source with the centre sample.
    - ADR-492 D5 (`:46-51`) and ADR-313 D4 (`DECISIONS.md:19630-19632`) cover only the aligned and quarter-turn cases.
    - `compile-job-raster-rotated-fidelity.test.ts:181-194` pins the *sampler* reading the unreduced source at 30/45° for pass-through, not the burn pitch.
  - **LightBurn, fetched by the refuter:**
    - The 2.0 Image Mode page (versioned URL above, fetched 2026-10-28) says "Line Interval/DPI will be directly tied to the size of the image". It does not mention rotation.
    - `LightBurnSoftware/Documentation@1741e66e9b2a583d00e5630da6b953ca9382ebf4` (2019-09-07) `EngravingImages.md:117`: "you cannot rotate the image, as both of these require resampling". The file's latest commit (`537fede6b8`, 2019-06-11) has the same text.
  - **Novelty:**
    - L3-04 (`loop-03-laser-compile-and-gcode.md:115-124`) is the quarter-turn case only, and has been fixed.
    - No `docs/audits` entry raises the non-quarter case.
    - The open PRs #1478, #1480 and #1482 touch no raster file.
  - **Severity:** a wrong tone and density, with no warning, against the "keeps original pixels and density" promise (`CutSettingsImageFields.tsx:210`; also `AdjustImageDialog.fields.tsx:35`). The repro shows the output is wrong, and no warning names it, so METHOD §3's test for lowering a P1 fails. P1 stands.
- **Fix direction:**
  - Refuse to keep pass-through at a non-quarter angle relative to the scan. Either resample at the operation's (or the source's) line interval over the rotated box with a tone kernel, or keep the source pitch (grid = box ÷ source pitch).
  - Either way, say in Job Review and on the checkbox that a turned pass-through image is resampled, as LightBurn's documentation does.
  - Add a pitch and coverage test at a non-quarter angle.

### Q2-P2-1 — Every non-quarter rotated image gets the "engrave will be softer … lower lines/mm" upsample warning, even when its source is denser than the burn grid

- **Where:** `src/ui/laser/job-intent-warnings.ts:242-252` (`describeRasterUpsample`). It compares the source pixel count with `pixelExtentForMm` of `rasterBoundsInMachineCoords` (`:244-246`), which is the rotated machine bounding box, not the image's own extent.
- **Anchor:**
  - **Twin:** the Threshold decimation advisory measures the same density correctly from the image's own size, `obj.pixelWidth / ((bounds.maxX − bounds.minX)·|scaleX|)` (`raster-threshold-warnings.ts:40-43`). The rotated compile path also measures it per source axis (`raster-rotated-sample.ts:143-160`).
  - **Contract (the advisory's own claim):** its text says the image "stores N × M px but the burn grid wants" more, so "the engrave will be softer" (`job-intent-warnings.ts:249-251`). That is a statement about the burn cells covering the image. For a turned image it compares instead with the cells of the bounding box, which also covers empty corners.
- **Scenario:**
  1. A photo is imported at 14 px/mm (356 DPI) and burned at 10 lines/mm. It is 1.4× denser than the grid, so compile area-reduces it.
  2. The operator rotates it 45° to straighten it on the board.
  3. Job Review says it "stores 64 × 64 px but the burn grid wants 65 × 65 px … the engrave will be softer than the canvas preview. Lower lines/mm, shrink the image, or re-import a higher-resolution file."
  4. Following that advice lowers the burn resolution of a source that already has more detail than the grid.
  5. At 1:1, any non-quarter angle triggers it: 37° gives "wants 90 × 90".
- **Evidence:** REPRO (`zz-q2-repro.test.ts`, real `detectJobIntentWarnings`, 64 × 64 px, Jarvis, 10 lines/mm):

  | Source px/mm | Rotation | True cells per source px | Advisory |
  |---|---|---|---|
  | 10 | 0° | 1.00 | none |
  | 10 | 37° | 1.00 | "wants 90 × 90 … softer" |
  | 10 | 45° | 1.00 | "wants 91 × 91 … softer" |
  | 13 | 37° | 0.77 (downscale) | "wants 69 × 69 … softer" |
  | 14 | 45° | 0.71 (downscale) | "wants 65 × 65 … softer" |
  | 8 | 0° | 1.25 (real upsample) | "wants 80 × 80" (correct) |
  | 8 | 37° | 1.25 | "wants 112 × 112" (true figure is 80 × 80) |

- **Known:** related to H5-P3-1 (rolling v3), which found that this check reads the operation's raw DPI rather than the effective one. That is a different root, and the bounding-box measure is not named there. No `docs/audits` entry and no open PR (#1478, #1480) touches it.
- **Why P2:** METHOD §3 P2: "Wrong behaviour an ordinary user will hit, with a misleading result". Straightening a photo by a few degrees is ordinary. The warning's advice degrades the burn if followed. The refuter may weigh it as P3 because it changes no output by itself.
- **Verdict (refuter):** CONFIRMED. P2 kept.
  - **What would make it false:** the turned burn grid really holding more cells per source pixel than the source has, so that the advice helps.
  - **Own repro** (`zz-q2r-upsample.test.ts`, deleted): real `detectJobIntentWarnings` and `compileJob`, 64 × 64 px, 10 lines/mm.
    - The advisory fires at 10 px/mm turned 5° ("wants 69 × 69"), 37° (90 × 90) and 45° (91 × 91), at 13 px/mm turned 37° (69 × 69) and at 14 px/mm turned 45° (65 × 65).
    - It also fires on a −37° image scanned at 37°, which maps 1:1.
    - At 8 px/mm it reports 80 × 80 upright but 112 × 112 at 37°.
    - It stays silent at 20 px/mm turned 37°, and on an upright image with a 37° scan (it ignores the scan frame).
  - **Is the advice wrong? Yes.** The refuter's own fine-grid model: burn cells and rotated source, each blurred by a 0.1 mm FWHM spot; Pearson r against the source; the upright 1:1 sanity case gives 1.0000. Lowering lines/mm until the warning clears makes the burn worse:
    - 10 px/mm at 37°: r 0.9718 at 10 lines/mm → 0.9425 at 7.1 and 0.9398 at 7.
    - 14 px/mm at 45°: 0.9673 at 10 → 0.9375 at 7.
  - **Severity:** a misleading instruction, shown on an ordinary action, that degrades the burn if followed. That meets METHOD P2 ("Wrong behaviour an ordinary user will hit, with a misleading result").
    - H5-P3-1's P3 precedent was a *silent* advisory that another hint covered. This one is a false and harmful one.
    - Still the auditor's wording. Novelty: H5-P3-1 names this function only for its raw-DPI root, so the bounding-box root is new.
- **Fix direction:**
  - Measure the source density along the image's own axes, as `raster-threshold-warnings.ts:40-43` does. Warn only when `linesPerMm` exceeds it.
  - Give the true burn-grid size along the image (`localWidthMm × linesPerMm`), not the bounding box's.

### Q2-P3-1 — Threshold drops 16–51 % of one-pixel lines with no advisory between 1× and 2× source density; the advisory starts at exactly 2×

- **Where:**
  - `src/ui/laser/raster-threshold-warnings.ts:13` (`DECIMATION_ADVISORY_FACTOR = 2`) and `:41-43`.
  - The centre sample: `src/core/raster/luma-resample.ts:229-236` (upright) and `raster-rotated-sample.ts:95-103` (rotated, unreduced).
- **Anchor:**
  - **Contract:** ADR-359 Decision 2 (`ADR-359-…md:56-63`) keeps the centre sample for Threshold and makes Job Review say so "when a Threshold image is stored at least twice as dense as its burn grid".
  - **Twin:** the advisory's own rationale (`raster-threshold-warnings.ts:6-11`): strokes narrower than a cell "are dropped or widened … the canvas still shows every one". That holds at any density above 1×.
- **Scenario:**
  - A 300 DPI logo with hairlines is burned in Threshold at the default 10 lines/mm (1.18×).
  - About one hairline in six disappears, and the rest widen to a whole cell. The canvas shows every line, and Job Review shows nothing.
  - A 37° rotation at exactly 1:1 also reads only 89 % of the source pixels (simulator `sampledFraction` 0.8916).
- **Evidence:** REPRO (`zz-q2-repro.test.ts`). Source: 400 × 8 px with a 1 px line every 7 px (57 lines), compiled with Threshold at 10 lines/mm. Lines were counted against burned columns through the centre-sample formula:

  | Source DPI | Ratio | Lines that vanish | Advisory |
  |---|---|---|---|
  | 300 | 1.18 | 9 / 57 (16 %) | none |
  | 348 | 1.37 | 14 / 57 (25 %) | none |
  | 406 | 1.60 | 22 / 57 (39 %) | none |
  | 483 | 1.90 | 29 / 57 (51 %) | none |
  | 505 | 1.99 | 29 / 57 (51 %) | none |
  | 508 | 2.00 | 28 / 57 (49 %) | SHOWN |
  | 635 | 2.50 | 34 / 57 (60 %) | SHOWN |

  Simulator cross-check:
  - `lines-down0.73-threshold`: at least one ruler line has zero dose (peak 0.00), SSIM 0.696.
  - `lines-scaleXneg-threshold` (Y at 1.43×): mean dose 0.136 against 0.164.
- **Known:** the centre-sample choice is ADR-359 Decision 2 (by design). The 2× trigger is not discussed anywhere in `docs/audits`. Raised as P3 because the threshold is a maintainer decision: the lines lost are narrower than one burn cell (≤ 0.1 mm), and the laser spot blurs them anyway.
- **Verdict (refuter):** CONFIRMED. P3 kept.
  - **Independent check:** the refuter's own arithmetic re-implemented the centre-sample formula (`luma-resample.ts:231-233`) and `pixelExtentForMm` (`:37-40`) on 400 px with a line every 7 px.
    - Lines lost: 9/57 at 300 DPI, 14 at 348, 22 at 406, 28 at 483 (the auditor has 29, from a different line phase), 29 at 505, 28 at 508 and 34 at 635.
    - That tracks 1 − 1/ratio.
  - **Trigger:** the advisory starts at `sourcePxPerMm ≥ 2 × linesPerMm` (`raster-threshold-warnings.ts:13, 41`), as ADR-359 D2 (`:60-63`) decides.
  - **Why P3, not higher:** the Threshold-at-coarser-grid loss is sub-cell detail at a resolution the operator chose. The bitmap Preview shows the compiled grid. The 2× figure is an ADR decision.
  - **Not re-measured:** the "89 % read at 37° 1:1" side note.
- **Fix direction:**
  - Trigger the advisory at any source density above the burn grid (for example ≥ 1.1×).
  - State the expected fraction lost, which is 1 − 1/ratio.
  - Count rotation on an unreduced source too.

### Q2-P3-2 — A rotated (non-quarter) image on a source denser than the grid is softened by box-reduce-then-bilinear: fine-line contrast −19 % against the upright area path

- **Where:**
  - `src/core/job/raster-rotated-sample.ts:105-117`: area-reduce to `round(cells)` per source axis, then `sampling: 'bilinear'` (`:116`).
  - `bilinearRow` (`:279-298`).
- **Anchor:**
  - **Twin:** the upright path (`luma-resample.ts`, area mean per cell).
  - **Contract:** ADR-359 Decision 3 (`ADR-359-…md:64-75`) chose reduce-then-bilinear "so no reduced pixel … is skipped". That gives a box filter followed by a tent filter, wider than the upright box.
- **Scenario:** a 20 px/mm photo or line art (the common import density) burned at 10 lines/mm loses fine contrast after a 37° straightening rotation, compared with the same image upright.
- **Evidence:** REPRO (simulator, Grayscale, 0.05 mm source pixels, 10 lines/mm):

  | Case | 1 px line peak dose | Spot-only SSIM (photo) | Eye-blur SSIM (photo) |
  |---|---|---|---|
  | Upright, `lines-down0.5-grayscale` / `photo-down0.5-grayscale` | 0.37 | 0.9896 | 0.9999 |
  | Rotated 37°, `lines-rot37-grayscale-dense` / `photo-rot37-dense-grayscale` | 0.30 (−19 %) | 0.9595 | 0.9996 |

  There is no position bias: NCC −0.05 / +0.02 px. At viewing distance the loss is small (eye SSIM 0.9996), so this is an improvement, not a defect.
- **Known:** the softening is mentioned in passing in the rolling v3 G10 refuter notes (`G10-image-raster-trace.md:37, 345-346`), but was never raised or measured as a finding. G10-P3-1 (sharpen) is a separate issue.
- **Verdict (refuter):** CONFIRMED for direction, with a smaller effect. P3 kept.
  - **Code:** the mechanism is in the code. A non-quarter turn sets `sampling: 'bilinear'` on the area-reduced grid (`raster-rotated-sample.ts:105-117`, `bilinearRow` at `:279`).
  - **Own measure:** cells drawn as squares, with a 0.1 mm FWHM spot blur, on a 1 px line at 20 px/mm and 10 lines/mm in Grayscale.
    - Peak dose/Smax is 0.381 upright and at 90°, against 0.339–0.358 at 30° and 37°: −6 % to −11 %, not −19 %.
    - Whole-target correlation is comparable: 0.89–0.95 upright, 0.90–0.93 turned.
    - On a 4 px line grid the turned path even scored higher (0.97 against 0.72), because upright area cells quantise sub-cell line phase.
  - **Severity:** a local contrast loss with no fidelity loss overall, so it remains an improvement opportunity.
- **Fix direction:**
  - Area-sample each rotated cell's footprint directly, for example 3 × 3 supersampling of the unreduced source per cell, instead of box-then-tent.
  - Add an effect-size test against the upright path.

### Q2-P3-3 — (L7) No test pins burned pixel position at sub-cell scale for turned, angled, resampled or pass-through images; Q2-P1-1 passes the whole suite

- **Where:**
  - `src/__fixtures__/perceptual/raster-burn-fidelity.test.ts:17-22`: "WHAT THEY DO NOT PROVE: anything below cell scale", where a cell is 4 × 4 or 8 × 8 source pixels. Its rotation cases are 90° only (`:156-210`).
  - `compile-job-raster-rotated-fidelity.test.ts` counts burned cells and lines.
  - `compile-job-raster-scan-angle.test.ts:233-260` counts burned values for aligned pass-through.
  - No test compares a feature's burned position with its canvas position for a non-quarter angle or a non-integer ratio.
- **Anchor:** Contract. ADR-492 Verification and ADR-359 Verification list only counts, a quarter turn and aligned cases.
- **Scenario:** a regression that shifted rotated content by half a cell, or (today) stretched the pass-through grid, keeps every raster test green.
- **Evidence:**
  - READ: the test files above.
  - REPRO: Q2-P1-1 exists on `09f7c0087` with every raster test as shipped. The Q2 simulator's 1:1 ruler shows a test of this kind can be exact (0.000 px expected).
- **Verdict (refuter):** CONFIRMED (READ, plus the refuter's own Q2-P1-1 repro). P3 kept.
  - **Every pass-through test, checked:** the refuter grepped every `passThrough: true` test under `src/`. The only non-quarter pass-through cases are:
    - `compile-job-raster-scan-angle.test.ts:233-253` (image turned *with* the scan: a count of burned values);
    - `compile-job-raster-rotated-fidelity.test.ts:181-194` (the sampler's grid size at 30/45°).
  - Neither asserts burn pitch, coverage or position.
  - The fidelity harness header (`raster-burn-fidelity.test.ts:17-23`) excludes anything below cell scale.
  - The refuter's 1:1 dot-position check (scorecard) shows that an exact sub-cell position test is feasible.
- **Fix direction:**
  - Add a ruler-target position test: an independent G-code reader, centroid against canvas position.
  - Cover rotations of 0/37/90/180, a 37° scan, mirror, two origins and ratios of 1.37 / 2.5 / 0.5.
  - Use tolerances of 0.01 px at 1:1 and ½ cell when resampled.
  - Add a pitch assertion for pass-through.

## KNOWN (re-observed, not re-raised)

- **D8-P3-1 (controller v3):** reverse-only scan-offset correction leaves a calibrated image half the measured separation off its vector outline.
  - Re-measured with a 0.05 mm lag (0.1 mm separation) and the correct −0.1 mm entry: the zipper is 0.000 mm and the image sits +0.050 mm from the outline. The forward-against-reverse gap is 0.0986 mm without the entry.
  - LightBurn 2.0 Scanning Offset guide (https://docs.lightburnsoftware.com/2.0/Guides/ScanningOffsetAdjustment/): "LightBurn moves each line by the amount you specify".
- **D8-P3-5:** the coupon gives no sign cue. With a positive lag the correct entry is negative; this was confirmed in the simulator.
- **20-K-6 / 03-P3-4:** rows are spread evenly over the image, so the pitch differs from the requested interval, for example 0.0727 against 0.0730 mm at 13.7 lines/mm.
- **20-K-1:** Save Processed Bitmap dithers on the image-oriented grid. This was not re-measured; the Preview twin is exact.
- **G10-P3-1:** rotated sharpening is weakened on a coarse source. Not re-measured.
- **H5-P3-1:** the raster advisories read the operation's raw mode and DPI. It is related to Q2-P2-1, but has a different root.
- **J6-P1-1:** a PNG with EXIF Orientation 5–8 imports squashed (fix card exists). It is an import-time geometry error upstream of this area and was not re-measured.
- **L3-04 (August ten-loop):** fixed for quarter turns; Q2-P1-1 is its non-quarter sibling.
- **Refuter check of the KNOWN list:** each ID exists where cited.
  - **Where:**
    - D8-P3-1 and D8-P3-5: `2026-10-22-controller-v3/D8-ctl-scan-offsets.md`.
    - "20-K-6" is K-6 (03-P3-4) in `2026-10-21-rolling-v2/20-raster.md:256`.
    - 20-K-1, G10-P3-1 and H5-P3-1: rolling v3 G10/H5.
    - J6-P1-1: rolling v5 J6, on the audit branch and not yet on main.
    - L3-04: `loop-03-laser-compile-and-gcode.md:115`.
  - **Measurements:** none was re-measured by the refuter.
  - **LightBurn Dot Width Correction quote:** re-fetched and verbatim.

## Refuted

- **"Dot Width Correction shortens each end by the full value, twice LightBurn's."** Refuted.
  - LightBurn 2.0 Image Mode says: "The ideal Dot Width Correction value is about half the total thickness of the laser's beam". Per-end shortening of half the beam is therefore the same convention.
  - The case where a one-pixel run vanishes (`lines-dwc0.05`: all 1 px vertical lines gone) already has a Job Review warning (`scan-quality-warnings.ts:96-111`).
- **"The bitmap Preview ignores scan offset and Dot Width Correction."** Not a defect.
  - The bitmap shows where the burn lands.
  - The toolpath Preview shares the sweep plan, the DWC and the reverse-row shift (`toolpath-raster-steps.ts:25-54, 97`), as ADR-052 Amd 1 Decision 2 requires.
- **"Upright pass-through ignores the operation's DPI."** Matches LightBurn ("Line Interval/DPI will be directly tied to the size of the image"). Positions are exact (`lines-passthrough-rot0`: 0.000 px). Dose follows the image pitch.
- **"Rows sit half a row inside the image."** This is the correct pixel-centre convention: rows sit at `minY + (i + ½)·pitch` (`emit-raster.ts:231`). With spot = pitch the burned Y extent equals the bounds, and every row-line error measured 0.000 px.
- **"The rotated sampler has a half-pixel offset."** Measured bias ≤ 0.005 px at 37°, and NCC shift 0.00 px (centre sampler and bilinear `−0.5` alike).
- **"Job Origin anchors on the burned pixels, not the image."** `computeJobPlacementBounds` uses the whole group bounds, white margin included (`job-bounds.ts:53-55, 266-288`). This matches LightBurn's "smallest rectangle containing all graphics" as quoted in ADR-052 Amd 1.
- **"Overscan changes the burned image."** 0, 5 mm and auto give identical burns on every metric.

## Verified clean

- **Upright geometry.**
  - Cells divide the bounds exactly: `pixelWidthMm = width / pixelWidth`, and every run edge is computed from `minX` with no drift (`raster-power-runs.ts:53-54`).
  - The 3-decimal rounding keeps position error ≤ 0.0005 mm at a fractional placement of 50.37 / 80.63.
  - Mirror X, negative scale, 180° and front-left, front-right and centre origins are all exact (0.000 px).
- **Rotation, scan angle and quarter turns.**
  - The inverse transform in `raster-rotated-sample.ts:337-348` is the exact inverse of `applyTransform`.
  - The canvas draw (`draw-raster.ts:204-224`) composes the same forward transform.
  - Errors are ≤ 0.039 px at 37° and 0 at 90°. An image turned with the scan maps 1:1 (−37° image with a 37° scan: 100 % of pixels).
- **Resampling.**
  - Area means are exact. The centre sample uses the `(t + ½)` convention.
  - Errors stay inside ±½ cell at 1.37×, 2.5×, 0.73 and 0.5. The tie bias at an exact half ratio is −¼ cell (≤ 0.025 mm).
  - Image Studio resize is pixel-centre aligned (`resample-axis.ts:11`: `(pixel + 0.5) * scale - 0.5`).
- **Preview twins.**
  - The bitmap Preview (`drawMachineRasterBitmap`) places the compiled group exactly where the G-code burns it in 50 scenarios. That covers every rotation, scan angle, origin and pass-through case; the stretched grid in Q2-P1-1 is shown consistently.
  - The toolpath Preview uses the emitter's sweep planner.
- **Vector registration.** A Line rectangle on the image bounds and the image's own lines agree to ≤ 0.0004 mm, upright and at 37°.
- **Bidirectional scanning without an offset.** The forward and reverse rows command identical pixel edges: 0.000 px fwd − rev with no lag. One-way and bidirectional give the same burn.
- **Advisories that exist and fire correctly.**
  - DWC removing a one-pixel run (`scan-quality-warnings.ts:96-111`).
  - The overscan runway estimate.
  - The real upsample case (8 px/mm, upright).
  - Threshold decimation at ≥ 2×.

## Not verified

- **Physical burns.** No material burn, air run or controller. There is no dot gain, no M4 acceleration or deceleration power loss at row ends (that is Q1's area), and no measurement of real firing lag. The lag model is a fixed distance.
- **LightBurn's own output.** No LightBurn install was available. Its row fitting to image height, its rotated-image resampler, and current pass-through rotation behaviour (the 2019 docs say it cannot rotate; 2.0 docs say only "as-is") were not observed.
- **Untested paths.**
  - The streamed path (> 4 M burn cells) was not run, for memory. Byte-identity with the materialized path is pinned by `compile-job-raster-stream.test.ts`.
  - Rotary Y scaling.
  - Image masks and owned clips at edges.
  - Cross-hatch and per-pass angle registration were checked only through single-angle proxies: the 0°, 37° and 90° grids each land within 0.04 px.
- **Images.** Images larger than 64 × 64 px were not tested; results were extrapolated (all errors are per cell and size-independent). Only one real image was used: the astronaut crop.

```json
[
  {"id":"Q2-P1-1","severity":"P1","area":"raster-geometry","file":"src/core/job/compile-job-raster.ts","line":167,"anchor":"Contract: CutSettingsImageFields.tsx:210 'Pass-through keeps original pixels and density'; ADR-359 Decision 3 pass-through reads the source untouched; ADR-492 decides only aligned/quarter-turn pass-through. Twin: upright/quarter-turn/scan-aligned pass-through burn at 1:1 pitch. Ground truth: LightBurn 2.0 Image Mode 'engrave the image as-is, rather than resampling'; LightBurn Documentation @1741e66e (2019) 'you cannot rotate the image'","evidence":"REPRO","verdict":"CONFIRMED","known":"sibling of 2026-08-30 ten-loop L3-04 (fixed for 90/270 only)","summary":"Pass-through on an image rotated (or scanned) at a non-quarter angle keeps the source pixel count over the rotated bounding box: row pitch x1.08 (5 deg) to x1.41 (45 deg), 15-64% of source pixels never burned, areal dose x0.92-x0.71; a pre-dithered 50% checker burns ~36% at 37 deg and 18-71% at exactly 45 deg depending on placement (pixel-corner ties); no advisory or preflight issue. Refuter: own compile + independent G-code reader reproduced it"},
  {"id":"Q2-P2-1","severity":"P2","area":"raster-geometry","file":"src/ui/laser/job-intent-warnings.ts","line":244,"anchor":"Twin: raster-threshold-warnings.ts:40-43 measures source density along the image's own axes; raster-rotated-sample.ts:143-160 likewise","evidence":"REPRO","verdict":"CONFIRMED","known":"related to rolling v3 H5-P3-1 (different root: raw operation DPI)","summary":"The upsample advisory compares the source pixel count with the burn grid of the rotated machine bounding box, so every non-quarter rotated image at >= 1:1 gets 'engrave will be softer ... lower lines/mm' (64 px at 10 px/mm, 37 deg: 'wants 90 x 90'), even a source 1.4x denser than the grid; a real upsample reports a wrong grid size (112 vs 80)"},
  {"id":"Q2-P3-1","severity":"P3","area":"raster-geometry","file":"src/ui/laser/raster-threshold-warnings.ts","line":13,"anchor":"Contract: ADR-359 Decision 2 (advisory at >= 2x); Twin: the advisory's own rationale that sub-cell strokes are dropped while the canvas shows them","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Threshold centre-sampling drops 16% (300 DPI at 10 lines/mm) to 51% (1.9-1.99x) of one-pixel lines with no advisory; the advisory starts at exactly 2x; a 37 deg rotation at 1:1 also reads only 89% of source pixels"},
  {"id":"Q2-P3-2","severity":"P3","area":"raster-geometry","file":"src/core/job/raster-rotated-sample.ts","line":116,"anchor":"Twin: upright area path (luma-resample.ts); ADR-359 Decision 3 box-reduce then bilinear","evidence":"REPRO","verdict":"CONFIRMED","known":"mentioned, not raised, in rolling v3 G10 refuter notes","summary":"Non-quarter rotation of a source denser than the grid reduces by box then samples bilinearly: 1-px line peak 0.30 vs 0.37 upright (-19%), photo spot-SSIM 0.9595 vs 0.9896 (eye SSIM 0.9996 vs 0.9999); no position bias. Refuter cell-square model: -6% to -11% peak, whole-target correlation comparable"},
  {"id":"Q2-P3-3","severity":"P3","area":"raster-geometry","file":"src/__fixtures__/perceptual/raster-burn-fidelity.test.ts","line":17,"anchor":"Contract: ADR-492 / ADR-359 Verification list counts, quarter turns and aligned cases only","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"(L7) No test pins burned pixel position at sub-cell scale for non-quarter rotation, scan angle, non-integer DPI ratio or pass-through at an angle; the fidelity harness scores 4x4-8x8 px cells and rotates by 90 deg only; Q2-P1-1 passes every raster test"}
]
```
