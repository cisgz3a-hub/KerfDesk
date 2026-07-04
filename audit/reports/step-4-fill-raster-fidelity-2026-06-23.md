# Step 4: Fill/Raster Fidelity Audit

Date: 2026-06-23
Repo: `C:\Users\Asus\LaserForge-2.0`
Step: Step 4 from the LaserForge 10/10 loop
Scope: Cross-hatch, raster/fill scan-offset output stability, emitted G-code, physical bounds, and independent artifact verification.

## Locked Goal

Make fill/raster output trustworthy across GRBL profiles without changing unrelated UI or machine behavior.

Success criteria:

- Cross-hatch fill has independent output evidence, not only unit tests against the same planner helpers.
- Raster scan-offset compensation stays aligned between emitted G-code and computed physical bounds.
- Empty or irrelevant scan-offset tables do not change output.
- Unidirectional raster output remains unshifted even when a profile has calibrated scan offsets.
- Fresh targeted tests, typecheck, lint, and full suite pass.

Out of scope:

- Calibration UI.
- Default 4040 scan-offset values.
- Hardware burn verification.
- Preview redesign or a machine-motion overlay.
- Rotary, camera, or non-GRBL dialect work.

## Research Evidence

LaserForge source inspected:

- `src/core/job/fill-hatching.ts`
- `src/core/job/fill-sweeps.ts`
- `src/core/job/scan-offset.ts`
- `src/core/job/job-bounds.ts`
- `src/core/job/frame-bounds.ts`
- `src/core/output/grbl-strategy.ts`
- `src/core/raster/emit-raster.ts`
- Existing fill, raster, scan-offset, preview parity, and perceptual fixture tests.

LaserForge project notes inspected:

- `CLAUDE.md`
- `PROJECT.md`
- `DECISIONS.md`
- `WORKFLOW.md`
- `audit/reports/step-1-verification-harness-2026-06-23.md`
- `audit/reports/step-3-node-contour-fill-editing-2026-06-23.md`

Rayforge reference inspected in study-only mode:

- `C:\Users\Asus\Rayforge\rayforge\builtin_addons\rayforge-addon-laser\laser_essentials\producers\raster_producer.py`
- Rayforge tests/docs around `cross_hatch` behavior and operation/artifact pipeline structure.

Useful Rayforge lesson:

- Keep generated machine operations as explicit artifacts that can be independently inspected and compared. No Rayforge code was copied.

LightBurn expectation checked from local research notes and public docs targets:

- Fill/cross-hatch is operator-facing cut-setting behavior.
- Scanning offset is a machine compensation concept and should affect emitted head motion, not the intended design geometry.

## Failing Proof

Finding `STEP-4-001` was proven red before the production fix:

Command:

```powershell
pnpm test src/core/job/job-bounds.test.ts
```

Failure:

- Test: `does not apply raster scan offsets to unidirectional image rows`
- Expected `minX: 0`
- Received `minX: -0.25`

Trigger path:

1. A raster image layer is compiled with `bidirectional: false`.
2. The active device profile has a non-empty `scanningOffsets` table.
3. The raster has at least two active rows.
4. Bounds calculation treats the second active row as reverse even though the emitter will keep it left-to-right.

Failure mode:

- `computeJobBounds` and `computeJobMotionBounds` expanded the physical envelope by the calibrated reverse-row offset for unidirectional raster rows.
- `emitRasterGroup` did not apply that offset when `bidirectional: false`.

Consequence:

- Physical bounds and emitted G-code could disagree.
- On calibrated profiles this could falsely trip out-of-bed, no-go-zone, frame, or start preflight checks.
- This is over-blocking rather than laser-on under-blocking, so severity is medium, not high.

## Implementation

Fixed production code:

- `src/core/job/job-bounds.ts`
  - `hasActiveReverseRasterRow()` now returns `false` immediately when `group.bidirectional === false`.

Added regression coverage:

- `src/core/job/job-bounds.test.ts`
  - Confirms unidirectional raster bounds do not shift with a populated scan-offset table.

- `src/core/raster/emit-raster-scan-offset.test.ts`
  - Confirms unidirectional raster G-code remains left-to-right and unshifted when `scanOffsetMm` is non-zero.

Strengthened regenerable local artifact path:

- `src/__fixtures__/perceptual/toolpath-rasterize.test.ts`
  - Added cross-hatch fill comparison between intended contour mask, toolpath rasterization, and emitted G-code rasterization.
  - Optional PNG outputs are ignored by Git and are not durable audit evidence. Regenerate them with the command below when visual inspection is needed:
    - `perceptual-artifacts/fill-toolpath-cross-hatch-square.png`
    - `perceptual-artifacts/fill-gcode-cross-hatch-square.png`

## Verification

Targeted red/green:

```powershell
pnpm test src/core/job/job-bounds.test.ts
```

Result after fix:

- Passed: 1 file, 7 tests.

Scan-offset/fill/raster targeted suite:

```powershell
pnpm test src/core/output/grbl-strategy-scan-offset.test.ts src/core/raster/emit-raster-scan-offset.test.ts src/core/job/compile-job-fill.test.ts src/core/job/fill-hatching-metadata.test.ts src/core/job/fill-sweeps.test.ts
```

Result:

- Passed: 5 files, 22 tests.

Perceptual artifact suite:

```powershell
$env:PERCEPTUAL_ARTIFACTS='1'; pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts; Remove-Item Env:PERCEPTUAL_ARTIFACTS
```

Result:

- Passed: 1 file, 3 tests.
- Cross-hatch PNG artifacts generated.

Step 4 broad slice:

```powershell
pnpm test src/core/job/job-bounds.test.ts src/core/output/grbl-strategy-scan-offset.test.ts src/core/output/grbl-strategy-raster-calibration.test.ts src/core/raster/emit-raster-scan-offset.test.ts src/core/job/compile-job-raster.test.ts src/core/job/compile-job-fill.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-hatching-metadata.test.ts src/core/job/fill-sweeps.test.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts src/ui/workspace/draw-preview.parity.test.ts src/ui/workspace/draw-raster-preview.test.ts
```

Result:

- Passed: 12 files, 70 tests.

Formatting:

```powershell
pnpm exec prettier --check src/core/job/job-bounds.ts src/core/job/job-bounds.test.ts src/core/raster/emit-raster-scan-offset.test.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts
```

Result:

- Passed.

Typecheck:

```powershell
pnpm typecheck
```

Result:

- Passed.

Lint:

```powershell
pnpm lint
```

Result:

- Passed.
- Existing `boundaries/dependencies` legacy selector warning remains a green lint warning, not a Step 4 regression.

Full suite:

```powershell
pnpm test
```

Result:

- Passed: 341 files, 2107 tests.
- Existing jsdom `act(...)` warnings remain in the broader suite, but tests pass and they are not introduced by this step.

## Accepted Finding

### STEP-4-001: Unidirectional Raster Bounds Applied Reverse Scan-Offset Expansion

Severity: Medium
Confidence: High
Status: Fixed

Function/module:

- `src/core/job/job-bounds.ts`
- `hasActiveReverseRasterRow`
- `computeJobBounds`
- `computeJobMotionBounds`

Trigger:

- Image raster job.
- `bidirectional: false`.
- Device profile has non-empty `scanningOffsets`.
- At least two active raster rows.

Failure mode:

- Bounds logic assumed alternating active rows meant reverse rows existed.
- The raster emitter correctly kept all rows forward when bidirectional scanning was disabled.

Consequence:

- Bounds/preflight/frame safety envelope could be wider than emitted machine motion.
- Users could see false blocking on calibrated devices.

Concrete fix:

- Make reverse-row detection return `false` when `group.bidirectional === false`.

Proof:

- Red test reproduced the false `minX: -0.25`.
- Fixed test passes.
- Emitter guard test proves the unidirectional output path does not apply offset.

## Rejected Findings / Non-Issues

### No Browser Smoke In Step 4

Rejected as a finding for this locked slice.

Reason:

- Step 4 changed core output/bounds logic and added artifact verification.
- No UI component, interaction, menu, or browser behavior changed.
- Browser smoke remains mandatory for UI-facing steps, especially Step 2 and Step 6.

### Existing Boundaries Lint Warning

Rejected as a Step 4 finding.

Reason:

- `pnpm lint` exits green.
- The warning refers to legacy selector syntax in lint configuration and predates this slice.
- No lint rule was weakened or bypassed.

### Existing jsdom `act(...)` Warnings

Rejected as a Step 4 finding.

Reason:

- Full suite passes.
- The warnings are in existing broader UI tests and were not created by this fill/raster change.

### Design Preview Does Not Show Scan-Offset Machine Motion

Rejected for this locked slice.

Reason:

- Scan offset compensates controller/head timing for emitted machine motion.
- The design preview should continue to show the intended burn geometry.
- A future optional machine-motion overlay can be planned separately, but the current fix keeps bounds and emitted motion aligned.

## Rating

Rubric score is the minimum of all categories:

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for the locked slice, because false bounds blocks are removed without widening unsafe behavior.
- Regression coverage: 10/10
- Regenerable visual checks: 10/10
- Maintainability: 10/10
- Docs/audit clarity: 10/10

Final Step 4 rating: 10/10

No accepted findings remain.

## Next Step

Proceed to Step 5: Machine/Controller Lifecycle.

Primary focus:

- Post-job settle, Home, Frame, Recover, reconnect, progress, and command ACK handling.
- Simulated controller tests first.
- Hardware smoke only when safe and available.
