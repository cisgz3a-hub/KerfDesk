# Whole-Repo LightBurn Parity Audit - 2026-06-04

## Scope

This audit compared the current LaserForge 2.0 checkout (`wip/checkpoint-2026-06-03`, HEAD observed as `cdc8f7c`) against the repo spec (`CLAUDE.md`, `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`), current LightBurn workflow docs, GRBL interface docs, and the code under `src/`, `electron/`, `platform/`, and `io/`.

No production code was changed. All new files are audit artifacts under `audit/`.

## What Was Verified

- `C:\Users\Asus\LaserForge-2.0` is the active repo. `C:\Users\Asus\LaserForge` was not a Git repo in this session.
- The audit-specific docs named in the old `AGENTS.md` contract are not present in this checkout under `docs/`; the repo-local sources of truth are root-level `AUDIT.md`, `PROJECT.md`, `DECISIONS.md`, `WORKFLOW.md`, and `CLAUDE.md`.
- Source inventory was classified with a generated ledger from `git ls-files src`.
- Current high-risk image/raster/trace code paths were rechecked rather than copied from stale reports.
- Stale claims were rejected when ADR-035 through ADR-040 or tests had already closed them.

## Accepted Findings

### P0 - Streaming error can continue a job after GRBL rejected a line

- Path: `src/ui/state/laser-line-handler.ts:146-148`, `src/core/controllers/grbl/streamer.ts:129-153`
- Trigger: GRBL returns `error:N` while a job stream is active.
- Failure mode: `laser-line-handler.ts` records `lastError` but still calls `advanceStream(..., 'error')`; `streamer.ts` treats `error` as an acknowledgement and advances the in-flight queue.
- Consequence: a rejected setup/motion/modal line can be followed by additional laser-on lines. LightBurn-style job control treats controller errors as operator-visible job failures, not as normal progress.
- Fix: split `ok` from `error`/`alarm` in live streaming. On `error`, stop further writes, mark the job failed/unsafe, surface the exact rejected line and GRBL code, and keep Stop/recovery visible. Add regression tests for `error:24` or `error:15` during a running stream.

### P0 - Follow-up stream write failure hides Stop without warning

- Path: `src/ui/state/laser-line-handler.ts:166-172`, `src/ui/laser/JobControls.tsx`
- Trigger: an ack arrives, LaserForge steps the streamer, then the next `safeWrite(stepped.toSend)` rejects.
- Failure mode: catch handler sets `streamer: disconnectStreamer(acked.state)` without a safety notice, without attempting soft reset, and without preserving an active running-job recovery state.
- Consequence: GRBL may still execute already-buffered commands while the UI has left the normal streaming state. This conflicts with the repo non-negotiable "E-stop reachable always" and LightBurn job-control guidance that software Stop is not the only stop method.
- Fix: route this catch through the disconnect-during-job recovery path: preserve active job evidence, warn that buffered motion may continue, keep Stop/physical E-stop guidance visible, and only collapse the streamer after an explicit recovery state exists.

### P1 - Convert to Bitmap can freeze the renderer before any budget gate

- Path: `src/ui/raster/vector-to-bitmap.ts:52-67`, `src/ui/raster/luma-bitmap.ts:37-82`, `src/ui/common/Toolbar.tsx`
- Trigger: operator selects a complex/large vector and clicks Convert to Bitmap.
- Failure mode: rasterization and PNG encoding run synchronously in the UI thread at 254 DPI, then `canvas.toDataURL()` creates a full base64 string in memory.
- Consequence: screen freeze or memory spike before the app can show a budget warning. MDN warns `toDataURL()` encodes the whole image into an in-memory string; this is the wrong primitive for large bitmaps.
- Fix: add a pre-convert pixel budget before rasterization, move rasterize+encode to a Worker or chunked pipeline, and switch production encode to `toBlob()`/object URL where possible. Keep a small deterministic unit path for tests.

### P1 - Raster Preview bypasses the shared output budget

- Path: `src/ui/workspace/draw-raster-preview.ts:85-121`
- Trigger: Preview mode on a large image-mode layer.
- Failure mode: preview decodes luma, resamples, dithers, builds RGBA, creates an offscreen canvas, and calls `putImageData` without first using the shared pre-emit raster budget.
- Consequence: the app can freeze in the operator preview path even if save/start are guarded. LightBurn Preview is expected to be an inspection tool; it should not be the path that locks the UI.
- Fix: route preview raster sizing through the same budget policy used by `prepareOutput`; degrade to a bounded preview thumbnail or a "preview too large" overlay instead of doing full work.

### P1 - Custom-origin Start compiles raster before the pre-emit guard

- Path: `src/ui/laser/start-job-readiness.ts:94-104`
- Trigger: custom origin active, large image/raster in project, Start clicked.
- Failure mode: `findOriginBoundsIssue` calls `compileJob(project.scene, project.device)` directly before `prepareOutput` / `runPreEmitPreflight`.
- Consequence: the exact Start path that should be safety-first can still spend CPU/memory compiling a huge raster before rejecting it.
- Fix: make readiness accept prepared output or a cheap geometry/raster-budget summary. Do not call raw `compileJob` from UI readiness.

### P1 - Frame compiles raster before the pre-emit guard

- Path: `src/ui/laser/JobControls.tsx:240-276`
- Trigger: Frame clicked on a scene containing large raster/image-mode work.
- Failure mode: `useFrameAction` calls raw `compileJob` to compute bounds, then checks frame preflight.
- Consequence: Frame can freeze before it moves or warns. LightBurn's Frame is a quick perimeter motion, not a full raster compile.
- Fix: compute frame bounds from scene geometry with raster bounds included, or call a cheap prepared-bounds path that rejects over-budget raster before compile.

### P1 - SVG fill-only geometry is still dropped

- Path: `src/io/svg/parse-svg.ts:8-10`, `src/io/svg/parse-svg.test.ts:58-65`
- Trigger: importing common logo/SVG artwork with `fill` but no `stroke`.
- Failure mode: parser intentionally skips elements without stroke; tests pin fill-only SVGs as `object=null`.
- Consequence: common LightBurn import workflows lose artwork or import it as blank. After Fill/Image modes shipped, "fill-only is not line mode" is no longer sufficient.
- Fix: import fill geometry into a layer color derived from `fill`, with mode/default behavior matching LightBurn: fill-capable closed geometry should survive import, and line-mode output can still be mode-driven later.

### P1 - SVG physical units and local reuse are incomplete

- Path: `src/io/svg/parse-svg.ts:94-103`, `src/io/svg/sanitize.test.ts:46-56`
- Trigger: SVG uses `width="4in"`, `height="100mm"`, `<symbol>`, or local `<use href="#id">`.
- Failure mode: width/height use `Number.parseFloat` and local `use` expansion is not implemented.
- Consequence: imported physical size and repeated logo elements can diverge from LightBurn/user expectation.
- Fix: parse SVG length units at import boundary and implement a sanitized local-use expander for internal references only.

### P1 - Output layer order cannot be controlled

- Path: `src/core/job/compile-job.ts:9-44`, `src/core/job/optimize-paths.ts:48-49`, `src/ui/layers/CutsLayersPanel.tsx`
- Trigger: operator wants to engrave/fill before cut, or reorder layers like LightBurn Cuts/Layers.
- Failure mode: compile iteration follows `scene.layers`; UI has no reorder surface.
- Consequence: mixed jobs cannot be sequenced with LightBurn-level operator control. This is especially important for image/fill/cut combinations.
- Fix: add explicit layer order to scene/project, expose drag/reorder in Cuts/Layers, and keep compile/order snapshots pinned.

### P1 - Start From / Job Origin is hardcoded compared with LightBurn

- Path: `src/ui/laser/start-job-readiness.ts`, `src/core/job/job-origin.ts`, `WORKFLOW.md F-F3`
- Trigger: operator wants LightBurn-style "Start From" and "Job Origin" choices.
- Failure mode: custom origin currently uses a fixed `USER_ORIGIN_JOB_PLACEMENT` model.
- Consequence: valid LightBurn workflows such as current-position anchoring and nine-point job-origin selection are not yet represented.
- Fix: model Start From and Job Origin as explicit settings, include them in preview/frame/start, and test bounds under each origin.

### P2 - Dirty New/Open has discard-only confirm instead of Save/Don't Save/Cancel

- Path: `src/ui/common/Toolbar.tsx:19-28`, `src/ui/common/Toolbar.tsx:86-101`
- Trigger: dirty project, user clicks New or Open.
- Failure mode: native confirm only offers discard/cancel and tells the user to save first.
- Consequence: LightBurn-style file workflow is interrupted, and users can lose work if they confirm too quickly.
- Fix: replace native confirm with an app modal: Save, Don't Save, Cancel. Reuse the existing save action.

### P2 - Keyboard shortcuts can mutate state behind modals

- Path: `src/ui/app/use-shortcuts.ts:68-106`, `src/ui/trace/ImportImageDialog.tsx:115-143`
- Trigger: Trace dialog or another modal is open; operator presses global shortcut keys.
- Failure mode: global window listeners do not appear modal-scoped.
- Consequence: delete/escape/preview shortcuts can conflict with modal operation.
- Fix: add modal-stack or dialog-active gating around global shortcuts; tests should prove Delete/Preview cannot mutate scene while trace modal owns focus.

### P2 - Raster ETA still underestimates wide-gap raster output

- Path: `src/core/job/estimate-duration.ts:67-122`, `src/core/raster/emit-raster.ts:110-123`
- Trigger: raster row with two or more separated ink islands.
- Failure mode: emitter splits wide blank gaps into multiple spans, but duration estimate still converts each row into one active span.
- Consequence: ETA is too optimistic after ADR-039.
- Fix: share the raster active-spans function or mirror it in the estimator with tests using a two-island row.

### P2 - Menu command surface is incomplete

- Path: `electron/main.ts`, `src/ui/common/Toolbar.tsx`, `PROJECT.md`, `WORKFLOW.md`
- Trigger: desktop operator expects LightBurn-like File/Edit/Laser commands.
- Failure mode: many actions are toolbar-only; Electron menu coverage is thin.
- Consequence: desktop UX diverges from LightBurn and keyboard discoverability is weak.
- Fix: define an app command registry and bind toolbar, menus, and shortcuts to the same command IDs.

### P3 - Audit contract/docs drift across repo versions

- Path: `AGENTS.md` instructions supplied for `C:\Users\Asus\LaserForge`, root files in `C:\Users\Asus\LaserForge-2.0`
- Trigger: agent starts in `LaserForge` while work belongs to `LaserForge-2.0`.
- Failure mode: old audit-doc paths do not exist in 2.0; multiple similarly named folders create deployment/review risk.
- Consequence: high chance of auditing or deploying the wrong repo.
- Fix: add a root `AGENTS.md` in `LaserForge-2.0`, keep `scripts/assert-correct-repo.mjs`, and make every deploy/audit script print the repo path, remote, branch, and HEAD before proceeding.

## Stale Or Rejected Findings

- Trace stale-source commit: current `ImportImageDialog.tsx` revalidates the source before applying trace.
- Raster wide-gap burn line: ADR-039 split wide blank spans in `emit-raster.ts`; residual issue is estimator/preview parity, not emitted raster safety.
- Fill M3 constant power: ADR-036 moved fill to M4; hardware still needs verification, but the code path is no longer M3-only.
- Preview raw compile/order drift: `prepareOutput` now unifies save/start/preview/estimate for the main output path; remaining direct compiles are Frame/custom-origin readiness.
- "No network" broad claim: no direct telemetry/cloud calls were found in `src`; font fetches are local asset fetches. Keep policy tests, but do not call this a confirmed network leak.

## Verification

- Already observed before writing these audit artifacts: `pnpm run typecheck`, `npm.cmd run lint`, `npm.cmd run check:file-size`, `npm.cmd run license-check`, `pnpm test`, `npm.cmd run build`, and `git diff --check HEAD` passed.
- `pnpm exec prettier --check .` failed on 12 pre-existing files listed in the evidence ledger; that is not caused by the audit artifacts.
- After artifact creation, re-run focused checks on the new audit files before implementation starts.

## Bottom Line

LaserForge 2.0 has made real progress on the image-to-burn path: trace source revalidation, fill M4, raster wide-gap splitting, and shared prepared output are meaningful fixes. The next work should not be more tracing algorithm churn. The next work should be safety/error-state handling and freezing paths: GRBL `error:` handling, write-failure recovery, Convert-to-Bitmap budgets/workers, Raster Preview budgets, and removing direct `compileJob` from Frame/custom-origin readiness.
