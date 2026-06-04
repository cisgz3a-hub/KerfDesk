# Claude Change Audit - 2026-06-04

## Scope

Repo audited: `C:\Users\Asus\LaserForge-2.0`

Branch audited: `wip/checkpoint-2026-06-03`

Current HEAD: `cdc8f7c fix(trace): P2-A revalidate the source before committing a trace`

This report re-audits Claude's latest changes and includes the earlier Claude
changes audited before this pass. It is audit-only: no production source was
patched during this audit.

Repo-local rules used:

- `CLAUDE.md`
- root `AUDIT.md`
- current roadmap/audit artifacts in `audit/reports`

External behavior references checked:

- LightBurn Image Mode: image engraving uses raster scan behavior, line interval,
  DPI, overscanning, and scan angle settings.
- LightBurn Fill Mode: fill scans closed areas with line interval / lines per
  inch controlling row spacing.
- LightBurn Preview: preview should represent what will be sent to the laser,
  including cut order and rapid/travel moves.
- LightBurn Job Control: software Stop must not be the only physical stop path.

## Verification Run

Current verification on this worktree:

- `pnpm run typecheck` passed.
- `npm.cmd run lint` passed with the known boundaries-plugin legacy-selector
  warning.
- `pnpm test` passed: 133 files / 979 tests.
- `npm.cmd run build` passed. Vite still warns that two dynamically imported
  modules are also statically imported, so those imports will not create separate
  chunks.

Current dirty state:

- No uncommitted production source changes.
- Only audit artifacts are untracked.

## Verdict

Claude's latest changes are mostly correct and materially improve the
image-to-burn workflow. They are not 100% complete.

The biggest remaining issue is not the core trace algorithm anymore. The weak
spot is coverage of every output-facing path. Normal Save/Start/live-estimate
now use the new prepared-output/raster-budget path, but custom-origin Start and
Frame still call `compileJob()` directly and can bypass the large-raster freeze
guard.

## Findings

### P1 - Custom-origin Start still bypasses the raster budget guard

**File:** `src/ui/laser/start-job-readiness.ts`

**Function/module:** `prepareStartJob` -> `findOriginBoundsIssue`

**Evidence:** `prepareStartJob` calls `findOriginBoundsIssue` before `emitGcode`.
`findOriginBoundsIssue` calls `compileJob(project.scene, project.device)`
directly at `src/ui/laser/start-job-readiness.ts:100`.

**Trigger path:** Custom work origin active, over-budget raster image in the
project, operator clicks Start.

**Failure mode:** The direct `compileJob()` path can allocate/resample/dither the
raster before `runPreEmitPreflight()` inside `emitGcode()` gets a chance to
reject it.

**Consequence:** The P1-A "fix the app freeze after image scan/job" work can
still be bypassed for custom-origin Start.

**Severity:** High

**Confidence:** High

**Concrete fix:** Run pre-emit raster budget before origin bounds, or replace
`findOriginBoundsIssue` with a cheap bounds path that uses `rasterBoundsInMachineCoords`
instead of compiling. Add a regression for custom-origin Start with a 300 x 300
mm image at 25 lines/mm.

### P1 - Frame still bypasses the raster budget guard

**File:** `src/ui/laser/JobControls.tsx`

**Function/module:** `useFrameAction`

**Evidence:** `useFrameAction` calls `compileJob(project.scene, project.device)`
directly at `src/ui/laser/JobControls.tsx:247`.

**Trigger path:** Over-budget raster image in the project, operator clicks Frame.

**Failure mode:** Frame can allocate the same raster compile path that P1-A was
trying to block before allocation.

**Consequence:** A user can still freeze the app through Frame even if Save,
normal Start, preview, and live estimate are guarded.

**Severity:** High

**Confidence:** High

**Concrete fix:** Route Frame bounds through `prepareOutput()` or a cheap
raster-safe bounds helper. Add a UI/core regression proving Frame refuses an
over-budget raster without compiling it.

### P1 - G-code emitter provenance is stale after ADR-039

**File:** `src/io/gcode/gcode-metadata.ts`

**Function/module:** `EMITTER_REVISION`

**Evidence:** `EMITTER_REVISION` is still `adr-036-m4-fill-v1` at
`src/io/gcode/gcode-metadata.ts:23`, while `c38c11a` / ADR-039 changed raster
emission by splitting wide blank raster row gaps into `G0` rapid moves.

**Trigger path:** Save G-code from current source after ADR-039.

**Failure mode:** The saved file header says the emitter is ADR-036-era even
though the raster output shape is newer.

**Consequence:** Fresh post-ADR-039 output can be confused with older output,
which weakens the whole provenance fix.

**Severity:** Medium

**Confidence:** High

**Concrete fix:** Bump to an ADR-039-specific revision such as
`adr-039-raster-gap-split-v1`, and update the metadata header test.

### P2 - Active-job Disconnect soft-reset failure is swallowed

**File:** `src/ui/state/laser-store.ts`

**Function/module:** `connectionActions.disconnect`

**Evidence:** If a job is active, `disconnect` attempts `RT_SOFT_RESET`. If that
write fails, it sets `writeFailedNotice('disconnect')`, then continues teardown,
closes the connection, sets `streamer: null`, and clears `lastWriteError`.

**Trigger path:** User clicks Disconnect during a running job and the soft-reset
write fails.

**Failure mode:** The banner warns, but the caller cannot tell that the safety
write failed and the active-job evidence is collapsed.

**Consequence:** This is safer than silent failure, but weaker than the proposed
plan. It can make post-incident diagnosis harder.

**Severity:** Medium

**Confidence:** High

**Concrete fix:** Decide explicit product policy. If disconnect should proceed,
preserve evidence in state/logs. If it should reject, rethrow after setting the
notice and add a regression.

### P2 - Safety notices are only partially wired

**Files:** `src/ui/state/laser-store.ts`, `src/ui/laser/JobControls.tsx`

**Function/module:** `LaserSafetyNotice`, `jogActions`, `originActions`,
`SetupRow`, `OriginRow`

**Evidence:** `LaserSafetyAction` includes actions such as `frame`, `origin`,
`jog`, and `home`, but persistent `writeFailedNotice(...)` calls are present for
pause, resume, stop, and disconnect only. UI paths such as Home, Frame, Set
Origin, Reset Origin, and Autofocus still use fire-and-forget or `.then(...)`
without a consistent persistent safety notice.

**Trigger path:** Serial write fails during Home, Frame, Jog, Set Origin, Reset
Origin, or Autofocus.

**Failure mode:** Some failures become `lastWriteError`/logs, some can become
unhandled promise paths, but they do not consistently raise the physical-stop
banner.

**Consequence:** P0-B is useful but incomplete.

**Severity:** Medium

**Confidence:** Medium-High

**Concrete fix:** Add store-level wrappers that set `writeFailedNotice()` for
every modeled safety action, and make the UI catch/display the result consistently.

### P2 - Worker timeout does not immediately settle sibling pending requests

**File:** `src/ui/trace/use-trace-worker-client.ts`

**Function/module:** `traceInWorker`

**Evidence:** On timeout, the code deletes only that request id, retires the
shared worker, and rejects only that promise. Any sibling request pending on the
same worker remains in `pendingByRequestId` until its own 30 second timer fires.

**Trigger path:** Two overlapping worker trace requests are pending and one
times out.

**Failure mode:** The worker has been terminated, but other callers can remain
busy until their own timers expire.

**Consequence:** The timeout fix prevents indefinite hangs, but overlapping
preview/commit calls can still feel stuck for up to the timeout window.

**Severity:** Medium

**Confidence:** Medium-High

**Concrete fix:** Add an overlapping-request fake-timer test. Either reject all
pending requests immediately on worker retirement, or isolate worker lifetime per
request. Pick one policy and pin it.

### P2 - Over-budget raster Start tooltip is stale

**File:** `src/ui/laser/JobControls.tsx`

**Function/module:** `startJobTitle`

**Evidence:** The `too-large` live-estimate state now also means an over-budget
raster will be blocked, but the title still says: `Large trace: live estimate
paused for performance. Start still generates full G-code.`

**Trigger path:** Over-budget raster image in the scene.

**Failure mode:** UI copy says Start still generates G-code even though Start
should now block through preflight.

**Consequence:** Operator-facing copy is misleading.

**Severity:** Low-Medium

**Confidence:** High

**Concrete fix:** Split `too-large` into reasoned variants, for example
`vector-too-large-for-live-estimate` and `raster-too-large-for-output`, and show
different copy.

## Accepted Changes

The following changes reviewed correctly under code/test audit. Some still need
hardware or browser verification before being called fully proven.

| Commit | Area | Audit verdict |
|---|---|---|
| `0244350` | tracing, raster, laser safety hardening baseline | Large mixed change; many later commits refine it. Do not treat this commit alone as final proof. |
| `66c04bb` | trace worker CSP | Correct direction; CSP policy tests cover worker allowance. |
| `59fb66c` | local data URL decode | Correct direction; image-loader tests cover data URL handling. |
| `2326809` | bundle trace worker for large images | Correct direction; build now emits `trace-worker-*.js`. Later timeout/source checks strengthen it. |
| `47e199b` | ADR-034 continuous-sweep fill with S0 blanked gaps | Directionally correct; later commits add guards and gap rapid fixes. |
| `23d66c6` | default hatch spacing 0.2 -> 0.1 mm | LightBurn-compatible direction for small fill detail, but material tuning still matters. |
| `10edbb3` | zero-length/coincident fill span guard | Correct direction; output tests cover the guard. |
| `70e8745` | extra continuous-sweep fill coverage | Correct direction; adds audit-backed tests. |
| `bf133f5` | ADR-035 rapid across large fill gaps | Correct direction for the stray-line class. |
| `4119a39` | ADR-036 M4 dynamic power for fill | Directionally plausible for small text density; requires hardware/material verification. |
| `a2672cc` | trace decode cap 1024 -> 2048 | Correct direction for small-text fidelity, but perceptual/source comparison is still needed. |
| `e0679c7` | per-layer unidirectional fill option | Correct direction; useful for engraving consistency. |
| `b04b698` | P0-A long blank-feed invariant | Correct direction; invariant tests and preflight tests pass. |
| `eadc19b` | P0-A provenance header | Correct direction, but `EMITTER_REVISION` is now stale after ADR-039. |
| `e930ac3` | P0-B safety-notice state machine | Correct but partial; not all motion writes are wired. |
| `38f3433` | P0-B safety banner | Correct direction; banner tests pass. |
| `c2329d7` | P1-A raster pixel-budget guard | Correct for normal output path; custom-origin Start and Frame bypass remain. |
| `c87eaaf` | live-estimate raster guard/resolution clamp | Correct direction; live-estimate tests pass, but copy is stale for blocked rasters. |
| `c38c11a` | ADR-039 raster row gap rapid split | Correct direction; raster tests/property tests pass. Needs hardware spot check for faint gap marking. |
| `ddb8e31` | shared prepared-output | Correct for preview/default-origin Save/Start/estimate; incomplete for Frame/custom-origin Start. |
| `40761ca` | readFileAsDataUrl rejects non-string read results | Correct; image-loader regression test covers it. |
| `50e23f3` | PNG/JPEG DPI import | Correct direction; parser tests cover PNG pHYs, JFIF DPI, JFIF dots/cm, and fallback. |
| `94f5e9c` | stale trace-preview guard | Correct; stale success/error tests pass. |
| `c29c232` | trace worker 30s timeout | Useful; single hung worker test passes. Overlapping pending behavior remains open. |
| `35fb422` | raster image-layer color collision | Correct; imported rasters no longer land on existing non-image gray layers. |
| `cdc8f7c` | revalidate trace source before commit | Correct; commit now refuses if the bitmap source was removed or content/pixel grid changed mid-dialog. |

## Cross-Reference To LightBurn Behavior

- Image-mode fixes are aligned with LightBurn's image model: raster engraving is
  controlled by line interval / DPI and scan behavior, not by converting every
  image to vector fill.
- Fill-mode fixes are aligned with LightBurn's fill model: closed areas are
  scanned in rows, with row spacing controlling density.
- P1-C is still not fully LightBurn-like until the preview/frame/output paths
  use the same prepared job. LightBurn's preview docs explicitly frame preview
  as an accurate representation of what is sent to the laser.
- P0-B copy is directionally aligned with LightBurn Job Control guidance:
  software Stop should not be the only way to stop a running laser job.

## What Was Not Verified

- I did not drive the live browser app during this audit.
- I did not import a real image through the UI in the maintainer's live scene.
- I did not perform hardware burn verification.
- I did not do a new perceptual source-vs-trace image comparison in this pass.

## Recommended Next Fix Order

1. Close the two P1-A/P1-C bypasses: custom-origin Start and Frame.
2. Bump `EMITTER_REVISION` to the ADR-039 output contract.
3. Finish P0-B wiring for Home, Frame, Jog, Origin, and Autofocus write failures.
4. Add the overlapping trace-worker timeout regression and settle all pending
   requests when the shared worker is retired.
5. Fix the stale over-budget raster tooltip.

