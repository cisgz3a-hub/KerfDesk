# Quality audit Q1 — Trace vs Potrace (Q4)

- **When:** 2026-10-28 00:40 – 01:45 +0800   **Tree:** origin/main @ `ef910deb6` (fetched at the start;
  worktree `claude/rolling-audit-v5` HEAD `4398d7708`; `git diff origin/main -- src/core/trace` is
  empty). Main later moved to `93334429e`: `src/core/trace` is unchanged there, and the
  `src/ui/trace` changes are image decoding only (`image-loader.ts`, PNG/JPEG headers,
  `trace-cli-source.ts`); no cited file changed.
- **Scope:** the outline tracer behind Line Art, Smooth and Sharp, through the public entry
  `traceImageToColoredPaths` (`src/core/trace/trace-to-paths.ts`). This covers:
  - the scale plan (`trace-upscale-policy.ts`, `auto-upscale.ts`);
  - mask preparation and small marks (`trace-image.ts`, `preprocess.ts`, `small-mark-policy.ts`);
  - the boundary walk and turn policy (`contour-boundary.ts`, `saddle-connectivity.ts`);
  - corners (`contour-corners.ts`, `contour-corner-legs.ts`);
  - the finishing tail (`contour-trace.ts`, `flatten-straight-runs.ts`);
  - the compact fit (`compact-curve-fit.ts`);
  - the presets (`trace-presets.ts`) and the dialog list (`src/ui/trace/dialog-parts.tsx`).

  Twins: the headless CLI (`scripts/trace-cli.*`, ADR-477), and the commit chain
  `positionTraceOverRasterSource` → `conditionTracedImageForMachine`.
  Governing: ADR-123, ADR-371, ADR-402, ADR-403 (+ Amd 1), ADR-409, ADR-434 (+ Amd 1), ADR-438,
  ADR-439, ADR-477, ADR-530. Reference: Selinger (2003) and Potrace 1.16 as a separate test-only
  process. No Potrace source was read.
- **Lenses run:**
  - **L2.** The paper was fetched and pinned. Potrace 1.16 was run on every input, as a binary.
  - **L3.** CLI against the core trace; commit placement against the source raster; the same
    shape on different canvas sizes.
  - **L7.** Which entry the quality gates call.
  - L1 was folded into L3: each ADR claim was checked against its measurement.
- **Counts:** 7 raised → 0 refuted → P1 2 / P2 2 / P3 3 (+ 5 KNOWN re-observed). Refuter: 7 of 7
  CONFIRMED; KNOWN K1–K4 CONFIRMED, K5 PLAUSIBLE. One severity change: Q4-P2-3 raised P2 → P1
  (its ID is kept).
- **Refuter (2026-10-28, fresh context):**
  - **Tree.** Worktree `claude/rolling-audit-v5` @ `4398d7708` against origin/main `93334429e`.
    `git diff origin/main -- src/core/trace scripts/trace-cli.ts` is empty. The `src/ui/trace` and
    `src/ui/trace-cli` differences are PNG eXIf orientation and image decoding only. None of them
    touches a traced pixel of a PBM or a synthetic RGBA input.
  - **Own code.** Scratchpad `zz-q4r/`, written without reading `zz-q4/` metric code:
    - shapes, glyphs (opentype.js 2.0.0) and pixel-centre rasterising;
    - a P4 PBM writer;
    - Potrace run as a separate process, with an SVG reader for `M/L/C/H/V/Z` and their relative
      forms;
    - metrics: two-way mean and Hausdorff over 0.05 px samples, exact even-odd scanline area,
      joint-tangent corners, merged segment count, excess turning and inflections at 0.25 px, and
      depth-parity topology.

    Engine: an esbuild 0.28.1 bundle of `traceImageToColoredPaths` and `TRACE_PRESETS`. That is the
    call the dialog worker makes (`trace-worker.ts:94`; the dialog does not set
    `freezeSourceDecisions`).
  - **Fairness checks.**
    - **Same bitmap.** KerfDesk gets 0/255 RGBA and Potrace a P4 PBM of the same mask. On 0/255,
      Line Art's band (luma ≤ 128) and Otsu's cut (1, luma < 1) pick identical ink.
    - **Potrace units.** `-u 100` gives `translate(0,H) scale(0.01,-0.01)`. A pixel-aligned
      20 × 12 square came back on the exact pixel corners (7, 5)–(27, 17), the same as Sharp's.
    - **Paper.** Re-fetched from the live URL: SHA-256 `a057763a…735e2`, identical to the pin.
      §2.3.1 places each vertex "in the unit square" at max-distance ≤ ½ from its path vertex.
      §2.1.3 drops paths "of fewer than t pixels".
    - **Metric caveat: the totals are sensitive to weighting.** The nine case metrics carry equal
      weight, and two pairs are correlated:
      - segments with excess turning, which both count the staircase;
      - apex gap with corners not kept, which both count corners.

      The refuter re-scored its 20-case subset on seven metrics, dropping excess turning and apex
      gap (`zz-q4r/sum7.mjs`). Nine of 60 cells change:
      - Line Art moves from 8 / 3 / 9 to 9 / 4 / 7;
      - Sharp from 13 / 4 / 3 to 13 / 5 / 2;
      - Smooth from 9 / 4 / 7 to 10 / 5 / 5.

      Most of the changes are circles and rings at 32 and 64 px, where the doubled smoothness count
      decided the case.

      The 79-case totals are a correct count under the stated rule. The headline's "not yet better
      overall" for Line Art, however, rests on a few cases that turn on how smoothness is weighted.
      The large gaps hold under either weighting: the segment and smoothness rows, the spikes and
      the lost marks.

## Headline

**Not yet better than Potrace overall.** Line Art, the default preset and the one the dialog
recommends for logos, scores **27 wins, 19 ties and 33 losses** against Potrace 1.16 defaults over
79 ground-truth images. Sharp scores 40 / 19 / 20 and Smooth 27 / 17 / 35.

**Where KerfDesk wins:**
- **Large, clean art on the native route.** Line Art wins 10 / 3 / 3 on 200 px shapes:
  - it keeps 45 of 46 true corners sharp, against Potrace's 23;
  - mean boundary error is 0.098 px against 0.131;
  - area error is 0.56% against 2.58%;
  - circles take the same few cubics (9 against 10).
- **Corner placement, everywhere.** The mean apex gap is 0.29 px against 0.60, and Sharp keeps
  274 of 331 corners sharp against 143.
- **Topology.** Holes and 1 px gaps are always right.
- **Thin strokes.** Their area is closer to the truth.

**Where it loses:**
1. **Smoothness and node count on small or thin-featured images (Q4-P2-1).**
   - Line Art and Smooth trace any image under 100 px, and any image with thin detail (every crop
     of the Arch House logo), on a 2–3× bilinear enlargement. The fit then follows that
     enlargement's pixel staircase.
   - A 32 px circle becomes 46 cubics with 40 inflections, where Potrace draws 4 smooth cubics.
     The same circle on a 100 px canvas traces as 6 smooth cubics.
   - Real logo crops carry 2.5× Potrace's segments and about 10× its inflections, and trace about
     10× slower.
   - Line Art wins 10 of 16 cases at 200 px but only 3 of 16 at 32 px.
2. **Spikes (Q4-P2-2).** Corner apexes stand up to 3.4 px off the true outline, outside the ink, on
   serifs and slanted terminals, and are joined by straight chords. Line Art has 20 such sharp
   nodes on 8 of 15 glyph images; Potrace has none.
3. **Lost small marks (both P1 after the refuter).**
   - **Q4-P1-1.** On a pure black-and-white image, Smooth deletes every mark of 3–11 px², even lone
     3×3 dots that its own ADR keeps. The cause is that its automatic cut lands at luma 1.
   - **Q4-P2-3 (raised to P1).** Line Art's automatic small-mark policy removes i-dots and full
     stops from ordinary 20–28 px text. On the refuter's render it keeps 0 of 11 at 28 px; Potrace
     keeps all of them.

**Counterfactual.** The same code with the supersample routes switched off ("Line Art native", not
shipped) scores 46 / 13 / 20, with segment counts below Potrace's. The tail's geometry is
competitive; the 2× route and the corner apexes are what cost the wins.

## Scorecard

KerfDesk = Line Art (UI default for logos) unless a cell names another preset. 79 ground-truth
images: 64 shapes (16 kinds × 16 / 32 / 64 / 200 px) and 15 glyphs. "Native" rows are a reference
configuration, not shipped.

| Metric | KerfDesk | Potrace 1.16 (defaults) | Verdict | Refuter |
|---|---|---|---|---|
| Mean boundary error, all 79 | 0.164 px (Sharp 0.142, Smooth 0.167) | 0.154 px | tie (Sharp better) | PLAUSIBLE (not re-run over 79) |
| Same, 200 px shapes | 0.098 px | 0.131 px | better | PLAUSIBLE. Five re-run shapes: 0.106 against 0.142 |
| Hausdorff, median / max | 0.64 / **3.37** px | 0.95 / 2.98 px | median better, max worse (Q4-P2-2) | CONFIRMED max 3.37 px (re-created Tinos R@48); median PLAUSIBLE |
| \|Area error\| | 2.23% (Sharp 1.20%) | 3.58% | better | PLAUSIBLE |
| True corners kept sharp | 140 / 331; at 200 px 45 / 46; glyphs 36 / 147 (Sharp 274 / 331) | 143 / 331; 23 / 46; 36 / 147 | tie overall, better at 200 px | CONFIRMED at 200 px: 45 / 46 against 23 / 46 on all nine re-built shapes. 20 of the 46 are pixel-aligned corners that every tracer keeps, so the corners that matter are 25 / 26 against 3 / 26. Overall and Sharp's 274 PLAUSIBLE |
| Apex gap (true corner → outline), mean | 0.29 px | 0.60 px | better | PLAUSIBLE. Same direction on the subset |
| Turn error at kept corners | 7.2° (Sharp 17.9°) | 2.4° | worse | PLAUSIBLE |
| False corners (joint ≥ 15° turn, > 2 px from any true corner) | 44 (Sharp 90, Smooth 35) | 9 | worse | PLAUSIBLE |
| Sharp nodes ≥ 1 px off the true glyph outline | 20 on 8 of 15 glyph images, max 3.37 px | 0 | **worse** (Q4-P2-2) | CONFIRMED: 4 / 4 / 4 on re-created R@24, R@48 and g@96, plus 4 on Tinos A@32 and 6 on Tinos M@28; Potrace 0 |
| Segments, all 79 (cubic / merged line) | 3,217 (2,897 / 320); Sharp 2,568; Smooth 3,655 | 700 (494 / 206) | **4.6× more** (Q4-P2-1) | PLAUSIBLE. The 20-case subset gives 933 against 225 (4.1×) |
| Smooth convex shapes (circle, ellipse, rounded rect, ring): excess turning / inflections per shape | 1,160° / 24.5; at 200 px 176° / 2.5 | 0° / 0 | **worse** (Q4-P2-1) | PLAUSIBLE. Circle and ring subset consistent |
| Topology (outer and hole counts), touch-corner excluded | 75 / 75 right | 75 / 75 right | tie | CONFIRMED on the 20-case subset: all right, every tracer |
| Two squares touching at a corner | kept as 2 shapes | joined into 1 figure-8 path | tie: a convention, same ink (Refuted) | PLAUSIBLE |
| 1 px gap between bars | 0.996–1.000 px kept, 2 shapes | 1.000 px, 2 shapes | tie | CONFIRMED: Line Art 0.996, Sharp 1.000, Potrace 1.000 at 16 / 32 / 64 px |
| Thin strokes 1–3 px, \|area error\| | 5.1% (Sharp 1.1%, Smooth 13.9%) | 12.0% | better (Smooth K2) | PLAUSIBLE. The K1 and K2 cells re-ran exactly |
| Specks: 1×1 and 2×1 | removed | removed (`-t 2` drops ≤ 2 px²) | tie | PLAUSIBLE |
| Specks: lone 2×2 / lone 3×3 / dotted row of 2×2 | removed / kept / kept | kept / kept / kept | by design (ADR-434) | PLAUSIBLE |
| Lone 3×3 dots beside a large shape, pure 0/255 image | Line Art 6 / 6; **Smooth 0 / 6** | 6 / 6 | **Smooth fails** (Q4-P1-1) | CONFIRMED on the refuter's own image: Line Art 8 / 8, Smooth 0 / 8, Potrace 8 / 8 |
| i-dots and full stops, anti-aliased text 20 / 24 / 28 px | 3 / 12, 8 / 11, 2 / 11 (Sharp all) | all (on the 1-bit render: 12 / 12) | **worse** (Q4-P2-3) | CONFIRMED with the refuter's render: 4 / 13, 9 / 12, **0 / 11**; 1-bit 24 px 9 / 12 against Potrace's 12 / 12. The counts depend on the renderer; the direction does not |
| Speed, median per image, synthetic set | 10.4 ms in-process (Sharp 2.7) | 40 ms per process (≈ 9.5 ms of it process start, machine shared) | faster | PLAUSIBLE |
| Speed, 7 real crops (≤ 512 × 512) | 455 ms (native 147) | 47 ms per process | **≈ 10× slower** (Q4-P2-1) | PLAUSIBLE. On one crop (filled text) it was 198 ms in-process against 35 ms per process. The comparison favours KerfDesk, whose timing excludes process start |
| Real art, mean of 7 crops: IoU (4× supersampled) vs the bilevel input / edge distance | 0.9425 / 0.230 px (native 0.9064 / 0.339) | 0.9084 / 0.305 px | better against the pixels, because the outline follows the staircase | PLAUSIBLE |
| Real art: segments / inflections per 100 px of outline | 22,207 / 18.3 (native 14,855 / 3.9) | 8,762 / 1.9 | **worse** (Q4-P2-1) | CONFIRMED on the filled-text crop: 862c + 66l, against 105c + 54l and 86c + 78l native. Other crops PLAUSIBLE |
| Twin: CLI SVG vs core trace | ≤ 6.8 × 10⁻⁶ px apart (precision 10⁻⁶ mm) | — | exact | CONFIRMED: ≤ 6.95 × 10⁻⁶ px, point-for-point, on circle@32, square-rot17@64, Roboto S@48 and star@64. That is within the 10⁻⁶ mm rounding |
| Twin: committed vectors in mm vs the source raster's own transform | 0 mm; 2.8 × 10⁻⁴ mm off the pixel corner = Line Art's own 0.002 px | — | exact | PLAUSIBLE. Not re-run; the 0.002 px oversize was seen again on a 20 × 12 square |

**Per-case verdicts.**
- Each cell is "Line Art Sharp Smooth" against Potrace.
- A case is a win (W) when that preset wins more of the nine metrics than it loses, a loss (L) when
  it loses more, and a tie (T) otherwise.
- The nine metrics are: mean error, Hausdorff, |area|, apex gap, corners not kept, false corners,
  segments, |excess turning − truth| and topology.
- Tie bands are under Measurement method.

| Shape | 16 px | 32 px | 64 px | 200 px |
|---|---|---|---|---|
| circle | W W W | L W L | W W W | W W W |
| ellipse | W L T | L L L | T W L | L T L |
| square | T T T | T T T | T T T | T T T |
| square-rot17 | L W L | L W L | T W L | W W W |
| tri-30 | L W L | W W W | T W L | W W W |
| tri-60 | L L L | L W L | T W T | W W W |
| tri-90 | L T L | W W T | W W W | W W W |
| tri-120 | T W T | L W L | W W W | W T W |
| star | W W W | L L L | L W L | W T W |
| rrect | L W L | W L W | L L W | L L L |
| stroke-w1 | L L L | L L L | L T L | L T L |
| stroke-w2 | T T L | T T T | W T T | W W W |
| stroke-w3 | W W W | T L T | W W W | T L L |
| ring | L W W | L T L | T L T | W T W |
| touch-corner | L W L | L W L | W W L | W W W |
| gap-1px | T T L | T T L | T T L | T T T |

| Glyph | 24 px | 48 px | 96 px |
|---|---|---|---|
| Roboto a | W W W | L L L | L L L |
| Roboto g | W W W | T L W | L L L |
| Roboto R | L L W | L L L | L L L |
| Roboto S | W W T | L L T | W W T |
| Tinos R (serif) | L W W | L W W | L W T |

**Totals (W / T / L of 79):**
- Line Art 27 / 19 / 33;
- Sharp 40 / 19 / 20;
- Smooth 27 / 17 / 35;
- Line Art native (not shipped) 46 / 13 / 20.

**Line Art by group:**
- shapes: 16 px 4/4/8, 32 px 3/4/9, 64 px 6/7/3, 200 px 10/3/3;
- glyphs: 24 px 3/0/2, 48 px 0/1/4, 96 px 1/0/4.

**Per metric, Line Art (W / T / L):**
- mean error 21/28/30;
- Hausdorff 46/16/17;
- |area| 42/20/17;
- apex gap 32/16/3;
- corners not kept 17/17/17;
- false corners 0/69/10;
- segments 5/24/50;
- excess turning 6/18/55;
- topology 0/75/0.

**Refuter re-run of the win / tie / lose method: CONFIRMED on a subset.** The totals are
unchanged.
- **The subset.** 20 of the 79 cases, re-built and re-scored with independent code
  (`zz-q4r/wtl.mjs`, `lib.mjs`, `glyph.mjs`) under the same nine metrics and tie bands:
  - circle at 16 / 32 / 64 / 200 px;
  - square-rot17 at 32 / 64 / 200;
  - tri-60@64, tri-30@200, tri-90@16;
  - ring at 32 / 64 / 200;
  - star at 64 and 200;
  - Roboto S@48, Roboto g@96 and Roboto a@24;
  - Tinos R at 24 and 48.
- **Agreement.** 59 of the 60 preset cells match the tables above. The exception is Tinos R@48
  Smooth, which the refuter scores T and the table W; it is a marginal case.
- **Subset totals.** Line Art 8 / 3 / 9 (the same cells as above), Sharp 13 / 4 / 3, Smooth
  9 / 4 / 7.
- **Not re-run.** The other 59 cases, and the "Line Art native" counterfactual (46 / 13 / 20), are
  PLAUSIBLE.

### Measurement method

All scripts are in the scratchpad folder `zz-q4/`. They import nothing from Potrace, and from
KerfDesk only the public trace entry.

**Engine.**
- `build-engine.mjs` bundles `src/core/trace/trace-to-paths.ts` (`traceImageToColoredPaths`) and
  `trace-presets.ts` from this worktree with esbuild 0.28.1. The esbuild copy is the main checkout's
  `node_modules/.pnpm/esbuild@0.28.1`, used as `scripts/trace-bench.mjs` uses it.
- That entry is the same one the dialog, Multi-File Trace and the CLI call.
- `build-debug.mjs` builds a second bundle with in-memory log probes (esbuild `onLoad`; the files on
  disk are unchanged). It reports each loop's `pixelScale` and measured flag and the
  topology-repair steps, and it can toggle the straight-run flattener and the extra output corners
  for the root-cause checks.

**Ground truth** (`geom.mjs`).
- **Rasterising.** Pixel (i, j) is ink when its centre (i + 0.5, j + 0.5) is inside the shape. Shapes
  use even-odd; glyphs use nonzero, and nonzero gave the same pixels as even-odd at 96 px, so no
  contour overlaps.
- **Images.** Size S ∈ {16, 32, 64, 200}. The canvas is S + 2·max(6, round(0.25 S)) square, and the
  centre is offset by (+0.31, +0.17) px.
- **Shapes:**
  - circle, diameter S;
  - ellipse, S × 0.6 S, turned 20°;
  - square of side S on pixel edges, so it can be traced exactly;
  - square-rot17, the square turned 17°;
  - tri-30 / 60 / 90 / 120: isosceles triangles with that apex angle, longest side S, turned 7°;
  - star: five points, outer radius S/2, inner radius 0.4 of it, turned 3°;
  - rrect: S × 0.6 S, corner radius 0.15 S;
  - stroke-w1 / w2 / w3: bars S long and 1 / 2 / 3 px wide at 23°, butt ends;
  - ring: outer diameter S, inner 0.6 S;
  - touch-corner: two pixel-aligned squares of side round(S/2) sharing one corner point;
  - gap-1px: two pixel-aligned bars, max(3, round(S/2 − 0.5)) × S, with a one-pixel column between.
- **Glyphs.** opentype.js 2.0.0 `getPath`, at em sizes 24, 48 and 96 px.
  - Fonts: Roboto-Regular `a g R S` and Tinos-Regular `R`, from `src/ui/text/fonts`.
  - Margin: max(6, round(0.15 · em)) plus (0.31, 0.17).
  - Curves are flattened at 0.05 px, and zero-length segments are dropped.
  - A true corner is an on-curve join whose tangent turns more than 25°.
- **Speckle field.** 160 × 80 px: a 50 × 50 square, eight each of 1×1, 2×1, 2×2 and 3×3 dots, and six
  2×2 dots 3 px below the square. Further clean single-class fields are in `specks.mjs`.

**Tracers.**
- **Potrace.** `potrace.exe -s -u 100 -t 2 -a 1 -O 0.2 -z minority`, on a P4 PBM of the same mask.
  `-u 100` only refines the output quantisation (Selinger §2.5.3) to 0.01 px. The tuned run is
  `-t 1`, for the speckle field. The SVG is parsed with its `translate(0,H) scale(0.01,-0.01)` and
  relative `c` / `l` commands.
- **KerfDesk.** Each `ColoredPath`'s canonical `curves` (cubic and line segments). Presets as shipped
  (`TRACE_PRESETS`). "Native" sets `supersampleContour`, `autoUpscaleSmallSources` and
  `upscaleSmallSmoothSources` to false.

**Metrics** (`score` in `geom.mjs`).
- **Sampling.** Traced curves are sampled every 0.1 px and truth rings every 0.05 px. Distances are
  to the nearest segment, through a 1 px grid index.
- **Boundary error.** Mean error is the average of the two directed means. Hausdorff is the larger
  of the two directed maxima.
- **Area.** The shoelace area of each ring, signed by nesting-depth parity (the majority of 7 probe
  points along the ring), against the analytic area.
- **Corners.**
  - A corner is kept sharp when a segment joint lies within 1.5 px of the true corner and turns by
    at least max(10°, half the true turn).
  - The apex gap is the distance from the true corner to the traced curve.
  - A false corner is a joint turning ≥ 15° that is more than 2 px from every true corner.
  - A spike (Q4-P2-2) is a joint turning ≥ 90° that lies ≥ 1 px from the true outline.
- **Segments.** Cubics, plus lines with consecutive collinear lines (< 0.01°) merged. Potrace writes
  a corner as two lines.
- **Smoothness.** Each ring is resampled at 0.25 px of arc length.
  - Excess turning is Σ|Δθ| − |ΣΔθ| per ring, minus the truth's own.
  - An inflection is a change of turning sign after more than 2° of opposite turning.
- **Topology.** Outer and hole counts, from depth parity, against the truth.
- **Speed.** Wall time. KerfDesk is timed in-process after one warm-up trace. Potrace is timed with
  `spawnSync`, including process start; an 8 × 8 image alone takes 9.5 ms, median of 9.

**Tie bands.**
- mean error: ±max(0.02 px, 10%);
- Hausdorff: ±max(0.05 px, 10%);
- |area|: ±0.25 points;
- apex gap: ±0.1 px;
- counts: equal;
- segments: ±max(1, 10%);
- turning: ±10°.

Totals: `tally.mjs`. Aggregates: `summary.mjs`. Tables: `wtl-table.mjs`.

**Real art** (`real.mjs`).
- **Crops** (x, y, w, h):
  - `arch-house-langebaan-source.png`: text (100, 540, 512, 200) and house (180, 220, 512, 300);
  - `arch-house-filled-reference.png`: house (330, 160, 512, 400) and text (30, 730, 512, 260);
  - `arch-house-outline-reference.png`: house (330, 160, 512, 400);
  - `centerline-stress-test-20260909.png`: spiral (100, 560, 512, 512) and strokes (0, 1100, 512, 154).
- **Threshold.** Once: alpha over white, BT.601 luma ≤ 128, which is Line Art's band. The same 0/255
  bitmap goes to every tracer.
- **IoU.** The traced outline is rendered even-odd at 4 × 4 pixel centres per pixel and compared with
  the bilevel mask.
- **Edge distance.** To the mid-crack points of the mask boundary.
- **Lost marks.** 8-connected input components less than 50% covered (`lost.mjs`).

**Rendered evidence:** `zz-q4/out/crop-*.png` and `zz-q4/out/img/*.overlay.png`. Grey is the input,
green the truth, blue Potrace and red KerfDesk.

**Temporary repo file (deleted after the run):** `src/ui/trace/zz-q4-twin.test.ts`, a Vitest run as
`node ../../../node_modules/vitest/vitest.mjs run src/ui/trace/zz-q4-twin.test.ts`. To rebuild it:
1. Draw a 64 px pixel-aligned square at (16, 16) in a 96 × 96 image.
2. Trace it with `traceImageToColoredPaths` and `TRACE_PRESETS['Line Art']`.
3. Wrap the paths in a `TracedImage` (`tracePixelWidth` 96, `tracePixelHeight` 96).
4. Place it over a `RasterImage` with `positionTraceOverRasterSource`. Two cases:
   - bounds 9.6 × 9.6 mm, no rotation;
   - bounds 25.4 × 28.8 mm, `rotationDeg` 30.
   Both use `x` 12.5 and `y` 40.25.
5. Run `conditionTracedImageForMachine(traced, placed.transform, 'laser', { options, traceOutput: 'vector' })`.
6. Compare each conditioned vertex through `applyTransform(v, placed.transform)` with:
   - `applyTransform({x: v.x·kx, y: v.y·ky}, source.transform)`, the same point through the
     source's transform (expected 0 mm);
   - the nearest pixel corner through the same transform (expected only the trace's own 0.002 px).

**CLI runs** (twin):
- `node scripts/trace-cli.mjs --dpi 254 [--precision 0.000001] -o <svg> <pbm>` on
  `circle@32`, `square-rot17@64`, `Roboto-S@48` and `square@64`, compared by `clitwin.mjs`;
- `-p Smooth` and `-p "Line Art"` on `dots-square.pbm`.

## Method against Selinger (2003)

**Source.** P. Selinger, *Potrace: a polygon-based tracing algorithm*, 20 September 2003:
- fetched from https://potrace.sourceforge.net/potrace.pdf on 2026-10-28;
- SHA-256 `a057763ad1c8d8433c605b8e63a1f91e8f43aed99ad5696fb790276e451735e2`, 269,101 bytes;
- web.archive.org could not be reached from this machine, so the hash is the pin.

The paper is paraphrased below, with section numbers.

Potrace's command-line semantics are from `potrace --help` (1.16), which says `-t` suppresses
speckles "of up to this size". Measured: `-t 2` drops 1 and 2 px² marks, and `-t 1` drops only
1 px². The paper's §2.1.3 says "fewer than t".

| Stage | Selinger 2003 | KerfDesk (file:line) | Difference, judged by output |
|---|---|---|---|
| Path decomposition | §2.1.1: walk the pixel-corner lattice with ink on one side; each closed path is a boundary | `contour-boundary.ts:40-55` (`traceBoundaryLoops`), `:201-258` (walk). The same lattice (pixel = unit square). Holes are separate loops with the opposite orientation | Same model. Topology was right on 79 / 79 |
| Turn policy | §2.1.2: seven policies, default minority (prefer the colour that is locally rarer) | `saddle-connectivity.ts:165-230` (ADR-403 + Amd 1). `auto` takes a minority vote over a 4 × 4 source-pixel window. Ties go to a grey asymptotic decider, else paper joins | Equivalent on hairlines (ADR-403 table). On a symmetric tie (two squares meeting at a corner) Potrace joins and KerfDesk splits: both bound the same ink |
| Speckle (`turdsize`) | §2.1.3: drop paths by interior area | `contour-trace.ts:279-283` (`isAdmittedLoop`, area ≥ Ignore Less Than, both polarities). Before that, a mask-stage policy (`small-mark-policy.ts`, ADR-434): < 3 px² always removed; 3–11 px² judged on tone and neighbourhood. Sharp keeps everything | KerfDesk removes far more by evidence (lone 2×2 specks, dust tiles, stroke halos). Q4-P1-1 and Q4-P2-3 are where that judgement goes wrong |
| Optimal polygon | §2.2: straight paths within ½ px max-distance (§2.2.1); fewest segments, then least penalty (§2.2.3–2.2.4) | **None.** Instead: mid-crack chain (`contour-boundary.ts:95-121`); Taubin smoothing between corners; curvature evening; straight-run flattener (`flatten-straight-runs.ts`, amplitude 1 px × strength); Douglas-Peucker at 0.45 px × lineTolerance × Optimize (`contour-trace.ts:204-211`, `:475`); corner-aware spline with a chord band (`contour-trace.ts:487-506`) | No global staircase model. Native binary output is close to Potrace's segment count. On the 2× route the chain is a bilinear iso-line, and nothing removes its staircase (Q4-P2-1) |
| Vertex adjustment | §2.3.1: each polygon vertex moves to best fit its two lines, but only within the unit square around its path vertex | No polygon vertices. Points are mid-crack, interpolated against the pre-threshold field where it is not saturated (`contour-boundary.ts:123-155`; saturated gate `:138`). Corner apexes are leg intersections allowed (0.9 + 0.5 / sin(interior/2)) px from the chain for binary loops (`contour-corner-legs.ts:38-39, 209-214`), 3.8 px at 20° | No bound against the ink. Apexes stand up to 3.4 px off the outline (Q4-P2-2). Potrace's ½ px box cannot do that |
| Corner detection (`alphamax`) | §2.3.3: per-vertex α from the unit-square construction; corner when α > αmax (default 1). 0 gives the polygon; above 4/3, no corners | `contour-corners.ts:82-125` (ADR-439). Smoothness sets a rounding-cost threshold 2 tan 22.5° · tan(90° · s / (4/3)) px. Candidates are lattice turns, pixel features and leg corners | Better apex placement on clean corners (mean gap 0.29 against 0.60 px) and far more corners kept at 200 px. More false corners and larger turn errors on glyphs |
| Curve optimisation (`opttolerance`) | §2.4: join consecutive Bézier pieces when one curve stays within ε = 0.2 of them; shortest path for the fewest segments | `compact-curve-fit.ts:98-125` (ADR-530). Fewest cubic or line segments within an orthogonal tolerance of 0.25 px × the Optimize scale (`contour-trace.ts:118`), by a Plass–Stone shortest path over candidate joints. A piece no cubic fits falls back to its chord (`compact-curve-fit.ts:438-453`) | Same aim. But KerfDesk fits the chain itself, and Potrace fits an already straightened polygon. So a 0.25 px tolerance follows any ripple larger than that, which the 2× enlargement of a binary staircase has (Q4-P2-1) |
| (no analogue) Scale plan | — | `trace-upscale-policy.ts:50-82`. 2–3× bilinear enlargement when the longest edge is under 100 px (`auto-upscale.ts:53, 96-116`), strokes are thin (`:40, 80-94`) or detail is thin (`trace-upscale-policy.ts:66`) | The main source of KerfDesk's losses (Q4-P2-1) |

## Findings

### Q4-P1-1 — On a pure black-and-white image, Smooth sets its automatic cut at luma 1, and the small-mark test then deletes every ink mark of 3–11 px², lone 3×3 dots included; Line Art and Potrace keep them; no warning

- **Where:**
  - The cut:
    - `src/core/trace/preprocess.ts:256-276`: Otsu keeps the first maximum. On a two-value
      histogram every cut from 0 to 254 scores the same, so bestT = 0 and the cut is
      `min(255, 0 + 1)` = 1.
    - `src/core/trace/background-flatten.ts:125-137` and `trace-image.ts:211-235`: that cut becomes
      the crack field's threshold, which `cleanBinaryMask` passes to the small-mark plan.
  - The test that then fails:
    - `src/core/trace/small-mark-policy.ts:224-231` (`keepInkMark`) runs the tone test first.
    - `:254-260` (`toneIsGenuine`; refuter's line correction, it was cited as `:247-253`): the
      mark must clear the cut by 0.04 × span. With span 255 that is 10.2 levels, and black ink at
      cut 1 clears it by 1.
  - Where it applies:
    - Smooth uses `useOtsuThreshold` and `smallMarkPolicy: 'auto'` (`trace-presets.ts:181, 187`).
    - Smooth is the Pro CNC default (`dialog-parts.tsx:26`).
- **Anchor:**
  - **Contract.** ADR-434 Decision 3c (L78): "Otherwise a mark of 8 px² or more is kept, so a lone
    3x3 dot on clean paper stays." The Auto tooltip (`TraceCheckboxRow.tsx:65`) promises to "keep
    drawn dots". Smooth's own description (`dialog-parts.tsx:35-36`) says it removes isolated
    noise dots "when the image has many of them".
  - **Twin.** On the same pixels, Line Art (fixed cut 128) and Smooth with a manual cut of 128 both
    keep every dot.
  - **Ground truth.** Potrace 1.16 `-t 2` keeps them.
- **Scenario:**
  - **Input.** A two-level image: a 1-bit PNG, BMP or TIFF scan, or any PBM through the CLI.
  - **Route.** It traces natively: 100 px or more, with no thin-stroke or thin-detail trigger.
  - **Result.** Smooth erases every dot, full stop and small mark between 3 and 11 px².
  - **No recovery.** The rest of the art still traces, so the zero-paths retry
    (`relaxAggressivePreprocessing`) never runs, and no notice names the loss.
  - **On the 2× route** the bilinear enlargement adds grey levels, Otsu cuts mid-range, and the dots
    survive. So the same art loses or keeps its dots depending on the route.
- **Evidence:** REPRO.
  - **Synthetic.** 120 × 80, a 40 × 40 square plus six 3×3 dots:
    - Smooth keeps 0 / 6 for every gap from 2 to 16 px.
    - Smooth with Cutoff 0 / Threshold 128 keeps 6 / 6, and so does Line Art.
    - Potrace keeps 6 / 6 (7 subpaths).
  - **CLI.** `scripts/trace-cli.mjs -p Smooth dots-square.pbm` writes 1 subpath, the square only.
    `-p "Line Art"` writes 7.
  - **The 2× route.** Dots alone: Smooth keeps 6 / 6 on its 2× route (debug probe: `pixelScale` 2).
    The same image forced native traces nothing at all.
- **Refuter: CONFIRMED (REPRO and a twin). Severity P1 kept.**
  - **What would make it false:** the dialog not taking this path; the dots being removed by
    design; or a warning that reaches the operator. None holds.
  - **The cut.** `otsuSeparation` on a 0/255 source returns threshold 1 (separability 1).
  - **The repro.** The refuter's own 160 × 110 image: a 50 × 50 square, eight 3 × 3 dots at
    gaps of 4–70 px, and marks of 6, 8, 9 and 12 px². It goes through `traceImageToColoredPaths`
    with `TRACE_PRESETS.Smooth`, the call the dialog worker makes with no frozen options.
    - Smooth keeps none of the 3–11 px² marks: 2 subpaths, the square and the 12 px² mark.
    - Line Art, and Smooth with Cutoff 0 / Threshold 128, keep all eight 3 × 3 dots.
    - Smooth with Remove ink specks 0, and Sharp, keep everything.
    - Potrace `-t 2` keeps all 12 components.
    - CLI: `-p Smooth` writes 2 subpaths, `-p "Line Art"` writes 10.
    - The same loss occurs on two-level 40 / 230 and 20 / 200 images.
  - **Twin.** The app's own frozen decision, `resolveFrozenTraceSourceOptions` (ADR-435, Region
    Enhance), centres the cut for this image at 128. Its helper's comment
    (`trace-source-decisions.ts`, `sourceOtsuThreshold`) says a clean black-on-white image "cuts at
    128, not 1". Smooth traced with those options keeps the dots (10 subpaths). So Region Enhance
    and the dialog judge the same pixels differently.
  - **Reach.** Smooth is the Pro CNC default (`use-trace-preset.ts:17-23`,
    `JigTraceControls.tsx:34`) and a Pro choice on a laser.
  - **No warning.** The only text is "Band in use: Cutoff 0, Threshold 0, set from this image"
    (`TraceDetectionControls.tsx:93-96`, from `automaticBandThreshold(1)`). It names the cut, not
    the lost marks. The preview is the output itself, not a warning: compare METHOD §3's
    2026-10-27 clarification, "Frame is not a warning".
  - **ADR.** ADR-434 Decision 3c promises the lone 3 × 3 dot. No amendment carves out two-level
    sources.
  - **Novelty.** No earlier audit names it, and no open PR touches trace code (only #1478 is
    open).
  - **Not tested:** a transparent PNG, which takes the alpha-mask path with no grey field.
- **Fix direction:**
  - Give a two-level histogram the midpoint cut, (low + high) / 2.
  - Or treat a source whose luma has only two values as carrying no grey evidence: field `null` for
    the small-mark classifier, so rules 1 and 3b–d apply, as ADR-434 already does for alpha masks.
  - Pin it with a Smooth test of lone 3×3 dots beside a large shape on a 0/255 source.

### Q4-P2-1 — Line Art and Smooth trace small images and thin-featured images on a 2–3× bilinear enlargement whose pixel staircase the fit follows: bumpy circles, wavy straight edges, from 2.5× (real logos) to over 10× (small shapes) Potrace's segments, about 10× slower

- **Where:**
  - The triggers:
    - `src/core/trace/auto-upscale.ts:53`: `SMALL_SOURCE_EDGE_PX = 100`.
    - `:96-100`: `shouldUpscaleSmallSource` makes every source under 100 px a candidate.
    - `:107-116`: the factor is 2–3.
    - `:40, 80-94`: the thin-stroke trigger.
    - `trace-upscale-policy.ts:66-69`: thin detail gives 2× on any image within budget.
    - `trace-presets.ts:54-59` (Line Art) and `:190-195` (Smooth) turn all three on.
  - Why the staircase survives:
    - `contour-boundary.ts:138`: only saturated steps stay at the crack midpoint. The enlargement's
      steps are not saturated, so they interpolate.
    - `contour-trace.ts:339`: a loop with 30% or more interpolated cracks counts as "measured".
    - `:350, :410`: a measured loop gets no denoise.
    - `:430-439`: it is fitted straight through the chain at `FIT_TOLERANCE_PX` 0.25 (`:118`).
- **Anchor:**
  - **Twin.** The same pixels traced natively.
    - Circle, d = 32, on canvases of 48, 96, 99, 100, 160 and 300 px:

      | Canvas | Line Art |
      |---|---|
      | 48 px | 46 cubics + 1 line, 40 inflections |
      | 96 px | 28 cubics + 4 lines, 22 inflections |
      | 99 px | 33 cubics, 24 inflections |
      | 100, 160, 300 px | **6 cubics, 0 inflections**, mean error 0.127 px |

    - Circle, d = 64: 67 cubics + 3 lines and 62 inflections on a 96 px canvas; 7 cubics and 0 on a
      100 px canvas.
  - **Contract** (code, not ADR text):
    - The small-source trigger's own comment (`auto-upscale.ts:42-52`) says it exists so small
      letters do not facet into polygonal chords.
    - Since ADR-530 the native fit does not facet, and the route now adds what it was meant to
      remove.
  - **Contract** (ADR text):
    - ADR-530's Known gaps (L236) record only the hairline case: "Binary 30 and 60 degree hairlines
      on the 2x route are measured as the bilinear enlargement of a staircase".
    - It lists "a staircase prefilter for binary sources on the 2x route" as not part of the
      decision (L273).
  - **Ground truth.** Potrace on the same bitmaps (table below).
- **Scenario:**
  - **The inputs.** An ordinary user traces a small icon or logo (under 100 px, typically scaled up
    afterwards), or line art with thin strokes (every Arch House crop takes the 2× route).
  - **The output.**
    - Circles come out as rounded polygons with a bump at every pixel step.
    - Diagonal straight edges ripple.
    - Letters gain dozens of inflections.
    - See `out/crop-circle@32-LineArt-6-4.png`, `crop-Roboto-S@48-LineArt-0-0.png`,
      `img/square-rot17@64.overlay.png` and `crop-real-arch-filled-text-Line-Art-0-20.png`.
  - **The size of the bumps.** The ripple is about 0.25–0.35 source px. A 48 px icon placed 30 mm
    wide is 0.6 mm per pixel, so the bumps are about 0.2 mm.
  - **Cost.** More nodes to edit and burn, and about 3× the trace time.
- **Evidence:** REPRO.

  | Case | Line Art | Potrace | Line Art native |
  |---|---|---|---|
  | circle d = 32 (48 px canvas) | 46c + 1l, 40 inflections, excess turn 2,309° | 4c, 0, 0° | 6c, 0, 0° |
  | square turned 17°, 64 px | 143c + 1l, 142 inflections | 5c + 2l, 0 | 4 lines, mean error 0.008 px |
  | Roboto S, 48 px | 77c, 58 inflections (truth 3) | 17c, 4 | 17c + 1l, 8 |
  | stroke 2 px × 200 px, 300 px canvas | 160c + 43l, 186 inflections | 3c | 3c + 2l |
  | arch-filled-text crop, 512 × 260 | 862c + 66l, 19.6 inflections / 100 px, 148–646 ms | 105c + 54l, 0.83, 42 ms | 86c + 78l, 1.76, 63–225 ms |
  | 7 real crops in total | 22,207 segments, 18.3 inflections / 100 px, median 455 ms | 8,762, 1.9, 47 ms | 14,855, 3.9, 147 ms |

  - **Route.** The debug probe shows `pixelScale` 2 or 3 and "measured" loops on every one of
    these.
  - **Side effect.** Two touching 16 px squares on a 48 px canvas lose all 8 corners (apex gap
    0.27 px), while a lone 16 px square stays exact.
  - **Trade-off.** Native alone is not the fix: it thins hairlines.
    - stress-strokes IoU: 0.939 shipped against 0.857 native.
    - stress-spiral: native keeps 125 outer rings against 236.
    - So the enlargement earns its place for topology and thin detail.
  - **Partly KNOWN.** ADR-530 Known gaps (hairlines). The scope is new: every binary source under
    100 px, every shape in a thin-detail image, and the 99/100 px cliff.
- **Refuter: CONFIRMED (REPRO). Severity P2 kept.**
  - **The cliff.** The refuter's circle, d = 32, through the real entry:

    | Canvas | Line Art | Smooth |
    |---|---|---|
    | 48 px | 46c + 1l, 40 inflections | 47c, 40 |
    | 96 px | 28c + 4l, 22 | 44c, 38 |
    | 99 px | 33c, 24 | 44c + 1l, 38 |
    | 100 and 160 px | **6c, 0**, mean error 0.127 px | 6c, 0 |

    - For d = 64, Line Art gives 67c + 3l and 62 inflections at 96 px, 64c + 4l and 60 at 99 px,
      and 7c and 0 at 100 px.
    - The cause is `auto-upscale.ts:98`: `max(width, height) >= 100` returns native.
  - **Ripple.** Short-wave radial ripple, peak to peak, on the 48 px canvas:
    - 0.49 px (rms 0.125) on the 2× route;
    - 0.022 px native;
    - 0.016 px for Potrace.
  - **Table rows reproduced:**
    - square-rot17@64: 143c + 1l, 142 inflections; Potrace 5c + 2l.
    - Roboto S@48: 77c, 58 inflections; Potrace 17c, 4.
    - Real crop `arch-house-filled-reference.png` (30, 730, 512, 260): 862c + 66l, against
      Potrace's 105c + 54l and native's 86c + 78l.
  - **ADR-530 quotes are correct.** Known gaps names binary hairlines on the 2× route. "Not part of
    this decision" names "a staircase prefilter for binary sources on the 2x route". The mechanism
    is therefore recorded, but only hairlines were measured, so "partly KNOWN" is right.
  - **Why P2, not P1.**
    - The boundary error matches Potrace's: 0.190 against 0.194 px mean on the 48 px circle.
    - Position and scale are not wrong, and no shape is lost.
    - The defect is visible wobble and node count, which is the AREAS P2 example.
- **Fix direction:**
  - **Keep the enlargement for topology, not as a measurement.** Decide "measured" on the *source*
    field: a two-level source stays binary even on the 2× grid, so its loops keep the binary tail
    and its denoise.
  - **Or straighten first.** Run a staircase-aware straightening before the fit (ADR-530's own
    follow-up). One published model is Selinger §2.2.1: a run is straight when a line passes within
    ½ px max-distance of every lattice point. That can be applied to the source staircase, in
    KerfDesk's own code, before mapping to the working grid.
  - **Retire the small-source trigger** now that native traces do not facet.
  - **Gate it** with Q4-P3-2's instrument.

### Q4-P2-2 — Corner apexes stand up to 3.4 px off the true outline, on paper, at serifs and slanted terminals, and are joined by straight chords; Potrace puts no sharp node 1 px off

- **Where:**
  - `src/core/trace/contour-corner-legs.ts:38-39, 209-214`.
    - A binary apex is accepted when it is within (0.9 + 0.5 / sin(interior/2)) × scale px of the
      *chain*. That is 2.8 px at 30° interior and 3.8 px at 20°.
    - Nothing checks it against the ink.
  - `contour-corners.ts:90-125` selects these apexes.
  - `compact-curve-fit.ts:438-453` (`emit`; the header at `:26-29` says these chords may kink): a
    span that no cubic through its joint tangents fits becomes its straight chord. That is the
    straight segment between misplaced apexes.
- **Anchor:**
  - **Ground truth.**
    - Potrace on the same 15 glyph bitmaps puts 0 sharp nodes 1 px or more off the true outline.
    - Selinger §2.3.1 bounds every adjusted vertex to the unit square around its path vertex, at
      most ½ px max-distance.
  - **Contract:**
    - ADR-439 Decision 3 sets the binary allowance (L61: "binary loops 0.9 + 0.5 / sin").
    - Its Follow-ups record overshoot only as "A 2 px-cell L sprite's apexes overshoot by 0.8 px at
      every s" (L186).
    - `contour-glyph-fidelity.test.ts:136-139` asserts "no apex spikes", at most 0.8 px. But it uses
      synthetic polygon glyphs through the contour backend only (Q4-P3-2).
  - **Partly KNOWN:** ADR-530 lists the corner dial's apex regressions as not part of its decision
    (L272-273).
- **Scenario:** Lettering in a logo traced with Line Art.
  - Serif tips and slanted terminals grow thin spikes 1–3.4 px long, into the paper.
  - A `g` descender becomes a polygon whose chords cut into the stroke
    (`out/crop-Roboto-g@96-LineArt-8-50.png`, `out/img/Tinos-R@24.overlay.png`).
  - At 1 mm per source pixel, a 48 px letter burned about 30 mm tall, the spike is about 3 mm.
- **Evidence:** REPRO.
  - **Spike count** (sharp nodes turning ≥ 90° that lie ≥ 1 px off the true outline):

    | Tracer | Spikes | Glyph images (of 15) | Farthest |
    |---|---|---|---|
    | Line Art | 20 | 8 | 3.37 px |
    | Smooth | 5 | 1 | 2.99 px |
    | Sharp | 29 (pixel features) | 12 | 1.95 px |
    | Potrace | 0 | 0 | — |

  - **Tinos R.**
    - 24 px: nodes turning 156–174° at (3.1, 22.0), (3.0, 5.9), (15.9, 22.0) and (23.6, 22.1),
      3.3 px off.
    - 48 px: a 156° node at (3.95, 6.90), on a paper pixel, 3.37 px off.
  - **Roboto g, 96 px** (native route, 71 × 100):
    - Hausdorff 2.99 px against Potrace's 1.16: the tail-tip apex is on paper.
    - A −131° reflex node sits 2.77 px inside the ink, and 7 chords make up the bowl.
    - **Not the flattener or the extra corners.** Turning off the straight-run flattener or the
      extra output corners in the debug bundle leaves 2.99 px.
    - Smoothness 1.33 (no corners) gives 5.01 px, a chord across the hook.
  - **Glyph W / T / L for Line Art:** 24 px 3/0/2, 48 px 0/1/4, 96 px 1/0/4.
- **Refuter: CONFIRMED (REPRO). Severity P2 kept.**
  - **What would make it false.** The spikes could be faithful to the bitmap: pixel-centre
    rasterising can widen a thin serif. So the refuter measured each spike's distance to the
    bitmap's own ink squares, as well as to the true outline.

    | Glyph | Line Art spikes | Off the true outline | On paper, from the nearest ink pixel | Potrace |
    |---|---|---|---|---|
    | Tinos R@24 (re-created) | 4 | 1.74–3.33 px | 1.54–3.00 px | 0 |
    | Tinos R@48 (re-created) | 4 | 1.12–3.37 px | 0.71–3.05 px | 0 |
    | Roboto g@96 (re-created) | 4 | 2.11–2.99 px | 2.60 px for the tail tip; the three reflex nodes are inside the ink | 0 |
    | Tinos A@32 (refuter's own) | 4 | 1.62–2.70 px | 1.47–2.90 px | 0 |
    | Tinos M@28 (refuter's own) | 6 | 1.64–2.09 px | 1.33–1.58 px | 0 |

    - Tinos k@40, Tinos v@36, Tinos x@48 and Roboto y@48 had none.
    - Potrace's whole outline stays within 0.81 px of the ink on every one of these images.
    - So the spikes are overshoot into paper, not a rasterising artefact.
  - **Other causes ruled out.** With both straight-run flattener calls removed in memory, g@96
    keeps Hausdorff 2.99 px.
  - **Citations.**
    - Selinger §2.3.1 was re-fetched and the quote holds.
    - ADR-439 L61 ("binary loops 0.9 + 0.5 / sin") and L186 (the 0.8 px overshoot) are quoted
      correctly.
  - **Why P2, not P1.** The letter keeps its position, scale and topology, and the preview shows
    the spikes. They are a visible fidelity defect against the reference.
- **Fix direction:**
  - Bound an apex by the ink it claims. A binary apex that lies on a paper pixel, or more than about
    0.71 px (half a pixel diagonal) outside the source staircase, should be clamped or dropped.
    That is KerfDesk's analogue of §2.3.1's unit-square box.
  - Split a span rather than fall back to a chord whose deviation from the chain exceeds the
    tolerance.

### Q4-P2-3 (P1, raised by the refuter) — Line Art's automatic small-mark policy removes i-dots and full stops from ordinary small text; Potrace keeps them

- **Where:**
  - `src/core/trace/small-mark-policy.ts:224-238` (`keepInkMark`: tone test, then bridged, dust
    tiles, isolated ≥ 8 px², and finally like-mark support against the nearest stroke).
  - `small-mark-neighbourhood.ts` (support and debris).
  - `trace-presets.ts:50`: Line Art, the Free default.
- **Anchor:**
  - **Contract:**
    - ADR-434 Decision 3d (L80-81): "Stipple, dotted rows and small text pass".
    - The Auto tooltip (`TraceCheckboxRow.tsx:65`): "keep drawn dots".
  - **Ground truth.** Potrace keeps every one of these marks (they are all over 2 px²).
  - **Partly KNOWN.** ADR-434 Measurements (L124) record "text-small missed, clean / scan" as
    10 / 35 against Potrace's 0 / 27, and Consequences (L158) accept that "The dust veto costs
    genuine detail". Neither says the misses are i-dots and full stops.
- **Scenario:**
  - A logo line or caption, "mini quiz. jig, ii. lit.", in Roboto at 20–28 px, as ordinary
    anti-aliased text, traced with Line Art.
  - Most tittles and full stops vanish. The preview shows it only if the operator looks for them.
  - Setting "Remove ink specks" to 0 restores them all, which proves the policy removes them.
- **Evidence:** REPRO (`idots-aa.mjs`, `idots.mjs`).

  | Rendering | Small marks (< 12 px²) | Line Art keeps | Sharp | Line Art, Remove ink specks 0 | Potrace |
  |---|---|---|---|---|---|
  | Anti-aliased, 20 px | 12 | 3 | 12 | 12 | — (needs a bilevel input) |
  | Anti-aliased, 24 px | 11 | 8 | 11 | 11 | — |
  | Anti-aliased, 28 px (marks 7–9 px²) | 11 | 2 | 11 | 11 | — |
  | 1-bit, 24 px | 12 | 7 | 12 | — | 12 |

  On the 1-bit 24 px render, Line Art loses the dot of `j`, one `i` dot and three of the four full
  stops.
- **Severity note:**
  - Under this area's rule, a lost shape could read as P1. It is kept at P2 because ADR-434 accepts
    genuine-detail loss as the price of its dust and halo rules.
  - The breach is of the Decision's own "small text pass" claim and of the tooltip.
  - The refuter may weigh this differently.
- **Refuter: CONFIRMED (REPRO). Severity raised P2 → P1.**
  - **What would make it false or P2:**
    - the marks being removed by a trade-off ADR-434 accepts;
    - the loss being a renderer artefact;
    - a warning that reaches the operator.
  - **The repro.** The refuter's own render: Roboto, "mini quiz. jig, ii. lit.", 8 × 8 coverage
    samples per pixel, linear luma.

    | Render | Small marks (< 12 px²) | Line Art keeps | Sharp, and Line Art with Remove ink specks 0 | Potrace |
    |---|---|---|---|---|
    | Anti-aliased, 20 px | 13 | 4 | 13 | — |
    | Anti-aliased, 24 px | 12 | 9 | 12 | — |
    | Anti-aliased, 28 px (marks 7–8 px²) | 11 | **0** | 11 | — |
    | Anti-aliased, 32 px (marks 8–10 px²) | 11 | 11 | 11 | — |
    | 1-bit, 24 px | 12 | 9 (Smooth also 9) | — | 12 |

    The auditor's counts (3 / 12, 8 / 11, 2 / 11, and 7 / 12 at 1 bit) differ in detail because
    the renderer differs. The direction holds.
  - **Mechanism: not the trade-off ADR-434 accepts.**
    - Consequences (L158) accept the dust veto's losses "wherever a drawing has hard sub-floor or
      lone specks nearby". Every mask here has zero sub-floor specks.
    - The word "lit" alone at 28 px, with no other small mark, still loses its 8 px² tittle on
      the shipped 3× small-source route. Forced native, it keeps the tittle, because 3c's 8 px²
      keep applies there. So the 3× re-threshold measures the dot under 8 source px².
    - A lone "i" (7 px² tittle) loses its dot on both routes.
    - What removes them is rule 3d: a mark under 8 source px² whose nearest neighbour is a stroke
      (here its own stem) is treated as stroke-halo scatter.
    - ADR-434 3d itself says "small text pass".
    - The Measurements row "text-small missed 10 / 35" records a count. It is not a decision that
      tittles may go.
  - **Why P1.**
    - The output is wrong, and nothing warns the operator: "lit." traces as a dotless "lit" with
      no full stop. Under §3 a P1 can be lowered only by showing the output is not wrong, or that
      a clear warning reaches the operator. The preview is the output, not a warning.
    - It is reachable today with the Free default preset on ordinary 20–28 px text, and §3 has no
      reach clause.
    - It is the same class as Q4-P1-1: genuine 3–11 px² marks deleted with no warning.
  - **Note for the coordinator.** Both P1s rest on the "loses or merges shapes" clause of the brief
    given to the refuter, or on "differs from what the app … promises" (the Auto tooltip: "keep
    drawn dots"). AREAS.md's P1 text lists only tone, position and scale. If the coordinator reads
    AREAS.md literally, Q4-P1-1 and this finding should move together.
- **Fix direction:**
  - Recognise tittle and full-stop geometry: a compact, full-contrast mark separated from a stroke
    end by a paper gap, with no debris in its tiles.
  - Or require debris evidence before the stroke-halo rule removes a mark of 4 px² or more.
  - Or, at the least, make ADR-434 3d and the tooltip say that small dots beside letters are
    removed.

### Q4-P3-1 — Sharp follows the pixel staircase on large curves and turned straight edges

- **Where:** `trace-presets.ts:219` (Smoothness 0.55, so `flattenStrengthFromSmoothness` returns 0,
  `contour-trace.ts:143-159`), and the binary tail `contour-trace.ts:450-506`.
- **Anchor:** Ground truth. Potrace on the same bitmap.
- **Evidence:** REPRO.

  | Shape | Sharp | Potrace |
  |---|---|---|
  | circle, 200 px | 82c + 9l, 68 inflections, 1,418° excess turning | 10c, 0 |
  | square turned 17°, 200 px | 78c + 10l, 104 inflections | 4c + 2l |
  | ellipse, 200 px | 63c + 10l | 9c |

  - The ripple is about 0.15 px (`out/crop-circle@200-Sharp-150-48.png`).
  - Sharp is the pixel-fidelity preset (ADR-439 turns its flattener off), and it wins 40 of 79
    cases overall, so this is an improvement, not a defect.
- **Refuter: CONFIRMED (REPRO). P3 kept.**
  - Sharp on the refuter's circle@200 gives 82c + 9l, 68 inflections and 1,425° excess turning;
    Potrace gives 10c.
  - Sharp on square-rot17@200 gives 78c + 10l and 104 inflections; Potrace gives 4c + 2l.
  - Sharp wins 13 / 4 / 3 on the 20-case subset, so an improvement rating is right.
- **Fix direction:** After the corners and pixel features are decided, fit the feature-free
  sections between them with the binary tail's staircase smoothing.

### Q4-P3-2 — The tracer's quality gates bypass the scale plan the app uses

- **Where:**
  - These gates call `traceImageToContourColoredPaths` directly:
    - `src/core/trace/contour-glyph-fidelity.test.ts:14` (a 64 px image);
    - `contour-roundness.test.ts:13-14`;
    - `contour-straightness.test.ts:13`.
  - The app traces a 64 px image on the 3× small-source route. None of them measures it.
  - The perceptual arch-house gates (`src/__fixtures__/perceptual/arch-house-*.test.ts`) score IoU
    against the bilevel input. That rewards following the staircase: shipped scores 0.9425 against
    native 0.9064 and Potrace 0.9084.
  - No gate counts inflections or segments through `traceImageToColoredPaths`. No gate uses a real
    font glyph.
- **Anchor:** Contract. METHOD L7: a test must assert the behaviour that ships.
- **Evidence:** READ, plus the REPRO in Q4-P2-1 (the 99/100 px cliff).
- **Refuter: CONFIRMED (READ plus REPRO). P3 kept.**
  - All three gates import `traceImageToContourColoredPaths`: `contour-glyph-fidelity.test.ts:14`,
    `contour-roundness.test.ts:14` and `contour-straightness.test.ts:13`.
  - Through the app, a 64 px fixture takes `computeUpscaleFactor` = ceil(180 / 64) = 3.
  - The only harness that measures facets through `traceImageToColoredPaths` is
    `src/__fixtures__/perceptual/_small-letter-facet.test.ts`. It is `skipIf(!RUN_TRACE_AUDIT)` and
    reads polylines.
  - The refuter's 99 / 100 px cliff shows what an entry-level gate would catch.
- **Fix direction:**
  - Run the roundness, straightness and glyph instruments through `traceImageToColoredPaths` on
    canvases either side of 100 px.
  - Add a smoothness metric (excess turning or inflections against the analytic truth) and a
    real-font glyph set.

### Q4-P3-3 — Line Art's straight-run flattener turns gentle glyph curves into chords on the native route

- **Where:**
  - `contour-trace.ts:463-485`: two `flattenStraightRuns` passes on loops with corners (`:471`, `:477`).
  - The amplitude cap is 1 px at Smoothness 1 (`contour-trace.ts:143-159`).
- **Anchor:** Ground truth. The analytic glyph outline.
- **Evidence:** REPRO, toggled in the debug bundle (native route). Mean boundary error with the
  flattener on and off:

  | Glyph | Flattener on | Flattener off |
  |---|---|---|
  | `g`, 96 px | 0.268 px | 0.221 px |
  | `a`, 96 px (forced native; refuter's correction) | 0.324 px | 0.207 px |
  | `S`, 48 px (forced native) | 0.210 px | 0.162 px |

  Visible as flat spots on bowls. It does not cause the Q4-P2-2 spikes.
- **Refuter: CONFIRMED (REPRO). P3 kept, with one correction.**
  - **Method.** A separate in-memory bundle with both `flattenStraightRuns` calls in the
    refinement replaced by identity (`zz-q4r/build-noflat.mjs`).
  - **Results:**
    - g@96, native as shipped (71 × 100): 0.272 → 0.219 px.
    - a@96, forced native: 0.319 → 0.207 px.
    - S@48, forced native: 0.211 → 0.161 px.
  - **Correction: a@96 is forced native too, like S@48.** The app traces it (70 × 81) on the 3×
    small-source route, where the effect is smaller: 0.258 → 0.236 px.
  - **Counter-example.** On Tinos R@48 as shipped, the flattener helps slightly: 0.273 against
    0.282 px.
- **Fix direction:** Flatten only runs whose ends are both corners and whose curvature does not keep
  one sign along the run. Or cap the amplitude at the staircase's own ½ px for loops whose corners
  were decided on the lattice.

## KNOWN re-observed

Refuter: K1–K4 were re-run with the refuter's own shapes and are CONFIRMED.
- K1: stroke-w1@32, −26.7% against Potrace's −19.9%.
- K2: Smooth's 1 px bar, +37.5% at 32 px and +21.7% at 200 px.
- K3: Smooth's gap, 1.269 / 1.265 / 1.114 px at 16 / 32 / 64 px.
- K4: 301 / 203 / 209 segments against Potrace's 3 / 3 / 6.

K5 (the mixed speckle field) was not re-run and is PLAUSIBLE.

- **Q4-P3-K1 (ADR-403 Remaining gaps, L185): Line Art 1 px diagonal lines on the small-source route
  lose width.**
  - Measured: stroke-w1, 32 px, area −26.7% (Potrace −19.9%); at 16 px +19.6%.
  - ADR text: "Line Art, binary 30°/60° lines at small sizes: 0.826 against Potrace's 0.870."
- **Q4-P3-K2 (ADR-530 Measurements and Known gaps): Smooth's thin binary bars come out fat.**
  - Measured: stroke-w1 area +42.6 / +38.3 / +23.1 / +21.6% at 16 / 32 / 64 / 200 px.
  - The ADR records +10–14% for 1.5–2 px bars at 30°. The 1 px bar is fatter still.
- **Q4-P3-K3 (ADR-439 Follow-ups, L182-183): Smooth places straight edges about 0.13 px inside the
  pixel edge.**
  - Measured: the 1 px gap widens to 1.27 px at 16 and 32 px and to 1.11 px at 64 px.
  - Square corners keep 0.18 px gaps (not re-measured).
- **Q4-P3-K4 (ADR-530 Known gaps, L236-241): binary hairlines on the 2× route follow the
  staircase.**
  - Measured at 200 px: stroke-w1 / w2 / w3 come out as 301 / 203 / 209 segments in Line Art, against
    Potrace's 3 / 3 / 6.
  - This is the recorded subset of Q4-P2-1.
- **Q4-P3-K5 (ADR-434 Consequences, L158): the dust veto removes genuine marks near debris.**
  - Measured on the mixed speckle field: Line Art and Smooth keep 0 of 38 specks and dots, including
    all eight 3×3 dots and the 2×2 dots 3 px below the square. Potrace `-t 2` keeps the 22 that are
    larger than 2 px².
  - On clean single-class fields Line Art behaves as ADR-434 says: it keeps lone 3×3 dots and dotted
    rows, and removes lone 2×2 specks.

## Refuted

- **"Potrace merges two touching squares, so KerfDesk wins topology".** Not a defect on either side.
  Potrace's tie rule joins the saddle into one figure-8 path; KerfDesk (ADR-403) keeps two loops.
  Both bound exactly the same ink. Excluded from the topology tally.
- **"Smooth drops dots beside a large shape because of the stroke-halo rule".** Wrong mechanism.
  - Smooth with a manual cut of 128 keeps them at every gap.
  - The dots are 9 px², which is at or above the isolated keep size.
  - The cause is the Otsu cut of 1 (Q4-P1-1).
- **"The g@96 polygon is the topology repair's fallback".** The debug probe shows 0 repair steps and
  no `retainCracks` fallback on either loop. The cause is the apexes and chords (Q4-P2-2).
- **"KerfDesk is more faithful on real art (IoU 0.94 against 0.91)".** The IoU is against the
  thresholded pixels, which a staircase-following outline matches by construction. Native Line Art
  scores 0.906, level with Potrace. It is not a fidelity win, and it is reported as such.
- **"Line Art squares are 0.002 px too big".** True (ADR-439 says so), but 0.0002 mm at 0.1 mm per
  pixel, and the CLI's 0.001 mm grid rounds it away.
- **"The i-dot loss (Q4-P2-3) is the genuine-detail cost ADR-434 accepts" (the auditor's reason
  for rating it P2).** Refuted by the refuter.
  - ADR-434 Consequences accept losses near debris only. The refuter's text masks hold no
    sub-floor speck, and a lone "i" still loses its dot.
  - The rule that removes the dot is 3d, which the ADR says lets "small text pass".
  - The finding stands, now at P1.
- **"Potrace keeps corners better on 200 px triangles".** The reverse: Potrace's αmax = 1 rounds all
  three corners of every 7°-turned 200 px triangle, 30° to 120° (apex gap 1.05–1.75 px). Line Art keeps
  45 of 46 corners at 200 px.

## Verified clean

- **Twins.**
  - **CLI against the core trace.** The CLI's SVG, read at 254 dpi with `--precision 0.000001`,
    matches the core trace's control points within 6.8 × 10⁻⁶ px on circle@32, square-rot17@64 and
    Roboto S@48.
  - **CLI page scale.** It is exact: a 64 px pixel-aligned square at 0.1 mm/px spans 1.6–8.0 mm.
  - **Commit chain** (temporary Vitest `zz-q4-twin.test.ts`):
    - Line Art's trace becomes a `TracedImage`, then goes through `positionTraceOverRasterSource`
      and `conditionTracedImageForMachine` for a laser.
    - Its vertices land in mm exactly where the source raster's own transform puts the same points:
      0 mm, at 0.1 mm/px and at 0.2646 × 0.3 mm/px turned 30°.
    - The only offset from the pixel corners is the trace's own 0.002 px.
    - Laser conditioning keeps the four lines.
- **Topology.**
  - Every KerfDesk preset gets outer and hole counts right on 79 of 79 images: rings, 1–3 px strokes
    at 23°, two bars a pixel apart, two squares touching at a corner.
  - No hole is lost or merged.
  - Real crops lose no input component of 12 px² or more; the smaller losses are the ADR-434 policy
    (`lost.mjs`).
- **Exact shapes.** Pixel-aligned squares trace exactly in every preset and every size.
  `gap-1px` keeps its gap: Line Art 0.996–1.000 px, Sharp exactly 1.000 px.
- **Large native shapes.** Line Art at 200 px:
  - turned square: 1c + 4l, mean error 0.011 px, against Potrace's 0.118 px;
  - triangles: 3–4 lines, mean error 0.02–0.13 px;
  - circle: 9 smooth cubics;
  - corners kept: 45 / 46.
- **ADR-434 on clean fields (Line Art):**
  - lone 3×3 dots kept 8 / 8;
  - dotted rows of 2×2 dots at 5 px pitch kept 12 / 12;
  - lone 2×2 specks removed (as the ADR says);
  - specks under 3 px² removed, matching Potrace `-t 2` on integer areas.
- **Turn policy (ADR-403 against Selinger §2.1.2).** Diagonal one-pixel strokes trace as one outline
  in every preset, as under Potrace's minority default.

## Not verified

- **Other presets.** Edge Detection, Line + fill, Colour layers and Photo shading were not scored.
  Centerline is Q5.
- **Anti-aliased or grey inputs head-to-head.** Potrace needs a bilevel bitmap, and grey sources are
  Q5. Only Q4-P2-3 used anti-aliased text, against KerfDesk's own control.
- **Images over 512 px**, and the finer commit grid above 2048 px (rolling-v2 07-P2-2 is KNOWN).
- **The browser decode and worker path** (`loadImageAsRawData`, `use-trace-worker-client.ts`). The
  commit twin ran from the core trace in jsdom.
- **Burned output.** G1 move counts after compile flattening, and their effect on burn time, are
  Q6. ADR-530 records that compile emits more chords than Potrace for some fixtures.
- **Other Potrace settings.** Only `-t 1` (speckle) was tuned. `-a 0.5` might keep more Potrace
  corners on corner-heavy art.
- **The paper's archive copy.** web.archive.org could not be reached from this machine. The paper is
  pinned by the SHA-256 of the copy fetched from the live URL.

```json
[
  {"id":"Q4-P1-1","severity":"P1","area":"trace-vs-potrace","file":"src/core/trace/small-mark-policy.ts","line":254,"anchor":"Contract: ADR-434 Decision 3c (L78) 'a lone 3x3 dot on clean paper stays', Auto tooltip TraceCheckboxRow.tsx:65 'keep drawn dots'; Twin: Line Art and Smooth with manual cut 128 keep the dots; Ground truth: Potrace 1.16 -t 2 keeps them","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On a pure 0/255 image Smooth's Otsu cut is luma 1 (first maximum, preprocess.ts:256-276), so the ADR-434 tone test (cut margin >= 0.04 x span) rejects every ink mark of 3-11 px2: six lone 3x3 dots beside a 40 px square traced 0/6 (Line Art 6/6, Smooth with cut 128 6/6, Potrace 6/6); CLI -p Smooth on the PBM writes only the square; no notice, and the zero-paths retry does not run"},
  {"id":"Q4-P2-1","severity":"P2","area":"trace-vs-potrace","file":"src/core/trace/auto-upscale.ts","line":53,"anchor":"Twin: same pixels traced natively (circle d=32: 6 cubics on a >=100 px canvas vs 46 cubics / 40 inflections on 48 px; cliff at 99/100 px); Contract: auto-upscale.ts:42-52 comment (small-source upscale exists to stop faceting), ADR-530 Known gaps L236 and Not-part L273; Ground truth: Potrace 4 cubics, 0 inflections","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-530 Known gaps (binary hairlines on the 2x route)","summary":"Line Art and Smooth trace every source under 100 px and every thin-detail image on a 2-3x bilinear enlargement; its unsaturated steps make loops 'measured', so the compact fit at 0.25 px follows the staircase: bumpy circles, wavy turned edges (square 17 deg 64 px: 143 cubics vs Potrace 5c+2l, native 4 lines), letters with ~20x inflections, real crops 22,207 segments vs 8,762 and ~10x Potrace's time"},
  {"id":"Q4-P2-2","severity":"P2","area":"trace-vs-potrace","file":"src/core/trace/contour-corner-legs.ts","line":211,"anchor":"Ground truth: Potrace 0 sharp nodes >= 1 px off the true outline on 15 glyph images; Selinger 2003 s2.3.1 unit-square vertex bound; Contract: ADR-439 Decision 3 binary standoff, Follow-ups L186 (0.8 px overshoot only), contour-glyph-fidelity.test.ts:136-139 'no apex spikes'","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-530 L272-273 lists the corner dial's apex regressions as not part of its decision","summary":"Binary corner apexes are accepted (0.9 + 0.5/sin(interior/2)) px from the chain with no ink check, up to 3.8 px; Line Art puts 20 sharp nodes 1-3.37 px off the true outline on 8 of 15 glyph images (Tinos R serifs, Roboto g tail) and joins them with chords (g@96 Hausdorff 2.99 vs Potrace 1.16)"},
  {"id":"Q4-P2-3","severity":"P1","area":"trace-vs-potrace","file":"src/core/trace/small-mark-policy.ts","line":224,"anchor":"Contract: ADR-434 Decision 3d (L80-81) 'Stipple, dotted rows and small text pass', tooltip 'keep drawn dots'; Ground truth: Potrace keeps all","evidence":"REPRO","verdict":"CONFIRMED (severity raised P2 -> P1 by the refuter: shapes lost with no warning on the Free default; removed by ADR-434 rule 3d, not the dust-veto trade-off ADR-434 accepts)","known":"partly: ADR-434 Measurements L124 (text-small missed 10/35 vs Potrace 0/27), Consequences L158","summary":"Line Art's automatic small-mark policy removes i-dots and full stops from ordinary 20-28 px text (rule 3d: a mark under 8 source px2 whose nearest neighbour is a stroke): refuter's anti-aliased Roboto render keeps 4/13, 9/12, 0/11 small marks at 20/24/28 px (auditor's render 3/12, 8/11, 2/11); Sharp and Remove ink specks 0 keep all; 1-bit 24 px keeps 9/12 (auditor 7/12) vs Potrace 12/12; a lone 'i' at 28 px loses its dot; no sub-floor debris, no warning"},
  {"id":"Q4-P3-1","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/trace-presets.ts","line":219,"anchor":"Ground truth: Potrace on the same bitmap","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Sharp follows the pixel staircase on large curves and turned edges: circle 200 px 82c+9l with 68 inflections vs Potrace 10c; square 17 deg 78c+10l vs 4c+2l (about 0.15 px ripple)"},
  {"id":"Q4-P3-2","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/contour-glyph-fidelity.test.ts","line":14,"anchor":"Contract: METHOD L7 (tests must assert shipped behaviour)","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Roundness, straightness and glyph-fidelity gates call traceImageToContourColoredPaths and bypass the scale plan the app uses (a 64 px fixture ships on the 3x route); no gate measures inflections or segments through traceImageToColoredPaths or uses real font glyphs; arch-house IoU gates reward staircase-following"},
  {"id":"Q4-P3-3","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/contour-trace.ts","line":471,"anchor":"Ground truth: analytic glyph outline","evidence":"REPRO","verdict":"CONFIRMED (a@96 row is forced native; shipped 3x route 0.236 -> 0.258)","known":false,"summary":"The straight-run flattener (1 px at Smoothness 1) turns gentle glyph curves into chords on the native route: mean error g@96 0.221 -> 0.268, a@96 0.207 -> 0.324, S@48 0.162 -> 0.210 px"},
  {"id":"Q4-P3-K1","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/auto-upscale.ts","line":80,"anchor":"ADR-403 Remaining gaps L185","evidence":"REPRO","verdict":"CONFIRMED","known":"ADR-403 Remaining gaps","summary":"Line Art 1 px diagonal strokes on the small-source route lose width: stroke-w1@32 area -26.7% (Potrace -19.9%)"},
  {"id":"Q4-P3-K2","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/contour-trace.ts","line":430,"anchor":"ADR-530 Measurements / Known gaps","evidence":"REPRO","verdict":"CONFIRMED","known":"ADR-530 Known gaps","summary":"Smooth's thin binary bars come out fat: 1 px bar +21.6% to +42.6% area"},
  {"id":"Q4-P3-K3","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/trace-presets.ts","line":181,"anchor":"ADR-439 Follow-ups L182-183","evidence":"REPRO","verdict":"CONFIRMED","known":"ADR-439 Follow-ups","summary":"Smooth places edges ~0.13 px inside the pixel edge: a 1 px gap widens to 1.27 px at 16/32 px"},
  {"id":"Q4-P3-K4","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/contour-trace.ts","line":339,"anchor":"ADR-530 Known gaps L236-241","evidence":"REPRO","verdict":"CONFIRMED","known":"ADR-530 Known gaps","summary":"Binary hairlines on the 2x route follow the staircase: 1/2/3 px bars at 200 px are 301/203/209 segments vs Potrace 3/3/6 (subset of Q4-P2-1)"},
  {"id":"Q4-P3-K5","severity":"P3","area":"trace-vs-potrace","file":"src/core/trace/small-mark-policy.ts","line":233,"anchor":"ADR-434 Consequences L158","evidence":"REPRO","verdict":"PLAUSIBLE","known":"ADR-434 Consequences","summary":"The dust veto removes genuine 3x3 dots near debris: mixed speckle field keeps 0 of 38 marks in Line Art and Smooth vs Potrace 22"}
]
```
