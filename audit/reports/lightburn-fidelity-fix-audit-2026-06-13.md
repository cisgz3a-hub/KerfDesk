# LightBurn Fidelity Fix Audit - 2026-06-13

Status: implementation pass completed for first priority batches
Repo: `C:\Users\Asus\LaserForge-2.0`
Branch: `fix/trace-transparency-opaque-fallback`

## Scope

This pass implemented the first fixes from
`audit/LIGHTBURN-FIDELITY-CODEX-ADJUDICATION-2026-06-13.md`.

Fixed:

1. F-1: Start tooltip claimed full G-code would still generate for too-large
   jobs.
2. F-10: Save G-code used `Ctrl+E`, conflicting with LightBurn's ellipse
   shortcut. Official LightBurn hotkeys list Save As GCode as `Alt+Shift+L`.
3. F-2: Frame prepared full output just to get bounds.
4. F-3: Preview could enter full synchronous preparation for obviously huge
   vector/fill jobs.

Not fixed in this pass:

- F-4 raster toolpath scrubber steps.
- F-5 Material Test labels/operator loop.
- F-6 Interval Test labels and Dithered Image mode.
- F-7 expanded Optimization Settings.
- F-8 Cut Settings schema parity.
- F-9 Console and Fire workflows.
- F-11 broader design tool parity.

## Changes Audited

### Start Tooltip

Changed `src/ui/laser/JobControls.tsx` so `too-large` jobs no longer say
"Start still generates full G-code." The tooltip now tells the operator that
Start will block until artwork size or raster settings are reduced.

Regression coverage:

- `src/ui/laser/JobControls.test.tsx`

### Save G-code Shortcut

Changed Save G-code from `Ctrl+E` to `Alt+Shift+L`.

Rationale:

- LightBurn uses `Ctrl+E` for Draw Ellipse.
- LightBurn uses `Alt+Shift+L` for Save As GCode.
- Reserving `Ctrl+E` now avoids future drawing-tool conflict.

Files:

- `src/ui/app/shortcuts.ts`
- `src/ui/commands/command-families.ts`
- `src/ui/common/Toolbar.tsx`

Regression coverage:

- `src/ui/app/shortcuts.test.ts`
- `src/ui/commands/command-registry.test.ts`
- `src/ui/common/Toolbar.test.tsx`

### Frame Bounds

Added `src/core/job/frame-bounds.ts`.

Frame now computes output-enabled machine-space bounds directly from scene
geometry instead of calling `prepareOutput()`. It:

- respects output-enabled layer colors,
- ignores hidden vector colors,
- respects image-mode raster layers,
- skips `trace-source` backing rasters,
- applies the same job-origin anchor offset as the compiled job path,
- still runs frame bed-bounds preflight before jogging.

This keeps Frame as a low-cost placement check and avoids fill hatching,
path optimization, and raster pixel preparation.

Regression coverage:

- `src/core/job/frame-bounds.test.ts`
- `src/ui/laser/JobControls.test.tsx`
- `src/ui/laser/start-frame-raster-budget.test.tsx`

### Preview Complexity Guard

Added `src/core/job/preparation-complexity.ts` and reused it from:

- `src/ui/laser/live-job-estimate.ts`
- `src/ui/workspace/draw-preview.ts`

Preview now rejects obviously huge vector/fill scenes before it can call
`prepareOutput()`. This preserves the exact Start/Save output path for normal
jobs while avoiding the main-thread freeze class for large traces/fill hatches.

Regression coverage:

- `src/ui/workspace/draw-preview-complexity.test.ts`
- `src/ui/laser/live-job-estimate.test.ts`
- existing preview parity/frame tests.

## Post-Fix Audit

Diff scope check:

- Start/Save output generation still uses `prepareOutput()`.
- Frame no longer imports or calls `prepareOutput()`.
- Preview still uses `prepareOutput()` for normal jobs, but now has a cheap
  complexity gate first.
- No G-code emitter, GRBL strategy, serial, or streamer code was changed.

Remaining risk:

- Preview still returns an empty toolpath for too-complex vector/fill scenes.
  That prevents freezes but does not yet give the operator a rich LightBurn-like
  warning banner or worker-backed preview.
- Raster groups are still skipped by the toolpath scrubber; this is F-4.
- Frame bounds are axis-aligned. That matches the existing Frame perimeter
  behavior, but it is not a rotated/rubber-band framing mode.

## Verification

Red tests were observed before implementation for:

- too-large Start tooltip,
- `Ctrl+E` Save G-code handling,
- missing `Alt+Shift+L` Save G-code handling,
- command/toolbar shortcut labels,
- missing `computeFrameBounds`,
- Preview reaching `prepareOutput()` for a huge trace.

Final verification commands:

1. `corepack pnpm format:check` - passed.
2. `corepack pnpm typecheck` - passed.
3. `corepack pnpm lint` - passed, with the existing boundaries plugin
   migration warning.
4. `corepack pnpm test` - passed: 199 files, 1424 tests.
5. `corepack pnpm build:web` - passed, with the existing Vite chunk-size
   warning.
