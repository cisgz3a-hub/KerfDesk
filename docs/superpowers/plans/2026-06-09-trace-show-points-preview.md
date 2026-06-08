# Trace Show Points Preview Plan

## Research

- LightBurn Trace Image includes `Show Points` as a preview control. It toggles visibility of vector nodes in the trace preview; it is not an image-processing setting and does not change the trace output.
- LaserForge already receives `ColoredPath[]` from `traceImageWithFallback`, then immediately stringifies those paths to SVG for preview. The node data exists in the preview pipeline but is currently discarded.
- Karpathy rule for this slice: preserve output and commit behavior. Add preview state needed for node display, then render an overlay from that state. Do not change core tracing, scene commit, or G-code.

Primary reference:

- https://docs.lightburnsoftware.com/latest/Reference/TraceImage/

## Current Code Audit

- `src/ui/trace/use-trace-preview.ts` ready state stores `svg`, `width`, and `height`, but not `paths`.
- `src/ui/trace/TracePreview.tsx` can render a new overlay because it now has a source/trace stack after the Fade Image slice.
- `src/ui/trace/ImportImageDialog.tsx` should not change for this slice.

## Implementation

1. Extend ready `TracePreviewState` with `paths: ReadonlyArray<ColoredPath>`.
2. Set `paths` in `runTrace` from the exact `traceImageWithFallback` result used for the preview SVG.
3. Add a `Show Points` toggle in `TracePreview` when preview state is ready.
4. Render an SVG overlay with one marker per traced polyline point, sharing the same viewBox and `preserveAspectRatio` as the trace SVG.
5. Keep markers preview-only: no trace options, no commit args, no scene mutation, no output files.

## TDD

1. Add a failing `runTrace` test proving ready state carries the traced paths.
2. Add a failing `TracePreview` test proving `Show Points` toggles node markers on without removing the traced SVG.

## Verification

Focused:

```powershell
pnpm test --run src/ui/trace/TracePreview.test.tsx src/ui/trace/use-trace-preview.test.ts src/ui/trace/ImportImageDialog.test.ts src/ui/trace/trace-pipeline.integration.test.ts
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

- Confirm only preview/hook/test/docs files changed.
- Confirm `ImportImageDialog.tsx`, core trace algorithms, scene commit, and output are unchanged.
- Confirm Show Points is off by default and only renders after a ready preview.
- Confirm remaining LightBurn trace gaps are still honest future work: Boundary, Trace Transparency, Sketch Trace, and Delete Image After Trace.
