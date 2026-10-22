# Rolling audit v2 — Trace (07 `trace`)

- **When:** 2026-10-21 15:00–16:30   **Tree:** origin/main @ `faf5a54f1` (audit worktree HEAD `50321cbe0`; no trace file differs)
- **Scope:** `src/core/trace/**`, `src/ui/trace/**`, `src/ui/trace-cli/**`, plus the trace's own
  commit and placement code it calls (`src/ui/state/scene-mutations.ts` `applyTraceToExisting`,
  `src/ui/state/trace-placement.ts`) and its one twin outside the scope, the jig tracer
  (`src/ui/workspace/registration-jig/jig-trace-import.ts`, ADR-633). Pipeline mapped as:
  decode (`image-loader.ts`, preview cap 2048 px; commit grid `trace-commit-grid.ts`, ADR-409) →
  worker (`use-trace-worker-client.ts` / `trace-worker.ts`) → `traceImageToColoredPaths`
  (invert, scale plan: native / integer or tapered-fractional supersample / dense-colour downscale)
  → lane (contour, edge, centerline, hybrid, photo, colour layers) → canonical curves → region crop or
  enhance → mask clip → machine conditioning (CNC fairing, laser move simplification) →
  `positionTraceOverRasterSource` → `applyTraceToExisting` (one `pushUndo`).
  Governing: ADR-026, ADR-030, ADR-137, ADR-391, ADR-404, ADR-405, ADR-408, ADR-409, ADR-434,
  ADR-438, ADR-454, ADR-461, ADR-477, ADR-531, ADR-633.
- **Lenses run:** L2 (Potrace paper and LightBurn Trace Image page fetched), L3, L4, L6, L7 as
  separate passes; L1 folded into L3 (each ADR clause checked against its twin). L5 skipped: the
  only untrusted input is an image file, whose decode bounds were audited in 2026-10-15 and belong
  to areas 19/20.
- **Counts:** 8 raised → 0 refuted (refuter: 8 confirmed, 0 plausible; P3-3's laser-move half
  refuted and dropped, P2-2's Edge half narrowed) → P1 0 / P2 3 / P3 5 (+ 3 KNOWN).

## Headline

Traced geometry itself is sound: 240 fuzzed traces gave closed, non-self-intersecting,
non-crossing, correctly wound rings, and kerf and Fill compile correctly on them; placement,
cancellation, stale-result ownership and one-step Undo all hold. The defects sit in how pixel
windows meet non-native working grids. (1) The sketch local-mean window is indexed with a
fractional radius on the tapered supersample grid, so **Line + fill with Sketch detection traces
nothing but a stray corner triangle** on 0.75–1.0 MP drawings (Line Art and Smooth survive only
through a restore pass, 4–5x slower). (2) The committed trace's finer grid (ADR-409) keeps the
sketch and Edge Detection windows in grid pixels, so **the committed trace of a large image loses
17–43 % of the ink the preview showed**. (3) The jig tracer drops the Line + fill trace mode, so its
pen strokes land on a Fill operation and never burn.

## Findings

### P2-1 — Sketch detection on a tapered (fractional) supersample grid reads its local mean at fractional array indices; Line + fill then traces nothing
- **Where:** `src/core/trace/trace-image.ts:174` and `:213` (`SKETCH_RADIUS_PX * effectivePixelScale(options)`),
  `:423-442` (`localMean`: `x0 = Math.max(0, x - radius)` etc. index the integral image directly,
  so a fractional radius gives `undefined ?? 0` for every interior pixel), used by
  `sketchTraceToMonochrome` (`:378`) and `sketchCrackField` (`:315`). The fractional factor comes
  from `src/core/trace/trace-work-budget.ts:60-74` via `trace-upscale-policy.ts:73-74`. Line + fill
  has no contour-support restore (`trace-to-paths.ts:180`, `isBinaryContourPreset` excludes
  `hybrid`, `contour-trace.ts:80-88`).
- **Anchor:** Twin — `src/core/trace/local-contrast-mask.ts:75` builds the same local-contrast
  window with `Math.round(options.radiusPx)`; and the trace-image comment at `:186-189` says the
  window must keep its source-pixel size on a supersampled raster. Contract — ADR-438 clause 3 made
  the taper "output-safe" for the outline presets.
- **Scenario:** A Pro user traces a scanned pen drawing of about 900 x 900 to 1000 x 1000 px
  (thin dark strokes, so the thin-stroke 2x supersample is chosen and then tapered to 1.10–1.82x)
  with **Line + fill** and **Detection: Sketch (local contrast)**. The preview and the commit show a
  single filled ~8 px triangle in the image's bottom-right corner; the whole drawing is gone. The
  result holds one path, so the relaxed-settings retry (`traceWithRelaxedRetry`, paths.length === 0)
  does not fire and no notice explains it. The same image at 860 px (exact 2x) traces normally.
  Line Art and Smooth with Sketch (or Faint lines) in their band (1.125–1.5 MP) produce the right
  geometry only because `restoreEnlargedContourSupport` patches the near-empty working mask from the
  native mask, at 4–5x the time.
- **Evidence:** REPRO (temp Vitest, deleted). `prepareTraceForContour` on a 300² line page with
  Line Art + `sketchTrace`: ink pixels 5638 at pixelScale 1, 1.5 and 2, but **196** at 1.7.
  Full `traceImageToColoredPaths`, Line + fill + `sketchTrace`, synthetic drawing (three 2.6 px
  circles and a diagonal, luma 40): n = 860 (factor 2) → 1 fill + 7 stroke paths, 5409 points;
  n = 900 / 960 / 1000 (factors 1.82 / 1.51 / 1.10) → **one `#000000` path, 5 points**, first
  points `(900, 891.78), (900, 900), (891.78, 900)`. A 950² grid page: Sketch → 1 polyline of zero
  length versus 39 strokes without Sketch. Line Art + Sketch on a 1100² page: 14.1 s at factor 1.83
  versus 2.8 s at 1000² (factor 2); Smooth + Sketch 1150²: 8.3 s vs 1.6 s; Line + fill Faint lines
  950²: 6.9 s vs 1.2 s.
- **Refuter:** CONFIRMED, P2 kept. Own repro (synthetic 2 px pen drawing, Line + fill + Detection
  Sketch via `mergeLightBurnTraceSettings`): 840² (2x) and 1050² (native) trace the drawing; 900² /
  950² / 1000² (1.82 / 1.51 / 1.10x) give one 5-point `#000000` corner triangle. `prepareTraceForContour`
  keeps all 6310 ink px at pixelScale 1.25, 1.5, 2, 2.5 (radius 10 / 12 / 16 / 20, whole numbers) and
  196 / 225 at 1.7 / 1.82. The reach is wider than stated: the **default Free Line Art preset** on a
  colour logo (auto-sketch, same `sketchCrackField`) at 1100² / 1150² / 1200² (1.83 / 1.59 / 1.28x)
  adds a spurious closed ~9 px triangle at the bottom-right corner (bbox to (1100, 1100)) and takes
  11.6 s against 2.0 s at 1000²; Line Art + Sketch gets the same triangle, so "right geometry" above
  is not quite right. Severity stays P2: the triangle and the empty trace show in the preview.
- **Fix direction:** Round (or floor and weight) the window radius once, as `local-contrast-mask.ts`
  does, before indexing the integral image; add a regression at a tapered factor for Sketch and
  Faint lines on Line Art, Smooth and Line + fill.

### P2-2 — A committed trace finer than the preview (ADR-409) shrinks the Sketch and Edge Detection windows, so the commit loses ink the preview showed
- **Where:** `src/ui/trace/trace-commit-grid.ts:217-240` (`traceOptionsForCommitGrid` rescales only
  the operator size controls: despeckle, Ignore less than, small-mark area, Minimum line, join gaps,
  Max stroke width), applied at `src/ui/trace/trace-commit-at-grid.ts:117`, in Multi-File Trace
  (`src/ui/commands/multi-file-trace-action.ts:302`) and in the CLI (`src/ui/trace-cli/run-trace-cli.ts:143`).
  The windows scale only with `pixelScale`, which the commit grid never sets:
  `src/core/trace/trace-image.ts:174,213` (sketch / automatic-detail / faint-line window, 8 px) and
  `src/core/trace/edge-input.ts:127` (Edge Detection neighbourhood, 12 px at Detail 60).
- **Anchor:** Twin — preview geometry vs committed geometry for the same settings. Contract —
  ADR-409 says the commit converts settings "so they drop what the preview dropped" and lists only
  Centerline's internal thresholds as a known difference; `trace-image.ts:186-189` records that an
  unscaled sketch window "hollows out strokes wider than the window (recall 0.93 -> 0.66 measured at 2x)".
- **Scenario:** A user imports a 4032 x 3024 phone photo of a drawing (placed at 10 px/mm, so per
  ADR-409 it "always takes the finer path"), chooses Line Art with Detection Sketch (Free) or Edge
  Detection (Pro), checks the preview on the 2048 x 1536 grid and presses Trace. The commit decodes
  about 3600–3900 px wide, where the 17 px and 25 px windows cover roughly half the physical area:
  strokes the preview showed filled are hollowed or thinned in the burned output. The dialog only
  says the commit "can keep detail the preview cannot show".
- **Evidence:** REPRO (temp Vitest, deleted): 1600 x 960 source with 24 px strokes at luma 150;
  preview = `resampleBuffer` to 800 x 480 traced with the dialog options; commit = the full grid
  traced with `traceOptionsForCommitGrid(options, {grid 1600x960, preview 800x480})`, exactly as
  `traceDecoded` does. Signed traced area (preview x4 vs commit): Line Art + Sketch 276112 vs
  **157014 (0.569)**; Edge Detection 295079 vs **244405 (0.828)**. Source ink 302496 px. Both plans
  were native, so no other route differs.
- **Refuter:** CONFIRMED for Sketch, P2 kept; Edge half narrowed. Own repro with the real planner
  (`planTraceCommitGrid`, 3600 x 2700 source at 10 px/mm, 20 px/mm target, 8 GB → commit 3600 x 2700
  native, preview 2048 x 1536), vertical strokes rasterised back and measured per stroke as a share
  of source ink: Line Art + Sketch, dark strokes on 240 paper, 20 px 1.03 preview → **0.78** commit,
  28 px 1.01 → **0.56**, 24 px 1.01 → 0.65. Edge Detection with dark strokes loses nothing (24–80 px
  all 1.00 at commit), so its loss needs pale broad marks: luma-150 strokes 32 px 1.01 → 0.71, 48 px
  0.83 → 0.48. Phone photos always take the finer path (ADR-409), and Sketch is LightBurn's mode for
  "photographs of pages with uneven lighting", so ordinary use hits it; the loss is in the committed
  geometry. (A 3600 x 1200 source's 2048 x 683 preview falls in the contour taper band and hits P2-1.)
- **Fix direction:** Carry the preview-to-commit length ratio into the windowed detectors (sketch,
  automatic detail, faint lines, Edge Detail radius, and probably the pinhole and median windows),
  or trace windowed modes on the preview grid; add a preview/commit parity test for those modes.

### P2-3 — The jig tracer turns Line + fill into a plain filled trace, so its pen strokes land on a Fill operation and are not burned
- **Where:** `src/ui/workspace/registration-jig/jig-trace-import.ts:86-89` (`traceMode` is
  `edge`, `centerline` or else `'filled-contours'`; `'hybrid'` is lost), consumed by
  `jig-image-trace.ts:84-89` → `applyTraceToExisting` → `freshArtworkModeForColor`
  (`src/ui/state/fresh-artwork-mode.ts:12`, only for `traceMode === 'hybrid'`). The jig offers every
  preset through the shared `PresetPicker` (`src/ui/trace/dialog-parts.tsx:107`).
- **Anchor:** Twin — `src/ui/trace/ImportImageDialog.tsx:431-436` maps `hybrid` → `'hybrid'`.
  Contract — ADR-454: Line + fill strokes "burn once down their centre" on a Line operation.
- **Scenario:** In the jig editor (ADR-633) a Pro user traces a pen drawing with Line + fill and
  saves to canvas. Both colours get Fill operations; the open `#0000ff` centre strokes are skipped
  by Fill (open-fill diagnostic) and never burn, while the preview showed them as lines.
- **Evidence:** REPRO (temp Vitest, deleted): `traceImageToColoredPaths` (Line + fill) on a
  120² image with a 3 px line and a solid block → `#000000:1(C) #0000ff:1(O)`; built with the jig
  mapping and committed through `traceJigImage` → trace `traceMode filled-contours`, both artwork
  operations `fill`, `openFillContours(scene)` reports **1** open contour.
- **Refuter:** CONFIRMED, P2 kept. Reachable today: `App.tsx` mounts `RegistrationJigPanel` → Edit jig
  (Pro) → "Trace an image" (`JigEditorSidebar`) with the full `PresetPicker`; both the upload route
  (`importJigArtwork` → `applyFreshImport`) and the replace route use `buildJigTraceObject`. Own repro
  through the real `buildJigTraceObject` and `compileJob`: jig `traceMode filled-contours`, both colours
  → `fill`, groups `fill` only, 1 open-fill contour; the dialog's `hybrid` mapping gives `fill` +
  `line`, groups `fill,cut`. Job Review lists the omitted open Fill contours, but its fix (close them)
  would not burn a pen line either.
- **Fix direction:** Share `traceModeForOptions` with the jig builder (and see P3-3 for the rest of
  the commit path the jig skips).

### P3-1 — Line + fill uses the fractional supersample taper that ADR-438 keeps off centre-line strokes; its strokes drift off centre
- **Where:** `src/core/trace/trace-work-budget.ts:66` excludes only `centerline` and `edge`.
- **Anchor:** Contract — ADR-438 clause 3: the taper is "for the outline presets only"; Centerline
  and Edge "read the position of 1-px strokes from the working grid". Line + fill (ADR-454) draws its
  strokes with the Centerline lane. Twin — Centerline on the same image stays on an integer grid.
- **Scenario:** A 900–1000 px page of 2 px horizontal pen lines traced with Line + fill: strokes
  that should be straight wobble around the true centre.
- **Evidence:** REPRO: 2 px lines every 40 px; mean / max distance of interior stroke points from
  the true centre row: 860² (factor 2) 0 / 0 (straight); 900² (1.82) 0.101 / 0.240 px;
  950² (1.51) 0.289 / 0.433 px; 1000² (1.10) 0.212 / 0.446 px; 1100² (native) 0 / 0. Centerline on
  950² keeps factor 2 and straight strokes.
- **Refuter:** CONFIRMED, P3 kept. ADR-438 (2026-09-25) predates ADR-454 (2026-09-26), and
  `taperedSupersampleFactor` excludes only `centerline` and `edge`. Own repro, 2 px lines every 40 px:
  860² (2x), 1100² (native) and Centerline at 950² (2x) give 2-point straight strokes; Line + fill at
  900² / 950² gives 12350 / 10056 interior points, mean 0.24 / 0.15 px, max 0.30 / 0.31 px off centre,
  and splits the equal strokes into two width groups. 1000² (1.10x) stayed straight on this geometry.
  Sub-pixel, so P3.
- **Fix direction:** Add `hybrid` to the taper exclusion (its budget then steps 2x → native like
  Centerline).

### P3-2 — Optimize 0 still simplifies, though LightBurn defines 0 as no optimization
- **Where:** `src/core/trace/trace-optimize.ts:10-14` (0 → tolerance scale 0.85, floor 0.25);
  `contour-trace.ts:209-211`.
- **Anchor:** Ground truth — LightBurn Trace Image page (docs.lightburnsoftware.com/latest/Reference/TraceImage/):
  "A value of 0 leads to no optimization." KerfDesk presents the control as LightBurn's
  (`lightburn-trace-settings.ts`, ADR-030); ADR-405 records "0.85x at 0" without noting the gap.
- **Scenario:** An operator who sets Optimize 0 to keep every node, as LightBurn's guide says,
  still gets Douglas-Peucker and fit tolerances at 85 % of the default.
- **Evidence:** SOURCE (page above) + READ.
- **Refuter:** CONFIRMED, P3 kept, scenario narrowed. LightBurn page fetched: "A value of 0 leads to no
  optimization." Code: `max(0.25, 1 + (0 − 0.2) · 0.75)` = 0.85. Own repro, Line Art on a 400² star
  ring: 68 curve segments at Optimize 0 and 0.05, 67 at 0.2, 38 at 2, so 0 is in effect the default.
  But "keep every node" over-reads LightBurn: in Potrace the optimal polygon always runs and only the
  joining of Bézier segments is optional (Selinger 2003 §2.4, disabled with `--longcurve`), so the gap
  is that 0 does not turn off KerfDesk's fit-tolerance merging, not that nodes are kept. The Optimize
  tooltip ("Simplify traced paths while preserving shape.") says nothing about 0.
- **Fix direction:** Either make 0 disable node reduction, or say in the tooltip what 0 does.

### P3-3 — The jig tracer skips the rest of the Trace dialog's commit path: colour-layer powers and laser move simplification
- **Where:** `src/ui/workspace/registration-jig/jig-image-trace.ts:84-89` (no `colourLayers` option),
  `jig-trace-import.ts:102-107` (CNC fairing only; no `conditionTracedImageForMachine` for laser).
- **Anchor:** Twin — `src/ui/trace/trace-output-commit.ts:68,176` (`withColourLayerOutput`) and
  `ImportImageDialog.tsx:384`. Contract — ADR-461 (darkness-ordered powers), ADR-391.
- **Scenario:** A Colour layers trace made in the jig burns every colour at the same power; a laser
  jig trace keeps every ~1.5 px vertex as a G1 move.
- **Evidence:** REPRO for powers: three colour bars traced with Colour layers → jig operations
  `p30 / p30 / p30`; the same paths through `applyTraceToExisting` with the dialog's
  `colourLayers` option → `p17.3 / p20.2 / p30`. Laser simplification: READ.
- **Refuter:** CONFIRMED for colour-layer powers, P3 kept; the laser-move half is refuted (see
  Refuted). Own repro: three colour bars traced with Colour layers, built by `buildJigTraceObject`,
  committed as the jig does (`deleteSourceAfterTrace` only) → `fill:30 fill:30 fill:30`; with the
  dialog's `colourLayers` option → `fill:16.1 fill:17 fill:30`. The jig skips
  `conditionTracedImageForMachine` (4976 stored points against 744), but `compileJob` emits the same
  moves either way (Line Art 916, Edge 845, Centerline 143, Colour layers 637, Line + fill 222, Smooth
  1193, Sharp 534 coordinates), because compile flattens the canonical curves itself.
- **Fix direction:** Route the jig commit through the same helper the dialog uses.

### P3-4 — The LightBurn defaults comment cites the Trace Image page for values it does not state
- **Where:** `src/core/trace/lightburn-trace-settings.ts:19-21` ("documented ... Ignore Less Than 2,
  Smoothness 1.0").
- **Anchor:** Ground truth — the current LightBurn Trace Image page states the 0–128 band and
  Optimize 0.2 only; it gives no default for Ignore Less Than or Smoothness. (Potrace's own defaults
  are turdsize 2 and alphamax 1, Selinger 2003 §2.1.3, §2.3.3, so the values are defensible.)
- **Scenario:** Doc drift only; a maintainer checking parity is pointed at a source that does not
  back the claim.
- **Evidence:** SOURCE.
- **Refuter:** CONFIRMED, P3 kept. LightBurn page fetched: it states the 0–128 band and the Optimize
  0.2 default, and gives no default for Ignore Less Than or Smoothness. One correction to the
  parenthesis: Selinger 2003 §2.1.3 names the despeckle parameter `t` (`--turdsize`) but gives no
  default; the turdsize 2 default is Potrace's command-line default, not the paper's. α_max = 1 is in
  §2.3.3.
- **Fix direction:** Cite Potrace's defaults (or the LightBurn app) instead.

### P3-5 — No test covers the windowed detectors on non-native grids
- **Where:** `src/core/trace/trace-work-budget.test.ts` (taper factor only); no test runs
  Sketch / Faint lines / automatic detail at a fractional `pixelScale`, Line + fill inside the taper
  band, or compares preview and commit-grid geometry for Sketch or Edge Detection
  (`trace-commit-at-grid.test.ts` checks Line Art bars and a disc).
- **Anchor:** Contract — METHOD L7; ADR-438 Verification measured the taper on outline presets only.
- **Scenario:** P2-1, P2-2 and P3-1 all pass the current suite.
- **Evidence:** READ (grep of `src/core/trace/*.test.ts` for `pixelScale` fractions and `taper`).
- **Refuter:** CONFIRMED, P3 kept. No test under `src/` passes a fractional `pixelScale`; the
  faint-line tests run `it.each([1, 2])`; no test runs Line + fill inside its 866²–1000² taper band;
  `trace-commit-at-grid.test.ts` has no Sketch or Edge case. The P2-1, P2-2 and P3-1 repros above all
  fail on code the current suite passes.
- **Fix direction:** Add the three regressions named in P2-1, P2-2 and P3-1.

## Known (not raised as new)

- **K-1** ADR-391: laser move simplification is frozen at the commit placement; scaling the trace
  up later enlarges the straight-segment error. Accepted in ADR-391 ("scaling a trace up k times").
- **K-2** ADR-409 Consequences: Centerline's internal pixel thresholds are not converted to the
  commit grid. P2-2 is the same mechanism for the sketch and Edge windows, which ADR-409 does not
  mention.
- **K-3** ADR-477: the headless CLI decoders ignore PNG gAMA/iCCP and JPEG ICC, and trace the
  stored grid above 2048 px; documented as the limit of its parity claim.

## Refuted

Refuter (2026-10-21):
- P3-3's second half, "a laser jig trace keeps every ~1.5 px vertex as a G1 move". The jig does skip
  `conditionTracedImageForMachine` (4976 stored points against 744 on a ring test), but `compileJob`
  emitted identical cut moves for jig and conditioned traces in Line Art, Smooth, Sharp, Edge
  Detection, Centerline, Line + fill and Colour layers: compile flattens each trace's canonical curves
  at the machine tolerance itself. The colour-layer power half of P3-3 stands.

Auditor-dropped candidates (checked and not raised):
- Straight RGBA input traces fully transparent black pixels as ink (64² RGBA 0,0,0,0 → full-frame
  rectangle on Line Art). Not reachable: the browser loader, the CLI
  (`compositeRgbOverWhitePreservingAlpha`) and the jig all composite onto white first.
- Grey ink sits ~0.15 px inside its pixel edge (iso-128 crossing of a 60-vs-255 step); a 3 px line
  traces 2.7 px wide. Deliberate sub-pixel estimator, about 0.012 mm at 0.08 mm pixels.
- Smoothness slider max 1.33 is below 4/3, so the corner threshold is 211 px, not infinite.
  Squares of 40–800 px traced identically at 1.33 and 4/3.
- Retracing a turned JPEG from a pre-ADR-404 project misregisters. ADR-404 Consequences: the old
  luma is the upright photo squashed into the stored grid, and the trace is mapped the same way.
- The vector commit's comment "vector output may follow a moved source" contradicts
  `claimTraceCommitOwner`'s identity check. The check refuses only after Submit; the comment is about
  edits before Submit, which `captureTraceCommitOwner` allows. Consistent.

## Verified clean

- **Geometry (Q1):** temp fuzz of 60 random 40² masks (blobs, rings, 3 % noise, binary and grey
  ink) × Line Art, Smooth, Sharp, Edge Detection, flattened exactly as compile does
  (`compilationPolylines`): 4588 rings, 0 open, 0 self-intersections, 0 ring crossings, 0 winding
  errors (outer and hole signs consistent by depth parity). Topology repair checks the fitted curves
  as well as the samples (`contour-topology.ts`, `CurveContactCache`).
- **Kerf and Fill (Q1):** traced plate/hole/island (Sharp and Line Art) with a 1 mm kerf Line layer
  compiles to widths 82 / 38 / 22 (outer grows, hole shrinks, island grows); Fill compiles one fill
  group. Nesting (`subpathNesting`) is a plain property, so it survives the worker's structured clone.
- **Placement (Q2):** `positionTraceOverRasterSource` maps trace-grid corners (Potrace convention:
  "the corners (and not the centers) of each pixel have integer coordinates") across the bitmap's
  full local bounds and composes its scale, mirror, rotation and translation; algebraically exact
  because both scale terms are diagonal. The canvas draws row 0 at `bounds.minY`
  (`draw-raster.ts:265`). Crop mode re-offsets by the integer crop origin and reports the full grid;
  downscale and upscale routes rescale per axis; raster output and the jig reuse the same helper.
- **Workers and staleness (Q4):** a new request rejects and terminates any in-flight worker;
  Cancel aborts the owning epoch; the inline path checks the epoch cooperatively; late messages from a
  retired worker are ignored. A commit publishes only while the dialog token, project document epoch,
  exact source object and mask object are unchanged (`claimTraceCommitOwner`), rechecked after the
  asynchronous raster build. Preview reuse requires the same `File`, options object, boundary, mode
  and source grid.
- **Boundary inputs (Q5):** 1x1, 3x1, 1x5, 64² black/white/mid-grey/transparent/alpha-1 through all
  eight presets: no throw, no non-finite coordinate; all-white gives no paths, all-black a full-frame
  rectangle (Potrace's white-outside convention). Decode caps (16384 edge / 268 MP refused as a real
  platform limit), burn cap 32 MP, commit grid memory budget (190–230 B/px, 24 MP / 6 MP ceilings)
  and the 30 s silence watchdog are coherent.
- **Undo and presets (Q6):** `traceExistingImage` adds exactly one undo entry and one Undo restores
  the identical project, with and without Delete source. `restoreTraceSettings` keeps only known
  controls, clamps to each control's range and restores Crop for crop-only styles.
- **Option semantics (Q3):** Cutoff/Threshold band is inclusive 0–128 like LightBurn; alpha mode
  uses 255 − alpha in the same band. Ignore Less Than drops lattice loops of either polarity with
  area < N (Potrace: "fewer than t pixels"; both polarities, since holes are paths). Smoothness maps
  0 → every corner, 4/3 → no corners (Potrace α_max: "If α_max = 0 ... polygon", "> 4/3 ... no
  corners"). Turn policy default resolves saddles on evidence (ADR-403; Potrace default minority).
- **CLI:** numeric options are range-checked; empty input and empty traces have their own exit codes.

## Not verified

- Real browser decode of 16-bit PNG, CMYK JPEG and huge (>100 MP) images; the decode paths were
  read, not run. No packaged app or hardware.
- Peak memory and time at the 24 MP commit ceiling (ADR-409 measurements were not repeated).
- Photo shading and Colour layers geometry validity (not in the fuzz); Centerline/Line + fill
  stroke geometry beyond the drift check.
- Multi-File Trace orchestration and camera trace (`src/ui/commands`, `src/ui/state/camera-trace-import.ts`)
  beyond their shared use of the commit grid.
- A Trace click that finds the owner claim gone returns without a toast (`ImportImageDialog.tsx:270`,
  `:335`); whether the modal dialog lets the source change at all was not checked.
- LightBurn's own defaults for Ignore Less Than and Smoothness inside the application (the web page
  does not state them).

Repro files were temporary Vitest files named `zz-07-*` next to the code they imported; all were
deleted. Output logs are in this session's scratchpad (`zz07.log`, overwritten per run).

```json
[
  {"id":"P2-1","severity":"P2","area":"trace","file":"src/core/trace/trace-image.ts","line":423,"anchor":"Twin local-contrast-mask.ts:75 (rounded radius); Contract ADR-438 clause 3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Sketch local mean indexed with a fractional radius on the tapered supersample grid: Line + fill + Sketch on 0.75-1.0 MP drawings traces only a corner triangle; Line Art/Smooth Sketch and Faint lines 4-5x slower. Refuter: also default Line Art auto-sketch on colour art 1060-1224 px adds a spurious corner triangle"},
  {"id":"P2-2","severity":"P2","area":"trace","file":"src/ui/trace/trace-commit-grid.ts","line":217,"anchor":"Twin preview vs commit geometry; Contract ADR-409","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-409 notes Centerline thresholds only","summary":"Commit grid finer than preview keeps sketch/Edge windows in grid pixels: committed trace loses 17-43% of the ink the preview showed. Refuter: Sketch confirmed with the real planner; Edge only for pale broad marks"},
  {"id":"P2-3","severity":"P2","area":"trace (twin in registration-jig)","file":"src/ui/workspace/registration-jig/jig-trace-import.ts","line":86,"anchor":"Twin ImportImageDialog.tsx:431; Contract ADR-454","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Jig tracer maps Line + fill to filled-contours: pen strokes bound to a Fill operation and omitted from output"},
  {"id":"P3-1","severity":"P3","area":"trace","file":"src/core/trace/trace-work-budget.ts","line":66,"anchor":"Contract ADR-438 clause 3; Twin Centerline integer policy","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Line + fill tapers to a fractional grid; strokes drift up to 0.45 px off centre"},
  {"id":"P3-2","severity":"P3","area":"trace","file":"src/core/trace/trace-optimize.ts","line":10,"anchor":"Ground truth LightBurn Trace Image: 0 = no optimization","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Optimize 0 still simplifies at 0.85x the default tolerance"},
  {"id":"P3-3","severity":"P3","area":"trace (twin in registration-jig)","file":"src/ui/workspace/registration-jig/jig-image-trace.ts","line":84,"anchor":"Twin trace-output-commit.ts:68, ImportImageDialog.tsx:384; Contract ADR-461, ADR-391","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Jig trace skips colour-layer darkness powers (30/30/30 vs 17.3/20.2/30). Refuter: laser move simplification half refuted, compiled moves identical"},
  {"id":"P3-4","severity":"P3","area":"trace","file":"src/core/trace/lightburn-trace-settings.ts","line":19,"anchor":"Ground truth LightBurn Trace Image page","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Comment cites LightBurn docs for Ignore Less Than 2 / Smoothness 1 defaults the page does not state"},
  {"id":"P3-5","severity":"P3","area":"trace","file":"src/core/trace/trace-work-budget.test.ts","line":1,"anchor":"Contract METHOD L7; ADR-438 verification","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test for windowed detectors at fractional pixelScale, Line + fill in the taper band, or preview/commit parity for Sketch/Edge"}
]
```
