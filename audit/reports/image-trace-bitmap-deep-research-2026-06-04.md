# Image Trace / Bitmap Deep Research - 2026-06-04

## Goal

Validate the current image trace, image import, image engraving, Convert to
Bitmap, preview, frame, start, and output findings deeply enough that the next
Claude pass has a precise fix brief.

This is audit/research only. No production source was edited.

## Method

- Spawned four independent audit agents:
  - output/preflight/frame/start path
  - trace/import/modal/worker path
  - Convert to Bitmap / raster preview freeze path
  - LightBurn parity path
- Re-read local code paths in this checkout.
- Cross-checked against LightBurn's current official docs.
- Cross-checked browser performance guidance from MDN for canvas encoding.
- Rejected or narrowed old findings that are now stale in current HEAD.

Repo audited: `C:\Users\Asus\LaserForge-2.0`

Branch audited: `wip/checkpoint-2026-06-03`

HEAD audited: `cdc8f7c fix(trace): P2-A revalidate the source before committing a trace`

## Official Reference Baseline

LightBurn references used:

- LightBurn Convert to Bitmap:
  `https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/`
- LightBurn Image Mode:
  `https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/`
- LightBurn Trace Image:
  `https://docs.lightburnsoftware.com/latest/Reference/TraceImage/`
- LightBurn Preview:
  `https://docs.lightburnsoftware.com/latest/Reference/Preview/`
- LightBurn Job Control:
  `https://docs.lightburnsoftware.com/2.1/GetStarted/JobControl/`

Browser performance references used:

- MDN `HTMLCanvasElement.toDataURL()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL`
- MDN `HTMLCanvasElement.toBlob()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob`
- MDN `OffscreenCanvas.convertToBlob()`:
  `https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob`
- MDN Web Workers:
  `https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers`

Key behavior anchors:

- LightBurn Convert to Bitmap is not an immediate hidden operation. It opens a
  window with live preview, Render Type, DPI control, OK, and Cancel. It creates
  an Image Mode bitmap and deletes the source vector unless the user duplicated
  it first.
- LightBurn Image Mode is raster engraving with line interval / DPI, scan
  behavior, overscanning, and multiple image modes.
- LightBurn Trace Image warns that tracing can lose fine details and small text,
  and suggests Image Mode when trace options cannot recover detail.
- LightBurn Preview shows job travel and power/order information. LaserForge
  should not preview one path and burn/frame another.
- LightBurn Stop is not a substitute for a physical emergency stop or power
  cutoff.
- MDN warns that `canvas.toDataURL()` encodes the whole image into an in-memory
  string and recommends `toBlob()` for large images.

## Findings

### P1 - Convert to Bitmap can freeze before any raster budget runs

Status: Confirmed.

Severity: High.

Confidence: High.

Files:

- `src/ui/common/Toolbar.tsx`
- `src/ui/raster/vector-to-bitmap.ts`
- `src/core/raster/rasterize-vector.ts`
- `src/ui/raster/luma-bitmap.ts`

Evidence:

- Toolbar calls `buildBitmapFromVector(convertible)` synchronously inside the
  click handler before any state dispatch.
- `buildBitmapFromVector` immediately calls `assembleBitmap` with the real
  `lumaToBitmap` encoder.
- `assembleBitmap` flattens all vector polylines, rasterizes at fixed 254 DPI,
  and immediately encodes the bitmap.
- `rasterizeVectorToLuma` computes width/height from bounds x DPI, allocates a
  `Uint8Array(width * height)`, then scans each output row and checks contour
  crossings.
- `lumaToBitmap` expands luma to RGBA, builds base64 through a byte-by-byte
  string loop, creates a canvas, calls `putImageData`, then calls
  `canvas.toDataURL()`.
- The existing raster budget applies later in `runPreEmitPreflight` /
  `prepareOutput`, after the `RasterImage` already exists.

Trigger:

- Select a large SVG/text/trace and click Convert to Bitmap.
- Example: 300 mm x 300 mm at 254 DPI is about 3000 x 3000 pixels, roughly
  9 million pixels before RGBA expansion and PNG/base64 encoding.
- A traced logo with many closed contours makes it worse because every output
  scanline walks contour edges.

Failure mode:

- Main thread blocks during raster creation and encoding.
- The UI cannot render progress, cancellation, or the error toast until after
  the expensive work finishes or crashes.

Consequence:

- This matches the user's report that bitmapping freezes the screen.
- It is not covered by the existing output raster budget, because the budget is
  only applied after conversion has already created a raster object.

Concrete fix:

1. Add a pre-conversion budget helper before `rasterizeVectorToLuma`.
2. Compute target pixel dimensions from vector bounds and `CONVERT_TO_BITMAP_DPI`.
3. Call `evaluateRasterBudget(width, height)`.
4. If too large, show a clear toast and do not mutate the scene.
5. Longer-term: move rasterize/encode off the UI thread, or chunk/yield it.
6. Replace sync `toDataURL()` with an async blob/object URL path where possible.

Tests Claude should add first:

- `vector-to-bitmap` budget test: 300 mm x 300 mm at 254 DPI refuses before
  calling the encoder.
- Toolbar/store test: over-budget Convert to Bitmap shows an error toast and
  leaves the selected vector unchanged.
- Optional perf guard: conversion of a safe small square stays deterministic.

### P1 - Raster Preview can still freeze on over-budget rasters

Status: Confirmed.

Severity: High.

Confidence: High.

Files:

- `src/ui/workspace/Workspace.tsx`
- `src/ui/workspace/draw-scene.ts`
- `src/ui/workspace/draw-raster-preview.ts`

Evidence:

- `Workspace.tsx` memoizes `buildPreviewToolpath(project)`, and that path is now
  budgeted by `prepareOutput`.
- But `drawScene` calls `drawRasterPreview()` before drawing the toolpath.
- `draw-raster-preview.ts` computes target raster preview dimensions, decodes
  luma, resamples, dithers, creates RGBA, constructs `ImageData`, and writes it
  to a canvas without checking `evaluateRasterBudget`.

Trigger:

- Preview mode on an over-budget raster image, especially one created by Convert
  to Bitmap or imported at high physical size / line density.

Failure mode:

- The preview toolpath is budgeted, but the raster simulation path can still do
  the expensive work and freeze the UI.

Consequence:

- A user can still freeze the app by toggling Preview even after P1-A fixed
  Save/Start/live-estimate.

Concrete fix:

1. Run `evaluateRasterBudget(targetWidth, targetHeight)` at the top of
   `previewCanvasFor`.
2. If over budget, return `null` before decode/resample/dither/canvas work.
3. Surface a preview-specific message, e.g. "Raster preview skipped: image is too
   large at this layer resolution."

Tests Claude should add first:

- Over-budget raster preview must not call `document.createElement('canvas')`,
  `ImageData`, resample, or dither.
- Normal small raster preview still creates the simulated preview.

### P1 - Custom-origin Start bypasses the raster budget guard

Status: Confirmed and narrowed.

Severity: High.

Confidence: High.

Files:

- `src/ui/laser/start-job-readiness.ts`
- `src/io/gcode/prepare-output.ts`
- `src/core/preflight/pre-emit.ts`

Evidence:

- Normal `emitGcode` uses `prepareOutput`, which runs `runPreEmitPreflight`
  before `compileJob`.
- `prepareStartJob` checks `findOriginBoundsIssue` before calling `emitGcode`.
- `findOriginBoundsIssue` calls `compileJob(project.scene, project.device)`
  directly, then applies user-origin placement and computes bounds.

Trigger:

- Custom work origin active, over-budget raster in the project, operator clicks
  Start.

Failure mode:

- The direct compile path can allocate/resample/dither before the raster budget
  has a chance to reject the job.

Consequence:

- The P1-A freeze fix is incomplete. Default-origin Start is guarded; the
  problem is specifically custom-origin Start.

Concrete fix:

- Minimal: run `runPreEmitPreflight(project)` before `findOriginBoundsIssue`.
- Stronger: build a cheap origin/frame bounds helper that can include raster
  bounds without compiling/dithering raster pixels.

Tests Claude should add first:

- Custom-origin Start + 300 mm x 300 mm image at 25 lines/mm returns
  `raster-too-large` and does not reach raster compile.

### P1 - Frame bypasses the raster budget guard

Status: Confirmed.

Severity: High.

Confidence: High.

File:

- `src/ui/laser/JobControls.tsx`

Evidence:

- `useFrameAction` calls `compileJob(project.scene, project.device)` directly.
- The WCO unknown check happens after the compile.
- The frame bounds check happens after the compile.

Trigger:

- Over-budget raster in project, operator clicks Frame.

Failure mode:

- Frame can compile/dither the raster before any raster budget check.

Consequence:

- App can still freeze through Frame.
- This also weakens LightBurn-style parity because Frame should be a cheap
  bounds/perimeter action, not a full output rasterization.

Concrete fix:

- Minimal: call `runPreEmitPreflight(project)` before compile and toast the
  issue.
- Stronger: compute frame bounds cheaply from object geometry:
  - vector bounds from transformed vector objects
  - raster bounds via `rasterBoundsInMachineCoords`
  - user-origin placement and WCO applied after cheap bounds

Tests Claude should add first:

- Frame + over-budget raster refuses and does not call `frame()`.
- Frame with unknown WCO should reject before any compile work.

### P2 - Trace worker timeout leaves sibling pending requests alive

Status: Confirmed.

Severity: Medium.

Confidence: High.

File:

- `src/ui/trace/use-trace-worker-client.ts`

Evidence:

- Fatal worker error collects all pending promises, clears the map, retires the
  worker, and rejects all pending requests.
- Timeout path deletes and rejects only the timed-out request, then retires the
  shared worker.
- Other pending requests remain in the map until their own timers fire.

Trigger:

- Multiple overlapping worker trace requests are pending; one request times out.

Failure mode:

- Worker is terminated, but sibling callers can remain busy until their own
  30 second timeouts fire.

Consequence:

- The timeout fix prevents infinite hangs, but overlapping preview/commit calls
  can still feel stuck.

Concrete fix:

- Extract a helper such as `rejectAllPendingAndRetireWorker(reason)`.
- On timeout, reject every pending request, clear each request's timer, clear the
  map, and retire the worker.

Tests Claude should add first:

- Fake worker with two pending requests.
- Advance timers to the first timeout.
- Assert both promises reject immediately and worker terminates once.

### P2 - Global shortcuts can still fire behind the Trace modal

Status: Confirmed.

Severity: Medium.

Confidence: High.

Files:

- `src/ui/trace/ImportImageDialog.tsx`
- `src/ui/common/use-dialog-a11y.ts`
- `src/ui/app/use-shortcuts.ts`
- `src/ui/app/shortcuts.ts`
- `src/ui/state/ui-store.ts`

Evidence:

- `ImportImageDialog` opens a real modal and uses `useDialogA11y`.
- `useDialogA11y` handles Escape and Tab focus cycling, but it does not disable
  window-level app shortcuts.
- `useShortcuts` registers window keydown handlers for file/edit/transform/view
  without checking whether a dialog is open.
- `isEditableTarget` only protects text-like targets and does not protect
  buttons/selects or file shortcuts.

Trigger:

- Trace modal open, then user presses Delete/Backspace, Ctrl+O, Ctrl+E, arrows,
  H/V, or P while focus is not in a protected editable input.

Failure mode:

- The underlying scene or file flow can mutate while the operator believes the
  modal owns input.
- Source revalidation prevents a bad trace commit after source deletion, but it
  does not prevent the destructive behind-modal action itself.

Consequence:

- This is a real correctness and UX bug in the trace workflow.

Concrete fix:

- Add an `activeDialog` or derived `isModalOpen` state in `ui-store`.
- Make global shortcut hooks early-return while any modal is open, except for
  dialog-local Escape/Tab handling.

Tests Claude should add first:

- With `imageDialog !== null`, Delete/Backspace does not remove the selected
  object.
- With a dialog open, Ctrl+O/Ctrl+E do not invoke file/open/export handlers.

### P2 - Convert to Bitmap can create rasters that preview but cannot output

Status: Confirmed.

Severity: Medium.

Confidence: High.

Files:

- `src/ui/raster/vector-to-bitmap.ts`
- `src/ui/workspace/draw-raster.ts`
- `src/core/preflight/preflight.ts`

Evidence:

- Convert to Bitmap copies the source vector's bounds and transform verbatim
  into the new `RasterImage`.
- Canvas drawing honors rotation/mirror transforms.
- Output preflight rejects rotated or mirrored rasters as
  `unsupported-raster-transform`.

Trigger:

- Convert a rotated or mirrored vector into a bitmap.

Failure mode:

- The result appears on canvas, but Start/Save can reject it later.

Consequence:

- Preview/design view and output capability diverge.

Concrete fix:

- Fastest: block Convert to Bitmap when the selected vector has rotation or
  mirror and tell the user why.
- Better: bake transform into the generated bitmap and reset raster transform to
  supported scale/translate.

Tests Claude should add first:

- Rotated vector Convert to Bitmap refuses with toast and no mutation, or bakes
  transform and passes preflight. Pick one behavior and pin it.

### P2 - Image density import handles common PNG/JFIF but not EXIF-only or non-square density

Status: Valid edge gap, lower priority.

Severity: Low-Medium.

Confidence: High.

Files:

- `src/ui/common/image-density.ts`
- `src/ui/common/image-import.ts`

Evidence:

- Current parser supports PNG `pHYs` and JFIF density.
- It returns a single DPI number, not separate X/Y density.
- EXIF-only JPEG density is not parsed.

Trigger:

- EXIF-only JPEG import, or image with different X/Y density.

Failure mode:

- Physical import size can be wrong.

Consequence:

- Not a burn-safety issue, but it affects real-world sizing.

Concrete fix:

- Return `{ xDpi, yDpi, source }`.
- Parse EXIF IFD0 `XResolution`, `YResolution`, and `ResolutionUnit`.
- Either support axis-specific sizing or warn/reject non-square density.

## Older Findings To Retire Or Narrow

Do not tell Claude these are still broadly open without rechecking:

- Default-origin Save/Start output budget is now guarded through
  `prepareOutput`.
- Preview raw-compile mismatch is mostly fixed for the toolpath order path.
- Stale trace preview result overwrite is fixed with token checks.
- Trace source revalidation is fixed for source content/pixel-grid changes.
- Non-string `FileReader.result` now rejects.
- Common PNG/JFIF density import is implemented.
- Raster import layer color collision is fixed for non-image `#808080` layers.
- Long blank-feed invariant exists and is covered.

The remaining valid wording is narrower:

- Custom-origin Start and Frame still bypass the raster budget.
- Raster preview simulation still bypasses the raster budget.
- Convert to Bitmap creation itself is unbudgeted and synchronous.
- Trace modal still allows global shortcuts behind it.

## Claude Fix Brief

Use this order. Each item should be its own small diff with tests first.

1. **Convert to Bitmap budget guard**
   - Add a helper to compute conversion dimensions before rasterization.
   - Reuse `evaluateRasterBudget`.
   - Refuse before `rasterizeVectorToLuma`.
   - Add tests for no encoder call, no scene mutation, and error toast.

2. **Raster preview budget guard**
   - Add `evaluateRasterBudget` to `previewCanvasFor` before decode/resample/dither.
   - Return null and expose a preview-skipped message.
   - Add tests proving over-budget preview does not allocate canvas/ImageData.

3. **Custom-origin Start and Frame guard**
   - Prefer a cheap bounds helper over full `prepareOutput` for Frame.
   - At minimum, run `runPreEmitPreflight` before direct `compileJob`.
   - Add over-budget raster tests for custom-origin Start and Frame.

4. **Trace worker sibling timeout**
   - Reject all pending requests when the shared worker is retired on timeout.
   - Add overlapping pending fake-worker test.

5. **Modal shortcut suppression**
   - Add `activeDialog` or `isModalOpen`.
   - Disable global app shortcuts while text/image dialogs are open.
   - Add Delete/Backspace and Ctrl+O/Ctrl+E tests.

6. **Convert transformed vectors policy**
   - Either block rotate/mirror conversion or bake transforms.
   - The smallest safe fix is to block and explain.

7. **DPI edge improvements**
   - Parse EXIF density and non-square density later; do not mix with the freeze
     fixes.

## Recommended Tests To Run After Claude Fixes

Focused:

```powershell
pnpm test --run src/ui/raster/vector-to-bitmap.test.ts src/core/raster/rasterize-vector.test.ts src/ui/state/convert-to-bitmap.test.ts src/ui/workspace/draw-raster-preview.test.ts src/ui/workspace/draw-preview.test.ts src/ui/laser/start-job-readiness.test.ts src/ui/laser/JobControls.test.tsx src/ui/trace/use-trace-worker-client.test.ts src/ui/app/shortcuts.test.ts
```

Then:

```powershell
pnpm run typecheck
npm.cmd run lint
pnpm test
npm.cmd run build
```

## Hardware / Browser Verification Still Needed

Do not call this fully proven from tests alone. After fixes:

- Use a throwaway scene, not the maintainer's live work, to verify Convert to
  Bitmap on small and deliberately-too-large vectors.
- Verify Preview does not freeze on the refused over-budget raster.
- Verify a real imported image can still trace and commit.
- Verify a real converted bitmap burns as Image Mode, not vector Fill/Line.

