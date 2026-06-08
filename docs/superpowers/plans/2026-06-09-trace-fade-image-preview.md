# Trace Fade Image Preview Plan

## Research

- LightBurn Trace Image is a vector conversion workflow. Its preview shows the source image with traced vectors over it, and `Fade Image` dims the source image to make the vectors easier to see.
- LightBurn Adjust Image owns brightness, contrast, gamma, presets, and layer/image processing. LaserForge already moved those controls out of Trace Image, so this slice must not re-add image adjustment behavior.
- Karpathy rule for this slice: fix the smallest observable workflow gap and preserve the output path. `Fade Image` is preview-only, so no emitted paths, scene objects, or G-code should change.

Primary references:

- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/
- https://docs.lightburnsoftware.com/latest/Reference/AdjustImage/

## Current Code Audit

- `src/ui/trace/ImportImageDialog.tsx` is 241 physical lines, so new preview state should not be added there.
- `src/ui/trace/TracePreview.tsx` currently renders only the traced SVG result. It does not show the source bitmap underneath, so there is nothing to fade.
- `src/ui/trace/trace-options.ts` already limits Trace Image to vector trace settings.
- Older audit finding TWA-1 is stale in the live tree: `AdjustmentControls.tsx` no longer exists.

## Implementation

1. Let `TracePreview` own the preview-only `Fade Image` toggle; the file is small enough for that state.
2. Let `TracePreview` render the source bitmap behind the traced SVG when a source data URL is provided.
3. Add a `Fade Image` toggle that switches only the source image opacity.
4. Keep traced SVG rendering and `useTracePreview` unchanged.
5. Keep `ImportImageDialog` orchestration-only by passing `seed.dataUrl` into `TracePreview`.

## TDD

1. Add a failing test for `TracePreview` proving it renders `Fade Image` and the source bitmap.
2. Add a failing test proving toggling `Fade Image` changes the source image opacity without changing the ready SVG.
3. Add/update `ImportImageDialog` workflow test proving Trace still contains vector controls and now includes `Fade Image`.

## Verification

Focused:

```powershell
pnpm test --run src/ui/trace/TracePreview.test.tsx src/ui/trace/ImportImageDialog.test.ts src/ui/trace/use-trace-preview.test.ts src/ui/trace/trace-pipeline.integration.test.ts
```

Gate:

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm test
pnpm build:web
git diff --check
```

## Audit Checkpoints

- Confirm no output, emitter, scene, or trace algorithm file changed.
- Confirm source bitmap opacity is preview-only.
- Confirm `ImportImageDialog.tsx` stays below hard limits and close to soft limits by delegating state.
- Confirm LightBurn parity improvement is honest: Fade Image is added, but Boundary, Show Points, Trace Transparency, Sketch Trace, and Delete Image After Trace remain future work.
