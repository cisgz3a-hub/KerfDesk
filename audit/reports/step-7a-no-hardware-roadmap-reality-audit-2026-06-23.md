# Step 7A - No-Hardware Roadmap Reality Audit - 2026-06-23

## Step Contract

- Goal: choose the next engineering slice without requiring live Falcon or 4040 hardware.
- User-visible success: the next-step queue is based on the current LaserForge-2.0 checkout, not stale June gap labels.
- Safety risk: low. This step reads code and runs tests only. It does not connect to a controller, send G-code, or move a laser.
- Out of scope: hardware smoke, Cloudflare deploy, feature implementation, and broad LightBurn parity claims.
- Required evidence: current git state, current roadmap/gap-list inspection, source/test evidence for stale claims, targeted non-hardware tests, and a critic audit.

## Research

Current repo state:

- Target repo: `C:\Users\Asus\LaserForge-2.0`
- Branch state before this report: `main...origin/main [ahead 1]`
- Local ahead commit: `0fe2811 Record deployed release smoke evidence`
- Production commit already smoke-tested in Step 6B: `20d5aba`

Local reports and roadmaps inspected:

- `audit/reports/step-6b-deployed-release-smoke-2026-06-23.md`
- `docs/superpowers/plans/2026-06-23-laserforge-10-10-step-loop.md`
- `docs/REMAINING-WORK-ROADMAP-2026-06-04.md`
- `docs/LIGHTBURN-PARITY-IMPLEMENTATION-ROADMAP-2026-06-15.md`
- `audit/reports/lightburn-feature-gap-list-2026-06-15.md`
- `audit/reports/lightburn-workflow-implementation-plan-2026-06-05.md`

Current source/test evidence that made older roadmap claims stale:

- Layer order/create/reassign:
  - `src/core/scene/scene.ts` has `moveLayer`.
  - `src/ui/layers/LayerOrderControls.tsx` wires layer up/down controls.
  - `src/ui/state/layer-actions.ts` includes manual layer creation and selection assignment.
  - Tests: `src/core/scene/scene.test.ts`, `src/ui/state/store.test.ts`, `src/ui/state/layer-actions.test.ts`.
- Image-mode depth and quality controls:
  - `src/core/raster/dither.ts` supports threshold, Floyd-Steinberg, Jarvis, Stucki, Atkinson, Burkes, Sierra variants, Ordered, and Grayscale.
  - `src/ui/layers/LayerImageFields.tsx` exposes dither, min power, line interval, DPI, dot-width correction, negative image, bidirectional, and pass-through.
  - `src/ui/raster/AdjustImageDialog.tsx` and `src/ui/raster/processed-bitmap.ts` cover processed image output.
  - Tests: `src/core/raster/dither.test.ts`, `src/core/job/compile-job-raster.test.ts`, `src/ui/raster/AdjustImageDialog.test.tsx`, `src/ui/raster/processed-bitmap.test.ts`.
- Offset fill / kerf / tabs:
  - `src/core/job/offset-fill.ts` exists.
  - `src/core/geometry/kerf-offset.ts` exists.
  - `src/core/geometry/tabs-bridges.ts` exists.
  - Tests: `src/core/output/grbl-strategy-offset-fill.test.ts`, `src/core/preflight/preflight.test.ts`, `src/core/job/compile-job-tabs-bridges.test.ts`, `src/core/job/compile-job.test.ts`.
- Project notes:
  - `src/core/scene/project.ts` stores `notes`.
  - `src/ui/commands/ProjectNotesDialog.tsx` provides the UI.
  - Tests: `src/io/project/project-notes.test.ts`, `src/ui/commands/ProjectNotesDialog.test.tsx`, `src/ui/state/project-notes-actions.test.ts`.
- Grouping and locking:
  - `src/core/scene/scene.ts` includes `SceneGroup`.
  - `src/ui/state/scene-group-actions.ts` and `src/ui/state/scene-lock-actions.ts` exist.
  - `src/core/scene/hit-test.ts` skips locked objects.
  - Tests: `src/ui/state/scene-group-actions.test.ts`, `src/ui/state/scene-lock-actions.test.ts`, `src/core/scene/hit-test.test.ts`.
- Snapping/guides:
  - `src/ui/workspace/snapping.ts` implements grid/object snapping.
  - `src/ui/workspace/draw-snap-guides.ts` renders guide lines.
  - Tests: `src/ui/workspace/snapping.test.ts`, `src/ui/workspace/draw-snap-guides.test.ts`.
- Controller and scan-offset foundation:
  - `src/core/devices/scan-offset-profile.ts` and profile capabilities exist.
  - `src/ui/calibration/ScanOffsetCalibrationDialog.test.tsx`, `src/ui/laser/MeasuredScanOffsetApply.test.tsx`, and `src/core/output/grbl-strategy-scan-offset.test.ts` cover the non-hardware pieces.

## Failing Proof

Reproduction:

- Compare the June feature-gap and remaining-work docs to the current code.

Expected failure:

- The docs still mark several features as missing or partial even though current source and tests show shipped implementations.

Evidence:

- `audit/reports/lightburn-feature-gap-list-2026-06-15.md` still labels project notes, grouping, lock shapes, snapping, offset fill, kerf compensation, tabs, apply mask, crop image, save processed bitmap, and multi-file trace as missing or not fully present.
- Current source and tests listed above show those labels are no longer reliable enough for selecting the next step.

## Implementation Summary

- Added this audit report only.
- No production code, tests, workflows, or generated build output changed.
- Hardware smoke is explicitly skipped per operator instruction.

## Verification

Targeted non-hardware tests:

- PASS: `corepack pnpm test --run src/core/scene/scene.test.ts src/ui/state/store.test.ts src/ui/state/layer-actions.test.ts`
  - 3 files passed, 64 tests passed.
- PASS: `corepack pnpm test --run src/core/raster/dither.test.ts src/core/job/compile-job-raster.test.ts src/ui/raster/processed-bitmap.test.ts`
  - 3 files passed, 62 tests passed.
- PASS: `corepack pnpm test --run src/core/output/grbl-strategy-offset-fill.test.ts src/core/preflight/preflight.test.ts src/core/job/compile-job-tabs-bridges.test.ts`
  - 3 files passed, 22 tests passed.
- PASS: `corepack pnpm test --run src/io/project/project-notes.test.ts src/ui/commands/ProjectNotesDialog.test.tsx src/ui/state/project-notes-actions.test.ts`
  - 3 files passed, 5 tests passed.
- PASS: `corepack pnpm test --run src/ui/state/scene-group-actions.test.ts src/ui/state/scene-lock-actions.test.ts src/core/scene/hit-test.test.ts`
  - 3 files passed, 16 tests passed.
- PASS: `corepack pnpm test --run src/ui/workspace/snapping.test.ts src/ui/workspace/draw-snap-guides.test.ts`
  - 2 files passed, 5 tests passed.
- PASS: `corepack pnpm test --run src/ui/help/help-topics.test.ts src/ui/commands/command-registry.test.ts`
  - 2 files passed, 33 tests passed.

Gates for this report-only step:

- PASS: `corepack pnpm typecheck`
- PASS: `corepack pnpm lint`
  - Note: ESLint exited 0 with the existing `boundaries/dependencies` legacy-selector migration warning.

Not verified:

- Hardware smoke: intentionally skipped.
- Cloudflare deployment: out of scope for this local roadmap audit.

## Current No-Hardware Next-Build Shortlist

Good next 10/10 candidates, all software-verifiable:

1. **Undo History Window V1**
   - Why: LightBurn parity, no machine risk, useful operator recovery.
   - Proof: current undo/redo works, but no visible history panel exists.
   - Evidence needed: store-level undo-stack tests plus browser smoke.

2. **Measure Tool V1**
   - Why: common layout workflow and safe workspace-only feature.
   - Proof: no measure command/tool surfaced in the current command registry.
   - Evidence needed: pure distance/angle tests plus browser smoke.

3. **Star Shape Tool V1**
   - Why: small creation-tool gap with contained geometry.
   - Proof: tool mode supports rect, ellipse, polygon, and polyline only.
   - Evidence needed: shape-path unit tests plus browser smoke.

4. **Help/Tooltip Coverage Pass**
   - Why: lower risk, improves learning-platform use, but existing help coverage means the first slice should audit a specific surface.
   - Proof: command/help registry exists; remaining gap is surface coverage, not the registry itself.
   - Evidence needed: component tests for the chosen surface.

Recommended next slice:

- **Measure Tool V1**. It is operator-visible, no-hardware, has a clear missing command/tool proof, and does not require new geometry dependencies.

## Audit Findings

No accepted Step 7A findings.

Rejected non-blockers:

- The report does not update the old June roadmap/gap-list files in place.
  - Rejected as a blocker because this step is an evidence report, not a docs-rewrite migration. Updating stale long-form roadmap docs can be its own docs-maintenance slice.
- No browser smoke.
  - Rejected as a blocker because this report-only step changes no UI behavior and verifies existing UI claims through component/store tests.
- No hardware smoke.
  - Rejected as a blocker because the operator explicitly said no hardware smoke now, and this step is scoped to non-hardware evidence.
- Lint emitted a `boundaries/dependencies` legacy-selector migration warning.
  - Rejected as a blocker because lint exited 0 and the warning is an existing tooling-migration notice, not a regression from this report.

## Rating

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for choosing a clearer no-hardware next step
- Regression coverage: 10/10 for report scope, 207 targeted tests plus typecheck and lint
- Real-artifact evidence: 10/10 for command output and report evidence
- Maintainability: 10/10
- Docs/audit clarity: 10/10
- Final score: 10/10

No accepted findings remain for Step 7A.
