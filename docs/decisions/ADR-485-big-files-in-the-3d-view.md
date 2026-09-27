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

### Consequences

- **Not a guard (ADR-228).** Nothing here blocks, refuses or asks for confirmation. The view draws
  and times the same program the same way; CAM and G-code are unchanged.

### Verification

- Unit tests: the worker's result transfers 11 buffers and none of the dropped arrays reach the
  page; `inspectorProgramTime` keeps every figure the Inspector shows and its `kindSeconds` add
  up to the planner's motion seconds; the time split, readouts, sidebar and analysis tests read
  the slim time and give the same figures as before.
- Page heap after opening a generated serpentine program in the Inspector (Chrome, after a forced
  collection; `Runtime.getHeapUsage`):

  | Moves     | Before   | After    |
  | --------- | -------- | -------- |
  | 250,000   | 47.7 MB  | 36.7 MB  |
  | 1,000,000 | 180.5 MB | 136.5 MB |
