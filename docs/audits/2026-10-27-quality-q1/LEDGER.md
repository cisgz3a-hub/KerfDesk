# Quality audit Q1 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md), with the quality severity and references in [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | Raster tone | 09f7c0087 (refuter 99f570ead) | [Q1-raster-tone.md](Q1-raster-tone.md) | 3 | 0 | 2 (P2-1 raised) | 0 | 1 | 4 |
| Q2 | Raster geometry | 09f7c0087 (raster files unchanged at ef910deb6) | [Q2-raster-geometry.md](Q2-raster-geometry.md) | 5 | 0 | 1 | 1 | 3 | 8 |
| Q3 | Dither algorithms | ef910deb6 (refuter 93334429e, cited files unchanged) | [Q3-dither-algorithms.md](Q3-dither-algorithms.md) | 5 | 0 (P3-4 Jarvis-fallback half refuted: ADR-581) | 0 | 1 | 4 | 6 |
| Q4 | Trace vs Potrace | ef910deb6 (trace core unchanged at 93334429e) | [Q4-trace-vs-potrace.md](Q4-trace-vs-potrace.md) | 7 | 0 | 2 (P2-3 raised) | 2 | 3 | 5 |
| Q5 | Trace real images | 93334429e (trace core; `trace-cli-source.ts` differs, PNG orientation only) | [Q5-trace-real-images.md](Q5-trace-real-images.md) | 7 | 0 | 1 (P2-2 raised) | 2 | 4 | 4 |
| Q6 | Vector burn quality | 93334429e | [Q6-vector-burn-quality.md](Q6-vector-burn-quality.md) | 3 | 0 | 0 | 1 | 2 | 7 |
| **Total** | | | | **30** | **0** | **6** | **7** | **17** | **34** |

## Scorecards (headline metrics per area)

| Area | Metric | KerfDesk | Reference | Verdict |
|---|---|---|---|---|
| Q1 | Brightness → S on a 16-step wedge, `$30` = 1000 / 255 (GRBL, grblHAL, FluidNC) | within 0.033% / 0.196% of full scale | the documented formula (ADR-390, ADR-567) | pass |
| Q1 | Canvas Preview and Photo engraving preview against the emitted S (Grayscale 60/10; Jarvis + gamma) | 0 of 25,600 pixels differ | pixel-exact | pass |
| Q1 | Dose under M4, 8-bit GRBL look-ahead, face at 6000 mm/min | 0.99× | 1.00× (GRBL `laser_mode.md`: M4 keeps energy per length) | pass |
| Q1 | Dose under M3 (GRBL Compatible), same job | face 1.79×, 50% dither row 2.61× | 1.00× | **fails** (Q1-P2-1, P1) |
| Q1 | Grayscale face energy with Dot Width Correction 0.02 / 0.04 mm, against 0 | 0.64 / 0.28 | about 1.0 (trims the ends of the burned line only) | **fails** (Q1-P1-1) |
| Q1 | Dose lost to acceleration and overscan under M4 | at most 5.6%, over the first 0.2 mm of a row | — | pass |
| Q2 | Position of known features at 1:1 (rotations 0/90/180/270, mirrors, four corner origins, fractional placement) | 0.000 px mean and max, 32 of 32 cases | 0 | pass |
| Q2 | Position at a 37° rotation / 37° scan angle / 90° scan angle | max 0.0039 mm (0.039 px); 90° scan 0.000 | ±½ cell (0.05 mm) | pass |
| Q2 | Position when resampled at non-integer ratios (1.37×, 2.5×, 0.73, 2:1) | max 0.31 cell | ±½ cell | pass |
| Q2 | Scale error | 0.00% at 1:1; ±0.04% at 37° | 0 | pass |
| Q2 | Image-to-vector registration (Line rectangle on the image bounds) | ≤ 0.0004 mm | 0 | pass |
| Q2 | Bitmap Preview against emitted G-code (NCC on a 0.01 mm grid) | exact in 50 of 52 scenarios; the other 2 carry a layer scan offset the bitmap leaves out by design | exact twin | pass |
| Q2 | "Use original pixels" (pass-through) turned 5–60° | rows 1.08–1.41× apart; 51–85% of source pixels used (as low as 36% at exactly 45°); a 50% grey burns 0.353–0.462 | 1.00×, 100%, 0.500 (an image turned to match the scan angle burns 0.500) | **fails** (Q2-P1-1) |
| Q2 | "Engrave will be softer … lower lines/mm" warning on a 1:1 or denser source turned 37° / 45° | fires; following its advice lowers the burn match 0.972 → 0.943 (10 px/mm, 37°) | silent | **fails** (Q2-P2-1) |
| Q2 | Threshold, one-pixel lines lost between 1.18× and 1.99× source density | 16–51%, no advisory (the advisory starts at exactly 2×) | advisory where lines are lost | P3 (Q2-P3-1) |
| Q3 | Kernel match against the published definitions (Threshold, FS, Jarvis, Stucki, Atkinson, Burkes, Sierra-3/-2/Lite, Ordered) | 0 of 4,194,304 flat-patch pixels differ per mode (equal to a 32-bit-accumulator reference; a 64-bit one differs on 0.17–0.32% of exact-threshold pixels) | DHALF.TXT (pinned), JJN 1976, Bayer 1973 | pass |
| Q3 | Blue Noise | Ostromoukhov 2001 rows verbatim (128 of 128); no tiled mask | ADR-649 | pass |
| Q3 | Tone, error diffusion (all levels, 128 × 128 patch) | MAE 0.0014 (FS, Blue Noise) to 0.0035 (Jarvis); monotone | `1 − L/255` | pass |
| Q3 | Tone, Ordered (Bayer 4 × 4) | 17 levels; MAE 0.0156, max 0.031 | 8 × 8 for 256 levels (DHALF) | P3 (Q3-P3-3) |
| Q3 | Twins: G-code against the canvas Preview data; Photo engraving preview | 0 px differ (12 modes × 7 images); 25,600 of 25,600 | exact | pass |
| Q3 | Simulated burn, mean eye-weighted SSIM (face, astronaut, gradient, grey chart) | Blue Noise 0.966 > Sierra Lite 0.965 > FS (default) 0.955 > Stucki / Jarvis / Ordered (within 0.006 of each other) > Atkinson 0.872 | — | Blue Noise best for photos; FS a good default |
| Q3 | Image Studio Line Screen (Newsprint), default 8 px at 0° | 5 tones (0 / 12.5 / 37.5 / 62.5 / 87.5%); solid black 87.5%; MAE 0.062, max 0.125 (0.25 at 4 px). At 45° / 15°: max 0.009 / 0.0008 | tone tracks ink ("area tracks it exactly", `halftone.ts:63-65`); LightBurn Newsprint "has good tonal range" | **fails** (Q3-P2-1) |
| Q4 | Win / tie / lose against Potrace 1.16 defaults, 79 ground-truth images (shapes at 16/32/64/200 px, letters, ring, speckle), nine metrics | Line Art (default) 27 / 19 / 33; Sharp 40 / 19 / 20; Smooth 27 / 17 / 35; Line Art with supersampling off (reference) 46 / 13 / 20 | Potrace 1.16 `-t 2 -a 1 -O 0.2 -z minority` | **not yet better** overall; the count is sensitive to metric weighting (refuter: 7 metrics move a 20-image subset from 8/3/9 to 9/4/7), the large gaps are not |
| Q4 | Line Art at 200 px | 10 / 3 / 3 | Potrace | **wins** |
| Q4 | Non-axis corners kept sharp at 200 px | 25 of 26 (45 of 46 including pixel-aligned); apex error 0.29 px | 3 of 26 (23 of 46); 0.60 px | **wins** |
| Q4 | Topology (holes, components) | correct on every image | correct | tie |
| Q4 | Small shapes: 32 px circle | 46 cubics, 40 inflections (traced on a 2–3× enlargement) | 4 cubics | **loses** (Q4-P2-1) |
| Q4 | Real logo crops (arch-house) | 2.5× Potrace's segments, about 10× its inflections, about 10× slower | — | **loses** (Q4-P2-1) |
| Q4 | Corner apex off the true outline on letters (Line Art, 15 letter images) | 20 spikes on 8 images, up to 3.4 px; Roboto "g" 96 px max 2.99 px | 0 spikes; max 1.16 px | **loses** (Q4-P2-2) |
| Q4 | Small marks kept: six 3×3 dots on a pure B/W image (Smooth) | 0 of 6 | 6 of 6 | **loses** (Q4-P1-1) |
| Q4 | Small marks kept: i-dots and full stops in 20–28 px text (Line Art) | 4/13, 9/12, 0/11 (refuter render); 7 of 12 on 1-bit 24 px text | all | **loses** (Q4-P2-3, P1) |
| Q4 | Twins: CLI against the core trace; placement in mm | ≤ 6.95 × 10⁻⁶ px; 0 mm | exact | pass |
| Q5 | Win / tie / lose on real degraded images (arch-house, astronaut, logos, text; JPEG, low-res, blur, lighting ramp, grain, grey paper), 27 cases | Smooth vs mkbitmap + Potrace defaults **22 / 3 / 2** (corrected for mkbitmap's fixed quarter-pixel shift; reported 24 / 1 / 2); Line Art vs plain-threshold Potrace 18 / 7 / 2; best vs best 23 / 1 / 3 | mkbitmap 1.16 `-f 4 -s 2 -t 0.45` + Potrace 1.16; plain threshold + Potrace | **wins** on real images |
| Q5 | Refuter's own 12 cases | Line Art vs plain Potrace 10 / 0 / 2; Smooth vs mkbitmap defaults 10 / 0 / 2; Smooth vs mkbitmap with highpass off (`-n -t 0.5`, fairer for solid logos) 8 / 3 / 1, but worst-case edge error 2 / 2 / 8 and lost or merged shapes 1 / 5 / 6 | same | wins on IoU; **loses** on worst-case edges and small marks |
| Q5 | Text IoU after the shift correction | Line Art 0.828, Smooth 0.824 | mkbitmap + Potrace 0.817 | tie |
| Q5 | Centerline (ADR-405) | mean deviation 0.06–0.17 px; every true end found, no stray ends | known stroke geometry | pass |
| Q5 | Colour layers shared edges | overlap ≤ 0.31 px², gaps ≤ 0.13 px² | exact | pass |
| Q5 | Photo shading tone | r 0.980 against the photo | — | pass |
| Q5 | Small marks and counters lost or merged | 15–18 of 27 cases (i-dots, full stops: Q4-P2-3; counters: Q5-P2-1) | — | **loses** |
| Q5 | Line Art colour detail under grain | 8 specks at σ 9 → about 600 at σ 12 (cliff) | — | P3 (Q5-P3-1) |
| Q5 | Speed | about 5–10× slower than Potrace | Potrace | **loses** (KNOWN Q4-P2-1) |
| Q6 | Mean line dose under M4 (traced logo, 3 mm text, 1 mm circles) | 0.985–1.00, with the head at 16–30% of programmed feed | 1.00 (GRBL `laser_mode.md`) | pass |
| Q6 | Serial demand at 115200 baud | peak 130–170 lines/s, 3.2–4.1 kB/s against 11.5 kB/s (≥ 2.8× headroom); no planner starvation | — | pass |
| Q6 | Preview against emitted G-code, 22 scenarios | ≤ 0.0007 mm (≤ 0.011 mm with arcs) | exact twin | pass |
| Q6 | Fill interval, angle, holes | exact (30° within 0.114°); even-odd, the ring's hole gets zero dose | as set | pass |
| Q6 | Fill uniformity | 0.979–1.023 with the default 5 mm overscan; sd 0.0004 with Automatic | flat | pass |
| Q6 | Corner and path-end dose under M3 (Neotronics 4040 Line) | 90° corner 3.43×; logo corners median 3.13× (p90 4.29×); path ends 1.6–5.3×; 3 mm text 1.54× overall; under M4 the same motion stays at 1.19–1.30× | LightBurn 2.0: "stick with the default of Variable Power mode" (M4) | **fails** (Q6-P2-1) |
| Q6 | Fill position against the outline | half an interval off (0.095 mm out, 0.005 mm in at 0.1 mm) | ±½ interval | P3 (Q6-P3-1) |
| Q6 | Job time estimate | cuts +0–7%; Island Fill +66% (stops at every G0/G1 junction, ADR-525) | planner model | P3 (Q6-P3-2) |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Q1-P1-1 | Q1 | **Dot Width Correction trims every Grayscale power change**, not only the ends of the burned line. A dither emits only full power or 0, so the correction meets only beam on/off edges. Grayscale (and Pass-through) gives neighbouring pixels different non-zero S, so each pixel whose S differs from its neighbour burns only its middle, with an S0 gap between pixels. A Grayscale photo at Dot Width 0.02 / 0.04 mm (10 lines/mm) burns 0.64 / 0.28 of the energy the Preview, the Photo engraving preview and Job Review show. The only advisory fires when a one-pixel run vanishes, and a tone-calibration wedge (flat patches, one run per row) loses 0.4%, so calibrating cannot see it. LightBurn 2.0 says the correction works "by shortening the length of engraved scan lines" | **READ**: `rasterPixelRuns` splits a row at every change of exact S (`raster-power-runs.ts:31-44`); `rasterSweepRunsForPixelRun` shortens each S > 0 run at both ends, with S0 between (`:46-70`); `dotWidthWarning` returns null unless the remaining run ≤ the controller grid (`scan-quality-warnings.ts:96-111`). Auditor + refuter REPRO (gradient 0.600 / 0.200, face 0.638 / 0.276, Jarvis 0.785 / 0.570) | fix card proposed |
| Q1-P2-1 (P1) | Q1 | **GRBL Compatible burns images with M3, with no advisory.** On 8-bit GRBL the 15-block look-ahead plans the newest block to stop, so a dithered row of short blocks runs at about 37 mm/s when 100 mm/s is asked for (`$120` = 500 mm/s², KerfDesk's profile default). Constant power then gives a photo 1.79× its intended dose, and a 50% dither row 2.61×; M4 keeps 0.99×. The Preview shows the intended tone. M3 itself is deliberate: ADR-257 keeps this dialect as the fallback for GRBL 1.1e and older, which have no M4. The defect is the missing advice. Size depends on the real acceleration (1.002× at 2500 mm/s²). Raised from P2: a burn darker than the Preview, with no warning | **READ**: `grbl-compatible` sets `rasterPowerMode: 'constant'` (`gcode-dialects.ts:107-123`); `git grep grbl-compatible` in `src/ui`, `src/core/preflight` and `src/core/job` finds tests only, so no advisory names it. **SOURCE**: gnea/grbl `bfb67f0` `laser_mode.md`, `planner.h`, `planner.c`. Auditor + refuter REPRO (independent planner models on the emitted bytes) | fix card proposed |
| Q2-P1-1 | Q2 | **"Use original pixels" (pass-through) on an image turned to a non-quarter angle burns the source pixel count stretched over the rotated bounding box.** Rows land up to 1.41× apart, up to 64% of the source pixels never burn, and a 50% grey burns at 0.353–0.462 (any tone from −63% to +41% at exactly 45°, depending on floating-point placement). The option promises the original pixels and density; nothing warns, and the Preview shows the image. LightBurn: pass-through DPI is "directly tied to the size of the image" (2.0 Image Mode) and "you cannot rotate the image" (2019 docs). The August audit's L3-04 fixed only 90/270°; no ADR accepts the stretched grid (ADR-313 and ADR-492 cover aligned and quarter turns only) | **READ**: for pass-through, `pixelWidth`/`pixelHeight` come from `rasterPassThroughDimensions`, which swaps axes only on quarter turns (`compile-job-raster.ts:166-172,217-230`), while `bounds` is the rotated scan bounding box (`:165`), so `lineIntervalMm = (bounds.maxY - bounds.minY) / pixelHeight` (`:173`) grows with the angle. Auditor + refuter REPRO (64 × 64 checker through the real compile and emit, independent G-code reader) | fix card proposed |
| Q2-P2-1 | Q2 | **Every non-quarter rotated image gets the "engrave will be softer than the canvas preview. Lower lines/mm …" warning**, even when its source is denser than the burn grid: it fires for a 1:1 image turned 5°, 37° or 45°, for 13–14 px/mm sources, and for an image already turned to match the scan. Following the advice makes the burn worse (match 0.972 → 0.943 at 10 px/mm turned 37°; 0.967 → 0.938 at 14 px/mm turned 45°). P2: a misleading instruction on an ordinary action | **READ**: `describeRasterUpsample` sizes the burn grid from the rotated machine bounding box (`rasterBoundsInMachineCoords`) and compares it with the source pixel count (`job-intent-warnings.ts:242-252`), so the bounding box's √2 growth at 45° reads as an upsample. Auditor + refuter REPRO | fix card proposed |
| Q3-P2-1 | Q3 | **Image Studio's "Line Screen (Newsprint)" filter, at its default 8 px pitch and 0° angle, renders only 5 tones** (0, 12.5, 37.5, 62.5, 87.5%): tone error up to 12.5% (25% at a 4 px pitch), and solid black comes out 87.5% black with a white line every pitch, so a photo breaks into 5 bands. The dot Halftone at 0° or 90° is off by up to 8.4%; the same code tracks tone within 1% at 15° and 45°. The dialog preview runs the same code, so it is not P1; it is the filter's default, so not P3. Fix note (refuter): sampling at pixel centres alone still gives 5 levels; 9 levels at 8 px need the line to grow one row at a time (measured 3.1% mean, 6.2% max) | **READ**: at 0°, `v = y` is an integer, so `Math.abs(fractionalCell(v, s))` (`halftone.ts:66-72,86-88`) takes only 0,1,2,3,4,3,2,1 per 8-row period; `offset < (ink * s) / 2` is strict, so at ink 1 the offset-4 row never inks (7 of 8 rows: 87.5%). Default `angle: 0`, pitch 8 (`editor-adjustments.ts:196-206`). Auditor + refuter REPRO through `runAdjustment` / `commitAdjustment` | fix card proposed |
| Q4-P1-1 | Q4 | **Smooth deletes every small drawn mark on a pure black-and-white image.** Its automatic Otsu cut lands at luma 1, so the Auto small-mark tone test rejects every ink mark of 3–11 px², lone 3×3 dots included: six dots beside a square, Smooth keeps 0 of 6; Line Art, Smooth with a manual cut of 128, and Potrace keep 6. The CLI on the same PBM writes only the square. The Auto tooltip promises to "keep drawn dots" and ADR-434 3c keeps a lone 3×3 dot; the dialog shows only "Band in use: Cutoff 0, Threshold 0". The app's own frozen-cut function (ADR-435, Region Enhance) puts the cut at 128 for the same pixels and keeps the dots. Smooth is the Pro CNC default | **READ**: `otsuThreshold` keeps the first maximum (`varBetween > maxVar`, `preprocess.ts:256-276`); on a two-value histogram every cut ties, so `bestT` = 0 and the cut is 1. `keepInkMark` runs `toneIsGenuine` first (`small-mark-policy.ts:224-231`), which needs a margin past the cut of 0.04 × span = 10.2 levels (`:254-260`); black at cut 1 has 1. Smooth: `useOtsuThreshold`, `smallMarkPolicy: 'auto'` (`trace-presets.ts:181,187`). Auditor + refuter REPRO (real trace entry and CLI) | fix card proposed |
| Q4-P2-3 (P1) | Q4 | **Line Art's automatic small-mark policy removes i-dots and full stops from ordinary 20–28 px text.** A lone "i" at 28 px loses its dot. Refuter render: 4 of 13, 9 of 12 and 0 of 11 small marks kept at 20 / 24 / 28 px; auditor: 7 of 12 on 1-bit 24 px text (anti-aliased 28 px: 2 of 11). Potrace keeps all of them. ADR-434 accepts losses only near scanner dust, and its rule 3d itself says "small text pass"; these images have no dust. Line Art is the Free default. Raised from P2 under the trace clarification in AREAS.md (a promised mark lost, no warning) | **READ**: `keepInkMark` (`small-mark-policy.ts:224-238`) removes a mark under `isolatedMinArea` when its like-mark support against the nearest stroke fails; Line Art sets `smallMarkPolicy: 'auto'` (`trace-presets.ts:50`). Auditor + refuter REPRO | fix card proposed |
| Q4-P2-1 | Q4 | **Line Art and Smooth trace small images (under 100 px) and thin-featured images on a 2–3× bilinear enlargement, and the fit follows its pixel staircase.** A 32 px circle becomes 46 cubics with 40 inflections, against Potrace's 4; the same circle on a 100 px canvas gives 6 smooth cubics, so the result jumps at a 99 → 100 px canvas. Real logo crops: 2.5× Potrace's segments, about 10× its inflections, about 10× slower. More nodes burn slower. ADR-530 already records the hairline part | **READ**: `SMALL_SOURCE_EDGE_PX = 100` and `shouldUpscaleSmallSource` (`auto-upscale.ts:53,96-100`); Line Art turns on `supersampleContour`, `autoUpscaleSmallSources` and `upscaleSmallSmoothSources` (`trace-presets.ts:54-59`). The enlargement's steps are interpolated cracks, so the loop counts as "measured" and gets no denoise before the 0.25 px fit (`contour-trace.ts:339,350,410,430-439`). Auditor + refuter REPRO | fix card proposed |
| Q4-P2-2 | Q4 | **Corner apexes stand up to 3.4 px off the true outline** at serifs and slanted terminals, joined by straight chords: Line Art has 20 such spikes on 8 of 15 letter images; Potrace has none 1 px off. A 96 px Roboto "g" reaches 2.99 px off, against Potrace's 1.16 | **READ**: a binary apex is accepted within `(0.9 + 0.5 / sin(interior / 2)) × scale` px of the chain (`contour-corner-legs.ts:36-39,207-214`): 2.8 px at 30°, 3.8 px at 20°. Nothing checks it against the ink. Auditor + refuter REPRO | fix card proposed |
| Q5-P2-2 (P1) | Q5 | **Colour layers on Auto moves a flat-colour logo's black text onto another colour's layer** after an ordinary JPEG (quality 75 and lower), a slight blur or grain: black's share of the flat area falls from 0.633% to 0.115–0.188%, under the 0.2% floor, so the black cluster is dissolved. The text is not lost; it burns at that layer's power: on a pale logo at 41–45% instead of 100%, and on a saturated logo every other layer starts 1.2–1.45× higher (the blue square 69% → 100%). The hint promises "Auto picks the colours the artwork really uses" and "Darker colours start at more power"; nothing warns (the swatches are the output). Colours = 4 keeps the text at 100%. Raised from P2: a tone change against the app's promise, with no warning | **READ**: `keepFlatAreaColours` drops a centre whose flat-area share is under `AUTO_MIN_SHARE = 0.002` (`colour-palette.ts:24,153-181`); a pixel whose neighbours differ by more than `FLAT_DE` counts only `NON_FLAT_WEIGHT = 0.1` (`:19`), so JPEG ringing around thin text removes most of its flat area. Hints at `ColourLayerTraceSettingsControls.tsx:47,224`. Auditor + refuter REPRO | fix card proposed |
| Q5-P2-1 | Q5 | **On slightly blurred or low-resolution small text, Smooth's and Sharp's automatic cut sits far toward the paper** (180 and 191 against a 132 ink/paper midpoint): strokes come out 33–75% too heavy and 3–16 of 22 letter counters close; Potrace keeps them (mkbitmap loses 1 at low-res). Cutting at the ink/paper midpoint keeps them (+2.7% area). The threshold, not the hole fill, is the cause. P2: no ADR, preset text or tooltip promises counters | **READ**: the global Otsu cut (`preprocess.ts:236-276`) thresholds the working raster (`trace-image.ts:217-222,294-300`); Smooth and Sharp set `useOtsuThreshold` (`trace-presets.ts:181,210`). Auditor + refuter REPRO (a manual threshold keeps every counter) | fix card proposed |
| Q5-P2-3 | Q5 | **Mild grain sends Smooth and Sharp onto the uneven-lighting route on a photograph**: on the clean astronaut photo the gate finds 46–47% paper-like cells, just under its 50% floor; grain lifts that to 51–53% and the gate accepts a near-black-to-white "paper" range. The trace drops to IoU 0.70 against the clean photo's (121 → 829 subpaths) while Line Art and plain Potrace stay at 0.97–0.98, and the dialog says "Uneven lighting was evened out before the cut". Whether it flips depends on the noise pattern (σ 1.5 can flip Sharp; σ 2 does not). Smooth runs the gate twice and only one run reports, so the dialog can show a plain threshold while the output changed | **READ**: `flattenAgainstPaper` and its declines `isUniformPaper` / `paperRange` (`background-flatten.ts:143-190,367-380`), called from `trace-image.ts:217-220`; the note at `TraceDetectionControls.tsx:90-91`. Auditor + refuter REPRO | fix card proposed |
| Q6-P2-1 | Q6 | **The Neotronics 4040 burns Line cuts with constant power (M3) and over-burns every corner and path end.** At the default 1500 mm/min and 500 mm/s², 90° corners get 3.43× the line dose, the traced logo's 646 corners a median 3.13× (p90 4.29×), path ends 1.6–5.3×, and 3 mm text 1.54× overall; under M4 the same motion stays at 1.19–1.30×. The 4040 gets the ADR-239 entry runway but no exit runway, never gets arcs, and with homing off (the catalogue default) a live Start skips the entry too, so every contour starts from rest at 3.39–3.88×. Nothing warns: Job Review says only "each contour starts burning from rest". ADR-239 decides an entry only; ADR-257 defers the 4040 to its own hardware pass. P2, not P1: a Line operation shows no tone, and the constant S is what the layer and dialect state. The GRBL Compatible half is counted under Q1-P2-1 (same cause, M3 with no advice) | **READ**: `neotronics-4040-safe` sets `cutPowerMode: 'constant'` (`gcode-dialects.ts:142-145`); `vectorPowerWord` uses it for Line groups unless the operation overrides the power mode (`grbl-power-modes.ts:23-30`); `controllerAcceptsLaserArcs` excludes the 4040 (`laser-arc-moves.ts:28-33`). Auditor + refuter REPRO (independent planner and dose models on the real emitted bytes) | fix card proposed |

## Round summary (2026-10-28)

All six areas were audited, refuted and re-verified. 30 findings were raised; none was refuted. The result is P1 6 / P2 7 / P3 17, with 34 KNOWN items re-observed.

### Does KerfDesk burn exact image quality?

**Yes, wherever the output reaches the controller as the Preview shows it.**
- **Brightness → S:** within 0.2% of full scale.
- **Preview = G-code:** raster 0 of 25,600 pixels differ; vector ≤ 0.0007 mm.
- **Pixel placement:** 0.000 px at 1:1 in every orientation; ≤ 0.004 mm rotated.
- **Dither kernels:** bit-exact against their published definitions.
- **Dose under the default dynamic power (M4):** 0.99 for rasters, 0.985–1.00 for vectors.
- **Fills:** exact interval, angle and holes.

**The gaps, each with a fix card:**
- **Dot Width Correction in Grayscale (Q1-P1-1):** cuts 36–72% of the energy.
- **Constant-power dialects:**
  - GRBL Compatible rasters dose 1.8× (Q1-P2-1, P1).
  - The 4040 over-burns corners and path ends 3–5× (Q6-P2-1).
- **Pass-through on a turned image (Q2-P1-1):** a 50% grey burns at 35–46%.
- **Image Studio Line Screen at 0° (Q3-P2-1):** only 5 tones.

### Are the tracers better than Potrace?

| Comparison | KerfDesk wins / ties / losses | Verdict |
|---|---|---|
| 79 ground-truth shapes and letters: Line Art (default) against Potrace 1.16 | 27 / 19 / 33 | not yet |
| Same set: Sharp | 40 / 19 / 20 | better |
| 27 real degraded images: Smooth against mkbitmap + Potrace | 22 / 3 / 2 | better |
| Same set: Line Art against threshold + Potrace | 18 / 7 / 2 | better |

**KerfDesk already wins on:**
- sharp corners (25 of 26 against 3 of 26);
- topology;
- large shapes;
- robustness to lighting;
- not hollowing solid logos;
- centerline (0.06–0.17 px).

**Where it loses:**
- **Small-image smoothness and node count:** a 32 px circle gets 46 cubics against 4 (Q4-P2-1).
- **Corner spikes on letters:** up to 3.4 px (Q4-P2-2).
- **Lost small marks:**
  - dots (Q4-P1-1);
  - i-dots and full stops (Q4-P2-3, P1);
  - counters (Q5-P2-1).
- **Automatic decisions that flip under mild degradation:**
  - the colour palette (Q5-P2-2, P1);
  - the lighting gate (Q5-P2-3).
- **Speed:** about 5–10× slower.

**Beating Potrace on every preset needs two fix cards to land:** "Trace smoothness: small images and corner spikes" and "Trace auto cut: keep dots, i-dots, counters; lighting gate".

### Against LightBurn's documented behaviour

| Topic | LightBurn | KerfDesk | Finding |
|---|---|---|---|
| Dot Width Correction | trims "the length of engraved scan lines" | trims every Grayscale power change | Q1-P1-1 |
| Pass-through | "you cannot rotate the image" | rotates it, stretching the grid | Q2-P1-1 |
| Newsprint | "has good tonal range" | Line Screen at 0° gives 5 tones | Q3-P2-1 |
| Power mode | "stick with the default of Variable Power mode" | M3 on GRBL Compatible and the 4040 Line output, with no advice | Q1-P2-1, Q6-P2-1 |

Everything else checked matched or exceeded LightBurn's documented behaviour: image modes, overscan, crosshatch, bidirectional scan and the dither list (KerfDesk adds Burkes, three Sierras and Blue Noise).
