# Quality audit Q1 — Trace on real images (Q5)

- **When:** 2026-10-28 01:25 – 02:15 +0800   **Tree:** origin/main @ `93334429e` (fetched at the start and
  again at the end; worktree `claude/rolling-audit-v5`, HEAD `012e059e9` at the start, `c54fa8226` at the
  end, both docs-only over the merge base). `git diff origin/main -- src/core/trace` is empty, so every
  repro ran on main's tracer. `src/ui/trace` differs from main only in image decoding (`image-loader.ts`,
  the PNG/JPEG header readers and their tests, from #1484); none of them is cited or on the measured path,
  because inputs were decoded outside the app (see Measurement method). `src/ui/camera` differs in
  `calibrate/transient-camera-job.ts` only (camera calibration jobs), which is not on the trace path.
- **Refuter tree (2026-10-28, 02:15–03:30 +0800):**
  - `git fetch origin main` gives `93334429e`, unchanged. `git diff origin/main -- src/core/trace` is empty, and `scripts/trace-cli.ts` is unchanged.
  - `src/ui/trace` differs only in image decoding (#1484).
  - The auditor did not list `src/ui/trace-cli/trace-cli-source.ts`. It differs from main only in PNG eXIf orientation for the CLI (#1484), and no measured input carries an orientation.
  - Every refuter repro ran this worktree's trace core (main's) through its own esbuild bundle. It used the Trace worker's runner (`steps.next(false)`, `trace-worker.ts:143-160`) rather than the auditor's `next(true)`; the outputs are the same.
- **Scope:** the real-image trace path from the Trace dialog to vectors:
  - preprocessing in `src/core/trace/`: the brightness band, the automatic (Otsu) cut, background
    flattening (`background-flatten.ts`, ADR-402), the automatic median (`preprocess.ts`,
    `auto-median.ts`), the small-mark policy (ADR-434, as it shows on real inputs), auto-upscale,
    Line Art's automatic local detail (`auto-sketch-trace.ts`, `automatic-detail-mask.ts`), Faint lines
    and Sketch;
  - Centerline (`centerline/`, ADR-405), Colour layers (`colour-layer-trace.ts`, `colour-palette.ts`,
    `colour-quantize.ts`, ADR-461), Photo shading (`photo-trace.ts`, `photo-ribbons.ts`), Edge
    Detection in passing;
  - twins: the CLI (`scripts/trace-cli.*`, ADR-477) against the core, Multi-File Trace
    (`batch-trace.ts`), the dialog preview against the commit, and the camera and jig entry points
    (ADR-633).

  Governing: ADR-402, ADR-405, ADR-434, ADR-437, ADR-461, ADR-477, ADR-530, ADR-533, ADR-633. Q4's
  synthetic-shape results (`Q4-trace-vs-potrace.md`) are not repeated; where a real image shows a Q4
  cause it is listed as KNOWN.
- **Lenses run:**
  - **L4** (adversarial input): eight degradations of three images, plus two probes (dim page, impulse
    noise), and noise and JPEG-quality sweeps.
  - **L7** (test truth): which degraded inputs the shipped tests exercise.
  - **L3** (twins): CLI against core on degraded PNGs; preview against commit, camera and jig by code
    reading.
  - Potrace 1.16 and mkbitmap 1.16 were run as separate processes on the same pixels, with documented
    options only. No Potrace or mkbitmap source was read.
- **Counts:** 7 raised → 0 refuted → P1 1 / P2 2 / P3 4 (+ 4 KNOWN re-observed).
  - Refuter: 7 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. Of the KNOWN items, K1–K3 were re-run and K4 was read.
  - Severity change: Q5-P2-2 goes P2 → P1 (tone; see the finding).
  - Headline totals corrected for mkbitmap's fixed quarter-pixel offset: B 24 / 1 / 2 → 22 / 3 / 2, and C 22 / 1 / 4 → 23 / 1 / 3.

## Headline

**On real, degraded inputs KerfDesk now beats the documented mkbitmap + Potrace pipeline in most
cases, but not on small marks, counters and automatic decisions that flip under mild degradation.**

Against mkbitmap + Potrace with mkbitmap's defaults (`-f 4 -s 2 -t 0.45`), Smooth scores **24 wins,
1 tie and 2 losses** over 27 input × degradation cases. Against plain-threshold Potrace, Line Art
scores 18 / 7 / 2. Best-of-three KerfDesk presets against best-of-three Potrace pipelines scores
22 / 1 / 4.

**Refuter correction to these totals.** mkbitmap's ×2 scaling shifts its output by a fixed (−0.25, +0.25)
source px. This was measured on a pixel-aligned square and on an anti-aliased disc; plain Potrace has no
such shift. The auditor left the shift in, so every P-mk and P-mk16 IoU and edge-distance figure is
biased against Potrace.
- **The auditor's cases, offset removed.** Re-scored with the auditor's own scorer:
  - **B is 22 / 3 / 2:** text "paper" and "dim" become ties.
  - C is 23 / 1 / 3, and A is unchanged at 18 / 7 / 2.
  - P-mk's text IoU rises from 0.773 to 0.817. That is level with Smooth (0.824) and Line Art (0.828).
- **The refuter's own scenes** (librsvg-rendered text and logo, 6 degradations, 12 cases):
  - Smooth scores 10 / 0 / 2 against mkbitmap's defaults, with or without the offset.
  - It scores 8 / 3 / 1 against a tuned mkbitmap without the highpass (`-n -t 0.5`).
  - Against that tuned baseline KerfDesk still wins IoU (9 / 2 / 1). It loses Hausdorff (2 / 2 / 8) and
    lost + merged components (1 / 5 / 6).

So the "better than mkbitmap + Potrace" headline holds on IoU and segments, but by less than stated.
On text IoU, mkbitmap with the offset removed is level with Smooth and Line Art; only Sharp leads, by
0.026. Smooth's remaining text wins come from segments, specks and edge distance.

The win against mkbitmap's defaults is partly cheap. Its radius-4 highpass hollows every solid area
wider than about 12 px, so a solid logo traces as outlines (IoU 0.585). It also turns grain into
specks: 1,648 added specks over the eight logo conditions.

Refuter: CONFIRMED.
- On the refuter's own logo, mkbitmap's defaults give IoU 0.56–0.60 and 37% less area. A 40 px disc
  gives 0.53. σ 12 grain adds 1,175 specks.
- Without the highpass (`-n -t 0.5`) the same logo scores 0.959 against Smooth's 0.972.

**Where KerfDesk wins:**
- **Edge fidelity on anti-aliased art.** Mean edge distance on the logo is 0.15–0.33 px against
  0.38 px for plain Potrace and 1.70 px for mkbitmap. Text IoU is 0.83–0.84 against 0.75–0.77.
- **Corners.** 66–76 of 88 known corners stay sharp, with a 0.28–0.43 px apex gap. Potrace keeps 1–9
  of 88 sharp, with a 0.42–1.04 px gap.
- **Noise.** 3–9 added specks over eight logo conditions, against 15 (plain) to 1,648 (mkbitmap).
- **Uneven lighting.** Smooth and Sharp level the light (ADR-402) and score as on the clean page.
- **Photo shading** keeps a photo's tones: r 0.980, mean error 0.034. Potrace has no equivalent.
- **Twins.** The CLI and the core agree within 7 × 10⁻⁶ px.

**Where it loses** (per metric, KerfDesk loses "lost + merged components" in 15–18 of 27 cases and
"hole errors" in 10):
1. **Small marks and counters.**
   - i-dots, the comma and the full stops of a 20 px line are removed by Line Art and Smooth
     (KNOWN Q4-P2-3, now P1).
   - **Q5-P2-1.** On slightly blurred or low-resolution small text, Smooth's and Sharp's automatic cut
     sits so far toward the paper that strokes come out 33–75% too heavy and 3–16 letter counters
     close. Potrace and mkbitmap keep them.
2. **Automatic decisions that flip under mild degradation.**
   - **Q5-P2-2 (P1 after refuter).** Colour layers' automatic palette drops the black text of a
     flat-colour logo at JPEG quality 60 or lower (75 in the refuter's scenes), and puts it on another
     colour's layer. On a pale logo the black text then burns at 41% power instead of 100%.
   - **Q5-P2-3.** Noise of σ 3, invisible to the eye, sends Smooth and Sharp onto the
     uneven-lighting route on a photograph. The trace then differs from the clean photo's (IoU 0.70)
     while plain Potrace's stays at 0.98. Whether it flips depends on the noise draw: the gate sits at
     46% paper cells against a 50% floor.
   - **Q5-P3-1.** Line Art's colour detail turns σ 12 grain into 626 specks.
3. **Speed and pale small text.**
   - Traces are about 5–10× slower than Potrace (KNOWN Q4-P2-1).
   - **Q5-P3-2.** On a low-resolution grey logo, every preset loses 9–26 of 50 marks, where mkbitmap's
     highpass keeps all but 3–4.

## Scorecard

KerfDesk = Line Art (LA, the default), Smooth (Sm) and Sharp (Sh) as shipped, through
`traceImageToColoredPaths` with the dialog's `mergeLightBurnTraceSettings(preset, {})`. Potrace pipelines:
- **P-mk:** mkbitmap defaults, then `potrace -s`;
- **P-mk16:** `mkbitmap -f 16`, then potrace;
- **P-plain:** potrace on the greymap at its default `-k 0.5`.

Logo and text scores are against exact vector truth. Arch House scores are against each tracer's own
clean trace (stability), because the repo's references are not registered to the source (see Refuted).
"Logo/text, 8 cond." aggregates clean, jpeg35, lowres3, ramp40, noise12, blur1, paper and photo.

| Metric | KerfDesk | Potrace (mkbitmap+potrace; plain) | Verdict | Refuter |
|---|---|---|---|---|
| IoU vs truth, logo, 8 cond. (mean) | LA 0.958, Sm 0.969, Sh 0.970 | P-mk 0.585, P-mk16 0.899; plain 0.939 | better | CONFIRMED. Own logo, 6 cond.: LA 0.965, Sm 0.972, Sh 0.973; P-mk 0.572, plain 0.945. With mkbitmap's offset removed (auditor's data): P-mk 0.604, P-mk16 0.912 |
| IoU vs truth, text, 8 cond. | LA 0.828, Sm 0.824, Sh 0.843 | P-mk 0.773, P-mk16 0.713; plain 0.749 | better | CONFIRMED against plain only. With the offset removed, P-mk is **0.817**, level with Sm and LA; Sh leads by 0.026. Own text: Sm 0.792 against P-mk 0.793 (offset removed); plain 0.700 |
| Mean edge distance (symmetric), logo | LA 0.325, Sm 0.175, Sh 0.145 px | P-mk 1.699, P-mk16 1.699; plain 0.379 px | better | CONFIRMED for Sm and Sh. Own: Sm 0.190, Sh 0.154, P-mk 1.516 px; LA 0.339 is level with plain's 0.323 |
| Mean edge distance, text | LA 0.261, Sm 0.308, Sh 0.259 px | P-mk 0.874, P-mk16 1.039; plain 0.466 px | better | CONFIRMED against plain and default mkbitmap; P-mk is 0.810 with the offset removed. Own: tuned mkbitmap (`-n -t 0.5`) 0.294 px beats Sm 0.333; LA 0.282 |
| Truth components lost (< 25% covered), logo 50 per image, sum of 8 | LA 71, Sm 65, Sh 20 | P-mk 4, P-mk16 3; plain 43 | **worse** (i-dots: KNOWN Q4-P2-3; pale text: Q5-P3-2) | CONFIRMED. Own logo, 6 cond.: LA 75, Sm 70, Sh 36; P-mk 4, P-mk16 2, plain 63 |
| Components merged, text, sum of 8 | LA 1, Sm 14, Sh 15 | P-mk 9, P-mk16 23; plain 1 | Sm/Sh worse than P-mk (Q5-P2-1) | CONFIRMED. Own: Sm 21, Sh 17, LA 0; P-mk 3, P-mk16 20, plain 1 |
| Real counters lost, text (22 per image) | blur1: Sm 5, Sh 3, LA 0; lowres3: Sm 15, Sh 11, LA 0 | blur1: P-mk 0, plain 0; lowres3: P-mk 1, plain 0 | **worse** (Q5-P2-1) | CONFIRMED. Auditor's cases re-run: identical. Own, 37 holes: blur1 Sm 4, Sh 0, LA 0, P-mk 0, plain 0; lowres3 Sm 25, Sh 25, LA 0, P-mk 6, plain 0 |
| Stroke area error, text blur1 / lowres3 | Sm +40.5% / +75.0%; Sh +32.9% / +69.6%; LA −16.2% / −41.0% | P-mk +29.6% / +37.8%; plain −14.3% / −45.3% | Sm/Sh heavier (Q5-P2-1) | CONFIRMED. Own: Sm +38% / +84%, Sh +32% / +78%, LA −13% / −47%; P-mk +27% / +32%, plain −11% / −51% |
| Added specks, logo, sum of 8 | LA 3, Sm 6, Sh 9 | P-mk 1,648, P-mk16 656; plain 15 | better | CONFIRMED. Own noise12 logo: P-mk 1,175, P-mk16 212; LA, Sm, Sh 0 |
| Segments per image, logo / text | LA 393 / 488, Sm 408 / 514, Sh 402 / 510 | P-mk 1,724 / 901; plain 411 / 509 | tie with plain, better than P-mk | CONFIRMED. Own clean: logo LA 339 against plain 438; text 506 against 562 |
| Straight-edge wobble (9 known edges, middle 70%), RMS / max | LA 0.032 / 0.30, Sm 0.046 / 0.51, Sh 0.030 / 0.45 px | P-mk 0.051 / 0.59; plain 0.035 / 0.20 px | tie (plain's max lower) | PLAUSIBLE (not re-run) |
| Known corners (11 per image × 8) kept sharp / apex gap | LA 66/88, 0.43 px; Sm 65/88, 0.28; Sh 76/88, 0.29 | P-mk 1/88, 0.42; plain 9/88, 1.04 px | better | PLAUSIBLE (not re-run) |
| Dim page (vignette, paper 250 → 120, ink 60): IoU logo / text | Sm 0.983 / 0.897, Sh 0.982 / 0.912 (levelled); LA 0.938 / 0.701 | P-mk 0.563 / 0.813; P-mk16 0.908 / 0.775; plain 0.923 / 0.666 | better (Sm/Sh); LA as ADR-402 says | PLAUSIBLE. Own 40% ramp: Sm and Sh level (logo 0.984), LA 0.953 |
| Impulse noise 1% black + 1% white: specks / edge wobble max | LA and Sm 0 / 1.27 px; Sh 982 (keeps specks by design) | P-mk 983 / 2.26; plain 2 / 1.27 px | better / tie | PLAUSIBLE (not re-run) |
| JPEG q35 logo: wobble RMS / max, specks | LA 0.025 / 0.26 px, 0 | P-mk 0.029 / 0.15, 4; plain 0.018 / 0.11, 0 | tie | PLAUSIBLE. Own jpeg35 logo: LA IoU 0.981, 0 added |
| Grey-paper scan, automatic cut (plateaus ≈ 16 / 190, mid ≈ 103) | Sm 108 (logo), 122 (text) | — | sensible | PLAUSIBLE (not re-run) |
| Grain on a colour logo, specks vs own clean, σ 3 / 6 / 9 / 12 | LA 0 / 0 / 8 / **626**; Sm 0 / 1 / 0 / 1 | P-mk 15 / 61 / 379 / 1,842; plain 6 / 12 / 14 / 23 | LA cliff at σ 12 (Q5-P3-1) | CONFIRMED. Own draw and resize: LA 0 / 2 / 7 / **598**; Sm 0 at every σ |
| Arch House, 7 degradations, IoU vs own clean trace (mean) | LA 0.881, Sm 0.936, Sh 0.937 | P-mk 0.884, P-mk16 0.919; plain 0.856 | better | PLAUSIBLE. mkbitmap's offset cancels in a stability score |
| Arch House vs bbox-registered filled reference (diagnostic; ceiling 0.43) | LA 0.447, Sm 0.390, Sh 0.387 | P-mk 0.365, P-mk16 0.384; plain 0.375 | not a fidelity measure (Refuted) | PLAUSIBLE (not re-run) |
| Photo (astronaut 512²), σ 3 noise: IoU vs own clean trace | **Sm 0.696, Sh 0.728**, LA 0.974 | P-mk 0.897; plain 0.976 | **worse** (Q5-P2-3) | CONFIRMED for the auditor's draw (own rasteriser: Sm 0.697, Sh 0.729, LA 0.975, plain 0.975). The result depends on the draw; see Q5-P2-3 |
| Photo shading tone (coverage vs linear darkness, 8 px blocks) | r 0.980, mean error 0.034; 154,457 segments | P-mk r 0.30, error 0.60; plain r 0.89, error 0.26 | better | PLAUSIBLE (not re-run) |
| Colour layers, flat logo (5 ink colours) clean | 5 / 5 colours; per-colour IoU 0.925–0.995; overlap 0 px²; seam gaps 0.3–0.9 px² | — | meets ADR-461 | CONFIRMED. Own 5-colour scene: 5 / 5; at least 93% of each object lies on its own layer |
| Colour layers, same logo at JPEG q35 / q50 / q60, blur σ 1, noise σ 12 | **4 / 5**: black text on the blue layer (blue IoU 0.76, 11 regions) | — | **fails** (Q5-P2-2) | CONFIRMED, and worse than reported. Own scene also fails at q75 (the IJG default). On a pale logo the black text burns at 41% instead of 100% (Q5-P2-2, now P1) |
| Centerline, known strokes (17 paths), body deviation mean / max | clean 0.098 / 2.35 px; degraded 0.09–0.17 / 1.44–2.37 px | — (no centerline) | meets ADR-405 | CONFIRMED. Own 7-stroke scene (line, ring, sine, T, S, diagonal), 5 conditions: mean 0.06–0.16 px, max 0.21–0.82 px. It has no bend tighter than the half-width, so the 2.35 px maximum was not re-tested |
| Centerline ends, stray ends, gaps | 15 / 15 true ends in every condition; stray 0 (2 at σ 12); 2 px gap bridged; missed 0.06–1.6% of length | — | meets | CONFIRMED. Own: 11 / 11 true ends, 0 stray, coverage 100% in all 5 conditions |
| Speed, 512² (in-process) | 150–900 ms; Photo shading 49 ms | 21–170 ms per process | **slower** (KNOWN Q4-P2-1) | CONFIRMED in direction. Own 400–420 px images: KerfDesk 56–212 ms, Potrace 38–57 ms per process |
| Speed, 1024² Arch House source | LA 1.63 s (preparation 1.11 s), Sm 1.29 s, Centerline 0.44 s; peak RSS 275 / 215 / 98 MB | — | — | PLAUSIBLE (not re-run) |
| Speed, 1254² dragon | LA 3.11 s, 433 MB, 30,027 segments; Centerline 2.06 s, 291 MB, 11,497 segments, 2,593 subpaths | — | Centerline subpaths equal ADR-405 | PLAUSIBLE (not re-run) |
| Twin: CLI SVG vs core trace (degraded PNGs) | max gap 7 × 10⁻⁶ px; IoU 1.000000 / 0.999998 | — | exact | PLAUSIBLE (not re-run) |

**Win / tie / lose per input × degradation.** Each cell compares one KerfDesk preset with one Potrace
pipeline on that image. A case is a win when KerfDesk wins more metrics than it loses, and a loss in
the reverse case.

Metrics for logo and text:
- IoU;
- mean edge distance;
- Hausdorff;
- lost + merged components;
- added components;
- hole errors (lost + added);
- segments;
- logo only: wobble RMS and apex gap.

Arch House rows use stability against each tracer's own clean trace: IoU, mean edge distance, lost +
merged, added and hole errors.

The rows:
- **A:** LA vs P-plain.
- **B:** Sm vs P-mk (the matched "scan" pipelines).
- **C:** the best KerfDesk preset against the best Potrace pipeline, each chosen per case by IoU.

| Input | Row | clean | jpeg35 | lowres3 | ramp40 | noise12 | blur1 | paper | photo | dim | salt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| logo | A | W | W | T | W | T | W | W | W | W | W |
| logo | B | W | W | W | W | W | W | W | W | W | W |
| logo | C | W | W | W | W | W | W | W | W | W | W |
| text | A | T | L | W | T | T | W | T | W | T | W |
| text | B | W | W | **L** | W | W | **L** | W | W | W | W |
| text | C | W | L | L | W | T | W | W | W | W | W |
| arch | A | — | W | W | W | **L** | W | W | W | — | — |
| arch | B | — | W | W | W | W | T | W | W | — | — |
| arch | C | — | W | L | W | W | W | L | W | — | — |

**Totals (W / T / L of 27):**
- A, LA vs plain Potrace: 18 / 7 / 2;
- **B, Smooth vs mkbitmap + Potrace: 24 / 1 / 2;**
- C, best vs best: 22 / 1 / 4.

**Refuter re-run (W / T / L).**
- **The auditor's 27 cases with mkbitmap's (−0.25, +0.25) px offset removed.** This used the auditor's
  own `scoreAgainst`, `featureScore` and tally logic. Only the P-mk and P-mk16 rows were re-scored; the
  Arch House stability rows are unaffected.
  - A: 18 / 7 / 2 (unchanged);
  - **B: 22 / 3 / 2.** Text "paper" and "dim" go W → T;
  - C: 23 / 1 / 3. Text "jpeg35" goes L → W, because the best Potrace pipeline there becomes P-mk.
  - The as-measured tally was re-run too and reproduces 18 / 7 / 2, 24 / 1 / 2 and 22 / 1 / 4 exactly.
- **12 independent cases** (`zz-q5r/`). Own scenes:
  - text: Times New Roman 38 px and Arial 24 px;
  - logo: shapes, Arial Bold 48 px and Arial 19 px;
  - both rendered by librsvg, ink 24 on paper 242;
  - degradations: clean, blur σ 1, centred 3× low-res, JPEG q35, σ 12 grain, 40% ramp.

  The truth is the same SVG rendered at 8 × 8 samples per pixel. Traces were rasterised by librsvg at
  8 × 8. Metrics and tie bands are own code, with the same bands as above. Results:
  - A, LA vs plain: **10 / 0 / 2**;
  - B, Sm vs P-mk defaults: **10 / 0 / 2**, the same with the offset removed;
  - Sm vs tuned mkbitmap `-n -t 0.5`, offset removed: **8 / 3 / 1**;
  - Sm vs `-f 16`: 12 / 0 / 0;
  - C: 11 / 0 / 1 (10 / 1 / 1 when tuned mkbitmap is a candidate).

  As in the auditor's tally, B loses on blurred and low-res text (Q5-P2-1).

**Per metric (W / T / L).**

| Metric | A | B | C |
|---|---|---|---|
| IoU | 24/2/1 | 25/0/2 | 26/0/1 |
| Mean edge distance | 21/4/2 | 21/2/4 | 21/2/4 |
| Hausdorff | **3/6/11** | 12/1/7 | 8/1/11 |
| Lost + merged | **8/4/15** | **7/2/18** | **9/7/11** |
| Added | 10/14/3 | 15/11/1 | 8/15/4 |
| Holes | 3/19/5 | 15/7/5 | **2/15/10** |
| Segments | 5/12/3 | 20/0/0 | 13/4/3 |
| Wobble | 6/2/2 | 5/4/1 | 7/2/1 |
| Apex gap | 10/0/0 | 8/0/2 | 10/0/0 |

**Refuter: per metric after the offset correction.**
- **B:** mean edge distance 18/5/4 and Hausdorff 12/0/8. The other rows are unchanged.
- **C:** Hausdorff 9/1/10, lost + merged 9/8/10, holes 2/16/9 and segments 14/3/3.
- **Smooth vs tuned mkbitmap (refuter's 12 cases):**
  - IoU 9/2/1, edge 5/5/2, Hausdorff 2/2/8;
  - lost + merged 1/5/6, added 1/11/0, holes 0/10/2;
  - segments 11/1/0.

### Measurement method

All scripts are in the scratchpad folder `zz-q5/`:
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-q5`.
They import nothing from Potrace. From KerfDesk they import only the bundled public entries.

**Engine.**
- `build-engine.mjs` bundles these from this worktree with the main checkout's esbuild 0.28.1, as
  `scripts/trace-bench.mjs` does:
  - `traceImageToColoredPaths` and `TRACE_PRESETS`;
  - `mergeLightBurnTraceSettings` (the dialog's option merge);
  - `otsuSeparation`, `flattenUnevenBackground`, `levelForAutomaticThreshold`;
  - the perceptual PNG helpers.
- `trace-lib5.mjs` calls the entry with a runner that sends `true` to every step. It keeps the
  `TraceReport` yields (the automatic cut, "lighting levelled", "local detail added").
- `build-debug.mjs` builds a second bundle with an in-memory probe in `colour-palette.ts`, through
  esbuild `onLoad`; the file on disk is unchanged. It logs each automatic palette centre and its
  flat-area share (Q5-P2-2).

**Inputs** (`scenes5.mjs`, `make-cases.mjs`, `make-probes.mjs`).
- **logo, 480 × 264.** Ink luma 20 on paper 245. Rendered at 8 × 8 samples per pixel (nonzero fill),
  so edges are anti-aliased. It holds:
  - a 70 px square turned 17°;
  - a 40° isosceles triangle, 92 px tall, turned 7°;
  - a ring (r 45 / 28);
  - a 100 × 10 bar at 80°;
  - "Kerf Desk 2026" in Roboto at 50 px;
  - "fine print: laser trace, i.j 1.5 mm" in Roboto at 20 px.

  That gives 50 ink components and 12 holes, 9 known straight edges and 11 known corners.
- **text, 480 × 96.** "Arch House, Langebaan" in Tinos at 40 px and "quality trace 0123456789 &?" in
  Roboto at 26 px. 45 components and 23 holes. One truth hole of 0.1 px² is lost by every tracer and
  is excluded from "real counters" (22).
- **arch, 512 × 512.** `arch-house-langebaan-source.png`, alpha over white, resized 1024 → 512 by
  sharp 0.35.5 with the cubic kernel.
- **astro.** `astronaut.png`, 512 × 512 as is.
- **Degradations**, applied per RGB channel to the clean image:
  - **jpeg35:** sharp JPEG quality 35, 4:2:0, decoded by sharp;
  - **lowres3:** 3 × 3 box average, then bilinear ×3 on pixel centres;
  - **ramp40:** multiply by 1 − 0.4·x/(W−1);
  - **noise12:** add N(0, 12), the same draw on R, G and B (mulberry32 seed 7, Box–Muller);
  - **blur1:** separable Gaussian, σ 1.0 px (radius 3);
  - **paper:** multiply by P/255, where P = 200 + 12·(six low-frequency sinusoids, normalised) +
    N(0, 4);
  - **photo:** ×225/255 tint, then a radial vignette 1 − 0.4(r/R)², then N(0, 6), then JPEG quality 60.
- **Probes** (logo and text):
  - **dim:** ink 60 on paper 250, times a vignette 1 − 0.52(r/R)², so the paper reaches 120 in the
    corners;
  - **salt:** 1% of pixels set to 0 and 1% set to 255 (seed 11).
- **Sweeps:**
  - grain σ 3, 6, 9, 12 on arch (`noise-sweep.mjs`);
  - JPEG quality 50, 60, 75, 90 and grain σ 3, 6 on the colour logo (`colour-probe.mjs`) and on the
    astronaut (`q-flatten.mjs`).
- **Centerline scene** (`centerline5.mjs`, 480 × 240), anti-aliased the same way:
  - a 4 px line;
  - a 4 px ring, r 40;
  - a 3 px sine;
  - a T (5 px) and an X (4 px);
  - a hand-drawn S stroke, a union of discs tapering in half-width 1 → 3.5 → 1.5 px;
  - a 3 px stroke with a 2 px gap;
  - dots of r 1.5, 2.5 and 4.

  Truth: the pen paths. 15 free ends, 2 junctions.
- **Colour scene** (`colour5.mjs`, 400 × 240). Painter's order with 8 × 8 anti-aliasing:
  - a yellow band;
  - a red disc;
  - a blue square turned 20°;
  - a green triangle;
  - "Colour 2026" in black (25, 25, 25), Roboto at 44 px;
  - on paper (250, 250, 250).

**Potrace** (`io5.mjs`), on a P6 PPM of the same pixels:
- **P-plain:** `potrace -s -u 100 in.ppm`. That is defaults `-t 2 -a 1 -O 0.2 -z minority -k 0.5`;
  `-u 100` only refines output quantisation.
- **P-mk:** `mkbitmap -o t.pbm in.ppm` (defaults `-f 4 -s 2 -3 -t 0.45`), then potrace on `t.pbm`.
  Coordinates are ×0.5 page to page.
- **P-mk16:** `mkbitmap -f 16 ...`, then the same.

Checks:
- A pixel-aligned square traces exactly through P-plain: IoU 1.0000.
- Through mkbitmap's 2× cubic interpolation the same square comes out 0.2–0.6 px off its true edges.
  That is part of the documented pipeline and is left in.
- **Refuter: most of that is a fixed translation.**
  - It was measured through librsvg rasterisation of Potrace's own SVG, at the ×0.5 page scale.
  - On a pixel-aligned square and an anti-aliased r 20 disc, the best fit is a translation of
    (+0.25, −0.25) source px for every mkbitmap ×2 pipeline. Plain Potrace needs none (square IoU 1.0000).
  - Removing it takes P-mk16's disc edge distance from 0.230 to 0.062 px (IoU 0.994).
    KerfDesk's is 0.046–0.053.
  - A constant offset from the scaling convention is not shape fidelity. The corrected tallies are
    under Win / tie / lose.

**Metrics** (`geom5.mjs`, `score5.mjs`).
- **IoU.** Traced outlines are rendered even-odd at 4 × 4 samples per pixel against the truth
  rendered the same way. For arch, the clean trace at 2 × 2 is the truth.
- **Edge distance.**
  - Traced curves are sampled every 0.1 px, and truth rings every 0.1 px.
  - Mean edge distance is the average of the two directed means, each distance capped at 64 px.
  - Hausdorff is the larger directed maximum, also capped at 64.
- **Topology** is computed on the sample grid, with 8-connected ink and 4-connected paper.
  - A truth component is lost when under 25% of it is covered.
  - A traced component is added when under 50% of it lies in truth ink.
  - Merged means more than one truth component sits over 50% inside one traced component.
  - A truth hole is lost when under 50% of it stays paper.
  - An added hole is one that is under 50% truth paper.
- **Segments.** Cubics, plus lines with consecutive collinear lines (< 0.01°) merged.
- **Wobble.** Traced samples within 2 px of a known edge, over its middle 70%. Total-least-squares
  line fit; RMS and maximum residual.
- **Corners.**
  - The apex gap is the distance from the true corner to the traced curve.
  - A corner is kept sharp when a segment joint within 1.5 px turns ≥ max(10°, half the true turn).
- **Tie bands.**
  - IoU ±0.005;
  - edge distance ±max(0.02 px, 10%);
  - Hausdorff ±max(0.1 px, 10%);
  - counts: equal;
  - segments ±max(1, 10%);
  - wobble ±0.01 px;
  - apex ±0.1 px.

  Scripts: `tally5.mjs` (W / T / L) and `summary5.mjs` (aggregates).
- **Centerline.**
  - Body deviation counts traced samples every 0.25 px. It excludes samples within 6 px of a free end,
    8 px of a junction or 6 px of a dot.
  - Coverage counts truth samples within 1 px of the trace, excluding 3 px at free ends.
  - Each open end is classed as at a true end (≤ 4 px), at a junction (≤ 8 px) or stray.
- **Tone** (`tone5.mjs`):
  - coverage of the even-odd fill at 2 × 2 samples;
  - against 1 − Y_linear (sRGB decode, Rec. 709 weights);
  - both averaged over 8 × 8 px blocks; Pearson r and mean |difference|.
- **Speed** (`speed5.mjs`): one trace per process.
  - Phase times come from the public progress callback.
  - "Longest slice" is the longest gap between generator steps under a cooperative runner.
  - Peak RSS is `process.resourceUsage().maxRSS`.
  - Potrace is timed with `spawnSync`, including process start.

**Rendered evidence** in `zz-q5/out/`:
- `ov-*.png`: red KerfDesk, blue Potrace, over the input;
- `fill-astro-smooth.png`: Smooth clean, Smooth at σ 3, plain Potrace at σ 3;
- `ov-cl-*.png`: Centerline.

**Refuter scripts** are in scratchpad `zz-q5r/`:
- `build.mjs`: the refuter's own bundle;
- `lib.mjs`, `metrics.mjs`, `run.mjs` and `tally.mjs`: the scenes, librsvg rasteriser, metrics and W / T / L;
- `aud-shift.mjs`, `aud-retally.mjs` and `aud-kd.mjs`: the auditor's cases re-scored;
- `colour.mjs` and `colour-pale.mjs`: Colour layers;
- `astro*.mjs` and `build-dbg.mjs`: the ADR-402 gate;
- `centerline.mjs`, `arch-noise.mjs` and `slices.mjs`: Centerline, Q5-P3-1 and Q5-P3-3.

The refuter created no repo temp files.

**Repo temp files:** none were created; nothing to delete. Every repro ran from the scratchpad
against the worktree source through the esbuild bundle. The CLI runs were:
- `node scripts/trace-cli.mjs --dpi 254 --precision 0.000001 -p Smooth -o <svg> <zz-q5/cases/text-blur1.png>`;
- the same with `-p "Line Art"` on `arch-jpeg35.png`;
- each compared by `clitwin5.mjs`.

**Rebuild:**
1. `node build-engine.mjs`
2. `node make-cases.mjs`
3. `node make-probes.mjs`
4. `node run5.mjs logo all`, then `node run5.mjs text all`, `node run5.mjs logo dim,salt` and
   `node run5.mjs text dim,salt`
5. `node run-stab.mjs arch`
6. `node tally5.mjs`

Then run `centerline5.mjs`, `colour5.mjs`, `colour-probe.mjs`, `node build-debug.mjs && node q-palette.mjs col-clean col-q60 col-jpeg35 col-noise12 col-blur1`, `q-flatten.mjs`, `q-stab-astro.mjs`, `q-holes.mjs`, `q-cutsweep.mjs`, `noise-sweep.mjs`, `q-faint.mjs`, `tone5.mjs <case> <tracer>` and `speed5.mjs <asset> <preset> [crop]`.

## Findings

### Q5-P2-1 — On slightly blurred or low-resolution small text, Smooth's and Sharp's automatic cut sits far toward the paper: strokes come out 33–75% too heavy and 3–16 letter counters close, where Potrace keeps them

- **Where:**
  - `src/core/trace/preprocess.ts:236-276` (`otsuSeparation`): the global Otsu cut.
  - `src/core/trace/trace-image.ts:217-222, 294-300`: that cut thresholds the working raster (the
    2× supersample on Smooth's route).
  - Presets: `src/core/trace/trace-presets.ts:181` (Smooth) and `:210` (Sharp) set `useOtsuThreshold`.
  - The dialog describes Smooth as "For scans and noisy artwork. Sets its threshold from the image"
    (`src/ui/trace/dialog-parts.tsx:35-36`).
- **Anchor:**
  - **Ground truth.** The glyphs' own outlines (open counters). Potrace 1.16 on the same pixels, both
    plain (`-k 0.5`) and after mkbitmap.
  - **Contract (partial).** ADR-533 Context says the automatic cut "splits the histogram where the two
    class variances balance", away from the mid-level. Its fix moves vertices only. Decision 3 reads
    "**Thin features keep the cut.**", and its Limits section leaves wide blurs open. So the cut alone
    decides the topology of narrow counters.
- **Scenario:** Sparse anti-aliased text (Tinos 40 px and Roboto 26 px, ink 20 on paper 245) is
  traced with Smooth, the preset the dialog offers for scans.

  | Input | Smooth cut (reported) | Smooth area / counters lost | Sharp | Line Art | P-plain | P-mk |
  |---|---|---|---|---|---|---|
  | clean | 155 | +8.7% / 0 of 22 | +5.1% / 0 | −2.5% / 0 | −4.5% / 0 | +14.7% / 0 |
  | blur σ 1 | 180 | **+40.5% / 5 of 22** | +32.9% / 3 | −16.2% / 0 | −14.3% / 0 | +29.6% / 0 |
  | low-res ×3 | 191 | **+75.0% / 15 of 22, 13 letters merged** | +69.6% / 11, 12 | −41.0% / 0 | −45.3% / 0 | +37.8% / 1 |

  - The 50% edge level between the plateaus is 132.
  - At blur σ 1 the five closed counters ('a', 'e' and digit bowls, 18–25 px²) have their lightest
    pixels at luma 222–235 and their darkest at 132–177. All are inside the 180 cut, so they become
    ink.
  - The dialog shows "Band in use: Cutoff 0, Threshold 179", but nothing says that counters closed.
  - Larger text is unaffected: the logo's 50 px counters all survive.
- **Evidence:** REPRO.
  - `node q-holes.mjs text-blur1`:
    - Smooth: cut 180, area +40.5%; lost holes at (46, 80), (117, 80), (145, 74), (223, 75) and
      (317, 70).
    - With `fillPinholeCracks: false` the same five close, so the hole-fill policy is not the cause.
    - With a manual Threshold of 132, none close (area −11.0%).
  - `node q-cutsweep.mjs` (Smooth with a manual cut):
    - blur σ 1: cut 144, the mid-level between the 0.5th and 99.5th luma percentiles, keeps every
      counter at +2.7% area; cut 160 keeps them at +21.2%; cut 170 closes 2.
    - low-res: cut 152 (mid-level) loses 1 counter with 2 merges at +1.9% area, against Otsu's 15 and
      13.
  - `node q-intermeans.mjs`: the Ridler–Calvard intermeans cut lands within 1 level of Otsu on all
    four inputs. Another global class-balance method is therefore not the fix.
- **Severity: P2, not P1.** Under the 2026-10-28 trace clarification (AREAS.md), P1 needs a shape or
  hole "the app promises to keep". No ADR, tooltip or preset text promises Smooth keeps counters. The
  only such line is a code comment (`trace-option-types.ts:120`, "holes inside letters (O, B, etc.)
  survive"), which is about despeckle. It is P2 because the trace is visibly worse than Potrace with
  mkbitmap on the same scan.
- **Fix direction:**
  - Cut at the mid-level between the ink and paper plateaus rather than at the class-variance optimum.
    That is the 50%-coverage level of an anti-aliased or symmetrically blurred step, the principle
    ADR-533 already uses for crossings.
  - Estimate the plateaus robustly, for example from luma percentiles or histogram modes. Measured
    above: blur σ 1 keeps all counters, low-res loses 1.
  - Or use a local adaptive cut for sparse text (Sauvola & Pietikäinen, "Adaptive document image
    binarization", Pattern Recognition 33, 2000).
  - Add a regression test on blurred small text that asserts counter count and stroke area.
- **Refuter: CONFIRMED. P2 kept.**
  - **What would make it false:** an artefact of the auditor's render or metric, or the hole fill
    rather than the cut, or a promise that would make it P1.
  - **Repro 1.** The auditor's inputs, through the refuter's own bundle and the worker's runner.
    Everything is identical:
    - Smooth cuts at 155 / 180 / 191, with area +8.7% / +40.5% / +75.0%;
    - holes lost: 6 / 23 and 16 / 23, that is 5 and 15 real counters;
    - Sharp loses 4 / 23 and 12 / 23.
  - **Repro 2.** Own render: librsvg, Times New Roman 38 px and Arial 24 px, 37 truth holes, own metric.
    - Blur σ 1:
      - Smooth cuts at 176: area +38.1%, 4 counters closed;
      - Sharp cuts at 172: area +32.1%, 0 closed;
      - Line Art, plain Potrace and mkbitmap: 0 closed.
    - Centred 3× low-res:
      - Smooth and Sharp cut at 191 and 190: area +84% and +78%, 25 counters closed, 16–20 letters
        merged;
      - mkbitmap: 6 closed, 3 merges;
      - plain Potrace and Line Art: 0 closed, but they drop 5–13 pale strokes.
  - **Twin.** The same Smooth trace with `fillPinholeCracks: false` closes the same counters. A manual
    cut of 133 or 150 closes none at blur σ 1 (area −7.6% / +12.0%).
  - **Promise check.** Nothing promises that the automatic cut keeps counters or letter shapes. Checked:
    - the ADRs;
    - the preset descriptions (`dialog-parts.tsx:31-46`);
    - the detection notes (`TraceDetectionControls.tsx:84-119`);
    - the trace tooltips.

    The pinhole tooltip (`TraceCheckboxRow.tsx:70`, "Tick Auto to fill only faint threshold cracks")
    is about the fill step, which is not the cause. So the 2026-10-28 clarification does not apply,
    and P2 stands: a visible defect against Potrace on the same scan.
  - **Novelty.** Q4-P1-1 is the opposite failure of the same cut: 1 on a two-value histogram. Its
    tie-break fix does not touch this. The one open PR does not touch trace.

### Q5-P2-2 (P1 after refuter) — Colour layers' automatic palette drops the black text of a flat-colour logo at JPEG quality ≤ 60, a σ 1 blur or σ 12 grain, and traces it on the blue layer

- **Where:**
  - `src/core/trace/colour-palette.ts:153-181` (`keepFlatAreaColours`): a colour under
    `AUTO_MIN_SHARE` (`:25`, 0.2%) of the flat area is dropped.
  - `:20` (`NON_FLAT_WEIGHT` 0.1): a pixel whose 4-neighbours differ by more than `FLAT_DE` counts a
    tenth.
  - `src/core/trace/colour-quantize.ts:64-66`: `FLAT_DE` 0.05, with the premise "JPEG noise and paper
    texture stay below it".
  - The dialog says Colour layers "Splits colour artwork into a few flat colours, one layer and
    operation each" (`src/ui/trace/dialog-parts.tsx:45-46`).
- **Anchor:**
  - **Ground truth.** The logo's five ink colours.
  - **Contract.** ADR-461 Decision 2: Auto "keeps only colours holding at least 0.2 % of the flat area"
    and treats non-flat pixels as "an anti-aliasing or texture mixture, not a colour". That premise
    fails for thin dark artwork under JPEG. Ringing makes most of the text's pixels non-flat, so a
    genuine colour falls under the floor.
  - **Twin.** The same image with Colours set to 6 finds black every time.
- **Scenario:** A flat-colour logo saved as an ordinary web JPEG is traced with Colour layers on Auto.
  - The logo is a red disc, a blue square, a green triangle, a yellow band and the black words
    "Colour 2026" in 44 px Roboto, 2% of the image.
  - Clean, and at JPEG quality 75 or 90, the trace finds 5 colours.
  - At quality 35, 50 or 60, after a σ 1 blur, or with σ 12 grain, it finds 4. The black text joins
    the blue square's layer: blue IoU 0.76, 11 regions where the truth has 1.
  - The text then burns with the blue layer's operation and its starting power.
  - The swatch row shows one colour fewer, but nothing says a colour was dropped.
  - Shared edges stay exact in every case (overlap 0 px², seam gaps under 1 px²).
- **Evidence:** REPRO.
  - `node colour5.mjs`: clean layers `#f0be28 #28a046 #d22828 #1e50c8 #1c1c1c`; jpeg35, noise12 and
    blur1 give 4 layers, black IoU 0.000–0.028.
  - `node colour-probe.mjs`: q50 and q60 give 4 layers; q75 and q90 give 5. Colours 6 recovers black
    on jpeg35, noise12 and blur1.
  - `node q-palette.mjs` (debug bundle) shows the engine's own flat share of the black centre:
    - clean 0.633%;
    - q60 0.188%;
    - q35 0.115%;
    - noise12 0.136%;
    - blur1 0.005%.

    Each is under 0.2%, so it is removed at `colour-palette.ts:165`. The rule runs as written; its
    premise does not hold.
- **Severity (auditor): P2. The refuter raised it to P1; see below.**
  - The geometry is kept but put on the wrong layer, and the preview shows it.
  - The ADR's 0.2% floor is applied as written, so this is not a broken promise under the P1
    clarification.
- **Fix direction:**
  - Judge flatness against the image's own measured noise rather than a fixed 0.05 OKLab step.
    `auto-sketch-trace.ts:59, 74` already scales its colour test by the channel noise sigma.
  - Or keep a low-share colour when it is far (in ΔE) from every kept colour and forms spatially
    coherent regions. That is the evidence ADR-461 uses for paper, applied to ink.
  - Add a regression test with thin dark text in a real JPEG round-trip.
- **Refuter: CONFIRMED. Severity raised P2 → P1.**
  - **What would make it false:**
    - the text keeps its own layer under realistic JPEG;
    - or it lands on a layer that burns at the same power;
    - or the dialog warns.
  - **Repro A.** Own 5-colour scene:
    - a band, a disc, a turned square, a triangle, and "Laser 2048 rig" in Arial 40 px #1a1a1a
      (2.3% of the image);
    - sharp JPEG at 4:2:0.

    Clean and q90 give 5 layers. q75, q60, q50, q35, blur σ 1 and σ 12 grain give 4, with 88–96% of
    the text on the blue layer.
    - The text keeps 100% power, because blue becomes the darkest colour.
    - Every remaining layer's starting power rises 1.2–1.45×. At q60: blue 69.1% → 100%, red
      57.1% → 80.8%, green 49.1% → 70.4%, yellow 25% → 31%.
  - **Repro B.** Own pale logo: a pale-yellow disc #f5d76e, a light-blue square #8ec5ff and the same
    black text.
    - Clean and q90: the text has its own layer at 100%.
    - q75, q60, q50, q35, blur σ 1 and σ 12 give 2 layers. 98.6–99.9% of the text is on the
      light-blue layer, which starts at **41.4–44.9%** (light blue alone was 25.4%).
    - So the black text burns at under half power, and the light-blue area 1.6× harder.
  - **Twin.** With Colours set to 4, the same pale q60, blur and σ 12 images keep the text on its own
    layer at 100%.
  - **Promise and warning.**
    - The Colours hint says "Auto picks the colours the artwork really uses"
      (`ColourLayerTraceSettingsControls.tsx:47`).
    - The swatch note says "Darker colours start at more power" (`:224`).
    - ADR-461 Decision 6 sets each colour's power from its own darkness.
    - No notice reports a dropped colour. The swatch row and the preview are the trace output itself,
      which the 2026-10-28 clarification says is not a warning.
  - **Severity: P1.**
    - It meets the AREAS quality P1 rule: the burn differs in tone from what the app promises, with no
      warning.
    - It also fits the trace clarification: a promised element is merged, with no warning.
    - The auditor's point that the ADR's 0.2% floor runs as written does not lower it. The
      operator-facing promise is the hint, as with Q4-P2-3.
    - Reachable today: Colour layers on Auto (the preset default), with an ordinary JPEG at q75 (the
      IJG default) in the refuter's scenes.
  - **Shared edges stay exact:** overlap ≤ 0.31 px², gaps ≤ 0.13 px². The fault is in the palette, not
    the partition.

### Q5-P2-3 — Noise of σ 3, invisible to the eye, sends Smooth and Sharp onto the uneven-lighting route on a photograph: the trace changes to IoU 0.70 against the clean photo's, and the dialog says the lighting was evened out

- **Where:**
  - `src/core/trace/background-flatten.ts:143-154` (`otsuBinarization`) and `:163-176`
    (`flattenAgainstPaper`, with its early declines `isUniformPaper` `:179-190` and `paperRange`
    `:367-380`);
  - called from `src/core/trace/trace-image.ts:217-220`;
  - the dialog note `src/ui/trace/TraceDetectionControls.tsx:90-91`: "Uneven lighting was evened out
    before the cut".
- **Anchor:**
  - **Contract.** ADR-402 Decision 2 flattens only when the paper model is credible ("light-on-dark art
    and busy pictures are not"). Its Consequences say the gate, on the astronaut photo, "declined on
    every call".
  - **Twin.** Line Art and plain Potrace on the same noisy photo stay at IoU 0.974 and 0.976 against
    their clean traces.
- **Scenario:** The repository's astronaut photo (512²) is traced with Smooth, as a phone picture or
  scan would be.
  - **Clean.** The gate declines and the cut is 101: 121 subpaths.
  - **Grain of σ 3** (the same draw on R, G and B):
    - `flattenUnevenBackground` returns a flattened image and Smooth reports `lightingLevelled`;
    - the helmet's solid black turns into speckled texture with a hole;
    - the trace has 829 subpaths, IoU 0.696 against the clean trace.
  - **Sharp** at σ 3: 364 → 2,190 subpaths, IoU 0.728.
  - **JPEG q35:** Smooth also levels, IoU 0.719 (Sharp declines there: 0.967).
  - JPEG 50, 75 and 90 decline.
  - The dialog then tells the operator the lighting was uneven, which is false for this photo.
  - On the logo, text and Arch House pages the gate behaves as the ADR says; see Verified clean.
- **Evidence:** REPRO.
  - `node q-flatten.mjs`: the flatten candidate is null for clean and JPEG 35–90, non-null for σ 3, 6
    and 12. Otsu barely moves (101 → 102–103), so the route change, not the cut, makes the difference.
  - `node q-stab-astro.mjs`:

    | Preset | σ 3 | σ 6 |
    |---|---|---|
    | Smooth | IoU 0.696, +19 specks | 0.690 |
    | Sharp | 0.728 | 0.737 |
    | Line Art | 0.974 | 0.957 |
    | P-plain | 0.976 | 0.960 |
    | P-mk | 0.897 | 0.822 |

  - Picture: `zz-q5/out/fill-astro-smooth.png`.
  - The mechanism inside the gate was not isolated. On the clean photo the gate exits at one of its
    declines; σ 3 grain moves it past them.
- **Severity: P2.**
  - The route is announced, though wrongly.
  - The input is a photograph, outside Smooth's "scans and noisy artwork".
  - It is a preprocessing step that does not do what it says.
- **Fix direction:**
  - Make the gate's decision robust to sensor noise. Decide on a lightly denoised or downsampled luma,
    or require the same verdict at two scales.
  - Add a busy-picture test that does not depend on pixel-level variance, such as the share of cells
    whose local spread exceeds the ink/paper contrast.
  - Test the astronaut with σ 3–6 grain and a JPEG round-trip in `uneven-lighting-trace.test.ts`.
  - Published background-estimation binarisers bound their background model by a stroke-width
    estimate rather than raw cell variance (Lu, Su and Tan, "Document image binarization using
    background estimation and stroke edges", IJDAR 13, 2010).
- **Refuter: CONFIRMED. The mechanism is isolated and the numbers depend on the noise draw. P2 kept.**
  - **The gate.** It was isolated with an in-memory probe (`zz-q5r/build-dbg.mjs`; the file on disk is
    unchanged).
    - On the clean astronaut, `flattenAgainstPaper` declines in `paperRange`. Only 1,009–1,040 of 2,209
      cells (45.7–47.1%) are paper, against `MIN_PAPER_CELL_FRACTION` 0.5 (`background-flatten.ts:69,
      378`). The robust paper noise is 6.5 luma, under the limit of 8.
    - Mono σ 3 grain lifts the paper cells to 1,129–1,169 (51–53%).
    - The "paper" then runs from luma 1–2 to 221, so the non-uniformity test passes (`:175`).
    - The class checks pass too: residual 0.71–0.76 (limit 0.9), contrast 146–157 (minimum 32).
  - **The auditor's draw.** Seed 7 reproduces exactly with the refuter's own noise code and rasteriser:
    Smooth 829 subpaths, IoU 0.697; Sharp 0.729; Line Art 0.975; plain Potrace 0.975.
  - **It depends on the draw.**
    - Mono σ 3 with another seed flips Sharp (IoU 0.781), but not Smooth's reported route.
    - Mono σ 1.5 flips Sharp (0.791).
    - Mono σ 2 does not flip. Neither does independent per-channel σ 3 (luma σ ≈ 2).
    - Mono σ 6 flips both.

    So "σ 3 flips it" should read "grain of σ 1.5–6 can flip it, depending on the draw".
  - **Refuter addition: the same gate, and a report that does not match the route.**
    - Smooth calls the gate twice: on the 1× detail-profile pass (`contour-detail-detector.ts:51`) and
      on the 2× trace pass. Only the trace pass reports (`contour-trace.ts:184`).
    - With seed 1234 the 1× pass levels and the 2× pass declines. The output changes (121 → 777
      subpaths, IoU 0.928), while the dialog shows "Band in use: Cutoff 0, Threshold 101, set from this
      image".
  - **Severity.** The ADR-402 quotes were checked at `93334429e` (Decision 2; Consequences "declined
    on every call"). Nothing promises to keep the photo's shapes, and the fault is a wrong route
    message, not tone or position. P2 stands.

### Q5-P3-1 — Line Art's automatic colour detail cuts at a fixed 8 luma below the local mean, so σ 12 grain on a colour logo becomes 626 specks; Smooth adds 1

- **Where:**
  - `src/core/trace/trace-image.ts:333, 384` (`SKETCH_CONTRAST_BIAS = 8`, `localMean − bias`);
  - `src/core/trace/automatic-detail-mask.ts:56-62` (`detail = l < localField.thresholdAt(x, y)`);
  - promoted for colour sources by `src/core/trace/auto-sketch-trace.ts:10-20`.
- **Anchor:**
  - **Twin.** The colour-promotion test beside it is noise-scaled (`auto-sketch-trace.ts:59, 74`); the
    cut it enables is not.
  - **Contract.** The Auto small-mark tooltip promises to "remove scan dust" (`TraceCheckboxRow.tsx:65`).
- **Scenario:** Arch House at 512 px with grey grain of σ 3, 6, 9 and 12 adds 0, 0, 8 and **626**
  specks against Line Art's clean trace (IoU 0.975 → 0.850).
  - Smooth: 0–1 specks.
  - Plain Potrace: 6–23.
  - mkbitmap: 15–1,842.

  So Line Art beats mkbitmap at every σ, but has a cliff. Grey-only art never takes this route
  (logo noise12: 0 specks).
- **Evidence:** REPRO (`node noise-sweep.mjs`; overlay `out/ov-arch-noise-la.png`).
- **Fix direction:** Scale the local-contrast bias with the measured noise, max(8, k·σ̂), using the
  σ̂ the promotion test already computes.
- **Refuter: CONFIRMED.**
  - Own setup: Arch House resized by sharp lanczos3, own grain draw (seed 31337), own component count.
  - Line Art adds 0 / 2 / 7 / **598** specks at σ 3 / 6 / 9 / 12 (IoU 0.968 → 0.844). Smooth adds 0 at
    every σ.
  - The same cliff as reported (626). P3 kept.

### Q5-P3-2 — Pale small text on a low-resolution or blurred grey logo: every preset loses 9–26 of 50 marks, and Faint lines recovers 2–3, where mkbitmap's highpass keeps all but 3–4

- **Where:**
  - Line Art's fixed band, `src/core/trace/trace-presets.ts:41-43`;
  - grey sources get no local detail (`auto-sketch-trace.ts:10-20`);
  - Faint lines only adds coherent thin strokes, `src/core/trace/faint-line-mask.ts:5-20`.
- **Anchor:** **Ground truth.** The logo's 20 px line and mkbitmap + Potrace on the same pixels.
- **Scenario:** On the logo at low-res ×3, the small line's strokes reach luma 66 at their darkest but
  are mostly lighter than 128.

  | Preset or pipeline | lowres3 lost | blur1 lost | Other |
  |---|---|---|---|
  | Line Art | 26 | 10 | dots plus pale letters |
  | Faint lines | 24 | 7 | |
  | Sketch | 5 | 2 | IoU 0.654 / 0.683, 11–14 merges |
  | Smooth | 14 | 9 | |
  | P-mk | 4 | 0 | hollows the solids (IoU 0.58 / 0.61) |
  | P-mk16 | 3 | 0 | merges 19–20 |

  No pipeline wins every metric. The W / T / L rows score these cases T or W for KerfDesk. It is
  recorded as the largest remaining fidelity gap on grey art.
- **Evidence:** REPRO (`node q-faint.mjs`).
- **Fix direction:** For grey sources, offer or auto-select a local normalisation before the band.
  Divide by a large-radius local mean, the flat-field idea ADR-402 already uses, so pale strokes
  reach the band without hollowing solids. Mkbitmap's documented highpass is the subtractive form.
- **Refuter: CONFIRMED.** Own logo, 51 marks, line in Arial 19 px. Faint lines and Sketch were not
  re-run.

  | Pipeline | Centred 3× low-res lost | Blur σ 1 lost | Other |
  |---|---|---|---|
  | Line Art | 34 | 13 | |
  | Smooth | 23 | 12 | |
  | Sharp | 19 | 11 | |
  | Plain Potrace | 34 | 14 | |
  | mkbitmap defaults | 5 | 0 | 9 merges, logo IoU 0.56–0.59 |
  | `-f 16` | 2 | 0 | 20 merges |
  | Tuned `-n -t 0.5` | 31 | 12 | |

  So the gap is to mkbitmap's highpass specifically, as stated. P3 kept.

### Q5-P3-3 — With the trace worker unavailable, the cooperative fallback runs preparation as one block: 122 ms (Line Art) and 340 ms (Smooth) at the 160,000 px inline cap

- **Where:**
  - `src/ui/trace/use-trace-worker-client.ts:105` (`MAX_INLINE_TRACE_PIXELS`), `:280-287` and
    `:352-370` (inline route);
  - `src/ui/trace/cooperative-trace-runner.ts:5` (`SLICE_MS = 8`).
- **Anchor:** **Twin.** The runner's 8 ms slice target against the generator's checkpoints. The
  preparation stage yields once.
- **Scenario:** The worker cannot start and a 400 × 400 photo is traced inline, on the UI thread.
  - The longest step between yields is 122 ms (Line Art), 340 ms (Smooth), 79 ms (Colour layers) and
    3 ms (Photo shading). Measured in Node on a desktop CPU.
  - The UI stalls for that long.
  - The normal worker path does not do this.
- **Evidence:** REPRO (`node speed5.mjs astronaut.png "<preset>" 56,56,400,400`, field
  `longestSliceMs`) plus READ.
- **Fix direction:** Add checkpoints inside `prepareTraceForContour`, after the median, the level and
  the threshold. Or lower the inline cap so one preparation stays under one frame.
- **Refuter: CONFIRMED in its numbers; the mechanism and fix direction are corrected.**
  - **Measured** on the same 400 × 400 crop, under `next(true)` (`zz-q5r/slices.mjs`). The longest
    uninterrupted stretch is:
    - Line Art: 117–128 ms;
    - Smooth: 300–333 ms.
  - **Where it is.** That stretch is outside every generator step, before the runner gets its first
    step. It is the synchronous prelude of `traceImageToColoredPaths`: `prepareContourTraceInput` and
    `traceScalePlan` (`trace-to-paths.ts:181, 183`).
  - **Inside the generator** the longest single step is 41–82 ms (Line Art), 47–57 ms (Smooth) and
    65–72 ms (Colour layers); Photo shading takes 3–4 ms.
  - **The fix** therefore has to bring that prelude into the stepped pipeline. Checkpoints inside
    `prepareTraceForContour` alone would not reach it. P3 kept, because the worker path is normal.

### Q5-P3-4 — Test gap: no shipped test runs degraded real images through the automatic cut, the ADR-402 gate or the Colour-layers auto palette

- **Where:**
  - `src/core/trace/colour-layer-palette.test.ts:20-55`: grain is ±6 uniform on three large blocks,
    with no thin dark artwork and no JPEG round-trip.
  - `src/__fixtures__/perceptual/uneven-lighting-trace.test.ts`: synthetic shaded pages only.
  - ADR-402's astronaut check is on the pristine PNG.
  - No test traces blurred or low-resolution small text and asserts counters or stroke area.
- **Anchor:** **Contract.** METHOD L7 (tests must assert shipped behaviour on the inputs users bring).
- **Evidence:** READ, with Q5-P2-1, Q5-P2-2 and Q5-P2-3 as the measured consequences.
- **Fix direction:** Add the three degraded fixtures above (blurred 26 px text, a JPEG-q60 flat logo
  with thin black text, the astronaut with σ 3 grain) as perceptual regression cases through
  `traceImageToColoredPaths`.
- **Refuter: CONFIRMED** (by reading, plus the three reproduced consequences above).
  - `colour-layer-palette.test.ts:22, 52-53` uses ±6 LCG grain on three blocks.
  - No `src/**/*.test.ts` traces the astronaut; it appears only in photo-raster tests.
  - No trace test blurs small text and counts its holes. JPEG appears only as ±8 "JPEG-like" noise
    (`small-mark-policy.test.ts:187`).
  - P3 kept.

## KNOWN re-observed

- **Q5-P1-K1 (Q4-P2-3, raised to P1 by its refuter): i-dots and full stops on ordinary small text.**
  - On the clean logo's 20 px line (ink 20 / paper 245), Line Art and Smooth remove 8 of its 9 small
    marks (3.7–8.2 px²): i-dots, the j-dot, comma, colon and full stops.
  - Under JPEG, noise, paper and the photo combination they remove 4–8.
  - Plain Potrace keeps all of them; Sharp keeps all.
  - Smooth shares the policy (`trace-presets.ts:187`).
  - Overlay: `out/ov-logo-clean-ij.png`.
  - **Refuter: CONFIRMED as KNOWN, with one correction.** Own logo, an Arial 19 px line:
    - Line Art and Smooth drop 8 dots of 3.3–3.5 px², plus one 6.1 px² mark. Sharp drops 2.
    - Plain Potrace also drops 4 of the dots (plus 2 thin marks), so "Plain Potrace keeps all of them"
      depends on the render. mkbitmap keeps all.
- **Q5-P3-K2 (Q4-P2-1): speed.**
  - 512² in-process: 150–900 ms. 1024² source: 1.29–1.63 s (Line Art preparation alone 1.11 s).
  - Potrace takes 21–170 ms per 512² process.
  - Segment counts on these 480–512 px real images are level with plain Potrace (logo 393 against
    411, text 488 against 509). Q4's 2.5× gap comes from smaller crops.
  - **Refuter: CONFIRMED in direction.**
    - On 400–420 px images KerfDesk takes 56–212 ms. Potrace takes 38–57 ms per process.
    - Segments: logo 339 against 438, text 506 against 562.
- **Q5-P3-K3 (ADR-437 Context): Edge Detection removes small counters.**
  - ADR-437 says Minimum line drops "a speck or a small hole".
  - On the clean logo it closes 5 of 12 holes, the 12.6–14.9 px² counters of the 20 px line. On
    low-res text it closes 12 of 22.
  - As documented.
  - **Refuter: CONFIRMED.** On the own clean logo it closes 2 of 16 holes; on own centred low-res text,
    26 of 37.
- **Q5-P3-K4 (ADR-402 Consequences, Limits): "Line Art's fixed band does not flatten".**
  - On the dim page (paper 250 → 120 in the corners, ink 60), Line Art adds 4 dark-corner blobs:
    IoU 0.938 logo and 0.701 text, Hausdorff 64 px.
  - Smooth and Sharp level the page: 0.983 / 0.897 and 0.982 / 0.912.
  - As documented; Smooth is the dialog's scan preset.
  - **Refuter: PLAUSIBLE.** The dim page was not re-run. On the own 40% ramp, Smooth and Sharp level
    the page (logo IoU 0.984) while Line Art scores 0.953 and adds a blob. ADR-402 Limits were read at
    `93334429e`.

## Refuted

- **"Smooth's hole-fill policy closes the counters" (Q5-P2-1).** With `fillPinholeCracks: false` the
  same five counters close. The cut is the cause.
- **"Colour layers breaks ADR-461's 0.2% floor" (Q5-P2-2).** The debug probe shows the engine's own
  flat share of black is 0.115–0.188%, under the floor, in every failing case. My first estimate with
  an independent OKLab re-implementation (0.32–0.51%) was wrong. The rule is applied as written; its
  premise is what fails.
- **"Arch House references show KerfDesk is more faithful".**
  - The filled and outline references are separately drawn. The repo's own comment says so:
    "diagnostic comparisons, not pixel-registered acceptance truth"
    (`arch-house-reference-loop.test.ts:3-5`).
  - Registered by ink bounding box, the source's own ink scores IoU 0.43 against the filled reference.
    Tracers score 0.37–0.45.
  - Used only as a diagnostic row; stability against each tracer's own clean trace replaces it.
- **"Centerline is 2.35 px off on hand-drawn strokes".** The maximum sits at a bend tighter than the
  stroke's half-width (3.5 px). There the medial axis cannot follow the pen path. ADR-405 records the
  same cause (handwriting max 1.78 px, "Junction and cap topology sets the maxima").
- **"Centerline drops the r = 1.5 dot against ADR-405".** ADR-405 keeps the 12 px speck filter in
  force and measured a lone dot. In a full scene the Otsu cut includes fewer anti-aliased pixels, so
  the same dot falls under 12 px. Not raised.
- **"Smooth's automatic median does nothing on impulse noise".** It removes every isolated impulse:
  0 of about 1,267 black impulses remain. Impulses touching an edge stay as bumps (wobble max 1.27 px),
  exactly as in plain Potrace. That matches `preprocess.ts:157-160`, which repairs only isolated
  impulses.
- **Refuter-refuted: "mkbitmap's 0.2–0.6 px edge offset is part of the pipeline and counts against
  it".**
  - It is a fixed (−0.25, +0.25) px translation from mkbitmap's ×2 sampling convention. It is not
    shape error.
  - Removed, it moves B from 24 / 1 / 2 to 22 / 3 / 2, C from 22 / 1 / 4 to 23 / 1 / 3, and P-mk's
    text IoU from 0.773 to 0.817.
  - The headline and scorecard carry the corrected figures.
- **Refuter-refuted: "σ 3 grain flips the astronaut" as a fixed threshold.** It depends on the draw.
  - Independent per-channel σ 3 does not flip it, and mono σ 2 does not either.
  - Mono σ 1.5 flips Sharp.
  - The finding stands (Q5-P2-3); only its wording is narrowed.

## Verified clean

- **Twins.**
  - **CLI against core.** On degraded PNGs (Smooth on blurred text, Line Art on JPEG-q35 Arch House):
    max boundary gap 7 × 10⁻⁶ px, IoU 1.000000 / 0.999998, the same subpath counts.
  - **CLI and Multi-File Trace** share `traceImagesToVectorFiles`
    (`src/ui/trace-cli/run-trace-cli.ts`, `src/ui/commands/multi-file-trace-action.ts:161`).
  - **Preview and commit** are one computation for sources up to the 2,048 px preview cap
    (`trace-preparation.ts:19-20`). Above it the finer commit grid of ADR-409 applies (rolling-v2
    07-P2-2, not re-run).
  - **Camera trace** builds the bed image and opens the normal Trace dialog
    (`src/ui/camera/use-trace-from-camera.ts:51-68`).
  - **The jig tracer** uses the dialog's option merge, preview hook, commit resolver and placement
    (`JigTraceControls.tsx:38-45`; `jig-trace-import.ts:13-18, 116`). By code reading.
- **Background flattening (ADR-402) on artwork.**
  - Ramp 40%, the photo combination and the dim page all report "levelled".
  - Logo Smooth IoU is 0.9835 on ramp40 against 0.9834 clean. Arch House Smooth stability on ramp40
    is 0.982.
- **Automatic cut on grey paper.** 108 (logo) and 122 (text), between plateaus of about 16 and 190.
- **JPEG artefacts.** At q35 Line Art's straight edges wobble 0.025 px RMS (max 0.26), with 0 specks
  and all 11 corners sharp.
- **Isolated impulse noise** is removed by Smooth and Line Art; see Refuted.
- **Centerline (ADR-405)**, clean, jpeg35, noise12, blur1 and lowres3:
  - body deviation 0.088–0.174 px mean;
  - all 15 true ends found;
  - 0 stray ends (2 at σ 12);
  - the X traces as two straight crossing lines and the T joins;
  - the 2 px gap in a 3 px stroke bridges, as ADR-405 says;
  - r 2.5 and 4 dots become 3 and 5 concentric circles;
  - 64–100 segments for 17 paths;
  - on the dragon: 2,593 subpaths, as ADR-405 recorded, and 11,497 segments (ADR-405: 12,189).
- **Colour layers' shared edges.** In every condition: 0 px² double-covered and 0.3–0.9 px² uncovered
  along seams. The partition is exact as ADR-461 promises; only the palette fails (Q5-P2-2).
  - **Refuter: CONFIRMED.** Own two scenes, 17 conditions, layers rasterised separately by librsvg at
    4 × 4: overlap 0–0.31 px², and 0–0.13 px² uncovered more than 1 px inside the art.
- **Photo shading.** Tone r 0.980, mean error 0.034. Stable under JPEG and noise (IoU 0.992 / 0.982
  against its clean trace). 36–49 ms, longest step 3 ms.
- **Corners and straight edges** on clean and degraded logos; see the scorecard.

## Not verified

- **The browser decode path.** Inputs were decoded by sharp (libjpeg-turbo) and fed as pixels. The
  CLI's help says browser JPEG decoding differs at edge pixels. Main's #1484 changed PNG and JPEG
  orientation and Multi-File decoding; that is not on this path.
- **Real phone photos and scans.** Every degradation is synthetic and stated above; in particular
  per-channel colour noise was not run (the grain is the same on R, G and B).
- **Images over 512 px for fidelity.** Only speed ran at 1,024 and 1,254 px. The finer commit grid
  above 2,048 px was not run.
- **Line + fill, and Edge Detection beyond the passing rows.** Hybrid width decisions were not scored.
- **Other Potrace settings.** Only `-f 16` was tried as a tuned mkbitmap. `-a` and `-t` keep their
  defaults.
- **UI-thread cost in the browser.** Slice lengths were measured in Node. The worker path and the
  machine-conditioning runner (`trace-machine-conditioning.ts:49`) were not timed.
- **The outline reference** of Arch House was not used.
- **Burned output** of Photo shading's 154,457 segments per 512² photo is Q6.
- **Refuter, not verified:**
  - **Covered since the audit.** Per-channel colour noise is covered now, on the astronaut; it does not
    flip the gate. A tuned mkbitmap without the highpass (`-n -t 0.5`) is covered too.
  - **Not re-run:** wobble, corners, impulse noise, the dim page, Photo shading tone, Arch House
    stability, the 1,024 and 1,254 px speeds, and the CLI twin. Those scorecard rows are PLAUSIBLE.
  - **Decoding.** The browser decode was not run. The refuter's JPEGs were decoded by sharp too.

```json
[
  {"id":"Q5-P2-1","severity":"P2","area":"trace-real-images","file":"src/core/trace/preprocess.ts","line":236,"anchor":"Ground truth: glyph outlines and Potrace 1.16 (plain and mkbitmap) on the same pixels; Contract (partial): ADR-533 Context (Otsu cut off the mid-level) and Decision 3 'Thin features keep the cut'; dialog-parts.tsx:36 'For scans and noisy artwork'","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-533 Limits (wide blurs)","summary":"Smooth/Sharp Otsu cut on sparse AA text lands at 155 (clean), 180 (blur sigma 1), 191 (low-res x3) vs the 132 mid-level: strokes +40.5%/+75.0% area and 5/22 and 15/22 counters closed (Sharp 3 and 11); Line Art, Potrace plain and mkbitmap keep all at blur 1 (mkbitmap loses 1 at low-res); a plateau mid-level cut (144/152) keeps them (+2.7%/+1.9%); hole-fill policy is not the cause","refuter":"Auditor cases re-run identically (cut 155/180/191; 5 and 15 real counters). Own librsvg text: blur 1 Smooth cut 176, +38%, 4/37 closed; centred low-res 191, +84%, 25/37 closed; Potrace plain 0, mkbitmap 0/6. Pinhole fill off: same; manual cut 133/150: none closed. No promise of counters found (presets, detection notes, tooltips, ADRs): P2 kept"},
  {"id":"Q5-P2-2","severity":"P1","area":"trace-real-images","file":"src/core/trace/colour-palette.ts","line":165,"anchor":"Ground truth: 5 known ink colours; Contract: Colours hint \"Auto picks the colours the artwork really uses\" (ColourLayerTraceSettingsControls.tsx:47), swatch note \"Darker colours start at more power\" (:224), ADR-461 Decision 6 (power from each colour's own darkness) and Decision 2 (0.2% flat-area floor, non-flat pixels are mixtures); colour-quantize.ts:64-65 premise; Twin: a requested count keeps black","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Colour layers Auto drops the black text (2% of the image) of a flat-colour logo at JPEG q35/50/60 (q75 too in the refuter scenes), blur sigma 1 and noise sigma 12: engine flat share of black 0.633% clean -> 0.188/0.115/0.136/0.005%, under AUTO_MIN_SHARE 0.2%; the text is traced on another colour layer and burns with its operation and power: on a pale logo at 41-45% instead of 100%, and on a saturated logo every remaining layer starts 1.2-1.45x higher; no notice; shared edges stay exact","refuter":"Raised P2 -> P1 (tone, no warning). Own 5-colour scene: q75/q60/q50/q35, blur 1 and sigma 12 drop black, text 88-96% on the blue layer; all remaining layers start 1.2-1.45x higher (blue 69.1% -> 100%). Own pale logo (#f5d76e, #8ec5ff, black text): the text goes to the light-blue layer at 41.4-44.9% instead of 100%; Colours=4 keeps it at 100%. The swatches and preview are the output itself, not a warning"},
  {"id":"Q5-P2-3","severity":"P2","area":"trace-real-images","file":"src/core/trace/background-flatten.ts","line":143,"anchor":"Contract: ADR-402 Decision 2 (busy pictures are not credible paper) and Consequences (astronaut 'declined on every call'); Twin: Line Art and Potrace plain stable on the same input","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-402 Limits (soft shading removed)","summary":"sigma 3 grain on the astronaut photo makes flattenUnevenBackground accept and Smooth/Sharp report lightingLevelled: trace IoU vs own clean 0.696 (Smooth, 121 -> 829 subpaths) and 0.728 (Sharp, 364 -> 2,190); Line Art 0.974, Potrace plain 0.976; JPEG q35 flips Smooth too; the dialog says uneven lighting was evened out","refuter":"Gate isolated: clean astronaut declines in paperRange at 45.7-47.1% paper cells vs MIN_PAPER_CELL_FRACTION 0.5 (background-flatten.ts:69,378); mono sigma 3 lifts it to 51-53%, paper range then luma 1-2..221. Auditor draw (seed 7) exact: Smooth 0.697, Sharp 0.729. Draw-dependent: per-channel sigma 3 and mono sigma 2 do not flip, mono sigma 1.5 flips Sharp. Addition: Smooth 1x detail pass (contour-detail-detector.ts:51) can level while the reporting 2x pass declines (121 -> 777 subpaths, dialog shows Threshold 101). P2 kept"},
  {"id":"Q5-P3-1","severity":"P3","area":"trace-real-images","file":"src/core/trace/trace-image.ts","line":384,"anchor":"Twin: auto-sketch promotion is noise-scaled (auto-sketch-trace.ts:59,74) but the local cut is a fixed 8 luma; Contract: Auto tooltip 'remove scan dust'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Line Art's colour local-detail cut (luma < localMean - 8) turns grey grain into specks on a colour logo: sigma 3/6/9/12 -> 0/0/8/626 specks (Smooth 0-1, Potrace plain 6-23, mkbitmap 15-1,842)","refuter":"Own draw: Line Art 0/2/7/598 specks at sigma 3/6/9/12; Smooth 0"},
  {"id":"Q5-P3-2","severity":"P3","area":"trace-real-images","file":"src/core/trace/trace-presets.ts","line":42,"anchor":"Ground truth: logo 20 px text line; mkbitmap+Potrace on the same pixels","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Low-res x3 / blur sigma 1 grey logo: Line Art loses 26/10 of 50 marks, Faint lines 24/7, Smooth 14/9, Sketch 5/2 but IoU 0.65-0.68; mkbitmap keeps all but 3-4 (hollowing solids or merging); improvement: local normalisation before the band","refuter":"Own logo (51 marks): low-res LA 34, Sm 23, Sh 19, plain 34, mkbitmap 5 (9 merges), -f 16 2 (20 merges), -n 31; blur 1 LA 13, Sm 12, Sh 11, mkbitmap 0"},
  {"id":"Q5-P3-3","severity":"P3","area":"trace-real-images","file":"src/ui/trace/use-trace-worker-client.ts","line":105,"anchor":"Twin: cooperative runner SLICE_MS 8 (cooperative-trace-runner.ts:5) vs generator checkpoints","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Inline (worker-unavailable) fallback at the 160,000 px cap runs preparation as one step: longest uninterrupted step 122 ms Line Art, 340 ms Smooth on a 400x400 photo (Node)","refuter":"Numbers reproduce (LA 117-128 ms, Smooth 300-333 ms on the same crop), but the stall is the synchronous prelude before the runner (prepareContourTraceInput and traceScalePlan, trace-to-paths.ts:181,183); the longest generator step is 41-82 ms. The fix must step the prelude"},
  {"id":"Q5-P3-4","severity":"P3","area":"trace-real-images","file":"src/core/trace/colour-layer-palette.test.ts","line":20,"anchor":"Contract: METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No shipped test traces degraded real inputs through the Otsu cut (blurred small text), the ADR-402 gate (noisy photo) or the Colour layers auto palette (thin dark text in a JPEG round-trip)","refuter":"Read: colour-layer-palette.test.ts:22,52-53 uses +-6 grain; no trace test uses the astronaut, blurred small text, or a JPEG round-trip; consequences reproduced"},
  {"id":"Q5-P1-K1","severity":"P1","area":"trace-real-images","file":"src/core/trace/small-mark-policy.ts","line":224,"anchor":"Q4-P2-3 (P1 after refuter)","evidence":"REPRO","verdict":"CONFIRMED","known":"Q4-P2-3","summary":"Clean AA logo, 20 px line: Line Art and Smooth remove 8 of 9 i-dots/periods/comma (3.7-8.2 px2), 4-8 under degradations; Potrace plain and Sharp keep all","refuter":"Own Arial 19 px line: LA/Sm drop 8 dots (3.3-3.5 px2) + 1; Sharp 2; plain Potrace also drops 4 dots (render-dependent); mkbitmap keeps all"},
  {"id":"Q5-P3-K2","severity":"P3","area":"trace-real-images","file":"src/core/trace/auto-upscale.ts","line":53,"anchor":"Q4-P2-1","evidence":"REPRO","verdict":"CONFIRMED","known":"Q4-P2-1","summary":"512 px real images 150-900 ms vs Potrace 21-170 ms; 1024 px 1.3-1.6 s; segment counts level with Potrace plain at 480-512 px","refuter":"Own 400-420 px images: KerfDesk 56-212 ms vs Potrace 38-57 ms per process"},
  {"id":"Q5-P3-K3","severity":"P3","area":"trace-real-images","file":"src/core/trace/trace-presets.ts","line":149,"anchor":"ADR-437 Context (Minimum line removes a small hole)","evidence":"REPRO","verdict":"CONFIRMED","known":"ADR-437 Context","summary":"Edge Detection closes 5 of 12 holes (12.6-14.9 px2 counters of 20 px text) on a clean logo, 12 of 22 on low-res text","refuter":"Own: Edge Detection closes 2/16 holes on the clean logo, 26/37 on centred low-res text"},
  {"id":"Q5-P3-K4","severity":"P3","area":"trace-real-images","file":"src/core/trace/trace-presets.ts","line":41,"anchor":"ADR-402 Consequences/Limits 'Line Art's fixed band does not flatten'","evidence":"REPRO","verdict":"PLAUSIBLE","known":"ADR-402 Limits","summary":"Dim vignetted page: Line Art adds 4 dark-corner blobs (IoU 0.938/0.701) while Smooth/Sharp level it (0.983/0.897)","refuter":"Dim page not re-run; own 40% ramp: Smooth/Sharp 0.984, Line Art 0.953"}
]
```
