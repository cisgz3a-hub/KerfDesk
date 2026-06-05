# Karpathy Stage 2C Evidence - Preview Rendering Budget

Date: 2026-06-03

## Finding

- `KF-018`: Preview mode had a display budget for oversized single cut
  polylines, but not for many generated toolpath steps or the faint original
  SVG geometry behind preview. Large traced/imported jobs could still push
  tens of thousands of Canvas2D operations on every redraw.

## Red Proof

Command:

```powershell
corepack pnpm test src/ui/workspace/draw-preview.test.ts
```

Result before the first fix:

- `samples many small preview cuts with a global operation budget` failed:
  expected fewer than `12_000` `lineTo` calls, got `30_000`.

Result before the second fix:

- `samples faint source geometry in preview instead of redrawing every source point`
  failed: expected fewer than `12_000` `lineTo` calls, got `30_000`.

## Fix

- `drawPreview()` still slices by scrubber position first, then renders a
  bounded representation of visible whole steps using the existing workspace
  segment-budget policy.
- Oversized single cut polylines keep their existing per-polyline sampling.
- `drawObjectsFaint()` now reuses the workspace display-polyline simplifier
  and batched stroke renderer instead of hand-walking every original SVG point.

## Green Verification

Commands:

```powershell
corepack pnpm test src/ui/workspace/draw-preview.test.ts
corepack pnpm test src/ui/workspace/draw-preview.test.ts src/ui/workspace/draw-complexity.test.ts src/ui/workspace/display-polylines.test.ts src/ui/workspace/draw-vector-strokes.test.ts src/ui/workspace/draw-scene-large.test.ts src/ui/workspace/draw-scene.test.ts
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/autofocus-action.test.ts src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/platform/web/web-serial.test.ts electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job-fill-cache.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts src/core/job/estimate-duration.test.ts src/core/job/planner.test.ts src/core/job/optimize-paths.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/draw-complexity.test.ts src/ui/workspace/display-polylines.test.ts src/ui/workspace/draw-vector-strokes.test.ts src/ui/workspace/draw-scene-large.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- Focused preview test: 1 file passed, 4 tests passed.
- Workspace renderer budget suite: 5 files passed, 12 tests passed.
- Combined Stage 1 through Stage 2C checkpoint: 31 files passed, 210 tests
  passed.
- `typecheck`: passed.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
- `git diff --check`: passed.

## Browser Smoke

- In-app Browser automation was attempted first, but the Windows sandbox setup
  failed twice while starting the browser runtime.
- Fallback local smoke used headless Chrome against the verified LaserForge 2.0
  dev server at `http://127.0.0.1:5175/`.
- Port check showed `5175` serves `LaserForge 2.0`; `5173` serves an unrelated
  Arch House app and was not used for this smoke.
- Screenshot evidence:
  `audit/evidence/karpathy-stage2c-preview-budget-smoke.png`.
