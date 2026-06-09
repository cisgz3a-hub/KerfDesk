# Sketch Trace Plan

## Research

- LightBurn documents `Sketch Trace` for photographs of unevenly lit pages, handwriting, sketches, and documents.
- The documented behavior is local contrast based: LightBurn looks for edges based on local differences in contrast rather than global brightness/darkness.
- This means LaserForge cannot honestly implement Sketch Trace as another global threshold preset.

Source:
- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/

## Current Code Audit

- `preprocessForTrace` supports global Cutoff/Threshold, Otsu threshold, median filter, despeckle, and Trace Transparency.
- Otsu is still a global histogram threshold. It can help with a clean bimodal image, but it is not local contrast and does not solve uneven page lighting.
- There is no `sketchTrace` field on `TraceOptions` or in the Trace settings UI.

## Implementation

1. Add `sketchTrace?: boolean` to `TraceOptions` and `LightBurnTraceSettingOverrides`.
2. Add a pure-core adaptive/local-contrast preprocessing path:
   - Convert RGB to luma.
   - Use an integral image to compute local mean cheaply.
   - Mark pixels as ink when they are darker than the local mean by a fixed contrast bias.
   - Return a monochrome `RawImageData`.
3. Route `preprocessForTrace`:
   - `traceTransparency` wins first because alpha tracing is explicitly alpha-based.
   - `sketchTrace` wins over global Cutoff/Threshold because it is local-contrast based.
   - Preserve `Ignore Less Than` despeckle after sketch preprocessing.
4. Add a `Sketch Trace` checkbox to `TraceSettingsControls`.

## TDD

1. Add a core test showing Sketch Trace ignores a globally dark/shadowed background and keeps only the locally darker stroke.
2. Add trace-options test proving `sketchTrace` is merged into `TraceOptions`.
3. Add dialog workflow test proving `Sketch Trace` appears in Trace Image without reintroducing image-adjustment controls.

## Verification

```powershell
pnpm test --run src/core/trace/trace-image.test.ts src/core/trace/trace-image-sketch.test.ts src/ui/trace/trace-options.test.ts src/ui/trace/ImportImageDialog.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Do not call this "Sketch Trace" unless the code uses local contrast.
- Avoid O(width * height * radius^2) preprocessing on large images.
- Trace Transparency and Sketch Trace must be mutually sensible: alpha mode wins if both are enabled.
- Preview and commit already share `TraceOptions`, so the new option must travel through that same path.
