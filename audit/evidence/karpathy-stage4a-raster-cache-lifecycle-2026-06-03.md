# Karpathy Stage 4A - Raster/Preview Cache Lifecycle

Finding: `KF-019`

Status: closure-proven.

## Root Cause

Raster drawing and raster preview rendering kept decoded images, tinted trace-source canvases, and preview canvases in module-level `Map`s with no scene-liveness pruning:

- `src/ui/workspace/draw-raster.ts`
  - `rasterImageCache`
  - `tintedTraceSourceCache`
- `src/ui/workspace/draw-raster-preview.ts`
  - `previewCanvasCache`

Repeated import/trace/delete workflows could leave large data URLs and canvases strongly referenced after the scene no longer contained the raster image.

## Red Proof

Added failing tests before implementation:

- `src/ui/workspace/draw-raster-cache.test.ts`
  - Draw a scene with a trace-source raster.
  - Draw an empty scene.
  - Draw the raster scene again.
  - Expected a new `Image` and tint canvas after the empty-scene prune.
  - Red result: expected 2 image instances, received 1.

- `src/ui/workspace/draw-raster-preview.test.ts`
  - Draw output preview for an image-mode raster.
  - Draw output preview for an empty project.
  - Draw the raster preview again.
  - Expected a new preview canvas after the empty-project prune.
  - Red result: expected 2 canvases, received 1.

Command:

```text
corepack pnpm test src/ui/workspace/draw-raster.test.ts src/ui/workspace/draw-raster-preview.test.ts
```

Red result:

```text
2 failed, 11 passed
```

## Fix

Implemented scene-liveness pruning:

- `src/ui/workspace/draw-raster.ts`
  - Added `pruneRasterImageCaches(liveDataUrls)`.
  - Clears deleted raster decode entries and their pending `onReady` callbacks.
  - Clears deleted trace-source tint canvases.

- `src/ui/workspace/draw-scene.ts`
  - Calls `pruneRasterImageCaches(...)` from the current scene's live raster `dataUrl`s before drawing.

- `src/ui/workspace/draw-raster-preview.ts`
  - Stores preview cache entries with their source `dataUrl`.
  - Calls `pruneRasterPreviewCache(...)` using output-eligible non-trace-source image-mode rasters before preview rendering.

## Verification

Focused green:

```text
corepack pnpm test src/ui/workspace/draw-raster.test.ts src/ui/workspace/draw-raster-cache.test.ts src/ui/workspace/draw-raster-preview.test.ts
```

Result:

```text
3 files, 13 tests passed
```

Workspace renderer suite:

```text
corepack pnpm test src/ui/workspace
```

Result:

```text
12 files, 46 tests passed
```

Gates:

```text
corepack pnpm run typecheck
corepack pnpm run lint
git diff --check
```

Results:

- Typecheck passed.
- Lint passed with the known boundaries legacy selector warning.
- `git diff --check` passed.

## Remaining Risk

This closes stale deleted-image cache retention. It does not cap memory for a scene that legitimately still contains many large live raster images. If that becomes a real workload, add a byte-aware live-image budget or explicit operator warning.
