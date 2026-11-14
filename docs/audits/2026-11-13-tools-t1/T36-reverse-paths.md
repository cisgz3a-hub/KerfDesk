# T36 Reverse Direction — auditor report
Tree: origin/main @ 975631408. Command id: `tools.reverse-paths`.

## Map
- Menu: Tools → Vector → Reverse Direction. `src/ui/commands/design-tools-commands.ts:83-89` uses `pathCommand` (`:145-156`). It is enabled when `canEditSelectedPaths` is true (`design-tools-command-context.ts:81-91`: an unlocked imported-svg, traced-image or polyline shape is selected). Tooltip: `src/ui/help/design-tools-command-help.ts:36-40` ("… Closed paths keep their start point. Kerf offset sets its own direction.").
- Store: `src/ui/state/path-cleanup-actions.ts:96-106` `reverseSelectedPaths` → `editSelectedPaths` (`:155-185`, one undo step, clears node selection) → `withPaths` (`:188-199`, recomputes bounds, syncs polyline-shape spec through `synchronizePolylineShapeGeometry`) → `reversedTabAnchors` / `reverseAnchor` (`:204-238`, CNC and laser placed tabs: closed `t → 1 − t`, open `t → 1 − closing − t` mod 1). Toast `reverseMessage` (`:282-291`), either-end note via `openPathsMayFlip` (`:248-253`).
- Core: `src/core/geometry/path-direction-edits.ts:107-149` `reversePaths` / `reversePolyline` / `reverseCurveKeepingStart`; curves through `curveEndpointJoin.reverse` (`src/core/scene/curve-join.ts:75-95`: segment order reversed, cubic controls swapped, arc `sweep` flipped, `largeArc`/radii/rotation kept).
- Output stages that read direction: laser optimizer flips only OPEN segments under `pathDirection: 'allow-reverse'` (`segment-order.ts:171,399`, `directional-order.ts:66-72`); `closedShapeStart` rotates the seam only; kerf offset sets its own winding (ADR-480 item 6); CNC `enforceCutDirection` reverses closed profile/pocket toolpaths to climb/conventional (`src/core/cnc/motion-polish.ts:56-80`, ADR-251/252); laser leads (ADR-626) read the direction from the ring (`laser-lead-contour.ts`).
- Governing: ADR-480 item 6 (LBG-F08), ADR-494 Amendment 1 (tabs follow the reversal), ADR-251/252 (CNC climb), ADR-626, ADR-415; WORKFLOW F-A6e item 3 (`WORKFLOW.md:814-818`).
- Since 2026-10-16: the tree is a `git archive` export, so no log; ADR-494 Amd 1 (laser tabs follow) and #1921 (curves kept by Convert to Path) are present.
- LightBurn: Edit → Reverse Shape Direction, or Shift-click with Set Start Point; primitives must be converted to paths first; Cut Planner "Choose best direction" may override it; LightBurn's developer has said kerf offset re-winds shapes and that the output should be checked and re-reversed if the user wanted the other direction (forum "Cut direction won't change"). KerfDesk matches the first three; for kerf it keeps its own winding by decision (ADR-480).

## October register re-check
Register row 43 (`docs/audits/2026-10-16-tools-quality-register.md:77`): "Reversed 1 path" toast and exact Undo. Still true: R1 toast `Reversed 1 path.`, Undo restores the scene byte-exactly, Redo repeats it exactly, save/reopen keeps the reversed points (`zz-t36/t36-burn.log` R1). Segment/control/sweep reversal and tab fractions also hold (C1, T1, N1 below).

## Checks run
All scripts are in `C:\Users\stolk\kd-t1\zz-t36` and drive the real store action, `prepareOutput` → `emitPreparedGcode` (decoder copied from zz-t26) or `compileCncJob`. Logs: `t36-burn.log` (R1-R7), `t36-burn2.log` (R8), `t36-more.log` (C1, P1, D1), `t36-more2.log` (T1, N1 with the coverage-sampling tab oracle).

| Check | Method | Result |
|---|---|---|
| Closed square, Line op, default planner | store + G-code decode (R1) | Start (10,10) kept, signed area +600 → −600, lit 100 = 100 mm. Pass |
| Undo / Redo / save-reopen | R1 | Exact. Pass |
| Open polyline under 4 Cut Planner settings | R2 | Default (allow-reverse, nearest): G-code byte-identical before/after (planner picks the nearer end) and the toast says so and how to keep it. Preserve or source order: start moves to the old end, lit 80 = 80. Pass (by design, warned) |
| Kerf +0.1 / −0.1 | R3 | G-code byte-identical before/after; toast still "Reversed 1 path." → T36-P3-1 |
| Lead-in/out line (outside) and arc (auto) | R3 | Lead mirrors about the start (23.586 → 26.414, same y 8.586 outside); lit equal. Pass |
| Overcut 3 mm | R3 | Overcut runs on in the new direction (ends 28 → 22), lit 103 both. Pass |
| Closed shape start nearest / nearest-corner | R3 | Same start (10,30), direction flipped. Pass |
| Mirrored (mirrorX, scaleX −1) and rotated objects | R4 | World winding flips relative to before in each case; start kept. Pass |
| Outer + hole, inside-first | R5 | Hole still first; both windings flip; lit 200 both. Pass |
| Fill, nonzero and even-odd, one of two overlapping objects reversed; outer+inner in one object reversed | R6 | Fill G-code byte-identical in all four cases (fill is per object, relative winding kept). Pass |
| Text, rectangle, locked, mixed | R7, R8 | Skipped, no undo step; mixed selection toast omits the skip → T36-P3-3. Menu disabled for locked-only. Pass |
| Metadata / operation / overrides / name inheritance | R8 | Only `paths` and `bounds` change. Pass |
| Curves: open cubic, closed 2-arc circle, ¾-arc closed by implicit line | C1, independent flattening at 0.001 mm, Hausdorff + arc-length probe | Hausdorff 0.000 for every subpath; open start → old end (40,20); closed start kept; arc sweeps flipped, largeArc kept; polyline matches curve (0.000); probe at 0.25 → 0.75 (0.808 on the implicit-line case, which matches the explicit closing line now counted: (47.12−11.78+14.14)/61.26). Lit 186.827 both. Pass |
| Laser tabs: placed (t 0.1, 0.35), automatic ×3, open with anchors | T1, coverage sampling every 0.05 mm along the ring | Uncut intervals identical before/after ((21.05–22.95,10) and (50,11.05–12.95); three automatic gaps identical); anchors 0.9/0.65 (closed), 0.733/0.483 (open, closing fraction 1/6) = oracle. Pass |
| CNC Profile outside, climb and Default direction | N1, `compileCncJob` passes | Passes identical before/after in both settings → T36-P3-1 |
| CNC Profile on path, closed and open | N1 | Reversal reaches the passes (area −800 → +800; open starts at old end). Pass |
| CNC manual tabs, outside climb and on path | N1 | Outside: identical. On path: rise points move by ±3.588 mm, i.e. the tab's leading edge swaps sides; tab centres stay at (26,380) and (60,372) machine. Pass |
| Drawn polyline shape, exact and freehand, open/closed | P1 | Exact: spec 5 → 5 points, start kept/swapped correctly, lit equal, Undo exact. Freehand: spec points become the flattened polyline (5 → 21/33), lit equal (see limits) |
| Degenerate: one-point, empty, NaN, unpaired curves, 20 000 paths, double reversal | D1 | No throw; 20 000 paths in 26 ms; reverse twice = identity |
| Repo suites `path-direction-edits.test.ts`, `path-cleanup-actions.test.ts` | — | Not run: free memory 1.0–1.2 GB after my scripts (gate 1.5 GB) |

## Findings

### T36-P3-1: "Reversed N paths." when the operation sets its own direction: laser kerf offset and CNC Profile/Pocket give byte-identical output
- Severity: P3. Nothing burns wrong (the output is what it was before), but the toast says the cut direction changed when it did not. The tooltip names kerf only; nothing in the tooltip, toast, WORKFLOW F-A6e or ADR-480 says that CNC Profile inside/outside and Pocket ignore the drawn direction, under Climb, Conventional AND "Default direction".
- Where: `src/ui/state/path-cleanup-actions.ts:282-291` (message), `src/core/cnc/motion-polish.ts:56-80` (closed toolpaths re-wound), kerf winding per ADR-480 item 6.
- Repro: `zz-t36/t36-burn.test.ts` R3 (`kerf+0.1`, `kerf-0.1`: "gcode identical: true"), `zz-t36/t36-more.test.ts` N1 (`outside climb`, `outside default-direction`: passes before = after: same start 40.001,381.588 / 18.413,358.413, same area −1000.581).
- Oracle: LightBurn docs/forum: kerf re-winds the shape and the user must check; CNC convention (ADR-251) sets climb direction from the material side.
- Suggested fix: when every reversed closed path sits on a kerf-offset Line operation or a CNC Profile inside/outside/Pocket, add "The cut direction is set by kerf offset / climb-conventional on this operation, so the output does not change." Also say it in WORKFLOW F-A6e.

### T36-P3-2: The either-end note names the laser Cut Planner in CNC mode, where open-path direction is kept anyway
- Severity: P3, wording. Partly run: N1 `on-path open` compiles the reversed open path from its new start under the default `allow-reverse` settings, and the CNC compiler does not read `pathDirection` (only `src/core/job/*` laser files do).
- Where: `path-cleanup-actions.ts:248-253` reads `project.optimization` whatever the machine.
- Repro: `zz-t36/t36-more2.log` N1 `on-path open`: toast "… set Path direction to Preserve direction in the Cut Planner to keep it." while the after pass starts at 20,360 (the old end).
- Suggested fix: show the note only for laser projects.

### T36-P3-3: A mixed selection does not say that text and drawn shapes were left alone
- Severity: P3, wording. Close Path adds "Text and drawn shapes keep their own paths…" when it skips some (`closeMessage`), Reverse Direction says only "Reversed 2 paths." and the text keeps its direction.
- Where: `path-cleanup-actions.ts:282-291`.
- Repro: R8: select text + imported square + traced square → "Reversed 2 paths."; the text object is unchanged.
- Suggested fix: reuse `skippedOpenObjects`-style counting (any non-editable object with paths) and append the convert-to-paths note.

### T36-P3-4: Test gap: no test compiles output before and after a reversal
- Severity: P3. The repo tests check the geometry and the tab fractions, but nothing checks that the reversal reaches G-code, or pins the kerf/CNC-profile cases where it deliberately does not (READ ONLY: `path-cleanup-actions.test.ts:287-430`, `path-direction-edits.test.ts:177-215`; the only `compileJob` there is a Close Path kerf case).
- Suggested fix: add the R1/R2 (preserve)/R3 kerf/N1 cases as assertions.

## Not a defect / limits
- Open paths under the default Cut Planner (allow-reverse + nearest neighbour) are cut from the nearer end, so Reverse Direction changes nothing there; ADR-480 item 6 decides this and the toast says so (R2). LightBurn's "Choose best direction" behaves the same way.
- Kerf offset re-winding closed paths is by decision (ADR-480 item 6), and CNC climb/conventional is ADR-251/252. Only the message is raised (T36-P3-1).
- Rectangles, ellipses, polygons and text are not reversed; LightBurn also needs a primitive converted to a path first.
- A freehand (round-faired) drawn polyline's `spec.points` become the flattened polyline after a reversal (5 → 21/33 points). The burn is unchanged (P1 lit equal) and polylines are not rematerialised from spec (`rematerialize-shape.ts` excludes them); node edits use the same sync (`synchronizePolylineShapeGeometry`). Not raised.
- Invalid input only: a 1-point polyline paired with a curve that has segments gets its curve reversed and its polyline left as is (D1). Real imports do not produce this pair. Not raised.
- The menu is enabled for a Boolean compound and then reports "Nothing to reverse" — KNOWN as T35-P3-3 (shared `pathCommand`/`canEditSelectedPaths`), not counted again.
- Variable text, variable barcodes and the registration jig: Reverse Direction never rebuilds text or barcodes (text and barcode shapes are not path-editable), and it edits jig artwork in place without replacing objects. No finding.
- Not checked: Rotary/galvo outputs, the browser UI (memory), and the repo's own suites (memory gate, 1.0–1.2 GB free).

## Totals
Raised 4; P1 0; P2 0; P3 4; known 1 (T35-P3-3, Boolean compound enables the menu).
