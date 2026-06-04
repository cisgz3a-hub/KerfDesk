# Claude P0/P1 Roadmap Audit - 2026-06-03

## Superseding Update - 2026-06-03 23:38

Claude continued after the first draft of this report. Current state is:

- `c38c11a fix(raster): ADR-039 rapid across wide raster-row gaps` is committed.
- `ddb8e31 refactor(output): P1-C shared prepared-output (preview = burn)` is committed.
- `40761ca fix(import): P2-A readFileAsDataUrl fails at the read boundary` is committed.
- `50e23f3 feat(import): P2-A honor PNG/JPEG density (DPI) on image import` is committed.
- `94f5e9c fix(trace): P2-A guard stale trace-preview results` is committed.
- `c29c232 fix(trace): P2-A bound the trace worker with a 30s timeout` is committed.
- `35fb422 fix(import): P2-A resolve raster image-layer color collisions` is committed.
- The source tree is clean; only audit files are untracked.
- Latest verification on this worktree is green:
  - `pnpm run typecheck` passed.
  - Full `pnpm test` passed: 132 files / 971 tests.
  - `npm.cmd run lint` passed with the known boundaries-plugin legacy-selector warning.
  - `npm.cmd run build` passed with the known Vite dynamic-import chunking warnings.

This update supersedes the older "ADR-039 uncommitted" and "P1-C uncommitted"
language below. The current release risks are: the committed worker-timeout
change still has an overlapping-request policy edge, and two direct-compile
paths still bypass the P1-A raster budget guard.

## Scope

Repo audited: `C:\Users\Asus\LaserForge-2.0`

Branch: `wip/checkpoint-2026-06-03`

Commits audited:

- `b04b698 feat(preflight): P0-A long blank-feed invariant (blocks stale/marking g-code)`
- `eadc19b feat(export): P0-A provenance header on saved g-code exports`
- `e930ac3 feat(safety): P0-B.1 laser safety-notice state machine`
- `38f3433 feat(safety): P0-B.2 safety-notice banner in the laser panel`
- `c2329d7 feat(preflight): P1-A.1 raster pixel-budget guard (Save/Start)`
- `c87eaaf feat(ui): P1-A.2 live-estimate raster guard + resolution clamp`
- `c38c11a fix(raster): ADR-039 rapid across wide raster-row gaps`
- `ddb8e31 refactor(output): P1-C shared prepared-output (preview = burn)`
- `40761ca fix(import): P2-A readFileAsDataUrl fails at the read boundary`
- `50e23f3 feat(import): P2-A honor PNG/JPEG density (DPI) on image import`
- `94f5e9c fix(trace): P2-A guard stale trace-preview results`
- `c29c232 fix(trace): P2-A bound the trace worker with a 30s timeout`
- `35fb422 fix(import): P2-A resolve raster image-layer color collisions`

Additional audit files created:

- `audit/reports/claude-p0-p1-audit-2026-06-03.md`
- `audit/reports/high-priority-image-burn-roadmap-plan-2026-06-03.md`

No uncommitted production source changes remain.

## Findings

### P1 - Export provenance revision is stale after ADR-039

**Files:** `src/io/gcode/gcode-metadata.ts`

**Function/module:** `EMITTER_REVISION`, `gcodeMetadataHeader`.

**Evidence:** `EMITTER_REVISION` is still `adr-036-m4-fill-v1` at
`src/io/gcode/gcode-metadata.ts:23`, while `c38c11a` / ADR-039 changed raster
emission behavior by splitting wide white gaps into G0 rapids.

**Trigger:** Save G-code from the current codebase after ADR-039.

**Failure mode:** The saved header does not identify the raster gap-splitting
emitter. It can look like an older ADR-036 export even though the output shape is
different.

**Consequence:** Provenance no longer cleanly distinguishes stale pre-ADR-039
raster exports from fresh exports. This reopens part of the "local works, live or
old file differs" confusion class P0-A was meant to reduce.

**Severity:** Medium for auditability / release hygiene.

**Confidence:** High.

**Concrete fix:** Bump the revision to an ADR-039-specific value such as
`adr-039-raster-gap-split-v1`, update the metadata test if needed, and keep the
safety comment accurate for fill and raster blank-gap splitting.

### P1 - P1-A custom-origin Start can still compile a huge raster before the budget guard

**Files:** `src/ui/laser/start-job-readiness.ts`

**Function/module:** `prepareStartJob` -> `findOriginBoundsIssue`.

**Evidence:** `prepareStartJob` calls `findOriginBoundsIssue` before `emitGcode`.
`findOriginBoundsIssue` calls `compileJob(project.scene, project.device)` directly
at `src/ui/laser/start-job-readiness.ts:100`.

**Trigger:** A custom work origin is active, the project contains an over-budget raster image, and the operator clicks Start.

**Failure mode:** `compileJob` allocates/resamples/dithers the raster before `runPreEmitPreflight` inside `emitGcode` can reject the job.

**Consequence:** The P1-A freeze fix is bypassed for custom-origin Start.

**Severity:** High for reliability; safety-adjacent because it can freeze the operator UI before a job decision.

**Confidence:** High.

**Concrete fix:** Run `runPreEmitPreflight(project)` before `findOriginBoundsIssue`, or replace `findOriginBoundsIssue` with a cheap bounds path that never compiles raster data. Add a regression test: custom origin + 300x300 mm image at 25 lines/mm returns `raster-too-large` without calling full raster compile.

### P1 - Frame can still compile a huge raster directly

**Files:** `src/ui/laser/JobControls.tsx`

**Function/module:** `useFrameAction`.

**Evidence:** `useFrameAction` calls `compileJob(project.scene, project.device)`
directly before frame bounds calculation at `src/ui/laser/JobControls.tsx:247`.

**Trigger:** Project contains an over-budget raster image and the operator clicks Frame.

**Failure mode:** Frame bypasses P1-A pre-emit budget checks.

**Consequence:** App can still freeze on a large raster through the Frame path.

**Severity:** Medium-High for reliability.

**Confidence:** High.

**Concrete fix:** Check `runPreEmitPreflight(project)` at the start of `useFrameAction`, or compute frame bounds through a cheap raster-bounds helper. Add a UI/core test for over-budget raster Frame refusal.

### P2 - Active-job Disconnect soft-reset failure is swallowed

**Files:** `src/ui/state/laser-store.ts`

**Function/module:** `connectionActions.disconnect`.

**Evidence:** In `disconnect`, an active job first attempts `RT_SOFT_RESET`; on
write failure it sets `writeFailedNotice('disconnect')` at
`src/ui/state/laser-store.ts:290`, then continues to teardown/close and does not
rethrow. It later sets `streamer: null` and `lastWriteError: null`.

**Trigger:** User clicks Disconnect during a running job while the serial write fails.

**Failure mode:** Caller cannot observe that the safety reset failed; state is collapsed to disconnected/null streamer.

**Consequence:** The banner warns correctly, but the app hides the failed-command result and loses active-job evidence. This diverges from the roadmap instruction to set a notice and rethrow.

**Severity:** Medium.

**Confidence:** High.

**Concrete fix:** Decide policy explicitly. If Disconnect should proceed after failure, keep the banner but preserve evidence (`lastWriteError`, disconnected streamer ledger). If it should follow the roadmap, rethrow after setting the notice and add a regression test.

### P2 - Motion/action write failures outside Pause/Resume/Stop/Disconnect do not raise persistent safety notices

**Files:** `src/ui/state/laser-store.ts`, `src/ui/laser/JobControls.tsx`

**Function/module:** `LaserSafetyNotice`, `jogActions`, `originActions`,
`SetupRow`, `OriginRow`.

**Evidence:** `LaserSafetyAction` includes `frame`, `origin`, `jog`, and `home`,
but the store only calls `writeFailedNotice` for pause/resume/stop/disconnect.
UI paths such as `void setOrigin().then(...)` at `JobControls.tsx:68`,
`void resetOrigin().then(...)` at `JobControls.tsx:71`, `void home()` at
`JobControls.tsx:122`, and `void frame(bounds, feed)` at `JobControls.tsx:276`
do not catch failures.

**Trigger:** Serial write fails during Home, Frame, Jog, Set Origin, Reset Origin, or Autofocus.

**Failure mode:** Failure may only be logged/recorded as `lastWriteError`; some UI paths can produce unhandled promise rejections and no persistent physical-stop warning.

**Consequence:** P0-B is not complete as a general safety-alert path.

**Severity:** Medium.

**Confidence:** Medium-High.

**Concrete fix:** Wrap every UI motion action in a handler that catches, lets the store set the appropriate notice, and shows a toast/alert. Extend store wrappers to call `writeFailedNotice` for the action types already modeled.

### P2 - Start button copy is stale for over-budget raster jobs

**Files:** `src/ui/laser/JobControls.tsx`, `src/ui/laser/live-job-estimate.ts`

**Function/module:** `startJobTitle`, `estimateLiveJob`.

**Evidence:** `estimateLiveJob` now returns `too-large` when `prepareOutput`
rejects an over-budget raster, but `startJobTitle` still says, "Large trace:
live estimate paused for performance. Start still generates full G-code" at
`src/ui/laser/JobControls.tsx:168`.

**Trigger:** Over-budget raster image in the scene.

**Failure mode:** UI says Start still generates full G-code, but Start now blocks through preflight.

**Consequence:** Operator-facing copy is misleading.

**Severity:** Low-Medium.

**Confidence:** High.

**Concrete fix:** Split `LiveJobEstimate.too-large` into reasoned variants, e.g. `vector-too-large-for-live-estimate` vs `raster-too-large-for-output`, and change title/badge text accordingly.

### P2 - P1-C prepared-output work is committed but incomplete

**Files:** `src/io/gcode/prepare-output.ts`, `src/io/gcode/emit-gcode.ts`,
`src/ui/laser/live-job-estimate.ts`, `src/ui/workspace/draw-preview.ts`,
`src/ui/laser/start-job-readiness.ts`, `src/ui/laser/JobControls.tsx`

**Function/module:** shared prepared-output pipeline.

**Evidence:** `ddb8e31` adds `prepareOutput`, centralizing pre-emit budget guard,
compile, optional origin placement, and optimize. `emitGcode`, `estimateLiveJob`,
and `buildPreviewToolpath` use it. However, `findOriginBoundsIssue` and
`useFrameAction` still call `compileJob` directly, so P1-C is not yet the shared
pipeline for every output-facing path promised by the roadmap.

**Trigger:** Custom-origin Start or Frame on a raster job that should be rejected
by pre-emit budget.

**Failure mode:** The app can still allocate/raster-compile before the guard.

**Consequence:** Another path can still freeze the UI even though Save/normal
Start/live-estimate are protected.

**Severity:** Medium-High.

**Confidence:** High.

**Concrete fix:** Finish P1-C by routing custom-origin bounds and Frame through
`prepareOutput` or a cheaper raster-safe bounds path. Add regression tests for
custom-origin Start and Frame with a 300 x 300 mm image at 25 lines/mm.

### P2 - Worker timeout path delays sibling request settlement

**Files:** `src/ui/trace/use-trace-worker-client.ts`,
`src/ui/trace/use-trace-worker-client.test.ts`

**Function/module:** `traceInWorker`.

**Evidence:** `c29c232` adds `TRACE_WORKER_TIMEOUT_MS` and a timer in
`traceInWorker`. On timeout it deletes only the timed-out request, calls
`retireWorker()`, and rejects that one promise. The test suite now covers a
single hung request timing out and worker reconstruction, but not overlapping
pending requests.

**Trigger:** Two overlapping worker trace requests are pending and one request
times out.

**Failure mode:** The worker is terminated, but sibling pending requests remain
in `pendingByRequestId` until their own 30 second timers fire. They are not
rejected immediately when the shared worker is retired.

**Consequence:** The new timeout path prevents an indefinite hang, which is good,
but overlapping preview/commit calls can still sit busy for the remainder of
their timeout window.

**Severity:** Medium.

**Confidence:** Medium-High.

**Concrete fix:** Add an overlapping-request fake-timer test. Either reject all
pending requests immediately when retiring the shared worker, or keep the worker
alive per request; test the chosen policy.

## Positive Findings

- P0-A long blank-feed invariant is covered by unit and preflight tests.
- P0-A provenance header is injected only when metadata is passed; deterministic body output remains available. The current emitter revision value is stale after ADR-039 and needs a bump before release.
- P1-A `emitGcode` runs `runPreEmitPreflight` before `compileJob` on the normal Save/Start path.
- P1-A live estimate now short-circuits over-budget rasters before compile via `prepareOutput`.
- P0-B cable-yank during active job raises a persistent `disconnect-during-job` notice.
- P0-B Pause/Resume/Stop write failures preserve streamer state and raise persistent notices.
- ADR-039 raster row splitter is now committed: wide white row gaps become G0 rapid moves, small gaps remain feed-blanked, and the P0-A blank-feed invariant agrees on the focused raster case.
- P1-C preview/output parity test confirms preview toolpath order is built from the same optimized prepared job for the default-origin case.
- P2-A `readFileAsDataUrl` boundary fix in `40761ca` is correct directionally: non-string `FileReader.result` now rejects instead of silently storing an empty image, and it has a regression test.
- P2-A density parser tests cover PNG `pHYs`, JFIF DPI, JFIF dots/cm, and no-metadata fallback; the wiring passes parsed density into `rasterImportGeometry`.
- P2-A stale trace-preview guard in `94f5e9c` checks the latest token after async trace success/failure and has focused tests for stale ready/error suppression.
- P2-A worker-timeout implementation builds and has a fake-timer timeout test; the remaining gap is sibling pending-request policy.
- P2-A image-layer collision fix in `35fb422` gives imported rasters a unique image-mode layer color when `#808080` is already used by a non-image layer, with focused tests.

## Verification

Focused tests run in the latest audit pass:

```powershell
pnpm test --run src/io/gcode/prepare-output.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/workspace/draw-preview.parity.test.ts src/core/raster/emit-raster.test.ts src/core/raster/emit-raster.property.test.ts src/core/preflight/pre-emit.test.ts src/core/invariants/blank-feed.test.ts src/ui/state/laser-store.test.ts src/ui/laser/SafetyNoticeBanner.test.tsx src/ui/laser/LaserWindow.test.tsx
```

Result: 11 test files passed, 70 tests passed.

Whole-repo verification run in the latest audit pass:

- `pnpm run typecheck` passed.
- `pnpm test` passed: 132 files / 971 tests.
- `npm.cmd run lint` passed with the known boundaries-plugin legacy-selector warning.
- `npm.cmd run build` passed with known Vite dynamic-import chunking warnings.

Not verified:

- Browser smoke test.
- Hardware burn.
- Perceptual comparison of the imported/traced source against the new output.

## Roadmap Verdict

- P0-A: mostly correct, minor provenance/mode-model cleanup needed.
- P0-B: partial, not 100% complete.
- P1-A: partial, normal path fixed but custom-origin Start and Frame still bypass the guard.
- P1-B/ADR-039: code committed and tests pass; hardware verification still pending.
- P1-C: promising and green, but incomplete because Start custom-origin bounds and Frame still bypass `prepareOutput`.
- P2-A density metadata + stale preview guard: directionally correct and green under tests/lint/build.
- P2-A worker timeout: useful but not complete until overlapping-request behavior is tested.
