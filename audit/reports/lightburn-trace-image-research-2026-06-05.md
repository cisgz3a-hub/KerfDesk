# LightBurn Trace Image Research

Date: 2026-06-05
Scope: research and implementation planning only. No production code was changed for this report.
Repository: `C:\Users\Asus\LaserForge-2.0`

## Executive Summary

LaserForge is no longer in the old broken "Photo / Detailed trace presets" state. ADR-043 removed those presets, and that was the correct move. Trace is now vector-only at the UI level, with photos and continuous-tone images directed to Image/raster engraving instead.

Current LaserForge trace is partially LightBurn-aligned:

- Image import is one action.
- Trace runs on a selected, already-imported bitmap.
- Source bitmap is kept by default.
- Trace dialog exposes Cutoff, Threshold, Ignore, Smoothness, and Optimize.
- Line Art, Smooth, Sharp, and Centerline are the active presets.
- Photo/Detailed are removed from the surfaced preset list.
- The binary trace path now usually routes through a custom Potrace-style backend.

The remaining gaps are real but smaller than the old audit notes imply:

- `Cutoff` / `Threshold` are ignored by Otsu-based presets such as Smooth, Sharp, and Centerline because `useOtsuThreshold` wins over manual threshold settings.
- The UI label says `Ignore <`; LightBurn's label is `Ignore Less Than`.
- Trace still mixes LightBurn Trace controls with image-adjustment controls that belong in a separate Adjust Image workflow.
- `Trace Transparency`, `Sketch Trace`, `Fade Image`, `Boundary / Clear Boundary`, `Show Points`, and `Delete Image After Trace` are still missing.
- Trace output is still a special `TracedImage` scene object instead of plain vector artwork with provenance metadata.
- Some worker/modal/freeze prevention follow-ups remain pending from the earlier image trace / bitmap audit.

Recommendation:

1. Keep Photo/Detailed removed. Do not rename or restore them.
2. First fix the current LightBurn controls so Cutoff/Threshold actually affect all surfaced presets.
3. Rename `Ignore <` to `Ignore Less Than`.
4. Move image adjustment/dither controls out of Trace toward a separate Adjust Image surface.
5. Add missing LightBurn trace features in stages.
6. Defer eliminating `TracedImage` until a schema-v2 migration is planned.

## Official LightBurn Baseline

Official sources:

- Trace Image: https://docs.lightburnsoftware.com/latest/Reference/TraceImage/
- Adjust Image: https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/
- Shape Properties: https://docs.lightburnsoftware.com/latest/Reference/ShapeProperties/
- Image Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- Convert to Bitmap: https://docs.lightburnsoftware.com/latest/Reference/ConvertToBitmap/
- Fill Mode: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/FillMode/
- Preview: https://docs.lightburnsoftware.com/latest/Reference/Preview/

LightBurn's model:

- Import creates an image object.
- Trace Image is a tool run on that selected image.
- Trace creates vector graphics.
- The source image is kept by default unless `Delete Image After trace` is enabled.
- Photos and shaded images are normally engraved through Image Mode, not vector trace.

Trace Image controls verified from LightBurn docs:

| Control | Meaning |
|---|---|
| Fade Image | Dims the source image in the trace preview so vector output is easier to inspect. |
| Boundary / Clear Boundary | Restricts tracing to a user-selected region of the source image. |
| Show Points | Shows/hides node markers in the trace preview. |
| Cutoff | Lower bound of the brightness range to trace. |
| Threshold | Upper bound of the brightness range to trace. Default range is 0..128. |
| Ignore Less Than | Drops traced regions below a pixel-count threshold. |
| Optimize | Reduces vector node count. 0 disables optimization; higher values reduce accuracy. |
| Smoothness | Converts more line segments into curves. 0.0 is straight lines; 1.33 is curves only. |
| Trace Transparency | Traces from the alpha channel instead of brightness. |
| Sketch Trace | Local-contrast / edge-style trace for sketches, handwriting, or documents. |
| Delete Image After trace | Removes the source image after OK. Default is off. |

Not Trace Image controls:

- Adjust Image: brightness, contrast, gamma, presets, enhance controls, and side-by-side image adjustment workflow.
- Image Mode: raster engraving, line interval / DPI, image processing mode, dithering, overscanning, negative image, scan angle, pass-through, dot width correction.
- Convert to Bitmap: vector-to-raster conversion with Render Type and DPI.
- Flood Fill: Fill-mode path planning, not image trace.
- Preview: output simulation, not trace algorithm control.

## Current LaserForge Trace Workflow

### Import and Trace Entry Points

Current workflow matches the main LightBurn model:

- `src/ui/common/Toolbar.tsx` has one `Import Image...` action for PNG/JPG.
- Import creates a `RasterImage`.
- `Trace Image...` is disabled until a `raster-image` is selected.
- The trace dialog is seeded from the selected raster; it does not show a file picker.
- The dialog reconstructs a `File` from the stored raster `dataUrl` and runs the existing decode/trace preview pipeline.

This is a corrected state compared to older reports that described separate trace-vs-engrave import paths.

### Active Presets

Current active presets in `src/core/trace/trace-image.ts`:

- `Line Art`
- `Centerline`
- `Smooth`
- `Sharp`

Removed presets:

- `Photo`
- `Detailed`

ADR-043 correctly documents why Photo/Detailed were removed: they were multi-color posterization presets, not useful vector tracing. They could preserve near-white page/background regions as vector fills because only exact `#ffffff` background was dropped. The user's "whole white page remains" report matches that failure mode.

### Algorithms

LaserForge currently uses three trace algorithm paths:

1. Potrace-style filled contour backend
   - Used by surfaced binary filled-contour presets where possible.
   - Files: `src/core/trace/potrace-trace.ts`, `src/core/trace/potrace-bitmap.ts`, `src/core/trace/potrace-params.ts`.

2. Centerline backend
   - Skeletonizes dark strokes into open line paths.
   - Files: `src/core/trace/centerline-trace.ts`, `centerline-mask.ts`, `centerline-polylines.ts`, `centerline-fit.ts`.

3. imagetracerjs backend
   - Still present for legacy SVG output and adaptive/multi-color internal paths.
   - Files: `src/core/trace/trace-image.ts`, `src/core/trace/trace-to-paths.ts`.

This is reasonable. The problem is not that LaserForge still has imagetracerjs internally. The problem would be exposing multi-color posterization as "Trace Image" again.

## Confirmed Findings

### P1 - Cutoff/Threshold UI is not authoritative for all visible presets

Severity: High

Confidence: High

Evidence:

- `TraceSettingsControls.tsx` exposes `Cutoff` and `Threshold`.
- `mergeLightBurnTraceSettings` writes `cutoffLuma` / `thresholdLuma` into `TraceOptions`.
- `preprocessForTrace` calls `applyThreshold`.
- `applyThreshold` uses Otsu first:

```text
if useOtsuThreshold === true -> thresholdToMonochrome(image, otsuThreshold(image))
else if cutoffLuma exists -> thresholdBandToMonochrome(...)
else if thresholdLuma exists -> thresholdToMonochrome(...)
```

Trigger:

- Select Smooth, Sharp, or Centerline.
- Change Cutoff/Threshold.

Failure mode:

- The visible manual brightness-band controls can be ignored because those presets set `useOtsuThreshold`.

Consequence:

- User thinks they are tuning LightBurn-style Cutoff/Threshold, but the algorithm still chooses the threshold automatically.

Concrete fix:

- If the user overrides Cutoff or Threshold, disable `useOtsuThreshold` for that trace request.
- Add tests proving Cutoff/Threshold change output for every surfaced preset.
- Keep Otsu only as preset default behavior before the user touches manual threshold controls.

### P1 - Trace controls are still mixed with image adjustment controls

Severity: Medium-High

Confidence: High

Evidence:

- `AdjustmentControls.tsx` exposes Brightness, Contrast, Gamma, Invert, and Dither in the Trace dialog.
- LightBurn puts brightness/contrast/gamma-style editing into Adjust Image, not Trace Image.
- Trace dither is also conceptually separate from Image Mode dither; it is preprocessing for vectorization, not raster engraving.

Consequence:

- Operators can conflate three separate LightBurn workflows:
  - Trace Image
  - Adjust Image
  - Image Mode raster engraving

Concrete fix:

- Keep a minimal preview-adjustment escape hatch only if needed for quality, but do not present it as full LightBurn Trace parity.
- Preferred staged path:
  - First make Trace controls correct.
  - Then build a separate Adjust Image surface for selected raster objects.
  - Move brightness/contrast/gamma/invert there.
  - Keep Image Mode dither controls on image layers.

### P1 - `Trace Transparency` is missing and current alpha handling conflicts with it

Severity: Medium-High

Confidence: High

Evidence:

- LightBurn has Trace Transparency.
- `image-loader.ts` composites transparent pixels onto white before tracing.

Consequence:

- This is correct for normal brightness tracing because it prevents transparent PNG backgrounds from becoming black.
- It prevents any honest claim that LaserForge can trace alpha/transparency like LightBurn.

Concrete fix:

- Do not claim Trace Transparency until the loader can preserve alpha for trace requests.
- Add a separate alpha-mask trace path when `traceTransparency` is true.
- Keep white compositing for normal brightness trace.

### P2 - `Sketch Trace` is missing

Severity: Medium

Confidence: High

Evidence:

- LightBurn exposes Sketch Trace for local-contrast / edge-like tracing.
- LaserForge has `Centerline`, but that is not the same feature. Centerline skeletonizes dark stroke masks; Sketch Trace is for contrast edges / documents / uneven lighting.

Concrete fix:

- Defer until after primary brightness-band trace is correct.
- Implement as a separate algorithm path, not a renamed Centerline preset.
- Add handwriting/document fixtures.

### P2 - Missing preview controls: Fade Image, Boundary, Show Points

Severity: Medium

Confidence: High

Evidence:

- LightBurn Trace Image has Fade Image, Boundary / Clear Boundary, and Show Points.
- LaserForge has live preview but not these controls.

Concrete fix:

- Add Fade Image first; it is UI-only and pairs with the current retained source bitmap.
- Add Show Points after the preview has a vector-node overlay.
- Add Boundary last; it affects the trace input and requires coordinate mapping from preview selection to source pixel crop.

### P2 - Missing `Delete Image After Trace`

Severity: Medium

Confidence: High

Evidence:

- LightBurn keeps the image by default but exposes Delete Image After trace.
- LaserForge always keeps the source and tags it as `trace-source`.

Concrete fix:

- Add a default-off checkbox.
- If enabled, commit should add the trace and remove the source raster in one undoable mutation.
- Preserve current default of keeping the source.

### P2 - Trace output remains a special `TracedImage` object kind

Severity: Medium

Confidence: High

Evidence:

- `SceneObject` includes `TracedImage`.
- `compile-job.ts` treats `traced-image` like imported SVG/text.
- LightBurn trace output is ordinary vector artwork grouped after trace.
- `LIGHTBURN-STUDY.md` already identifies this as a structural divergence.

Consequence:

- Compile behavior is mostly fine today, but model complexity leaks everywhere: scene union arms, validators, preflight, convert-to-bitmap, and future edit tools.

Concrete fix:

- Defer until a schema v2 migration is planned.
- Migrate `traced-image` into a plain vector object with provenance metadata:

```ts
provenance?: {
  kind: 'trace';
  sourceImageId?: string;
  sourceName: string;
  traceMode: 'filled-contours' | 'centerline';
  options?: TraceOptions;
  sourceFingerprint?: string;
}
```

- Preserve G-code equivalence for existing projects.

### P2 - Worker timeout does not reject sibling pending trace requests

Severity: Medium

Confidence: Medium-High

Evidence:

- Saved deep research found this.
- `use-trace-worker-client.ts` retires the worker when one request times out.
- It deletes/rejects only the timed-out request.
- Other pending requests can remain pending until their own timeout.

Concrete fix:

- Add `rejectAllPendingAndRetireWorker(reason)`.
- On fatal worker error or timeout, reject every pending request and clear timers.

### P2 - Global shortcuts can still mutate behind modals

Severity: Medium

Confidence: Medium-High

Evidence:

- Saved deep research lists this as pending.
- Current `ui-store.ts` has text and image dialogs but no general modal-open selector.

Concrete fix:

- Add `isModalOpen` derived from text/image/convert dialogs.
- Gate destructive shortcuts while a modal is open.

## Photo / Detailed Decision

Do not restore Photo or Detailed.

Rationale:

- They were not LightBurn trace controls.
- They produced posterized grey vector fill regions.
- They made users think a photo was being traced when the correct workflow is Image Mode raster engraving.
- ADR-043 is correct and should stay accepted.

If a multi-color vectorization capability is ever useful, it should not be called Photo or Detailed inside Trace Image. It would need a separate feature name such as Posterize to Vectors, with clear warnings that it is not photo engraving.

## Staged Implementation Plan

### B1 - Make Existing LightBurn Controls Honest

No new UI scope beyond corrections.

Changes:

- Rename `Ignore <` to `Ignore Less Than`.
- If manual Cutoff/Threshold overrides exist, remove/ignore `useOtsuThreshold` for that trace request.
- Add tests proving Cutoff/Threshold changes output for Line Art, Smooth, Sharp, and Centerline.
- Add tests for merge behavior:
  - untouched Smooth can still use Otsu
  - changed Cutoff/Threshold disables Otsu

Verification:

- `src/ui/trace/trace-options.test.ts`
- `src/core/trace/trace-image.test.ts`
- `src/core/trace/potrace-bitmap.test.ts`
- `src/core/trace/potrace-trace.test.ts`
- `src/ui/trace/use-trace-preview.test.ts`

### B2 - Finish Worker/Modal Safety Follow-Ups

Changes:

- Reject all pending trace worker requests on timeout/fatal error.
- Gate global shortcuts while Trace/Text/Convert dialogs are open.
- Add tests for overlapping worker requests and modal shortcut suppression.

Why before adding more controls:

- More live controls means more overlapping trace requests.
- More modal controls means more time in modal state.

### B3 - Separate Trace from Adjust Image

Changes:

- Keep Trace Image focused on trace-specific controls.
- Move brightness/contrast/gamma/invert toward selected-raster Adjust Image.
- Keep image-mode dither settings on image layers.
- Keep trace-only dither hidden or advanced until there is a LightBurn-justified reason to expose it.

Do not remove controls abruptly if users still rely on them. Use a staged UI change and tests.

### B4 - Add LightBurn Preview Actions

Order:

1. Fade Image
2. Show Points
3. Boundary / Clear Boundary

Boundary should come last because it changes the input image crop and registration math.

### B5 - Add Trace Transparency

Changes:

- Preserve alpha in decode path when traceTransparency is true.
- Build alpha mask trace input.
- Keep white compositing for normal brightness trace.
- Add transparent PNG fixtures.

### B6 - Add Sketch Trace

Changes:

- Implement local-contrast / edge-style trace as a separate algorithm mode.
- Do not reuse Centerline as a label.
- Add handwriting/document fixtures.

### B7 - Add Delete Image After Trace

Changes:

- Default off.
- If on, commit trace and remove source raster in one undoable mutation.
- If off, preserve current source-retention behavior.

### B8 - Plan Schema v2 for Trace Output Model

Changes:

- Replace `TracedImage` with plain vector artwork plus trace provenance metadata.
- Add v1 -> v2 migration.
- Preserve burn output equivalence.
- Update validators and all `SceneObject` switches.

This is intentionally later because it touches the whole object model.

## Verification Bundle

Focused tests before any trace-control patch:

```powershell
pnpm test --run src/ui/trace/trace-options.test.ts src/core/trace/trace-image.test.ts src/core/trace/potrace-bitmap.test.ts src/core/trace/potrace-params.test.ts src/core/trace/potrace-trace.test.ts src/core/trace/centerline-trace.test.ts src/ui/trace/use-trace-preview.test.ts src/ui/trace/use-trace-worker-client.test.ts src/ui/trace/ImportImageDialog.test.ts
pnpm run typecheck
```

After UI/modal/worker changes:

```powershell
pnpm test --run src/ui/trace/use-trace-worker-client.test.ts src/ui/app/shortcuts.test.ts src/ui/trace/ImportImageDialog.test.ts src/ui/common/Toolbar.test.tsx
pnpm test
npm.cmd run build
```

Hardware/burn proof is not required for pure trace-control UI unless emitted vector output changes materially. If the geometry changes, run a scrap burn with:

- line-art logo
- small text
- centerline strokes
- transparent-background PNG
- noisy sketch/document

Capture source image, `.lf2`, emitted G-code, preview screenshot, and burn photo.

## Final Recommendation

Next implementation should be B1 + B2 only:

1. Fix Cutoff/Threshold authority over Otsu presets.
2. Rename `Ignore <` to `Ignore Less Than`.
3. Reject all pending trace worker requests on timeout/fatal worker failure.
4. Gate global shortcuts while trace/image/text/convert dialogs are open.

That is the smallest high-value step. It makes the controls already on screen truthful before adding more LightBurn features.
