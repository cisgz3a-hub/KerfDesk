# Lane 5A - Preview Traversal Toggle and Distance Stats

Date: 2026-06-15
Repo: LaserForge-2.0
Status: implementation slice

## Research Baseline

Official LightBurn documentation says Preview is an accurate representation of
what will be sent to the laser, with cut moves and traversal moves shown
separately. It also documents job statistics for cut distance, rapid moves, and
total estimated time, and it states that Preview settings affect only the
Preview window, not laser output.

Sources:

- <https://docs.lightburnsoftware.com/2.1/Reference/Preview/>
- <https://docs.lightburnsoftware.com/2.1/GetStarted/PreviewBeginner/>

## Slice Boundary

Build the low-risk first preview parity slice:

1. Add a Show traversal moves toggle for preview mode.
2. Add preview distance statistics for laser-on cut distance, laser-off travel
   distance, and total path distance.
3. Keep Save G-code, Frame, Start Job, preflight, serial, and emitted G-code
   unchanged.

Deferred:

- Start Here recovery.
- Preview playback.
- Save Preview Image.
- Shade According to Power.
- Raster-row synthetic preview steps.
- Time-per-cut and time-per-rapid breakdowns.

## Architecture

- Use the existing `ToolpathStep.kind` split between `cut` and `travel`.
- Add a pure `summarizeToolpathDistances` helper in the core job layer.
- Add an ephemeral UI toggle in `ui-store`; it must never serialize into `.lf2`
  project data.
- Pass the toggle into `drawPreview`; hiding travel only changes rendering, not
  the underlying sliced toolpath or head position.
- Render a compact preview panel near the scrubber with distances in mm.

## Tests

1. `summarizeToolpathDistances` separates cut and travel lengths.
2. `drawPreview(..., { showTravel: false })` skips red dashed traversal drawing.
3. Default preview drawing still shows travel, preserving current behavior.
4. UI store defaults to showing traversal moves and can toggle the value.

## Audit Notes

This slice is machine-safe because it only changes preview rendering and
ephemeral UI state. It does not touch compiler, G-code emission, bounds checks,
serial writes, streaming, or hardware motion.
