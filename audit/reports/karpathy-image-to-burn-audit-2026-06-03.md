# Karpathy Image-To-Burn Audit - 2026-06-03

## Scope

Audit-only review of `C:\Users\Asus\LaserForge-2.0` at:

- Branch: `wip/checkpoint-2026-06-03`
- HEAD: `bf133f5 fix(fill): ADR-035 rapid across large fill gaps (stray-line fix)`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`

Reviewed workflow: image import, trace preview/commit, raster/image mode, fill hatching, preview, preflight, G-code output, serial start/stop/disconnect safety, and the supplied real artifacts:

- `C:\Users\Asus\Desktop\untitled archii.lf2`
- `C:\Users\Asus\Desktop\Gcode arch house.gcode`

Production code was not edited. The prompt used for this pass is in `audit/prompts/karpathy-image-to-burn-audit-prompt-2026-06-03.md`.

## External Baseline

- LightBurn Trace Image: bitmap trace is best for clear-edged images and exposes Cutoff/Threshold, Ignore less than, Smoothness, Optimize, Fade Image, and Show Points.
- LightBurn Fill: fills closed shapes by scan lines; line interval / lines-per-inch control row spacing; overscan keeps engraving speed consistent by moving outside the burn area with the laser off; fill grouping changes blank-space traversal strategy.
- LightBurn Preview: should show the path sent to the laser, including optimization settings and job origin.
- GRBL v1.1 laser mode: `G0` rapid moves enforce laser disabled; `S0` disables the laser during valid motion; GRBL documentation explicitly recommends `G0` between unpowered raster regions.
- Web Serial disconnect: a disconnect event reports that the port has become unavailable; it is not proof that buffered machine motion stopped.

## Verification Run

- `pnpm test` passed: 121 test files, 914 tests.
- `pnpm run typecheck` passed.
- `npm.cmd run lint` passed with the existing boundaries legacy-selector warning only.
- `npm.cmd run build` passed.
- `git diff --check HEAD` passed.

Build warning retained for roadmap: Vite reports that dynamic imports of `src/core/scene/index.ts` and `src/ui/trace/image-loader.ts` do not split those modules because they are also statically imported elsewhere.

## Confirmed Good

### ADR-035 fixed the reported long blank-feed class in current source

Claude's latest fill change splits scanline spans when the gap is greater than `GAP_RAPID_THRESHOLD_MM = 5` in `src/core/job/fill-sweeps.ts:84` and `src/core/job/fill-sweeps.ts:112`.

Independent artifact re-emit from the supplied `.lf2` reported:

- Current-source fresh emit: `0` `G1 S0` feed gaps over 5 mm.
- Current-source max `G1 S0` gap: `4.872 mm`.

That directly addresses the large "laser should have been off while moving to the second part" class.

### Raster output has several correct safety properties

`src/core/raster/emit-raster.ts` emits `M5`, then `M4 S0`, clips active spans, alternates rows, and ends with `M5`. `compile-job.ts` fails missing/corrupt luma safe to white / S0, not full burn.

### Start path has real controller gating

`src/ui/laser/start-job-readiness.ts` runs preflight, controller readiness, `$30`/`$32` checks, and job-intent warnings before allowing Start.

## Findings

### F-H1 - Stale exported G-code still contains the original long blank-feed risk

Severity: High for the supplied artifact. Confidence: High.

Path: `C:\Users\Asus\Desktop\Gcode arch house.gcode`

Direct inspection found `164` `G1 S0` moves over `5 mm`, max `20.935 mm`; top line was `2905: G1 X293.237 Y172.700 S0`.

If that exact desktop G-code is burned again, it can still create the same faint stray line even though current source is improved.

Fix: regenerate the G-code from current source before burning. Add export metadata to G-code headers: build hash, emitter revision, and safety-relevant ADR version.

### F-M1 - Preflight does not catch long blanked feed moves

Severity: Medium. Confidence: High.

Paths: `src/core/invariants/predicates.ts:59`, `src/core/preflight/preflight.ts:187`

The current laser-on-travel invariant checks `G0` laser-off semantics, but not material-visible blank feed moves. The stale artifact returns zero laser-on-travel issues despite `164` long `G1 S0` gaps.

Fix: add `findLongBlankFeedMoves(gcode, thresholdMm)` and wire it into preflight as a warning or blocker for fill/image jobs.

### F-M2 - ADR-035 still permits up to 5 mm feed-blank gaps

Severity: Medium. Confidence: Medium pending hardware.

Paths: `src/core/job/fill-sweeps.ts:84`, `src/core/job/fill-sweeps.ts:112`, `src/core/output/grbl-strategy.ts:143`

Gaps at or under the threshold remain `G1 S0` at fill feed. Current fresh output still contains many short `G1 S0` gaps, max around `4.872 mm`.

Fix: make the threshold layer/device configurable, or run controlled burns at `5`, `3`, `2`, and `0 mm` and set the default from evidence. Add boundary tests for exactly `5.000` and `5.001 mm`.

### F-M3 - Small lettering is geometry-limited in the supplied `.lf2`

Severity: Medium. Confidence: High.

Path: `C:\Users\Asus\Desktop\untitled archii.lf2`

Evidence:

- One `traced-image` on one Fill layer.
- Hatch spacing: `0.1 mm`.
- Power/speed: `30%`, `1500 mm/min`.
- `54` polylines, `9512` points.
- Bottom features include glyph pieces around `0.694-1.912 mm` high and strokes around `0.158-0.184 mm` high.

Tiny traced contours produce very short fill spans and only a few hatch rows per letter. Small words can look muddy, dotted, or uneven even when G-code safety is correct.

Fix: for tiny text/logos, prefer real vector/text source or Image/raster engraving rather than Fill on traced contours. Add a preflight/preview warning for fill jobs with high micro-span density or features below a physical minimum size.

### F-H2 - Raster compile can allocate unbounded burn grids and G-code strings

Severity: High. Confidence: High.

Paths: `src/ui/layers/LayerRow.tsx:298`, `src/ui/layers/LayerRow.tsx:304`, `src/core/job/compile-job.ts:88`, `src/core/job/compile-job.ts:98`, `src/core/raster/dither.ts:109`, `src/core/raster/dither.ts:113`, `src/core/raster/emit-raster.ts:72`, `src/core/raster/emit-raster.ts:122`

UI allows `1..50` lines/mm. Compile derives pixel dimensions from mm bounds times lines/mm, allocates full luma and S-value arrays, then raster emission builds a full G-code string.

Consequence: Preview/ETA/Save/Start can freeze or OOM before the user gets a useful preflight message.

Fix: add a raster budget before allocation: max output pixels, max estimated G-code bytes, max estimated runtime. Return a typed `too-large` result before allocating.

### F-M4 - Trace preview can be overwritten by stale async results

Severity: Medium. Confidence: High.

Paths: `src/ui/trace/use-trace-preview.ts:113`, `src/ui/trace/use-trace-preview.ts:125`, `src/ui/trace/use-trace-preview.ts:127`

A request token is checked before `runTrace`, but not after `await traceImageWithFallback`. An older trace can resolve after a newer one and overwrite preview state.

Fix: pass the request token into `runTrace`, check it after await in both success and error paths, and add a delayed-worker race test.

### F-M5 - Raster import ignores embedded DPI despite workflow claiming DPI sizing

Severity: Medium. Confidence: High.

Paths: `src/ui/common/image-import.ts:4`, `src/ui/common/image-import.ts:20`, `src/ui/common/Toolbar.tsx:243`, `src/ui/trace/image-loader.ts:59`

`rasterImportGeometry` supports optional DPI, but current image loading passes natural/sampled dimensions only. No PNG `pHYs`, JPEG JFIF, or EXIF density parse was found.

Fix: parse density metadata on import and pass DPI through. Add 300 DPI PNG and JPEG fixtures plus a no-metadata fallback test.

### F-M6 - Preview toolpath can differ from emitted G-code

Severity: Medium. Confidence: High.

Paths: `src/ui/workspace/draw-preview.ts:64`, `src/io/gcode/emit-gcode.ts:26`, `src/io/gcode/emit-gcode.ts:28`

Preview builds from raw `compileJob`, while emitted output applies `optimizePaths` and optional job origin. Preview approval does not prove the same motion order, travels, or job-origin placement that the laser will execute.

Fix: create one shared prepared-output pipeline used by preview, estimate, save, frame, and start.

### F-H3 - Stop/Pause/Disconnect write failures are not surfaced as operator safety alerts

Severity: High. Confidence: High.

Paths: `src/ui/state/laser-store.ts:409`, `src/ui/state/laser-store.ts:434`, `src/ui/laser/JobControls.tsx:200`, `src/ui/laser/JobControls.tsx:209`, `src/ui/laser/LaserWindow.tsx:71`

Store actions reject/log on failed writes, but UI event handlers discard promises with `void`. During a job, the UI must immediately say to use physical E-stop/power if a stop command cannot be sent.

Fix: catch safety-action failures at the UI edge, render a prominent persistent alert using `lastWriteError`, and require acknowledgement after failed Stop or mid-job disconnect.

### F-M7 - Cable-yank mid-job leaves ambiguous UI recovery

Severity: Medium. Confidence: High.

Paths: `src/ui/state/laser-store.ts:275`, `src/core/controllers/grbl/streamer.ts:171`, `src/ui/laser/JobControls.tsx:30`, `src/ui/laser/StatusDisplay.tsx:13`

Streamer can become `disconnected`, but visible job controls/status do not strongly explain that buffered commands may still be executing and that re-home/recovery is required.

Fix: terminal job banner for `disconnected`, `cancelled`, and write-failed states; message should explicitly say buffered motion may continue and physical E-stop/power is the immediate safety control.

### F-M8 - Save G-code skips Start's intent warnings

Severity: Medium. Confidence: High.

Paths: `src/ui/laser/start-job-readiness.ts:77`, `src/ui/app/file-actions.ts:70`, `src/ui/laser/job-intent-warnings.ts:3`

Start includes `detectJobIntentWarnings`; Save G-code only emits and checks hard preflight. Exporting to run later gets fewer warnings than direct Start.

Fix: share the same preparation/warning path for Save and Start.

### F-M9 - Raster preview supports transforms that raster output rejects

Severity: Medium. Confidence: High.

Paths: `src/ui/workspace/draw-raster-preview.ts:43`, `src/core/preflight/preflight.ts:160`, `src/ui/raster/vector-to-bitmap.ts:76`

Preview can draw transformed rasters, but preflight blocks raster output with rotation/mirror.

Fix: either implement transformed raster output or warn/block at transform/convert time before the operator gets an invalid image-mode job.

### F-M10 - Import Image can collide with an existing non-image `#808080` layer

Severity: Medium. Confidence: High.

Paths: `src/ui/common/Toolbar.tsx:260`, `src/ui/state/scene-mutations.ts:126`, `src/ui/state/scene-mutations.test.ts:67`, `src/core/preflight/preflight.ts:136`

Import uses `DEFAULT_RASTER_LAYER_COLOR`; `ensureRasterImageLayer` no-ops if the color exists and does not flip mode. Preflight later blocks the image as assigned to a line/fill layer.

Fix: create a unique image layer when the default color already exists in non-image mode, or decouple raster layer binding from color.

## False-Positive / Duplicate Handling

- The long stray-line bug is not still present in current source for gaps over 5 mm; that is fixed by ADR-035. The stale desktop G-code remains dangerous only if reused without regeneration.
- "Small letters ugly" is not proof of an emitter bug by itself. The supplied `.lf2` has sub-millimeter traced features and hatch-row limitations that explain the symptom.
- The Vite chunk warnings are not burn-safety bugs. They remain roadmap performance cleanup.

## Recommended Roadmap

### Step 1 - Do before next serious burn/export

1. Add G-code export metadata: build hash, commit, emitter revision, and relevant ADR revision.
2. Add long blank-feed invariant/preflight warning for `G1 S0` moves over a configured threshold.
3. Surface Stop/Pause/Disconnect write failures as persistent operator alerts.
4. Add mid-job disconnect recovery banner that says buffered commands may still execute and physical E-stop/power is required if unsafe.

### Step 2 - Image freeze / large job hardening

1. Add raster pixel/G-code/runtime budget before allocation.
2. Align UI `linesPerMm` range with workflow or update workflow and add warnings above 20.
3. Split raster "trace preview cap" from "engrave luma resolution" so displayed images and burn luma do not silently diverge.

### Step 3 - Preview/output truth

1. Create a shared prepared-output pipeline for preview, estimate, save, frame, and start.
2. Use it to ensure preview reflects optimization, origin, layer modes, and raster/fill transforms exactly.
3. Add preview-vs-output regression tests for representative vector, fill, trace, and raster jobs.

### Step 4 - Trace workflow correctness

1. Fix stale async trace preview races.
2. Add project round-trip tests covering raster image, traced image, trace-source, and luma persistence.
3. Add DPI parsing for PNG/JPEG imports.
4. Add a small-feature / micro-span warning for filled traces.

### Step 5 - Burn-quality workflow

1. For tiny logo lettering, test Image/raster engrave against Fill-traced contours.
2. Add a "small text from trace" warning with recommendations: raster image mode, true vector/text source, or enlarge artwork.
3. Run A/B burns for fill gap threshold `5`, `3`, `2`, `0 mm` on the arch-house file.

### Step 6 - Cleanup

1. Resolve the dynamic import chunk warnings if startup/trace-open latency becomes noticeable.
2. Reconcile stale workflow docs: raster streaming is currently full-string emission, not true row streaming.
