# Image Scan Freeze Audit

Date: 2026-06-01
Repo: `C:\Users\Asus\LaserForge-2.0`
Scope: post-trace UI freezes after committing an image trace/scan.

## Research Inputs

- MDN Web Workers and transferable objects: large buffers should use
  transfer when ownership can move; otherwise structured clone can add
  copy cost.
- MDN OffscreenCanvas: worker-side rendering is available, but it is a
  larger rendering-architecture change than the first freeze fix needs.
- web.dev long-task guidance: avoid long main-thread tasks; split,
  yield, or move expensive work off-thread.
- React `useMemo` / `memo`: useful in drawing editors when expensive
  derived values have stable dependencies.

Source URLs are recorded in `RESEARCH_LOG.md`.

## Findings

### P1 - Visual sampling still walked every trace point

- **Files:** `src/ui/workspace/draw-vector-strokes.ts`,
  `src/ui/workspace/draw-scene.ts`
- **Trigger path:** import bitmap -> Trace Image -> commit a large
  `traced-image` -> pan/zoom/redraw workspace.
- **Failure mode:** the previous large-scene path drew only every Nth
  segment, but the sampling loop still iterated every source segment and
  read every point pair.
- **Consequence:** Canvas calls were reduced, but JavaScript still paid
  O(total trace points) on redraw. Large scans could freeze interaction.
- **Severity:** High for usability; no G-code safety impact.
- **Confidence:** High. Regression test observed 60,000 source-point
  reads for a 30,000-segment trace before the fix.
- **Fix:** add a bounded display-polyline cache and skip unsampled
  segments instead of merely suppressing their `lineTo` calls.

### P2 - Preview redraw rebuilt the full job/toolpath

- **Files:** `src/ui/workspace/draw-preview.ts`,
  `src/ui/workspace/Workspace.tsx`
- **Trigger path:** large trace -> Preview mode -> pan/zoom/scrub/redraw.
- **Failure mode:** `drawPreview` called `compileJob` and `buildToolpath`
  from inside the render function.
- **Consequence:** every preview redraw repeated full vector
  materialization.
- **Severity:** High for preview responsiveness.
- **Confidence:** High from direct code inspection.
- **Fix:** build the preview toolpath outside the draw loop and memoize it
  in `Workspace` while preview mode is active.

### P3 - Worker failure could silently move large trace work onto the main thread

- **File:** `src/ui/trace/use-trace-worker-client.ts`
- **Trigger path:** worker unavailable or failed -> large image trace.
- **Failure mode:** all failed worker calls fell back to inline tracing.
- **Consequence:** a large trace could run on the UI thread instead of
  surfacing a recoverable error.
- **Severity:** Medium. The normal browser build should use the worker;
  the fallback path is for failure contexts.
- **Confidence:** Medium-high from code inspection.
- **Fix:** keep inline fallback for bounded images only; large images now
  report that the trace worker is unavailable.

## Verification Added

- `src/ui/workspace/display-polylines.test.ts`
- `src/ui/workspace/draw-vector-strokes.test.ts`
- `src/ui/workspace/draw-preview.test.ts`
- `src/ui/trace/use-trace-worker-client.test.ts`

These tests check point-read budgets, cached display geometry, prebuilt
preview rendering, sampled preview cuts, and bounded inline trace fallback.

## Residual Risk

- This does not change the trace algorithm or simplify saved/G-code
  geometry.
- OffscreenCanvas was intentionally not adopted in this increment.
- Transferable typed-array path serialization may still be useful if
  profiling shows worker message transfer itself is the next bottleneck.
