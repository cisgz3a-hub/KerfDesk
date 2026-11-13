# T10 Close Paths with Tolerance — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.close-paths-with-tolerance`.

## Map
- Menu: Tools → Fill repair → **Close Paths With Tolerance...** (`src/ui/commands/layout-commands.ts:168-174`, spec `CLOSE_WITH_TOLERANCE`). Enabled on `ctx.canEditSelectedPaths` (`layout-commands.ts:222-229`), which `selectionHasEditablePaths` (`design-tools-command-context.ts:83-92`) sets for any unlocked imported-svg, traced-image or polyline shape in the selection. Disabled reason: "Select imported, traced or drawn-line artwork first." The tooltip is in `src/ui/help/layout-command-help.ts:75-79`.
- Handler: `ctx.closePathsWithTolerance` = `openClosePathsToleranceDialog` (`design-tools-command-context.ts:60`), hosted by `ParityDialogHosts.tsx:20`.
- Dialog: `src/ui/commands/ClosePathsToleranceDialog.tsx`. It has a `type="number"` box (`min=0`, `step=0.1`, default 0.5, mm only). Valid means non-empty, finite and ≥ 0 (line 64). Two radios: "Adding a closing line" (bridge) and "Moving both ends together" (move-ends). Live counts come from `closePathsWithinTolerance` per selected unlocked editable object (lines 37-56). Submit runs through `Dialog`'s `checkedSubmit` (noValidate, ADR-690) and calls `closeSelectedPathsWithTolerance(tol, mode)`.
- Store: `src/ui/state/path-cleanup-actions.ts:58-82` → `editSelectedPaths` (one `pushUndo`, locked and non-editable objects skipped, polyline shapes re-synced through `synchronizePolylineShapeGeometry`). The toast is "Closed N paths. M paths stay open: the gap is wider than X mm.".
- Core: `src/core/geometry/close-within-tolerance.ts`. The guard is `!(tol >= 0)`, so Infinity passes. The world gap uses `applyTransform` on the curve or polyline ends, with `<=` and no epsilon. Bridge reuses `closeOpenPaths` (`path-direction-edits.ts:48-81`), which appends a line. Move-ends uses `meetPolyline` (first and last point → midpoint) and `meetCurve` (start and last `to` → midpoint, with the cubic `control1`/`control2` shifted with their end; an `elliptical-arc` keeps its radii and flags, and only its `to` moves).
- Output: `compilationPolylines` flattens the **curves** (`src/core/job/compilation-polylines.ts`), and the canvas does the same (`display-polylines.ts` → `flattenColoredPathCurves`). The canonical curve is what burns and what shows.
- Governing: ADR-480 family (LightBurn gap batch 5, LBG-F08, Close/Reverse path cleanup; the header comment of `path-cleanup-actions.ts`). No ADR names this dialog; ADR-690 (`checkedSubmit`); ADR-629 (dialogs in mm). WORKFLOW.md F-A6e (Close Path, ~line 788) is the nearest section; it does not describe this dialog.
- Changes since 2026-10-16: only `ab3226fd1` (C2-P3-1, shared `midpoint`/`addPoints` helpers) touched `close-within-tolerance.ts` and `path-direction-edits.ts`. The dialog and the store action are unchanged.

## October register re-check
Row #56: "bridge/meet ends and tangent control movement; transformed gaps/cubic cases; core accepts Infinity, UI must validate finite input".
- Bridge/meet and tangent control: **still correct for cubics.** Script B: a C of two cubics, world gap 1.500, moved its ends together with a max deviation of 0.759 from the original (half gap 0.750, plus flattening). The ends coincide and the control points move with them. Under rot 71°, scale 3×0.5 and mirror X: 0.377 for a 0.750 gap. **Not correct for a single elliptical-arc segment** (T10-P2-1).
- Transformed gaps: **still correct.** A local gap of 1 under scale 3×0.5, rot 20° and mirror Y (world 3) stays open at 1 and 2.99 and closes at 3. Moving the ends shifts the outline by 1.500 = gap/2. The arcs under rot 33°, 1.5×0.6 and mirror X were measured in world mm (2.092).
- Core accepts Infinity, UI must validate: **still as noted.** The store action with Infinity closes every open path, including a 36 mm gap (script D). The dialog turns "Infinity" into "" and disables the button (dialog script). `1e308` is still accepted and closes everything: same as T08-P3-3.
- Exact Undo: **still fixed** (script E: undo == before, redo == after, reopened G-code identical).
- Existing suites: `close-within-tolerance.test.ts` and `close-paths-tolerance-actions.test.ts` pass, 2 files / 4 tests.

## Checks run
Scripts are in `C:\Users\stolk\kd-t1\zz-t10\`. `t10-burn.test.ts` runs the real store action → `compilationPolylines` / `prepareOutput` → `emitPreparedGcode` → lit G1 moves, decoded with `zz-t07/decode.ts`. Deviation comes from my own analytic sampler (circle/cubic formulas, 0.1 mm densify, point-to-polyline distance). `t10-dialog.test.tsx` renders the real dialog host with the store, in jsdom. Logs: `t10-burn.log`, `t10-dialog.log`. Run from the tree root with `--config ../zz-t10/vitest.config.mts --maxWorkers=1` and `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Method | Result |
|---|---|---|
| Move-ends, single arc segment 5°→355° r 20 (gap 3.486), tol 5 | script A | Curve collapses to a point. Lit length 122.124 → **0.000**; identity and rot33/1.5×0.6/mirror both collapse. Toast "Closed 1 path." Compat polyline vs curve differ by 39.9 mm. Reopen keeps it; Undo restores: **T10-P2-1** |
| Move-ends, 2 arcs / 4 arcs / slot (line+arc+line+arc) | script A | Max deviation 1.743 / 1.743 / 0.502 = gap/2 (1.046 / 1.046 / 0.751 under transform). The 2-arc case reshapes the whole arc (orig→result 1.244) but stays within gap/2 |
| Bridge on the same arcs | script A | Existing geometry unchanged (orig→result ≤ 0.010); only the closing line is added |
| Move-ends, cubic C, identity and rot71/3×0.5/mirror | script B | Deviation 0.759 / 0.377 vs half gap 0.750 / 0.375. Refused at gap − 0.01 with toast "1 path stays open..." |
| Move-ends, polyline, non-uniform scale | script B | World gap 3: refused at 1 and 2.99, closes at 3, deviation 1.500 |
| Does a Line cut move by more than the tolerance? | scripts A/B | Never, except T10-P2-1. Move-ends moves each end by gap/2 ≤ tol/2; bridge moves nothing |
| Which ends: one object with 2 subpaths forming a rectangle (0.3 mm cross gaps, own gaps ≈22) | script C | Never joins different subpaths or objects. At tol 1 both stay open; at tol 25 each half closes onto itself (two triangles), the same with 2 separate objects. By design, same as LightBurn: no cross-path join. Large-tolerance harm is the same as T08-P3-1 |
| Large tolerance in move-ends | script G (arc 5°→175° r 20, tol 39.86) | Ends move 20 mm each; lit 59.3 → 44.3. Within tol/2 by design; counts only (same as T08-P3-1) |
| Real imports: DXF ARC 5°→355°, SVG `A` | script F (parseDxf, parseSvg) | Both import as 4 cubics, so they do not hit T10-P2-1. Move-ends 122.141 → 124.375; bridge → 125.627 |
| Optimize Shapes (lines-arcs and lines-arcs-curves) on open near-circles | script G | Output is split into 2-6 pieces (`cee`, `eeeeee`), so it does not hit T10-P2-1 |
| Action guard: 0, -0, -1, NaN, ±Infinity, 1e-300, 1e308, MAX_VALUE | script D | 0 and 1e-300 close only the exactly-touching path. -1, NaN and -Infinity change nothing and add no undo step (toast "The selection has no open paths to close.", odd but unreachable from the UI). Infinity, 1e308 and MAX_VALUE close all |
| Dialog: "0.5", "", "abc", "0", "-0", "-1", "Infinity", "1e308", "0.5in", "0,5", "0.25", "0.3", "0.05", "5", " 2 " | dialog script | Invalid text becomes "" with the button disabled and "0 paths will close. 0 paths stay open." and no reason (same as T08-P3-2). "Infinity" is refused. 1e308 closes all (same as T08-P3-3). Units and comma are refused (same as T08-P3-3). "0" is valid but the button is disabled while nothing closes |
| Locked object in the selection (gap 0.2, tol 0.5) | dialog script, script E | Left untouched (correct), but the counts and toast leave it out: "1 path will close. 2 paths stay open." for 4 open paths: T10-P3-1 |
| Mode radios and keyboard | dialog script (jsdom) + READ | Both radios have no `name` (`""`), so they are two one-item groups: T10-P3-2 |
| Cancel | dialog script | Dialog gone, project unchanged, no undo step |
| Polyline shape (pen), locked object and SVG together, move-ends | script E | One undo step. The pen spec is re-synced (closed, 4 points, first (0, 0.25)). Locked is unchanged. Undo == before, Redo == after, reopened G-code identical. A second Apply gives no change and no undo step |
| Kerf 0.5 on a Line layer after closing | script E | Bridge: lit 60.006 → 63.508, bbox −0.5..20.5. Move-ends: 63.752. The closed contour now takes kerf, which is the purpose of the tool |
| Equal gap and float error | READ `close-within-tolerance.ts:43` | `<=` with no epsilon, same comparator as T08-P3-5. My one case computed exactly 1.0 and closed; not re-swept |
| Enabled with only closed paths or a boolean compound selected | READ `design-tools-command-context.ts:83-92` vs `isPathEditable` | The command opens to "0 paths will close. 0 paths stay open." with no reason: same as T07-P3-3 |
| LightBurn reference | the T08 auditor's lookup of `docs.lightburnsoftware.com` Reference/CloseSelectedPathsWithTolerance | LightBurn has the same two options (Join with a line / Move ends together), closes each shape on its own and shows counts only. KerfDesk matches, apart from T10-P2-1 |

## Findings

### T10-P2-1: "Moving both ends together" turns a path made of one arc segment into a point: the whole cut disappears, and the toast says "Closed 1 path."
- Severity: P2. It is a wrong result and it loses the cut. A 122 mm arc becomes 0 mm of burn, saved that way. It is not P1 because the canvas flattens the same curve, so the arc visibly vanishes, and one Undo restores it. Reach is narrow today: DXF ARC and SVG `A` import as cubics, and Optimize Shapes splits arcs. It is reachable through artwork that holds a single `elliptical-arc` segment: projects or files that keep SVG-style arcs (`parse-path-d.ts`, `project-curve-shape-validator.ts` accept them) and Trim/Extend pieces (`trim-curve-split.ts` `subSegment` keeps the arc kind). The same collapse hits a small single-arc piece whose chord is within the tolerance.
- Where: `src/core/geometry/close-within-tolerance.ts:102-121` (`meetCurve` sets `start = meet` and the only segment's `to = meet`). `src/core/scene/curve-path.ts:312-313` (`endpointArc` returns null when from == to, and `flattenArc` then emits only `[segment.to]`).
- Repro: `zz-t10\t10-burn.test.ts` test A, case "one arc 5..355 deg". Curve `{start: P(5°), segments: [{elliptical-arc, r 20, largeArc, sweep, to: P(355°)}]}`, Line layer, tol 5, move-ends. Compiled curve: 3 points, length 0.000 (expected about 125.5 mm, a closed circle with its ends moved ≤ 1.743). Lit G1 length 122.124 → 0.000. Under rot33/1.5×0.6/mirror: 135.937 → 0.000. The compatibility polyline still holds the circle (39.9 mm from the curve). Bridge mode on the same path is correct (lit 125.6).
- Oracle: SVG arc endpoint semantics (an arc whose endpoints are equal is omitted), and my own sampler on the analytic circle: the result should stay within gap/2 = 1.743 of the original. It measures 39.924 from the original to the result.
- Suggested fix: in `meetCurve`, when the moved segment is an `elliptical-arc` (at either end), replace it by its cubic approximation (`arcToCubics`) before moving the ends, as the cubic path already does. Or refuse move-ends for that subpath and fall back to bridge. Add a test with a single-arc and a two-arc subpath.

### T10-P3-1: Locked paths in the selection are left out of the counts and the toast
- Severity: P3. Leaving locked artwork untouched is correct; only the wording is missing.
- Where: `ClosePathsToleranceDialog.tsx:49` and `path-cleanup-actions.ts:137-143,58-81` both skip locked objects before counting.
- Repro: `t10-dialog.test.tsx`, 4 open paths (gaps 0.3 / 0.75 / 3 and a locked 0.2), tol 0.5. The dialog says "1 path will close. 2 paths stay open." and the toast says "Closed 1 path. 2 paths stay open...". The locked path with a 0.2 mm gap is counted nowhere.
- Suggested fix: add "N locked paths are left as they are" to the counts and the toast.

### T10-P3-2: The two "Close by" radios have no shared `name`, so arrow keys do not move between them
- Severity: P3 (keyboard use). They are controlled, so clicking works.
- Where: `ClosePathsToleranceDialog.tsx:96-111` (no `name` on either `<input type="radio">`).
- Repro: `t10-dialog.test.tsx`: `names=["",""]`. READ ONLY for the browser's arrow-key behaviour: unnamed radios form separate groups.
- Suggested fix: `name="close-tolerance-mode"` on both.

### T10-P3-3: Test gap: arcs in move-ends, guard values, and the dialog are untested
- Severity: P3. The core suite has 3 tests (bridge, a cubic move-ends, a transformed gap) and the action suite has 1. None covers an `elliptical-arc` subpath (T10-P2-1 would have shown), 0 / NaN / Infinity on the action, a locked object, or the dialog (there is no `ClosePathsToleranceDialog.test.tsx`).
- Suggested fix: add script A's single-arc and two-arc cases with a deviation ≤ gap/2 assertion, script D's guard table, and a dialog sweep ("", "Infinity", "0", "1e308").

### Known repeats
- Large tolerances close regions the artwork never enclosed, and the dialog shows counts only, never the gap or the move distance. In move-ends the ends move tol/2 (20 mm at tol 40, script G). It never joins different subpaths or objects (script C). Same as T08-P3-1.
- Empty or invalid text shows "0 paths will close. 0 paths stay open." with the button disabled and no reason. Same as T08-P3-2.
- No typed units or comma decimals; no upper bound (`1e308` closes everything). Same as T08-P3-3.
- A gap equal to the tolerance is compared with `<=` and no epsilon. Same as T08-P3-5 (READ ONLY here).
- The command is enabled for a selection with only closed paths or a boolean compound, and the dialog opens to 0/0 with no reason. Same as T07-P3-3 (READ ONLY here).
- Closing a pen-drawn polyline shape rewrites its spec from the materialized points (`synchronizePolylineShapeGeometry` → `materializedPolylineToSpecPoints`). Same as T07-P3-2 (READ ONLY for curve-handle pens; script E shows the plain case is correct).

## Not a defect / limits
- Closing a Line (or a shared Fill+Line) path changes the Line cut (closing line, kerf and tabs now apply). That is this tool's purpose ("on any operation", per the tooltip), so it is not a repeat of T07-P3-1.
- Each subpath closes only onto its own start, never onto another subpath or object. This matches LightBurn's Close Selected Paths with Tolerance; joining is Join Paths (T30) or Auto-Join.
- Move-ends shifts the outline by at most gap/2 ≤ tol/2 for polylines, cubics and multi-arc paths (scripts A and B), so a Line cut never moves by more than the tolerance (apart from T10-P2-1).
- Tolerance 0 is accepted and closes only paths whose ends touch exactly. The button stays disabled while nothing would close. Values below 0 are refused by `min=0` / `valid`. The step is ignored on submit (ADR-690).
- Text and drawn rectangles, ellipses and polygons are excluded by `isPathEditable`. The dialog says so and the toast advises converting (READ).
- Not checked: a browser run (the brief says no browser run; about 2.6 GB free); laser/CNC tab anchors on an open contour after move-ends (READ: the anchor fraction is measured on the length plus the closing line, so a tab may shift by up to about the gap; not measured); groups selected as a group; Image-mode layers (raster objects are not path-editable, READ); a full equal-gap float sweep.

## Totals
Raised 10; P1 0; P2 1; P3 9; known 6 (T08-P3-1, T08-P3-2, T08-P3-3, T08-P3-5, T07-P3-3, T07-P3-2).
