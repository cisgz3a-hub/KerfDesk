# Phase G Remediation Audit - 2026-06-14

## Scope

Remediation and verification for the Phase G drawing-workflow findings from
`audit/reports/phase-g-claude-changes-audit-2026-06-14.md`.

- Checkout: `C:\Users\Asus\LaserForge-2.0`
- Branch: `feat/drawing-tools-phase-g`
- Audit/fix stance: evidence first, tests before production changes, minimal code
  changes, then re-audit.
- Production-code scope changed: Phase G vector/layer workflow only.

## External Research Used

- LightBurn Convert to Bitmap reference:
  `https://docs.lightburnsoftware.com/2.1/Reference/ConvertToBitmap/`
  - Convert to Bitmap applies to selected vector graphics.
  - It creates an image from the vector and removes the source vector.
  - Render Type / DPI are part of the expected workflow.
- LightBurn Colors and Layers guide:
  `https://docs.lightburnsoftware.com/2.1/GetStarted/ColorsAndLayers/`
  - Clicking a color/layer with no selected objects sets the color/layer for new
    objects.
  - Vector graphics use line/fill-style layer modes; images use Image.
- LightBurn Creation Toolbar reference:
  `https://docs.lightburnsoftware.com/2.1/Reference/UI/CreationToolbar/`
  - Line/shape tools are ordinary vector-creation workflows.
- LightBurn Preview / Cut Selected Graphics reference:
  `https://docs.lightburnsoftware.com/2.1/Reference/CutSelectedGraphics/`
  - Preview should reflect the graphics that will be output to the laser.

## Findings Remediated

### Fixed: shape-only layers could be pruned

- File: `src/ui/state/scene-mutations.ts`
- Fix: `pruneOrphanLayers` now treats `kind: 'shape'` as a path-bearing vector
  object, same as SVG/text/traced vectors.
- Test: `src/ui/state/scene-mutations.test.ts` now verifies a layer referenced
  only by a drawn shape is preserved.

### Fixed: Convert to Bitmap skipped drawn shapes

- Files:
  - `src/ui/raster/bitmap-assembly.ts`
  - `src/ui/commands/bitmap-conversion.ts`
- Fix: `ShapeObject` is now part of `ConvertibleVector`, `isConvertibleVector`
  accepts shapes, and shape bitmap labels are stable (`rect shape (bitmap)`,
  etc.).
- Tests: `src/ui/raster/vector-to-bitmap.test.ts` now proves shapes are accepted,
  rasterized, and labeled correctly.

### Fixed: Preview ghost geometry skipped drawn shapes

- File: `src/ui/workspace/draw-preview.ts`
- Fix: the faint source-geometry preview now draws all path-bearing vector object
  kinds: imported SVG, text, traced image, and shape.
- Test: `src/ui/workspace/draw-preview.test.ts` now verifies shape source
  geometry is drawn in preview.

### Fixed: drawn objects used the first layer instead of the current layer

- Files:
  - `src/ui/state/ui-store.ts`
  - `src/ui/layers/LayerRow.tsx`
  - `src/ui/layers/AddLayerControls.tsx`
  - `src/ui/workspace/draw-tool.ts`
  - `src/ui/workspace/pen-tool.ts`
  - `PROJECT.md`
- Fix: introduced ephemeral `activeLayerColor` UI state. Clicking a Cuts/Layers
  row or adding a layer sets the current drawing layer color. Rectangle/ellipse/
  polygon drafts and pen commits use that current color when it still exists in
  the project, otherwise they fall back to the first layer, then black.
- Tests:
  - `src/ui/state/ui-store.test.ts`
  - `src/ui/workspace/draw-tool.test.ts`
  - `src/ui/workspace/pen-tool.test.ts`
  - `src/ui/layers/LayerRow.double-click.test.tsx`

### Fixed: untracked scratch file in production tree

- File removed: `src/io/svg/circular-test.ts`
- Rationale: it was a manual `console.log` scratch script under `src/`, not a
  test runner fixture or production module.

### Fixed: stale Phase G shortcut docs

- File: `PROJECT.md`
- Fix: Phase G now documents the current as-built shortcut decision:
  `Ctrl+R` Rectangle, `Ctrl+E` Ellipse, `Ctrl+L` Line/Pen, and `Ctrl+Shift+E`
  for Save G-code.

## Deliberately Not Cherry-Picked

`e7784c8 fix: improve LightBurn workflow guards` is still not merged into this
branch as a raw cherry-pick. It predates the current B7 shortcut decision and
would move Save G-code back to `Alt+Shift+L`, conflicting with the current
`Ctrl+Shift+E` code, toolbar hint, command registry, and `PROJECT.md`.

Recommended follow-up: port only the non-conflicting guard improvements from
`e7784c8` in a dedicated pass, preserving `Ctrl+Shift+E` and adding `shape`
arms to any imported guard helpers before landing.

## Working Tree Note

Additional modified files under `src/core/shapes/` were present during the final
audit pass. They repeat the first point on closed rectangle/ellipse/polygon/
polyline geometry so the existing stroke renderer draws the closing segment
without relying on `closePath`. They were not part of this remediation scope, but
the diffs were inspected and the full suite passed with them present.

## Verification

Red tests were added first and failed on the expected missing behavior:

- shape-only layer pruning returned no layers
- `isConvertibleVector(shape)` returned false
- shape bitmap labels were `undefined (bitmap)`
- preview ghost drawing produced zero shape stroke calls
- `activeLayerColor` state did not exist

After remediation, the following passed:

```text
corepack pnpm test --run src/ui/state/scene-mutations.test.ts src/ui/raster/vector-to-bitmap.test.ts src/ui/workspace/draw-preview.test.ts src/ui/state/ui-store.test.ts src/ui/workspace/draw-tool.test.ts src/ui/workspace/pen-tool.test.ts src/ui/layers/LayerRow.double-click.test.tsx
```

Result: 7 files / 66 tests passed.

```text
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
corepack pnpm test
corepack pnpm build:web
```

Results:

- `typecheck`: passed
- `lint`: passed; existing jsboundaries migration warning only
- `format:check`: passed
- full test suite: 208 files / 1473 tests passed
- `build:web`: passed; existing chunk-size warning only

One new React style warning from the active layer highlight was caught during the
full test audit and fixed by using a full `border` style override instead of
mixing `border` and `borderColor`.

## Post-Fix Assessment

The Phase G shape workflow is now internally consistent for the audited paths:

- drawn shapes keep their Cuts/Layers rows during cleanup
- drawn shapes can Convert to Bitmap like other vectors
- preview ghost geometry includes drawn shapes
- new drawn geometry uses the current layer color rather than silently using the
  first layer
- stale scratch/documentation drift was removed

Remaining operational risk is isolated to reconciling the older workflow-guard
commit (`e7784c8`) without regressing the current shortcut contract.
