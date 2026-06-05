# Karpathy Stage 2A Evidence - Layer-Wide Physical Fill Hatching

Date: 2026-06-03

## Findings

- `KF-035`: Scaled Fill objects did not preserve physical `hatchSpacingMm`
  because hatching happened before object transform.
- `LBP-001`: Same-layer Fill geometry was hatched per object/path group, so
  separate overlapping or nested shapes could not interact like LightBurn's Fill
  behavior.

## LightBurn Cross-Reference

Primary references checked:

- LightBurn Fill Mode:
  https://docs.lightburnsoftware.com/2.1/Reference/CutSettingsEditor/FillMode/
- LightBurn Double-Engraved Areas:
  https://docs.lightburnsoftware.com/latest/Troubleshooting/PreviewWindow/DoubleEngravedAreas/

Relevant behavior from the docs:

- Same-layer nested or partially overlapping Fill shapes interact through the
  fill rule rather than engraving independently.
- Different-layer overlapping Fill shapes can engrave the overlap twice.
- Fill line interval is a physical spacing between engraved lines.

## Red Proof

Command:

```powershell
corepack pnpm test src/core/job/compile-job.test.ts
```

Result before the fix:

- `keeps fill hatch spacing physical after object scale` failed because scaled
  rows were `2 mm` apart instead of `1 mm`.
- `aggregates separate same-layer nested fill objects into a hole interaction`
  failed because a full-width `10 mm` hatch crossed the nested hole.
- `aggregates separate same-layer partial overlaps without double engraving the
  overlap` failed because the row burn length was `20 mm` instead of `10 mm`.
- Different-layer overlap already behaved separately and stayed as the guardrail.

## Fix

- Fill compilation now collects all same-layer vector contours after object
  transform and device-origin transform.
- `fillHatching()` runs once per Fill layer on machine-space contours.
- The emitted Fill segments are already in physical machine coordinates, so
  hatch spacing stays physical after scale/rotation/origin transforms.
- Line mode still transforms source contours directly.
- Raster objects remain excluded from vector Fill compilation.
- Stage 2A regression tests were split into `compile-job-fill.test.ts` to keep
  repo file-size lint policy intact.

## Green Verification

Commands:

```powershell
corepack pnpm test src/core/job/compile-job.test.ts
corepack pnpm test src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts src/core/preflight/preflight.test.ts src/ui/laser/start-job-readiness.test.ts src/io/gcode/emit-gcode.test.ts
corepack pnpm test src/ui/state/laser-store.test.ts src/ui/state/laser-line-handler.test.ts src/ui/state/autofocus-action.test.ts src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/laser/LaserWindow.test.tsx src/platform/web/web-serial.test.ts electron/trusted-renderer-policy.test.ts electron/serial-port-choice.test.ts electron/csp-policy.test.ts src/core/job/compile-job.test.ts src/core/job/compile-job-fill.test.ts src/core/job/fill-hatching.test.ts src/core/job/fill-overscan.test.ts src/core/output/grbl-strategy.test.ts src/core/output/grbl-strategy.property.test.ts
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- `compile-job.test.ts`: 20 tests passed immediately after fix.
- Focused Stage 2A suite after test split: 9 files passed, 86 tests passed.
- Combined Stage 1 plus Stage 2A regression suite: 21 files passed, 148 tests
  passed.
- `typecheck`: passed.
- Root `lint`: passed with the existing `boundaries/dependencies` v6 migration
  warning.
- `git diff --check`: passed.

## Remaining Runtime Proof

- No hardware run is required to prove the compiler geometry rule.
- A visual/perceptual browser check is still useful before release: same-layer
  nested and overlapping Fill fixtures should preview/output as LightBurn-style
  odd/even fill regions, while different-layer overlaps remain separate.
