# Rolling audit v8 — N8 Tracer re-measure (trace and burn-quality fix verification)

- **When:** 2026-10-29, 15:40 – 18:10 +0800   **Tree:** origin/main @ `33bc394c6` (fetched at the start and again at the end; unchanged). Every repro ran on the scratchpad `j7-main` tree. Its `src/core/trace`, `src/core/raster`, `src/core/gcode` and `scripts` are identical to this worktree's (`diff -rq` empty), and the worktree is `33bc394c6` plus docs only (`26e256ba8`).
- **Scope:**
  - **Trace fixes shipped in desktop 1.0.28:** #1496 (tied and two-plateau cut, lighting gate, i-dots; ADR-402 Amd 1–2, ADR-434 Amd 2, ADR-435 Amd 1), #1497 (two-level sources on their own grid, ink-bounded binary apexes; ADR-530 Amd 11, ADR-439 Amd 1) and #1495 (Colour layers keep thin dark text; ADR-461 Amd 3).
  - **Burn fixes:** #1490 (ADR-458 Amd 1), #1491 (ADR-257 Amd 1, ADR-239 Amd 2), #1487 (ADR-492 Amd 1) and #1494 (ADR-242 Amd 1).
  - **Entry points measured:** `traceImageToColoredPaths` with `TRACE_PRESETS` (the dialog worker's call), and `prepareOutput` → `emitPreparedGcode` (Save/Start). Image Studio was exercised through `runAdjustment`. The warnings were read through `constantPowerWarnings` and `detectJobIntentWarnings`.
  - Potrace 1.16 and mkbitmap 1.16 ran as separate test-only processes, with documented options only. No Potrace or mkbitmap source was read.
- **Lenses run:**
  - **L2.** Potrace 1.16 head-to-head on the Q4 79-image set and the Q5 27 real cases. The Q5 refuter's quarter-pixel mkbitmap correction was applied.
  - **L10**, steps 1–5:
    - every original finding was re-run, each also with a pre-fix engine (an esbuild bundle of `93334429e`, the Q5 tree) to show that each check can tell fixed from unfixed;
    - siblings: other fonts and words, JPEG-compressed art, anti-aliased glyphs, Fill under M3, deeper vignettes;
    - the interaction of #1496 with #1497, which were measured apart and merged the same day;
    - the ADR amendments, read against the code;
    - the PRs' own tests, run on main.
- **Counts:** 7 raised → **P1 2 / P2 3 / P3 2** after the refuter (raised as P1 0 / P2 5 / P3 2), + 7 KNOWN re-observed. Refuter: 7 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. N8-P2-1 and N8-P2-2 are raised to P1: they reopen Q4-P2-3 (P1), which the ledger marks fixed by #1496. Q findings: 7 of 7 trace findings and 5 of 5 burn findings confirmed fixed **on the cases their reports and PRs measured**. Three of the fixes do not hold on everyday siblings: Q4-P2-3 (N8-P2-1, N8-P2-2), Q4-P2-1 (N8-P2-3) and Q4-P2-2 (N8-P2-4). N8-P2-5 is the Fill half of Q1-P2-1 (recorded as Q6-K1), which #1491 did not cover.
  - **Coordinator (2026-10-29): N8-P2-5 raised to P1**, so the round reads **P1 3 / P2 2 / P3 2**. Reason: it is the same defect class and size as Q1-P2-1 (P1) and Q6-K1 (tagged P1): a constant-power Fill burns 1.44–1.46× its dose. The only job-time notice is the runway advisory, which is about row ends rather than dose, and does not fire at all under Automatic overscan. The dialect description in Machine Setup is a hover text, not a warning before output (METHOD §3).

## Headline

**Yes, on the audit's own scorecard. Line Art went from not yet better than Potrace to better than it, and the #1497 claim reproduces exactly on main.** Line Art scores **51 wins, 20 ties and 8 losses** against Potrace 1.16 defaults over the 79 ground-truth images. Sharp scores 49 / 22 / 8 and Smooth 55 / 17 / 7. These equal #1497's self-reported numbers cell for cell, even though #1497 was measured on a branch without #1496; #1496 changes nothing on this set.
- **Before the fixes:** 27 / 19 / 33, 40 / 19 / 20 and 27 / 17 / 35.
- **Refuter's 7-metric weighting:** 52 / 20 / 7, 53 / 22 / 4 and 52 / 20 / 7. Before the fixes it was 31 / 19 / 29, 41 / 21 / 17 and 31 / 18 / 30. The verdict therefore no longer depends on how smoothness is weighted.
- **An independent scorer** (the Q4 refuter's own code) agrees on 60 of 60 preset cells of its 20-case subset.
- **Refuter: CONFIRMED on all 79 images, with new scoring code.**
  - **What was new.** The refuter wrote its own ground truth, re-implemented from the Q4 shape and glyph spec. Its rasteriser matches the dumped PBMs on 78 of 79 images; Roboto a@24 differs by 1 px. The nine metrics, the tie rule and its own Potrace runs were also its own.
  - **Result.** Every per-case verdict agrees, 79 of 79 for Line Art and 79 of 79 for Sharp: **51 / 20 / 8 and 49 / 22 / 8**.
  - **One sensitivity.** That match needs Q4's own sampling of traced cubics: uniform in t, at least 8 points per cubic. With mean error sampled every 0.1 px of arc length, as the Q4 method text words it, the totals are **49 / 22 / 8 and 47 / 21 / 11**.
    - All 7 changed cells are thin bars, plus Roboto R@24 for Sharp.
    - Uniform-t sampling crowds points onto Potrace's rounded bar ends. On stroke-w1@32 that gives Potrace a mean error of 0.138 px, against 0.109 px by arc length; KerfDesk's own mean error is the same either way.
    - Either way, both presets beat Potrace on this set.
  - **A re-tally** of the auditor's raw metrics, with the refuter's own tally code, gives 51 / 20 / 8, 49 / 22 / 8 and 55 / 17 / 7. On Q4's archived pre-fix results it gives 27 / 19 / 33, 40 / 19 / 20 and 27 / 17 / 35.

**On the 27 real degraded cases KerfDesk now wins more clearly:**
- Smooth vs mkbitmap + Potrace: **26 / 1 / 0**, against 22 / 3 / 2 before (quarter-pixel shift corrected).
- Line Art vs plain-threshold Potrace: **23 / 3 / 1**, against 18 / 7 / 2.
- Best vs best: **23 / 3 / 1**, against 23 / 1 / 3.
- **Refuter: CONFIRMED on 7 of the 27 cases**, re-run from Q5's case pixels with new code. The cases were text clean, jpeg35, lowres3, blur1, noise12, photo and dim.
  - **What was new.** The truth comes from opentype paths. Potrace and mkbitmap were run on the case PPMs, with the (+0.25, −0.25) correction. IoU, edge distance, Hausdorff and topology are measured on a 4 × 4 sample grid, with the Q5 tie bands.
  - **Result.** All 21 row verdicts (A, B, C) agree with the auditor's: A 6 / 1 / 0, B 7 / 0 / 0, C 7 / 0 / 0.
  - Smooth now beats mkbitmap + Potrace on text blur1 (IoU 0.837 against 0.759) and lowres3 (0.652 against 0.646, Hausdorff aside). Those were Q5's two B losses.

**But "better than Potrace" does not yet hold for ordinary inputs just outside the measured sets.** Small marks, JPEG-compressed art and anti-aliased serifs:
1. **N8-P2-1 (P1 after refuter). Full stops still vanish from ordinary anti-aliased text with Line Art (the Free default) and Smooth.** The refuter reproduced it with hinted Arial text from FreeType, through sharp: Line Art kept 14 of 24 final full stops, Potrace and Sharp kept 24 of 24.
   - "Have a good day.", "Call us today." and "Made in Italy." lose their final full stop at 20, 24 and 28 px in Roboto. "easy. any. say. buy. dry." keeps 0 of 5.
   - Over a full stop after each of 61 characters, Line Art keeps 146 of 183 in Roboto and 169 of 183 in Tinos. Potrace and Sharp keep all 366.
   - The cause: a full stop with no ink within 5 px is counted as dust by ADR-434's census, and it vetoes itself. The fix covered only the audit's sentence, where every stop sits beside an "i" or a "z".
2. **N8-P2-2 (P1 after refuter). On small 1-bit words, a 3 px² i-dot sums to 26.99999999999999 against a floor of 27.** It is dropped, and then counts as dust against the full stop beside it: "lit." at 20 px keeps 0 of 2.
3. **N8-P2-3. JPEG brings back the staircase that #1497 removed.**
   - After JPEG q75, Smooth traces the 32 px circle as 46 cubics with 40 inflections, the Q4-P2-1 number exactly. Line Art does the same at q60.
   - On the 79-image set after q75, Smooth falls to 45 / 17 / 17, with 1,399 segments against Potrace's 700.
4. **N8-P2-4. Apex spikes remain where the ink bound does not apply.**
   - On anti-aliased serif glyphs, Line Art puts sharp nodes up to 1.7 px into pure paper and Sharp up to 4.25 px. The bound is for binary loops only.
   - **Refuter:** the 4.25 px is render-dependent. The refuter's own librsvg render, over 5 sub-pixel placements, gives Sharp at most 2.61 px into paper (2.81 px off the outline) and Line Art at most 1.88 px.
   - On 1-bit glyphs outside the 15-image set, 11 spikes remain on 9 of 72 images, up to 2.37 px off the ink.
5. **N8-P2-5. GRBL Compatible Fill burns with M3 and gets no advice.** The #1491 advice covers images and Line cuts only. Small-text fill at 6000 mm/min gets 1.46× its dose (independent planner model; the refuter's own model also gives 1.462×).

**Burn quality holds** on every fix re-checked:
- **Dot Width Correction (#1490):** Grayscale keeps 0.997 / 0.994 of its energy at 0.02 / 0.04 mm (was 0.64 / 0.28).
- **M3 advice (#1491):** shown for GRBL Compatible images and for GRBL Compatible and 4040 Line output. The 4040 now leaves each contour on a 5 mm laser-off exit.
- **Turned pass-through (#1487):** rows 0.0995–0.1006 mm apart, dose 1.000–1.010 at every angle (was rows 1.08–1.41× apart, tone 0.35–0.46).
- **Line Screen at 0° and 8 px (#1494):** 65 tones, max error 0.0078; solid black is 100% (was 5 tones, max error 0.125, black 87.5%).

## Scorecard

**Trace vs Potrace 1.16** (`-t 2 -a 1 -O 0.2 -z minority`), 79 ground-truth images, W / T / L of cases:

| Preset | Before (Q4, `ef910deb6`) | Claimed (#1497) | **Measured, main `33bc394c6`** | 7-metric (before → main) | Same 79 after JPEG q75 (pre-fix → main) |
|---|---|---|---|---|---|
| Line Art (Free default) | 27 / 19 / 33 | 51 / 20 / 8 | **51 / 20 / 8** | 31 / 19 / 29 → 52 / 20 / 7 | 28 / 20 / 31 → 52 / 18 / 9 |
| Sharp | 40 / 19 / 20 | 49 / 22 / 8 | **49 / 22 / 8** | 41 / 21 / 17 → 53 / 22 / 4 | 28 / 13 / 38 → 48 / 22 / 9 |
| Smooth (Pro CNC default) | 27 / 17 / 35 | 55 / 17 / 7 | **55 / 17 / 7** | 31 / 18 / 30 → 52 / 20 / 7 | 27 / 16 / 36 → **45 / 17 / 17** (N8-P2-3) |

**Line Art by group, main:**
- shapes: 16 px 10 / 5 / 1, 32 px 12 / 3 / 1, 64 px 11 / 4 / 1, 200 px 10 / 5 / 1;
- glyphs: 24 px 5 / 0 / 0, 48 px 3 / 1 / 1, **96 px 0 / 2 / 3** (KNOWN, see K1).

**Per metric, Line Art, before → main:**
- mean error 21/28/30 → **43/28/8**;
- Hausdorff 46/16/17 → 45/24/10;
- |area| 42/20/17 → 43/21/15;
- apex gap 32/16/3 → 31/17/3;
- corners not kept 17/17/17 → **31/19/1**;
- false corners 0/69/10 → 3/69/7;
- segments 5/24/50 → **21/41/17**;
- excess turning 6/18/55 → 12/43/24;
- topology 0/75/0 → 0/75/0.

| Aggregate (79 images) | Line Art before | **Line Art main** | Smooth main | Sharp main | Potrace |
|---|---|---|---|---|---|
| Segments (cubic + merged line) | 3,217 | **813** | 771 | 2,509 | 700 |
| Inflections per smooth convex shape | 24.5 | **1.0** | 0.4 | 17.6 | 0 |
| Mean boundary error | 0.164 px | **0.116 px** | 0.122 | 0.134 | 0.154 |
| Hausdorff median / max | 0.64 / 3.37 px | **0.59 / 1.89 px** | 0.62 / 2.31 | 0.60 / 1.66 | 0.95 / 2.98 |
| True corners kept sharp (of 331); at 200 px (of 46) | 140; 45 | **237; 45** | 228; 45 | 279; 41 | 143; 23 |
| Spikes on the 15 scorecard glyphs (≥ 90°, ≥ 1 px off) | 20 on 8 | **0** | 0 | 0 | 0 |
| Spikes on 72 further glyph images, 1-bit / anti-aliased (N8-P2-4) | 80 / 7 (pre-fix) | **11 / 7** (refuter render: 4 / 8) | 11 / 7 (refuter: 4 / 6) | 5 / 25 (refuter: 4 / 19) | 0 |
| Thin strokes, \|area error\| | 5.1% | 3.2% | 2.8% | 1.0% | 12.0% |
| Topology right | 79 / 79 | 79 / 79 | 79 / 79 | 79 / 79 | 75 / 79 (touch-corner joined) |
| Median time per image | 10.4 ms | 8.9 ms in-process | 10.0 | 3.8 | 48 ms per process |

| Q4-P2-1: 32 px circle | Line Art before | **Line Art main** | Smooth main | Potrace |
|---|---|---|---|---|
| Binary, canvas 48 / 64 / 96 | 46c, 40 inflections / — / 28c + 4l, 22 | **6c, 0** at every canvas | 6c, 0 | 4c, 0 |
| Binary, canvas 99 / 100 / 101 / 160 | 33c, 24 / 6c, 0 / — / 6c, 0 | **5c, 1 / 6c, 0 / 5c, 1 / 6c, 0** (cliff gone) | 5c, 1 / 6c, 0 / 5c, 1 / 6c, 0 | 4c, 0 |
| Anti-aliased, any canvas | — | 3c, 0 (error 0.04–0.06 px) | 3c, 0–1 | 4c, 0 (0.19–0.20 px) |
| JPEG q75 of the binary circle, canvas 48–96 | — | 6c, 0 | **46c + 1l, 40** (N8-P2-3) | 4c, 0 |
| JPEG q60 / q50, canvas 48 | — | **47 segments, 40** (N8-P2-3) | 47, 40 | 4 |

**Seven real crops** (Arch House, stress test; thresholded to two levels as Q4 fed both):

| | Line Art before | Claimed (#1497, no #1496) | **Line Art main** | Smooth main | Potrace |
|---|---|---|---|---|---|
| Segments | 22,207 | 10,488 | 10,671 | 10,096 | 8,762 |
| Inflections per 100 px | 19.3 | 5.5 | 5.6 | 5.1 | 3.8 |
| Mean 4× IoU vs the bilevel input | 0.9425 | 0.9057 | 0.9059 | 0.8987 | 0.9084 |
| Rings | 872 | 872 | 898 (#1496 keeps more marks) | 900 | 890 |
| Median time per crop | 455 ms | — | 215 ms (6.7× Potrace's 32 ms per process) | 190 ms | 32 ms |

**Real degraded images (Q5's 27 cases), W / T / L:**

| Row | Before (Q5, refuter-corrected) | **Main, same correction** | Main, as measured (no shift correction) | Main, shift also applied to the Arch stability rows |
|---|---|---|---|---|
| A: Line Art vs plain-threshold Potrace | 18 / 7 / 2 | **23 / 3 / 1** | 23 / 3 / 1 | 23 / 3 / 1 |
| B: Smooth vs mkbitmap + Potrace | 22 / 3 / 2 (as measured 24 / 1 / 2) | **26 / 1 / 0** | 26 / 1 / 0 | 25 / 1 / 1 |
| C: best vs best | 23 / 1 / 3 (as measured 22 / 1 / 4) | **23 / 3 / 1** | 23 / 3 / 1 | 23 / 1 / 3 |

- **Remaining losses:**
  - A: Arch at σ 12 grain, Line Art's colour-detail cliff (K4).
  - C: Arch "paper" (Sharp against `mkbitmap -f 16`).
- **Per-metric losses that remain:**
  - Hausdorff: A 4/8/8, C 8/1/11.
  - Lost + merged: B 12/5/10, against 7/2/18 before.
- **Text IoU, mean of 8 conditions:** Line Art 0.830, Smooth **0.882** (was 0.824), Sharp 0.869; mkbitmap (corrected) 0.816, plain 0.749.
- **Logo IoU:** Line Art 0.959, Smooth 0.969, Sharp 0.968; plain 0.939, mkbitmap 0.604.
- **Lost components:**
  - Logo, sum of 8: Line Art 71 → 41, Smooth 65 → 38, Sharp 20 → 34 (K6).
  - Text: Line Art 18 → 7, Smooth 12 → 2, Sharp 1 → 3.
  - Text merges: Smooth 14 → 2, Sharp 15 → 0.

| Finding re-check | Before | Main | Potrace | Verdict |
|---|---|---|---|---|
| Q4-P1-1: six 3×3 dots beside a square, Smooth, gaps 2–16 px, on 0/255, 40/230 and 20/200 pages and on transparent PNGs (paper RGB 0 or 255) | 0 / 6 (also 0 / 6 on alpha with white paper RGB) | **6 / 6 everywhere**, for all three presets | 6 / 6 | fixed |
| Q4-P2-3: "mini quiz. jig, ii. lit.", Roboto 20 / 24 / 28 px, Line Art anti-aliased; 1-bit | 4/12, 9/12, 3/12; 11/12, 7/12, 5/12 | **12/12, 12/12, 12/12; 12/12 each** | 12/12 | fixed on this sentence |
| Same sentence, Tinos 24 / 28 px | 10, 6 / 12 (anti-aliased) | 12 / 12 | 12 / 12 | fixed |
| Lone "i" at 28 px (anti-aliased / 1-bit) | 0 / 0 | 1 / 1 | 1 | fixed |
| Full stop after each of 61 characters, anti-aliased, 20–28 px, Line Art (Roboto / Tinos) | 8 / 50 of 183 | **146 / 169 of 183** | 183 / 183 | **does not hold** (N8-P2-1) |
| Lone "i" / "lit." at 20 px, 1-bit, Line Art | 0 / 0 | **0 / 0** | 1 / 2 | **does not hold** (N8-P2-2) |
| Q4-P2-2: spikes on the 15 scorecard glyphs | 20 on 8 | 0; two bar ends 0.84 / 1.10 px off ink, as #1497 says | 0 | fixed on the set |
| Q5-P2-1: counters, text blur σ 1 / low-res ×3, Smooth | 5 / 15 lost; area +40.5% / +75.0% | **0 / 1 lost; +6.7% / +0.7%** (cut 147 / 151) | 0 / 1 (mkbitmap) | fixed |
| Q5-P2-1, same, Sharp | 3 / 11 lost; +32.9% / +69.6% | 0 / 1; +2.7% / −9.5% | — | fixed |
| Q5-P2-3: astronaut, 12 grain draws (σ 1.5–6) and JPEG q35 / 60 / 75, Smooth IoU vs its own clean trace | 8 of 15 flipped (IoU 0.72–0.95; 4 of them silently, the dialog showing a plain cut) | **0 flipped, IoU 0.971–0.989**, cut 101–102 reported; Sharp 0.967–0.984 | 0.960–0.985 | fixed |
| Q5-P2-2: Colour layers, own 5-colour and pale logos, JPEG q35–q90, blur σ 1, grain σ 6 / 12, blur + q75 | text on the blue layer at 100% (saturated), on the sky layer at 39.7–43.2% (pale), even clean | **black text on its own black layer at 100% in all 20 cases** (93–99% of its pixels) | — | fixed |

**Burn quality** (shipped Save/Start path, independent G-code reader):

| Check | Before (Q1–Q3) | **Main** | Target | Verdict |
|---|---|---|---|---|
| #1490: Grayscale energy at Dot Width 0.02 / 0.04 / 0.08 mm against 0, photo-like 128 × 64 (ramp 256 × 8) | 0.64 / 0.28 / — | **0.9969 / 0.9939 / 0.9878** (ramp 0.9984 / 0.9969 / 0.9937); Pass-through identical | ≈ 1.0, ends only | fixed |
| Same, Jarvis dither | 0.785 / 0.570 | 0.771 / 0.542 (ramp 0.842 / 0.684) | each burned run trimmed at its ends (ADR-458, LightBurn) | as designed |
| #1491: GRBL Compatible image, M3 advice at 6000 / 3000 / 1500 / 1000 mm/min (Jarvis and Grayscale) | none | **shown / shown / none / none**. The cut-off is the advice's own look-ahead speed, about 2,245 mm/min for 0.1 mm pixels at 500 mm/s² | advice when the feed exceeds the look-ahead speed | fixed |
| #1491: Line output, GRBL Compatible and 4040 | none | **shown on both.** The 4040 contour ends in `G1 … S0`, 5.00 mm on in the line's direction (exit runway) | advice; 4040 exit | fixed |
| #1491 sibling: GRBL Compatible Fill, bars 0.3 / 0.5 / 1.2 mm at 6000 mm/min | — | M3, **no advice**; dose under M3 1.46× / 1.19× / 1.05× (500 mm/s², 15 blocks) | advice as for images | **gap** (N8-P2-5) |
| #1487: pass-through checker turned 0 / 5 / 37 / 45 / 90 / 123°, scan 0 / 37 / 45 / 53 / 143 / 315 / 323° | rows 1.08–1.41× apart; tone 0.353–0.462 | **rows 0.0995–0.1006 mm apart; dose 1.000–1.010** of the ink; aligned turns keep 64 × 64 | 0.1 mm, 1.00 | fixed |
| #1494: Line Screen, 8 px at 0° / 90°; 4 px at 0°; 8 px at 15° / 30° / 45° | 5 tones, MAE 0.062, max 0.125, black 87.5%; at 4 px max 0.25 | **65 tones, MAE 0.0039, max 0.0078, black 100%**; 17 tones, max 0.031; max 0.0009 / 0.0008 / 0.0091 | tone tracks ink | fixed |
| #1494: dot Halftone at 0° / 90° | off by up to 8.4% | max 0.0078 (65 tones) | | fixed |

### Measurement method

All scripts are in the scratchpad folder `zz-n8/`:
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n8\`.

**Engines.**
- `build-engine.mjs` bundles `j7-main`'s public entries with the main checkout's esbuild 0.28.1, as `scripts/trace-bench.mjs` does. The entries are `traceImageToColoredPaths`, `TRACE_PRESETS`, `mergeLightBurnTraceSettings`, `colourLayerSettings` and the perceptual PNG helpers.
- **Pre-fix engine:** the Q5 audit's bundle of `93334429e` (`zz-q5/engine.mjs`, read-only), and the Q5 refuter's `zz-q5r/kd.mjs` for Colour layers.
- `build-debug.mjs` builds a probe bundle of main through an esbuild `onLoad` hook. It logs every `keepInkMark` decision and its reason; the files on disk are unchanged.
- `build-debug-tol.mjs` builds the same bundle with a 10⁻⁶ tolerance on the two floor comparisons. It exists only to size N8-P2-2.

**Q4 79-image set.**
- **Not deleted after all.** The Q4 auditor's scripts were still in the scratchpad (`zz-q4/`, unmodified since 2026-10-28 01:15, before #1497 merged). Their ground truth (`geom.mjs`: shapes, glyph rings and the pixel-centre rasteriser), `bench.mjs` and `tally.mjs` were **copied** to `zz-n8/q4/` and pointed at the main bundle and `j7-main`'s fonts. That gives exactly the same 79 bitmaps, nine metrics and tie bands.
- **Copy check.** Re-tallying Q4's archived `results-all.jsonl` with the copy gives 27 / 19 / 33, 40 / 19 / 20 and 27 / 17 / 35.
- **Weighting.** `tally-n8.mjs` re-implements the rule with optional dropped metrics: 7-metric = without excess turning and apex gap, the Q4 refuter's choice.
- **Independent cross-check.** The Q4 refuter's own code (`zz-q4r/lib.mjs`, `glyph.mjs`, `wtl.mjs`, which share nothing with `geom.mjs`) was copied to `zz-n8/q4r/` and run on main. `agree.mjs` compares the two scorers: 60 of 60 cells agree.
- **JPEG variant.** `bench-jpeg.mjs` puts the same mask through sharp 0.35.5 JPEG (default 4:2:0) and decodes it. KerfDesk gets the decoded RGBA; Potrace gets the decoded greymap (PGM, default `-k 0.5`). Truth and metrics are unchanged.
- **Spikes and real crops.** `spikes-n8.mjs` measures spikes from the dumped outlines; `real.mjs` runs the 7 real crops (Q4's crops, copied).

**Q5 27 real cases.**
- **The inputs.** Q5's own degraded inputs were also still present (`zz-q5/cases/*.ppm`). They were copied to `zz-n8/q5/cases/`, so the pixels are identical.
- **The scripts.** Q5's `run5.mjs`, `run-stab.mjs`, `score5.mjs`, `geom5.mjs`, `scenes5.mjs` and `tally5.mjs` were copied unchanged except for paths.
- **The mkbitmap correction.**
  - `io5.mjs` gains the refuter's correction: `P-mk` and `P-mk16` are shifted by (+0.25, −0.25) source px, and `P-mk-raw` and `P-mk16-raw` are the unshifted pipelines.
  - Refuter-corrected tallies use shifted mkbitmap on logo and text and the as-measured mkbitmap on the Arch stability rows (`stab-raw.cjs`), as the refuter did.
- **Copy check.** The same harness with the pre-fix engine reproduces Q5's totals exactly:
  - A 18 / 7 / 2;
  - B 22 / 3 / 2 (as measured 24 / 1 / 2);
  - C 23 / 1 / 3 (as measured 22 / 1 / 4);
  - the refuter's per-metric B row (edge 18/5/4, Hausdorff 12/0/8).
- **Probes.** `make-vig.mjs` builds deeper vignettes of the text page for N8-P3-1.

**Finding checks** (written fresh for N8; `lib-n8.mjs` has its own coverage renderer, Potrace runner and SVG reader, curve statistics and components):
- `f-marks.mjs` / `f-marks2.mjs`: dots on two-level and alpha pages; i-dots and full stops.
  - The truth marks are the glyphs' own small outer contours (|area| < 16 px², the orientation of the largest contour). A mark's pixels are those whose centre lies inside it.
  - A mark is kept when the traced fill covers at least 50% of its pixels.
- `f-stops.mjs`: "so X." for 61 characters in one wide strip (≥ 100 px, so the native or 2× route, not 3×).
- `sweep-floor.mjs`: 4 words × 2 fonts × 6 sizes × 4 sub-pixel placements (192 small images on the 3× route), with and without the tolerance.
- `f-circle.mjs`: the 32 px circle on 7 canvases, binary, anti-aliased and JPEG.
- `f-spikes.mjs`: 72 further glyph images, with distance to the truth, to any ink (coverage > 2%) and to the 1-bit ink.
- `f-gate.mjs`: the astronaut with our own xorshift + Box–Muller grain and sharp JPEG; IoU at 2 × 2 samples against the same preset's clean trace.
- `f-colour.mjs`: our own saturated and pale logos (opentype Roboto at 34 px), drawn in painter's order at 8 × 8 coverage.
  - Each object is assigned to the layer holding most of its pixels.
  - Power comes from `colourLayerSettings(colours, 100, {output: 'cut-out'})`.

**Burn checks** (`j7-main/src/io/gcode/zz-n8-burn.test.ts`, run alone with `node <repo>/node_modules/vitest/vitest.mjs run`, deleted afterwards):
- **Path:** `createProject` → `prepareOutput` → `emitPreparedGcode`.
- **Reader:** an own modal G-code reader (G0/G1, G90/G91, G20/G21, M3/M4/M5, S, F, X, Y).
- **Energy:** Σ S × length over lit feed moves.
- **Pass-through pitch:** rows are clustered at 0.02 mm along the length-weighted doubled-angle mean direction. Dose area = Σ (S / 1000) × length × row pitch.
- **Line Screen:** each tone is measured on flat 160² patches through `runAdjustment`, over the central 128 × 128 window.
- **M3 dose (`planner.mjs`, own model):**
  - an N-block look-ahead whose newest block is planned to stop;
  - junction speed `v² = a·δ·sin(θ/2)/(1 − sin(θ/2))`;
  - trapezoids per block.
  - Calibration: on Q1's case, the 50% Jarvis row at 6000 mm/min and 500 mm/s², it gives **2.50×**, where Q1 measured 2.61×.

**Repo temp files.** Created and deleted after the run:
- `j7-main/src/io/gcode/zz-n8-burn.test.ts`.

No other file under `j7-main` was touched; the `zz-n1*` files were left alone.

**Rebuild:**
1. `node build-engine.mjs`
2. `cd q4 && node bench.mjs --out out/results.jsonl --dump 1 && node tally-n8.mjs out/results.jsonl "" 1 && node tally-n8.mjs out/results.jsonl excessTurn,apexGapMean`
3. `JPEGQ=75 node bench-jpeg.mjs --out out/results-jpeg75.jsonl --speckle 0`
4. `cd ../q4r && node wtl.mjs && node sum7.mjs`
5. `cd ../q5 && node run5.mjs logo all && node run5.mjs logo dim,salt && node run5.mjs text all && node run5.mjs text dim,salt && node run-stab.mjs arch`, then `node stab-raw.cjs out/stab.jsonl out/stab-rawmk.jsonl && node tally5.mjs out/results.jsonl out/stab-rawmk.jsonl`
6. Then `f-marks.mjs`, `f-stops.mjs`, `sweep-floor.mjs` (`TOL=1 node sweep-floor2.mjs`), `f-circle.mjs`, `f-spikes.mjs`, `f-gate.mjs` and `f-colour.mjs`. Set `N8_ENGINE=<file URL>` to run any of them on the pre-fix bundle.

### Refuter method (2026-10-29, fresh context)

All refuter code was new and was deleted after the run. The auditor's `zz-n8/` scripts were read, never run. Its dumped Q4 PBMs, its `results.jsonl` and Q5's case PPMs were used as data.

- **Engines.** The refuter bundled `j7-main` (= `33bc394c6`) with the same esbuild 0.28.1. Entries: `traceImageToColoredPaths`, `TRACE_PRESETS`, `mergeLightBurnTraceSettings` and `colourLayerSettings`.
  - Options come from `mergeLightBurnTraceSettings(TRACE_PRESETS[p], {})`, which is the preset half of the dialog's `useDialogTraceOptions`.
  - A probe variant logs `keepInkMark`'s floor, debris and support values through an esbuild `onLoad` hook. A tolerance variant adds 10⁻⁶ to both floor comparisons.
- **Renders.**
  - opentype.js 2.0.0 paths rasterised by librsvg (sharp 0.35.5).
  - Pango/FreeType hinted text: `sharp({text})` with Roboto and Windows Arial, Verdana and Calibri.
  - The Q4 shapes and glyphs, re-implemented from the Q4 report's spec and rasterised at pixel centres.
  - JPEG from sharp and from Windows GDI+.
- **Scoring.**
  - Own even-odd and nonzero scanline fill, own Potrace SVG reader, own nine Q4 metrics with the Q4 tie bands, and own Q5 text metrics on a 4 × 4 grid with the Q5 tie bands.
  - Potrace 1.16 and mkbitmap 1.16 ran as separate processes, with documented options only.
- **Burn.**
  - A temporary Vitest, `j7-main/src/io/gcode/zz-n8r-fill-m3.test.ts`, run alone with `node <repo>/node_modules/vitest/vitest.mjs run` and deleted afterwards.
  - Own time-stepped GRBL look-ahead model on the emitted bytes.
- **Untouched.** No other file under `j7-main` was touched, nor any `zz-n1r*` file.

## Findings

### N8-P2-1 (P1 after refuter) — Line Art and Smooth still delete full stops from ordinary anti-aliased text: a full stop with no ink within 5 px counts as dust and vetoes itself; Potrace keeps every one

- **Where:**
  - `src/core/trace/small-mark-neighbourhood.ts:113-117`: the dust census counts a "lone speck" as debris. A lone speck is a component at least 0.5 of the span dark (`AUTO_DARK_SPECK_REACH`) with no other ink within the support radius (5 source px).
  - `:130-140`: `debrisAround` sums the mark's own tile and the eight around it, **including the mark itself**.
  - `src/core/trace/small-mark-policy.ts:253`: `if (around.debrisAround(region) >= AUTO_DUST_MIN_DEBRIS) return false;` runs before the 8 px² isolated keep (`:254`) and before the pen-width rule (`:259`).
  - On the 2× grid a 7–8 px² stop measures 6.5–6.75 source px², under the 8 px² keep. Where the stop is not lone, the pen-width rule fails when the 'y' or 'g' stroke it faces measures 4.5–5.7 px wide (`need 5.40 > disc 4.92` mask px).
- **Anchor:**
  - **Contract.**
    - ADR-434 Decision 3d: "Stipple, dotted rows and small text pass".
    - The Auto tooltip promises to "keep drawn dots" (`TraceCheckboxRow.tsx:65`).
    - ADR-434 Amendment 2's Consequences: "On small text that is the full stop the drawing has".
    - ADR-434's Consequences accept dust-veto losses only "wherever a drawing has hard sub-floor or lone specks nearby". Here the only "lone speck" is the full stop itself, on clean anti-aliased text.
  - **Ground truth.** Potrace 1.16 keeps all of them. So does Sharp (no small-mark policy).
  - **Twin.** On the audit's own sentence ("mini quiz. jig, ii. lit."), every stop sits within 5 px of an "i", a "z" or a like mark, so the same code keeps all 12.
- **Scenario.** A caption or contact line, "Have a good day." or "Call us today." or "Made in Italy.", in Roboto at 20–28 px, ordinary anti-aliased text, traced with Line Art (the Free default) or Smooth.
  - The final full stop is not in the output.
  - The preview shows the result, which is not a warning (METHOD §3, 2026-10-27).
- **Evidence:** REPRO, with a debug probe.

  | Text, anti-aliased | Line Art | Smooth | Sharp | Potrace (1-bit / greymap) |
  |---|---|---|---|---|
  | "Have a good day." Roboto 20 / 24 / 28 px | 0 / 0 / 0 of 1 | 0 / 0 / 0 | 1 | 1 / 1 |
  | "Call us today." Roboto 20 / 24 / 28 px | 0 / 0 / 0 of 1 | 0 / 0 / 0 | 1 | 1 / 1 |
  | "Made in Italy." Roboto 20 / 24 / 28 px | 1 / 1 / 1 of 2 (stop lost) | 1 / 1 / 1 | 2 | 2 / 2 |
  | "easy. any. say. buy. dry." Roboto 20 / 24 / 28 px | **0 / 0 / 0 of 5** | 0 / 0 / 0 | 5 | 5 / 5 |
  | "big jig. bag. dog. pug. egg." Roboto 20 / 24 / 28 px | 4 / 6 / 3 of 8 | 4 / 6 / 4 | 8 | 8 / 8 |
  | "so X." for 61 characters (a–z without i, A–Z, 0–9), Roboto 20 + 24 + 28 px | **146 of 183** (lost after g q y a f r v F N P Q T V W Y 1 4 7 9) | 143 | 183 | 183 |
  | same, Tinos | 169 of 183 (lost after k P T U V W Y Z 1 4 7) | 173 | 183 | 183 |

  - **Mechanism, from the probe log.**
    - "say." at 24 px: the one small mark → `DROP debris n 1` on both the 1× and the 3× pass. Nothing else on the page is small, so the debris counted is the stop.
    - "easy. … dry." at 28 px: every stop → `DROP debris n 1` on the 2× pass, at 6.50–6.75 source px².
    - "Have a good day." at 24 px: the 2× pass fails the pen-width rule (`stroke 9.85, strokeWidth 9, disc 4.92, need 5.40` mask px).
  - **1-bit text** loses fewer: 163 / 183 Roboto, 175 / 183 Tinos.
  - **Pre-fix** (`93334429e`): Line Art kept 8 of 183 (Roboto) and 50 of 183 (Tinos). So #1496 improved this a lot, and this is not a regression. It is the original defect on everyday words that the fix's single test sentence does not contain.
- **Severity note.**
  - **Why P2 here.** Under this brief, "a fix that doesn't hold" is P2.
  - **The case for P1.** The defect is Q4-P2-3's own, raised to P1 under the trace clarification in `2026-10-27-quality-q1/AREAS.md`: a promised mark lost with no warning, on the Free default, on ordinary 20–28 px text.
  - The refuter and coordinator should decide whether Q4-P2-3's P1 carries over.
- **Fix direction:**
  - Do not count a component as debris against itself: exclude the region from `debrisAround`.
  - Do not count a compact, full-contrast mark of 3–11 px² as a "lone speck" when it sits on a text baseline (its bottom within a pixel of the neighbouring strokes' bottoms) or within about 1.5 em of a stroke.
  - Pin it with a test on "Have a good day." and the 61-character strip.
- **Refuter verdict: CONFIRMED. Severity raised P2 → P1.** This is Q4-P2-3 reopened, not a new sibling.
  - **What would make it false.** A font-rendering artefact; an ADR-434 decision that lone sub-8 px² marks go; a warning.
  - **Own renders, through `traceImageToColoredPaths` with `mergeLightBurnTraceSettings(TRACE_PRESETS[p], {})`, as the dialog builds it.** Ten everyday sentences at 20 / 24 / 28 px, 2 sub-pixel placements, from opentype paths rasterised by librsvg (sharp):
    - Roboto: Line Art kept 40 of 96 full stops, Smooth 41, Sharp 96, Potrace 95. "Made in Italy." lost its stop in all 6 renders.
    - Tinos: Line Art 95 of 96.
  - **Second, independent renderer: Pango/FreeType hinted text** (`sharp({text})`). This is how an application draws a caption. Final stop of 8 sentences × 3 sizes:
    - Arial: Line Art 14 of 24, Smooth 14 of 24, Sharp 24, Potrace 24. Lost on "Have a good day.", "Call us today.", "Made in Italy.", "Open daily." and "All rights reserved." at 20 and 24 px.
    - Roboto: Line Art 14 of 24, Sharp 24, Potrace 24.
    - Verdana: 24 of 24.
    - Calibri: 20 of 24; Potrace 16, because Calibri's 20 px stop is 2 px.
  - **Not an artefact.** Two renderers and four fonts lose the stop; Potrace and Sharp keep it on the same pixels.
  - **Mechanism, from the refuter's own probe bundle** (an esbuild `onLoad` log of `keepInkMark`; the files on disk are unchanged). It runs three ways:
    1. **Rule 3d on the 2× grid.** This is Q4-P2-3's own rule. Arial "day." at 24 px is kept natively (disc 2.76 ≥ 0.6 × 4) and dropped on the 2× pass, which is the output: disc 4.787 against a need of 4.8, from stroke width 8 mask px at the "y". The disc is taken from the stop's thresholded pixel count (4.5 source px²), not from its ink (5.7 source px²).
    2. **Rule 3b self-veto.** Roboto "say." at 24 px gives `drop-debris n 1` on both passes. The census counts the stop itself (`small-mark-neighbourhood.ts:113-117`), and `debrisAround` (`:130-140`) includes the mark's own tile.
    3. **3b on the 2× count.** Roboto "easy." at 28 px is kept natively (8 px², rule 3c). On the 2× pass it counts 7.5 source px², although it carries 8.5 px² of ink, so it becomes a "lone speck" and vetoes itself. ADR-434 3c says a lone 3x3 dot stays.
  - **ADR check.**
    - ADR-434 3b and 3d do remove lone sub-8 px² specks on purpose ("lone 2x2 specks do not" pass).
    - Branch 2 is that rule applied to a full stop, against Amendment 2's "On small text that is the full stop the drawing has" and the tooltip's "keep drawn dots".
    - Branches 1 and 3 break the ADR's own text: rule 3d is meant to keep tittles and full stops, and 3c keeps lone dots of 8 px².
    - No ADR accepts losing a full stop from clean text.
  - **Severity.** Under the 2026-10-28 trace clarification (AREAS.md), a promised mark lost with no warning is P1. Q4-P2-3 was rated P1 on exactly this effect.
    - The output is wrong: Potrace and Sharp keep the stop.
    - No warning reaches the operator. `TraceReport` carries no small-mark count, and the preview is not a warning.
    - "A fix that doesn't hold" is not a METHOD §3 ground for P2. Line Art is the Free default.
  - **Novelty.** Only Q4/Q5 mention full stops in `docs/audits`, and no open PR touches this code (only #1478 is open). The Q4-P2-3 ledger row ("fixed by #1496") should be reopened.

### N8-P2-2 (P1 after refuter) — On small 1-bit words (the 3× small-source route) a 3 px² i-dot measures 26.99999999999999 against a floor of 27, is dropped, and then counts as dust against the full stop beside it

- **Where:**
  - `src/core/trace/small-mark-policy.ts:243`: `if (region.length < minArea && inkCoverage(region, ink) < minArea) return false;`.
  - `src/core/trace/small-mark-neighbourhood.ts:113`: the same strict comparison sizes the dust census.
  - On a 3× grid, `minArea` = 3 × 9 = 27 mask px.
  - The coverage of a hard 3 px² dot, summed over its bilinear enlargement, comes to 26.99999999999999.
- **Anchor:**
  - **Contract.**
    - ADR-434 Rule 1: marks "under 3 px²" are removed.
    - ADR-434 Amendment 2, Decision 2: the floor judges "the ink it carries", and "Hard sub-floor specks carry exactly their pixel count, so they still fall under it". A 3 px² dot carries exactly the floor.
    - Amendment 2 also says "a rescued dot is not counted as dust against itself". Here it is.
  - **Twin.** The same dot on the native grid passes (`srcpx² 3.00 scale 1 -> KEEP`). Smooth's region on the same grid has 28 pixels and passes.
  - **Ground truth.** Potrace `-t 2` keeps every mark over 2 px².
- **Scenario.** A small 1-bit image of a word: a scanned 1-bit stamp, a PBM, or a cropped word under 100 px wide. Line Art (Free default).
  - "lit." at 20 px loses both its i-dot and its full stop.
  - A lone "i" at 20 px loses its dot.
- **Evidence:** REPRO, with a debug probe.
  - **The log** for Roboto "i", 20 px, 1-bit: `srcpx² 2.56 scale 3 -> DROP floor cov 26.99999999999999 minArea 27 len 23`.
  - **The cascade** in "lit.": the full stop (`srcpx² 3.56 scale 3`) → `DROP debris n 1`.
  - **The sweep:** 192 small 1-bit images ("i", "lit.", "mini.", "jig."; Roboto and Tinos; 18–24 px; 4 sub-pixel placements).
    - Line Art keeps **265 of 492** marks; Potrace keeps 435.
    - 73 marks on 56 images fall to the floor exactly at 26.99999999999999 (or 11.99999 on 2×).
    - With a 10⁻⁶ tolerance on the two comparisons (debug bundle only), Line Art keeps **342**: Roboto 116 → 156, Tinos 149 → 186. Smooth keeps 346 either way.
    - The rest of the gap to Potrace is the dust veto from genuine 1–2 px² fragments of the glyphs (K3).
  - **Pre-fix:** lone "i" and "lit." at 20 px were also 0, so this is not a regression. The amended floor rule does not hold for hard dots at exactly the floor.
- **Fix direction:**
  - Compare with a small tolerance (`< minArea − 1e-6`), or round the coverage sum, in both places.
  - Pin it with a 1-bit "lit." at 20 px.
- **Refuter verdict: CONFIRMED. Severity raised P2 → P1** (the same reopened Q4-P2-3; the coordinator may merge it with N8-P2-1).
  - **What would make it false.** The comparison may not be strict; the sum may not land under 27; the drop may be decided elsewhere.
  - **Code.** `small-mark-policy.ts:243` reads `region.length < minArea && inkCoverage(region, ink) < minArea`, and `small-mark-neighbourhood.ts:113` reads `component.length < input.minArea && input.coverage(component) < input.minArea`. Both are strict, with no tolerance. `minArea` = 3 × areaScale (`:194`), which is 27 on the 3× grid.
  - **Own probe.** Roboto "i" at 20 px, 1-bit, placed at +0.25 px:
    - native pass: `len 3 cov 3 → ok`;
    - 3× pass: `len 23 cov 26.999999999999989 minArea 27 → drop-floor`.
  - **Effect.** The output has no i-dot; Potrace and Sharp keep it.
  - **Own sweep.** 192 small 1-bit images (i, lit., mini., jig.; Roboto and Tinos; 18–24 px; 4 placements; own librsvg render and own mark masks from each glyph's small contours):
    - Line Art keeps 243 of 512 marks with the shipped comparison and **330 with a 10⁻⁶ tolerance**.
    - Potrace keeps 415 and Sharp 492.
    - The coverage lands just under the floor 71 times, on 58 images.
    - This matches the auditor's 265 → 342 of 492 and 73 on 56.
  - **Contract.** ADR-434 Amendment 2, Decision 2 says hard specks "carry exactly their pixel count". A 3 px² dot sits at the floor, not under it (Rule 1: "Under 3 source px²").
  - **Severity: P1 under the trace clarification.** The app promises the i-dot, and no warning reaches the operator. That holds however narrow the route (1-bit sources under 100 px): METHOD §3 lets reach lower only a defect that is not reachable today.

### N8-P2-3 — The two-level staircase fix (Q4-P2-1) does not survive JPEG: Smooth at q75, and Line Art at q60 or lower, trace a JPEG of binary art on its pixel staircase again

- **Where:**
  - `src/core/trace/staircase-source.ts:30,34-47`: a source counts as two-level only when at most 2% of its boundary cracks carry a sub-pixel edge (`STAIRCASE_MAX_MEASURED_FRACTION = 0.02`), judged on the preset's own prepared field.
  - JPEG ringing gives the edges of hard black-and-white art grey values, so the test fails. The image then takes the 2× route that Q4-P2-1 described (`trace-to-paths.ts:262-264`).
  - Smooth's median and Otsu field fails at q75; Line Art's band field fails at q60.
- **Anchor:**
  - **Contract.** ADR-530 Amendment 11 and #1497 promise that "a hard-edged black-and-white logo" draws on its own grid. In practice a downloaded logo is usually a JPEG; q75 is the IJG/libjpeg default.
  - **Ground truth.** Potrace on the same decoded pixels: 700 segments over the 79 images, the same as on the binary bitmaps.
- **Scenario.** A small icon or logo saved as JPEG, traced with Smooth (the Pro CNC default) or with Line Art at q60 or lower. The result is a bumpy circle and rippled straight edges: the Q4-P2-1 output.
- **Evidence:** REPRO.

  | Same bitmap after JPEG | Line Art | Smooth | Potrace |
  |---|---|---|---|
  | circle@32 (48 px canvas), q90 / q85 | 6 segments, 0 inflections | 6, 0 | 4 |
  | circle@32, **q75** | 6, 0 | **47, 40** | 4 |
  | circle@32, **q60 / q50** | **47, 40** | 47, 40 | 4 |
  | square-rot17@64, q60 | 145, 144 | 145, 144 | 7 |
  | Roboto S@48, q75 / q60 | 16, 4 / **77, 58** | **77, 58** / 77, 58 | 17 |
  | circle@32 at q75, canvas 48 / 64 / 96 / 99 / 100 | 6 / 6 / 6 / 5 / 6 | **47 / 47 / 38 / 5 / 6**: the 99/100 cliff is back | 4 |
  | 79 images at q75: W / T / L | 52 / 18 / 9 | **45 / 17 / 17** (55 / 17 / 7 binary) | — |
  | 79 images at q75: segments / inflections | 995 / 529 | **1,399 / 904** (771 / 286 binary) | 700 / 130 |

  The same JPEG run on the pre-fix engine scored 28 / 20 / 31, 28 / 13 / 38 and 27 / 16 / 36, with circle@32 at 46c + 1l and 40 inflections for both. #1497's apex bound and other changes still help a JPEG input. The staircase part does not reach it. #1497's tests (`staircase-source.test.ts`, `trace-two-level-art.test.ts`) use 0/255 inputs only.
- **Fix direction:**
  - Judge two-level-ness on the source's tone distribution: two dominant plateaus, with the mid-tones confined to a 1 px band along edges that are themselves pixel-aligned.
  - Or test the share of cracks after a light denoise.
  - Pin it with a JPEG q60 / q75 circle@32 for Line Art and Smooth.
- **Refuter verdict: CONFIRMED, P2 kept.** One anchor is corrected.
  - **What would make it false.** A JPEG-encoder artefact, or an ADR scope that accepts it.
  - **Own repro.** The refuter drew its own pixel-centre circle@32 (centre +0.31, +0.17) and square-rot17@64. It used its own segment count (cubics plus merged lines) and its own inflection count (0.25 px resample, more than 2° of opposite turning).
  - **Two independent JPEG encoders.** sharp/libjpeg, and Windows GDI+ written from PowerShell.
    - **Both encoders:** Smooth q75 gives **47 segments and 40 inflections** on 48 and 64 px canvases (38 / 30 on 96). Line Art q60 gives 47 / 40 on 48 px. Potrace stays at 4 / 0 throughout.
    - The 99 / 100 px cliff returns at q60: Line Art 37 / 28 against 5 / 0 with sharp, 35 / 26 against 6 / 0 with GDI+.
    - square-rot17 q60: Line Art 145 / 144 with either encoder; Potrace 7 / 2.
  - **Scope.** `staircase-source.ts:30` sets the 2% share.
    - ADR-530 Amendment 11's Consequences say "Anti-aliased, scanned and greyscale sources still take the enlarged trace unchanged". Its "Not part of this amendment" lists "Mixed sources above the 2% share".
    - So #1497 scoped JPEG-compressed binary art out openly. The finding is Q4-P2-1's defect persisting on that common input, not a broken #1497 promise.
  - **Anchor correction.** "A hard-edged black-and-white logo" is the code comment at `staircase-source.ts:7-8`, not ADR-530 or #1497 text (METHOD §4 citation rule). The anchors that stand are:
    - Twin: the same bitmap at 0/255 traces as 6 / 0;
    - Ground truth: Potrace gives 4 / 0 on the same decoded pixels;
    - Q4-P2-1's own defect statement.
  - **Severity.** P2, as Q4-P2-1. An ordinary user tracing a JPEG logo gets the staircase output.

### N8-P2-4 — Corner spikes remain where the ink bound does not reach: anti-aliased serif text (Line Art up to 1.7 px into pure paper, Sharp up to 4.25 px) and binary glyphs outside the 15-image scorecard set (up to 2.37 px off the ink)

- **Where:** `src/core/trace/contour-corners.ts:117-120`.

  ```ts
  const kept =
    input.measured || input.inkAt === undefined
      ? seated
      : inkBoundedApexes(input.cracks, seated, scale, input.inkAt);
  ```

  Anti-aliased loops are `measured` and skip the bound. The allowance of `contour-corner-legs.ts` (0.9 + 0.5 / sin(interior/2)) still applies to them. ADR-439 Amendment 1 scopes the bound to "binary apexes".
- **Anchor:**
  - **Ground truth.** Potrace 1.16 has 0 such nodes on all 72 images.
  - **Selinger §2.3.1:** each vertex stays in the unit square around its path vertex.
  - **Contract.** Q4-P2-2's fix direction: "Bound an apex by the ink it claims".
- **Scenario.** Rendered or scanned serif lettering (anti-aliased), traced with Line Art or Sharp. Serif tips and V or N vertices grow thin spikes into the paper.
- **Evidence:** REPRO (`f-spikes.mjs`).
  - **The set:** 72 glyph images, Tinos A M N V W k v x y z R K 4 7 and Roboto y v w A k K M W 4 7, at 24 / 32 / 48 px.
  - **The measure:** nodes turning ≥ 90° that lie ≥ 1 px from the true outline.

  | | Pre-fix | Main | Farthest on main |
  |---|---|---|---|
  | Line Art 1-bit | 80 on 28 images (3.37 px) | 11 on 9 | 2.01 px off truth; Roboto A@24 2.37 px from the 1-bit ink |
  | Line Art anti-aliased | 7 on 7 | **7 on 7 (unchanged)** | Tinos K@32 2.41 px off truth; Tinos N@32 **1.69 px from any ink above 2% coverage** |
  | Smooth 1-bit | 1 on 1 | 11 on 9 (now draws two-level sources as Line Art does) | 2.01 px |
  | Sharp 1-bit | 40 on 30 | 5 on 5 | 1.42 px |
  | Sharp anti-aliased | 25 on 18 (2.08 px) | 25 on 18 | **Tinos V@48 4.36 px off truth, 4.25 px from any ink**; Tinos A@48 3.54 / 3.22 px |
  | Potrace | 0 | 0 | — |

  On the 15 scorecard glyphs (1-bit) main has 0, as #1497 claims. The fix holds on that set and largely on binary art. Anti-aliased input, the commoner case for text, is untouched. Sharp's worst anti-aliased spike grew from 2.08 to 4.36 px, presumably through #1496's mid-level cut for two-plateau art (not root-caused).
- **Fix direction:**
  - Bound a measured loop's apex by its field: drop an apex whose replaced region holds a pixel whose luma is on the paper side of the cut by more than the crack interpolation allows.
  - Extend `contour-corner-ink.test.ts` with anti-aliased Tinos A, N, V and K.
- **Refuter verdict: CONFIRMED, P2 kept.** The Sharp magnitude is corrected.
  - **What would make it false.** A render artefact; an ADR that scopes it out on purpose.
  - **Code.** `contour-corners.ts:117-120` skips `inkBoundedApexes` for `measured` loops. ADR-439 Amendment 1 says "Measured loops keep Decision 3's own pixel-centre and field test". That is a scope boundary, not an acceptance of spikes. Q4-P2-2 measured 1-bit glyphs only, so anti-aliased spikes were never in the fixed set.
  - **Own repro, same 72 glyph images.** The refuter's own geometry: nodes turning ≥ 90° that lie ≥ 1 px from the flattened opentype outline, and their distance to any pixel with luma < 250. Renders are by librsvg at the (+0.31, +0.17) placement:
    - **Anti-aliased.**
      - Line Art: 8 spikes on 7 images, at most 2.71 px off the outline and **1.88 px into paper** (Tinos K@32).
      - Smooth: 6 on 6.
      - Sharp: 19 on 14, at most 2.04 / 1.71 px.
      - Potrace: 0.
    - **1-bit** (the anti-aliased render cut at 128): Line Art 4 spikes on 4 images. The worst is Roboto A@24, 2.01 px off the outline and **2.37 px from the ink**, the auditor's figure exactly. Potrace: 0.
  - **Placement sweep.** Tinos A M N V W K at 32 and 48 px, 5 sub-pixel placements: Line Art up to 2.17 px off the outline and 1.67 px into paper; Sharp up to 2.81 / 2.61 px.
  - **Correction.** The auditor's Sharp worst case, V@48 at 4.36 px off the outline and 4.25 px into paper, did not reproduce in any refuter render. The finding stands on Line Art's 1.7–1.9 px and Sharp's 2.6 px.
  - **Not re-fetched.** The Selinger §2.3.1 anchor was not re-fetched (UNVERIFIED). The Potrace ground truth is reproduced.

### N8-P2-5 — GRBL Compatible burns Fill with constant power (M3) and the #1491 advice never mentions it: small-text fill at 6000 mm/min gets 1.46× its dose

- **Where:**
  - `src/core/devices/gcode-dialects.ts:118`: `grbl-compatible` sets `fillPowerMode: 'constant'`.
  - `src/ui/laser/constant-power-warnings.ts:46-53` builds advice for `group.kind === 'raster'` and `'cut'` only, so Fill groups (`kind: 'fill'`) get `null`.
  - ADR-257 Amendment 1, Decision 1 lists images and Line cuts. Decision 3 puts fills only in the dialect's description, the Machine Setup hover text, not in any job advice.
- **Anchor:**
  - **Twin.** The image advice for the same dialect fires when the feed exceeds `sqrt(2·a·(N−1)·move)`. A small-text fill hatch is the same pattern: one G1 per stroke crossing, alternating S600 and S0 every 0.3 mm.
  - **Contract.** LightBurn (quoted in ADR-257 Amd 1): "stick with the default of Variable Power mode".
  - **Ground truth.** GRBL plans its newest block to a stop (`planner.c`, as Q1 cited).
- **Scenario.**
  - GRBL Compatible machine (the dialect for GRBL 1.1e and older).
  - Fill operation on text with 0.3–0.5 mm strokes, raised to 6000 mm/min.
  - Save, Start and Job Review show no constant-power advice. The fill burns darker on small text than on large areas of the same layer.
- **Evidence:** REPRO.
  - **Bytes:**
    - Fill output for 20 bars 0.3 × 3 mm at a 0.6 mm pitch is `G1 X20.300 … S600` / `G1 X20.600 S0` repeated, under `M3`.
    - `constantPowerWarnings` returns 0 entries, and `detectJobIntentWarnings` has none mentioning constant power.
    - Bars 0.5 mm and 1.2 mm wide give the same: 0 entries each.
  - **Own planner model** (15 blocks, 500 mm/s², δ 0.01 mm; `planner.mjs`): the lit-move dose is **1.46×** (0.3 mm strokes), 1.19× (0.5 mm) and 1.05× (1.2 mm). At 2500 mm/s² it is 1.00×. The same model gives 2.50× for Q1's 50% Jarvis row (Q1 measured 2.61×).
  - At the default 1500 mm/min the cap (about 3,900 mm/min for 0.3 mm moves) is not reached, so the over-burn needs a raised speed. The image advice covers exactly the same condition.
- **Why P2.** A Fill shows no tone, and constant S is what the layer and dialect state, the reasoning that kept Q6-P2-1 at P2. The image half was P1.
- **Fix direction.**
  - Give Fill groups the image rule, with the hatch's median lit-move length as the move.
  - Or name fills in the GRBL Compatible advice. Add a test beside `constant-power-warnings.test.ts`.
- **Refuter verdict: CONFIRMED, P2 kept.** One correction, and a novelty note.
  - **What would make it false.** Another advisory that names it; a dose that is not over.
  - **Code.** `constant-power-warnings.ts:50-54` returns `null` for any group that is not `'raster'` or `'cut'`. `gcode-dialects.ts:118` sets `fillPowerMode: 'constant'`.
  - **Own Vitest, through the real compile.** `createProject` → `prepareOutput` → `emitPreparedGcode`, then `detectJobIntentWarnings` and the preflight advisories. Twenty bars, 0.3 / 0.5 / 1.2 mm × 3 mm. GRBL Compatible and GRBL Dynamic at 1500 and 6000 mm/min, with the default 5 mm overscan and with Automatic overscan:
    - every GRBL Compatible run emits `M3`, with rows of `G1 … S600` / `G1 … S0` every 0.3 mm;
    - `constantPowerWarnings` returns 0 entries in every case.
  - **Correction: an advisory does fire, but not for this.** At 6000 mm/min with the default 5 mm overscan, the runway advisory fires: "has at most 5 mm of scan-entry runway … Review Overscan or reduce speed". It fires the same way under M4, where the dose is 1.00×, and it is about the row ends.
    - With Automatic overscan it is gone, and nothing about power remains.
    - Neither case warns that thin features burn darker.
  - **Own planner model.** The refuter wrote its own time-stepped look-ahead model without reading `planner.mjs`: GRBL junction deviation, a 15-block buffer whose newest block is planned to a stop, 500 mm/s², δ 0.01 mm.
    - On the emitted bytes the M3 lit-move dose is **1.462× / 1.192× / 1.046×** for the 0.3 / 0.5 / 1.2 mm bars. It is 1.436× with Automatic overscan, and 1.000× at 1500 mm/min or at 2500 mm/s².
    - The same model gives 2.502× on the auditor's Jarvis 50% bytes and 2.621× on a strict 0.1 mm on/off row (Q1 measured 2.61×).
  - **Severity: P2, as Q6-P2-1.** A Fill shows no tone, and the constant S is what the layer and dialect state. The GRBL Compatible description (ADR-257 Amd 1, Decision 3) names fills as M3, though only as Machine Setup hover text. The excess needs a speed raised past about 3,900 mm/min.
  - **Novelty and coordinator note.** Q6 already recorded "GRBL Compatible fills run M3" as **Q6-K1, KNOWN under Q1-P2-1 and tagged P1** (`Q6-vector-burn-quality.md:287`, JSON `Q6-K1`). It counted fills as advised because the runway advisory fired.
    - With Automatic overscan, or with a raised overscan, there is no advice. The ledger's "Q1-P2-1 fixed by #1491" therefore covers images and Line only.
    - The coordinator should either reopen Q6-K1's Fill half under this ID at P2 (the refuter's call, on Q6-P2-1's no-tone reasoning) or carry Q6-K1's P1 tag over.

### N8-P3-1 — The new lighting gate (ADR-402 Amd 2) no longer levels a deep vignette whose corners fall to about 15% of the centre paper: Smooth and Sharp go from IoU 0.90 / 0.91 to 0.24 / 0.25, where mkbitmap + Potrace keeps 0.87

- **Where:** `src/core/trace/background-flatten.ts:96`, `MIN_PAPER_LEVEL_RATIO = 0.25`, and `paperRange` (`:442`).
- **Anchor.** ADR-402 Amendment 2, Decision 1: "Lighting dims a sheet; it does not turn it black". It measured real uneven pages at 0.32–0.69, and its test declines "a ramp to near black". That is a stated design boundary, hence P3.
- **Evidence:** REPRO (`make-vig.mjs`). The Q5 text page was multiplied by 1 − k·(r/R)².

  | k | Smooth / Sharp, main | Report | Smooth / Sharp, pre-fix | P-mk (corrected) / plain |
  |---|---|---|---|---|
  | 0.60 / 0.70 / 0.78 | 0.929–0.927 / 0.919–0.918 | levelled | — / — / 0.897 / 0.912 | 0.869–0.873 / 0.436–0.290 |
  | **0.85** | **0.242 / 0.246** (11 merges) | plain cut 147 / 145 | 0.899 / 0.911 (levelled) | 0.873 / 0.263 |

  - Q5's dim probe (paper 250 → 120) and the ramp still level.
  - A photo of a page with a lamp's hot spot and dark corners is the case lost.
- **Fix direction.** Decline a tone range only when the paper fit also fails a smoothness test, or let the ratio follow the noise floor rather than a fixed ¼. Say "lighting not evened out: the corners are too dark" in the note.
- **Refuter verdict: CONFIRMED, P3 kept.**
  - **Code.** `background-flatten.ts:96` sets `MIN_PAPER_LEVEL_RATIO = 0.25`; it is applied at `:242`.
  - **Contract.** ADR-402 Amendment 2, Decision 1 ("Lighting dims a sheet; it does not turn it black") sets this boundary on purpose, from measured pages at 0.32–0.69.
  - **Own vignettes.** Q5's text-clean.ppm × (1 − k(r/R)²), with R the half-diagonal, scored with the refuter's IoU:
    - Smooth / Sharp 0.928 / 0.919 at k 0.60 and 0.927 / 0.918 at 0.78;
    - **0.242 / 0.246 at 0.85**, with 11 components lost or merged; 0.239 / 0.241 at 0.90;
    - mkbitmap + Potrace (corrected) 0.873.
  - **Severity.** The corners fall to 15% of the centre paper, below every measured real page. P3 as a stated boundary.

### N8-P3-2 — Colour layers after a slight blur: the black centre lightens to #3b3b3b, so every other layer starts 1.16–1.18× higher than on the clean art

- **Where:** the auto palette centres in `src/core/trace/colour-palette.ts`, and `colourLayerSettings` (`colour-layer-power.ts:52-77`). The latter scales each colour's power by its darkness against the darkest layer.
- **Evidence:** REPRO (`f-colour.mjs`, saturated logo).
  - **Clean:** layers band 25%, green 49.1%, red 57.1%, blue 69.1% and black #1e1e1e 100%.
  - **Blur σ 1:** black #3b3b3b 100%, green 57.9%, red 67.3%, blue **81.6%**.
  - **Blur + JPEG q75:** black #3a3a38, blue 81.1%.
  - JPEG and grain alone keep black at #191919–#1e1e1e and blue at 67–69%.
- **Assessment.** Q5-P2-2's main failure is fixed: black has its own layer at 100% and the text is not moved. What remains is a 1.18× tone shift on the other colours after blur. An improvement, P3.
- **Fix direction.** Take a flat-area colour centre from the darkest flat plateau (as #1496 does for the cut) rather than the cluster mean.
- **Refuter verdict: CONFIRMED, P3 kept.** The size of the shift depends on the text weight.
  - **Own scene.** The refuter built its own saturated logo in librsvg: a yellow band, red disc, turned blue square, green triangle and black "Colour 2026" in Roboto. It used sharp's `blur(1)`, the `Colour layers` preset, then `colourLayerSettings(colours, 100, {output: 'cut-out'})`.
  - **34 px text** (the auditor's size): black #1d1d1d → #383838; blue 69.9% → 81.2% (1.16×), red 57.1% → 66.6%. Blur + q75 is the same. q75 alone is unchanged.
  - **44 px text:** black #1b1b1b → #2a2a2a; blue 69.1% → 74.9% (1.08×).
  - **Mechanism.** It follows from the code: power scales with darkness over the darkest layer's darkness (`colour-layer-power.ts:67-75`). Q5-P2-2's main failure stays fixed: black keeps its own 100% layer.

## KNOWN re-observed

- **K1. Glyphs at 96 px still lose: Line Art 0 / 2 / 3, Smooth 0 / 1 / 4.** These are the straight-run flattener's flats on bowls (Q4-P3-3). #1497's Known gaps record it. Main has Roboto g, R and S at 96 px as losses.
- **K2. Sharp's segment count is 3.6× Potrace's (2,509 against 700): segments 1 / 21 / 57, excess turning 9 / 14 / 56** (Q4-P3-1). Sharp still wins 49 / 22 / 8 overall.
- **K3. The dust veto removes genuine marks next to 1–2 px² fragments of a glyph** (1-bit serif text, Tinos 18–20 px). Line Art keeps 4 of 12 on Tinos 20 px 1-bit; Potrace keeps 9. These are ADR-434's Consequences, "The dust veto costs genuine detail wherever a drawing has hard sub-floor or lone specks nearby". The fragments are real sub-floor specks.
- **K4. Line Art's colour detail turns σ 12 grain on Arch House into 653 specks (626 before)** (Q5-P3-1). It is the one A-row loss.
- **K5. Speed.** Line Art takes a median 215 ms per real crop against Potrace's 32 ms per process (6.7×; 10× before). Q4-P2-1 recorded the speed half.
- **K6. Pale fine print on the low-res logo.** Smooth now loses 24 of 50 parts, against 14 before, and Sharp 24 against 12. Sharp's IoU on salt-and-pepper text is 0.879 → 0.834. Both are #1496's recorded costs (ADR-402 Amendment 1). The tally still scores logo low-res as W.
- **K7. On two-level crops, Line Art's IoU against the bilevel input fell 0.9425 → 0.9059**, under Potrace's 0.9084, as #1497 records: smoothness traded for staircase-following.

## Refuted

- **Refuter (2026-10-29): no finding refuted.** All 7 are CONFIRMED.
  - Two magnitudes are corrected inside their findings: Sharp's anti-aliased spike, 4.25 px into paper (N8-P2-4), and the N8-P3-2 shift, which depends on text weight.
  - One anchor is re-cited: the N8-P2-3 quote is a code comment.
  - One "no advice" claim is narrowed: N8-P2-5's runway advisory fires at the default overscan.
- **"The original Q4 / Q5 scripts are deleted."** They are not. `zz-q4/`, `zz-q4r/`, `zz-q5/` and `zz-q5r/` are intact in the scratchpad (last modified 2026-10-28 01:15–02:12, before #1497 merged). They were copied, not edited. The copies reproduce the archived totals on the pre-fix engine, so the re-measure uses exactly Q4's and Q5's images and rules.
- **"#1497's 51 / 20 / 8 may not hold now that #1496 has merged."** #1497 was measured on `9e20cc061` + its branch, without #1496 (`git merge-base --is-ancestor dc0631a2a 40def8240` is false). On main both are in, and all three presets reproduce #1497's table cell for cell. The 79 images contain no 3–11 px² marks and no grey, so #1496's cut and mark rules do not touch them. On the real crops #1496 does show, as +26 rings (872 → 898).

## Verified clean

- **Q4 79-image scorecard on main.** Every #1497 aggregate holds: segments 813, mean error 0.116 px, Hausdorff max 1.89 px, 237 / 331 corners kept, 45 / 46 at 200 px, thin-stroke area 3.2%, topology 79 / 79, glyph spikes 0, and two bar-end spikes 0.84 / 1.10 px off ink. The independent scorer agrees on 60 / 60.
  - **Refuter's own scorer:** 79 / 79 per-case agreement for Line Art and for Sharp under Q4's sampling.
  - Under strict arc-length sampling it gives 49 / 22 / 8 and 47 / 21 / 11. The Headline has the detail.
- **Q4-P1-1.** All dots kept, for every preset, on two-level pages and on alpha masks. The pre-fix engine shows 0 / 6, including transparent PNGs with white paper RGB, so the check discriminates. The ADR-402 Amd 1 tied-cut text matches the code: `otsu-cut.ts` (new) resolves a tied stretch to its middle.
- **Q4-P2-1 on two-level sources.** The 99 → 100 px cliff is gone for binary art: 5–6 cubics with 0–1 inflections on every canvas from 48 to 160 px.
- **Q4-P2-2 on the scorecard glyphs.** 0 spikes for Line Art, Smooth and Sharp.
- **Q4-P2-3 on the audit's sentence.** Fixed on "mini quiz. jig, ii. lit." at 20–32 px for Roboto (and Tinos at 24+), anti-aliased and 1-bit, and on a lone 28 px "i". The PR's 14 new end-to-end tests pass on main (`trace-automatic-decisions.test.ts`, 14 / 14); so do `staircase-source.test.ts` (6 / 6) and `contour-corner-ink.test.ts` (7 / 7).
- **Q5-P2-1, Q5-P2-2 and Q5-P2-3.** All three fixed, with numbers in the scorecard.
  - The gate's "one verdict per trace" holds: no case reported a plain cut while levelling.
  - The uneven pages still level: ramp40, photo, dim; vignettes up to k = 0.78.
- **Burn:**
  - **#1490.** Grayscale and Pass-through energy is ≈ 1.0 less the line-end trims.
  - **#1491.** Image advice above the look-ahead speed; Line advice for GRBL Compatible and the 4040; the 4040's 5 mm laser-off exit along the line.
  - **#1487.** Pass-through keeps a 0.1 mm row pitch and 1.00 dose at any turn and scan angle. Aligned turns (image 37° with scan 53°, 143° or 323°; 45° with 45° or 315°) keep the 64 × 64 grid.
  - **#1494.** Line Screen and Halftone track tone at 0°, 90° and 4 px, and are unchanged at 15°, 30° and 45° (max 0.0009 / 0.0008 / 0.0091).
- **Q5 per-case.** Smooth beats mkbitmap on all 10 text cases, including blur and low-res, the two Q5 losses. Text counters and stroke weight are now within a few percent.

## Not verified

- **Test truth on the pre-fix commit (L10 step 5).** No git checkout is allowed here, so the PRs' new tests were not run on their parent commits. #1496's body says its end-to-end test fails 14 / 14 on `origin/main`, and #1497's says its two-level tests fail on main. My own checks do fail on the pre-fix bundle, so they discriminate: dots 0 / 6, i-dots, 8 of 15 gate flips, Colour layers, spikes 80, JPEG 46c.
- **The CLI twin** (`scripts/trace-cli.mjs`) on main: not re-run, because the shared `node_modules` lacks a top-level `fflate`. The core entry was measured.
- **Region Enhance's frozen cut** (ADR-435 Amd 1) was read only, not run.
- **Hardware.** No burn was made. M3 doses come from an own planner model, calibrated against Q1's 2.61×.
- **Sharp's anti-aliased spike growth** (2.08 → 4.36 px) is attributed to #1496's cut change by elimination only.
  - **Refuter:** the 4.36 px did not reproduce in any of its renders. librsvg over 5 sub-pixel placements gave at most 2.81 px off the outline and 2.61 px into paper. So the growth itself is unconfirmed; N8-P2-4 stands on smaller spikes.
- **Refuter, not run:**
  - the pre-fix engine;
  - the 61-character full-stop strip, and the auditor's 7-metric weighting;
  - Smooth's 55 / 17 / 7 with the refuter's own metrics. It was re-tallied only from the auditor's raw metrics.
  - logo and Arch House cases of Q5. Only text cases were re-scored, because those need no wobble or apex metric.

```json
[
  {"id":"N8-P2-1","severity":"P1","area":"tracer-remeasure","file":"src/core/trace/small-mark-neighbourhood.ts","line":113,"anchor":"Contract: ADR-434 Decision 3d 'small text pass', Amd 2 Consequences 'On small text that is the full stop the drawing has', Auto tooltip 'keep drawn dots' (TraceCheckboxRow.tsx:65); ADR-434 Consequences accept dust-veto losses only near real sub-floor/lone specks; Ground truth: Potrace 1.16 and Sharp keep every stop; Twin: the audit sentence keeps 12/12 because each stop sits beside an i or z","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A full stop with no ink within 5 source px is counted by the dust census as a lone dark speck and debrisAround (which includes the mark's own tile) vetoes it (small-mark-policy.ts:253, before the 8 px2 keep and the pen rule); where it is not lone the pen-width rule fails against y/g strokes. Roboto AA 20/24/28 px: 'Have a good day.', 'Call us today.' lose the stop every time, 'easy. any. say. buy. dry.' 0/5; full stop after 61 characters: Line Art 146/183 Roboto and 169/183 Tinos, Smooth 143/183 and 173/183; Potrace and Sharp 366/366. Pre-fix 8/183 and 50/183, so improved but Q4-P2-3 does not hold beyond its test sentence. Severity note: Q4-P2-3 was P1 under the trace clarification","refuter":"CONFIRMED with two own renderers (opentype->librsvg Roboto 40/96 stops kept by Line Art vs Potrace 95/96; Pango/FreeType hinted Arial 14/24 final stops vs Potrace and Sharp 24/24) and an own keepInkMark probe: three causes, rule 3d pen-width on the 2x grid (disc from thresholded count 4.787 < 4.8), 3b self-veto of a lone stop, and 3b on the 2x count of a stop carrying 8.5 px2 of ink","severityChange":"P2 -> P1: reopens Q4-P2-3 (P1); a promised mark lost with no warning (AREAS 2026-10-28 trace clarification); output wrong (Potrace and Sharp keep it), no warning; \"a fix that does not hold\" is not a METHOD 3 ground"},
  {"id":"N8-P2-2","severity":"P1","area":"tracer-remeasure","file":"src/core/trace/small-mark-policy.ts","line":243,"anchor":"Contract: ADR-434 Rule 1 removes marks under 3 px2; Amd 2 Decision 2 floor judges the ink carried and a rescued dot is not counted as dust against itself; Twin: same dot passes on the native grid and in Smooth (28 px region); Ground truth: Potrace -t 2 keeps marks over 2 px2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On the 3x small-source grid a hard 1-bit 3 px2 i-dot sums to inkCoverage 26.99999999999999 against minArea 27 (strict <, also small-mark-neighbourhood.ts:113), so it is dropped and then counted as sub-floor debris that removes the neighbouring full stop: 'lit.' 20 px 1-bit Line Art 0/2, lone 'i' 20 px loses its dot. 192 small 1-bit word images: Line Art keeps 265/492 marks vs Potrace 435; 73 marks on 56 images hit the epsilon; with a 1e-6 tolerance Line Art keeps 342","refuter":"CONFIRMED: strict < at small-mark-policy.ts:243 and small-mark-neighbourhood.ts:113; own probe Roboto i 20 px 1-bit cov 26.999999999999989 vs minArea 27 -> drop-floor; own 192-image sweep Line Art 243 -> 330 of 512 marks with a 1e-6 tolerance (Potrace 415), 71 floor hits on 58 images","severityChange":"P2 -> P1: same reopened Q4-P2-3 (an i-dot the app promises, lost with no warning); may be merged with N8-P2-1"},
  {"id":"N8-P2-3","severity":"P2","area":"tracer-remeasure","file":"src/core/trace/staircase-source.ts","line":30,"anchor":"Contract: ADR-530 Amd 11 / #1497 'a hard-edged black-and-white logo' draws on its own grid; Twin: the same bitmaps at 0/255 trace 6 cubics; Ground truth: Potrace on the same decoded JPEG pixels 700 segments / 130 inflections over 79 images","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The two-level test (<= 2% of boundary cracks with a sub-pixel edge, on the preset's own field) fails on JPEG-compressed binary art, so the 2x staircase route of Q4-P2-1 returns: Smooth at q75 and Line Art at q60 trace circle@32 as 47 segments with 40 inflections (Potrace 4), Roboto S@48 77/58, and the 99/100 px cliff reappears (47/47/38/5/6 at 48/64/96/99/100). 79 images after q75: Smooth 45/17/17 (55/17/7 binary), 1,399 segments vs 771 binary and 700 Potrace","refuter":"CONFIRMED with own circle/square rasteriser and two JPEG encoders (sharp, Windows GDI+): Smooth q75 47 segments / 40 inflections, Line Art q60 47/40, Potrace 4/0; 99/100 cliff back at q60. ADR-530 Amd 11 leaves scanned/greyscale and mixed (>2%) sources out, so this is Q4-P2-1 persisting on JPEG input; anchor corrected: \"hard-edged black-and-white logo\" is the code comment staircase-source.ts:7-8, not ADR or PR text","severityChange":"none (P2 as Q4-P2-1)"},
  {"id":"N8-P2-4","severity":"P2","area":"tracer-remeasure","file":"src/core/trace/contour-corners.ts","line":117,"anchor":"Ground truth: Potrace 1.16 0 nodes >= 1 px off on 72 glyph images; Selinger 2003 s2.3.1 unit-square bound; Contract: Q4-P2-2 fix direction 'bound an apex by the ink it claims', ADR-439 Amd 1 scopes the bound to binary apexes","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Measured (anti-aliased) loops skip inkBoundedApexes, and binary glyphs outside the 15-image set keep some spikes. 72 further glyph images (Tinos/Roboto serifs, 24-48 px): Line Art AA 7 spikes on 7 (unchanged from pre-fix), Tinos N@32 node 1.69 px from any ink; Sharp AA 25 on 18 with Tinos V@48 4.36 px off truth / 4.25 px into paper (pre-fix max 2.08); Line Art 1-bit 11 on 9 (pre-fix 80 on 28) up to 2.37 px from the 1-bit ink; Smooth 1-bit 1 -> 11; Potrace 0","refuter":"CONFIRMED on own renders of the same 72 glyph images: anti-aliased Line Art 8 spikes on 7 images up to 1.88 px into paper, Sharp 19 on 14; 1-bit Roboto A@24 2.37 px from ink exactly; Potrace 0. ADR-439 Amd 1 scopes the bound to binary apexes (measured loops keep Decision 3). Correction: Sharp V@48 4.36/4.25 px not reproduced in any own render (max 2.81 px off outline / 2.61 px into paper over 5 placements). Selinger anchor UNVERIFIED (not re-fetched)","severityChange":"none"},
  {"id":"N8-P2-5","severity":"P1","area":"tracer-remeasure","file":"src/ui/laser/constant-power-warnings.ts","line":46,"anchor":"Twin: the image advice for the same dialect fires when feed > sqrt(2a(N-1)move); Contract: ADR-257 Amd 1 (LightBurn 'stick with the default of Variable Power mode'), Decision 1 covers images and Line cuts only; gcode-dialects.ts:118 grbl-compatible fillPowerMode constant; Ground truth: GRBL plans its newest block to a stop (planner.c, as Q1 cited)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"GRBL Compatible Fill groups burn with M3 and constantPowerWarnings returns null for kind 'fill'; no Save/Start/Job Review advice. Small-text fill hatch (S600/S0 every 0.3 mm) at 6000 mm/min, 500 mm/s2: own 15-block planner model gives 1.46x dose (0.5 mm strokes 1.19x, 1.2 mm 1.05x); the same model gives 2.50x for Q1's 50% Jarvis row (Q1: 2.61x). P2 as Q6-P2-1 (fill shows no tone)","refuter":"CONFIRMED through own Vitest prepareOutput -> emitPreparedGcode: GRBL Compatible fill is M3 and constantPowerWarnings is empty for every case; own look-ahead model 1.462x / 1.192x / 1.046x (2.502x on the Jarvis bytes). Correction: at the default 5 mm overscan and 6000 mm/min the runway advisory does fire (also under M4, about row ends); with Automatic overscan nothing fires and the dose is 1.436x. Novelty: Q6-K1 recorded GRBL Compatible fills under Q1-P2-1 (tagged P1), so this reopens the Fill half","severityChange":"none (P2 on Q6-P2-1 no-tone reasoning); coordinator to reconcile with the Q6-K1 P1 tag"},
  {"id":"N8-P3-1","severity":"P3","area":"tracer-remeasure","file":"src/core/trace/background-flatten.ts","line":96,"anchor":"Contract: ADR-402 Amd 2 Decision 1 ('Lighting dims a sheet; it does not turn it black', ratio >= 1/4, tested 'a ramp to near black is declined'); Twin: pre-fix levelled the same page; Ground truth: mkbitmap+Potrace 0.873","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A vignette of 1-0.85(r/R)^2 (corners at about 15% of the centre paper) is no longer levelled: Smooth/Sharp text IoU 0.899/0.911 pre-fix -> 0.242/0.246 on main (plain cut 147/145, 11 merges); k <= 0.78 still levels; documented boundary","refuter":"CONFIRMED with own vignettes of text-clean: Smooth/Sharp IoU 0.927/0.918 at k 0.78, 0.242/0.246 at k 0.85; MIN_PAPER_LEVEL_RATIO 0.25 is ADR-402 Amd 2 Decision 1","severityChange":"none"},
  {"id":"N8-P3-2","severity":"P3","area":"tracer-remeasure","file":"src/core/trace/colour-layer-power.ts","line":52,"anchor":"Contract: Colour layers hint 'Darker colours start at more power' (ColourLayerTraceSettingsControls.tsx); Twin: the clean art's layer powers","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"After blur sigma 1 (or blur + JPEG q75) the auto palette's black centre is #3b3b3b instead of #1e1e1e, so every other layer starts 1.16-1.18x higher than on the clean logo (blue 69.1% -> 81.6%, red 57.1% -> 67.3%); the text itself stays on its own black layer at 100% (Q5-P2-2 fixed)","refuter":"CONFIRMED with own saturated logo: with 34 px text, black #1d1d1d -> #383838 after blur sigma 1, blue 69.9% -> 81.2% (1.16x); with 44 px text the shift is 1.08x","severityChange":"none"}
]
```
