## ADR-485 - Big files in the 3D view (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

The fourth of five batches from the 2026-09-26 audit of the three.js viewers (after ADR-425,
ADR-426 and ADR-470). The first three batches made the G-code Inspector's 3D view correct,
pleasant to move around and able to answer questions. This batch keeps it usable on the programs
that stress it most: reliefs, raster engravings and 3D finishing passes with hundreds of thousands
to millions of moves.

### Context

1. **The page held more than it read.** The parse worker sent the page the whole render model and
   the planner's whole timing model. Several per-move arrays in them (route distance, move length,
   the planner's seconds, time scale, distance and three velocities) are used only to plan the
   program's timing, which the worker has already done by then. On a million-move program they
   were about 44 MB of the page's heap that nothing drew or read.
2. **The view copied every move three times.** The solid moves were copied out of the program into
   a bucket for the fat lines (24 bytes a move), with six floats of colour each (24 more), and the
   GPU held the fat lines' positions and colours, a second copy of the positions for the faint
   playback lines, and a 4-byte-a-vertex pick attribute on that copy. Worse, each lens change built
   a new colour buffer and left the old one on the GPU until the view closed: three.js frees a
   buffer only when its geometry is disposed, not when an attribute is replaced. On a 250,000-move
   program the GPU held 12 MB after opening, 20 MB after the first hover and 44 MB after four lens
   changes.

3. **A big file showed a sentence for seconds.** While the worker read a program the Inspector said
   "Building preview in worker…" and nothing else; on a million-move file that is several seconds
   with no picture. The worker's reader also grew its arrays by doubling and copied them once more
   at the end, so for a moment it held two to three times the moves it had read: 100 to 150 bytes
   a move, where the moves themselves are 50.
4. **Every move was drawn at every zoom.** A relief or raster fitted to the view puts many moves in
   each pixel, and the view drew all of them every frame: 400,000 moves are 3.2 million fat-line
   vertices a frame for a picture a few hundred thousand pixels big.
5. **A program the GPU could not draw left an empty view.** Without WebGL, after a lost graphics
   context, or when the GPU had not finished the first frame after 30 seconds, the view said "3D
   view unavailable: …" over an empty canvas. The readouts worked, but there was no picture of the
   toolpath at all.

### Decision

1. **The Inspector keeps only what it reads** (`ui/gcode-inspector/inspector-model.ts`).
   - The worker still parses and plans from the full models. What it hands the page is an
     `InspectorRenderModel` without the route and length arrays and an `InspectorProgramTime`
     without the planner's per-move working arrays. Those stay in the worker and are freed with
     it, so nothing is copied to drop them.
   - The time split (cutting, plunging, traversing, retracting) was the one reader of the
     planner's per-move seconds. The worker now sums them per move kind into `kindSeconds`, one
     number per kind, and the split reads those. Its figures are unchanged: the same seconds are
     added in the same order.
   - The Inspector's code is typed against the slim models, so a new reader of a dropped array
     fails to compile rather than reading `undefined` at run time. Core code (`core/gcode-view`,
     `core/gcode-time`) is unchanged and still returns the full models to its other callers.

2. **One GPU copy of the moves** (`ui/viewer3d/program-lines.ts`,
   `ui/viewer3d/line-shader-edits.ts`).
   - The solid moves' fat lines read the render model's own positions, in program order, without
     copying them. Instance i is move i. Rapids and moves a legend filter leaves out stay in the
     buffer with a shown flag off, and the vertex shader moves them past the far plane. The reveal
     is the draw count and the trail two move numbers, so neither needs the old bucket-to-move
     index.
   - Each move's colour is four 16-bit numbers (red, green, blue, shown) where six floats were. A
     lens rewrites them in place: nothing is allocated and no buffer is left behind. Sixteen bits
     keep Studio's linear colours as exact as the floats did (ADR-426).
   - The faint playback lines and the pick pass draw the same GPU buffers through a second
     geometry, as one-pixel fat lines, instead of a thin copy with its own buffer. The pick pass
     spells each move's identity from its instance number in the shader, so the 4-byte-a-vertex
     pick attribute is gone for the solid moves. Each edit to three's line shader has its own
     program cache key, so three never hands one edit's compiled program to another.
   - The lenses still colour the moves on the page and upload the result. The audit proposed
     colouring in the shader, but the lenses read feed, power, depth, tool and planner figures per
     move; putting those on the GPU would take more memory than the 8-byte colour they produce.
   - Rapids keep their own thin line, copied out of the program as before, so both looks draw them
     exactly as they did. They are a small share of the programs this batch is for.
   - Classic is unchanged: the whole path in the depth, feed and kind lenses matches main pixel for
     pixel. The faint playback lines are one-pixel fat lines instead of GL lines and differ from
     main only in their antialiasing.

3. **The moves appear while the worker reads them** (`ui/gcode-inspector/inspection-preview.ts`,
   `ui/viewer3d/preview-scene.ts`, `core/gcode-view/segment-builder.ts`).
   - About four times a second the worker sends the page the moves read since its last message,
     split into solid moves and rapids, in transferred buffers, with how far through the file it
     is. Checking the clock costs one call per 1,024 lines. Once the file is read it says it is
     timing the moves, then sends the finished program as before.
   - The Inspector and the canvas G-code view show those moves, growing, from the Iso view, with
     "N moves read · P% of the file" and a bar. A file read before the first message arrives never
     shows the picture, so small files look as they did.
   - The picture is a sketch: one-pixel lines in Classic's colours, no controls. Its cost stays in
     step with what is new. Each batch is drawn once over the picture already on the canvas, which
     keeps its frames. Only a reframe redraws the lot, and the frame leaves half the job again past
     a side the job has grown across, so a job read row by row reframes a few dozen times at most.
     Redrawing every move at every batch kept the main thread busy for 14 seconds on a 2.4 million
     move file in the test browser.
   - The reader fills fixed chunks (1,024 moves, doubling to 65,536) that are never regrown, so the
     picture's moves can be copied out of them and nothing read is copied again while reading. At
     the end each field is gathered into one exact array and its chunks let go before the next
     field, largest first. The most it holds is the moves plus their positions once more, 74 bytes
     a move, plus at most one part-filled chunk.

4. **A big program is drawn simplified when zoomed out** (`ui/viewer3d/move-detail.ts`,
   `ui/viewer3d/detail-lines.ts`, `ui/viewer3d/scene-detail.ts`).
   - For a program of 100,000 solid moves or more, the worker works out, after timing it, runs of
     consecutive solid moves that one line can stand for: moves that join end to end exactly, with
     the same kind, feed, power and reached feed, no tool change between them, and every join
     within a tolerance of the line from the run's first start to its last end. A run is at most
     64 moves. There are two tolerances, 1/2000 and 1/8000 of the job's diagonal. A level that
     saves less than a quarter of the lines is dropped, and so is a coarser level with nine
     tenths or more of the finer level's lines. Each level is two arrays of move numbers,
     transferred with the program.
   - The page builds one fat-line geometry per level from the program's positions, and copies each
     line's colours from its first and last moves' colours after every lens change, so a depth
     ramp still shades along the line. The runs depend only on the program, so the worker works
     them out; the lenses are worked out on the page, so the colours are copied there.
   - Before each frame the view works out how many millimetres a pixel spans at the part of the
     job nearest the camera, and draws the coarsest level whose tolerance is at most half of that,
     or every move once zoomed in past both. A line within half a pixel of every move it stands
     for lights the same pixels, up to antialiasing.
   - The drawn path is simplified only while it shows the whole program. During playback the done
     moves are drawn one by one and only the faint copy of the moves to come is simplified.
     Pointing at a move still searches every move (the pick pass draws them all), and a legend
     filter draws every move.
   - The view says when it is simplifying, in both looks, under the position readout: "Simplified
     at this zoom: N lines for M moves, within T mm. Zoom in to see every move."

5. **Where the 3D view cannot draw, the moves are shown from above**
   (`ui/gcode-inspector/top-view-image.ts`, `ui/gcode-inspector/InspectorTopView.tsx`).
   - In place of the empty canvas the Inspector, and the canvas G-code view that uses it, draws the
     program from above on a plain 2D canvas: each solid move walked a pixel at a time, rapids
     left out, the job fitted in the middle at the same scale both ways.
   - Where moves cross, a pixel shows the deepest one, the later one on a tie, so a pocket or a
     relief shows its last floor.
   - Each pixel takes its move's colour in the chosen lens, encoded as the 3D view's lines show on
     screen, so the legend reads the same. Which move each pixel shows is worked out once for the
     view's size; a lens change only repaints.
   - The sentence stays, at the bottom, and says what the picture is: "3D view unavailable: … Showing
     the moves from above; where moves cross, the deepest shows. The program parsed — readouts are
     live." The camera controls, which have nothing to move, are hidden.

### Consequences

- **More vertex work for the faint lines and the pick pass.** A fat line runs the vertex shader 8
  times a move where a thin line ran it twice. The pick pass draws once per pointer update and the
  faint lines only during playback. Rapids and filtered moves also still cost their vertex work
  before the shader drops them. Memory was the limit on big programs; later steps in this batch
  cut how many moves are drawn at all.
- **A legend filter still rebuilds the drawn toolpath** (ADR-470), now without copying positions.
- **The page briefly holds the picture's moves** (24 bytes a move, in batches) until the finished
  program replaces it, and a second WebGL context for the picture. Both go when the full view
  appears.
- **A zoomed-out big program is drawn from fewer, longer lines.** Colours are blended along each
  line from its first move's colour to its last, where each move had its own; runs break wherever
  the kind, feed, power, reached feed or tool changes, so only the depth lens is blended. Programs under 100,000 moves are drawn as before.
- **The GPU holds each level as well**: 24 bytes of positions and 16 of colour a line, about 1.2 MB
  for a 400,000-move relief whose moves take 12.8 MB.
- **The picture from above is a picture, not a view.** It cannot be turned, zoomed or pointed at,
  and playback moves only the readouts. It is worked out on the page when the view fails or
  changes size: about 0.1 seconds for a million moves.
- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. The view draws
  and times the same program the same way; CAM and G-code are unchanged.

### Verification

- Unit tests: the worker's result transfers 11 buffers and none of the dropped arrays reach the
  page; `inspectorProgramTime` keeps every figure the Inspector shows and its `kindSeconds` add
  up to the planner's motion seconds; the time split, readouts, sidebar and analysis tests read
  the slim time and give the same figures as before.
- Unit tests: `programColors` colours solid moves by kind and does not show rapids or filtered
  moves; `writeProgramColors` repaints shown moves in place, encoded; the fat lines' positions are
  the program's own buffer; the faint lines share the drawn lines' buffers and draw every move;
  a lens repaint keeps the colour array and bumps its version; the reveal and trail count moves in
  program order; the shader edits land after their anchors, leave other shaders alone and each
  have their own program key; `buildTravelBucket` copies out only the drawn rapids.
- Browser (`e2e/gcode-viewer-gpu-copies.e2e.ts`): on a 20,000-move program the bytes held in WebGL
  buffers are counted by wrapping `bufferData` and `deleteBuffer`. ADR-470's source-axis
  refinement (2026-10-09) derives fat axes from existing shared endpoints without another
  per-row buffer; native pairs retain24 bytes each, allocated once on first pick. This fixture's
  total first-hover increase, including native axes, stays below the original64KB limit.
  Four lens changes keep the post-pick byte total exactly. Playback stays within64KB of both
  opening and first pick, so it cannot copy the program buffers or allocate the axes again.
  Raw before/after byte counts are attached to the browser test. No console error is allowed.
  Before this decision the hover alone added640KB (32 bytes a move). The pick, keys,
  connected-script and large-worker specs pass unchanged.
- Page array memory after opening a generated serpentine program in the Inspector (Chrome, after a
  forced collection; `Runtime.getHeapUsage` backing storage):

  | Moves     | Main     | Decision 1 | Decision 2 |
  | --------- | -------- | ---------- | ---------- |
  | 250,000   | 47.7 MB  | 36.7 MB    | 25.7 MB    |
  | 1,000,000 | 180.5 MB | 136.5 MB   | 92.6 MB    |

  The Decision 2 figures were taken after a hover and four lens changes, which on main left
  2 MB more at 250,000 moves.
- GPU buffers on the same programs: at 250,000 moves main held 12 MB after opening, 20 MB after
  the first hover and 44 MB after four lens changes; now 8 MB throughout. At 1,000,000 moves, now
  32 MB throughout.
- Unit tests: the reader's chunks finish into exact arrays across chunk boundaries, with and
  without precise lengths, and copy any run of moves; the worker sends only new moves, at most
  every quarter second and only after 1,024 lines, then the rest with the whole file read, and
  says it is timing only after the last moves; a program's picture holds every solid move and
  rapid once; the worker client hands the picture over without settling the request; the dialog
  keeps its sentence until moves arrive, shows them with the count and share read, and gives way
  to the full view; the frame leaves room only past the side the job grew across and reframes a
  3,000-row job fewer than 25 times.
- Browser (`e2e/gcode-viewer-preview.e2e.ts`): opening a 300,000-move program on a CPU slowed six
  times shows the picture with its sentence and count, its lines light pixels on the canvas, the
  full view replaces it, it draws each move about once (fewer than four times the moves read) and
  nothing is logged as an error. The large-worker cancel spec, which looks for the sentence while
  the worker reads, passes unchanged.
- On a 2.4 million move program in the test browser (software WebGL) the picture keeps up with the
  worker, which sends a batch about every quarter second for 7 seconds; the page is busy for about
  2 seconds at most, at the largest reframes. Reading and timing a million moves takes 2.2 to 2.6
  seconds, against 2.3 seconds on main. The reader's peak of 74 bytes a move, against 100 to 150 on main, is worked out from the
  arrays it holds, not measured.
- Unit tests: a straight cut is drawn as one line per 64 moves and keeps one level when both
  agree; runs break at a change of power, feed, reached feed or kind, at a tool change, at a
  rapid and at a gap, and no rapid is drawn; a zigzag within the coarse tolerance only keeps the
  coarse level, and one within neither is left alone; programs under 100,000 moves get no levels;
  a level's lines run from each run's first start to its last end and share their buffers with
  the faint copy; the colours come from each run's first and last moves; the coarsest level within
  half a pixel is chosen; a pixel is measured at the nearest part of the job in both cameras; the
  drawn path is simplified only for the whole program; the worker transfers each level's arrays.
- Browser (`e2e/gcode-viewer-detail.e2e.ts`): on a 120,000-move relief fitted to the view the note
  gives 3,634 lines within 0.052 mm and no draw call on the view draws a quarter of the moves;
  pointing at a move still reads it out; zoomed in, the note goes and a redraw draws every move;
  played half way, the note goes; nothing is logged as an error.
- A 400,000-move relief keeps a coarse level of 10,466 lines and a fine one of 18,671; a photo
  raster keeps only the fine level, at about 1.8 moves a line. Working out both levels takes 64 ms
  per 400,000 moves in the worker. In the test browser (software WebGL) the relief's view was
  ready in 3.4 seconds, against 17.6 on main, and zooming in with 13 wheel steps drew 208,000 lines
  against 4.8 million. Its toolpath pixels differ from main's in 201 of 90,000 lit pixels fitted
  and 924 of 207,000 zoomed in.
- Unit tests: the picture from above draws cuts and not rapids, fitted in the middle with Y up;
  where moves cross it shows the deepest, the later one on a tie; it paints each pixel in its
  move's colour as the 3D view shows it, asking a run of pixels on one move for its colour once;
  rapids alone or no room draw nothing.
- Browser (`e2e/gcode-viewer-top-view.e2e.ts`): with every WebGL context refused, a pocket cleared
  1 mm deep with its lower half 2 mm deep shows its sentence and an image with thousands of lit
  pixels in the depth lens's two colours; switching to the move kind lens repaints the same pixels
  in other colours; the timeline still works; nothing throws.
- Working out the picture for a million moves at 1,260 by 780 pixels takes about 120 ms, and
  painting it 20 to 95 ms (Node, the test machine).
