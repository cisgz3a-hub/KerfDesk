# Rolling audit v9 — R2 Tracer re-measure 2 (trace and burn-quality fix verification)

- **When:** 2026-11-02, 09:00 – 11:00 +0800   **Tree:** origin/main @ `f862d0d8d` (fetched at the start and again at the end; unchanged). Every repro ran on the scratchpad `j7-main` tree. Its `src/core/trace`, `src/core/raster`, `constant-power-warnings.ts` and `gcode-dialects.ts` match `f862d0d8d` blob for blob (`git hash-object`).
- **Scope:**
  - **Fixes verified:** #1516 (ADR-434 Amd 3), #1517 (ADR-530 Amd 12, ADR-439 Amd 2), #1514 (ADR-257 Amd 2). Their implementation files are unchanged on main since each merged.
  - **Entry points:** `traceImageToColoredPaths` with `TRACE_PRESETS` (the dialog worker's call); `prepareOutput` → `emitPreparedGcode` (Save/Start); `constantPowerWarnings` and `detectJobIntentWarnings`.
  - Potrace 1.16 and mkbitmap 1.16 ran as separate test-only processes, with documented options only. No Potrace or mkbitmap source was read.
- **Lenses run:**
  - **L2.** Potrace head-to-head on the Q4 79-image set, the Q5 27 real cases, and new variants: 19 input forms, and 400–800 px shapes and 192–384 px glyphs.
  - **L10**, steps 1–5:
    - every N8 repro, each also on a pre-fix bundle (N8's `33bc394c6` engine);
    - siblings and the opposite failure each fix invites;
    - a regression check with a **parent-of-#1517 engine** (main with #1517's five files served from `c1acfdff6`);
    - ADR amendments against the code;
    - test truth: each PR's tests on main, then on its parent's implementation files.
- **Counts:** 9 raised → **P1 4 / P2 3 / P3 2 after the refuter** (auditor's ratings P1 3 / P2 4 / P3 2), + 7 KNOWN re-observed. Refuter: 9 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. One severity change: **R2-P2-3 raised to P1**. Three claims inside the confirmed findings are refuted and listed under Refuted (the coloured-ink half of R2-P1-1's regression, R2-P2-2's stated cause, and the literal reading of R2-P2-1's anchor).
  - **Fixes:** N8-P2-1, N8-P2-2, N8-P2-3 and N8-P2-5 hold on every case N8 and the PRs measured.
  - **N8-P2-4** holds on anti-aliased and clean input, not after JPEG.
  - **#1517 brings a regression** on Line Art, R2-P1-1: it moves hard-edged mid-grey art (luma about 86–127) onto a sampling that removes a pixel of stroke. Coloured ink also gains a pixel on this route, but the parent of #1517 did that too (refuter).
  - **Main moved during the refuter** to `54e0e19b8` (#1529, photo engraving preview). `git diff f862d0d8d origin/main` shows nothing under `src/core/trace`, `src/core/job` or the constant-power and job-intent warnings, so these results stand on it.

## Headline

**Are we better than Potrace now? On the audit's own scorecard yes, as before, and more clearly on compressed input. Not on large one-bit art, and #1517 broke thin strokes in mid-grey ink.**

**Refuter's headline (own scoring).** An honest headline is: **better than Potrace on art up to about 200 px and glyphs up to 48 px, clean or JPEG q60 and up, and on anti-aliased art at every size measured. Not better on curved one-bit art from about 500 px, on one-bit glyphs from 96 px, or on hard mid-grey art on Line Art. And it loses specific text marks that Potrace keeps.**
- **Recounted (no trace run):** my own tally code on the auditor's rows gives exactly 51 / 20 / 8, 49 / 22 / 8, 55 / 17 / 7 clean, and 51 / 20 / 8, 48 / 22 / 9, **54 / 17 / 8** at JPEG q75. q60, q50, luma 80 (38 / 14 / 27) and the large sets (17 / 4 / 10, 0 / 1 / 9) match too.
- **Re-measured (fresh traces, my own scorer and metrics):** the same 79 images score **Line Art 56 / 13 / 10, Smooth 54 / 16 / 9, Sharp 38 / 14 / 27** clean, and 56 / 13 / 10, 54 / 16 / 9, 37 / 15 / 27 at q75. Mean boundary displacement is 0.111 (Line Art) against 0.139 px (Potrace).
- **Weighting barely moves it for Line Art and Smooth.** Without the three corner metrics they score 46 / 25 / 8 and 49 / 24 / 6; on fidelity alone 50 / 19 / 10 and 49 / 18 / 12. Compactness alone is level for Line Art (25 / 29 / 25), and Smooth leads it (31 / 30 / 18).
- **Sharp's row depends on the corner metrics.** It scores 29 / 31 / 19 without them and 5 / 17 / 57 on compactness. It still wins fidelity, 60 / 17 / 2.
- **The set's limit is size.** It stops at 200 px and 96 px glyphs. Pooled with the auditor's large one-bit rows (120 images), the tally is **Line Art 68 / 25 / 27, Smooth 72 / 23 / 25, Sharp 64 / 33 / 23**. Still ahead, but this is the fairer one-line number for one-bit art. On the 41 large images Line Art wins polygons and stars and loses the smooth shapes and glyphs.

**The scorecards:**
- **79 ground-truth images: Line Art 51 / 20 / 8, Sharp 49 / 22 / 8, Smooth 55 / 17 / 7.** These are exactly N8's numbers, 80 of 80 rows identical. No case flipped from win to loss. #1516 and #1517 change nothing on clean binary art.
- **The same set after JPEG q75: 51 / 20 / 8, 48 / 22 / 9, 54 / 17 / 8** (N8 52 / 18 / 9, 48 / 22 / 9, **45 / 17 / 17**). After q60: 50 / 20 / 9, 49 / 20 / 10, 56 / 15 / 8. Smooth's JPEG loss is gone.
- **Q5 27 real cases:** A 23 / 3 / 1 and B 26 / 1 / 0, unchanged. C **24 / 2 / 1** (N8 23 / 3 / 1). No row added a mark, and 9 logo rows regained parts.
- **WebP, palette PNG, alpha-mask PNG and inverted art all score at or above the clean row** of their class (table below).

**Where we are not better:**
1. **R2-P1-1, a regression from #1517.** Hard-edged thin art in a non-black ink, traced with Line Art (the Free default) on the 2× route:
   - In mid-grey (luma 90–120), strokes **lose a pixel**. A 2 px grid keeps 52% of its ink, against 100% before #1517. Potrace keeps 100%. Hard grey text tears: Arial 20 px, 34 parts and 0 of 10 holes, against 13 and 10 in the source.
   - In red, teal or blue, strokes **gain a pixel**. 3 px bars come out 4 px wide (+35%). The "+3% before #1517" in the first draft was one bar placement: across placements the parent ranges +4 to +64% and is no better on average (refuter, R2-P1-1).
2. **R2-P1-2.** Full stops still vanish from **rotated text**, because the baseline rule only reads horizontal baselines. Past 5°, Line Art keeps 129 of 144 stops (5°), 114 of 144 (45°) and 126 of 144 (180°). Potrace on 1-bit input keeps all of them, and so does Sharp from 5° to 45°. The same text at 0° keeps 144 of 144.
3. **R2-P1-3.** A **colon** loses both dots in "Scale 1:10" (Times 20 and 24 px, Tinos 24 px, Verdana 20 px): its top dot is counted as dust and vetoes its bottom dot. A stop whose only neighbours are descenders goes too.
4. **R2-P2-1.** Line Art draws hard non-black art at 100 px and up on the pixel staircase. ADR-530 Amendment 12 says otherwise. Red "Logo & Co" draws 176 segments and 68 inflections against 103 / 22 in black and 103 / 18 for Potrace.
5. **R2-P2-2.** Large one-bit art loses to Potrace on curves. 400–800 px shapes score **17 / 4 / 10**, 192–384 px glyphs **0 / 1 / 9**. A 1024 px circle draws 62 segments at 0.52 px error, against Potrace's 13 at 0.13 px.

**What the fixes did not break.** #1516 does not let dust back in, and #1517 does not catch anti-aliased art (details in Verified clean):
- Text page with 60 hard specks: 2 kept, 0 before. Potrace keeps 60.
- Q4's speckle field and the Q5 noisy cases are unchanged.
- Soft art, hinted text, photos and gradients keep the measured route: 30–90% of their cracks are not steps.

**Burn quality holds:**
- **Dot Width:** 0.997 / 0.994 / 0.987.
- **Turned Pass-Through:** rows 0.099–0.100 mm apart, dose 0.996–1.005.
- **Line Screen:** 65 tones, max error 0.0078, black 100%.
- **M3 Fill advice (#1514):** fires and quotes the right speed. At the quoted speed the model's dose is 1.000. Silent under M4, on the 4040 and for hand-set modes. **Island fills never get it**, although Decision 1 names them (R2-P2-3).

## Scorecard

**Trace vs Potrace 1.16** (`-t 2 -a 1 -O 0.2 -z minority`), Q4's 79 images, W / T / L of cases:

| Preset | N8 (`33bc394c6`) | **Main `f862d0d8d`** | 7-metric | After JPEG q75 (N8 → main) | After q60 (main) | q50 (main) |
|---|---|---|---|---|---|---|
| Line Art (Free default) | 51 / 20 / 8 | **51 / 20 / 8** | 52 / 20 / 7 | 52 / 18 / 9 → **51 / 20 / 8** | 50 / 20 / 9 | 48 / 18 / 13 |
| Sharp | 49 / 22 / 8 | **49 / 22 / 8** | 53 / 22 / 4 | 48 / 22 / 9 → 48 / 22 / 9 | 49 / 20 / 10 | 46 / 17 / 16 |
| Smooth (Pro CNC default) | 55 / 17 / 7 | **55 / 17 / 7** | 52 / 20 / 7 | 45 / 17 / 17 → **54 / 17 / 8** | 56 / 15 / 8 | 52 / 16 / 11 |

| Aggregate, JPEG q75 of the 79 | Line Art | Smooth | Sharp | Potrace |
|---|---|---|---|---|
| Segments (N8 → main) | 995 → **815** | 1,399 → **781** | → 2,381 | 700 |
| Inflections per smooth convex shape | 1.0 | 0.4 | 17.5 | 0 |
| True corners kept (of 331) | 237 | 228 | 269 | 143 |
| Mean boundary error | 0.117 | 0.122 | 0.136 | 0.154 |

**Other input forms, same 79 images, same truth** (`q4/bench-var.mjs`; Potrace on the same decoded pixels). "Pre" is the `33bc394c6` engine where it was run.

| Input | Line Art | Sharp | Smooth | Note |
|---|---|---|---|---|
| Binary (control) | 51 / 20 / 8 | 49 / 22 / 8 | 55 / 17 / 7 | |
| Anti-aliased (8×8) | 69 / 10 / 0 | 67 / 11 / 1 | 66 / 10 / 3 | pre identical |
| Anti-aliased + JPEG q75 | 68 / 9 / 2 | 64 / 13 / 2 | 67 / 10 / 2 | |
| WebP q75 of binary | 51 / 20 / 8 | 49 / 22 / 8 | 55 / 17 / 7 | pre 54 / 18 / 7, 49 / 22 / 8, 56 / 14 / 9 |
| WebP q75 of anti-aliased | 68 / 9 / 2 | 67 / 9 / 3 | 68 / 8 / 3 | |
| PNG palette 4 / 16 colours of anti-aliased | 61 / 14 / 4; 68 / 10 / 1 | 63 / 14 / 2; 67 / 10 / 2 | 55 / 18 / 6; 66 / 10 / 3 | |
| Transparent PNG, shipped loader's RGB, alpha-mask on | 51 / 20 / 8 | 49 / 22 / 8 | 55 / 17 / 7 | hard alpha |
| Transparent PNG, soft alpha, alpha-mask on | 69 / 9 / 1 | 69 / 9 / 1 | 69 / 9 / 1 | |
| Transparent PNG, alpha-mask off | 51 / 20 / 8 | 49 / 22 / 8 | 55 / 17 / 7 | composited on white |
| Inverted, Invert on (binary; anti-aliased) | 51 / 20 / 8; 69 / 10 / 0 | 49 / 22 / 8; 67 / 11 / 1 | 55 / 17 / 7; 66 / 10 / 3 | identical to the positive |
| Grain σ 6 / 12 of binary | 50 / 20 / 9; 50 / 20 / 9 | 50 / 21 / 8; 47 / 22 / 10 | 55 / 16 / 8; 54 / 18 / 7 | |
| Grain σ 6 of anti-aliased | 67 / 11 / 1 | 67 / 11 / 1 | 67 / 9 / 3 | |
| Blur σ 0.6 / 1.0 of binary | 39 / 14 / 26; 42 / 15 / 22 | 47 / 10 / 22; 48 / 13 / 18 | 40 / 17 / 22; 45 / 17 / 17 | pre 36 / 17 / 26, 47 / 10 / 22, 37 / 19 / 23 (σ 0.6) |
| **Hard ink at luma 80 on white** | **38 / 14 / 27** | 49 / 22 / 8 | 55 / 17 / 7 | pre 5 / 2 / 72 (R2-P2-1) |
| **Hard ink on a gradient paper** | **39 / 25 / 15** | 47 / 24 / 8 | 55 / 17 / 7 | pre 12 / 16 / 51 (R2-P2-1) |

**Beyond the sets N8 measured, one-bit art** (R2-P2-2):

| Set | Line Art | Sharp | Smooth | Segments L / Sh / Sm / Potrace | Mean error L / Sh / Sm / Potrace |
|---|---|---|---|---|---|
| 31 of the 32 shapes at 400 and 800 px | **17 / 4 / 10** | 13 / 10 / 8 | 17 / 4 / 10 | 1,060 / 8,146 / 1,134 / **262** | 0.123 / 0.117 / 0.173 / 0.128 |
| Roboto a g R S, Tinos R at 192 and 384 px | **0 / 1 / 9** | 2 / 1 / 7 | 0 / 2 / 8 | | |

**Real crops, Q5 degraded cases, finding re-checks:**

| Check | N8 | **Main** | Potrace | Verdict |
|---|---|---|---|---|
| Seven real crops: segments L / Sm; rings L / Sm | 10,671 / 10,096; 898 / 900 | **identical** | 8,762; 890 | unchanged |
| Q5 A (Line Art vs plain Potrace) | 23 / 3 / 1 | **23 / 3 / 1** | | unchanged |
| Q5 B (Smooth vs mkbitmap + Potrace) | 26 / 1 / 0 | **26 / 1 / 0** | | unchanged |
| Q5 C (best vs best) | 23 / 3 / 1 | **24 / 2 / 1** (logo noise12 T → W) | | better, as #1516 claims |
| N8-P2-1: "so X." after 61 characters, anti-aliased, 20+24+28 px, Line Art (Roboto / Tinos) | 146 / 169 of 183 | **183 / 180** (Tinos 20 px after k Y Z trace as 2 px loops, as ADR-434 Amd 3 says) | 183 | holds at 0° |
| Same, 1-bit (Roboto / Tinos) | 163 / 175 | 183 / 182 (the stop after j: K3) | 183 | holds |
| N8-P2-1: 8 everyday strings incl. "easy. any. say. buy. dry.", Roboto, Tinos, Arial (opentype paths), 20–28 px, all marks, Line Art | 0 / 5 on the worst | **243 / 243** | 243 | holds at 0° |
| Same sentences, hinted (Pango/FreeType), final stop, 8 sentences × 3 sizes: Arial, Roboto, Calibri, Verdana, Times, Tahoma, Georgia | Arial 14 of 24 (refuter) | **24 / 24 for each font, Line Art and Smooth** | 24 (Calibri 16) | holds |
| Pre-fix engine, same hinted test | | Arial 12, Roboto 2 of 24 | | the check discriminates |
| N8-P2-2: "lit." at 20 px, 1-bit; lone "i" | 0 / 2; 0 / 1 | **2 / 2; 1 / 1** | 2; 1 | holds |
| Dots beside a square, all pages | 6 / 6 | 6 / 6 | 6 / 6 | holds |
| N8-P2-3: circle@32, JPEG q75 / q60, canvas 48–100 | 47 segments, 40 inflections | **5–6 cubics, 0–1 inflections** for Line Art and Smooth | 4 | holds |
| N8-P2-4: 72 glyph images, anti-aliased | L 7, Sm 7, Sh 25 | **0, 0, 0** | 0 | holds |
| Same, 1-bit | 11 on 9, 11 on 9, 5 on 5 | **unchanged** (ADR-439 Amd 2 Follow-up) | 0 | KNOWN (K2) |
| Same, **anti-aliased then JPEG q75** | not measured | **L 4 on 4 (2.60 px), Sm 4 on 4, Sh 10 on 7 (2.17 px)** | 0 | new sibling (R2-P2-4) |

**Burn quality** (shipped Save/Start path, independent G-code reader; `burn-tests/zz-r2-burn.test.ts`):

| Check | N8 | **Main** | Verdict |
|---|---|---|---|
| Grayscale energy at Dot Width 0.02 / 0.04 / 0.08 mm against 0, photo-like 128 × 64 | 0.9969 / 0.9939 / 0.9878 | **0.9969 / 0.9937 / 0.9874**; Pass-Through at 0.04 mm 0.9937 | holds |
| Pass-through checker turned 0 / 5 / 37 / 45 / 90 / 123°, scan 0° and 45° | rows 0.0995–0.1006, dose 1.000–1.010 | **rows 0.0990–0.1004 mm, dose 0.996–1.005**; aligned turns (0°/90° at scan 0°, 45° at scan 45°) keep 64 rows | holds |
| Line Screen, 8 px at 0° / 90°; 4 px; 8 px at 15° / 45° | 65 tones, 0.0078; 17 tones, 0.031; 0.0009 / 0.0091 | **identical**; black 100% | holds |
| #1514 advice against the dose (own planner model, 15 blocks, 500 mm/s², δ 0.01 mm) | see below | | see below |

| GRBL Compatible Fill case, M3 | 1500 | 3800 | 6000 mm/min | Advice at 6000 (quoted speed) |
|---|---|---|---|---|
| Bars 0.3 / 0.3 mm × 20 | 1.000 | 1.000 | **1.462** | yes (3888) |
| Same, Automatic overscan | 1.000 | 1.000 | **1.436** | yes (3888) |
| Bars 0.5 / 0.5 × 20 | 1.000 | 1.000 | 1.192 | yes (5019) |
| Bars 0.2 / 0.2 × 40 | 1.000 | **1.159, advice fires (3174)** | 1.817 | yes (3174) |
| Bars 1.2 / 0.3 × 20 | 1.000 | 1.000 | 1.061 | none, as designed |
| Bars 0.3 / 0.3 × 8 | 1.000 | 1.000 | 1.362 | yes (3888) |
| Bars 0.3 / 0.3 × 6, 7 (default 5 mm overscan) | 1.000 | 1.000 | 1.321, 1.305 | none; the runway notice fires |
| Same, Automatic overscan (× 6) | 1.000 | 1.000 | 1.000 | none, correct |
| Hatch 45° / 90° of × 20 (default overscan) | 1.000 | 1.000 | 1.305, 1.320 | none; the runway notice fires |
| Offset fill | 1.482 | 3.459 | 5.461 | corner advice at every speed, no Lead-in wording |
| **Island fill, 0.3 mm strokes** | **1.645** | **4.167** | **6.579** | **none** (R2-P2-3) |
| **Island fill, 1 mm strokes** | 1.011 | | 3.673 (3000: 1.837) | **none** |
| **Island fill, 3 mm** | 1.000 | | 2.132 (3000: 1.082) | **none** |
| Hand-set Constant / Dynamic | | | | none, as designed |

The same matrix on the other dialects at 6000 mm/min:
- **GRBL Dynamic, GRBL Raster, Neotronics 4040 Safe:** Fill word M4, Fill advice 0 in every case. Dose under M4 is 1.00× by definition; the model's column does not apply to them.
- **4040 with Fill hand-set to Constant:** word M3, advice 0, as designed.
- **GRBL Compatible on grblHAL (100 blocks):** no Fill advice. Dose 1.15× at the default overscan (row ends; the runway notice fires), 1.000 under Automatic. Correct.
- **GRBL Compatible on FluidNC (15 blocks):** same as GRBL.

### Measurement method

All scripts are in the scratchpad folder `zz-r2/` (left for the refuter):
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-r2\`.

**Engines.**
- `build-engine.mjs` bundles `j7-main`'s public entries with esbuild 0.28.1, as N8 did.
- **Pre-fix:** N8's `zz-n8/engine.mjs` (`33bc394c6`), passed by file URL as `R2_ENGINE`.
- **Parent of #1517:** `build-parent.mjs` serves `contour-boundary`, `contour-corner-field`, `contour-corner-ink`, `contour-corners` and `staircase-source` from `c1acfdff6` through an esbuild `onLoad` hook (files on disk unchanged), giving `engine-parent1517.mjs`. This is the check that attributes R2-P1-1.
- **Probe:** `build-debug-r2.mjs` logs each `keepInkMark` verdict with its evidence and each `isStaircaseSource` share.

**Sets.** Copied from `zz-n8/` unchanged except paths.
- **Copy check.** Re-tallying N8's archived `results.jsonl` with the copy gives 51 / 20 / 8, 49 / 22 / 8, 55 / 17 / 7. Main's rows match N8's 80 of 80 (`cmp-jsonl.cjs`).
- `q4/bench-var.mjs` is `bench-jpeg.mjs` with a `VARIANT` switch. The `bin` variant through its PGM path reproduces the binary tally exactly, so the path is sound.
- **Alpha variants** follow the shipped loader, `compositeRgbOverWhitePreservingAlpha` (`image-loader.ts:257`). An early run with black paper RGB is not a shipped input and was discarded.
- **Large sets:** `--sizes 400,800` and `GLYPHPX=192,384`. Row `gap-1px@800` was stopped after 20 minutes in the scorer. It is one of 32 shapes and is left out of the tally.

**Fresh checks.**
- `lib-r2.mjs` renders text from any font file through opentype paths, with rotation about the block centre and 8 × 8 coverage.
- **Marks** are the glyph's own small outer contours. A mark is kept when the traced fill covers at least 30% of its ink at 4 × 4 samples. The 30% threshold stops a 2 px loop on a thin stop from reading as lost; N8's 50% pixel test (`f-stops.mjs`) was also run unchanged.
- `f-rotstops.mjs` identifies full stops on the unrotated outline: small, bottom within 1 px of the baseline, top within 0.3 em.
- `f-text.mjs` runs the scenario files `scen-*.mjs`: `stops`, `rot`, `punct`, `script`, `italic`, `colon`, `desc`.
- `f-dust.mjs` places hard specks of 3–7 px² at known places. `f-corners.mjs` scores stars, arrows and needles with Q4's `score()`.
- `f-false.mjs`, `f-sizes.mjs`, `f-ink.mjs`, `f-ink2.mjs`, `f-mixed.mjs`, `f-greyline.mjs` and `f-greyline2.mjs` cover the route and ink checks. `f-pango.mjs` draws hinted text through `sharp({text})`.

**Burn.**
- `burn-tests/zz-r2-burn.test.ts` and `zz-r2-island.test.ts` ran in `j7-main/src/io/gcode/` with `zz-r2-vitest.config.ts`, one at a time. They were moved out afterwards.
- `planner-lib.mjs` is N8's `planner.mjs` arithmetic as a function; on the 0.3 mm bars it gives N8's 1.462×.
- `burn-table.mjs` joins the log and the dose.

**Test truth.** `zz-r2-vitest.config.ts` has an `R2_PARENT` switch: a Vite `load` hook serves a PR's implementation files from `zz-r2/p<PR>/` (each `git show <merge>^1:<file>`) and leaves its tests and everything else on main.

**Rebuild:**
1. `node build-engine.mjs && node build-debug-r2.mjs && node build-parent.mjs`
2. `cd q4 && node bench.mjs --out out/results.jsonl --dump 1 && node tally-n8.mjs out/results.jsonl "" 1`
3. `JPEGQ=75 node bench-jpeg.mjs --out out/results-jpeg75.jsonl --speckle 0` (then 60 and 50); `VARIANT=<v> node bench-var.mjs --out out/v-<v>.jsonl --speckle 0`
4. `cd ../q5 && node run5.mjs logo all && node run5.mjs logo dim,salt && node run5.mjs text all && node run5.mjs text dim,salt && node run-stab.mjs arch`, then `node stab-raw.cjs out/stab.jsonl out/stab-rawmk.jsonl && node tally5.mjs out/results.jsonl out/stab-rawmk.jsonl`
5. `R2_PRE=file:///<scratchpad>/zz-n8/engine.mjs R2_P17=file:///<scratchpad>/zz-r2/engine-parent1517.mjs node f-greyline2.mjs`
6. `node f-rotstops.mjs`, `THR=0.3 node f-text.mjs colon`, `node f-ink2.mjs`, `node f-sizes.mjs`, `cd q4 && node f-corners.mjs`, `node f-spikes3.mjs`

**Repo temp files.** Under `j7-main`: `src/io/gcode/zz-r2-burn.test.ts`, `src/io/gcode/zz-r2-island.test.ts` and `zz-r2-vitest.config.ts`, each deleted by literal path. Copies are in `zz-r2/burn-tests/`. Nothing else under `j7-main` was touched, and the `zz-r1*` and `zz-r4*` files were left alone.

### Refuter method

Fresh context; own code in a scratchpad folder `zz-r2r/`, deleted afterwards, as instructed. From `zz-r2` I reused only the engine bundles (`engine.mjs`, `engine-parent1517.mjs`, `debug-engine.mjs`) and, for set identity, the shapes and rasteriser in `q4/geom.mjs`. The fills, the Potrace SVG reader, the marks, the tallies and the scoring are mine.

**Recounted vs re-measured.**
- **Recounted, no trace run:** own tally code over the auditor's `results*.jsonl`, `v-ink80`, `large` and `large-g` rows. Every tally matches. Also the same rows under other weightings.
- **Re-measured, fresh traces:** the 79 images, clean and JPEG q75. Metrics: XOR area at 8 × 8 samples over truth perimeter (mean displacement), one-way distance to the truth ring, raw segments, and parts plus holes against truth. Ties as Q4's rule (10% or 0.02 px, 10% or 0.05 px, 10% or 1 segment). A different scorer from Q4's nine metrics, with no corner metric at all.
- **Everything below used new scenes or a new renderer; none reran an `f-*.mjs`.**

**Variant bundles** (esbuild `onLoad`; files on disk unchanged):
- `v-other`: reads enlarged pixel `2x`, not `2x + 1`.
- `v-native`: a source pixel takes the enlarged class only when its whole block agrees, otherwise its native class.
- `v-pre1516`: `small-mark-neighbourhood` and `small-mark-policy` from `7f34370cd`, the parent of #1516.
- `v-noflat`: `flattenStraightRuns`' second pass off on corner-free loops.

**Scenes and renderer.**
- **R2-P1-1:** bars at 2 and 3 px, 12 bar placements on 4 canvas sizes, 5 inks; 1 px bars and grid; a barcode; 1-bit text in Arial, Verdana and Times from sharp, in grey and colour, counting parts and holes.
- **R2-P1-2 and P1-3:** SVG text through sharp (librsvg and Pango, not opentype), the mark in a red `tspan`. In one image, G is the input and R − G is the mark's own ink, so no separate geometry is needed. 6 new sentences × 6 fonts × 3 sizes at 0°, 5°, 45°, 90°, 180°; 5 colon strings and 6 descender strings × 8 fonts × 8 sizes. A mark counts as kept when the trace covers at least 30% of its ink.
- **R2-P2-1 and P2-2:** discs measured against the analytic circle (radial error).
- **R2-P2-3:** own Vitest matrix through `prepareOutput`, `constantPowerWarnings` and `detectJobIntentWarnings`, with overscan default, Automatic, 0, 1 and 20 mm. Own G-code reader and a forward and backward planner pass with unlimited look-ahead, which is a lower bound on the dose.
- **R2-P2-4:** distance from any traced point to the nearest pixel holding more than 2% ink in the clean image.
- **Temp files.** `j7-main/zz-r2r-vitest.config.ts` and `src/io/gcode/zz-r2r-island.test.ts`, each deleted by literal path. Nothing else under `j7-main` was touched.

## Findings

### R2-P1-1 — Regression from #1517: on the 2× route, Line Art adds a pixel to thin strokes in coloured ink and removes one in mid-grey ink; before #1517 and on Potrace the same pixels trace to width

- **Where:**
  - `src/core/trace/staircase-source.ts:80-85`: `wx = Math.floor((x + 0.5) * scaleX)`. On a 2× grid that is enlarged pixel `2x + 1`, whose centre is at source `x + 0.75`, a quarter of the way to the next source pixel.
  - The comment at `:18-20` calls it "the enlarged pixel at its centre: a nearest-neighbour enlargement's block". For a saturated step that is true: 0 + 0.25 × 255 = 64 stays under Line Art's cut at 128.
  - With ink at luma I against white, the sample reads I + 0.25 × (255 − I), which passes 128 at I ≈ 86. So every ink pixel with paper to its right or below turns to paper.
  - Coloured ink takes Line Art's local-detail mask (report `localDetailAdded: true`). There the stroke grows by a pixel on its left and top side: the sample of the pixel before the edge reads a mask that reaches past the edge on the enlarged grid. This branch's cause is inferred from the output row below, not probed.
  - **Why it is new.** `isStaircaseSource` (`:52-66`) now calls this art two-level (ADR-530 Amendment 12). Before #1517 the fixed cut at 128 made its cracks count as measured, so it stayed on the enlarged trace.
- **Anchor:**
  - **Twin.** The same art in black keeps its width. The parent of #1517, on the same pixels, keeps its width in red and in grey up to luma 100.
  - **Contract.** ADR-530 Amendment 12, Decision 2: "A near two-level source then traces as its clean art." Consequences: "Two-level art in a pale or coloured ink takes the source grid on every preset."
  - **Ground truth.** The bitmap's own pixels; Potrace on the same greymap.
- **Scenario.** A crisp PNG with thin strokes on white, in one flat non-black ink: a recoloured line drawing, a barcode, a 1-bit word in teal. Either its longest edge is 90–99 px, or it trips the thin-stroke trigger (strokes under about 3 px, any size to 1.5 Mpx). Traced with Line Art (the Free default). Strokes burn a pixel wider or narrower than the source, with nothing to tell the operator. The preview shows the result, which is not a warning (METHOD §3).
- **Evidence:** REPRO (`f-greyline2.mjs`, `f-fatprobe.mjs`). Share of the true ink pixels the fill covers, with "+n" the extra paper covered as a percentage of the ink:

  | Art | Ink | **Main** | Parent of #1517 | Potrace |
  |---|---|---|---|---|
  | 3 px bars, 90 × 60 | black | 100% | 100% | 94% |
  | same | red (76), teal (90), mid blue (98), crimson (78) | **100% +35** | 100% +2 to +3 | 94% |
  | same | grey #5a5a5a, #646464 | **68%** | 97% | 94% |
  | 2 px bars, 90 × 60 | red, teal, slate | **100% +51** | 100% +43, +17, +6 | 91% |
  | same | magenta (105), grey #5a5a5a, #646464 | **55%** | 96% | 91% |
  | 2 px grid, 300 × 200 (thin-stroke trigger) | grey #5a5a5a, #646464 | **52–53%** | 99–100% | 100% |
  | 2 px bars, 300 × 100 | red, teal, crimson | **100% +51** | 100% +3 to +4 | 90% |
  | same | grey #5a5a5a, #646464 | **49%** | 93–98% | 90% |
  | 1-bit word "Sample" 24 px | magenta; grey #646464 | **48%** | 65%; 71% | 91% |
  | same | red, teal, crimson | 98% **+19** | 100% +8 | 91% +6 |

  - **The row of one stroke, red 3 px bars at y = 30:** truth `....###.`, main `...####.`.
  - **Where main improves:** ink very near the cut (grey #787878, slate) was worse before #1517: 2 px grid 18% and 7%, now 52%. Smooth on the grey ladder keeps 94–100%, because its cut follows the tones (colours were measured on Line Art only). Black is untouched.
  - #1517's tests pin discs in luma 40 and 110 on a 48 px canvas only, the 3× route. They count segments, not width.
- **Severity note.** Raised as P1: the trace's geometry differs from the source by up to half a stroke, on the Free default, with no warning, and it is new in this round. A refuter who treats a one-pixel stroke error as a quality loss rather than wrong output could argue P2.
- **Fix direction:**
  - Keep the native mask for pixels no cleanup changed. The refuter's `v-native` does this and gives 100% +0 on every bar scene and ink.
  - The first draft also offered a majority of the enlarged block. By arithmetic that does not work: an eroded grey edge pixel and a falsely grown red pixel are both 2 of 4 in their block, a tie with opposite right answers.
  - Pin it with stroke-width tests on the 2× route: 2 and 3 px bars at 90 × 60 and 300 × 100, in red, teal and grey at luma 90–120, and parts and holes of 1-bit grey text.
- **Refuter: CONFIRMED, P1 kept, on narrower grounds.**
  - **What would make it false:** the parent also erodes, or the sample is not the cause, or the output is only a width error with no shape lost.
  - **Grey half: a real regression, and the cause holds.** Over 12 placements on 4 canvases, grey 90 and 110: main keeps 49% (2 px) and 65% (3 px); the parent 95–100%. `0.75 × 90 + 0.25 × 255 = 131`, over the cut. `v-other` mirrors the same numbers from the other side, and `v-native` gives 100% +0 everywhere.
  - **Coloured half: not a clean regression.** The table's "parent +2 to +3" is one bar placement. At 90 × 60 and 96 × 64 the parent's 3 px bars range +4 to +64 (mean +42), main's +4 to +37 (mean +25 to +36). On 2 px bars the parent is worse at every size (mean +56 to +97, main +34 to +51). The parent is better on 3 px bars at 300 × 100 (mean +21 to +23 vs +23 to +34), about level at 500 × 300, and better on 1-bit coloured text (Arial 24 px +14 vs +23). `v-native` fixes this branch too, so it is the same enlarged mask, already wrong before #1517.
  - **Why P1 and not P2.** Bars alone would be P2: no bar is lost and the parts match. But hard grey text loses shapes and holes, with no warning. Line Art on 1-bit "Sample gear 8ab" in luma 100:

    | Font, px | Source parts / holes | Main | Parent | Smooth | Potrace |
    |---|---|---|---|---|---|
    | Arial 20 | 13 / 10 | **41%, 34 / 0** | 61%, 30 / 1 | 98%, 13 / 10 | 89%, 13 / 9 |
    | Arial 24 | 13 / 10 | **47%, 27 / 1** | 70%, 19 / 3 | 97%, 13 / 10 | 93%, 13 / 10 |
    | Verdana 20 | 13 / 10 | **42%, 37 / 0** | 68%, 29 / 0 | 97%, 13 / 10 | 92%, 13 / 10 |
    | Times 32 | 13 / 10 | **57%, 34 / 0** | 78%, 23 / 0 | 96%, 13 / 6 | 93%, 13 / 9 |

    That is the trace clarification's case and contradicts ADR-530 Amendment 12, Decision 2 ("traces as its clean art"). The parent tears this text too, less badly, so on text #1517 worsened an old defect rather than creating it. How common the art is does not lower it (METHOD §3).
  - **Scope.** Saturated black is untouched. Smooth and Sharp keep 96–100% with almost all their parts. Anti-aliased luma 100 text also thins on Line Art (Arial 20 px 43%, 34 parts): that is the fixed cut at 128 on a low-contrast edge rather than this sample, and it was not compared with the parent.

### R2-P1-2 — Full stops still vanish from rotated text: the text-baseline rule only reads horizontal baselines, so a turned sentence loses 10–20% of its stops where Potrace and Sharp keep them

- **Where:**
  - `src/core/trace/small-mark-text-line.ts:59`: `tolerance = Math.max(1, Math.round(input.baselinePx))`, one source pixel.
  - `:64-72` and `:85`: a letter counts only when its axis-aligned box bottom is within that tolerance of the dot's bottom row.
  - On a turned line, neighbouring letters' box bottoms differ by more than a pixel past a few degrees. At 90° and 180° the dot's bottom row is not the baseline at all.
  - `small-mark-neighbourhood.ts:136-139` then counts the stop as a lone speck. `small-mark-policy.ts:291-292` drops it: not pen-wide, not on a text line.
- **Anchor:**
  - **Contract.** The Auto tooltip promises to "keep drawn dots" (`TraceCheckboxRow.tsx:65`). ADR-434 Decision 3d: "Stipple, dotted rows and small text pass". The trace clarification in `2026-10-27-quality-q1/AREAS.md` puts a promised mark lost with no warning at P1. ADR-434 Amendment 3 does not mention rotation; its one stated consequence is about specks on a baseline.
  - **Twin.** The same sentences at 0° keep 144 of 144.
  - **Ground truth.** Potrace 1.16 on 1-bit keeps 144 of 144 at every angle. Sharp, with no small-mark policy, keeps 144 of 144 from 5° to 45°.
- **Scenario.** A scanned page placed crooked, a photographed label, a caption drawn at an angle, vertical text on a drawing, an upside-down scan. Roboto or Arial at 20–28 px, traced with Line Art or Smooth. Final stops disappear. The maintainer's brief names rotated or skewed scanned text as a common input.
- **Evidence:** REPRO (`f-rotstops.mjs`, `f-rotprobe.mjs`, `f-text.mjs rot`).
  - **The set:** 8 everyday sentences × 3 sizes × 4 fonts (Roboto, Arial, Calibri, Verdana), one image each. Full stops identified on the unrotated outline. Tinos holds at every angle and is left out of these totals: it keeps all 36 stops, and the script's "small" filter also picks up 13 non-stop serif contours there.

  | Angle | Line Art AA | Line Art 1-bit | Smooth AA | Smooth 1-bit | Sharp AA | Potrace 1-bit | Pre-fix Line Art AA / 1-bit |
  |---|---|---|---|---|---|---|---|
  | 0° | **144** | 143 | 144 | 143 | 137 | 144 | 62 / 103 |
  | 2° | 144 | 143 | 144 | 143 | 143 | 144 | |
  | 5° | **129** | 132 | 129 | 131 | 144 | 144 | 70 / 100 |
  | 10° | **130** | 122 | 131 | **108** | 144 | 144 | 72 / 112 |
  | 15° | 129 | 128 | 128 | 119 | 144 | 144 | |
  | 30° | 132 | 126 | 133 | 129 | 144 | 144 | |
  | 45° | **114** | 110 | 113 | 105 | 144 | 144 | 60 / 99 |
  | 90° | 127 | 119 | 126 | 112 | 135 | 144 | 63 / 109 |
  | 180° | 126 | 114 | 123 | 113 | 144 | 144 | |

  - **By font at 5° / 10° / 90° / 180°, Line Art AA, of 36:** Roboto 30 / 32 / 29 / 28; Arial 27 / 26 / 26 / 26. Calibri and Verdana keep 36.
  - **A paragraph, not single lines** (7 lines × 3 sizes, all small marks including i-dots, Roboto): 5° Line Art AA 63 of 68, 1-bit 56; 45° 54 and 52; 90° 56 and 45. Potrace 1-bit 65–68.
  - **Mechanism, from the probe.** Roboto "Call us today." at 24 px, 5°: the 1× pass keeps it (`onLine true`). The 2× pass, which is the output, gives `size 6.50, debris 0, onLine false, stroke Infinity → DROP`. At 90° (`Have a good day.`): `onLine false, stroke 9.85, strokeWidth 10 → DROP` on the same pen-width rule N8 named.
  - **Pre-fix is worse at every angle** (table), so #1516 improved this. It is N8-P2-1's defect on rotated text, not a regression.
  - Italic and bold fonts at 0° hold: Line Art matches or beats Potrace on Arial, Times, Georgia, Calibri and Verdana italic and on the bold fonts, except 1-bit Times italic (36 of 45 against 42).
- **Fix direction:**
  - Estimate the local text direction before the baseline test: fit a line through the bottoms of nearby letter-sized components, then measure the dot against that line, or test four orientations.
  - Or relax the rule for a compact, solid dot within an em of letter-sized ink, with the dust veto still running first.
  - Pin it with the sentence set at 5°, 10°, 45°, 90° and 180°.
- **Refuter: CONFIRMED, P1 kept, smaller than the first count.**
  - **What would make it false:** the loss comes from the auditor's opentype renderer or font set; or a notice tells the operator; or the app promises nothing about rotated text.
  - **Own renderer and new sentences, 126 stops, Line Art anti-aliased:**

    | Angle | Line Art AA | Line Art 1-bit | Smooth AA | Sharp AA | Potrace 1-bit | Pre-#1516 Line Art AA |
    |---|---|---|---|---|---|---|
    | 0° | 125 | 120 | 125 | 126 | 125 | 106 |
    | 5° | **120** | 120 | 120 | 126 | 126 | 109 |
    | 45° | **120** | 114 | 120 | 126 | 124 | 106 |
    | 90° | **120** | 117 | 121 | 125 | 125 | 109 |
    | 180° | **120** | 117 | 121 | 126 | 125 | 106 |

  - **Size.** About 5% of stops, against the first count's 10–21%: the rate depends on the sentences. The same fonts lose them: Arial, Times and Verdana lose some; Calibri, Georgia and Tahoma keep all 21 anti-aliased. Not a regression: pre-#1516 is worse at every angle.
  - **No warning.** No notice in the trace dialog reports removed marks; the preview is not a warning. The tooltip's "keep drawn dots" and ADR-434's "small text pass" carry no angle limit. A single dot on a turned page does look like dust to a rule that reads only boxes, which explains the defect but does not make the output right.
  - The line citations hold (`small-mark-text-line.ts:59,85`, `small-mark-policy.ts:291-292`).

### R2-P1-3 — A colon loses both dots, and a stop beside only descenders goes: the baseline rule leaves the colon's top dot a lone speck, and that speck vetoes the bottom dot

- **Where:**
  - `small-mark-neighbourhood.ts:136-139`: the colon's top dot is not on a baseline, so it stays a lone speck in the census.
  - `small-mark-policy.ts:285`: the bottom dot, which *is* on the baseline (`onLine true`), sees it as debris and goes.
  - ADR-434 Amendment 3, Decision 4 fixed exactly this for stops ("so stops do not veto each other"), not for the two dots of one character.
  - `small-mark-text-line.ts:77-89`: a letter must end on the dot's row, so a descender does not count. A stop beside only descenders has no baseline letter.
- **Anchor:**
  - **Contract.** As R2-P1-2. "Keep drawn dots"; small text passes.
  - **Ground truth.** Potrace 1.16 and Sharp keep them on the same pixels.
  - **Twin.** The colon survives at 28 px, or wherever a neighbouring stroke sits within 5 px.
- **Scenario.** "Scale 1:10" on a drawing, "Ratio 2:3", "Time: 10:30", a standalone "y." or "spy." The colon or the stop is not in the output.
- **Evidence:** REPRO (`f-lost.mjs`, `f-text.mjs colon`, `f-text.mjs desc`).

  | Text, anti-aliased | Line Art | Potrace 1-bit |
  |---|---|---|
  | "Scale 1:10" Times 20 / 24 px | **0 / 2, 0 / 2** colon dots | 2 / 2 |
  | same, Tinos 24 px; Verdana 20 px | **0 / 2; 0 / 2** | 2 / 2 |
  | Over 18–28 px, "Scale 1:10", all marks: Times; Tinos; Verdana | **7 / 13; 7 / 11; 8 / 10** | 13; 11; 10 |
  | Seven colon strings × 10 fonts × 5 sizes, all marks, AA / 1-bit | 928 / 891 of 946 (pre-fix 884 / 872) | 918 (grey 888) |
  | "y." standalone at 24 px, Roboto (also Arial 1-bit); "Q." at one of 20 / 24 / 28 px | 0 / 1 | 1 / 1 |
  | Eleven descender-ending strings × 6 fonts × 3 sizes, **1-bit** | **244 of 270** (Smooth 245) | **269** |

  - **Probe, Times "1:10" at 20 px:** top dot `size 4.8, debris 0, onLine false, like Infinity → DROP`; bottom dot `size 4.9, debris 1, onLine true → DROP`.
  - **Everyday punctuation otherwise holds.** Comma, semicolon, apostrophe, quote marks, "!", "?", ellipsis, decimals, dates, "%", abbreviations, small caps and hyphens over 9 fonts × 3 sizes: Line Art AA 5,837 of 5,874, 1-bit 5,804, Potrace 1-bit 5,726, Potrace grey 5,548, Sharp 1-bit 5,873. Line Art beats Potrace overall. The anti-aliased losses that remain are mostly colons and "%" parts at 20 px.
  - **Times "%" at 20 px on Line Art AA:** the four small parts measure 12.9–14.1 px² and go, although they are above the 12 px² candidate cap on the probe's size. Not root-caused; recorded under Not verified.
- **Fix direction:**
  - Treat a mark vertically stacked with a like mark within about an em (a colon, an ellipsis stood upright, an "=") as supported by it, and do not count it as a lone speck. Do not count a mark with a stacked partner as debris against that partner.
  - Let a descender's letter body serve as baseline evidence: the rows where most of the nearby letter's ink ends, not its box bottom.
  - Pin it with "Scale 1:10" at 20 and 24 px in Times, Tinos and Verdana, and "y." at 24 px.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would make it false:** the case is one font's quirk, or Potrace loses them too, or the veto is not the mechanism.
  - **"Scale 1:10", dots kept of 2, own renderer:**

    | Font, px | Line Art AA | Line Art 1-bit | Smooth AA | Smooth 1-bit | Sharp AA | Potrace 1-bit | Pre-#1516 Line Art AA |
    |---|---|---|---|---|---|---|---|
    | Times 18 | 0 | 0 | 1 | 0 | 1 | 1 | 0 |
    | Times 20 | 0 | 0 | 0 | 0 | 2 | 1 | 0 |
    | Times 22, 24 | **0** | **0** | **0** | **0** | 2 | 2 | 0 |
    | Times 26 | 0 | 2 | 0 | 2 | 2 | 2 | 0 |
    | Verdana 20 | **0** | 2 | **0** | 2 | 2 | 2 | 0 |
    | Verdana 22 | 2 | **0** | 2 | **0** | 2 | 2 | 0 |
    | Arial 28 | 2 | **0** | 2 | **0** | 2 | 2 | 0 |
    | Georgia 18–28 | 2 | 2 | 2 | 2 (1 at 22 px) | 2 | 2 | 2 |

  - **Probe, Times 24, reproduces the mechanism exactly:** top dot `debris 0, onLine false, no support → drop`; bottom dot `debris 1, onLine true → drop`, on both grids.
  - **Totals, all sizes 16–32 px, 8 fonts.** Colons: Line Art AA 573 of 640, Smooth 611, Potrace 1-bit 578, pre-#1516 542. Line Art **1-bit 504**, Smooth 1-bit 511. Stops after descenders: Line Art AA 331 of 384, Smooth 355, Potrace 348, pre-#1516 222. Line Art **1-bit 290**, Smooth 1-bit 302. So on anti-aliased totals Line Art is level with Potrace: the loss is whole colons on particular strings, and 1-bit is clearly behind. Potrace also loses at 16 px (35 of 80 against 33).
  - **Wider than stated.** "spy." goes on Arial 22–26 px and Times 26 px although "s" sits on the baseline nearby. Probe, Arial 24: `onLine false`. So "only descenders" is too narrow; why the "s" does not count was not root-caused.
  - #1516 improved all of this, so it is not a regression. "1:10" reading as "1 10" is a promised mark lost with no warning.

### R2-P2-1 — Line Art still draws hard non-black art at 100 px and up on its pixel staircase; ADR-530 Amendment 12 says two-level art in a coloured ink takes the source grid on every preset, but the route exists only under 100 px and for thin strokes

- **Where:**
  - `src/core/trace/trace-to-paths.ts:211-213`: the two-level test runs only inside `traceUpscaledImage`, when `factor > 1`.
  - A source over 100 px with strokes of 3 px and up walks natively. There the fixed cut at 128 places every crack off its midpoint. The loop reads as a measurement and the fit follows the staircase. `stepField` (`staircase-source.ts:104-113`) never applies.
  - A second route to the same output: **two inks on one sheet.** A crack between the second ink and paper is not a step against the single mid-level (`:150-153`), so about half of the cracks fail the 2% share (`:43`). This holds for Smooth too.
- **Anchor:**
  - **Contract.** ADR-530 Amendment 12, Consequences (line 997): "Two-level art in a pale or coloured ink takes the source grid on every preset." Measurements: "A disc in ink at luma 40, 80 or 110 draws 6 cubics on Line Art" (measured on a 48 px canvas).
  - **Twin.** The same bitmap in black: Line Art 4 segments and 0 inflections at 150 px. Smooth, whose cut follows the tones, is fine on one ink at any size.
  - **Ground truth.** Potrace on the same greymap.
- **Scenario.** A hard-edged logo in navy, red or grey, 100 px wide or more, traced with the Free default. Bumpy curves and rippled edges, the Q4-P2-1 output.
- **Evidence:** REPRO (`f-ink.mjs`, `f-ink2.mjs`, `f-false.mjs`, `bench-var.mjs`).

  | Art, hard edges, Line Art | Black | Other ink | Potrace |
  |---|---|---|---|
  | Disc, 150 px canvas, grey luma 40 / 80 / 120 | 4 segments, 0 inflections | **46, 28 / 47, 30 / 48, 32** | 6, 1 |
  | Disc, 300 px canvas, grey 40 / 100 | 9, 0 | **96, 65 / 100, 68** | 10, 0 |
  | Disc, 400 px canvas, grey 80 | 24, 2 | **134, 103** | 10, 1 |
  | "Logo & Co" Roboto 72 px: red; navy; grey 80 | 103, 22 | **176, 68; 175, 76; 172, 59** | 103, 18 |
  | 79 images in luma 80, W / T / L | 51 / 20 / 8, 813 segments | **38 / 14 / 27, 1,875 segments**, 15.3 inflections per smooth shape | 700 segments |
  | Same, by size of the 27 losses | | 13 at 200 px, 9 at 64 px, 3 at 96 px glyphs, 2 at 32–48 px | |
  | 79 images, hard ink on a 170–255 paper ramp | | 39 / 25 / 15 | |

  - **#1517 did help the small route.** Pre-fix the luma 80 set was 5 / 2 / 72 and the ramp 12 / 16 / 51. Saturated colours on a plain disc stay smooth, because they take the local-detail mask: red disc at 150 px 3 segments, 0 inflections. The logo row shows that does not generalise.
  - **Two inks, hard edges.** One disc half black and half luma 90 on a 96 px canvas: Line Art 47 segments, 36 inflections; Smooth 45, 36; Potrace 5, 1; 49% of its cracks are not steps. At luma 120: 50, 40 and 61, 52. After q75 the same.
- **Fix direction:**
  - Run the two-tone step test on the native route too, and apply `stepField` there.
  - For several inks, judge each crack against its own two sides' plateaus rather than one image-wide mid-level.
  - Add the ink ladder at 150 and 300 px, and a two-ink disc, to `staircase-source.test.ts`.
- **Refuter: CONFIRMED, P2 kept, anchor corrected.**
  - **What would make it false:** the ADR limits its claim to small sources, or the output is not worse.
  - **The ADR sentence, read literally, is not broken.** A source at 100 px and up walks natively, which is its source grid, so "takes the source grid on every preset" is true there. What fails is Decision 2's "A near two-level source then traces as its clean art": that step field exists only on the upscale route. The ADR states no size limit for it, and measured only a 48 px canvas. The defect stands; cite Decision 2 and the twin.
  - **A cliff at 99 / 100 px, new detail.** Hard disc, Line Art, segments: grey 40 **4 at 99 px, 33 at 100 px**, 43 at 150, 94 at 300, 141 at 400. Black: 4, 3, 4, 12, 24. Potrace: 10, 10, 5, 10, 9. Smooth holds at 3, 3, 5, 7, 12.
  - **It is not always less accurate.** Grey 40 at 150 px has 0.157 px radial error against Potrace's 0.204: the cost is the staircase, 9× the segments, not distance from the circle. Grey 110 is worse, 0.282 px.
  - **Saturated discs are not safe at every size.** Red, navy and teal hold to 300 px (10–12 segments). At 400 px teal draws 149, red 30, navy 23. The finding's "saturated colours stay smooth" stops somewhere between 300 and 400 px.
  - The 79-image luma 80 tally and its 1,875 segments recount exactly.

### R2-P2-2 — Large one-bit art is not better than Potrace on curves: 3–6× the segments and up to 4× the error on a circle, and every large glyph but one loses

- **Where:** the native binary route: `contour-trace.ts:483-489` (`flattenStraightRuns`) and the fit after it. Segments split into lines where a long gentle arc reads as straight.
- **Anchor:** Ground truth: the analytic outline, Potrace 1.16 on the same bitmap. N8's K1 and Q4-P3-3 record this for 96 px glyphs only. Q4 stopped at 200 px and N8's circle table at 160 px.
- **Scenario.** A 1-bit scan or a black-and-white PNG logo, 500 px and up, traced with Line Art or Smooth. A round shape comes back as many short pieces, and the fit sits further from the true curve than Potrace's. At ordinary burn scales the half-pixel error is small, but the fit is measurably worse.
- **Evidence:** REPRO (`f-sizes.mjs`, `bench-var.mjs`, `large-rows.cjs`). Disc, diameter 0.66 × canvas, segments / inflections / mean error in px:

  | Canvas | Line Art | Smooth | Sharp | Potrace |
  |---|---|---|---|---|
  | 256 | 7 / 1 / 0.128 | 6 / 0 / 0.130 | 65 / 46 / 0.171 | 9 / 0 / 0.189 |
  | 512 | **41 / 7 / 0.364** | 50 / 12 / 0.382 | 163 / 138 / 0.175 | 12 / 0 / 0.164 |
  | 1024 | **62 / 0 / 0.522** | 76 / 12 / 0.434 | 345 / 323 / 0.157 | 13 / 0 / 0.134 |
  | 1500 | 80 / 2 / 0.471 | 86 / 11 / 0.387 | 480 / 457 / 0.158 | 15 / 1 / 0.122 |
  | 3000 | 111 / 2 / 0.383 | 58 / 2 / 0.512 | 993 / 977 / 0.155 | 19 / 0 / 0.104 |

  | Q4 shape, canvas 1.5 × size | Line Art err / Hausdorff, segments | Potrace |
  |---|---|---|
  | circle@400 | 0.388 / 1.32, 33c + 9l | 0.144 / 0.52, 11c |
  | circle@800 | 0.369 / 1.14, 18c + 58l | 0.127 / 0.71, 11c |
  | ring@800 | 0.367 / 1.14, 49c + 79l | 0.134 / 0.71, 23c |
  | Roboto a@384 | 0.239 / 2.08, 28c + 10l | 0.186 / 0.76, 20c + 15l |

  - **Totals:** 31 shapes at 400–800 px score 17 / 4 / 10 (Sharp 13 / 10 / 8, Smooth 17 / 4 / 10), 1,060 segments against 262. Line Art wins on stars and polygons (star@800 0.025 against 0.101) and loses every smooth shape. Glyphs at 192 and 384 px: **0 / 1 / 9**, Sharp 2 / 1 / 7, Smooth 0 / 2 / 8.
  - **Anti-aliased art at the same sizes does not have this problem:** 1024 px disc Line Art 8 segments at 0.044 px, Potrace 10 at 0.139.
  - **Same after JPEG or WebP, and identical when inverted.** q75 at 1024: 62 / 4 / 0.386.
  - **Not a regression.** #1516 and #1517 do not touch this route. It is new here because no earlier round measured these sizes.
- **Fix direction:**
  - Root-cause first: the refuter's `v-noflat` shows the flatten pass is not what adds the segments.
  - Try applying the corner-free smooth fit of the small route to long binary arcs. Between 256 and 512 px the fit stops smoothing the staircase.
  - Add 400 and 800 px, and 192 px glyphs, to the scorecard.
- **Refuter: CONFIRMED, P2 kept; stated cause refuted; partly KNOWN.**
  - **What would make it false:** the auditor's error metric, or a size-specific artefact.
  - **Own disc, own radial error to the analytic circle (segments, mean / max px):**

    | Canvas | Line Art | Smooth | Line Art, second flatten off | Potrace |
    |---|---|---|---|---|
    | 256 | 7, 0.126 / 0.48 | 6, 0.146 / 0.46 | 10, 0.193 / 0.50 | 9, 0.213 / 0.70 |
    | 512 | **41, 0.436 / 1.11** | 50, 0.439 / 1.08 | 89, 0.454 / 1.17 | 12, 0.183 / 0.83 |
    | 1024 | **62, 0.529 / 1.15** | 76, 0.460 / 1.12 | 402, 0.425 / 1.18 | 13, 0.155 / 0.65 |
    | 1500 | 80, 0.483 / 0.99 | 86, 0.405 / 1.06 | 654, 0.415 / 1.27 | 15, 0.144 / 0.70 |

  - **The "Where" is wrong as a cause.** With `flattenStraightRuns`' second pass off, the segments rise sixfold and the error stays. That pass is holding the count down, not raising it. The loop's first pass is already skipped when there are no corners. The real cause, somewhere in the fit past 256 px, is not found. A half-pixel error is what following the staircase looks like.
  - **New or KNOWN.** Partly KNOWN: Q4-P3-3 and N8 K1 record 96 px glyphs, and the recount gives 96 px letters Line Art 0 / 2 / 3. The large-size extent is new.
  - **Why not higher.** The quality rules name "worse edge fidelity than Potrace" as their P2 example, and the maintainer's goal does not change the rating. No shape is lost. At an ordinary 0.1 mm per pixel this is 0.05 mm. It does belong in the headline, and it does.

### R2-P2-3 (raised to P1 by the refuter) — ADR-257 Amendment 2 names island fills, but they never get the M3 advice: a 0.3 mm stroke's island fill burns 1.65× at the default speed and 6.6× at 6000 mm/min with no constant-power notice

- **Where:** `src/ui/laser/constant-power-warnings.ts:170`: `moves.length < ahead` → `continue`. An island sweep has one span per row, so every sweep is skipped. `narrowestFillStretch` returns null, and `:134` returns no advice.
- **Anchor:**
  - **Contract.** ADR-257 Amendment 2, Decision 1: "Scan Line and island fills get Amendment 1's image test".
  - **Twin.** The same bars as Scan Line at 6000 mm/min: advice at 1.46×.
  - **Ground truth.** `grbl-fill-emission` bytes under M3: each island row is `G1 … S600` between two 0.15 mm `G0` runways at a reversal, so the head never reaches the feed.
- **Scenario.** GRBL Compatible machine, Fill set to Island on small text or thin strokes. No "burns with constant power (M3)" notice at Save, Start or Job Review. Only the existing heat notice appears: "Island Fill has 600 short sweep(s) that need partial acceleration runway… test on scrap if those small islands look darker". That notice reads the same under M4, where the dose is 1.00×, and does not name power or the GRBL Dynamic remedy.
- **Evidence:** REPRO (`zz-r2-island.test.ts`, `burn-table.mjs`; dose table in the Scorecard). Own planner model. 0.3 mm strokes: 1.645× at 1500 mm/min, 3.290× at 3000, 6.579× at 6000. 1 mm: 1.011×, 1.837×, 3.673×. 3 mm: 1.000×, 1.082×, 2.132×. `constantPowerWarnings` returns 0 entries in all of them. Scan Line on the same art: 1.000×, 1.000×, 1.462×.
- **Why P2, not P1.** N8-P2-5 was raised to P1 for 1.46× with **no** notice. Here a notice does say the islands may look darker and to test on scrap, so an operator is told something, though not the cause or the fix. METHOD §3 lets a finding drop when a clear warning reaches the operator; the refuter should judge whether this one is clear enough.
- **Fix direction:**
  - For an island sweep, take the window across the row's own span, runways and reversal (the row is one burn every few moves), or add a constant-power clause to the island heat notice under M3.
  - Or correct Decision 1 to say islands are covered only by that notice. Add a test beside `constant-power-warnings.test.ts`.
  - Whichever is chosen, close the silent paths below: `fill-heat-risk.ts:111` returns for overscan 0 and for sweeps of at least twice the overscan.
- **Refuter: CONFIRMED, raised to P1.**
  - **What would make it false:** the code path gives advice some other way; or the dose model is wrong; or the existing notice is a clear warning on every path.
  - **Advice:** 0 in all 60 combinations of 4 stroke widths, 5 overscans and 3 speeds on GRBL Compatible. `constant-power-warnings.ts:170` is the skip, as stated.
  - **Dose, second line of evidence.** My own planner pass with unlimited look-ahead gives the auditor's 1.64× / 3.29× / 6.58× to two decimals, and it does not change with the rapid rate (100 or 300 mm/s). By hand: 0.3 mm at 500 mm/s² from a 3.5 mm/s corner over a 0.15 mm runway peaks near 18 mm/s, against the 100 mm/s asked. It is still a model, not a burn. M4 stays 1.00× by definition.
  - **Is the notice a clear warning? Not on every path, and arguably on none.**

    | Overscan | Strokes | Dose at 1500 / 3000 / 6000 mm/min | Island heat notice |
    |---|---|---|---|
    | Default 5 mm | 0.3 mm | 1.64 / 3.29 / 6.58× | yes |
    | Default 5 mm | 3 mm | 1.00 / 1.08 / 2.13× | yes |
    | Automatic | 0.3 mm | 1.64 / 3.29 / 6.58× | yes |
    | **0** | **0.3 mm** | **3.09 / 6.17 / 12.34×** | **none** |
    | **0** | **1 mm** | **1.92 / 3.83 / 7.66×** | **none** |
    | **0** | **6 mm** | **1.15 / 1.72 / 3.43×** | **none** |
    | **1 mm** | **3 mm** | **1.00 / 1.22 / 2.44×** | **none** |
    | **1 mm** | **6 mm** | **1.00 / 1.11 / 2.10×** | **none** |

    - **Silent paths.** `fill-heat-risk.ts:111` returns when overscan is 0 or the sweep is at least twice the overscan. There the only notice is the scan-entry runway advisory, which ends "test the scan edges on scrap": row ends, not dose. The field allows 0 to 25 mm (`cut-settings-draft.ts:144`).
    - **Notice present.** It says KerfDesk "will add capped laser-off runway", then to "test on scrap if those small islands look darker". It is word for word the same under M4, where the dose is 1.00×. It gives no size and names neither constant power nor GRBL Dynamic, which is the remedy. An operator cannot tell a 6.6× job from a 1.00× one.
  - **Why P1.** A burn differs in tone from what the app shows with no clear warning, which is the quality P1. It is the Q1-P2-1 class at a larger dose. The coordinator's N8-P2-5 reasoning applies word for word: a runway advisory "about row ends rather than dose" does not count, and that fill was 1.46×. METHOD §3 requires a clear warning about the specific mismatch. The heat notice is closer than the runway advisory, but it does not reach the silent paths, and even where it fires it does not distinguish the dose.

### R2-P2-4 — N8-P2-4's fix does not survive JPEG: anti-aliased serif text after q75 grows spikes up to 2.6 px off the outline again; Potrace on the same pixels has none

- **Where:** `src/core/trace/contour-corner-ink.ts:91,123`: the apex is dropped only when `paper − field(apex) < 2%` of the local contrast. JPEG ringing around the serif moves the field at the apex by more than 2% of the step (about 5 luma), so a wedge in pure paper reads as ink. `:112-120` also takes the brightest pixel in the window as the paper level, which ringing raises.
- **Anchor:**
  - **Ground truth.** Potrace 0 such nodes on the same decoded pixels.
  - **Twin.** The same glyphs anti-aliased without JPEG: 0 on all three presets.
  - **Contract.** ADR-439 Amendment 2's Follow-ups list the 1-bit spikes. #1517's body lists "Sharp on JPEG" of 1-bit art. Anti-aliased text after JPEG, the commonest form of serif text in a downloaded image, is not listed.
- **Scenario.** A JPEG of a page or a sign in a serif font, traced with Line Art, Smooth or Sharp. Serif tips and vertices grow thin spikes.
- **Evidence:** REPRO (`f-spikes3.mjs`). 72 glyph images; nodes turning ≥ 90° that lie ≥ 1 px off the true outline.

  | Input | Line Art | Smooth | Sharp | Potrace |
  |---|---|---|---|---|
  | Anti-aliased | 0 | 0 | 0 | 0 |
  | **Anti-aliased, JPEG q75** | **4 on 4, 2.60 px** | 4 on 4, 2.60 px | **10 on 7, 2.17 px** | 0 |
  | 1-bit | 11 on 9 | 11 on 9 | 5 on 5 | 0 |
  | 1-bit, JPEG q75 | 12 on 10 | 12 on 10 | 17 on 13 | 0 |

  - **Worst:** Tinos M@32 at (35.5, 27.2): turn 165°, 2.60 px off the outline, **2.50 px from any pixel with more than 2% ink**. Tinos x@48: 2.49 / 2.18 px.
  - The count is well down from N8's pre-fix 25 on Sharp. On Line Art it is 4 on JPEG against 0 clean.
- **Fix direction:**
  - Measure the paper level as a median of the window rather than its brightest pixel, and allow for the noise floor: drop an apex whose field is within max(2%, the window's own paper noise).
  - Pin it with anti-aliased Tinos M, N, V and x after q75 in `contour-corner-ink.test.ts`.
- **Refuter: CONFIRMED, P2 kept, rarer than the count suggests.**
  - **What would make it false:** the point is on the glyph after all, or it depends on the auditor's coverage code.
  - **Own coverage and own metric,** distance to the nearest pixel holding more than 2% ink in the clean image. On the same 72 images: Tinos M@32 **2.50 px at (35.5, 27.2)**, the auditor's point exactly, and Tinos x@48 2.18 px, on Line Art and Smooth. Sharp 3 images over 1 px, worst 2.08. Potrace 0, worst 0.65. Clean anti-aliased Line Art 0.
  - **Rate.** The same glyphs at three other sub-pixel placements (216 images): Line Art 2 over 1 px, worst Tinos A@48 2.44 px; Smooth 1; Sharp 3. Through librsvg instead, 126 serif glyph images: Line Art 0, Smooth 1 (1.52 px), Sharp 1. That is 0–3% of glyph images, and the auditor's 4 of 72 uses a looser test (off the outline, not off all ink).
  - **Why it stays P2.** A spike of 2.5 px on a 32 px glyph is visible, and a page has hundreds of glyphs, so a serif JPEG will show a few. No page-sized case was run.

### R2-P3-1 — ADR-439 Amendment 2's apex bound costs some true acute tips on measured loops

- **Where:** `src/core/trace/contour-corner-ink.ts:91,123`.
- **Anchor:** ADR-439 Amendment 2: "A true tip's last pixels each hold some of its ink… about 3% of the step for a 15 degree tip". Its cost on true corners is stated only for Tinos R@24.
- **Evidence:** REPRO (`q4/f-corners.mjs`). Stars, arrows and needles, 32 / 64 / 128 px, 5 sub-pixel placements × 3 rotations, anti-aliased. `33bc394c6` → main, Line Art:
  - Corners kept: 2,066 → 2,048 of 2,475 (Sharp 2,313 → 2,294; Smooth 2,009 → 1,988). Potrace 497.
  - 20° arrow heads: corners 105 → 93 of 315; mean Hausdorff 0.65 → 1.04, max 1.71 → 2.61 px.
  - 20° triangles: 132 → 129 of 135; max Hausdorff 1.71 → 2.56.
  - Unaffected: 5- and 8-point stars (449 / 719 → 449 / 718), 30° and 45° tips.
  - Still well ahead of Potrace on all of it, with mean apex gap 0.271 px against 1.154. An improvement, hence P3.
- **Fix direction:** After R2-P2-4's noise-floor change, re-measure the 2% at 15–20° tips.
- **Refuter: CONFIRMED, P3 kept.** Own triangles, 45 images per angle at 3 sizes, 5 placements and 3 turns, own apex gap, parent of #1517 → main, Line Art: 20° 0.102 → 0.200 px mean, max 1.23 → 2.47; 15° 0.578 → 0.640; 30° and 45° identical. Potrace 2.12 at 20°, 1.15 at 45°: still far ahead.

### R2-P3-2 — A little anti-aliased art among pixel-aligned art is caught by the 2% share and drawn on the source grid

- **Where:** `src/core/trace/staircase-source.ts:43`. ADR-530 Amendment 11's "Not part" list names mixed sources above the share; below it the cost was not stated.
- **Evidence:** REPRO (`f-mixed.mjs`). A soft disc, radius 8, inside a hard grid: at 400 × 300 only 0.2% of cracks are non-steps, at 90 × 90 1.5%. The disc's error rises from 0.053 to 0.149 px with 3 segments and 2 inflections, against 2 / 0 alone. It is still better than Potrace's 0.187 px. A hard barcode at 2.3% and a frame at 4.8% stay on the enlarged trace.
- **Fix direction:** Judge the share per component, or walk non-step regions with the enlarged field. A test would pin the frontier.
- **Refuter: CONFIRMED, P3 kept.** Own scene, a soft disc of radius 8 in a hard 40 px grid at 400 × 300: disc error 0.078 px alone, **0.196 px** in the grid. Potrace 0.189, so here it is no longer better than Potrace, a small correction to the finding. My 90 × 90 scene did not trip the share (0.058 px either way), so the frontier depends on how much hard art surrounds the soft part. Small, one part of the image, and only below the 2% share.

## KNOWN re-observed

- **K1. Glyphs at 96 px still lose:** Line Art 0 / 2 / 3, Smooth 0 / 1 / 4 (N8 K1, Q4-P3-3). R2-P2-2 extends this upward.
- **K2. 1-bit spikes outside the 15 images:** 11 on 9 (Line Art, Smooth), 5 on 5 (Sharp), worst Roboto A@24 at 2.01 px. Recorded as Follow-ups in ADR-439 Amendment 2 and #1517.
- **K3. The dust veto removes genuine marks next to 1–2 px² fragments** (N8 K3). Probably re-observed on 1-bit diacritics, by pattern and not probed: the diacritics string at 20–28 px, Roboto 53 of 68, Potrace 64; Tinos 60 of 72, Potrace 65. Polish 1-bit Tinos 67 of 89, Potrace 77. ADR-434 Amendment 3 records K3 as accepted.
- **K4. On a dirty page the dust veto also takes genuine stops:** three text lines with 10 / 20 / 60 hard specks keep 11 / 7 / 4 of 12 text marks; Potrace keeps 12 but also keeps all the dust. ADR-434's Consequences accept it. Better than pre-fix, which kept 7 / 4 / 2.
- **K5. Sharp's segment count** is 3.4× Potrace's on the JPEG set and 31× on large shapes (Q4-P3-1). Sharp still scores 49 / 22 / 8 on the standard set.
- **K6. Speed.** Real crops median 391 ms for Line Art against Potrace's 82 ms per process, measured with another bench running (Q4-P2-1, N8 K5).
- **K7. JPEG at q50 and below.** A 96 px disc at q35 draws 48 segments and 36 inflections (Potrace 5, 1); at q50 it stays on the route. #1517's Not-fixed list has this.

Open PRs #1528–#1530 do not touch `core/trace` or the constant-power advice.

## Refuted

**By the refuter: claims inside confirmed findings.**
- **"Coloured ink's +35% is a regression from +3% before #1517" (first draft of R2-P1-1).** The +3 is one bar placement. Over 12 placements and 4 canvases the parent's coloured bars range +0 to +98%, with a mean above main's on all 2 px bars and on 3 px bars at 90–96 px, about level at 500 × 300, and below it only on 3 px bars at 300 × 100. On 1-bit coloured text the parent is somewhat better (Arial 24 px +14 vs +23). So coloured growth is an older defect that #1517 changed, not one it introduced. The grey half is a true regression and stays.
- **"`flattenStraightRuns` makes large arcs into many pieces" (R2-P2-2's Where).** With its second pass off, a 1024 px disc goes from 62 to 402 segments, and the error is about the same (0.529 → 0.425 px). The symptom stands; the cause is not this pass.
- **"ADR-530 Amendment 12's sentence 'takes the source grid on every preset' is false at 100 px and up" (R2-P2-1's anchor).** Those sources do walk their own grid. What is false there is Decision 2's "traces as its clean art". The finding stands on that clause and on the black twin.

**By the auditor.**
- **"The baseline rule lets dust back in."** Measured and not so. Text page with 60 uniform specks: 2 kept (pre-fix 0, Potrace 60). 24 specks placed on baseline rows: 0 kept. 10 on the margin at baseline height: 0 kept. A single speck at the margin on a baseline: kept, the consequence ADR-434 Amendment 3 states. Three: 0 kept, because they veto each other. Q4's speckle field is identical to N8's row for row. Q5's noisy rows: no added marks.
- **"A row of dots now reads as a stop."** 60 specks in rows 8 px apart under the text: 42 / 44 of 60 kept on main and pre-fix alike.
- **"#1517 catches soft logos, photos and gradients."** It does not. Anti-aliased discs show 55–70% of cracks as non-steps at every blur from 0.4 to 2 px, after JPEG q40–q90 and after WebP. AA on a gradient: 55%. Hinted Arial words: 20–69% across 20 cases. Astronaut photo stability is intact: Smooth IoU 0.971–0.978 against its clean trace at q35–q75 and σ 6 grain.
- **"Light blur of binary art now gets a staircase."** The blur σ 0.4–0.6 that does pass the test traces as clean art: 4–6 segments, 0–1 inflections, against 38 / 30 pre-fix at σ 0.6. σ 1 stays enlarged, unchanged at 17 / 8. The one cost is a higher error at σ 0.6 (0.178 against 0.142 px), which ADR-530 Amendment 12 states.
- **"Non-Latin scripts lose their dots."** Cyrillic, Greek, Vietnamese, Turkish, Hebrew, Arabic, Thai, Korean at 16–28 px: Line Art AA 634 of 796, Potrace 1-bit 630, Potrace grey 582. No loss to Potrace overall. Smooth AA 730 is the best. Only 1-bit Polish Tinos (K3) sits noticeably under Potrace.

## Verified clean

- **Q4 79-image scorecard.** 80 of 80 rows identical to N8. Clean tallies unchanged, also with the 7-metric weighting.
- **Q5.** A and B unchanged, C one better. 36 of 160 rows moved slightly; none added a mark; the moved lost-part counts are logo rows regaining a part.
- **#1516 on every N8 repro.** All Line Art and Smooth stop checks hold at 0°, the hinted Pango test holds on 7 fonts, and "lit." holds. Floor tolerance, one size per mark and self-exclusion read as ADR-434 Amendment 3, Decisions 1–3 state (`small-mark-neighbourhood.ts:47-52,136-175`, `small-mark-policy.ts:220-254,285-292`). Decision 4's test reads as stated (`small-mark-text-line.ts:53-89`).
- **#1517 on every N8 repro.** The 32 px circle at q75 and q60 on canvases 48–100 holds, the 99 / 100 cliff is gone for JPEG, and q50 stays on the route. ADR-530 Amendment 12's tables reproduce: q75 and q60 tallies, segments 815 / 781 / 822 / 769, corners 237 / 228 / 232 / 225. ADR-439 Amendment 2's "0 / 0 / 0" on 72 glyphs reproduces.
- **Formats.** Inverted art with Invert on matches its positive exactly. Hard alpha on the alpha-mask route matches the binary row. WebP q75 and q50 of binary art take the same route. Disc from 16 to 99 px: two-level and clean.
- **Colour layers (Q5-P2-2)** hold: black text on its own black layer at 96–99%. **Lighting gate (Q5-P2-3)** holds.
- **#1514.** Fires on GRBL Compatible at the right speed: 3888, 5019 and 3174 mm/min, matching the look-ahead formula, and the model's dose at or below the quoted speed is 1.000. Silent under GRBL Dynamic, GRBL Raster and the 4040 (all M4), for hand-set modes, and on grblHAL's 100 blocks. Under Automatic overscan it still fires. Offset fills get the corner advice without Lead-in wording. The wording matches what happens. `detectJobIntentWarnings` carries it, and Save, Start and Job Review read through it (`job-intent-warnings.ts:49`; `job-review/constant-power-firmware-warnings.ts`).
- **Burn.** Dot Width, turned Pass-Through and Line Screen as in the Scorecard.
- **Test truth (L10 step 5), all with parent implementation files and main's tests:**

  | PR | On main | On parent |
  |---|---|---|
  | #1516: `trace-full-stops.test.ts` + `small-mark-policy.test.ts` | 30 / 30 pass | **13 fail**, 17 pass; the 13 are every new test, matching the PR's claim |
  | #1517: `staircase-source.test.ts` + `contour-corner-ink.test.ts` | 24 / 24 pass | **11 fail**, 13 pass: all new JPEG, ink and serif tests |
  | #1514: `constant-power-warnings.test.ts` | 20 / 20 pass | **3 fail**, 17 pass: the Scan Line and offset advice tests; the PR said so |

  The tests are true. Their gap is scope: horizontal text only (R2-P1-2), no colon (R2-P1-3), the ink discs on one route and with no width check (R2-P1-1, R2-P2-1), no island advice test (R2-P2-3).

## Not verified

- **Hardware.** No burn was made. M3 doses come from N8's planner model, calibrated against Q1's 2.61× in N8. Real island-fill dose depends on the firmware's `G0` handling near a reversal; the model plans `G0` at 100 mm/s.
- **ADR text beyond the amendments' own claims.** ADR-434 Decisions before Amendment 3 were read only where cited.
- **Times "%" at 20 px on Line Art AA** (R2-P1-3's last evidence bullet): the probe logs sizes of 12.9–14.1 px², over the 12 px² cap, yet the parts are lost. Possibly a counter or stack in the "%" glyph. Not root-caused.
- **`gap-1px@800`** did not finish in the scorer in 20 minutes, so it is out of the large-shape tally. The cause was not looked into; the scorer is audit code, not product code.
- **Colour art beyond flat fills on the 2× route.** R2-P1-1's colours are single flat inks. Multi-colour art was not measured against this sampling.
- **Very large inputs past 3000 px, and the downscale route** with JPEG, were not measured; memory on this PC is limited.
- **The CLI twin** (`scripts/trace-cli.mjs`) was not run.
- **Refuter stage: limits.**
  - KNOWN items K2–K4, K6 and K7 were not re-run by the refuter; K1 and K5 were recounted.
  - The anti-aliased mid-grey thinning under R2-P1-1 was not compared with the parent.
  - Why the "s" in "spy." does not count as a baseline letter, and the real cause of R2-P2-2, were not found.
  - The island dose rests on two planner models that agree, not on a burn. The rows' real `G0` behaviour near a reversal is unmeasured.

```json
[
  {"id":"R2-P1-1","severity":"P1","area":"tracer-remeasure-2","file":"src/core/trace/staircase-source.ts","line":83,"anchor":"Twin: parent of #1517 (main with c1acfdff6's five files) keeps stroke width on the same pixels; black ink keeps it on main. Contract: ADR-530 Amd 12 Decision 2 'A near two-level source then traces as its clean art'. Ground truth: Potrace on the same greymap","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1517: on the 2x route the source-grid sample reads enlarged pixel 2x+1, a quarter of the way to the next pixel. Line Art, hard-edged thin art: coloured ink gains a pixel (3 px bars 100% +35, 2 px +51; the parent also did, +0 to +98 by placement), grey luma 90-100 loses one (2 px grid 52% vs parent 100%, Potrace 100%; 3 px bars 68% vs 97%; 1-bit word 48% vs 71%, Potrace 91%). Triggered at 90-99 px or by the thin-stroke route at any size to 1.5 Mpx","refuter":"CONFIRMED. Grey half a real regression: 2 px bars 49% vs parent 95-100% over 12 placements; v-native 100% +0. P1 on shape loss: 1-bit luma 100 text Arial 20 px 34 parts, 0 of 10 holes (source 13, 10; parent 30, 1; Potrace 13, 9). Coloured half is not a clean regression: parent +0 to +98 by placement."},
  {"id":"R2-P1-2","severity":"P1","area":"tracer-remeasure-2","file":"src/core/trace/small-mark-text-line.ts","line":85,"anchor":"Contract: Auto tooltip 'keep drawn dots' (TraceCheckboxRow.tsx:65), ADR-434 Decision 3d, trace clarification (Q1 AREAS). Twin: same text at 0 degrees 144/144. Ground truth: Potrace 1-bit and Sharp keep them","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The text-baseline rule of ADR-434 Amd 3 compares axis-aligned box bottoms within one source px, so rotated text loses full stops: 8 sentences x 3 sizes x 4 fonts, Line Art AA 144 at 0 and 2 deg, 129 at 5, 130 at 10, 114 at 45, 127 at 90, 126 at 180 of 144; 1-bit down to 110; Smooth 1-bit down to 105. Potrace 1-bit 144/144 at every angle, Sharp AA 135-144. Pre-fix was worse (60-72 of 144), so not a regression: N8-P2-1 on rotated text","refuter":"CONFIRMED with own librsvg renderer and new sentences: Line Art AA 125 of 126 at 0 deg, 120 at 5, 45, 90, 180; Potrace 1-bit 124-126; pre-#1516 106-109. About 5% rather than 10-21%. No notice reports removed marks."},
  {"id":"R2-P1-3","severity":"P1","area":"tracer-remeasure-2","file":"src/core/trace/small-mark-neighbourhood.ts","line":136,"anchor":"Contract: 'keep drawn dots', ADR-434 Amd 3 Decision 4 'stops do not veto each other'. Ground truth: Potrace and Sharp keep them. Twin: the colon survives at 28 px","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A colon's top dot is not on a baseline, so it is a lone speck and vetoes the bottom dot: 'Scale 1:10' loses both dots at Times 20/24 px, Tinos 24 px, Verdana 20 px (Potrace 2/2). A stop beside only descenders has no baseline letter: 'y.' and 'Q.' at 24 px lost; 11 descender strings x 6 fonts x 3 sizes, 1-bit: Line Art 244/270, Potrace 269","refuter":"CONFIRMED: \"Scale 1:10\" 0 of 2 at Times 18-26 px and Verdana 20 px on Line Art, Times 20-26 and Verdana 20 on Smooth; probe shows the veto. 1-bit totals behind Potrace (colons 504 vs 578 of 640, descender stops 290 vs 348 of 384); AA totals level. \"spy.\" also lost although \"s\" is nearby, not root-caused."},
  {"id":"R2-P2-1","severity":"P2","area":"tracer-remeasure-2","file":"src/core/trace/trace-to-paths.ts","line":211,"anchor":"Contract: ADR-530 Amd 12 Consequences 'Two-level art in a pale or coloured ink takes the source grid on every preset'. Twin: same bitmap in black. Ground truth: Potrace on the same greymap","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The two-level route runs only when factor > 1, so hard non-black art at 100 px and up walks natively against the fixed cut and follows the staircase: disc 150 px luma 80 47 segments/30 inflections (black 4/0, Potrace 6/1); 'Logo & Co' 72 px red 176/68 (black 103/22, Potrace 103/18); 79 images at luma 80 Line Art 38/14/27 with 1,875 segments (pre-fix 5/2/72). Two inks on one sheet fail the 2% share on every preset: half-black disc 47/36, Potrace 5/1","refuter":"CONFIRMED. Anchor corrected to Decision 2 \"traces as its clean art\": at 100 px and up the source grid is walked, without the step field. New: 99/100 px cliff, grey 40 disc 4 to 33 segments; teal disc at 400 px 149 segments."},
  {"id":"R2-P2-2","severity":"P2","area":"tracer-remeasure-2","file":"src/core/trace/contour-trace.ts","line":483,"anchor":"Ground truth: analytic outline and Potrace 1.16 on the same bitmap; extends N8 K1 / Q4-P3-3 past the sizes measured","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: Q4-P3-3 and N8 K1 record 96 px glyphs","summary":"One-bit art at large sizes loses to Potrace on curves: 31 shapes at 400-800 px Line Art 17/4/10, Smooth 17/4/10, 1,060 segments vs 262; glyphs at 192 and 384 px Line Art 0/1/9, Smooth 0/2/8, Sharp 2/1/7; disc on a 1024 px canvas 62 segments and 0.522 px vs Potrace 13 and 0.134. Anti-aliased art at the same size wins (8 segments, 0.044 px)","refuter":"CONFIRMED, partly KNOWN (Q4-P3-3, N8 K1 at 96 px). Own radial error: 1024 px 62 segments 0.529 px vs Potrace 13, 0.155. Stated cause refuted: second flatten pass off gives 402 segments, 0.425 px. Real cause not found."},
  {"id":"R2-P2-3","severity":"P1","area":"tracer-remeasure-2","file":"src/ui/laser/constant-power-warnings.ts","line":170,"anchor":"Contract: ADR-257 Amd 2 Decision 1 'Scan Line and island fills get Amendment 1's image test'. Twin: Scan Line on the same bars is advised at 1.46x","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An island sweep has one span, so moves.length < ahead always skips it and island fills never get the M3 advice. GRBL Compatible, own planner model: 0.3 mm strokes 1.645x at 1500 mm/min, 3.29x at 3000, 6.58x at 6000; 1 mm 1.84x at 3000; 3 mm 2.13x at 6000. Only the generic heat notice ('test on scrap if those small islands look darker') appears, the same under M4; it names neither power nor GRBL Dynamic. Refuter to judge whether that notice is a clear warning","refuter":"CONFIRMED and raised to P1. Own planner gives the same doses. Overscan 0: no island notice at 3.09x (0.3 mm, 1500) to 12.34x (6000); overscan 1 mm, 3 mm strokes 2.44x with none (fill-heat-risk.ts:111); only a scan-edge runway advisory. Where the notice fires it reads the same under M4 and names neither power nor GRBL Dynamic. N8-P2-5 coordinator precedent."},
  {"id":"R2-P2-4","severity":"P2","area":"tracer-remeasure-2","file":"src/core/trace/contour-corner-ink.ts","line":123,"anchor":"Ground truth: Potrace 0 on the same decoded pixels. Twin: 0 on the same glyphs without JPEG. ADR-439 Amd 2 Follow-ups list 1-bit only","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The 2% apex bound of ADR-439 Amd 2 does not survive JPEG ringing: 72 anti-aliased glyph images after q75, Line Art and Smooth 4 spikes on 4 images, Sharp 10 on 7; Tinos M@32 2.60 px off the outline and 2.50 px from any ink. Potrace 0. Without JPEG all presets 0","refuter":"CONFIRMED at the same point (Tinos M@32, 2.50 px from any ink). Rarer than counted: Line Art 2 of 72 over 1 px, 2 of 216 at other placements, 0 of 126 through librsvg."},
  {"id":"R2-P3-1","severity":"P3","area":"tracer-remeasure-2","file":"src/core/trace/contour-corner-ink.ts","line":91,"anchor":"ADR-439 Amd 2 states the true-corner cost only for Tinos R@24","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The apex bound costs some true acute tips: 20 degree arrow heads corners 105 -> 93 of 315, mean Hausdorff 0.65 -> 1.04, max 1.71 -> 2.61 px; all shapes 2,066 -> 2,048 of 2,475 on Line Art; Potrace 497","refuter":"CONFIRMED: 20 degree apex gap 0.102 to 0.200 px, max 1.23 to 2.47; 30 and 45 degrees unchanged."},
  {"id":"R2-P3-2","severity":"P3","area":"tracer-remeasure-2","file":"src/core/trace/staircase-source.ts","line":43,"anchor":"ADR-530 Amd 11 Not-part list covers mixed sources above the share only","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A soft disc among pixel-aligned art under the 2% share is drawn on the source grid: error 0.053 -> 0.149 px, 3 segments/2 inflections; still better than Potrace's 0.187","refuter":"CONFIRMED: disc error 0.078 to 0.196 px at 400 x 300, slightly past Potrace 0.189."}
]
```
