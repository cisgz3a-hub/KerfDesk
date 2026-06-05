# LaserForge 2.0 Karpathy + LightBurn Master Roadmap

Date: 2026-06-04

Repo: `C:\Users\Asus\LaserForge-2.0`

Branch audited: `wip/checkpoint-2026-06-03`

Remote verified: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`

Status: planning document only. No production code is changed by this roadmap.

## Purpose

This is the single backlog for the safety, image, tracing, raster, bitmap, SVG,
workflow, and LightBurn-parity work we found across the LaserForge 2.0 audits.
It supersedes scattered "what next?" notes, but does not delete the source
reports. Keep those reports for evidence.

The goal is not "copy every LightBurn feature." The goal is to build the
features that matter for a safe, predictable GRBL laser workflow, while marking
larger LightBurn features as governance-gated when they are outside current
LaserForge scope.

## Review Method

- Verified the repo identity before writing this file. The audited checkout is
  `LaserForge-2.0`, not old LaserForge 1.0.
- Inventoried all 63 first-party Markdown files outside `node_modules`.
- Read the root operating specs, the LightBurn study, the remaining-work
  roadmap, the recent whole-repo audits, the image trace / bitmap research, the
  small-text burn study, the fill-speed diagnosis, and the relevant evidence
  files.
- Rechecked current code for the live findings before carrying them forward.
- Rechecked current official web references for LightBurn workflow and browser /
  GRBL behavior where the local docs depended on them.

## Karpathy Rules For This Roadmap

1. Verify the real object, not the story about the object.
   For LaserForge, that means emitted G-code, preview output, serial state,
   exported `.lf2`, and physical burn results.
2. Keep one truth per workflow.
   Preview, Save G-code, Start, Frame, and live estimates must share the same
   prepared-output path wherever possible.
3. Prefer red proof before fixes.
   Every bug fix should start with a failing unit, integration, browser, or
   exported-artifact test that reproduces the exact trigger.
4. Never hide a safety uncertainty.
   If GRBL, USB, or firmware buffering means the app cannot guarantee a stop,
   the UI must say so and tell the operator to use physical E-stop or power.
5. Do the smallest correct diff.
   Do not refactor the whole app to fix a single edge. Add an abstraction only
   when it removes a real duplicated truth.
6. Do not resurrect stale findings.
   A finding stays only if current code, current docs, or current hardware
   evidence still supports it.
7. Separate shipped, unverified, and blocked.
   Tests can prove compiler rules. Only supervised hardware can prove burn
   quality and physical safety behavior.

## Source Ledger

### Local Specs And Audits Read

- `PROJECT.md`: product goal, phase scope, non-negotiables, out-of-scope list.
- `CLAUDE.md`: coding discipline, tests-first bug fixes, LightBurn as workflow
  reference, and "green tests are not enough" hardware/perceptual rule.
- `WORKFLOW.md`: current app flows; Phase C/D/E docs still stubbed while Phase
  F image/fill/origin/bitmap flows are detailed.
- `DECISIONS.md`: ADRs for LightBurn parity, image mode, tracing, origin,
  Convert to Bitmap, raster/fill fixes, and GRBL error handling.
- `LIGHTBURN-STUDY.md`: LaserForge vs LightBurn gap ledger.
- `docs/REMAINING-WORK-ROADMAP-2026-06-04.md`: existing tiered backlog and
  hardware verification list.
- `docs/research/burn-perfection-small-text.md`: small text burn diagnosis.
- `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md`: accepted and
  rejected parity findings.
- `audit/reports/lightburn-build-gap-roadmap-2026-06-04.md`: previous fix order.
- `audit/reports/image-trace-bitmap-deep-research-2026-06-04.md`: trace,
  bitmap, raster preview, and freeze findings.
- `audit/reports/claude-change-audit-2026-06-04.md`: audit of Claude's latest
  safety and trace changes.
- `audit/reports/claude-p0-p1-audit-2026-06-03.md`: earlier Claude change
  audit and partial/complete status.
- `audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`: raster/fill runtime and short-run
  scanline analysis.
- `audit/LIGHTBURN-PARITY-AUDIT-2026-06-03.md`: LightBurn parity gap map.
- `audit/evidence/*`: closure evidence and remaining hardware-verification
  notes for serial, origin, preview budget, raster cache, autosave, SVG, file
  errors, deploy gate, and LightBurn Tier 0 fixes.

### External Research Rechecked

- LightBurn Image Mode: image settings include bidirectional scanning,
  overscanning, line interval / DPI, pass-through, and many image modes; it also
  explicitly describes edge burning when overscan is missing or wrong.
  Source: <https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/>
- LightBurn Cuts / Layers: layers control operation assignment, order, quick
  settings, output/show behavior, air assist, and access to full settings.
  Source: <https://docs.lightburnsoftware.com/latest/Reference/CutsLayersWindow/>
- LightBurn Coordinates / Origin: Start From includes Absolute Coordinates,
  Current Position, and User Origin; the Job Origin control chooses how the job
  bounds align to that start reference.
  Source: <https://docs.lightburnsoftware.com/CoordinatesOrigin>
- LightBurn Optimization Settings: the cut planner can order by layer/group/
  priority and optimize inner-first cuts, travel, direction, backlash, and
  starts.
  Source: <https://docs.lightburnsoftware.com/2.1/Reference/OptimizationSettings/>
- LightBurn Trace Image: trace works from an imported image object and exposes
  cutoff, threshold, boundary, ignore-small-regions, optimize, smoothness, fade
  image, and show-points controls.
  Source: <https://docs.lightburnsoftware.com/1.7/Reference/TraceImage/>
- LightBurn Convert to Bitmap: selected vectors convert to Image Mode; render
  type includes Outlines, Fill All, or Use Cut Settings; DPI is explicit; source
  vector deletion is warned.
  Source: <https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/>
- LightBurn Adjust Image: image adjustment combines layer image settings with
  brightness, contrast, gamma, presets, and side-by-side preview.
  Source: <https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/>
- LightBurn Material Test and Interval Test: LightBurn provides generated
  calibration workflows for power, speed, interval, and passes, and ties test
  placement to Start From / Job Origin.
  Sources: <https://docs.lightburnsoftware.com/latest/Reference/MaterialTest/>,
  <https://docs.lightburnsoftware.com/latest/Reference/IntervalTest/>
- GRBL realtime commands: Ctrl-X soft reset is immediate; feed hold stops
  motion but does not disable spindle/laser by definition.
  Source: <https://github-wiki-see.page/m/gnea/grbl/wiki/Grbl-v1.1-Commands>
- GRBL streaming: GRBL uses serial and planner buffering; host streaming must
  respect buffered execution and cannot assume an unplugged USB link clears
  already-buffered motion.
  Source: <https://github-wiki-see.page/m/grbl/grbl/wiki/Interfacing-with-Grbl>
- MDN Canvas `toDataURL`: the method encodes the whole image into an in-memory
  string; MDN recommends `toBlob()` plus `URL.createObjectURL()` for larger
  images.
  Source: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL>

## Current Good State To Preserve

Do not redo these unless a fresh failing test or hardware result proves a
regression.

- Trace now keeps the source image and revalidates source provenance before
  committing a trace.
  Evidence: ADR-026, ADR-039/040 area in `DECISIONS.md`;
  `audit/reports/trace-provenance-cleanup-2026-06-03.md`; current
  `src/ui/state/scene-mutations.ts`.
- The default preview/output path now has a shared `prepareOutput()` route for
  normal Save/Start/Preview.
  Evidence: `src/io/gcode/prepare-output.ts`,
  `src/ui/workspace/draw-preview.ts`,
  `src/ui/laser/live-job-estimate.ts`,
  `src/io/gcode/emit-gcode.ts`.
- Normal Save/Start runs pre-emit raster budget checks before `compileJob()`.
  Evidence: `src/io/gcode/prepare-output.ts`,
  `src/core/preflight/pre-emit.ts`,
  `src/io/gcode/prepare-output.test.ts`.
- GRBL `error:N` now makes the pure streamer terminal, so the streamer does not
  keep sending new lines after a rejected line.
  Evidence: `src/core/controllers/grbl/streamer.ts`,
  `src/core/controllers/grbl/streamer.test.ts`,
  `src/ui/state/laser-line-handler.ts`.
- Raster row splitting / long blank-feed invariant is present.
  Evidence: ADR-039 in `DECISIONS.md`, `audit/evidence/lightburn-tier0-fixes-2026-06-03.md`.
- Fill M4 dynamic-power and unidirectional fill options exist in the model/code.
  Evidence: ADR-036/038 in `DECISIONS.md`, `src/core/scene/layer.ts`,
  `src/core/job/compile-job-fill-cache.test.ts`,
  `docs/research/burn-perfection-small-text.md`.
- SVG presentation-state walker fixes are present for inherited/style stroke,
  transforms, and hidden geometry.
  Evidence: `audit/evidence/karpathy-stage3b-svg-presentation-state-2026-06-03.md`,
  `src/io/svg/parse-svg-presentation-state.test.ts`.
- `$30`, `$31`, and `$32` controller settings are parsed and surfaced enough to
  warn on power scale, min power, and laser-mode mismatch.
  Evidence: `audit/reports/power-controller-post-fix-audit-2026-06-01.md`,
  `src/core/controllers/grbl/parse-settings.ts`,
  `src/ui/laser/DetectedSettingsBanner.tsx`.

## Release Gate 0: Hardware Verification Before More Burn Claims

These are not optional polishing tasks. They are the proof layer for the code we
already shipped. Run them on scrap material at conservative power before calling
the related code physically proven.

### HV-1 Fill Gap Rapid Verification

Evidence: `docs/REMAINING-WORK-ROADMAP-2026-06-04.md`,
`audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`.

Verify that fill output uses laser-off rapid travel across wide blank gaps and
does not mark the material during those moves. Use a design with two separated
filled islands.

Pass condition: no visible line between islands; exported G-code shows hard-off
travel before the rapid.

### HV-2 Bidirectional Fill Edge Quality

Evidence: `docs/research/burn-perfection-small-text.md`,
`audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`.

Burn the same small-text/skinny-line fixture with bidirectional fill on and off.

Pass condition: the unidirectional result removes or clearly reduces zippering
or line-offset artifacts without creating new travel-mark defects.

### HV-3 M4 Fill Small-Text Test

Evidence: `docs/research/burn-perfection-small-text.md`; GRBL `$32` laser mode
research in `audit/reports/power-controller-audit-2026-06-01.md`.

Burn tiny text / logo details with M4-enabled fill and compare to the older
constant-power behavior.

Pass condition: shorter scanlines do not over-darken at ends, and text remains
legible.

### HV-4 Raster Row Split Test

Evidence: ADR-039 in `DECISIONS.md`, `audit/evidence/lightburn-tier0-fixes-2026-06-03.md`.

Burn a raster with wide white gaps between active regions.

Pass condition: the machine travels with laser off across inactive gaps; there
are no faint "connector" marks.

### HV-5 Disconnect / Error Safety Drill

Evidence: GRBL realtime command research, `src/ui/state/laser-store.ts`,
`src/ui/state/laser-line-handler.ts`.

At low power on scrap, test Stop, active-job Disconnect, and an induced
controller error if safely reproducible.

Pass condition: UI shows the honest safety notice, no further host lines stream
after the terminal condition, and the operator has a visible path to physical
E-stop/power-off when software cannot guarantee the machine state.

## P0 Safety And Freeze Fixes

### P0-1 Finish Controller Error Safety Semantics

Current evidence:

- `src/core/controllers/grbl/streamer.ts` now enters `errored` on `error:N`.
- `src/ui/state/laser-line-handler.ts` raises a `controller-error` safety
  notice for every `error:N`.
- `src/ui/state/laser-store.ts` defines active jobs as only `streaming` or
  `paused`.
- `src/ui/laser/JobControls.tsx` renders running controls only for `streaming`
  or `paused`.

Why this matters:

GRBL `error:N` means a line was rejected. The host must stop sending new lines,
but GRBL may already have accepted buffered motion. The current pure-streamer
fix is correct but incomplete as an operator workflow, because `errored` is not
treated as a state that still needs Stop / recovery UI.

LightBurn / GRBL backing:

- LightBurn Stop is a job-control action, but LightBurn also warns software stop
  must not be the only physical stop path.
- GRBL Ctrl-X is the immediate reset command; feed hold does not disable
  spindle/laser.

Fix shape:

- Treat `streamer.status === 'errored'` as a terminal unsafe/recovery state, not
  as idle.
- Keep Stop / Reset visible while `errored` exists, or add an explicit
  "Clear after machine is safe" recovery action.
- Gate controller-error notices to active job / stream context where possible,
  so a harmless idle `error:N` does not create scary job copy.
- Decide whether LaserForge should send Ctrl-X immediately when an in-job
  `error:N` arrives. If implemented, make the failure path explicit because the
  reset write can fail after USB loss.

Tests:

- `error:N` during an active stream enters `errored`, sends no more G-code, and
  leaves Stop/recovery visible.
- Idle `error:N` updates last error/log without claiming a job may still be
  burning.
- Failed soft reset during error recovery preserves the safety notice.

Hardware verification:

- Low-power induced error or simulator-assisted serial test, then supervised
  machine behavior check.

### P0-2 Revisit Pause Semantics

Current evidence:

- `src/ui/state/laser-store.ts` sends `RT_HOLD` for Pause.
- `audit/evidence/lightburn-parity-codex-verification-2026-06-03.md` already
  records the risk: GRBL feed hold stops motion but not spindle/laser by
  definition.
- `JobControls` includes copy warning that Pause is feed hold only.

Why this matters:

On a laser, "paused motion but laser state not guaranteed off" is safety
relevant. The UI copy helps, but the roadmap needs a deliberate product
decision: Pause is resumable feed hold, Stop is safety reset, and physical
E-stop/power is the final authority.

Fix shape:

- Keep Pause as resumable only if we can prove the Falcon firmware disables
  laser output during GRBL hold in laser mode, or if the UI clearly marks Pause
  as non-safety.
- Ensure Stop is visually and keyboard-prioritized over Pause during active
  jobs.
- Add a test that Pause copy cannot be removed accidentally.

Hardware verification:

- Low-power run: pause mid-image/fill, inspect whether the laser remains firing
  or causes a stationary burn mark.

### P0-3 Surface Follow-Up Write Failures Everywhere

Current evidence:

- Pause/Stop write failures have tests in `src/ui/state/laser-store.test.ts`.
- Older audits still list write-failure gaps for Home, Frame, Jog, Set Origin,
  Reset Origin, Unlock, and Autofocus.
- `src/ui/state/laser-store.ts` calls `safeWrite` directly in those paths.

Why this matters:

If a write fails during a safety-meaningful action, a transient toast is not
enough. The operator needs persistent state.

LightBurn / GRBL backing:

GRBL real-time and command writes are the only software channel. If that channel
fails, the app cannot assume the physical machine changed state.

Fix shape:

- Route every laser command through a command result wrapper with action name,
  command kind, and safety severity.
- For motion or safety-affecting writes, preserve or create a persistent safety
  notice on failure.
- Do not collapse state to "safe idle" unless the machine is actually known
  idle.

Tests:

- Frame/Home/Jog/Origin/Autofocus/Unlock write rejection creates a persistent
  action-specific notice.
- Non-motion status-poll failure can stay non-blocking.

### P0-4 Make Frame And Jog Stoppable Busy Operations

Current evidence:

- Autofocus now has a busy lifecycle.
- Frame and jog are still ordinary command methods around `$J` or frame moves.
- `audit/evidence/karpathy-stage1c-autofocus-lifecycle-2026-06-02.md` explicitly
  says Frame/Jog/Start/Origin/Disconnect should remain unavailable while
  autofocus is active, but Frame/Jog themselves still lack a symmetric active
  operation lifecycle.

Why this matters:

LightBurn has a separate Laser/Move workflow with Stop always visible. For a
laser operator, a long Frame or jog should not look like the app is idle.

Fix shape:

- Introduce active operation state for Frame and long jogs.
- Show Stop/Cancel while a frame/jog is in progress.
- Use GRBL jog cancel / feed hold / soft reset according to the operation type,
  and document which one is used.

Tests:

- Starting Frame disables conflicting operations until it settles.
- Stop/Cancel during Frame sends the intended realtime command.
- Frame write failure raises persistent notice.

Hardware verification:

- Supervised frame around a large rectangle; cancel mid-frame; confirm the head
  stops and UI state is honest.

### P0-5 Route Custom-Origin Start Through Prepared Output Before Compile

Current evidence:

- `src/io/gcode/prepare-output.ts` guards raster budget before `compileJob()`.
- `src/ui/laser/start-job-readiness.ts` still calls
  `applyJobOrigin(compileJob(...), USER_ORIGIN_JOB_PLACEMENT)` inside
  `findOriginBoundsIssue()`.
- `src/ui/laser/JobControls.tsx` still compiles directly for custom-origin
  bounds.

Why this matters:

Large images can freeze before the budget guard if a custom-origin path compiles
the raster first.

LightBurn backing:

LightBurn's Start From / Job Origin is a placement model, not a reason to
recompute a different burn output. Start, Save, Preview, and Frame should agree
about what the job is.

Fix shape:

- Add a cheap bounds/preflight path that can apply user-origin placement without
  raster resampling.
- Or make `prepareOutput(project, { jobOrigin })` the only path for Start and
  readiness, and ensure `prepareOutput` rejects over-budget rasters before
  compile.
- Update readiness tests with a 300 mm x 300 mm image at 25 lines/mm.

Tests:

- Custom-origin Start refuses an over-budget raster without calling
  `compileJob()`.
- Custom-origin bounds warning is still correct for normal vector jobs.

### P0-6 Route Frame Through The Same Cheap Preflight Truth

Current evidence:

- `useFrameAction()` in `src/ui/laser/JobControls.tsx` calls `compileJob()` before
  frame bounds.
- Existing audits classify this as a P1/P0 reliability issue for large rasters.

Why this matters:

The user frames before burning. A large image must not freeze the UI just
because the user wants to check placement.

LightBurn backing:

LightBurn Frame is a laser-window job-control workflow that checks output
location. It should not require rendering the whole raster into burn pixels.

Fix shape:

- Compute Frame bounds from output-enabled object bounds and job-origin
  placement, not from compiled raster pixels.
- Keep framePreflight out-of-bed behavior.
- Ensure Frame, Start readiness, and Save use the same source-of-truth bounds.

Tests:

- Over-budget raster Frame refuses or frames bounds without invoking raster
  dither/compile.
- User-origin frame uses WCO offset correctly.

### P0-7 Budget And Defer Raster Preview

Current evidence:

- `src/ui/workspace/draw-raster-preview.ts` synchronously resamples/dithers and
  creates a canvas on draw.
- It does not call `evaluateRasterBudget()`.
- Preview cache exists, but first render can still be expensive.

Why this matters:

The app still freezes after bitmap/image scan paths because preview can do
heavy image work inside the draw loop.

LightBurn backing:

LightBurn can preview images, but it also exposes image interval/DPI and
overscan settings as explicit workload controls. LaserForge needs the same
budget honesty.

Fix shape:

- Apply `evaluateRasterBudget()` before preview rasterization.
- Move large preview rasterization to a worker or use a low-resolution preview
  fallback.
- Show an on-canvas "preview simplified" or layer warning when preview is
  skipped.
- Keep output preflight stricter than preview if needed, but never let preview
  freeze the operator.

Tests:

- Large raster preview does not call `dither()` / `resampleLumaNearest()` in the
  draw loop.
- A skipped preview still renders the image placement box and does not mutate
  output.

### P0-8 Move Convert To Bitmap Off The UI Hot Path

Current evidence:

- `src/ui/raster/luma-bitmap.ts` uses browser-only `toDataURL()`.
- `src/ui/raster/vector-to-bitmap.ts` builds bitmap fields synchronously from
  the toolbar action.
- MDN warns `toDataURL()` encodes the whole image into an in-memory string and
  recommends `toBlob()` for large images.

Why this matters:

The user specifically observed Convert to Bitmap freezing the screen. This is
consistent with synchronous rasterization plus data-URL encoding.

LightBurn backing:

LightBurn Convert to Bitmap has a preview dialog with DPI/render-type controls
before committing the bitmap. LaserForge currently commits through a hot toolbar
path.

Fix shape:

- Add a Convert to Bitmap dialog that shows estimated pixel dimensions before
  rendering.
- Apply `evaluateRasterBudget()` before any canvas allocation.
- Move rasterization/encoding to a worker where possible.
- Prefer `toBlob()` plus object URL for preview; persist only the minimal
  representation needed by `.lf2` and pure compile.
- Keep `lumaBase64` generation chunked or worker-side.

Tests:

- Over-budget conversion refuses before creating a canvas.
- Conversion uses a worker/deferred task for accepted large-but-safe rasters.
- Browser smoke test proves UI remains responsive during conversion.

## P1 Burn Truth And LightBurn Core Workflow Parity

### P1-1 Raster ETA Must Use Active Spans And Rapid Gaps

Current evidence:

- `src/core/raster/emit-raster.ts` computes `activeSpans()`.
- `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md` still lists
  raster ETA underestimating wide-gap raster output.

Why this matters:

Bad ETA hides whether the job is normal or pathological. After the raster row
split, duration estimates must model the actual G0/G1 shape.

Fix shape:

- Reuse the same active-span calculation in the estimator.
- Include acceleration/overscan assumptions explicitly.
- Add snapshot tests comparing emitted raster shape and estimate inputs.

Hardware verification:

- Compare predicted duration to a small supervised burn.

### P1-2 Make Layer Order Explicit And User-Controlled

Current evidence:

- Scene layers exist as an array, but the UI lacks LightBurn-style up/down
  process ordering.
- `src/core/job/optimize-paths.ts` reorders cuts within layers, not user layer
  order.
- LightBurn Cuts/Layers controls operation order and Optimization Settings can
  order by layer.

Why this matters:

For real jobs, order controls quality and safety: engrave before cut, inner
  before outer, lower-risk passes before high-power passes.

Fix shape:

- Add layer move up/down controls.
- Preserve order in `.lf2`.
- Compile in explicit layer order before intra-layer optimization.
- Show visible numbering or ordering affordance.

Tests:

- Reordered layers emit in reordered sequence.
- Preview and G-code agree after layer reorder.
- Save/open preserves order.

### P1-3 Add Manual Layer Create, Recolor, And Reassign

Current evidence:

- LaserForge auto-creates layers from object colors.
- `LIGHTBURN-STUDY.md` records that LightBurn lets users assign operations to
  layers and edit layer colors/settings directly.

Why this matters:

Auto-color is convenient for import, but it blocks normal LightBurn workflow
where the operator decides "these objects engrave first, this object cuts last."

Fix shape:

- Add manual layer creation.
- Add selected-object reassign-to-layer.
- Add layer color/change behavior without breaking existing imports.
- Keep color as layer identity only if that remains deliberate; otherwise move
  to stable layer IDs with color as a property.

Tests:

- Reassigning an object changes output layer without geometry loss.
- Recolor does not duplicate or orphan layers.
- Save/open preserves manual layer identity.

### P1-4 Build The Real Start From + 9-Dot Job Origin UI

Current evidence:

- `src/core/job/job-origin.ts` supports absolute and user-origin concepts.
- `src/ui/laser/start-job-readiness.ts` and `JobControls.tsx` hardcode
  `USER_ORIGIN_JOB_PLACEMENT` for custom-origin behavior.
- `audit/evidence/set-origin-research-2026-06-01.md` says Set Origin alone is
  not the complete LightBurn placement model.

LightBurn backing:

Coordinates / Origin docs define Absolute, Current Position, and User Origin.
The Job Origin selector determines which point of the job bounds aligns to the
chosen reference.

Fix shape:

- Add Laser panel controls for Start From: Absolute Coordinates, Current
  Position, User Origin.
- Add a 3x3 Job Origin anchor selector.
- Support Current Position only when status position is fresh.
- Keep User Origin dependent on known WCO/G92 state.
- Make Frame and Material/Interval Test use the same placement model.

Tests:

- All 9 anchors transform job bounds correctly.
- Start, Frame, Save G-code, and preview metadata agree.
- Unknown current/user origin blocks with a clear recoverable message.

Hardware verification:

- Burn or frame a small square using center, lower-left, and upper-right anchors
  from both Absolute and User Origin.

### P1-5 Expand Image Mode Settings Deliberately

Current evidence:

- `src/core/scene/layer.ts` supports `threshold`, `floyd-steinberg`, and
  `grayscale`.
- LightBurn Image Mode includes Threshold, Ordered, Dither, Atkinson, Stucki,
  Jarvis, Newsprint, Halftone, Sketch, Grayscale, Pass-through, plus
  bidirectional scanning, overscan, line interval/DPI, and image adjustments.

Why this matters:

The "small Langebaan letters" burn quality can be affected by source resolution,
line interval, dither mode, overscan, and trace-vs-image workflow. Without the
real settings, LaserForge forces the operator into guesswork.

Fix shape:

- Add at least Ordered, Atkinson, Stucki/Jarvis, and Pass-through after
  benchmarking.
- Expose Line Interval and DPI as the same setting in two units.
- Add negative image / invert output, brightness, contrast, gamma, and optional
  sharpening under Adjust Image.
- Keep overscan and bidirectional settings visible for both Fill and Image.
- Do not implement every LightBurn mode blindly; add each with fixture tests and
  screenshot/perceptual checks.

Tests:

- Golden dither fixtures for each algorithm.
- Preview/output parity for every algorithm.
- DPI/line-interval conversion stays stable: `DPI = 25.4 / lineIntervalMm`.

Hardware verification:

- Material/photo test strips comparing at least current Floyd, Ordered, and
  Jarvis/Stucki on the same material.

### P1-6 Add Adjust Image Workflow

Current evidence:

- Imported raster image settings are mostly layer-level.
- LightBurn Adjust Image exposes brightness, contrast, gamma, layer settings,
  and side-by-side preview for a selected image.

Why this matters:

Operators need to tune the image before burn, especially for photos, logos, and
small lettering. Without this, they compensate with power/speed and risk burn
quality or material damage.

Fix shape:

- Add an Adjust Image dialog for one selected raster.
- Store per-image adjustment metadata separately from layer dither settings.
- Render side-by-side source vs processed preview.
- Make processed luma the same source used by preview and emit.

Tests:

- Adjustment metadata survives save/open.
- Preview and emitted luma use the same adjustment pipeline.
- Cancel leaves original image unchanged.

### P1-7 Complete Convert To Bitmap Parity Scope A3/A4/A5

Current evidence:

- ADR-029 says Fill All / default path shipped, with Outlines, Use Cut Settings,
  DPI/default brightness, and transform handling still pending.
- `src/ui/raster/vector-to-bitmap.ts` currently uses a fixed conversion path.

LightBurn backing:

Convert to Bitmap supports Outlines, Fill All, Use Cut Settings, explicit DPI,
preview, and warns that conversion deletes/replaces vector graphics.

Fix shape:

- Dialog options: render type, DPI, keep original vs replace, target layer.
- Correctly bake or preserve rotation/mirror transforms so output remains
  burnable.
- Set resulting object to Image Mode with clear layer state.
- Ensure converted bitmap can pass Start/Frame/Save preflight.

Tests:

- Outlines render open and closed vector strokes.
- Fill All fills only closed shapes.
- Use Cut Settings respects Line vs Fill layers.
- Rotated/mirrored conversion previews and emits in the same placement.

### P1-8 Realign Trace Controls To LightBurn Vocabulary

Current evidence:

- ADR-030 proposes LightBurn-aligned trace controls.
- Current trace code has working source retention and worker timeout, but the UI
  still reflects LaserForge-specific presets more than LightBurn's trace
  vocabulary.

LightBurn backing:

Trace Image exposes cutoff, threshold, ignore less than, optimize, smoothness,
  boundary selection, fade image, show points, and preview navigation.

Fix shape:

- Rename and map trace controls to LightBurn vocabulary.
- Add boundary crop/selection.
- Add show-points preview option.
- Make smoothness/optimize tradeoff visible in point count / path count.
- Preserve "trace keeps source image" as LaserForge's default unless user opts
  to delete source.

Tests:

- Control changes update preview deterministically.
- Boundary crop traces only selected region.
- Accepted trace is linked to the source image revision and cannot commit from a
  stale preview.

### P1-9 Fix SVG Fill-Only Geometry Import Without Creating Dangerous Output

Current evidence:

- `src/io/svg/parse-svg-presentation-state.test.ts` currently expects fill-only
  geometry to be skipped.
- `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md` lists
  fill-only geometry as an accepted LightBurn-parity gap.

Why this matters:

Designs exported from common tools often use fills, not strokes. LightBurn
imports visible filled shapes as usable geometry. LaserForge silently dropping
them makes imports look broken.

Fix shape:

- Import fill-only closed shapes as fill-capable geometry on a layer set to
  Fill, not as black stroked cuts.
- Preserve hidden/transparent filtering already fixed.
- Warn for unsupported paint servers/masks/clip-paths rather than pretending
  they burned.

Tests:

- Fill-only rect/circle/path imports as fill geometry.
- Hidden fill-only objects remain skipped.
- Fill import preview and output agree.

### P1-10 Support SVG Units And Local Reuse

Current evidence:

- SVG parser reads `viewBox`, basic shapes, paths, and presentation state.
- Audit still lists physical units and local `<use>/<symbol>` as incomplete.
- Sanitizer strips external `href`/`xlink:href`, which is correct for security.

Why this matters:

Common SVGs depend on `width`/`height` units, `px`, `mm`, `in`, `cm`, and local
symbol reuse. Dropping these makes imported art the wrong size or incomplete.

Fix shape:

- Implement unit conversion with an explicit px-to-mm policy.
- Support local-only `<use href="#id">` after sanitization.
- Support `<symbol>` / `<defs>` expansion where local and safe.
- Keep external references stripped.

Tests:

- Unit fixtures for mm, cm, in, px, and viewBox-only.
- Local `<use>` duplicates geometry with transforms.
- External `href` stays stripped.

### P1-11 Add Material Calibration Workflow Only After Scope Approval

Current evidence:

- `PROJECT.md` currently lists material library / cut-test wizards as out of
  scope unless the project/ADR changes.
- LightBurn Material Test and Interval Test are core calibration workflows.
- User burn photos show real material variability and power/speed guesswork.

Why this matters:

LaserForge cannot produce perfect burns by code alone. It needs a calibration
path if it wants LightBurn-level practical quality.

Fix shape if approved:

- Start with a minimal Material Test generator, not a full material library.
- Generate small speed/power/interval/pass grids.
- Tie placement to Start From / Job Origin.
- Save presets only after the generator is proven.

Tests:

- Generated grid emits from lowest-risk boxes first.
- Labels and border settings are optional.
- Save G-code and Start use the same generated project.

Hardware verification:

- Run one wood/acrylic/cardboard test grid and record the chosen settings.

## P2 Workflow And Desktop Parity

### P2-1 Replace Dirty New/Open `confirm()` With Save / Don't Save / Cancel

Current evidence:

- `src/ui/common/Toolbar.tsx` still uses native confirm-style dirty handling.
- `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md` accepted this
  as a workflow gap.

Fix shape:

- Add a modal that offers Save, Don't Save, Cancel.
- Reuse for New, Open, Import destructive replace, and window close.
- Keep keyboard focus trapped and Escape mapped to Cancel.

Tests:

- Cancel preserves project.
- Save then New/Open continues only after save succeeds.
- Failed save blocks destructive action.

### P2-2 Block Global Shortcuts Behind Modals

Current evidence:

- `src/ui/app/use-shortcuts.ts` installs window-level shortcuts.
- Audits report shortcuts can mutate state while dialogs are open.

Fix shape:

- Add a single modal-open selector or command gate.
- Allow only modal-local shortcuts while dialogs are active.

Tests:

- Delete / New / Open / Duplicate do not fire behind Trace, Import, Text,
  Convert Bitmap, or dirty-save dialogs.

### P2-3 Build A Command Registry Before Expanding Menus

Current evidence:

- Toolbar, shortcuts, and future Electron menus risk diverging.
- LightBurn has a broad File/Edit/Tools/Arrange/Laser Tools menu surface.

Fix shape:

- Create command definitions with id, label, shortcut, enabled selector, action,
  and safety level.
- Bind toolbar buttons, keyboard shortcuts, and Electron/web menus from the same
  command table.
- Put Stop / E-stop-adjacent commands in a higher-priority safety class.

Tests:

- Command enabled state matches toolbar disabled state.
- Modal gate applies uniformly.

### P2-4 Numeric Transform, Align, Distribute, Snap, And Grouping

Current evidence:

- `WORKFLOW.md` Phase C is still a stub.
- `LIGHTBURN-STUDY.md` lists numeric edits, align/distribute, grid/circular
  arrays, shape properties, and grouping as LightBurn workflow gaps.

Scope note:

This is not safety-critical. It improves usability and makes imported artwork
less dependent on external design tools. Keep node editing, boolean operations,
and offset shapes governance-gated unless `PROJECT.md` changes.

Fix shape:

- Start with numeric X/Y/W/H/rotation controls and align/distribute for selected
  objects.
- Add snap/grid as a workspace preference.
- Add group/ungroup only if the scene model can represent grouped transforms
  without breaking output.

Tests:

- Transform edits preserve output geometry and selection.
- Align/distribute operations are undoable.
- Preview and compile agree after grouped transforms.

### P2-5 Improve Optimization Settings, But Keep It Honest

Current evidence:

- `src/core/job/optimize-paths.ts` reduces travel within layers.
- LightBurn Optimization Settings includes order-by-layer/group/priority,
  inner-first, reduce travel, direction order, best start point, and more.

Fix shape:

- First expose only settings we actually implement.
- Add cut-inner-shapes-first for closed vector cuts if geometry model supports
  containment reliably.
- Keep current reduce-travel optimization visible as a simple toggle if useful.
- Avoid claiming full LightBurn optimization parity.

Tests:

- Inner shape cuts before outer shape.
- Toggle off preserves user layer/object order.
- Preview and emitted order match.

## P3 Governance-Gated / Scope-Expansion Features

Do not implement these just because LightBurn has them. Create an ADR and update
`PROJECT.md` first.

- Full Material Library, saved material presets, manufacturer setting profiles.
- Node editing, boolean operations, weld, offset shapes, offset fill, and path
  cleanup tools.
- DXF, PDF, AI, and broader import formats.
- Camera alignment, rotary, Print & Cut, pass-through camera workflows.
- Tool layers, sub-layers, multi-process layer stacks.
- Kerf compensation, tabs, bridges, lead-in/out, perforation modes.
- Full LightBurn console/macros/run-machine-file workflows.
- System font inventory, full text-on-path, variable text.
- Grid array and circular array if they require new object/group semantics.

## Cross-Cutting Verification Bundle

Run this bundle after any P0/P1 implementation batch. Add focused tests for the
specific ticket first; this bundle is the final gate, not the only proof.

```powershell
pnpm run typecheck
npm.cmd run lint
pnpm test
npm.cmd run build
git diff --check HEAD
```

For image/raster/trace changes, also add:

```powershell
pnpm test src/core/raster
pnpm test src/core/trace
pnpm test src/ui/trace
pnpm test src/ui/raster
pnpm test src/ui/workspace
pnpm test src/io/gcode
pnpm test src/core/preflight
```

For serial/safety changes, also add:

```powershell
pnpm test src/core/controllers/grbl
pnpm test src/ui/state/laser-store.test.ts
pnpm test src/ui/state/laser-line-handler.test.ts
pnpm test src/ui/laser
```

For SVG/import changes, also add:

```powershell
pnpm test src/io/svg
pnpm test src/ui/common
pnpm test src/ui/state
```

## Recommended Implementation Order

1. P0-5 and P0-6: remove custom-origin Start and Frame compile-before-budget
   paths. This attacks the current "large image freezes before trace/output"
   class with the smallest high-confidence diff.
2. P0-7: guard/defer raster preview so canvas redraw cannot freeze the app.
3. P0-8: Convert to Bitmap dialog + budget + worker/deferred encoding.
4. P0-1 and P0-3: finish controller-error and write-failure recovery semantics
   now that the UI remains responsive enough to show them.
5. P0-4: Frame/Jog active lifecycle and stoppable controls.
6. HV-1 through HV-5: run hardware proof on the shipped burn-path fixes.
7. P1-2 through P1-4: layer order/reassignment and real Start From / Job Origin.
8. P1-5 through P1-8: image mode expansion, Adjust Image, Convert to Bitmap
   parity, and trace-control realignment.
9. P1-9 and P1-10: SVG fill/units/reuse import parity.
10. P2 workflow polish and command registry.
11. P3 scope expansions only after explicit ADR approval.

## Appendix: Markdown Inventory Reviewed

The inventory command was:

```powershell
rg --files -g "*.md" -g "!node_modules/**"
```

The resulting first-party Markdown set contained 63 files:

- `AUDIT.md`
- `AUDIT-2026-05-26-phase-b.md`
- `AUDIT-2026-05-27-phase-e.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `DECISIONS.md`
- `LIGHTBURN-STUDY.md`
- `PROJECT.md`
- `README.md`
- `RESEARCH_LOG.md`
- `WORKFLOW.md`
- `docs/REMAINING-WORK-ROADMAP-2026-06-04.md`
- `docs/research/burn-perfection-small-text.md`
- `docs/superpowers/plans/2026-06-01-fill-hatch-overscan.md`
- `audit/FILL-CHANGE-AUDIT-2026-06-03.md`
- `audit/FILL-SPEED-DIAGNOSIS-2026-06-03.md`
- `audit/LIGHTBURN-PARITY-AUDIT-2026-06-03.md`
- `audit/evidence/karpathy-stage0-closure-2026-06-02.md`
- `audit/evidence/karpathy-stage1a-serial-safety-2026-06-02.md`
- `audit/evidence/karpathy-stage1b-machine-origin-2026-06-02.md`
- `audit/evidence/karpathy-stage1c-autofocus-lifecycle-2026-06-02.md`
- `audit/evidence/karpathy-stage1d-webserial-cleanup-2026-06-03.md`
- `audit/evidence/karpathy-stage1e-electron-boundary-2026-06-03.md`
- `audit/evidence/karpathy-stage2a-fill-hatching-2026-06-03.md`
- `audit/evidence/karpathy-stage2b-duration-live-estimate-2026-06-03.md`
- `audit/evidence/karpathy-stage2c-preview-budget-2026-06-03.md`
- `audit/evidence/karpathy-stage3b-svg-presentation-state-2026-06-03.md`
- `audit/evidence/karpathy-stage3c-file-action-errors-2026-06-03.md`
- `audit/evidence/karpathy-stage3d-unknown-font-safety-2026-06-03.md`
- `audit/evidence/karpathy-stage4a-raster-cache-lifecycle-2026-06-03.md`
- `audit/evidence/karpathy-stage4b-autosave-reliability-2026-06-03.md`
- `audit/evidence/karpathy-stage4c-lazy-import-retry-2026-06-03.md`
- `audit/evidence/karpathy-stage5b-deploy-workflow-gate-2026-06-03.md`
- `audit/evidence/karpathy-stage5c-electron-source-maps-2026-06-03.md`
- `audit/evidence/karpathy-stage5d-test-policy-file-size-2026-06-03.md`
- `audit/evidence/lightburn-parity-codex-verification-2026-06-03.md`
- `audit/evidence/lightburn-tier0-fixes-2026-06-03.md`
- `audit/evidence/set-origin-research-2026-06-01.md`
- `audit/evidence/whole-repo-audit-evidence-2026-06-01.md`
- `audit/evidence/whole-repo-lightburn-parity-evidence-2026-06-04.md`
- `audit/external/online-audit-prompt-sources-2026-06-01.md`
- `audit/prompts/karpathy-image-to-burn-audit-prompt-2026-06-03.md`
- `audit/prompts/power-controller-audit-prompt-2026-06-01.md`
- `audit/prompts/whole-repo-audit-prompt-2026-06-01.md`
- `audit/prompts/whole-repo-lightburn-parity-audit-prompt-2026-06-04.md`
- `audit/reports/claude-change-audit-2026-06-04.md`
- `audit/reports/claude-p0-p1-audit-2026-06-03.md`
- `audit/reports/fill-hatch-overscan-plan-2026-06-01.md`
- `audit/reports/high-priority-image-burn-roadmap-plan-2026-06-03.md`
- `audit/reports/image-scan-freeze-audit-2026-06-01.md`
- `audit/reports/image-trace-bitmap-deep-research-2026-06-04.md`
- `audit/reports/karpathy-audit-fix-plan-2026-06-02.md`
- `audit/reports/karpathy-image-to-burn-audit-2026-06-03.md`
- `audit/reports/karpathy-whole-repo-audit-2026-06-02.md`
- `audit/reports/lightburn-build-gap-roadmap-2026-06-04.md`
- `audit/reports/lightburn-parity-audit-2026-06-02.md`
- `audit/reports/lightburn-parity-codex-verification-2026-06-03.md`
- `audit/reports/power-controller-audit-2026-06-01.md`
- `audit/reports/power-controller-post-fix-audit-2026-06-01.md`
- `audit/reports/set-origin-user-origin-audit-2026-06-01.md`
- `audit/reports/trace-provenance-cleanup-2026-06-03.md`
- `audit/reports/whole-repo-audit-2026-06-01.md`
- `audit/reports/whole-repo-lightburn-parity-audit-2026-06-04.md`
