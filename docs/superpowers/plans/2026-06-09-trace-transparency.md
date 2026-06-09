# Trace Transparency Plan

## Research

- LightBurn documents `Trace Transparency` as an option that traces an image from its alpha layer. The documented use case is tracing the outline of a shape with a transparent background.
- LightBurn's normal Trace Image controls still work from brightness values. Alpha tracing is a different input mask, not an image-adjustment preset.

Source:
- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/

## Current Code Audit

- `loadImageAsRawData` currently fills the canvas with white before drawing the source. That fixed transparent PNGs for normal brightness tracing, but it also turns every pixel fully opaque and destroys the alpha layer.
- `TraceOptions` does not expose `traceTransparency`, even though lower-level `LightBurnTraceSettings` already has the field.
- `TraceSettingsControls` exposes numeric LightBurn controls only: Cutoff, Threshold, Ignore Less Than, Smoothness, Optimize.
- Preview and commit already share the same trace path, so adding alpha-based preprocessing there affects both consistently.

## Implementation

1. Change image decode to preserve alpha:
   - Draw onto a transparent canvas.
   - Post-process RGB as if composited over white paper.
   - Keep the original alpha byte.
   - Normal tracing still sees transparent pixels as white; Trace Transparency can read alpha.
2. Add `traceTransparency?: boolean` to `TraceOptions`.
3. Add alpha-mask preprocessing:
   - If `traceTransparency` is true, convert `alpha > 0` pixels to black and `alpha === 0` pixels to white.
   - Keep alpha-mask mode independent from brightness cutoff/threshold.
   - Preserve existing despeckle behavior for `Ignore Less Than`.
4. Thread the UI option:
   - Add the field to `LightBurnTraceSettingOverrides`.
   - Merge it into `TraceOptions`.
   - Add a checkbox labelled `Trace Transparency` in `TraceSettingsControls`.

## TDD

1. Add a core trace test proving `preprocessForTrace({ traceTransparency: true })` uses alpha, not brightness.
2. Add an image-loader test for the RGB-over-white / alpha-preserved helper.
3. Add trace-options tests proving merge/reset behavior carries `traceTransparency`.
4. Add TraceSettingsControls / ImportImageDialog tests proving the checkbox is visible and changes options.

## Verification

```powershell
pnpm test --run src/core/trace/trace-image.test.ts src/ui/trace/image-loader.test.ts src/ui/trace/trace-options.test.ts src/ui/trace/ImportImageDialog.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Normal transparent PNG tracing must still treat transparent pixels as white, not black.
- `Trace Transparency` must not require re-importing the image to read alpha.
- Preview and commit must keep sharing the same `TraceOptions` and decoded image path.
- The UI must not reintroduce Photo/Detailed bitmap-style trace presets.
