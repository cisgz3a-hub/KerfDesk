# Trace Workflow Audit

Date: 2026-06-08

Repo: `C:\Users\Asus\LaserForge-2.0`

Branch: `wip/checkpoint-2026-06-03`

Head before report: `447b320 fix(trace): remove dither controls from trace dialog`

Scope: audit only. No production code was changed by this report.

## Method

This pass audited the Trace Image workflow after the latest dither-control
cleanup. It compared the live code against official LightBurn documentation and
the repo's own LightBurn trace research.

Commands run:

```text
git status --short --branch
pnpm test --run src/ui/trace/AdjustmentControls.test.tsx src/ui/trace/trace-options.test.ts src/ui/trace/trace-pipeline.integration.test.ts src/core/trace/trace-image.test.ts src/core/trace/dither-trace.test.ts src/ui/trace/use-trace-preview.test.ts
rg "Photo|Detailed|Dither|ditherMode|TraceTransparency|traceTransparency|Sketch|Boundary|Show Points|Fade Image|Delete Image" src audit docs -n
rg "sketchTrace|Sketch Trace|Fade Image|Show Points|Boundary|Delete Image After" src/ui/trace src/core/trace -n
```

Focused trace suite result:

```text
6 test files passed
82 tests passed
```

Official references checked:

- LightBurn Trace Image:
  https://docs.lightburnsoftware.com/latest/Reference/TraceImage/
- LightBurn Image Mode:
  https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- LightBurn Adjust Image:
  https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/

## LightBurn Baseline

LightBurn Trace Image converts imported images into vector graphics. It is best
suited to high-contrast images with defined edges: logos, silhouettes,
cartoons, sketches, and handwriting. Its documented Trace Image controls are:

- Cutoff
- Threshold
- Ignore Less Than
- Optimize
- Smoothness
- Trace Transparency
- Sketch Trace
- Fade Image
- Boundary / Clear Boundary
- Show Points
- Delete Image After trace

LightBurn documents image engraving modes separately under Image Mode. That is
where Threshold, Ordered, Atkinson, Dither, Stucki, Jarvis, Newsprint,
Halftone, Sketch, and Grayscale belong.

LightBurn documents brightness, contrast, gamma, layer image settings, and
image presets under Adjust Image, not as Trace Image controls.

## Current Good State

These findings from older audits are now rejected as stale:

1. **Photo / Detailed are not surfaced presets.**

   Evidence: `src/core/trace/trace-image.ts:181-257` exposes only `Line Art`,
   `Centerline`, `Smooth`, and `Sharp`. Current tests keep a multi-colour
   options object only as internal engine coverage:
   `src/ui/trace/trace-pipeline.integration.test.ts:29-33`.

   Verdict: correct. Do not restore Photo or Detailed inside Trace Image.

2. **The Trace Image dither dropdown is removed.**

   Evidence: `src/ui/trace/AdjustmentControls.tsx:10-22` has only brightness,
   contrast, gamma, and invert in `AdjustmentValues`; the regression test
   asserts that Trace Image no longer renders `Dither` or a select:
   `src/ui/trace/AdjustmentControls.test.tsx:10-20`.

   Verdict: correct. Raster dither belongs to Image Mode / Adjust Image.

3. **Manual Cutoff / Threshold is now authoritative over Otsu presets.**

   Evidence: `src/ui/trace/trace-options.ts:34-40` deletes
   `useOtsuThreshold` when cutoff or threshold is manually overridden; test
   coverage is in `src/ui/trace/trace-options.test.ts:108-119`.

   Verdict: correct. Preserve this behavior.

## Findings

### TWA-1 - Trace Image still exposes image-adjustment controls

Severity: P1

Confidence: High

Module: `src/ui/trace/AdjustmentControls.tsx`,
`src/ui/trace/ImportImageDialog.tsx`, `src/ui/trace/trace-options.ts`

Trigger path:

1. Import a raster image.
2. Select it.
3. Open Trace Image.
4. Use Brightness, Contrast, Gamma, or Invert in the Trace dialog.

Failure mode:

Trace Image still contains image-adjustment controls:
`src/ui/trace/AdjustmentControls.tsx:30-70`. The dialog merges those values
into trace options at `src/ui/trace/ImportImageDialog.tsx:115-120` and
`src/ui/trace/trace-options.ts:56-65`.

LightBurn separates this workflow. Trace Image owns vector trace controls.
Adjust Image owns brightness, contrast, gamma, image presets, and layer image
settings. LaserForge already has an `AdjustImageDialog` that models that
separate surface: `src/ui/raster/AdjustImageDialog.tsx:24-35` and
`src/ui/raster/AdjustImageDialog.tsx:56-70`.

Consequence:

The operator can still tune image engraving concepts while inside a vector
trace workflow. That is less dangerous than the removed dither dropdown, but it
continues the same workflow confusion that created the old "photo trace /
bitmap trace" failures. It also makes Trace Image look closer to an image
engraving editor than LightBurn's vector trace dialog.

Concrete fix:

Remove `AdjustmentControls` from `ImportImageDialog` in a small TDD slice, now
that `AdjustImageDialog` exists. Keep trace-only controls visible:
Cutoff, Threshold, Ignore Less Than, Smoothness, and Optimize. If a temporary
"pre-threshold cleanup" escape hatch is still needed, gate it behind a clearly
named advanced section after the LightBurn controls are complete, not as the
default Trace Image workflow.

Required tests:

- Render `ImportImageDialog` / controls and assert Trace Image contains Trace
  settings but not `Image adjustments`, `Brightness`, `Contrast`, `Gamma`, or
  `Invert`.
- Keep `AdjustImageDialog` tests proving those fields still exist in the
  Adjust Image workflow.

### TWA-2 - Hidden trace dither API remains exported and executable

Severity: P2

Confidence: High

Module: `src/core/trace/trace-image.ts`, `src/core/trace/index.ts`,
`src/core/trace/dither-trace.ts`

Trigger path:

A future internal caller constructs `TraceOptions` with `ditherMode` or imports
`DITHER_MODES` from `core/trace`.

Failure mode:

The UI no longer exposes dither, but the core trace type and preprocessing path
still support it:

- `src/core/trace/trace-image.ts:151-159` documents `ditherMode`.
- `src/core/trace/trace-image.ts:285-301` executes dither before threshold.
- `src/core/trace/index.ts:38-41` exports `DITHER_MODES` and `ditherForTrace`.

Consequence:

The exact old behavior, photo-like halftone vector tracing, can be reintroduced
without touching the trace UI code. That is not a live user bug today, but it is
a regression trap.

Concrete fix:

In the next cleanup slice, either:

1. Remove `ditherMode` from `TraceOptions`, stop exporting trace dither from
   `core/trace/index.ts`, and move useful kernels to `core/raster` / Image
   Mode; or
2. Mark it explicitly internal/deprecated and add tests that no surfaced
   `TRACE_PRESETS` and no Trace UI path can set it.

Preferred fix: option 1, because LightBurn puts dither under Image Mode.

Required tests:

- Type/behavior test: all surfaced presets produce `ditherMode === undefined`.
- UI test: Trace Image cannot set `ditherMode`.
- Raster tests: existing image dither modes remain covered under raster, not
  trace.

### TWA-3 - Trace Transparency is not implemented despite partial settings type

Severity: P2

Confidence: High

Module: `src/core/trace/potrace-params.ts`, `src/ui/trace/image-loader.ts`,
`src/ui/trace/TraceSettingsControls.tsx`

Trigger path:

Import a transparent PNG and try to trace its alpha boundary.

Failure mode:

LightBurn has Trace Transparency. LaserForge does not expose it in
`TraceSettingsControls.tsx`, and the image loader composites transparency onto
opaque white before trace: `src/ui/trace/image-loader.ts:32-39` and
`src/ui/trace/image-loader.ts:62-65`.

There is a partial type in `src/core/trace/potrace-params.ts:12-20`, with a
default at `src/core/trace/potrace-params.ts:30-38`, but no UI path and no alpha
mask trace path.

Consequence:

Transparent-background images trace correctly for normal brightness trace, but
LaserForge cannot honestly claim LightBurn-style Trace Transparency. If a user
needs the alpha edge, the data has already been flattened to white before trace.

Concrete fix:

Add a separate trace transparency path:

- UI checkbox in Trace settings.
- Loader option that preserves alpha instead of compositing white.
- Alpha-mask threshold path in core trace.
- Tests with a transparent PNG-like fixture where RGB is irrelevant and alpha
  drives the trace.

### TWA-4 - Sketch Trace is not implemented

Severity: P2

Confidence: High

Module: `src/core/trace/potrace-params.ts`, `src/ui/trace/TraceSettingsControls.tsx`

Trigger path:

Trace handwriting, sketches, or documents with uneven lighting where global
thresholding gives poor results.

Failure mode:

LightBurn documents Sketch Trace as a local-contrast / edge-style trace mode.
LaserForge has no UI switch and no implementation. The only live references
are unused settings defaults in `src/core/trace/potrace-params.ts:18-20` and
`src/core/trace/potrace-params.ts:36-38`.

Consequence:

Centerline tracing is available, but it is not the same feature. Centerline
skeletonizes an already-binarized dark mask; Sketch Trace should detect local
contrast and edges in uneven documents.

Concrete fix:

Do not rename Centerline to Sketch Trace. Add a separate sketch algorithm path
after brightness-band trace is stable. Use handwriting/document fixtures and
perceptual comparison before claiming parity.

### TWA-5 - Missing trace preview controls: Fade Image, Show Points, Boundary

Severity: P2

Confidence: High

Module: `src/ui/trace/TracePreview.tsx`, `src/ui/trace/use-trace-preview.ts`,
`src/ui/trace/ImportImageDialog.tsx`

Trigger path:

Open Trace Image and attempt to inspect vectors against the source, show nodes,
or crop the trace region.

Failure mode:

LightBurn Trace Image includes Fade Image, Show Points, and Boundary / Clear
Boundary. LaserForge's `TracePreview` renders only the traced SVG result:
`src/ui/trace/TracePreview.tsx:37-47`; no source overlay, no node overlay, and
no crop boundary controls exist in the trace UI.

Consequence:

The user cannot isolate only part of a large imported image or visually debug
node density before committing a trace. This is a workflow parity gap, not a
safety bug.

Concrete fix:

Implement in this order:

1. Fade Image: preview-only source overlay opacity.
2. Show Points: vector node overlay once path points are available in preview.
3. Boundary / Clear Boundary: crop trace input and preserve coordinate
   registration. Do this last because it changes source-pixel to scene-mm math.

### TWA-6 - Delete Image After Trace is missing

Severity: P3

Confidence: High

Module: `src/ui/trace/ImportImageDialog.tsx`, `src/ui/state/scene-mutations.ts`

Trigger path:

Trace an imported image and expect LightBurn's optional delete-source behavior.

Failure mode:

LaserForge keeps the source image by default, which matches LightBurn's default.
However, LightBurn also exposes `Delete Image After trace`; LaserForge has no
toggle in the trace dialog.

Consequence:

No broken default behavior. This is only a missing convenience/parity option.

Concrete fix:

Add a checkbox after the trace result is reliable. Keep default off. If enabled,
commit the traced vector and remove the source raster in a single undoable scene
mutation.

### TWA-7 - Stale trace comments still reference removed dither UI

Severity: P3

Confidence: High

Module: `src/ui/trace/ImportImageDialog.tsx`, `src/core/trace/index.ts`,
`src/core/trace/trace-image.ts`

Trigger path:

Future developer audits or refactors follow comments instead of current UI.

Failure mode:

Production comments still describe dither as part of the Trace dialog or future
trace panel:

- `src/ui/trace/ImportImageDialog.tsx:12-14` says the user tweaks
  brightness/contrast/gamma/invert plus dither.
- `src/core/trace/index.ts:38-41` says the dither catalogue is for the import
  dialog dropdown.
- `src/core/trace/trace-image.ts:151-159` still describes photo/shaded dither
  trace behavior.

Consequence:

This is not a runtime defect, but it weakens the codebase's safety rail. The
next person can accidentally reintroduce the wrong workflow because the comments
still tell the old story.

Concrete fix:

Patch comments in the same small cleanup as TWA-2, or as a tiny docs-only code
comment cleanup if TWA-2 is deferred.

## Recommended Fix Order

1. TWA-7 tiny comment cleanup, if we want zero-risk housekeeping first.
2. TWA-2 remove or quarantine trace dither API/export so the old workflow cannot
   quietly come back.
3. TWA-1 remove remaining image-adjustment controls from Trace Image, now that
   Adjust Image exists.
4. TWA-5 add Fade Image, then Show Points, then Boundary.
5. TWA-3 add Trace Transparency.
6. TWA-4 add Sketch Trace.
7. TWA-6 add Delete Image After Trace.

## Audit Verdict

Trace Image is much cleaner than the old broken state. The surfaced presets are
now vector-only, Photo/Detailed are removed, manual Cutoff/Threshold works, and
the dither dropdown is gone.

The next correctness risk is not that "Trace is broken"; it is that old
photo/raster concepts still exist too close to the Trace path:

- image adjustment controls remain in the Trace dialog;
- core trace still exposes executable dither support;
- comments still describe the removed dither workflow.

Following the repo's Karpathy rule, the next implementation should be a small
slice that removes one of those remaining wrong truths, proves it with a
failing test first, and leaves raster/photo engraving under Adjust Image /
Image Mode.
