# Image Line Interval / DPI Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose LightBurn-style Line Interval and DPI controls for image layers while keeping LaserForge's existing `linesPerMm` model as the canonical internal value.

**Architecture:** Add pure conversion helpers. UI surfaces Line Interval and DPI as tied controls that both write `linesPerMm`. Existing compile, preview, preflight, project save/load, and bitmap conversion continue to consume `linesPerMm`.

**Tech Stack:** React 18, TypeScript, Vitest.

---

## Research Basis

- Official LightBurn Image Mode docs list Line Interval and DPI as image-mode settings.
- Line Interval controls the spacing between scanned rows.
- DPI is the same setting represented as pixel density: `DPI = 25.4 / Line Interval`.
- Dot Width Correction must stay within the current Line Interval.

Source: <https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/>

## Scope

Ship now:

- Pure conversion helpers for `linesPerMm`, line interval in mm, and DPI.
- Adjust Image dialog shows Line Interval and DPI controls instead of a LaserForge-only "Resolution lines/mm" field.
- Visible image layer row shows Line Interval and DPI.
- Cut Settings dialog shows Line Interval and DPI.
- Dot Width Correction remains clamped to the derived Line Interval.

Defer:

- Interval Test generator.
- Material Test generator.
- Scan Angle / Z Offset / advanced Image Mode settings.

## Files

- Create: `src/core/raster/raster-units.ts`
- Create: `src/core/raster/raster-units.test.ts`
- Modify: `src/ui/raster/AdjustImageDialog.fields.tsx`
- Modify: `src/ui/raster/AdjustImageDialog.test.tsx`
- Modify: `src/ui/layers/LayerImageFields.tsx`
- Modify: `src/ui/layers/CutSettingsDialog.tsx`
- Create: `src/ui/layers/CutSettingsImageFields.tsx`
- Modify: `src/ui/layers/CutsLayersPanel.test.tsx`

## Task 1: Line Interval / DPI Parity

- [x] **Step 1: Write failing unit and UI tests**

Add tests proving:

- `0.1 mm` interval maps to `10 lines/mm` and `254 DPI`.
- `254 DPI` maps to `10 lines/mm` and `0.1 mm` interval.
- Adjust Image: changing DPI updates the internal `linesPerMm` draft and submit patch.
- Adjust Image: changing Line Interval updates the internal `linesPerMm` draft and submit patch.
- Cut Settings dialog: submitting DPI writes the expected `linesPerMm`.
- Visible layer row: changing line interval writes the expected `linesPerMm`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test --run src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/layers/CutsLayersPanel.test.tsx
```

Expected: FAIL because the helper and/or UI controls do not exist.

- [x] **Step 3: Implement pure unit helpers**

Add:

- `MM_PER_INCH = 25.4`
- `linesPerMmToLineIntervalMm(linesPerMm)`
- `lineIntervalMmToLinesPerMm(intervalMm)`
- `linesPerMmToDpi(linesPerMm)`
- `dpiToLinesPerMm(dpi)`
- `normalizeLinesPerMm(value)`

Rules:

- Clamp to existing LaserForge raster budget range: `5..MAX_RASTER_LINES_PER_MM`.
- Keep helpers pure and independent of React.

- [x] **Step 4: Implement synchronized UI fields**

Adjust Image:

- Replace the "Resolution lines/mm" row with Line Interval and DPI rows.
- Both fields update `draft.linesPerMm`.
- Submit patch remains `linesPerMm`.

Layer row:

- Replace "Resolution lines/mm" with Line Interval and DPI rows.
- Both fields update `layer.linesPerMm`.

Cut Settings dialog:

- Show Line Interval and DPI rows in Image mode.
- Read whichever field changed. If both are present, prefer DPI when its submitted value differs from the current layer-derived DPI; otherwise use Line Interval.

- [x] **Step 5: Run GREEN**

Run:

```bash
pnpm test --run src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/layers/CutsLayersPanel.test.tsx
```

Expected: tests pass.

- [x] **Step 6: Focused verification**

Run:

```bash
pnpm test --run src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/raster/AdjustImageDialog.user-presets.test.ts src/ui/layers/CutsLayersPanel.test.tsx src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
pnpm check:file-size
pnpm test
pnpm build:web
```

- [x] **Step 7: Audit and commit**

Audit checklist:

- `linesPerMm` remains the only persisted/emitted internal value.
- DPI and interval controls stay mathematically tied.
- Dot Width Correction maximum follows the current interval.
- No compile/output/preflight path is bypassed.

Commit:

```bash
git add src/core/raster/raster-units.ts src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.fields.tsx src/ui/raster/AdjustImageDialog.test.tsx src/ui/layers/LayerImageFields.tsx src/ui/layers/CutSettingsDialog.tsx src/ui/layers/CutSettingsImageFields.tsx src/ui/layers/CutsLayersPanel.test.tsx docs/superpowers/plans/2026-06-08-image-line-interval-dpi-controls.md
git commit -m "feat(raster): add line interval dpi controls"
git push origin wip/checkpoint-2026-06-03
```

Verification completed:

- RED: `pnpm test --run src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/layers/CutsLayersPanel.test.tsx` failed before implementation because `./raster-units`, `input[name="imageDpi"]`, and visible line-interval controls were missing.
- GREEN: the same Step 3 target suite passed.
- Focused workflow suite: `pnpm test --run src/core/raster/raster-units.test.ts src/ui/raster/AdjustImageDialog.test.tsx src/ui/raster/AdjustImageDialog.user-presets.test.ts src/ui/layers/CutsLayersPanel.test.tsx src/ui/commands/command-registry.test.ts src/ui/state/store.test.ts src/core/raster/luma-adjust.test.ts src/ui/workspace/draw-raster-preview.test.ts src/core/job/compile-job-raster-adjustments.test.ts src/io/project/project.test.ts` passed.
- Full gates: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:file-size`, `pnpm build:web`, and `pnpm test` passed.
- Full test count after this slice: 150 files, 1094 tests.
- Audit: `linesPerMm` remains the canonical internal field; Line Interval and DPI both convert into it; Dot Width Correction maximum remains derived from the current line interval.
