# Karpathy Stage 2B Evidence - Raster/Fill Duration And Live Estimate Truth

Date: 2026-06-03

## Findings

- `KF-024`: Raster/image groups were skipped by planner duration, so
  raster-only jobs could estimate as `0s` and appear empty in the UI.
- `KF-025`: Live estimate budget counted raw vector input and compiled Cut
  groups, but not generated Fill hatch segments. Dense Fill jobs could still
  run expensive planner work on the React render path.

## Red Proof

Command:

```powershell
corepack pnpm test src/core/job/estimate-duration.test.ts src/ui/laser/live-job-estimate.test.ts
```

Result before the fix:

- Raster-only duration failed: expected `totalSeconds > 0`, got `0`.
- Mixed cut+raster failed: mixed estimate equaled cut-only estimate.
- Image-only live estimate failed: expected `estimated`, got `empty`.
- Dense Fill live estimate failed: expected `too-large`, got an estimated
  `5h 18m` job.

Additional regression found while auditing Stage 2B:

- `corepack pnpm test src/core/job/compile-job-fill-cache.test.ts` failed
  because Stage 2A's layer-wide transformed fill aggregation made unchanged
  repeat compiles call `fillHatching()` twice.

## Fix

- Raster duration now converts active raster rows into planner-compatible
  Fill-style sweep segments:
  - blank rows are skipped
  - active spans are clipped to first/last nonzero pixels
  - row direction alternates like `emit-raster`
  - overscan and raster feed are estimated through the existing Fill/planner
    path.
- Live estimate now:
  - cheaply estimates Fill hatch rows before compiling
  - returns `too-large` when dense Fill would exceed the compiled segment budget
  - counts compiled Fill segments as well as Cut segments
  - estimates image-only jobs once raster duration is nonzero.
- Fill compilation now caches layer-wide transformed hatches per immutable
  `scene.objects` array plus hatch-affecting layer/device settings.

## Green Verification

Commands:

```powershell
corepack pnpm test src/core/job/estimate-duration.test.ts src/ui/laser/live-job-estimate.test.ts
corepack pnpm test src/core/job/compile-job-fill-cache.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job.test.ts src/core/job/fill-hatching.test.ts
corepack pnpm test src/core/job/estimate-duration.test.ts src/core/job/planner.test.ts src/core/job/optimize-paths.test.ts src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job-fill-cache.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/laser/JobControls.test.tsx
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/autofocus-action.test.ts src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/platform/web/web-serial.test.ts electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job-fill-cache.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts src/core/job/estimate-duration.test.ts src/core/job/planner.test.ts src/core/job/optimize-paths.test.ts src/ui/laser/live-job-estimate.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- Stage 2B red/green tests: 2 files passed, 21 tests passed.
- Fill cache repair focused tests: 4 files passed, 33 tests passed.
- Broader Stage 2B gate: 12 files passed, 101 tests passed.
- Combined Stage 1 through Stage 2B checkpoint: 26 files passed, 198 tests
  passed.
- `typecheck`: passed after fixing the synthetic raster segment local type.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
- `git diff --check`: passed.

## Remaining Runtime Proof

- Browser smoke is still useful before release: import an image-only raster job
  and confirm the Start button shows an estimate, then switch a large traced
  Fill object to dense spacing and confirm the estimate badge pauses instead of
  freezing the panel.
