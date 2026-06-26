# Trace Quality Loop Baseline - 2026-06-25

## Target

- Checkout: `C:\Users\Asus\LaserForge-2.0`
- Branch: `main`
- Goal: first 10/10 trace loop targets Logo Line Art filled-contour quality.
- Reference policy: Inkscape/Potrace/Autotrace are study-only references; no GPL code is copied.

## Current Workspace State

The trace workspace is already dirty and is being preserved, not reverted. Active trace-related work includes:

- Edge Detection mode metadata, UI warning, and edge controls.
- Centerline threshold-band and minimum-length changes.
- Trace-mode persistence for traced images.
- Perceptual trace artifact harness files.
- Research note: `docs/research/trace-quality-centerline-edge-detection-2026-06-25.md`.

## Baseline Verification

Focused trace baseline before the harness fill/fixture-gate slice:

```powershell
pnpm test --run src/core/trace/trace-image.test.ts src/core/trace/trace-to-paths.test.ts src/core/trace/potrace-trace.test.ts src/core/trace/centerline-mask.test.ts src/core/trace/centerline-polylines.test.ts src/core/trace/centerline-trace.test.ts src/core/trace/edge-trace.test.ts src/ui/trace/trace-options.test.ts src/ui/trace/ImportImageDialog.test.ts src/ui/commands/multi-file-trace-action.test.ts src/io/project/project-trace-mode.test.ts src/__fixtures__/perceptual/trace-artifacts.test.ts
```

Result: 12 test files passed, 100 tests passed.

## Loop Rating Cap

Initial pass: the required real fixture was not present:

- Expected: `audit/fixtures/trace/arch-house-langebaan-source.*`
- Initial cap: `9/10`

Synthetic fixtures may prove the harness and generic logo behavior, but the loop cannot honestly reach 10/10 until the real Arch House/Langebaan source image is added and tested.

## Real Fixture Acceptance

The user supplied the original source PNG on the desktop, then it was copied into the required fixture path:

- Source: `C:\Users\Asus\Desktop\source image\file_00000000966c71fd8c7b2cdc69ca12ab.png`
- Repo fixture: `audit/fixtures/trace/arch-house-langebaan-source.png`

Line Art acceptance metrics from `src/__fixtures__/perceptual/arch-house-baseline.test.ts`:

- Source size: `1024 x 1024`
- Mode: `filled-contours`
- Path count: `1`
- Closed polylines: `54`
- Open polylines: `0`
- Hole candidates: `20`
- Small closed specks: `3`
- Point count: `10236`
- Bounds: `x=118..896.48`, `y=206.102..710.027`

Generated evidence:

- `audit/evidence/trace-artifacts/arch-house-langebaan-line-art.metrics.json`
- `audit/evidence/trace-artifacts/arch-house-langebaan-line-art.overlay.svg`

## Accepted Baseline

- Loop 0 status: accepted at 10/10 after the real source fixture was added and the required Line Art acceptance test passed.
- Loop 1 harness slice added failing proof first, then passed after implementation.
- Next work should improve color/vector fidelity only after preserving this baseline.
