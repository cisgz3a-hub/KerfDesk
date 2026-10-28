# Rolling audit v7 — L6 Node editing and curves

- **When:** 2026-10-28, 17:45 +0800   **Tree:** origin/main @ `47ff19d8d` (fetched at the start).
  - **Repros ran on main's tree, not the worktree.** They ran in the scratchpad copy `…\scratchpad\j7-main\`, whose source is main `6e388bb56`. `git diff --stat 6e388bb56 47ff19d8d` over `src/core/geometry`, `src/core/scene`, `src/core/cnc`, `src/io/project`, `src/ui/workspace`, `electron/mcp`, the L6 store actions and the tab resolvers is empty; only WORKFLOW (streaming text) and ADR-354 docs changed. Every file cited below hash-matches between the worktree and `origin/main`, and the 15 L6 source files used by the repros hash-match between `j7-main` and `origin/main`.
  - Command, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`.
- **Scope:**
  - Node delete and insert: `curve-node-delete.ts`, `curve-segment-edit.ts` (`insertCurveNode`, `deleteCurveSegment`, `dragCurveSegment`), `path-node-edit-actions.ts`, `path-node-edit-geometry.ts`, `path-segment-actions.ts`.
  - Smooth / Corner / Curve / Line / Start / Break: `core/scene/curve-edit.ts`, `path-node-curve-command-actions.ts`.
  - Join, drag-join and close: `core/scene/curve-join.ts`, `path-node-curve-join-plan.ts`, `path-node-drag-join-actions.ts`, `path-endpoint-join.ts`, `close-within-tolerance.ts`, `path-direction-edits.ts` (Close Path).
  - Radius / Fillet: `curve-fillet.ts`, `path-fillet-actions.ts`. Extend: `extend-shapes.ts`, `extend-ray.ts`, `extend-shapes-actions.ts`.
  - Arcs: `arc-fit/` (ADR-432), `circular-arc.ts` / `arc-representation` (read; CNC G2/G3 sampling). Cubic fit: `cubic-fit.ts` `fitCubicWithTangents` (node delete); `curve-fairing.ts` (pen fairing, KNOWN L2-P2-2).
  - Node coordinates and align: `path-node-coordinate-actions.ts`, `NodeCoordinateControls.tsx`. UI: `node-edit-keys.ts` (hover keys D I M C S L B A T E), `ToolStrip.tsx` node bar, `path-node-drag.ts`, `path-node-hit-test.ts`.
  - Convert to path: `local-path-artwork.ts`, `vector-path-conversion.ts` (read).
  - Remote/MCP: there are no node commands. The `apply_edits` list has no node, fillet, extend or join command (`electron/mcp/tool-info.ts:173`); remote `add_polyline` fairing is L2-P2-2.
- **Lenses run:** L2 ground truth (analytic radii, tangent distances, intersections, de Casteljau identity, true-circle deviation; LightBurn 1.7 Edit Nodes docs), L4 adversarial (collinear start nodes, cusps, zero-length handles, tangents along the chord, floor deletes, a 20,000-node ring, transformed objects), L3 twins (canvas display vs compile vs `.lf2` vs tab output vs arc fit), plus Undo/Redo for 16 node operations and an L7 test-truth note.
  - Not run: L9 beyond confirming MCP/phone have no node commands; browser pointer and hover-key events (the store actions they call were driven directly).
- **Counts:** 8 raised → 0 refuted → P1 1 / P2 1 / P3 6 (+ 2 KNOWN re-observed). L6-P2-2 lowered to P3 by the refuter.
  - **Refuter (2026-10-28, fresh context):** 8 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED, 0 KNOWN. Every finding was re-run with the refuter's own repros on `j7-main` (`zz-l6r-store.test.ts`, `zz-l6r-core.test.ts`, `zz-l6r-undo.test.ts`, deleted afterwards). `git diff --stat 6e388bb56 origin/main` (`47ff19d8d`) over every cited file is empty; only WORKFLOW and the ADR-354/676 docs changed. Open PRs: only #1478, which touches no node, fillet, curve or tab file.

## Headline

**The geometry of every node operation is exact where it should be.** Insert node is an exact de Casteljau / arc-angle split (1.07e-14 mm on a cubic, 7.1e-15 mm on an arc). Untouched segments keep their identity: deleting one node of a 20,000-node ring takes 17 ms and leaves 19,998 segment objects identical. Radius/Fillet, the reverse bite and Remove match analytic truth to float noise. Extend lands on the boundary exactly under a 30° / ×2 transform (0 on a line, 1.4e-14 mm on an arc). Join, drag-join and Close keep every existing point. A typed node coordinate lands exactly. All 16 node operations tested are one Undo step with an exact restore and an exact Redo. `.lf2` round-trips the edited curves byte for byte. ADR-432 arc fitting of edited curves stays inside its 0.025 mm budget (worst 0.0201 mm), and a fillet of r 5 is emitted as G2 arcs of radius 5.000.

**What is wrong is around the geometry:**

- **L6-P1-1.** **Delete node** on a closed contour's start node, and **Radius/Fillet** on its start corner, restart the contour without moving the tabs placed by hand. Each tab is a fraction of the contour measured from the start, so it burns somewhere else.
  - **Outline unchanged:** a 40 × 20 part drawn from the middle of its bottom edge. Deleting that redundant node leaves the outline identical (Hausdorff 0). The laser tab moves from (32, 0) to (40, 12) on another edge, 14.42 mm away (20 mm along the outline). The CNC tab moves from (8, 20) to (0, 8).
  - **Circle:** on a Ø50 circle the same delete moves the tabs 35.3 and 35.6 mm.
  - **Fillet:** r 5 on all corners moves a tab 12 mm along the bottom edge by 4.14 mm.
  - **No warning:** there is no toast, and tabs are drawn only while the tab tool is open. Start, Break, Delete segment and Reverse already move the tabs with the contour (ADR-494 Amendment 1).
- **L6-P2-1.** Deleting a node between two curves whose outer tangents lie along the chord flattens them into a straight line. Examples are the crest of a wave or a hump whose ends are horizontal. A 20 mm hump becomes a flat cubic on y = 0, and a 10 mm wave crest disappears. The code's own header promises that "the outline keeps its shape".
- **L6-P2-2 (refuter: now P3).** **Corner** (hover key C and the toolbar) re-aims both handles along the chords to the neighbouring nodes. On a Ø50 circle the outline moves 4.65 mm. LightBurn's Corner only makes the handle angles independent. The toolbar title states the chord alignment, and KerfDesk handles are already independent at every node, so it is a disclosed parity difference.

The P3s are:

- **L6-P3-1:** Smooth is not kept. A handle drag afterwards breaks tangency by 17.1°.
- **L6-P3-2:** Break drops the segment into the node. ADR-494 Amendment 1 decides this, but LightBurn's B only opens the path.
- **L6-P3-3:** some node commands are silent no-ops: Delete below the floor, and Smooth/Corner at a node with a straight side.
- **L6-P3-4:** **M** inserts at t = 0.5. On an asymmetric cubic that is 38.7 % of the length.
- **L6-P3-5:** with an anchor and its own handle both selected, a nudge or typed coordinate moves the handle twice.

## Accuracy

Deviation is the Hausdorff distance between the dense-sampled curves (1,200–6,000 samples per segment), unless stated. "Kappa circle" is the four-cubic circle with handles at 0.5523 r, which the Ellipse tool also uses.

**Refuter spot-check: the headline holds.** These are the refuter's own numbers (`zz-l6r-core.test.ts`, `zz-l6r-undo.test.ts`):
- **Insert node**, kappa circle r 25, segment 1 at t 0.37: both halves match the original cubic at the mapped parameter within **1.8e-14 mm** over 1,001 samples. There are 5 nodes, and the other three segments are the same objects.
- **Radius/Fillet r 5** on a 40 × 20 rectangle: 4 `elliptical-arc` segments with radius 5 / 5. The start is (5, 0). Every flattened arc point (394 per corner) lies 5 from its centre, (5, 5), (35, 5), (35, 15) or (5, 15), within **4.4e-15 mm**.
- **Undo/Redo**, under a 30° / ×1.5 transform: delete node, delete start node, Corner, Radius/Fillet, insert at midpoint and nudge. Each is one step. Undo restores the scene byte for byte (JSON-equal), and so does Redo.
- **Also reproduced:**
  - Delete node on a kappa circle: 0.3346 mm.
  - Corner on a kappa circle: 4.6520 mm, with the true-circle deviation going from 0.0068 to 4.6480 mm.
  - Midpoint key: node (6.875, 22.5), at 38.70 % of the 66.044 mm length.

| Operation | Input | Expected | KerfDesk | Max deviation | Verdict |
|---|---|---|---|---|---|
| Insert node (I) | kappa circle r 25, segment 1 at t 0.37 | same curve, one more node | exact split, 5 nodes; other 3 segments identical refs | 1.07e-14 mm (parameter-matched) | exact |
| Insert node (I) | 4-arc circle r 25, segment 2 at t 0.5 | same arc | two arcs; new node (−17.678, −17.678) | 7.1e-15 mm from r | exact |
| Delete node (D), lines | 40 × 20 rectangle, corner | chord | `line` to the next corner | 0 | exact |
| Delete node (D), curves | kappa circle r 25, node 1 | one cubic over 180° | 3 cubics; untouched 2 identical refs | 0.335 mm (0.336 from the true circle) | approximation, as designed |
| Delete node (D) | 4-arc circle r 25, node 1 | one cubic over 180° | cubic + 2 arcs | 0.335 mm | as designed |
| Delete node (D) | 30 mm line + r 25 quarter cubic | one cubic | cubic | 0.581 mm | as designed |
| Delete node (D) | inflected wave (crest/trough tangents oblique) | one cubic | cubic | 1.066 mm | as designed |
| Delete node (D) | hump (0,0)→(20,20)→(40,0), end tangents horizontal | outline "keeps its shape" (code header) | cubic with every control point on y = 0; bounds maxY 0 | **20.000 mm** (wave crest 10.000 mm) | **L6-P2-1** |
| Delete start node (D) | 40 × 20 part from (20, 0), collinear node 0 | outline and tabs unchanged | outline unchanged; start (40, 0); laser tab (32,0)→(40,12), CNC (8,20)→(0,8) | outline 0; **tabs 14.42 mm** | **L6-P1-1** |
| Delete start node (D) | kappa circle r 25 with tabs | tabs in place | tabs re-measured from node 1 | **35.34 / 35.61 mm** | **L6-P1-1** |
| Radius/Fillet, all corners | 40 × 20 from (0,0), r 5, tab at 12 mm | tab in place | start (5, 0); tab (12,0)→(16.137,0); CNC (28,20)→(23.863,20) | **4.14 mm** | **L6-P1-1** |
| Radius/Fillet, one corner picked | same, node 2 | tab in place | perimeter shrinks | 0.22 / 0.86 mm | reshape: tabs keep their fraction, as ADR-494 Amd 1 Consequences accepts for reshapes (refuter: not part of the P1) |
| Insert node with tabs | kappa circle r 25 | tabs in place | — | 0.0001 / 0.0005 mm (flattening noise) | clean |
| Smooth (S) | cusp, handles 45° apart | G1 at the node, handle lengths kept | turn −1.2e-15°; lengths 9.434 / 9.220 kept | outline moves 3.42 mm (intended) | exact |
| Smooth, then drag a handle | same | handles stay at one angle (LightBurn) | only the dragged handle moves | **17.1° kink** | L6-P3-1 |
| Corner (C) | kappa circle r 25, node 1 | handle angles become independent; no shape change (LightBurn) | both handles re-aimed along the chords | **4.65 mm** | **L6-P2-2** |
| Radius/Fillet, round | 40 × 20, r 5 | 4 arcs r 5, centres (35,5)…, 90°, tangent 5 mm from each corner | exactly that; start (5, 0) | ≤ 1e-15 mm | exact |
| Radius/Fillet, round | 60° corner, r 3 | tangent distance r / tan 30° = 5.196152; centre 3 from both lines | 24.803848 → 5.196152; 3 and 3 | 4e-16 mm | exact |
| Radius/Fillet, reverse | 60° corner, r 3 | arc centred on the corner, r 3, 60° | (30, 0), r 3, −60° | 0 | exact |
| Remove fillet | the r 5 result | the original rectangle and start | identical | 0 | exact |
| Radius/Fillet too large | r 10.5 on a 20 mm side | skipped with a message | null + toast | — | clean |
| Extend (E) → line | line at 30°, ×2, ray to x = 150 | (150, 128.867513459481) | (150, 128.86751345948127) | 0 | exact |
| Extend (E) → arc circle | centre (160,140), r 15 | on the circle | `|d − r|` 1.4e-14 mm | 1.4e-14 mm | exact |
| Extend (E) → kappa circle | same, four cubics | on the drawn cubic | 0.000129 mm from the true circle (the cubic's own error) | 0 to the boundary | exact |
| Extend (E), curved end | cubic ending along (1, 0) | tangent line appended | `line` to (40, 8) | 0 | exact |
| Close With Tolerance, move ends | gap 0.36 mm, tolerance 0.5 | both ends to the midpoint (dialog text) | both ends move 0.18 mm | 0.18 mm, as stated | clean |
| Close With Tolerance, bridge / Close Path / Join / drag-join | open contours | every point kept; one line across the gap; drag snaps exactly | same | 0 | exact |
| Node coordinate X | node of a circle at 30°, ×1.5 | X 33.333 | 33.333 | 0 | exact |
| Midpoint (M) | asymmetric cubic, length 66.04 mm | "halfway point between two nodes" (LightBurn) | t = 0.5, at 38.7 % of the length | 7.5 mm along the curve | L6-P3-4 |
| Arc fit (ADR-432) | kappa circle r 25 | ≤ 0.025 − 0.001 − 0.002 − chord sag | 2 arcs + 1 line | 0.0149 / 0.0153 mm | clean |
| Arc fit | circle after Delete node | same | 9 arcs | 0.0198 / 0.0201 mm | clean |
| Arc fit | fillet r 5 rectangle | same | 4 lines + 4 arcs, radii 5.0000 | 1e-6 / 0.0152 mm | clean |
| Arc fit | 4-arc circle r 25 | same | 2 arcs r 25.0000 + 1 line | 5e-6 / 0.0038 mm | clean |

## Findings

### L6-P1-1 — Delete node at a contour's start, and Radius/Fillet at its start corner, restart the contour without moving the tabs placed by hand: on an unchanged outline a laser tab burns 14.4 mm away, on another edge, with no warning

- **Where:**
  - `src/ui/state/path-node-edit-actions.ts:127-156` (`deleteSelectedPathNodes`) and `:210-222` (`deleteObjectNodes`) return the edited paths with the object's `laserTabAnchors` / `cncTabAnchors` untouched.
  - `src/core/geometry/curve-node-delete.ts:61`: `return { start: anchors[kept[0] as number] as Vec2, … }`. Deleting node 0 of a closed contour restarts it at the next kept node.
  - `src/ui/state/path-fillet-actions.ts:79-94` keeps the object's anchors. `src/core/geometry/curve-fillet.ts:257-260`: when the corner is the start, "it now begins where the arc ends".
  - **Siblings that do follow tabs:**
    - Start: `withRestartedTabs` (`path-node-curve-command-actions.ts:56-57,135-146`).
    - Break: `withBrokenTabs` (`:61,153-164`).
    - Delete segment: `path-segment-actions.ts:139-167`.
    - Reverse: `path-cleanup-actions.ts:189-208`.
    - Convert to Path: `vector-path-conversion.ts`.
  - **Output reads the fraction from the new start:**
    - `placedTabPointsForContour` → `laserTabAnchorPosition` (`src/core/job/laser-tab-anchors.ts:109-124`);
    - `cncTabAnchorPosition` (`src/core/cnc/cnc-tab-anchors.ts:67-75`: `pointAtFraction(polyline, anchor.pathT)` on the curve-flattened contour, `:399-408`).
- **Anchor:**
  - **Contract:** ADR-494 Amendment 1, Context (`ADR-494-amendment-1-…md:16-17`): "Any command that changes where a contour starts, which way it runs, or which object carries it must keep each tab at the same physical place, or deliberately handle it." Decision 3 handles Start and Break only.
  - **Contract:** WORKFLOW F-A7c item 4 (`WORKFLOW.md:1123-1125` on main): placed tabs "move, rotate and scale with the artwork", and Reverse Direction and Edit nodes Start "keep them where they were on the shape".
  - **Twin:** Start on the same node keeps every tab within 1e-9 mm (`path-node-curve-command-tabs.test.ts`).
- **Scenario:**
  1. A traced or imported 40 × 20 part is drawn from the middle of its bottom edge. A collinear node there is common in SVG exports, or appears after the user has used Start.
  2. The user places a laser tab 12 mm along from the start, at (32, 0), and a CNC tab at (8, 20).
  3. In Edit Nodes, the user hovers that redundant node and presses **D**.
  4. The outline is unchanged. Both tabs now burn on other edges, (40, 12) and (0, 8), and no message appears.
  5. The same happens on any closed contour whose start node is deleted (a Ø50 circle: 35 mm). A Radius/Fillet that rounds the start corner moves every tab by the tangent distance plus the perimeter change (r 5: 4.14 mm).
- **Evidence:** REPRO, `…\scratchpad\j7-main\src\ui\state\zz-l6-store.test.ts` ("hand-placed tabs …"), real store actions, positions from the output resolvers:
  - `tabs-delete-start-node {"before":{"laser":[{"x":32,"y":0}],"cnc":[{"x":8,"y":20}]},"after":{"laser":[{"x":40,"y":12}],"cnc":[{"x":0,"y":8}]},"moved":{"laser":[14.4222],"cnc":[14.4222]},"start":{"x":40,"y":0},"anchors":[{…"pathT":0.1}],"undo":1,"toast":null}`;
  - core: `delete-collinear-start {"start":{"x":40,"y":0},…,"hausdorff":0}` (`zz-l6-core.test.ts`);
  - `tabs-delete-circle-start {"moved":{"laser":[35.3411],"cnc":[35.6107]}}`;
  - `tabs-fillet {"before":{"laser":[{"x":12,"y":0}],"cnc":[{"x":28,"y":20}]},"after":{"laser":[{"x":16.13654849054594,"y":0}],"cnc":[{"x":23.86345150945408,"y":20}]},"moved":{"laser":[4.1365],"cnc":[4.1365]},"start":{"x":5.000000000000001,"y":0},"toast":"Rounded 4 corners."}`;
  - one picked corner (start unchanged, perimeter shorter): `tabs-fillet-one-corner {"moved":{"laser":[0.2159],"cnc":[0.8635]}}`;
  - controls: `tabs-delete-mid-node {"moved":{"laser":[0],"cnc":[0]}}`; `tabs-insert {"moved":{"laser":[0.0001],"cnc":[0.0005]}}`.
- **Severity:** P1 (AREAS design rule). An edit moves output the user did not touch (a tab, which leaves the part attached or bridged), with no warning. The tabs are drawn only while the tab tool is open (`draw-scene.ts:255-262`), and Job Review counts placed tabs without placing them. Precedent: F3-P1-1 (tab plan mismatch, P1). The case where the outline is identical is the clearest: nothing on screen changes, but the burn does.
- **Novelty:** new. ADR-494 Amd 1 (audit E-3) fixed Start and Break. Delete node and Radius/Fillet are not named there, nor in `docs/audits/**` (grep: tab / Delete node / fillet).
- **L7:** `curve-node-delete.test.ts:137-152` pins the restart ("moves its start past a deleted start anchor"). `path-fillet-actions.test.ts` and `path-node-edit-actions.test.ts` have no tab case.
- **Fix direction:**
  - After Delete node and Radius/Fillet, re-project each placed tab's old world position onto the edited contour. `materializedTabAnchors` (`core/geometry/materialized-tab-anchors.ts`) already does this for Convert to Path.
  - Or restart-follow the way `withRestartedTabs` does when only the start moves.
  - Add the two store cases to `path-node-curve-command-tabs.test.ts`.
- **Refuter: CONFIRMED, P1 kept.**
  - **What would refute it:**
    - an ADR that lets Delete node or Radius/Fillet restart a contour without re-measuring its tabs;
    - a warning that reaches the operator before output;
    - output that ignores the stale fraction;
    - the case being unreachable.
  - **ADRs.**
    - ADR-494 Amd 1 Consequences exempts only reshapes ("Smooth, Corner, and Curve or Line on a segment (Edit nodes), like dragging a node or a handle, keep each tab's fraction") and leaves them "to a deliberate remap (ADR-156)". A restart is not a reshape: its Context requires a command that changes where a contour starts to "keep each tab at the same physical place, or deliberately handle it".
    - ADR-156 Consequences (`DECISIONS.md:7852-7853`): "a future topology-changing editor must deliberately remap or invalidate them rather than guessing."
    - No ADR covers Radius/Fillet; it came in commit `1cc361c57` with no ADR.
    - The one-picked-corner fillet shift (0.22 / 0.86 mm) is a pure reshape, which those Consequences accept, so the refuter takes it out of the P1 (Accuracy table). The P1 rests on the restart.
  - **Own repro: real store and real compile.** `zz-l6r-store.test.ts`, with the part at transform (100, 100):
    - **Laser G-code (GRBL, tab power 20 %).** Before Delete node, the tab span is `G0 X131.000 Y300.000` then `G1 X133.000 Y300.000 … S100`, on the bottom edge. After it, the span is `G0 X140.000 Y289.000` then `G1 X140.000 Y287.000 … S100`, on the right edge. The span midpoint moves **14.4222 mm**.
    - **CNC (profile on path, tab 6 × 2 mm).** The deepest pass's tab rise moves from (112.59, 280) to (100, 287.41), **14.61 mm**. The resolvers give 14.4222 for both laser and CNC, exactly as reported.
    - **Polylines too.** The same delete on a path with no canonical curves also restarts at (40, 0) and moves the laser tab 14.4222 mm.
    - **Circle and fillet.**
      - Kappa circle r 25, tabs at 0.3 / 0.7: the resolvers move them **35.39 / 35.20 mm**, and the laser G-code midpoint moves 35.37 mm.
      - Fillet r 5 on all corners: the start goes to (5, 0), and the laser G-code midpoint and the CNC rise both move **4.1365 mm**.
    - **No warning.** Delete node pushes no toast. The fillet's only toast is "Rounded 4 corners.". Undo is one step.
  - **Twin confirmed.** On the same part, each of these leaves every laser and CNC tab exactly in place (0 mm):
    - Start at node 2;
    - Break then Close Path;
    - Reverse;
    - Delete segment then Close Path.

    Two other edits handle tabs deliberately:
    - Extend drops them and toasts "Placed tabs on the extended contour were removed. Undo restores them." (`extend-shapes-actions.ts:85-107`).
    - Trim remaps them (`trim-shapes-actions.ts:120-125`).

    Delete node and Fillet are the only path edits seen that restart a contour and neither remap nor tell.
  - **Display.** Placed tabs are drawn only while a tab tool is open (`draw-scene.ts:255-263`). Under this round's rule the canvas and the Preview are not warnings, so the P1 stands.

### L6-P2-1 — Delete node between two curves whose outer tangents lie along the chord (a hump, a wave crest) flattens them to a straight line: a 20 mm hump vanishes

- **Where:**
  - `src/core/geometry/curve-node-delete.ts:99-115`: `fittedCubic` keeps the two outer tangent directions and fits only the handle lengths.
  - `src/core/geometry/cubic-fit.ts:87-107`: `fitCubicWithTangents` returns its best cubic whatever its error. `errorSq` is compared only between passes, never against a tolerance.
  - When both outer tangents are along the chord, every control point lies on the chord, so no handle length can bulge. The header (`curve-node-delete.ts:3-6`) says the fit is made "so the outline keeps its shape".
  - ADR-371 Decision 1 says only that the single-cubic fit "cannot split".
- **Anchor:**
  - **Contract:** the module's own stated intent (`curve-node-delete.ts:3-6`), a code comment cited as its own line.
  - **Ground truth:** LightBurn 1.7 Edit Nodes, D on a node: "Delete nodes and combine adjacent lines" (https://docs.lightburnsoftware.com/1.7/Reference/EditNodes/, fetched 2026-10-28). Combining curves, not erasing them, is the documented intent.
  - **L2:** a single cubic whose control polygon is collinear is a line segment.
- **Scenario:**
  1. An imported wave border or scalloped edge has nodes at its troughs and crests with horizontal tangents (the usual SVG and font convention of nodes at extrema).
  2. The user deletes one crest node to simplify the path.
  3. That crest becomes a straight line on the trough line, 10 mm lower in the repro.
  4. For a lone hump the whole 20 mm rise is gone. Any other node delete stays within about 1 mm.
- **Evidence:** REPRO.
  - Core (`zz-l6-core.test.ts`):
    - `delete-S-node {"kinds":["cubic"],"hausdorff":20}`;
    - `hump-and-wave {"hump":[{"kind":"cubic","control1":{"x":13.899…,"y":0},"control2":{"x":26.100…,"y":0},"to":{"x":40,"y":0}}],"waveFirst":{…"control1":{"x":6.888…,"y":0},"control2":{"x":13.111…,"y":0},"to":{"x":20,"y":0}},"waveHausdorff":10}`.
  - Store (`zz-l6-store.test.ts`): the same flat cubic, `"bounds":{"minX":0,"minY":0,"maxX":40,"maxY":0}`, and no toast of its own.
  - Contrast: a circle node 0.335 mm, line + curve 0.581 mm, an oblique wave 1.066 mm.
- **Severity:** P2. The shape on screen visibly collapses, canvas, file and burn agree, and Undo restores it.
- **Novelty:** new. `curve-node-delete.test.ts:64-87` ("keeps a broad arch") uses oblique end tangents; no test has tangents along the chord.
- **Fix direction:**
  - Bound the fit: when the single cubic misses the removed segments by more than a small share of their extent, fall back.
    - Option 1: let the end tangents rotate.
    - Option 2: keep two cubics through the best interior point.
    - Option 3: refuse with a message naming the node.
  - Add a hump / wave-crest case to `curve-node-delete.test.ts`.
- **Refuter: CONFIRMED, P2 kept, with one anchor correction.**
  - **What would refute it:**
    - an ADR that accepts the flattening;
    - LightBurn documenting the same result;
    - an unusual shape.
  - **ADR.** ADR-371 Decision 1 says only that the single-cubic, fixed-tangent node-delete fit "cannot split" and keeps its least-squares arms. It does not accept a flattened result.
  - **LightBurn.** The 1.7 and 2.0 Edit Nodes pages (re-fetched 2026-10-28) say only "Delete nodes and combine adjacent lines". They are silent on curve shape, so the LightBurn ground truth is **UNVERIFIED** for curves.
    - A LightBurn-style reconnect through the outer handles would also lie flat on this hump, because its outer handles are horizontal.
    - The finding therefore rests on two things: KerfDesk's own stated intent (`curve-node-delete.ts:3-6`), whose header calls the naive reconnect the thing to avoid, and the visibly wrong result.
  - **Own repro** (`zz-l6r-core.test.ts`, the refuter's own shapes):
    - **Hump.** A bell hump (0,0)→(20,20)→(40,0) with horizontal end handles becomes a cubic whose controls are (13.777, 0) and (26.222, 0). Hausdorff **20.000 mm**, maxY 0.
    - **Wave.** A 3-segment wave with every node at an extremum loses its first crest: control points on y = 0, Hausdorff **10.000 mm**.
    - **Controls.**
      - An arch with oblique end handles: 0.311 mm.
      - A kappa circle node: 0.335 mm.
  - **Reach.** Nodes at extrema are the usual SVG convention, so deleting a wave crest is an ordinary edit. The result is visible and Undo restores it, so it stays P2, not P1.

### L6-P2-2 (refuter: now P3, disclosed) — Corner (hover key C and the toolbar) re-aims both handles along the chords, reshaping the curve: 4.65 mm on a Ø50 circle, where LightBurn's Corner only unlinks the handle angles

- **Where:**
  - `src/core/scene/curve-edit.ts:125-163` (`cornerCurveNode`) sets the incoming handle along (previous node − anchor) and the outgoing handle along (next node − anchor), keeping their lengths.
  - It is bound to the hover key **C** (`src/ui/workspace/node-edit-keys.ts:1-7,59-62`, introduced as "LightBurn's Edit Nodes hover keys … C corner node").
  - The toolbar's **Corner** has the title "Align handles to the adjoining chords" (`ToolStrip.tsx:133`).
- **Anchor:** **Ground truth:** LightBurn 1.7 Edit Nodes (URL above), C on a smooth node: "Convert node to corner (curve handles will have independent angles)". The node type changes; the curve does not. KerfDesk's own hover-key header claims that table.
- **Scenario:**
  1. On a curve imported from SVG (or a traced curve), the user presses **C** over a smooth node, so that they can then pull one handle on its own as in LightBurn.
  2. Both adjoining segments jump toward their chords before anything is dragged. On a Ø50 circle the outline moves 4.65 mm, and the true-circle deviation goes from 0.0068 mm to 4.648 mm.
  3. Only the segments touching the node change; the others stay identical.
- **Evidence:** REPRO.
  - `zz-l6-core.test.ts`: `corner-circle-node {"hausdorffVsSource":4.651973872055956,"trueCircleDevAfter":4.648009589809028,"untouchedSame":[true,true]}`.
  - Store Corner: one Undo step, exact restore (`undo-redo` row `corner`).
- **Severity:** P2, a visible wrong behaviour against the documented LightBurn semantics that the key claims. A refuter may lower it to P3, because the toolbar title discloses the toolbar's behaviour, the change is visible and Undo restores it. The hover key has no such text.
- **Novelty:** new. The 2026-10-07 xTool report lists Smooth/Corner as existing (baseline only).
- **Fix direction:**
  - Make Corner a type change: mark the node as corner and leave the handles where they are.
  - Keep the chord alignment as a separate, named command if wanted ("Straighten handles").
  - Together with L6-P3-1, this needs a stored node type.
- **Refuter: CONFIRMED, lowered to P3.**
  - **Own repro.** `cornerCurveNode` on a kappa-circle node moves the outline **4.6520 mm**, and the true-circle deviation goes from 0.0068 to 4.6480 mm. The other two segments are the same objects, and the Corner is one exact Undo step.
  - **LightBurn.** The 1.7 and 2.0 C rows were re-fetched and quoted correctly.
  - **Why P3.**
    - **The toolbar discloses it.** The button's title "Align handles to the adjoining chords" (`ToolStrip.tsx:133`) states exactly what it does, so the toolbar route is the intended behaviour, not a misleading result.
    - **The help text is met.** The node tool's help says the hover keys work "as in LightBurn" and that "C and S make a node corner or smooth" (`help-topics.ts:94`). After C the node is a corner.
    - **LightBurn's C would do nothing here.** KerfDesk stores no node type, and every handle already moves on its own (`moveCurveControl`, L6-P3-1). LightBurn's C is a type change, so in KerfDesk it would be a no-op, and no LightBurn workflow needs it before an independent handle drag.
    - **No harm reaches output unseen.** The change is immediate and visible, and the canvas, the file and the burn agree. Undo restores it.
  - **What remains.** A parity gap with no ADR, best fixed with L6-P3-1's stored node type. Name the toolbar action "Straighten handles", or have the help text say what C does.

### L6-P3-1 — Smooth is not kept: dragging one handle of a smoothed node afterwards breaks tangency (17.1° in the repro)

- **Where:**
  - `src/core/scene/curve-edit.ts:94-123` (`smoothCurveNode`) aligns the two handles once.
  - `moveCurveControl` (`:59-77`), used by every handle drag and nudge (`path-node-edit-geometry.ts:158-172`), moves only the dragged handle.
  - No node type is stored (`CurveSubpath` has segments only).
- **Anchor:** **Ground truth:** LightBurn 1.7 Edit Nodes: S, "Convert node to smooth (curve handles will have same angle)".
- **Evidence:** REPRO, `zz-l6-core.test.ts`.
  - Smooth on a cusp gives `handleTurnDeg -1.17e-15` with both handle lengths kept (exact).
  - Then `moveCurveControl(…, 'outgoing', (26,-3))` gives `smooth-then-handle-drag {"turnDeg":-17.10272896905237}`.
- **Severity:** P3. It is visible and needs a stored node type to fix.
- **Fix direction:**
  - Store a per-node smooth/corner flag.
  - On a smooth node, rotate the opposite handle to keep it collinear, as LightBurn and Inkscape do.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro, own cusp.** The cusp is (0,0) (5,5) (12,5) (20,0) and then (29,2) (35,5) (40,0).
    - Smooth leaves a 0° turn at the node.
    - `moveCurveControl` of the outgoing handle to (26, −3) then gives a **−16.6°** kink.
  - **Code.** No node type is stored.
  - **LightBurn.** The docs do not say whether a smooth node stays smooth while a handle is dragged (re-fetched 2026-10-28). The "Inkscape does" part was not checked.

### L6-P3-2 — Break on a closed contour removes the segment that leads into the node, so B is the same edit as D on that segment; LightBurn's Break only opens the path

- **Where:**
  - `src/core/scene/curve-edit.ts:177-185`: `breakCurveAtNode` restarts at the node and drops the last segment (`rotated.segments.slice(0, -1)`).
  - The toolbar title is "Break the closed path open at this node" (`ToolStrip.tsx:183`).
  - `deleteClosedSegment` is documented as "deleting a segment is Break at the node it ends on" (`path-segment-actions.ts:121-122`).
- **Anchor:**
  - **Contract:** ADR-494 Amendment 1, Decision 3: "Break opens the contour at the node by removing the segment that leads into it, a line or a curve". WORKFLOW F-A7c item 4 says the same.
  - **Ground truth:** LightBurn 1.7 Edit Nodes, B on a node: "Open path at node".
- **Scenario:** Break at a corner of a rectangle (to cut it as an open path, or to add a lead) removes one whole side. The canvas shows it, and Undo restores it.
- **Evidence:** READ, plus REPRO of one-step Undo (`undo-redo` row `break-closed`).
- **Severity:** P3. An ADR decides it, and the result is visible. Raised as a LightBurn-parity improvement: an open-at-node Break that keeps all geometry, with the existing behaviour left to Delete segment.
- **Fix direction:** make B on a closed contour restart at the node and open the path with both ends at the node, keeping every segment. Amend ADR-494 Amd 1 D3's tab rule to match (the closing line becomes zero length).
- **Refuter: CONFIRMED, P3 kept.**
  - **Code.** `breakCurveAtNode` uses `slice(0, -1)`.
  - **ADR.** ADR-494 Amd 1 Decision 3 decides it, so it is not P2.
  - **LightBurn.** The re-fetched 1.7 and 2.0 B row adds a method note, "move one of the nodes to reveal the gap". That supports the parity reading: LightBurn keeps both ends coincident and every segment.
  - **The open-path Break already keeps every segment.** `breakOpenSelectedCurve` splits an open path in two, so the closed-path Break is the odd one out.

### L6-P3-3 — Silent no-ops: Delete below the node floor, and Smooth/Corner at a node with a straight side, change nothing and say nothing

- **Where:**
  - `path-node-edit-geometry.ts:117` returns null when any contour would fall under 2 (open) / 3 (closed) nodes, and `deleteSelectedPathNodes` then returns `state` (`path-node-edit-actions.ts:147`).
  - `smoothCurveNode` / `cornerCurveNode` return null unless both sides are cubics (`curve-edit.ts:100,133-145`).
  - `mutateSelected` returns `state` (`path-node-curve-command-actions.ts:122`). No toast is pushed on any of these paths.
- **Evidence:** REPRO (`zz-l6-store.test.ts`):
  - `delete-floor {"unchanged":true,"toast":null,"selection":2}`;
  - `smooth-line-node {"unchanged":true,"toast":null}`;
  - `corner-line-node {"unchanged":true,"toast":null}`;
  - core: `smooth-line-cubic {"smooth":null,"corner":null}`.
- **Anchor:** **Twin:** Join, Fillet and Extend name every refusal in a toast (`path-node-curve-join-plan.ts:255-268`, `path-fillet-actions.ts:97-111`, `extend-shapes-actions.ts:111-124`).
- **Severity:** P3 (polish). Nothing is lost.
- **Fix direction:**
  - A toast for each refusal: "a closed path keeps at least 3 nodes"; "Smooth needs curves on both sides; press S on the line to make it a curve first".
  - Or, as LightBurn's S does on a line segment, convert the straight side first.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro.**
    - Delete node on a 3-node closed triangle: the object is unchanged and there are 0 toasts.
    - Smooth, then Corner, at a node between two lines: unchanged, 0 toasts.
  - **Also.** The toolbar's Smooth and Corner buttons are never disabled (`ToolStrip.tsx:128-133`). Curve, Line and Start are disabled when they cannot act (`:137,143,149`), so the toolbar also gives no cue.

### L6-P3-4 — M (insert at midpoint) splits a curve at t = 0.5, not at half its length: 38.7 % along an asymmetric cubic

- **Where:** `src/ui/state/path-segment-actions.ts:64-65`: `at === 'midpoint' ? 0.5 : …`, then `insertCurveNode` at that parameter.
- **Anchor:** **Ground truth:** LightBurn 1.7 Edit Nodes: M, "Insert node at the halfway point between two nodes".
- **Evidence:** REPRO, `zz-l6-core.test.ts`: a cubic (0,0) (0,30) (5,30) (40,0) of length 66.04 mm gives `midpoint-key {"node":{"x":6.875,"y":22.5},"shareOfLength":0.387…}`, 7.5 mm short of halfway. On lines and symmetric curves t = 0.5 is the halfway point.
- **Severity:** P3. The split itself is exact and the result is visible.
- **Fix direction:** for cubics and arcs, solve t at half the arc length (arcs: half the angle, which `subSegment` already handles).
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro.** On the same cubic, `insertCurveNode(…, 0.5)` puts the node at (6.875, 22.5). That is **38.70 %** of the 66.044 mm length.
  - **Second contract.** The toolbar's Insert title says "Insert a node halfway along the outgoing segment (M over any segment)" (`ToolStrip.tsx:191`).

### L6-P3-5 — With an anchor and its own handle both selected, a nudge, drag or typed coordinate moves the handle twice

- **Where:**
  - `path-node-edit-geometry.ts:147-154`: `editCurvePathByDelta` applies every ref in turn.
  - `moveCurveAnchor` already carries the anchor's handles by the delta (`curve-edit.ts:34-57`), and the handle ref then moves that handle by the delta again.
  - Shift-click can select a selected anchor's handle (`path-node-hit-test.ts:110-125`, `selectPathNode` additive).
- **Evidence:** REPRO, `zz-l6-store.test.ts`. Nudge (1, 0) gives `anchor-plus-handle-nudge {"selected":2,"anchor":{"x":1,"y":25},"outgoingControl1":{"x":-11.807…,"y":25},"before":{"anchor":{"x":0,"y":25},"control1":{"x":-13.807…,"y":25}}}`: the anchor moves 1, its handle 2.
  - **Typed coordinate (READ):** the primary is the last ref, the handle (`path-node-coordinate-actions.ts:38-46`, `path-node-edit-actions.ts:227-252`). A typed handle X therefore lands one delta past the typed value.
- **Anchor:** **Contract:** the coordinate field's tooltip, "Moves all selected nodes by the same distance" (`NodeCoordinateControls.tsx:132`).
- **Severity:** P3. It is reachable only by shift-selecting a node and its own handle, and the field then shows the true new value.
- **Fix direction:** drop handle refs whose anchor is also selected before applying a delta.
- **Refuter: CONFIRMED (typed coordinate now REPRO), P3 kept. The drag is worse than reported.**
  - **Reachable.** `path-node-drag.ts:38-39` and `selectPathNode` let Shift-click add a selected anchor's own handle (`path-node-hit-test.ts:111-128`).
  - **Own repro** (`zz-l6r-store.test.ts`, kappa circle r 25, anchor 1 plus its outgoing handle):
    - **Nudge.** A nudge of (1, 0) moves the anchor 1 and the handle 2.
    - **Typed X.** Typed −10 (local) for the primary handle, it lands at **−6.193**: one delta (3.807) past the typed value.
    - **Live drag.** `setSelectedPathNodePositionDuringInteraction` works from the current state on each pointer event. Held at one target, (−12, 30) local:
      - the first event puts the handle at (−10.19, 35);
      - the next puts it back at (−13.81, 25).

      The handle alternates and never sits under the pointer, so a drag jitters visibly.
  - **Why P3.** It stays P3: the selection is unusual, the result is visible and Undo restores it.

## KNOWN re-observed

- **L2-P2-2 (P2, open).** Pen-drawn paths with 4 or more open / 5 or more closed points arrive as fitted cubics, so Edit Nodes shows fewer nodes than were clicked and smooth handles at the click points. Node editing then works on those cubics: deleting a node of a faired pen path runs the single-cubic fit above. Not re-raised.
- **L1-P3-1 (P3, open).** Boolean, Weld and Offset results are chords only, so Edit Nodes on a welded circle shows dozens of line nodes and Smooth/Corner have nothing to act on (L6-P3-3's silent no-op). Not re-raised.

## Refuted

- **Insert node changes the curve.** Refuted: an exact de Casteljau / arc-angle split (1.07e-14 mm, 7.1e-15 mm), and tabs move only by flattening noise (0.0005 mm).
- **A node edit shifts the whole object because the transform pivots on the bounds.** Refuted. `applyTransform` scales, mirrors and rotates about the local origin (`core/scene/transform.ts:10-21`), so a bounds change moves nothing else.
- **Reopening a node-edited pen shape re-fairs it from `spec.points`.** A node edit writes the 0.05 mm compatibility polyline into `spec.points` (`path-node-shape-sync.ts:24-31`). Refuted for load: `src/io` never calls `createPolyline`. The fairing upgrade runs only for a missing or older `fairingVersion` (`polyline-fairing-upgrade.ts:36-42`), and node edits keep the stamp. `.lf2` round trip: curves and polylines byte-equal.
- **The 0.05 mm compatibility polylines reach output.** Refuted. Compile flattens the canonical curves at 0.025 mm in machine space (`compilation-polylines.ts:20-33`, ADR-453), the canvas flattens the curves per zoom bucket (`display-polylines.ts:92-104`), and tab positions flatten the curves at 0.025 mm (`cnc-tab-anchors.ts:399-408`).
- **Close With Tolerance moves ends without saying so.** Refuted. The dialog option reads "Close each gap by moving both ends to their midpoint" (`ClosePathsToleranceDialog.tsx:106`). The move is half the gap and bounded by the typed tolerance (0.18 mm for 0.36). Wider gaps are counted in the toast.
- **Arc fit of node-edited curves exceeds the machine tolerance.** Refuted: worst 0.0201 mm against a ≤ 0.022 mm fit budget, and fillet arcs are emitted at radius 5.0000.
- **Break losing a segment as P1.** Not P1. ADR-494 Amd 1 D3 and WORKFLOW F-A7c decide it, and it is visible. Kept as the parity P3 L6-P3-2.

## Verified clean

- **Untouched segments stay bit-exact.**
  - Delete node, insert node and Corner keep every other segment as the same object (identity checks).
  - On a 20,000-node ring, deleting one node leaves 19,998 identical segment objects in 17 ms.
  - `mutateObjectCurve` replaces only the edited curve; the others are reused (`path-node-curve-command-actions.ts:217-245`).
- **Undo/Redo** for 16 operations is one step, with an exact restore and an exact Redo (`undo-redo` row in `zz-l6-store.test.ts`): delete node, insert, midpoint, Corner, Smooth, drag-join, to-line, Start, Break (closed and open), delete segment, Join-close, Radius/Fillet, typed coordinate, align, nudge. Extend is one step (`undo: 1`).
- **Fillet / reverse / remove** match analytic truth to ≤ 1e-15 mm. A corner too short for the radius is skipped with a toast. A non-uniformly stretched object is refused with a toast (`path-fillet-actions.ts:51-54`).
- **Extend** lands on the boundary for a line, an exact arc and a kappa circle, under a 30° / ×2 placement, and appends a tangent line at a curved end.
- **Join / Close / drag-join** keep every point. A gap becomes one line, and the drag snaps the dragged end exactly onto the target (`path-node-drag-join-actions.ts:78-97`).
- **Typed node coordinates** are exact under rotation and scale (33.333).
- **Twins:**
  - canvas, compile and tab output all read the canonical curves;
  - `.lf2` round-trips the edited curves and the fillet arcs (4 elliptical arcs, centre (35, 5));
  - arc fitting stays within budget.
- **Remote/MCP:** no node, fillet, extend or join command (`electron/mcp/tool-info.ts:173`). The phone has no node tools.
- **Convert to Path** keeps the curves, the transform and the tabs (`local-path-artwork.ts:9-26`, `vector-path-conversion.ts:8-12`).

## Not verified

- **Browser:** hover keys and pointer drags were not driven through real canvas events. The store actions they call (`node-edit-keys.ts:31-95`) were.
- ~~**G-code for L6-P1-1:** tab positions were read through `laserTabAnchorPosition` / `cncTabAnchorPosition`, the resolvers `placedTabPointsForContour` and the CNC tab collector call. A full compile with tab power was not run.~~ The refuter ran it:
  - **Laser:** GRBL `compileJob` with tab power 20 % and `grblStrategy.emit`.
  - **CNC:** `compileCncJob`, profile on the path.
  - **Result:** both burns move with the resolvers (see L6-P1-1, Refuter).
- **LightBurn:** behaviour comes from its 1.7 Edit Nodes page only. Whether LightBurn's own Delete flattens a crest, and how it keeps tabs, was not observed.
- **Design Studio's** fillet, chamfer and extend (L5) and `circular-arc.ts` CNC sampling were read, not run.
- **Performance:** `materializeCurves` re-flattens every contour of the edited path at 0.05 mm on each node op. Speed on a 5,000-contour trace was not measured (see the 2026-10-14 speed audit).

## Repro files

All were in the scratchpad copy `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and were deleted afterwards. No repo file other than this report was touched.

| File (under `j7-main\`) | Purpose |
|---|---|
| `src\core\geometry\zz-l6-core.test.ts` | Insert/delete/smooth/corner/fillet/close precision, hump and wave delete, midpoint key, smooth-then-drag, arc-fit budget on edited curves (7 tests) |
| `src\ui\state\zz-l6-store.test.ts` | Tabs through Delete node / Fillet / Insert (L6-P1-1), Undo/Redo for 16 ops, silent no-ops, typed coordinate, Extend under a transform, anchor-plus-handle nudge, `.lf2` round trip (6 tests) |
| `src\ui\state\zz-l6r-store.test.ts` (refuter) | L6-P1-1 through laser G-code and CNC compile (curves, polylines, circle, fillet), twins (Start, Break+Close, Reverse, Delete segment+Close), P3-3 no-ops, P3-5 nudge / typed / drag (7 tests) |
| `src\core\geometry\zz-l6r-core.test.ts` (refuter) | Hump, wave and controls (P2-1), Corner on a circle (P2-2), smooth-then-drag (P3-1), midpoint share (P3-4), insert split and fillet centres (3 tests) |
| `src\ui\state\zz-l6r-undo.test.ts` (refuter) | Undo/Redo for 6 node ops under a 30° / ×1.5 transform (1 test) |

The refuter's files were run one at a time with `node node_modules/vitest/vitest.mjs run <file> --config zz-l6r-vitest.config.ts` (an `fflate` alias config, also deleted) and deleted afterwards.

```json
[
  {"id":"L6-P1-1","severity":"P1","area":"node-edit-curves","file":"src/ui/state/path-node-edit-actions.ts","line":127,"anchor":"Contract: ADR-494 Amd 1 Context ('Any command that changes where a contour starts … must keep each tab at the same physical place, or deliberately handle it'); WORKFLOW F-A7c item 4 (placed tabs keep their place through Reverse and Start); Twin: Start/Break/Delete segment/Reverse/Convert to Path follow tabs","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: GRBL tab span moves from G1 X133 Y300 (bottom edge) to G1 X140 Y287 (right edge), 14.4222 mm; CNC compile rise 14.61 mm; circle 35.39/35.20 mm; fillet r5 4.1365 mm in G-code; polyline-only path too; no toast. Twins Start, Break+Close, Reverse, Delete segment+Close keep tabs at 0 mm; Extend drops with a toast, Trim remaps. ADR-494 Amd 1 exempts only reshapes; ADR-156 Consequences requires a remap or invalidation. One-picked-corner fillet shift is a reshape, excluded from the P1. P1 kept","known":false,"summary":"Delete node on a closed contour's start node (curve-node-delete.ts:61) and Radius/Fillet on its start corner (curve-fillet.ts:257-260) restart the contour, but deleteSelectedPathNodes and filletSelection leave laserTabAnchors/cncTabAnchors (fractions from the start) untouched, and output resolves them from the new start (laser-tab-anchors.ts:109-124, cnc-tab-anchors.ts:67-75). 40x20 part drawn from mid-bottom: deleting the redundant start node leaves the outline identical (Hausdorff 0) but moves the laser tab (32,0)->(40,12) and CNC tab (8,20)->(0,8), 14.42 mm; Ø50 circle 35.3/35.6 mm; fillet r5 all corners 4.14 mm; no toast, tabs not drawn outside the tab tool"},
  {"id":"L6-P2-1","severity":"P2","area":"node-edit-curves","file":"src/core/geometry/curve-node-delete.ts","line":99,"anchor":"Contract: curve-node-delete.ts:3-6 ('so the outline keeps its shape', code comment); Ground truth: LightBurn 1.7 Edit Nodes D 'Delete nodes and combine adjacent lines'; L2: a cubic with collinear control points is a line","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: bell hump Hausdorff 20.000 mm (controls on y=0), wave crest 10.000 mm; controls arch 0.311, circle 0.335. ADR-371 D1 does not accept flattening. LightBurn D curve behaviour UNVERIFIED (1.7/2.0 docs silent; an outer-handle reconnect would also be flat). Rests on the module header and the visibly wrong result. P2 kept","known":false,"summary":"Deleting a node between two curves whose outer tangents lie along the chord (a hump or wave crest with horizontal end tangents) yields one cubic whose control points all sit on the chord, because fittedCubic keeps the outer tangent directions and fitCubicWithTangents (cubic-fit.ts:87-107) returns its best cubic with no error bound: a 20 mm hump becomes a flat line (Hausdorff 20.000 mm, bounds maxY 0), a 10 mm wave crest vanishes; no message"},
  {"id":"L6-P2-2","severity":"P3","area":"node-edit-curves","file":"src/core/scene/curve-edit.ts","line":125,"anchor":"Ground truth: LightBurn 1.7 Edit Nodes C 'Convert node to corner (curve handles will have independent angles)'; node-edit-keys.ts:1-7 claims LightBurn's hover keys; toolbar title 'Align handles to the adjoining chords' (ToolStrip.tsx:133)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro 4.6520 mm, true-circle 0.0068 -> 4.6480 mm. Lowered to P3: toolbar title states the chord alignment; help-topics.ts:94 says C makes a node corner, which holds; KerfDesk stores no node type and handles are already independent, so LightBurn C would be a no-op; visible, undoable, canvas/file/burn agree","known":false,"summary":"Corner (hover key C and toolbar) re-aims both handles along the chords to the neighbouring nodes instead of only unlinking their angles: on a Ø50 kappa circle node the outline moves 4.65 mm (true-circle deviation 0.0068 -> 4.648 mm); other segments untouched; one Undo step. Refuter may lower to P3 for the toolbar title"},
  {"id":"L6-P3-1","severity":"P3","area":"node-edit-curves","file":"src/core/scene/curve-edit.ts","line":59,"anchor":"Ground truth: LightBurn 1.7 Edit Nodes S 'Convert node to smooth (curve handles will have same angle)'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own cusp: Smooth gives 0 deg, then dragging the outgoing handle gives a -16.6 deg kink; no node type stored. P3 kept","known":false,"summary":"No stored node type: Smooth aligns handles once (exact, -1.2e-15 deg, lengths kept) but moveCurveControl moves only the dragged handle, so a later handle drag kinks the node by 17.1 deg"},
  {"id":"L6-P3-2","severity":"P3","area":"node-edit-curves","file":"src/core/scene/curve-edit.ts","line":177,"anchor":"Contract: ADR-494 Amd 1 D3 (Break removes the segment leading into the node); Ground truth: LightBurn 1.7 Edit Nodes B 'Open path at node'","evidence":"READ","verdict":"CONFIRMED","refuter":"slice(0,-1) read; ADR-494 Amd 1 D3 decides it; LightBurn 1.7/2.0 B method note (move one of the nodes to reveal the gap) supports the parity reading. P3 kept","known":false,"summary":"Break on a closed contour drops the segment into the node (slice(0,-1)), so B equals D on that segment and a rectangle loses a side; ADR-decided and visible, raised as a LightBurn-parity improvement"},
  {"id":"L6-P3-3","severity":"P3","area":"node-edit-curves","file":"src/ui/state/path-node-edit-geometry.ts","line":117,"anchor":"Twin: Join, Fillet and Extend name every refusal in a toast","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: delete on a 3-node closed triangle and Smooth/Corner at a line node are unchanged with 0 toasts; toolbar Smooth/Corner never disabled. P3 kept","known":false,"summary":"Delete below the 2/3-node floor, and Smooth/Corner at a node with a straight side, return the state unchanged with no toast (delete-floor toast null, selection kept; smooth/corner-line-node toast null)"},
  {"id":"L6-P3-4","severity":"P3","area":"node-edit-curves","file":"src/ui/state/path-segment-actions.ts","line":65,"anchor":"Ground truth: LightBurn 1.7 Edit Nodes M 'Insert node at the halfway point between two nodes'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: node (6.875, 22.5) at 38.70 % of 66.044 mm; toolbar Insert title says halfway along. P3 kept","known":false,"summary":"M inserts at t = 0.5: on an asymmetric 66.04 mm cubic the node lands at 38.7 % of the length, 7.5 mm short of halfway; the split itself is exact"},
  {"id":"L6-P3-5","severity":"P3","area":"node-edit-curves","file":"src/ui/state/path-node-edit-geometry.ts","line":147,"anchor":"Contract: NodeCoordinateControls tooltip 'Moves all selected nodes by the same distance'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: nudge 1 -> handle 2; typed -10 lands at -6.193; live drag oscillates between (-10.19,35) and (-13.81,25) at a fixed target. Narrow reach, visible, undoable. P3 kept","known":false,"summary":"With an anchor and its own handle both selected, editCurvePathByDelta moves the handle with the anchor and again as its own ref: nudge (1,0) moves the anchor 1 and its handle 2; a typed handle coordinate lands one delta past the typed value"}
]
```
