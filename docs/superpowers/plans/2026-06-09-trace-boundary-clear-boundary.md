# Trace Boundary / Clear Boundary Plan

## Research

- LightBurn Trace Image converts an imported image into vector graphics and updates the preview vectors as trace settings change.
- LightBurn's `Boundary` behavior is spatial, not cosmetic: click-drag in the trace preview specifies the portion of the image to trace, and `Clear Boundary` resets it.
- LightBurn's `Fade Image` and `Show Points` are preview controls; `Boundary` is different because it changes the trace input pixels and therefore the resulting vectors.

Sources:
- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/

## Current Code Audit

- `ImportImageDialog.commit` decodes the stored raster file and calls `traceImageWithFallback` directly.
- `useTracePreview.runTrace` calls the same `traceImageWithFallback` path and then stringifies the returned paths for preview.
- `applyTraceToExisting` assumes trace coordinates are in the source raster's pixel coordinate system; it scales those coordinates onto the raster's physical bounds.

## Risk

If Boundary is implemented only as a visual crop, preview and committed output will diverge. If the cropped trace coordinates are not shifted back into the original image coordinate system, the trace will align to the top-left of the source instead of the selected region.

## Implementation

1. Add a pure trace-boundary helper:
   - `TraceBoundary`: `{ x, y, width, height }` in source image pixels.
   - `normalizeTraceBoundary`: clamp/round boundary values to the image extent and reject empty selections.
   - `cropRawImageData`: copy the selected RGBA pixels into a new `RawImageData`.
   - `offsetColoredPaths` / `offsetBounds`: shift cropped trace geometry back into source-image coordinates.
2. Add a UI trace helper used by both preview and commit:
   - No boundary: call `traceImageWithFallback(image, options)` unchanged.
   - Boundary: crop, trace the crop, then offset the result by the boundary origin.
3. Thread `boundary` through:
   - `useTracePreview(file, options, boundary)`
   - `runTrace({ img, options, boundary })`
   - `ImportImageDialog.commit({ boundary })`
4. Add `TracePreview` boundary UI:
   - Drag inside the preview frame to define a rectangle.
   - Render the active rectangle over the source/trace stack.
   - Show `Clear Boundary` only when a boundary exists.
   - Keep `Fade Image` and `Show Points` behavior unchanged.

## TDD

1. Add pure-core tests for boundary normalization, crop pixel copying, and path/bounds offset.
2. Add a `runTrace` test proving bounded tracing calls the worker with cropped dimensions and emits offset paths in an original-size SVG viewBox.
3. Add `ImportImageDialog.commit` test proving bounded commit offsets the traced geometry before storing it.
4. Add `TracePreview` test proving a drag creates a boundary and `Clear Boundary` removes it.
5. Add workflow test proving Trace Image now exposes the Boundary action without reintroducing image-adjustment controls.

## Verification

```powershell
pnpm test --run src/core/trace/trace-boundary.test.ts src/ui/trace/use-trace-preview.test.ts src/ui/trace/TracePreview.test.tsx src/ui/trace/ImportImageDialog.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Preview and commit must share the same bounded-trace helper.
- Boundary geometry must be in source image pixels, not CSS pixels or millimeters.
- Stored trace vectors must remain in the original source image coordinate space.
- Clear Boundary must reset both the UI rectangle and the traced input.
