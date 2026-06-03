# Karpathy Stage 3B Evidence - SVG Presentation-State Import Walker

Date: 2026-06-03

## Findings

- `KF-016`: Fill-only SVG geometry was imported as black stroked output.
- `KF-017`: SVG group/element transforms plus inherited/style stroke colors
  were ignored.
- `KF-036`: Hidden or fully transparent SVG geometry was imported as real
  laser output.

## Red Proof

Command:

```powershell
corepack pnpm test src/io/svg/parse-svg-presentation-state.test.ts
```

Result before the fix:

- Fill-only rect failed: expected `object === null`, received black
  `#000000` imported geometry.
- Inherited/style stroke failed: expected `#00ff00` and `#ff0000`, received
  only `#000000`.
- Accumulated transform failed: expected first point `{ x: 10, y: 20 }`,
  received `{ x: 0, y: 0 }`.
- Hidden/transparent geometry failed: expected 1 imported polyline, received
  10.

## Fix

- Replaced the flat `querySelectorAll('*')` geometry walk with a recursive
  SVG presentation-state walker.
- The walker now:
  - inherits `stroke` through ancestors
  - resolves inline `style="stroke: ..."` before presentation attributes
  - treats absent or `none` stroke as no Line-mode geometry
  - skips `display:none`, `visibility:hidden`, `visibility:collapse`,
    `opacity:0`, and `stroke-opacity:0`, including style equivalents
  - accumulates `matrix`, `translate`, `scale`, and `rotate` transforms and
    applies them before storing imported points.
- Sanitizer boundaries remain unchanged.

## Green Verification

Commands:

```powershell
corepack pnpm test src/io/svg/parse-svg-presentation-state.test.ts
corepack pnpm test src/io/svg/parse-svg.test.ts src/io/svg/shape-to-polylines.test.ts src/io/svg/pipeline.snapshot.test.ts src/core/trace/trace-image.test.ts
corepack pnpm test src/io/svg
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/autofocus-action.test.ts src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/platform/web/web-serial.test.ts electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/compile-job-fill-cache.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts src/core/job/estimate-duration.test.ts src/core/job/planner.test.ts src/core/job/optimize-paths.test.ts src/ui/laser/live-job-estimate.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/draw-complexity.test.ts src/ui/workspace/display-polylines.test.ts src/ui/workspace/draw-vector-strokes.test.ts src/ui/workspace/draw-scene-large.test.ts src/io/svg/parse-svg-presentation-state.test.ts src/io/svg/parse-svg.test.ts src/io/svg/shape-to-polylines.test.ts src/io/svg/pipeline.snapshot.test.ts src/core/trace/trace-image.test.ts
git diff --check
```

Results:

- Stage 3B presentation-state tests: 1 file passed, 4 tests passed.
- Existing SVG parser/pipeline and legacy trace tests: 4 files passed, 59 tests
  passed.
- Full SVG directory: 7 files passed, 72 tests passed.
- `typecheck`: passed.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
- Combined Stage 1 through Stage 3B checkpoint: 36 files passed, 273 tests
  passed.
- `git diff --check`: passed.
