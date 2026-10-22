# Rolling audit v2 — Relief and heightfield

- **When:** 2026-10-21 17:00–22:30 +0800   **Tree:** origin/main @ `2c8d988db` (worktree HEAD
  `255525e2f`; no `src/` difference). Re-checked against origin/main @ `7d55fb339`: no audited file
  changed.
- **Scope:** `src/core/relief/**`, `src/core/heightfield/**`, `src/ui/relief-viewer/**`,
  `src/ui/viewer3d/**`, `src/ui/cnc-viewer3d/**`. Twins and entry points were followed into:
  - the relief compile branch `src/core/cnc/compile-cnc-relief*.ts`, `relief-machine-space*.ts`
    and `depth-passes.ts`
  - the height-map PNG import `src/ui/import/depth-map-import-preparation.ts`,
    `png-heightfield-row-accumulator.ts` and `png-heightfield-mask.ts`
  - STL sizing `src/ui/app/stl-import-size.ts` and `src/ui/import/stl-import-preparation.ts`
  - the canvas and Cut 3D previews `src/ui/workspace/draw-relief.ts` and `cnc-removal-grid.ts`
  - the Job Review relief notes `src/ui/laser/cnc-relief-planning-warnings.ts` and
    `cnc-compiled-depth-warnings.ts`

  Governing documents:
  - ADR-292 and Amendments 1–5, ADR-294 to ADR-301, ADR-304, ADR-308 and ADR-309
  - the relief CAM decisions ADR-412 (and Amd 1), 413, 421 (and Amd 1), 422 (and Amd 1), 423,
    424, 427, 450, 484, 488 and 489 Amd 1
  - ADR-580 (STL reliefs carve the model itself)
  - Prior audits: 2026-08-30 ten-loop (loop 4 and 6), 2026-09-24 AC-3, and the 2026-09-29
    second pass ("3D relief" section)
- **Lenses run:** L1, L2, L3, L4, L6 and L7, each as its own pass in one session. L5 was run only on
  the height-map PNG boundary. STL parsing and `.lf2` validation belong to areas 14 and 13.
- **Method:** an independent oracle read the **emitted G-code text**, not the planner's own passes.
  - Moves were parsed, with arcs linearised.
  - XY was mapped back through `toSceneCoords` and the inverse of the relief's residual isometry.
  - Every cutting sample (0.05 mm steps; 0.1 mm for roughing) was checked against a dense point
    cloud of the true surface: the bilinear pixel surface for a depth map, or the analytic model
    for an STL, with vertical columns on walls.
  - Two measures were taken: the signed 3D distance to the cutter solid (end mill, ball), and the
    drop-cutter vertical gouge (all bits).
  - A separate stock simulation (0.05 mm grid) measured per-move axial engagement and flagged any
    rapid that removes stock.

  The standard test relief is a 24 × 16 mm, 0.1 mm-pixel, 16-bit depth map, 6 mm deep. It has:
  - a 6 × 5 mm boss with vertical walls
  - an R4.5 dome
  - a 14° ramp ending in a 5 mm cliff
  - a 0.3 × 6 mm rib, 4 mm tall

  There was also an analytic STL (box boss, pyramid, 0.3 mm rib) and a "Keep at stock top" STL.
  The repro tests were temporary `zz-16-*` files and have been deleted.
- **Counts:** 5 raised → refuter: 5 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED → P1 0 / P2 1 / P3 4
  (+ 5 KNOWN not re-raised). The refuter changed no severity.

## Headline

Relief CAM holds its main depth contracts on every program checked:
- It never cuts below the set relief depth.
- Roughing keeps the 3D stock-to-leave (0.4996–0.5000 mm against 0.5 mm) under rotation, mirror,
  nonuniform scale, masks and partial cells.
- No rapid removes stock.
- Ball roughing stays within one depth per pass. The 09-29 P2-relief-rough-2 was not reproduced.
- STL finishing meets ADR-580's exact contact (≤ 0.0025 mm).

The one material defect is finishing a **depth-map** relief with a V-bit or engraving bit. The
finishing grid is a tenth of the cutter's full diameter, and Finish scallop cannot refine it. The
cone therefore shaves sharp edges and thin ribs 0.2–0.4 mm deep, measured normal to the surface.
The same bit on the same STL features stays within 0.004 mm, and nothing in Job Review says so.
Smaller items:
- A "Keep at stock top" STL background lets finishing nick the kept wall.
- Setup errors are reported as corrupt source data.
- An extreme pass count escapes as an uncaught RangeError.
- The Relief 3D viewer drops the relief's mirror.

## Findings

### P2-1 — Finishing a depth-map relief with a V-bit or engraving bit cuts 0.2–0.4 mm into sharp edges and thin ribs

- **Where:**
  - `src/core/cnc/compile-cnc-relief-finishing.ts:38-43` (`finishingCellSizeMm`). For any bit
    without a ball, `contactDiameterMm = tool.diameterMm`, so the cell is a tenth of the **full**
    cutter diameter: 0.635 mm for the 6.35 mm 60° V-bit, and 1.27 mm for the 12.7 mm 90° V-bit.
  - `src/core/relief/relief-finishing.ts:387-393` (`scallopRowSpacingMm`). Non-ball rows are
    0.4 × D, whatever Finish scallop says, so no setting shrinks that cell.
  - A depth-map cell holds the highest pixel in its footprint (`heightfield-to-heightmap.ts`
    `sampleTargetCell`). The cutter is solved against the triangulated cell centres
    (`heightmap-surface-contact.ts`), so the surface between a raised sample and its lower
    neighbour runs as a chord under a convex edge.
- **Anchor:**
  - Ground truth: a drop-cutter lifts the cutter location to its highest contact with every facet,
    edge and vertex, so the cutter never enters the model. OpenCAMLib `MillingCutter::dropCutter`:
    "facet = facetDrop(cl,t)", then edge and vertex drops that `liftZ` the point.
  - Contract: ADR-412 Consequences say a convex crease between samples "is replaced by a chord
    below it ... A finer grid is the remedy there". ADR-412 Amendment 1 bounds the cut at "at most
    half a cell". For non-ball bits the operator has no way to get that finer grid.
  - Twin: the same bit on an STL with the same features (ADR-580 exact mesh contact) stays within
    0.004 mm.
- **Scenario:** the standard depth map. Rough with `em-3175` (1/8" end mill) at 2 mm per pass,
  then finish:
  - With the 60° 6.35 mm V-bit (`vb-60`), the cone sits 0.423 mm below the drop-cutter height
    (0.21 mm normal) at the boss's top corner (2.05, 2.05, 0). That is G-code line 21, tool at
    (0.381, 0.317, −4.590).
  - With the 90° 12.7 mm V-bit (`vb-90`), it sits 0.572 mm below (0.40 mm normal) at the top
    corner of the 0.3 mm rib (11.25, 14.95, −2.0). That is line 166, tool at
    (11.992, 15.620, −3.572). The rib is only 0.3 mm wide, so most of its top edge is chamfered
    away.
  - Controls:
    - The 1/8" ball on the same map: 0.092 mm, the KNOWN ADR-412 limit (K-1).
    - `vb-60` on the analytic STL with the same boss and rib: 0.004 mm.
  - Job Review shows only the generic finishing note ("the G1 interpolants between samples are not
    a continuous swept-volume proof"). It gives no cell size and no edge-loss figure, and its
    scallop warnings cover balls only (`cnc-relief-planning-warnings.ts:174-207`).
- **Evidence:** REPRO. A temporary Vitest compiled through `emitGcode` and swept every G-code
  finishing move with a cone drop-cutter against the bilinear pixel surface (0.05 mm cloud).
  Output:
  - `HF vb-60 FINISH maxVerticalGouge 0.4229 at(2.05,2.05,0.000)`
  - `HF vb-90 FINISH maxVerticalGouge 0.5717 L166 tool(11.992,15.620,-3.572) at(11.25,14.95,-2.000)`
  - `STL vb-60 FINISH maxVerticalGouge 0.004`

  Novelty: 09-29 P2-relief-finish-1 covered STL walls only (fixed by ADR-580). 09-29
  P2-relief-finish-2 covers the same row-spacing root but reports ridges left standing, not edges
  cut away. No open PR touches these files (two open PRs, #1339 and #1280, neither in scope).
- **Refuter:** CONFIRMED, P2 kept.
  - **Own repro through emitted G-code.** The refuter used its own map: 12 × 10 mm, 0.1 mm pixels,
    6 mm deep, a 4 × 3 mm boss at stock top and a 0.3 mm rib 4 mm tall. Roughing used `em-3175`
    at 2 mm per pass, then a raster finish. Each finishing G1 was parsed and mapped back through
    `toSceneCoords`. The emitted vertices match the planner's within 0.0008 mm. Every 0.02 mm
    sample was swept against the bilinear pixel surface (0.025 mm cloud).
    - `vb-60` (cell 0.635 mm): the cone reaches 0.221 mm (normal) into the boss's top corner
      (2.05, 4.95, 0).
    - `vb-90` (cell 1.27 mm): 0.395 mm normal and 0.558 mm vertical at the corner (5.95, 4.95, 0).
    - `bn-3175` control: 0.089 mm, which matches K-1.
  - **Cause.** Only the cell was changed, with the same bit, rows and planner
    (`reliefObjectToHeightmap` + `reliefFinishingPlan`):
    - `vb-60` at 0.3175 mm cells: 0.072 mm
    - at the 0.1 mm pixel pitch: 0.0007 mm for `vb-60` and 0.0016 mm for `vb-90`
  - **No setting refines the cell.** `scallopRowSpacingMm` ignores the scallop for non-ball bits,
    so the cell is 0.1 × D under Raster and 0.094 × D under Raster + waterline. No layer field
    (`machine.ts` `relief*`) sets it. The finishing-bit select offers every tool
    (`CncOperationToolFields.tsx:182`).
  - **Is it an accepted limit?** Partly.
    - Both gouges stay inside ADR-412 Amd 1's "at most half a cell horizontally" bound.
    - But the remedy ADR-412 names ("A finer grid is the remedy") is unreachable for pointed and
      flat bits.
    - ADR-421 sized the cell from the "contact diameter" on a ball bench. ADR-368 item 3 gave
      tapered balls `tip diameter / 10`. No ADR decides the full-diameter cell for a V-bit or
      engraver, and ADR-580 left height maps "unchanged".
  - **Ground truth.** OpenCAMLib drops each CL point on the model's own triangles
    (`MillingCutter::dropCutter` calls `facetDrop`, `vertexDrop` and `edgeDrop` on each `Triangle`).
    `AdaptivePathDropCutter` refines its 0.1 mm step down to 0.01 mm where the path bends. So a
    model coarsened past its feature size is expected to gouge, and drop-cutter CAM avoids it.
  - **Severity.** P2 stands. The output is wrong with no disclosure, but it is sub-millimetre and
    cosmetic, within a documented bound class, and on a less common finishing choice. K-1 for
    balls is P2 by the same reasoning. The coordinator may merge this with K-1 and K-3 at
    de-duplication.
- **Fix direction:**
  - Size the finishing grid for pointed and flat bits from their tip or contact geometry, or from
    the requested scallop, as balls already are. Alternatively, solve against the heightfield's
    own pixel pitch near steep edges.
  - State the finishing cell and the possible edge loss in Job Review. This closes the remaining
    "still to do" of 09-29 finish-1 for depth maps.

### P3-1 — "Keep at stock top" STL background: finishing cuts up to half a finishing cell into the kept stock at the model's outline

- **Where:**
  - `src/core/relief/mesh-to-heightmap.ts:170-181`: `uncoveredTop` marks a cell only when no
    triangle covers its **centre**.
  - `src/core/relief/heightmap-mesh-contact.ts:248-283` (`backgroundContact`,
    `backgroundOverBox`): each marked cell is a whole-cell block at the stock top.
  - So where the model's outline crosses a cell whose centre is inside the model, the strip
    between the outline and the cell edge has neither a triangle nor a block.
- **Anchor:**
  - Contract: ADR-580 Decision 1 says "A 'top' background stands as whole-cell blocks at the stock
    top wherever no triangle covers a cell centre". Its Consequences say "Vertical walls finish to
    within the contact tolerance".
  - The control promises "Keep at stock top" (`SelectedReliefProperties.tsx:327-330`).
- **Scenario:**
  - The STL is a 10 × 10 mm flat square sunk 5 mm. Two 0.5 mm markers at the stock top set the
    20 mm extent, and the background is "Keep at stock top", so the square is a pocket in kept
    stock.
  - Square edges at 5.13 / 15.13 mm. Raster finish with the 1/8" ball at the default 0.025 mm
    scallop (cell 0.2806 mm): the cell [5.051, 5.331] has its centre inside the square.
  - The ball cut **0.070 mm** into the kept wall at its top edge: line 341, tool at
    (6.632, 9.120, −1.451) against stock point (5.12, 9.12, 0).
  - Automatic (raster + waterline, cell 0.198 mm) happened to align at 5.13 (−0.001 mm). At
    5.05 / 15.05 mm it cut **0.065 mm** (line 513, tool at (6.543, 9.624, −1.480) against (5.03, 9.63, 0)).
  - Roughing kept its full 0.5 mm in every run.
  - Up to half a cell is possible, which is 0.14 mm for the raster and 0.10 mm for Automatic with
    a 1/8" ball.
- **Evidence:** REPRO. A temporary Vitest swept the emitted G-code against the analytic model on
  a 0.02–0.025 mm cloud. Output:
  - `TOPBG raster FINISH min3dClearance -0.0697 ... at(5.12,9.12,0.000)`
  - `TOPBG auto FINISH min3dClearance -0.0654 L513 ... at(5.03,9.63,0.000)` (edge at 5.05)

  L7: `heightmap-mesh-contact.test.ts:188` checks the block against its own cell rectangle, not
  against the model's outline.

  Novelty: ADR-412 Amd 1 item 4 kept the 'top' background centre-resolved for the earlier
  footprint map. No audit raises the cut into the kept background.
- **Refuter:** CONFIRMED, P3 kept.
  - **Own repro at the contact level.** The refuter used the same 20 mm STL with its edge at
    5.13 mm, mapped through `reliefObjectToHeightmap` (`exact-mesh`, 'top'). It walked the 1/8"
    ball's `constraintAtPoint` across the edge. At the 0.2806 mm cell the ball reaches
    **0.079 mm** into the kept stock, exactly the strip from 5.0508 to 5.13. At the 0.198 mm cell
    it reaches 0.000, because that cell's centre is uncovered and its block covers the strip.
  - **Code.** `backgroundOverBox` (`heightmap-mesh-contact.ts:257-283`) reads only cells flagged by
    `uncoveredTop`, and those are flagged at their centres only.
  - **Is it accepted?** Not fully. The code follows ADR-580 Decision 1's letter: whole-cell blocks
    "wherever no triangle covers a cell centre". But no ADR accepts the cut into kept stock that
    follows from it. ADR-412 Amd 1 item 4 chose centre resolution to keep the background from
    dropping, so the gap is in the contract, not drift in the code.
- **Fix direction:**
  - Block every cell that any uncovered area touches, which leaves stock on the model side
    instead. Or model the outline's boundary edges as vertical walls up to the stock top.

### P3-2 — Relief setup mistakes are reported as corrupt stored source data, with "Re-import or replace that relief"

- **Where:**
  - `src/io/gcode/relief-materialization-failure.ts:9-16` wraps every relief failure as
    `Relief "<source>" could not be compiled from its stored source data. <reason> Re-import or
    replace that relief before preparing G-code.`
  - Callers that are not source-data failures:
    - `src/core/cnc/compile-cnc-relief-rest.ts:57-62`: a rest cutter with no finishing cutter.
      The "source" passed here is `layer.name`.
    - `compile-cnc-relief-rest.ts:129`: the work budget.
    - `src/core/cnc/compile-cnc-relief-projection.ts:44-58,79`: projection convention, cut type,
      a missing target, and placement.
- **Anchor:** Twin: the layer panel gives the right remedy for the same state
  (`ReliefAdvancedCncControls.tsx:62-66`: "Select a predecessor finishing cutter above to prepare
  rest finishing"). METHOD L6: the user must be told the truth.
- **Scenario:**
  1. A CNC layer named "Layer 7" carries a depth-map relief.
  2. The operator picks a Rest cutter (1/16" ball) before choosing a finishing bit. The panel
     allows this and shows the status line.
  3. `emitGcode` returns 0 bytes and `relief-materialization-failed: Relief "Layer 7" could not be
     compiled from its stored source data. Relief rest finishing requires a named predecessor
     finishing cutter and an available rest cutter. Re-import or replace that relief before
     preparing G-code.`
  4. The layer is named as if it were a relief, and re-importing changes nothing.
- **Evidence:** REPRO. A temporary Vitest called `emitGcode` and printed the preflight issue
  text quoted above.
- **Refuter:** CONFIRMED, P3 kept.
  - **Code.** `compileReliefRestGroup` returns
    `reliefMaterializationFailure(layer.name, 'Relief rest finishing requires ...')` when the
    predecessor is missing (`compile-cnc-relief-rest.ts:60-64`).
  - **Wrapping.** `prepareOutput` (`prepare-output.ts:126-127`) and `prepare-output-async.ts:61`
    wrap every relief failure with the fixed "stored source data ... Re-import" text. The
    projection setup failures at `compile-cnc-relief-projection.ts:45-58` also pass `layer.name`.
  - **No upstream guard.** The Rest cutter select stays enabled without a finishing bit. It only
    adds the status line (`ReliefAdvancedCncControls.tsx:67-71`).
  - **Severity.** Output is refused safely, so this is P3.
- **Fix direction:** keep the compile-integrity refusal, but give setup failures their own code and
  message. The message should name the layer and the setting to change.

### P3-3 — A pass count between V8's real array limit and 2^32−1 escapes `emitGcode` as an uncaught "RangeError: Invalid array length"

- **Where:**
  - `src/core/cnc/depth-passes.ts:17-25`: `zPassArrayMaterializationError` refuses only
    `count > 0xffff_ffff`.
  - `depth-passes.ts:35`: the loop then calls `out.push` up to that count.
  - `src/core/relief/relief-roughing-level-materialization.ts:2-12`: the same 2^32−1 bound for
    relief Slope-step levels.
  - `src/io/gcode/program-materialization.ts:11-25`: `isProgramMaterializationRangeError` does not
    recognise V8's "Invalid array length", so `materializeProgram` (`emit-gcode.ts:236-246`)
    rethrows it.
  - Loaders accept any positive value (`normalize-layer.ts:109,155`).
- **Anchor:** Contract and twin: `emit-gcode.ts:229-235` says engine RangeErrors become "a
  compile-integrity preflight failure instead of an unhandled crash". The depth planner's comment
  assumes ArrayCreate's 2^32−1 limit, but V8 refuses an array grown by `push` far earlier.
- **Scenario:** a project file with a 3 mm relief and `depthPerPassMm: 1e-9`.
  1. The count is 3·10^9, which passes the guard.
  2. `emitGcode` throws `RangeError: Invalid array length`. Stack: `zPassDepths` ←
     `reliefRoughingLadder` (`relief-roughing.ts:145`) ← `compileReliefGroupsForLayer` ←
     `compileCncOperation` ← `prepare-output.ts:354`.
  3. Depth per pass has a UI minimum of 0.05 mm (`CncLayerAdvancedFields.tsx:113`), so this needs
     a crafted or hand-edited file.
  4. Relief **Slope step** has minimum 0 (`CncReliefStrategyRows.tsx:66-70`), so a typed value
     under about depth/10^8 would reach the same limit. That case is READ only; it was not run,
     to keep memory low.
- **Evidence:** REPRO (depth per pass, through `emitGcode`) and READ (Slope step). Area overlap:
  `depth-passes.ts` is area 09 scope, reached here through relief.
- **Refuter:** CONFIRMED, P3 kept. The refuter did not rerun it: the repro allocates about 1 GB,
  and the machine is shared. The evidence is two independent lines.
  - **Code.**
    - `zPassArrayMaterializationError` refuses only `count > 0xffff_ffff`.
    - `zPassStepMm` has no lower clamp.
    - The loader takes any positive value (`normalize-layer.ts:109`).
    - `reliefLadderFor` catches only `ReliefLevelArrayMaterializationError`
      (`compile-cnc-relief.ts:186-190`).
    - `isProgramMaterializationRangeError` has no "Invalid array length" case, so `prepareOutput`
      (`prepare-output.ts:133-136`) rethrows.
  - **V8 source** (`src/objects/elements.cc`, `ConvertElementsWithCapacity`): growing past
    `FixedDoubleArray::kMaxLength` / `FixedArray::kMaxLength` throws
    `NewRangeError(MessageTemplate::kInvalidArrayLength)`. That limit is far below 2^32−1.
  - **Slope step.** The UI path is plausible. `parseFieldText` does not round, so a typed 1e-8
    passes the min-0 clamp.
- **Fix direction:** bound the count by what the runtime can actually allocate, or count without
  materialising. Also add "Invalid array length" to the engine-failure set, so the operator gets
  `program-materialization-failed`.

### P3-4 — The Relief 3D viewer drops the relief's mirror, so a flipped relief is shown unflipped

- **Where:** `src/ui/relief-viewer/Relief3DViewerDialog.tsx:63-75` and
  `Relief3DViewerDialog/relief-3d-viewer-dialog-plan.ts` build the display heightmap with only
  `targetScaleX/Y`. The residual mirror (sign of scale, `mirrorX/Y`) is never applied. A grep for
  `mirror|residualTransform` in `src/ui/relief-viewer` finds nothing.
- **Anchor:** Twin:
  - The canvas preview draws the relief through `obj.transform`, mirrors included (`draw-relief.ts`
    `drawPartialGridBitmapAtTransform`).
  - CAM places every pass through the residual transform (`compile-cnc-relief.ts:262`,
    `compile-cnc-relief-finishing.ts:139-145`).
  - Rotation is only a viewpoint, but a mirror cannot be reached by orbiting the camera.
- **Scenario:** a relief of raised lettering is flipped horizontally (for a stamp). The canvas and
  the carve show mirrored text, while Relief properties → 3D view shows it reading normally.
- **Evidence:** READ.
- **Refuter:** CONFIRMED, P3 kept.
  - **Own repro.** `buildSelectionFlipEdit([relief], 'horizontal')` flips a relief (no kind
    filter) and sets `mirrorX: true`. `relief3dViewerDialogPlan` then gives the same `targetScaleX`
    as before the flip, and the display heightmap is identical cell for cell. The raised column
    stays on the left.
  - **Code.** `createReliefThreeScene(canvas, surface, stockThicknessMm)` gets no transform, and
    no ADR says the viewer shows the unplaced source.
- **Fix direction:** apply the residual mirror to the display mesh (the viewer already reflects Y
  for presentation), or label the view "shown unmirrored".

## KNOWN (re-observed on this tree, not re-raised)

- **K-1 — 09-29 P2-relief-finish-1 remainder and ADR-412 Amd 1 ("at most half a cell"). Still
  open for depth maps.** A ball finishing a depth map shaves convex wall tops.
  - Measured worst cases:
    - 0.092 mm at the boss corner with a 1/8" ball
    - 0.075 mm under rotation 30°, mirror and scale 1.25 × 0.8
    - 0.049 mm with raster + waterline
    - 0.010 mm with a 1/16" rest cutter
  - Job Review still does not state the finishing cell. `cnc-relief-planning-warnings.ts:162-172`
    reports the grid only above 4 M cells.
- **K-2 — 09-29 P2-relief-rough-3. Still open (READ).**
  - `compile-cnc-relief.ts:96-104` plans each relief on a layer alone.
  - `heightmap-tool-offset.ts:14` reads "Out-of-bounds neighbors are ignored (treated as
    bottomless)".
  - Not re-run.
- **K-3 — 09-29 P2-relief-finish-2. Still open (READ).**
  - Non-ball finishing rows are 0.4 × D (`relief-finishing.ts:55,387-393`).
  - Scallop warnings are ball-only.
  - P2-1 above is a separate symptom of the same choice.
- **K-4 — 02-P2-1 and 02-P3-7** (relief Pro gating through My artwork, and the "(Pro)" label).
  Not re-verified.
- **K-5 — 09 K-5:** the toolpath simulator ignores "Retract between passes". Not re-verified for
  relief.

## Refuted

The refuter refuted none of the five raised findings. It re-observed two KNOWN items:
- K-1: its own ball control on its own map gave 0.089 mm normal.
- K-3: `scallopRowSpacingMm` still returns 0.4 × D for non-ball bits.

These candidates were dropped by the auditor before raising:
- **"Roughing cuts 5.5 mm deep outside the relief under rotation."** It is G-code's 0.001 mm XY
  rounding against the oracle's 1e-6 mm inside test. Identity placements put every centreline
  inside the relief.
- **"Cut 3D shows the relief 0.2 mm deeper than the program cuts."** 6 of 18,096 cells, all on
  walls, each one 0.2 mm preview cell. Elsewhere the removal grid agrees with an independent stamp
  of the emitted G-code within 0.03 mm.
- **09-29 P2-relief-rough-2, "ball roughing cuts up to twice the depth per pass."** Not reproduced:
  the maximum axial engagement was 2.001 mm at 2 mm per pass. Tested with 1/8" and 1/4" balls at
  40% and 85%, on the standard map and a 60 × 40 × 10 mm hill. It appears resolved by the ADR-413
  and ADR-289 Amd 1 core cleanup and the ADR-368 Amd 2–3 cut width.

## Verified clean

- **Maximum depth.** In every program the deepest Z equals −reliefDepthMm, and roughing bottoms
  at −depth + allowance. Relief motion below the stock thickness is warned at and below the stock
  bottom (`cnc-compiled-depth-warnings.ts`, `warnAtStockBottom`).
- **3D stock-to-leave (ADR-412 item 3).** Minimum 3D clearance from roughing to the true surface
  was 0.4996–0.5000 mm, against the 0.5 mm allowance, in every case:
  - depth map: identity; rotation 30° + mirror X + scale 1.25 × 0.8; scale X −1 + rotation 90°
  - alpha-masked
  - STL: identity, raster, rotation 45° + scale 0.8
  - "Keep at stock top" STL

  This also shows placement, scale and mirror are right: a misplaced path would show as a
  one-sided gouge.
- **STL finishing (ADR-580).** −0.0022 to −0.0025 mm (raster, Automatic, rotated), inside the
  documented 0.002 mm tolerance plus sagitta. The 60° V-bit on the STL: 0.004 mm. The 0.3 mm rib
  kept its allowance in roughing.
- **Rapids and engagement.**
  - A whole-program stock simulation of five programs (raster; waterline + 1/16" rest; 10° ramp;
    flats with the roughing bit; STL Automatic) found **0** rapids that remove stock (ADR-489
    Amd 1).
  - End-mill roughing engagement was exactly the 2.000 mm pass.
  - Ball roughing reached at most 2.001 mm (see Refuted).
- **Masks (ADR-484).** Alpha-excluded areas are never entered by roughing, raster or waterline
  finishing. The worst value is the K-1 boss corner.
- **Flats (ADR-450).** Floors are cut exactly to −6.000 with zero clearance and no wall contact.
- **Partial terminal cells (ADR-294).** The 24 × 16 mm relief at 0.396875 and 0.2806 mm pitches
  keeps every centreline inside [0, W] × [0, H]. The cutter reaches past the edge only by its
  radius, by the documented bottomless-edge rule.
- **Width authority (ADR-292 Amd 2–3).** CAM materialisation, the canvas preview and the Relief 3D
  viewer all size from `reliefPhysicalDimensions` / `physicalWidthMm`. The binding check rejects a
  `targetWidthMm` that drifts from it (`heightfield-metadata-validator.ts:45-63`).
- **Mapping (ADR-298, ADR-308).** Codes are normalised, gamma is applied, then polarity
  (`heightfield-to-heightmap.ts:352-371`). Inverted endpoints invert, and equal endpoints give
  mid-depth. "light-is-high" maps white to the stock top. Canvas, Relief 3D and CAM all call
  `reliefObjectToHeightmap`.
- **PNG import (ADR-295, ADR-296).**
  - 16-bit samples are swapped from MSB-first to U16LE (`png-heightfield-row-accumulator.ts:116-121`).
  - 8-bit samples are ×257, and the tRNS key is ×257 at 8 bits.
  - Grey-alpha is read as grey then alpha, with alpha kept as the mask (threshold 255).
  - SOURCE W3C PNG 3 §7.2: "network byte order (MSB first, LSB second)". §4.5: "Greyscale with
    alpha: grey, alpha".
  - The adversarial PNGs were all refused with a named reason, which reaches a toast
    (`height-map-import-action.ts:95-100,139-148`): RGB, grey-alpha-16, 1-bit, Adam7, truncated,
    IHDR and IDAT CRC damage, missing rows, non-PNG, empty, and declared sizes of 60000² and
    200000².
- **STL size (09-29 P2-relief-finish-3).** Resolved by ADR-580 in `stl-import-size.ts`: own size,
  uniform bed fit through Width and Depth, the tiny-model rule, and flat and taller-than-stock
  notices.
- **Preview twin.** The 2D/Cut 3D removal grid matches an independent stamp of the emitted G-code
  within 0.03 mm, except the 6 wall cells above.
- **Two-sided split (ADR-580 item 4).** READ: the side A floor is at the split and the side B
  floor at split − web, so the floors stand one web apart. Each side's frame fixes its stock-face
  datum.
- **Failure paths.** The Cut 3D offscreen worker routes `onerror`/`onmessageerror` to the dialog's
  failure reason (`cut3d-offscreen-session.ts:154-155`). Heightfield allocation, base64 and digest
  failures return named reasons, never partial maps.

## Not verified

- Any hardware, air cut or material result.
- Tapered-ball and engraving bits in the oracle (only end mill, ball and V-bit were run).
- Relief projection depth, tiled seams and registration bores, and rest-finishing residual
  honesty beyond the gouge check.
- Side B placement after the ADR-573 flip.
- Relief authoring (editable relief, sculpt, rails).
- K-2 and K-3 were not re-run.
- **Huge fields.** These were measured once, on a machine loaded by other sessions:
  - A 4000² 16-bit field takes 4.1 s to create, 5.7 s to decode its 42.7 M-character base64
    (`depth-map-base64.ts` checks every character with `indexOf`) and 1.0 s to digest. One
    materialisation takes 16–20 s.
  - A 2000² relief compiles in 19 s; `emitGcode` takes 23 s.
  - Each compile materialises the source again for roughing, the offset-ladder diagnostics,
    finishing and rest.
  - No budget contract exists, so nothing was raised. Further heavy runs were skipped at the
    coordinator's request.
- Height-map PNGs above about 14k² 16-bit. READ only: base64 would pass V8's string limit and
  `encodeCanonicalBase64` would throw "Invalid string length". That error is caught at import, but
  the toast shows that raw text. Not run.
- Browser-side worker OOM and process loss; autosave of large reliefs (area 13); the STL parser
  (area 14).

```json
[
  {"id":"P2-1","severity":"P2","area":"relief","file":"src/core/cnc/compile-cnc-relief-finishing.ts","line":40,"anchor":"Ground truth: drop-cutter (OpenCAMLib MillingCutter::dropCutter); Contract: ADR-412 'a finer grid is the remedy' + Amd 1 half-cell bound; Twin: ADR-580 STL exact contact","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Depth-map relief finished with a V-bit/engraver plans on D/10-of-full-diameter cells that Finish scallop cannot refine; the cone cuts 0.42 mm (vb-60) / 0.57 mm (vb-90) vertically, 0.2-0.4 mm normal, into sharp edges and a 0.3 mm rib; same bit on STL 0.004 mm; Job Review silent"},
  {"id":"P3-1","severity":"P3","area":"relief","file":"src/core/relief/mesh-to-heightmap.ts","line":177,"anchor":"Contract: ADR-580 Decision 1 and Consequences ('Vertical walls finish to within the contact tolerance'); UI 'Keep at stock top'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"'Keep at stock top' STL background blocks only cells whose centre is uncovered, so finishing cuts up to half a finishing cell into the kept stock wall at the model outline (0.070 mm raster, 0.065 mm Automatic measured)"},
  {"id":"P3-2","severity":"P3","area":"relief","file":"src/io/gcode/relief-materialization-failure.ts","line":13,"anchor":"Twin: ReliefAdvancedCncControls.tsx:62-66 names the right remedy; METHOD L6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Rest cutter without finishing cutter (and projection/budget setup errors) reported as 'Relief \"<layer name>\" could not be compiled from its stored source data ... Re-import or replace that relief'"},
  {"id":"P3-3","severity":"P3","area":"relief","file":"src/core/cnc/depth-passes.ts","line":22,"anchor":"Contract: emit-gcode.ts materializeProgram (engine RangeError becomes a compile-integrity failure, not an unhandled crash)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Pass-count guard checks only 2^32-1; depthPerPassMm 1e-9 (file) or a tiny Slope step (UI min 0) makes zPassDepths/levels throw 'RangeError: Invalid array length', which isProgramMaterializationRangeError does not recognise, so emitGcode throws"},
  {"id":"P3-4","severity":"P3","area":"relief","file":"src/ui/relief-viewer/Relief3DViewerDialog.tsx","line":69,"anchor":"Twin: draw-relief.ts drawPartialGridBitmapAtTransform and CAM residualTransform apply the mirror","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Relief 3D viewer ignores the relief's mirror, so a flipped relief shows unflipped while the canvas and the carve are mirrored"},
  {"id":"K-1","severity":"P2","area":"relief","file":"src/core/relief/heightmap-surface-contact.ts","line":1,"anchor":"Contract: ADR-412 Consequences, Amd 1","evidence":"REPRO","verdict":"CONFIRMED","known":"09-29 P2-relief-finish-1 (remainder, depth maps); ADR-412 Amd 1","summary":"Ball finishing on a depth map shaves convex wall tops by up to half a cell (0.092 mm, 1/8\" ball); finishing cell still not stated in Job Review"},
  {"id":"K-2","severity":"P2","area":"relief","file":"src/core/cnc/compile-cnc-relief.ts","line":96,"anchor":"ADR-098/ADR-289 edge rule","evidence":"READ","verdict":"PENDING","known":"09-29 P2-relief-rough-3","summary":"Reliefs on one layer planned alone with bottomless edges; roughing can cut a neighbouring relief"},
  {"id":"K-3","severity":"P2","area":"relief","file":"src/core/relief/relief-finishing.ts","line":393,"anchor":"ADR-291 item 6","evidence":"READ","verdict":"CONFIRMED","known":"09-29 P2-relief-finish-2","summary":"Non-ball finishing rows fixed at 0.4 x D, ignoring Finish scallop; no ridge disclosure"},
  {"id":"K-4","severity":"P2","area":"relief","file":"src/ui/library/personal-artwork-actions.ts","line":62,"anchor":"ADR-540 Amd 1","evidence":"READ","verdict":"PENDING","known":"02-P2-1, 02-P3-7","summary":"Relief Pro gating items from report 02; not re-verified"},
  {"id":"K-5","severity":"P3","area":"relief","file":"src/core/job/toolpath-cnc.ts","line":83,"anchor":"Twin: retractBetweenPasses","evidence":"READ","verdict":"PENDING","known":"09 K-5","summary":"Toolpath simulator ignores Retract between passes; not re-verified for relief"}
]
```
