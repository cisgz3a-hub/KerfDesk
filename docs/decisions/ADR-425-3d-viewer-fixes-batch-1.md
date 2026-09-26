## ADR-425 - 3D viewers tell the truth about colour, time and the cut (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

The first of five batches from the 2026-09-26 audit of the three.js viewers (G-code Inspector,
Cut 3D and the relief views). This batch fixes what the viewers get wrong today. It does not change
their look: the pale-line "Classic" look stays the default, and the new look arrives later as a
second, switchable "Studio" view.

### Context

The audit found six places where a viewer said something untrue or lost the operator's work:

1. **Legend colours.** `LineMaterial` reads vertex colours as linear and encodes them to sRGB on
   output. The theme and lens colours are sRGB values handed over as they are, so every fat line
   renders lighter than its legend swatch: the cut blue `#4FA3FF` draws as `#97D1FF`. The thin
   traversal line uses a colour-managed hex and draws exactly. The owner likes the lighter look, so
   the lines stay as they are and the legend changes to match them.
2. **Inspector time.** `analyzeGcodeModel` planned every program against fixed stock GRBL limits
   (500 mm/s², 0.01 mm junction deviation, 6000 mm/min). Job Review times the same program with the
   device's `accelMmPerSec2`, `junctionDeviationMm`, `maxFeed` and cut/travel calibration, so the
   two disagreed. The audit's 12,000 mm/min laser raster read 7m 59s in the Inspector and 3m 15s in
   Job Review. Playback runs on the same clock, so it was off by the same factor.
3. **Default lens.** Every program opened on the depth lens. A laser raster is one depth, so it
   opened as a flat square with no information.
4. **Cut 3D lost the camera.** While Cut 3D was open, each new removal grid (for example every
   playback step) set the grid to null first. The dock unmounted the whole dialog, and the next grid
   mounted a new canvas, a new render worker and the opening camera. Watching a job carve in 3D
   meant the view jumped back every step.
5. **Tabs vanished.** The Cut 3D display grid keeps the deepest sample of each block. A tab shorter
   than about two display cells (about 3.4 mm cells on a 1220 mm sheet) was replaced by the groove
   floor around it.
6. **Smaller gaps.** The source gutter was a fixed 44 px, so 7-digit line numbers ran into the code.
   PNG capture multiplies the view size by the scale and then by the device pixel ratio, so a 4x
   capture on a high-DPI screen asked for a buffer the GPU refuses and came back blank or cropped.
   A V-bit or engraver with no valid tip angle was drawn as a 60° cone without saying so.

### Decision

1. **The legend shows what the lines render.** `renderedLineCss` and `renderedLineRampStops`
   (`ui/viewer3d/segment-buckets.ts`) apply the same linear-to-sRGB encode as the renderer. Cut,
   plunge, retract, toolpath and planner swatches use them. A ramp legend is drawn through seven
   encoded stops, because a two-stop CSS gradient between the encoded ends is not the colour the
   lines blend through. Traversal keeps its exact hex. The depth legend's note now says "pale blue to
   pale red".
2. **The Inspector times a program for a named device.** `GcodeInspectionContext` gains an optional
   `timing` (limits, the two calibration scales, and the device name). `projectInspectionContext`,
   the live-run context and the canvas G-code view fill it from the device the program was compiled
   for. An opened file has no machine; `withDeviceTiming` times it for the current device, as Job
   Review would, and its machine kind stays uninferred. `analyzeGcodeModel(model, context)` plans
   with those values and returns `timedFor`. The Program readouts gain a **Timed for** row naming the
   device, or "Stock GRBL limits" when there is none. Serial delivery is still not modelled, so the
   row keeps the label "Est. time".
3. **The program picks the first lens.** `defaultLensFor(model, machineKind)` opens a laser program
   that is flat (less than 0.001 mm of depth span) and varies its power on the power lens. Every
   other program, and every CNC program, keeps the depth lens. The operator's own choice always wins
   for the rest of the session.
4. **Cut 3D swaps the surface in place.**
   - `useCncRemovalGridState` reports whether a newer grid is still being prepared. A failed or
     unavailable grid is stored as settled, not pending.
   - While a grid is pending, the dock keeps the last grid, so the open dialog is never unmounted.
     `useCncCut3DSurface` keeps the last mesh while the next one is prepared and marks it
     `updating`. The dialog then says "Updating the 3D surface…" and marks the canvas busy.
   - The runtime reuses the live session for the same canvas. A new mesh goes to the render worker
     as a `surface` request, with its buffers transferred. A mesh that was already sent is not sent
     again, since its buffers are gone; only the new stock thickness goes.
   - The worker rebuilds only the content. With the same stock size it keeps the scene, the lights
     and the camera. With a new stock size it re-lights a fresh scene and re-frames the camera.
     Surfaces are latest-wins, and the worker reports each one as a `surface` presentation that the
     session checks against the ids it sent.
   - A transferred canvas cannot be transferred twice. So the dialog shell gives a fresh canvas
     only after a renderer failure, which lets the next surface start over.
5. **Display pooling keeps material left inside a cut.** A display block that lies wholly below the
   stock top and is two flat levels (at least 90% of its samples within 0.01 mm of its highest or
   its deepest value) shows the level most of the block has. A tie goes to the deeper level. Every
   other block keeps the deepest sample. So thin grooves and V-carve strokes in uncut stock still
   always show, and sloped relief blocks, which are not two-level, are unchanged. Islands that reach
   the stock top inside a pocket are not covered by this rule. They wait for the full-resolution
   carved stock in batch 5.
6. **Smaller fixes.**
   - The source gutter is sized to the program's line count, at least 4 digits wide.
   - PNG capture fits the longest side of the drawing buffer inside the smaller of the GPU's
     `maxTextureSize` and 8192 px, divided by the pixel ratio, and keeps the aspect ratio.
   - Preview and Cut 3D name any V-bit or engraver the cut shading draws at an assumed 60° angle.

### Consequences

- Job Review and the Inspector now give the same motion time for the same program on the same
  device. The Inspector still leaves out serial delivery, which Job Review adds for streamed jobs.
- A program opened from disk is timed for whichever device is current. The Timed for row says which
  one, so a program meant for another machine is not silently timed as if it were for this one.
- Cut 3D keeps one canvas and one worker for as long as it is open. During playback only the content
  is rebuilt; the lights and the camera stay.
- The 2D depth shading is unchanged. It is drawn from the full grid, not the display copy.
- The axis triad still marks the stock's min-XY corner. Placing it at the work origin needs the
  preview's scene frame carried into the 3D stage. That belongs with the shared engine in batch 2,
  and this batch does not attempt it.
- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. The PNG size fit
  replaces a capture that failed with the largest one the GPU can render. The tip-angle line and the
  Timed for row are disclosures only; CAM and G-code are unchanged.

### Verification

- Unit tests:
  - `renderedLineCss(rgbTriple(0x4fa3ff))` is `rgb(151, 209, 255)`, and the legend swatches and
    ramp stops use the rendered colours.
  - `defaultLensFor` picks power for a flat laser raster, and depth for multi-depth programs,
    constant-power programs and CNC.
  - `analyzeGcodeModel` with a timing context equals `buildProgramTime` with the device's limits and
    scales, and names the device. The readouts show the Timed for row.
  - The session sends one `surface` request with transferred buffers, re-sends only the thickness for
    a mesh it already sent, and rejects a surface id it never sent.
  - The dialog shell keeps its canvas across new scenes and replaces it only after a failure.
  - `useCncRemovalGridState` reports pending, and then settled after a worker failure.
    `useCncCut3DSurface` keeps the last mesh with `updating: true`.
  - Downsampling keeps a 4 mm tab that deepest-only pooling erased. It keeps a one-cell groove in
    stock and keeps slopes at their deepest.
  - `screenshotSize` fits a 1900 x 1000 view at 4x on a 2x screen to 4096 x 2155.
- Browser (`e2e/cut3d-surface-swap.e2e.ts`): during real preview playback, Cut 3D receives a new
  surface while its original canvas stays connected and only one render worker is ever created.
  The existing Cut 3D suites (`cnc-3d-viewer-ab`, `depth-map-relief-worker`) still pass. A manual
  check with an orbited camera showed the same view before and after a new surface.
