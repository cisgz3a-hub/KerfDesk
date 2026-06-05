# Karpathy Stage 1B Machine Origin Evidence - 2026-06-02

Repository verified:

- Worktree: `C:\Users\Asus\LaserForge-2.0`
- Remote: `https://github.com/cisgz3a-hub/LaserForge-2.0.git`
- Branch: `codex/main-working`

Purpose: close Stage 1B findings for machine readiness, origin-aware bounds, and custom-origin Start/Frame proof.

## Findings Covered

- `KF-013`: center-origin machines must use `[-bed/2,+bed/2]` machine bounds for Start/export and Frame.
- `KF-031`: custom-origin Start/Frame must block when the physical WCO location is unknown.
- `LF-AUDIT-002`: Start must block unless the live machine state is safe to start.
- `LF2-SO-M1`: Frame and preflight must be origin-aware when G92/WCO is active.

Existing closure kept:

- `KF-034`: known-WCO custom-origin overscan path had already been closure-proven in Stage 0.
- `LF2-SO-H1`: Set Origin anchoring path had already been closure-proven.

## Red Tests Observed

### Center-Origin Preflight

Test added:

- `src/core/preflight/preflight.test.ts`
- `flags center-origin output beyond the centered machine rectangle`

Initial failure:

- Expected `out-of-bed`.
- Actual issue list was empty because center-origin preflight returned early.

### Center-Origin Frame

Tests added:

- `src/core/job/frame-preflight.test.ts`
- `returns ok for negative bounds inside a center-origin bed`
- `detects positive overhang beyond a center-origin bed half-width`

Initial failures:

- Valid negative center-origin bounds were rejected as `out-of-bounds`.
- Positive overhang beyond `+bed/2` was not reported on the positive side.

## Implementation Summary

- `src/core/devices/machine-bounds.ts`
  - Added `machineBoundsForDevice()` as the shared origin-specific machine rectangle.
  - Corner-origin devices use `[0, bedWidth] x [0, bedHeight]`.
  - Center-origin devices use `[-bedWidth/2, +bedWidth/2] x [-bedHeight/2, +bedHeight/2]`.

- `src/core/invariants/predicates.ts`
  - `findOutOfBoundsCoords()` now accepts explicit min/max bounds instead of assuming `0..width` and `0..height`.

- `src/core/preflight/preflight.ts`
  - Removed the center-origin bounds skip.
  - Start/export preflight now uses `machineBoundsForDevice()`.

- `src/core/job/frame-preflight.ts`
  - Frame preflight now uses the same `machineBoundsForDevice()` rectangle.

- `src/ui/laser/JobControls.test.tsx`
  - Added a UI-level Frame regression proving active custom origin with unknown WCO shows `CUSTOM_ORIGIN_LOCATION_UNKNOWN_MESSAGE` and does not call `frame()`.

- `src/ui/laser/start-job-readiness.test.ts`
  - Added explicit `Hold`, `Jog`, and `Home` state blockers to close the older machine-start-gate finding with named GRBL states.

## Commands Run

### Initial focused center-origin proof

Command:

```powershell
corepack pnpm test src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts
```

Result:

- Failed as expected before implementation.
- 3 failures matched the intended missing center-origin behavior.

### Focused center-origin verification

Command:

```powershell
corepack pnpm test src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts
```

Result:

- Pass.
- 3 test files passed.
- 32 tests passed.

### Custom-origin Start/Frame proof

Command:

```powershell
corepack pnpm test src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx
```

Result:

- Pass.
- 2 test files passed.
- 15 tests passed before adding explicit Hold/Jog/Home proof.
- Rerun after cleanup produced clean output.

### Full focused Stage 1B verification

Command:

```powershell
corepack pnpm test src/core/devices/machine-bounds.test.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.test.ts src/core/job/job-origin.test.ts src/io/gcode/emit-gcode.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx
```

Result:

- Pass.
- 7 test files passed.
- 54 tests passed.

### TypeScript typecheck

Command:

```powershell
corepack pnpm run typecheck
```

Result:

- Pass.
- `tsc --noEmit` exited 0.

### Formatting

Commands:

```powershell
corepack pnpm exec prettier --write src/core/devices/machine-bounds.ts src/core/devices/machine-bounds.test.ts src/core/devices/index.ts src/core/invariants/predicates.ts src/core/preflight/preflight.ts src/core/preflight/preflight.test.ts src/core/job/frame-preflight.ts src/core/job/frame-preflight.test.ts src/ui/laser/JobControls.test.tsx
corepack pnpm exec prettier --write src/ui/laser/start-job-readiness.test.ts
```

Result:

- Pass.

## LightBurn Parity Note

LightBurn's User Origin flow makes output relative to the selected physical origin, but the machine still has physical bed limits. LaserForge now follows the conservative equivalent:

- known WCO: translate job bounds into physical machine space and block if off-bed,
- unknown WCO: block Start and Frame until the physical origin is known or reset,
- center-origin machine: use the real centered machine coordinate rectangle for both Start/export preflight and Frame.

## Remaining Required Proof

- Hardware proof is still required for real-machine confidence:
  - custom-origin Frame around a workpiece corner,
  - known-WCO near-edge block,
  - center-origin profile dry run if the user uses such a machine.
