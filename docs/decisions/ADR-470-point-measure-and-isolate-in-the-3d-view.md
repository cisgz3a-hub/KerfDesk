## ADR-470 - Point at, measure and isolate moves in the 3D view (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

The third of five batches from the 2026-09-26 audit of the three.js viewers (after ADR-425 and
ADR-426). The first two batches made the G-code Inspector's 3D view correct and pleasant to move
around. This batch makes it answer questions: what is this move, how far apart are these two
points, and what does this part of the job look like on its own.

### Context

1. **The view could not be asked about a move.** The 3D view drew every move but could not say
   which line of G-code a stroke came from. Finding the line behind a suspicious move meant
   scrubbing the timeline until the playhead reached it, or reading the source by eye.
2. **No way to look at part of a job.** A pocket's passes, a relief's roughing and finishing, or a
   tool's moves all drew on top of each other. The legend named each kind of move but could not
   switch one off, and there was no way to see one depth level or cut the view through the job.
3. **No way to measure.** Checking a stepover, a tab's length or the depth between two passes
   meant reading coordinates off the source and doing the sums by hand.

### Decision

1. **Pointing at a move** (`ui/viewer3d/scene-pick.ts`, `ui/viewer3d/pick-ids.ts`,
   `ui/gcode-inspector/use-move-pointer.ts`, `ui/gcode-inspector/InspectorMoveTip.tsx`).
   - A pick pass draws the thin copy of every move into a 13 x 13 pixel square around the pointer,
     each move in a colour that spells its segment index plus one, and reads the square back. The
     move drawn nearest the pointer is the one named. The pass shares the ghost lines' geometry
     (one extra 4-byte attribute per vertex), is built on the first hover, and costs one small
     draw per pointer update however long the program is. It honours depth, the travel toggle and
     both projections.
   - The point on the move nearest the pointer's ray gives the position and, with the planner's
     per-move times, the moment the tool reaches it.
   - Hovering outlines the move in cyan inside a dark casing, drawn over everything. Cyan is no
     move kind's or lens's colour, and the casing keeps it readable over Classic's pale lines and
     over Studio's warm ones. A card beside the pointer gives the line number, the kind of move
     and its G word, X Y Z at the pointer, the feed (or "rapid") and power in force, and when the
     tool gets there. The card flips to the pointer's other side near the view's edges.
   - Clicking a move (the entire press stays within 4 pixels; cancellation retires the press) selects its line in the source pane and
     moves the playhead to the clicked point. In live mode it selects the line only, because the
     playhead follows the machine there.
   - Hover pauses while a mouse button is held or the camera moves, since the pick would chase a
     moving view. A click still counts: pressing a button starts a zero-length camera drag.
   - Both looks and the canvas preview get it; the source pane and timeline already reach the
     same places from the keyboard, so the card is a pointer convenience and stays hidden from
     screen readers.

2. **Isolating part of the job** (`ui/viewer3d/scene-isolate.ts`, `ui/gcode-inspector/isolate.ts`,
   `ui/gcode-inspector/use-inspector-isolate.ts`, `ui/gcode-inspector/InspectorIsolateControl.tsx`).
   - **Legend filters.** Each entry of a listed legend (Move kind, Tool, Reached feed) is a switch
     for its moves. The Traversal entry is the existing traversal toggle, not a second switch for
     the same moves. Switched-off moves are left out of the drawn geometry (`setMoveFilter` rebuilds
     the buckets without them), so they cannot be pointed at either. Ramp lenses have nothing to
     switch. Filters belong to the lens they were set in, and a new lens or program shows all.
   - **Z range.** Two sliders keep the heights between a highest and a lowest Z. They stop at the
     job's bottom and top and at every cutting level, or step evenly when a finishing pass has more
     than 200 levels. A move lying exactly on a limit stays drawn.
   - **Section.** A vertical cut through X or Y at a slider position shows the job's profile, and
     "Show the other side" keeps the far half.
   - The Z range and section are clipping planes on every material that draws the toolpath: the
     solid and traversal lines, the playback ghosts, the direction arrows, the pick pass and the
     hover outline. Clipping runs per pixel, so dragging a slider redraws without touching
     geometry and a move crossing a limit is cut exactly where it crosses. The grid, the job box,
     the tool model and the markers are not clipped.

3. **Measuring** (`ui/viewer3d/scene-measure.ts`, `ui/gcode-inspector/use-measure.ts`).
   - A Measure switch beside the Travel toggle turns clicks on moves into measure points: the
     first click sets the start, the second the end, and a third starts over. Turning it off, or
     opening another program, clears the measurement.
   - A point snaps to the end of a move when the pointer is within 10 pixels of it on screen, so
     corners and pass ends measure exactly; elsewhere it is the point on the move nearest the
     pointer. The hover card shows the point a click would take and says when it snapped.
   - Between the clicks the line follows the pointer. The view draws a dot on each point and the
     line between them in the hover outline's cyan and casing, over everything, with the distance
     as a label at its middle. The readout panel gives the distance and its X, Y and Z parts.
   - The overlay is not clipped, so a measurement stays whole when the Z range or a section hides
     one of its ends. It works in both looks and both projections; its label layer is its own, so
     Classic shows it too.

### Consequences

- **Picking reads pixels back synchronously.** One 13 x 13 read per animation frame while the
  pointer moves over the view. That stalls the GPU queue briefly; the square is tiny and nothing
  is picked during a drag, so it does not show. Batch 4 (large files) revisits it if programs of
  millions of moves make the pick draw itself slow.
- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. Every addition
  reads the program; CAM and G-code are unchanged.

### Verification

- Unit tests:
  - `encodePickIds` paints both ends of each move with its index plus one and round-trips indices
    past 2^24; `nearestPickedSegment` names the move nearest the centre, finds one at the window's
    edge and names nothing over empty space.
  - `moveReadout` wording for a cut, a rapid and a program without power; `secondsAtPick`
    interpolates along the move and clamps; `measureReadout` gives the distance and signed parts
    and never shows "-0.00".
  - `nearestEnd` snaps within reach to the nearer end and ignores an end off screen; `useMeasure`
    takes a first and second point, follows the pointer between them, starts over on a third
    click, and clears on a new program, on Clear and when switched off.
  - `InspectorMoveTip`: one pick per frame at canvas coordinates, the outline follows the pick,
    nothing while a button is held or the view is not ready, a click locates while a drag does not,
    and a click still locates while the camera reports movement.
  - `isolatePlanes` keeps a Z range including its limits and the near or far side of a section;
    `zStops` lists levels or even steps; `moveFilterMask`; `lensEntries` sorts every move into the
    legend entry whose count includes it, for Move kind, Tool (one tool and two) and Reached feed.
  - `buildSegmentBuckets` leaves filtered moves out and keeps the rest mapped to their segments.
  - Inspector controls: the legend switches, the traversal entry, the section and the Z range
    reach the scene.
- Browser (`e2e/gcode-viewer-pick.e2e.ts`): hovering a real square job names a cut on its lines
  with its feed and time; clicking it moves the playhead to that line; moving off clears the card;
  in Studio's orthographic Top view the same pick reads X 0 or 80 and Z -1. On a three-pass
  pocket, a Z range of one pass leaves only that pass to point at, and switching Cut off in the
  legend leaves nothing there. Measuring across the square seen from above reads 80.00 mm in the
  readout and on the line's label, and switching Measure off clears it and clicks go to lines
  again. Screenshots of the hover, the section, the Z range and a measurement in both looks.
