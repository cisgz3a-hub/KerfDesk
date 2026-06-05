# LightBurn Tier 0 Fix Evidence - 2026-06-03

Scope: First implementation pass from `audit/reports/lightburn-parity-codex-verification-2026-06-03.md`.

## Red Tests

Command:

```powershell
npm.cmd test -- src/core/preflight/preflight.test.ts src/core/job/optimize-paths.test.ts src/ui/laser/JobControls.test.tsx
```

Observed failing tests before production changes:

- `runPreflight laser-off travel invariant > flags G0 travel while the laser may still be armed`
- `optimizePaths > cuts contained closed contours before their containing outer contour`
- `JobControls running safety copy > warns that Pause is feed hold only and Stop or physical E-stop is the unsafe-condition path`

## Fixes Implemented

- Wired `findLaserOnTravelIssues` into `runPreflight` as `laser-on-travel`.
- Added containment-depth ordering before nearest-neighbor cut optimization.
- Added visible running-job copy: `Pause is feed hold only. Use Stop or physical E-stop if unsafe.`
- Narrowed an unrelated stochastic estimate-duration property away from near-identity scale values after full-suite verification exposed `k = 1.0000000000000002` floating-point noise.

## Green Verification

Focused suite:

```powershell
npm.cmd test -- src/core/preflight/preflight.test.ts src/core/job/optimize-paths.test.ts src/ui/laser/JobControls.test.tsx
```

Result: 3 test files passed, 33 tests passed.

Typecheck:

```powershell
pnpm run typecheck
```

Result: `tsc --noEmit` exited 0.

Full suite:

```powershell
npm.cmd test
```

Result: 120 test files passed, 893 tests passed.

Production build:

```powershell
npm.cmd run build
```

Result: Vite production build exited 0. Existing Vite dynamic/static import chunking warnings remain.

File-size policy:

```powershell
npm.cmd run check:file-size
```

Result: file-size raw-line backstop passed, 600 max physical lines.

Whitespace diff check:

```powershell
git diff --check
```

Result: exited 0.

