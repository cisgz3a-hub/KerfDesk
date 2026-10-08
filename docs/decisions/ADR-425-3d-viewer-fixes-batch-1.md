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
   known flat laser engraving at one power opens on Move kind (2026-10-08 refinement). Every CNC
   program and every multi-depth program keeps the depth lens. The operator's own choice always wins
   for the rest of the session. At one cutting depth, Depth / pass uses the cut colour and names that
   depth rather than drawing a zero-span ramp.
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
      A thickness-only request keeps the latest requested mesh, including one queued during
      initialization or still being built. It never restores the last committed mesh over a newer
      request; superseded content is disposed without a presentation acknowledgement.
   - A transferred canvas cannot be transferred twice. So the dialog shell gives a fresh canvas
     only after a renderer failure, which lets the next surface start over.
   - A newer input waits instead of cancelling the running job (`createCoalescedJob`). Playback
     moves the scrubber faster than a slow machine prepares a grid, and each step used to cancel
     the running grid and restart the worker, so no grid, and no surface, ever arrived. Now the
     running grid finishes, is shown, and then only the newest step runs. The surface hook does
     the same with grids. A new toolpath, machine or device, or closing the preview, still cancels.
   - In the shared preview worker a grid and a surface no longer cancel each other. The other kind
     waits for the running one, and only the newest waiting request is kept. A request of the
     same kind still replaces the running one.
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

### Dense planar engraving refinement (2026-10-08)

Dense laser engraving can contain hundreds of thousands of short dark moves. Translucent
travel overlapped into opaque red bands, while fixed-width cutting strokes merged adjacent rows.
Known laser programs now start with Travel hidden; the operator can show it and the choice survives
refreshes. CNC and unknown-file travel defaults stay visible. Flat XY paths use one-pixel cutting
strokes. Flat classification depends on finite coordinates and Z span, including horizontal,
vertical and stationary paths with zero XY bounding area (2026-10-09 refinement). These paths use
the same stroke ordering; zero area leaves the ordinary travel opacity intact rather than
dividing by zero. Travel opacity scales with travel length per bounding area, the camera's millimetres per
pixel and the XY plane's projected angle, returning to its normal opacity as zoom separates the moves.
Flat toolpath strokes share one transparent draw queue without writing depth against each other:
faint future paths, travel, completed cuts, then the active playback casing and core. Their screen-space
widths and depth slopes therefore cannot hide an active retrace or crossing, even at grazing angles.
All still depth-test against scene geometry, with a small work-plane bias. Nonplanar paths retain
their existing depth writes and occlusion. Foreground aids remain above planar strokes: hover and
measurement highlights, Studio origin arrows and dot, then the red live-position marker. These
opaque-colour overlays use the same ordered queue without blending or depth writes; the simulated
head and direction arrows retain physical depth testing. Every segment
and its source mapping remains available to playback and picking. Geometry, emitted output and controller
behaviour are unchanged. Both Classic and Studio apply the same visibility rule.

### Cumulative playback precision refinement (2026-10-09)

The Inspector's cumulative segment-end clock uses binary64 storage, matching the planner's
summed motion time. Binary32 timestamps round neighbouring short moves to the same time after
long raster passes: a ten-hour, 200 by 180 mm engraving followed by 0.05 mm moves can point at
the preceding or following source move, and 100% can stop short of the final endpoint. Keep the
full cumulative precision through worker transfer, playback, stepping and hover readouts.
Stepping searches for the next strictly later boundary or the previous strictly earlier one;
it skips zero-duration moves without a fixed tolerance that can erase a positive interval.
Per-move duration storage, total estimated time, the execution timeline and emitted G-code are
unchanged. The cumulative array adds four bytes per move; it still transfers without copying.

### Consequences

- Job Review and the Inspector now give the same motion time for the same program on the same
  device. The Inspector still leaves out serial delivery, which Job Review adds for streamed jobs.
- A program opened from disk is timed for whichever device is current. The Timed for row says which
  one, so a program meant for another machine is not silently timed as if it were for this one.
- Cut 3D keeps one canvas and one worker for as long as it is open. During playback only the content
  is rebuilt; the lights and the camera stay.
- The 2D depth shading is drawn from the full grid, not the display copy. While the next step's
  grid is prepared it keeps the last one, where it used to go blank between steps.
- On a slow machine playback shows the cut a step or more behind the scrubber, and catches up when
  playback stops. Before, it showed nothing until playback stopped.
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
    CNC and unknown constant-power programs. Known constant-power laser engraving uses move kind.
  - `analyzeGcodeModel` with a timing context equals `buildProgramTime` with the device's limits and
    scales, and names the device. The readouts show the Timed for row.
  - The session sends one `surface` request with transferred buffers, re-sends only the thickness for
    a mesh it already sent, and rejects a surface id it never sent.
  - The dialog shell keeps its canvas across new scenes and replaces it only after a failure.
  - `useCncRemovalGridState` reports pending, and then settled after a worker failure.
    `useCncCut3DSurface` keeps the last mesh with `updating: true`.
  - While the scrubber moves, the grid and surface hooks let the running job finish without
    aborting it, then prepare only the newest input. The worker client queues a surface behind a
    running grid on the same worker, and keeps only the newest queued request.
  - Downsampling keeps a 4 mm tab that deepest-only pooling erased. It keeps a one-cell groove in
    stock and keeps slopes at their deepest.
  - `screenshotSize` fits a 1900 x 1000 view at 4x on a 2x screen to 4096 x 2155.
- Worker/renderer regression: deferred initialization and deferred surface builds followed by a
  thickness-only update keep the replacement mesh in the rendered scene, and stale/disposed builds
  are released without presentation acknowledgement.
- Browser (`e2e/cut3d-surface-swap.e2e.ts`): after Cut 3D is ready, two controlled scrub changes
  each produce a later surface revision while the original canvas stays connected and only one
  render worker is ever created.
- Playback on a slow machine: the original playback form of that check, run with the browser CPU
  slowed six times, failed before the coalescing change (Cut 3D took 54 s to open and no surface
  swapped in while playback ran) and passes with it (Cut 3D opens in about 7 s and swaps).
  The existing Cut 3D suites (`cnc-3d-viewer-ab`, `depth-map-relief-worker`) still pass. A manual
  check with an orbited camera showed the same view before and after a new surface.

- Dense engraving browser regression (`e2e/gcode-viewer-density.e2e.ts`): the production worker
  parses 368,125 moves; the drawing stays readable with Travel shown in Classic, Studio and an angled
  Iso view. A coplanar return move preserves at least 98% of the cutting stroke's blue pixels. Session tests
  retain an explicit Travel choice across model refreshes and keep CNC/unknown defaults visible.
