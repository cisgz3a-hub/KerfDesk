# Convert to Bitmap Budget Audit - 2026-06-07

## Scope

Audited and patched the LaserForge 2.0 Convert to Bitmap workflow after the
latest image-workflow fixes. This audit covers the operator-facing conversion
dialog and the vector-to-raster builder only.

Repo: `C:\Users\Asus\LaserForge-2.0`

Branch: `wip/checkpoint-2026-06-03`

## Research Baseline

- LightBurn Convert to Bitmap opens a window with preview, Render Type, DPI,
  OK, and Cancel. DPI controls pixel density; higher DPI means sharper bitmap
  output. Source: https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/
- LightBurn says the produced bitmap is Image Mode and its pixels are 50 percent
  gray before later image adjustment. Same source.
- LightBurn warns that converting deletes the source vector unless the operator
  duplicates it first. LaserForge already follows the replace-in-place behavior.
- MDN warns that `canvas.toDataURL()` encodes the entire image into an in-memory
  string and recommends `toBlob()` for larger images. Source:
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL
- MDN documents `HTMLCanvasElement.toBlob()` as an async Blob-producing encode
  API. Source:
  https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob

## Finding

### P1 - Convert to Bitmap silently lowered requested DPI

Status: fixed.

Files:

- `src/ui/raster/vector-to-bitmap.ts`
- `src/ui/raster/ConvertToBitmapDialog.tsx`
- `src/ui/raster/bitmap-conversion-plan.ts`

Trigger:

Select a physically large vector and run Convert to Bitmap at the default
254 DPI.

Failure mode before this patch:

The converter used a binary search to reduce `linesPerMm` until the raster fit
under `evaluateRasterBudget()`. That avoided the freeze, but it secretly changed
the operator's requested resolution.

Consequence:

This diverged from LightBurn's DPI contract and could produce visibly lower
detail without telling the operator why. It also contradicted the saved
LaserForge plan that over-budget conversion must refuse before rasterization.

Fix:

- Added a shared `bitmap-conversion-plan.ts` estimator.
- The dialog now shows the estimated bitmap size for the selected DPI.
- The dialog disables Convert and shows the budget reason when the requested
  pixel grid exceeds the shared raster budget.
- The builder now throws before rasterization/encoding when the requested
  conversion exceeds budget.
- The old silent downscale path was removed.

## Verification

- Red test confirmed the old converter did not throw and did call the encoder.
- Red test confirmed the dialog did not show estimated dimensions.
- Focused tests: `pnpm test --run src/ui/raster/vector-to-bitmap.test.ts src/ui/raster/ConvertToBitmapDialog.test.tsx src/ui/common/Toolbar.test.tsx src/ui/commands/command-registry.test.ts src/ui/raster/luma-bitmap.test.ts src/ui/state/convert-to-bitmap.test.ts` - 39 passed.
- Typecheck: `pnpm typecheck` - pass.
- Lint: `pnpm lint` - pass with existing boundaries legacy-selector warning only.
- Format: `pnpm format:check` - pass.
- File-size backstop: `pnpm check:file-size` - pass.
- Full test suite: `pnpm test` - 145 files / 1109 tests passed.
- Web build: `pnpm build:web` - pass.
- Browser smoke: `http://127.0.0.1:5176/` loads LaserForge, menus switch
  correctly, and console error log was empty.

## Residual Risk

No live canvas import/conversion was performed during the browser smoke because
the repo operating rules say the maintainer's live app scene is not a sandbox.
The dialog and conversion behavior are covered by unit/integration tests. A
maintainer smoke test with a duplicated vector should confirm the new warning
copy and desired DPI before the next hardware burn.
