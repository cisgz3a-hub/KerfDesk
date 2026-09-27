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

### Consequences

- **More vertex work for the faint lines and the pick pass.** A fat line runs the vertex shader 8
  times a move where a thin line ran it twice. The pick pass draws once per pointer update and the
  faint lines only during playback. Rapids and filtered moves also still cost their vertex work
  before the shader drops them. Memory was the limit on big programs; later steps in this batch
  cut how many moves are drawn at all.
- **A legend filter still rebuilds the drawn toolpath** (ADR-470), now without copying positions.
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
  buffers, counted by wrapping `bufferData` and `deleteBuffer`, stay within 64 KB of what opening
  took through a hover, four lens changes and playback, with no console error. On main the hover
  alone added 640 KB (32 bytes a move). The pick, keys, connected-script and large-worker specs
  pass unchanged.
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
