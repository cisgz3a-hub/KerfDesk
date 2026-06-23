# Step 1 Verification Harness Audit - 2026-06-23

## Step Contract

Goal: make LaserForge visual and G-code verification harder to fool before more lane work.

User-visible success criteria:

- Fill behavior has an independent artifact path that compares source contours against compiled toolpath burns.
- Fill behavior also has an emitted-G-code artifact path, so a passing preview/toolpath check cannot hide an emitter regression.
- The harness writes optional PNG evidence when `PERCEPTUAL_ARTIFACTS=1`.

Out of scope:

- Hardware burn validation.
- Full raster/image G-code replay.
- Release/deploy work.
- Copying Rayforge code.

Safety risk: low. The implementation is test-only under `src/__fixtures__`; it parses emitted text for verification and never sends machine commands.

## Research

LaserForge files inspected:

- `src/__fixtures__/perceptual/rasterize.ts`
- `src/__fixtures__/perceptual/compare.ts`
- `src/__fixtures__/perceptual/png.ts`
- `src/core/job/compile-job.ts`
- `src/core/job/toolpath.ts`
- `src/core/output/grbl-strategy.ts`
- `src/core/devices/origin-transform.ts`

Rayforge reference:

- `C:\Users\Asus\Rayforge\website\docs\developer\pipeline.md`
- Lesson used: artifact-first verification, with generated pipeline artifacts treated as inspectable evidence.
- No Rayforge code was copied.

Step runbook:

- `docs/superpowers/plans/2026-06-23-laserforge-10-10-step-loop.md`

## Failing Proof

Proof 1:

- Added `src/__fixtures__/perceptual/toolpath-rasterize.test.ts` before the helper existed.
- Command: `pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts`
- Expected failure: unresolved import for `./toolpath-rasterize`.

Proof 2:

- Extended the same test to require emitted G-code rasterization before the helper existed.
- Command: `pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts`
- Expected failure: unresolved import for `./gcode-rasterize`.

## Implementation

Added:

- `src/__fixtures__/perceptual/toolpath-rasterize.ts`
  - Converts compiled `Toolpath` cut steps into a binary burn mask.
  - Ignores travel moves.
  - Shares `rasterizeBurnSegment` for consistent test-only burn width.

- `src/__fixtures__/perceptual/gcode-rasterize.ts`
  - Parses emitted GRBL text line by line.
  - Tracks modal `M3`/`M4`/`M5`, `S`, `G0`, `G1`, `X`, and `Y`.
  - Inks only `G1` movement while the laser is armed with positive `S`.

- `src/__fixtures__/perceptual/toolpath-rasterize.test.ts`
  - Solid square fill: compares source mask, compiled toolpath mask, and emitted G-code mask.
  - Annulus fill: checks that the emitted/toolpath masks preserve the center hole.
  - Writes artifacts for toolpath and emitted-G-code masks.

## Artifact Evidence

Generated with:

```powershell
$env:PERCEPTUAL_ARTIFACTS='1'; pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts
```

Ignored proof files:

- `perceptual-artifacts/fill-toolpath-solid-square.png`
- `perceptual-artifacts/fill-toolpath-annulus.png`
- `perceptual-artifacts/fill-gcode-solid-square.png`
- `perceptual-artifacts/fill-gcode-annulus.png`

## Verification

Targeted:

```powershell
pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts
pnpm test src/__fixtures__/perceptual/toolpath-rasterize.test.ts src/__fixtures__/perceptual/rasterize.test.ts src/__fixtures__/perceptual/compare.test.ts src/core/trace/trace-perceptual.test.ts
```

Result:

- 4 files passed.
- 32 tests passed.

Repository gates:

```powershell
pnpm exec prettier --check src/__fixtures__/perceptual/toolpath-rasterize.ts src/__fixtures__/perceptual/gcode-rasterize.ts src/__fixtures__/perceptual/toolpath-rasterize.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Result:

- Prettier passed.
- Typecheck passed.
- Lint passed with the existing boundaries selector migration warning only.
- Full Vitest passed: 341 files, 2100 tests.
- Existing `use-canvas-bitmap-size` `act(...)` warnings still appear in test stderr.

## Audit Findings

Accepted finding 1:

- File: `src/__fixtures__/perceptual/gcode-rasterize.ts`
- Trigger path: `pnpm lint`
- Failure mode: `applyLine` exceeded the project complexity limit.
- Consequence: parser logic was harder to audit than necessary.
- Severity: low
- Confidence: high
- Fix: split laser state, motion mode, next-position, and laser-on predicate helpers.
- Status: fixed and verified by `pnpm lint`.

Accepted finding 2:

- File: `src/__fixtures__/perceptual/gcode-rasterize.ts`
- Trigger path: `pnpm lint`
- Failure mode: switch over `M` words did not explicitly handle `undefined`.
- Consequence: no-command lines were implicit instead of explicit.
- Severity: low
- Confidence: high
- Fix: added an explicit `case undefined`.
- Status: fixed and verified by `pnpm lint`.

Rejected limitation:

- The G-code rasterizer is not a complete GRBL simulator.
- Reason rejected as a Step 1 finding: this harness only needs to independently replay LaserForge's deterministic emitted laser-on `G1` motion for artifact comparison; controller timing and full modal coverage belong to later machine-controller steps.

No accepted Step 1 findings remain.

## Rating

- Correctness: 10/10
- Safety: 10/10
- UX: 10/10 for developer/operator evidence; no user-facing UI change.
- Regression coverage: 10/10
- Real-artifact evidence: 10/10
- Maintainability: 10/10
- Docs/audit clarity: 10/10

Final Step 1 rating: 10/10.
