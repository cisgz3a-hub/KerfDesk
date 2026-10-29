# Rolling audit v8 — N3 Geometry fixes (#1501, #1502, #1506)

- **When:** 2026-10-29, afternoon +0800   **Tree:** origin/main @ `33bc394c6` (fetched at the start; `git fetch origin main` unchanged at the end).
  - Merge commits: #1501 `548f67ecb` (parent `47ff19d8d`), #1502 `353b82b09` (parent `548f67ecb`), #1506 `7fb3adc05` (parent `76511fb89`). Later PRs on the same files: #1504 `7037dec09` (`selection-transform.ts`), #1511 `0cdee525a` (`hit-test.ts`, hit testing only).
  - **Repros ran on main's tree, not the worktree.** They ran in the scratchpad copy `…\scratchpad\j7-main\`. All 9,909 files under `src` tracked on `origin/main` hash-match `33bc394c6` there (`git ls-tree` blob ids against `git hash-object`). The worktree's `src`, `electron`, `docs/decisions`, `DECISIONS.md` and `WORKFLOW.md` equal `origin/main` (`git diff --stat origin/main HEAD` is empty), so every citation holds on main.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n3-vitest.config.ts --silent=false --disableConsoleIntercept`. The config is the repo's `vitest.config.ts` plus an `fflate` alias (the junction has no top-level link) and one worker.
  - **Test truth** was checked by disabling each fix through a Vitest alias (`N3_STUB=<pr>`), not with a full parent tree: #1501 `nestedSelectionRegion` returns null (the old union), #1502 `objectGeometryExtent` returns null and `withObjectTransform` writes the plain transform, #1506 `withTabsFollowingEdit` returns its input and `fitCubicFree` returns null. The same switch gave the "before" columns below.
- **Scope:** fix verification (L10) and entry-point parity (L9) of:
  - #1501, ADR-410 Amd 3: Offset Shapes and the Offset outlines row keep a separately drawn inner shape as a hole; curved sources flattened at 0.005 mm; one closed-enough rule. Findings fixed: v7 L1-P1-1, L1-P3-2, L1-P3-3.
  - #1502, ADR-677, ADR-144 Amd 1, ADR-214 Amd 1, ADR-307 Amd 3: turned artwork measured by its outline; a resized rounded rectangle keeps round corners; pen clicks are corners. Findings fixed: v2 08-P3-3 (re-rated P1 in v7), v7 L2-P2-1 (P1), L2-P2-2, L2-P3-2, L2-P3-4.
  - #1506, ADR-494 Amd 2, ADR-371 Amd 1: Delete node and Radius / Fillet keep placed tabs; node delete bounds its fit. Findings fixed: v7 L6-P1-1, L6-P2-1, L6-P3-3, L6-P3-4, L6-P3-5.
  - Interactions with #1504 (ADR-678), #1505 (ADR-681) and #1511 (ADR-683), merged the same day.
- **Lenses run:**
  - **L10:** every original repro through the real store actions and the compiled job; siblings; regressions; ADR text against the code; test truth.
  - **L9:** toolbar, canvas handle frames, Shape Properties, the jig editor sidebar, the Offset outlines row, Optimize Shapes, Weld, Subtract, Offset Shapes, and the node commands.
  - **L8:** conflict survival of every line the three merges added.
  - Not run: browser pointer events (store actions were driven directly), and LightBurn itself.
- **Counts:** 7 raised → 0 refuted → P1 3 / P2 1 / P3 3 (+ 6 KNOWN re-observed).
  - **Refuter:** 7 confirmed, 0 plausible, 0 refuted, 0 found KNOWN. No severity changes. The regression in N3-P1-1 was re-run on a literal export of #1502's parent. See "Refuter method".

## Headline

**Each finding the three PRs name is fixed on main for the path it reported.** Every original repro now gives the right burn:
- **#1501:** the separate hole stays in the cut (52 × 32 + 8 × 8).
- **#1502:**
  - a typed W 40 on a 45° circle burns 39.998;
  - a 100 × 50 r 10 rectangle typed to W 200 burns 10 × 10 corners;
  - the clicked house burns 100 × 100 with 5 lines.
- **#1506:**
  - deleting the redundant start node leaves the GRBL tab span at (132, 300);
  - the hump keeps a crest (2.11 mm miss, was 20).

Each regression test that matters fails with its fix disabled. Every added line survives on main, except two that #1504 rewrote on purpose.

Four gaps remain. One is a regression from #1502, and three are siblings the fixes did not reach:

- **N3-P1-1 (regression from #1502).** The ADR-144 Amd 1 "bake" rebuilds a rounded rectangle's outline at its new size but keeps each placed tab's fraction of the old outline.
  - A 100 × 50 r 10 part with tabs at the middle of its right and top edges, typed to W 200: the tabs burn 21.33 and 21.71 mm from where they scaled to before #1502. One lands on a corner arc.
  - A locked 2× resize moves them 7.57 mm. The canvas handle drag does the same.
  - There is no toast. A sharp rectangle (r 0) and the pre-#1502 code keep them exact.
- **N3-P1-2 (sibling of L6-P1-1 that #1506 did not reach).** Optimize Shapes restarts a closed contour at its first corner and keeps each tab's fraction.
  - On the audit's own 40 × 20 part, the laser tab span moves from `(132, 300)` to `(140, 288)`, 14.42 mm onto the right edge. These are exactly the L6-P1-1 G-code numbers.
  - The toast reads "the outlines did not move".
- **N3-P1-3 (gap in ADR-144 Amd 1 D1).** The jig editor's shared artwork size writes the plain transform. An r 3 rounded rectangle typed to 40 × 10 there compiles 6 × 3 mm corners, although D1 names "the registration jig editor" among the writers that keep corners round.
- **N3-P2-1 (sibling).** Weld, Subtract and Offset Shapes with Delete original objects drop hand-placed tabs with no notice, where Extend says so.

The three P3s:
- **N3-P3-1:** #1501's nesting step scales with nesting depth: 100 concentric separate rings take 10.1 s (was 0.11 s), and 300 take 301 s, in the vector worker.
- **N3-P3-2:** test-truth gaps. #1502's flip test passes with the fix disabled, and none of the three gaps above is tested.
- **N3-P3-3:** ADR-677 Decision 3 lists consumers that still use the turned own-bounds box.

## Fix verification (L10)

| Fix | Original repro | Before | After (main) | Siblings | Verdict |
|---|---|---|---|---|---|
| #1501 L1-P1-1 | Rectangle-tool plate 50 × 30, separate 10 × 10 hole, Ellipse-tool Ø8 disc; Offset Shapes Outward 1 mm, Corner, Delete original objects | Cut [52 × 32]; hole and disc gone, no toast (v7). With the fix disabled, 5 of the PR's 7 store tests fail | Cut [52 × 32, 8 × 8, 6 × 6], no toast. Inward [48 × 28, 12 × 12, 10 × 10]. Both: all six. Outer shapes only: [52 × 32] / [48 × 28]. Offset outlines row +1 / −1 keeps and offsets the hole. Undo restores the scene byte for byte | Separate hole = compound twin for all 18 cases (3 joins × 3 directions × Outer only). Matches twin: 3-level nesting (10404/3364/1024/64 mm²), hole touching outer, two touching holes, duplicate holes and plates, CCW hole. Open path + closed: line outlined, inward ignores it. Text "O" in a plate (and converted text): outer ring a hole, counter an island. Panel offset [1663.134, 64]. Weld absorbs (documented review); Subtract [1500, 100]. **Cost: N3-P3-1** | **Holds** |
| #1501 L1-P3-2 | r 10 circle offset +50 mm | 0.0296 / 0.0306 mm off the r 60 circle (v7) | 0.0196 mm (Offset Shapes and panel offset alike). +25: 0.0120; +100: 0.0200 | `offset-round-chord-error.test.ts` 26/26 | **Holds** |
| #1501 L1-P3-3 | `closed: false` square whose last point repeats its first, welded | `open-contours` refusal (v7) | Welds, 150 mm² | `closed-enough-contours.test.ts` 3/3; command state per PR test | **Holds** |
| #1502 08-P3-3 | Ø50 circle at 45°: toolbar W, locked W 40, X 100 (`buildSelectionTransformEdit` + `applySelectionTransforms`, as the toolbar does; compiled job) | Toolbar 70.711; W 40 burns **28.284**; X 100 burns from **105.858** | Toolbar 50.000; W 40 burns 39.998; X 100 burns from 100.001 | Each shape at 45° / 30°: burned width after locked W 40 from the compiled job; X 100 lands on 100.000–100.020.<br>Ellipse 80 × 20: 58.323 → 39.985 (was 32.952).<br>Hexagon r 25: 48.296 → 40.000 (was 29.282).<br>Rounded rect 60 × 30 r 15: 51.213 → 39.959 (was 32.155).<br>Text-like glyph at 30°: 40.000 (was 28.383).<br>Triangle at 30°: 40.000 (was 33.022).<br>Align Left flush (75.003 / 75; was 64.645). Distribute gaps equal. Flip H keeps the burned box (was 8.66 mm off). Grid gap 2.006 (was 22.717). Move to bed NW 0.003 (was 10.358). Marquee on the tight box selects. Snap lands at the burned edge (125 vs 124.997; was 135.355). Out-of-bed: no false flag. Typed rotation of one object returns exactly. Four quarter turns exact. Start From, Frame and preflight read compiled bounds (`job-origin.ts:102-112`, `prepare-output.ts:393-411`) and are unaffected | **Holds** (P3 ADR wording, N3-P3-3) |
| #1502 L2-P2-1 (P1) | 100 × 50 r 10, toolbar W 200, then Corner radius 6 | 20 × 10 corners; scale (2, 1) | Spec 200 × 50 r 10 at scale 1; compiled corners 10 × 10, then 6 × 6; one Undo step. The PR's UI test passes 7/7 (drag-drawn W / H / radius 5 → 5 × 5) | Group stretch bakes (80 × 20 r 5, corners 5 × 5). Mirrored bakes with mirror kept. Single-handle drag over 4 frames gives 50 / 70 / 90 / 110 with no compounding. Turned 30° handle stretch bakes. Locked resize at 0° keeps r 5 (LightBurn). Locked at 30° stays a plain scale (ADR D2). **Jig sidebar: corners 6 × 3 (N3-P1-3). Placed tabs move up to 21.7 mm (N3-P1-1)** | **Fixed on the reported routes; regression N3-P1-1, gap N3-P1-3** |
| #1502 L2-P2-2 | Pen house (100, 140) (150, 100) (200, 140) (200, 200) (100, 200), closed, through `finishPen` and the compiled job | 10 cubics; 102.535 × 100.298; walls bow 1.51 mm (v7) | 5 lines; compiled 100.000 × 100.000; stamped `fairingVersion` 1; `upgradeProjectPolylineFairing` leaves it alone | A dragged node still curves (cubic, cubic, line, line). 4-click open zig-zag: 3 lines, 60 × 20. Close on the first vertex: `pen-tool.test.ts` 17/17 | **Holds** |
| #1502 L2-P3-2 / P3-4 | 0 / −5 / 1e-400 in Shape Properties; 50 × 50 r 20 → W 10 → W 50 | Clamp to 0.01; radius lost | Refused, no Undo step; r 20 comes back (spec and burn 20 × 20) | — | **Holds** |
| #1506 L6-P1-1 | 40 × 20 part from mid-bottom (transform (100, 100)), laser tab 0.1, CNC tab 0.6, Delete start node | Laser span `(132, 300)` → `(140, 288)`, 14.42 mm; with the remap disabled all 4 PR tests fail | Laser and CNC tabs 0 mm; span `(132, 300)` unchanged; no toast; Undo / Redo exact. Ø50 circle: refitted-half tabs 0.16 / 0.17 / 0.20 mm, untouched 0, with the toast "3 placed tabs sat on the changed outline …". Fillet r 5: 0 mm, "Rounded 4 corners." Middle-node delete: 0 (was a length shift). Non-uniform 3 × 0.5 at 20°: 0 | 0 mm, each with exact Undo / Redo: Start @ node 2, Reverse, Break + Close Path, Insert at midpoint, segment to curve, Delete segment + Close Path, Join (contour indices shift, tabs follow). Corner on a circle moves tabs 2.97 / 4.22 mm (a reshape, ADR-494 Amd 1 Consequences). **Optimize Shapes 14.42 mm (N3-P1-2). Weld / Subtract / Offset drop them (N3-P2-1)** | **Holds for Delete node and Fillet; sibling gaps** |
| #1506 L6-P2-1 | Hump (0,0) → (20,20) → (40,0), horizontal end handles, delete the crest | Flat cubic on y = 0, Hausdorff 20.000 | One cubic, Hausdorff 2.109 mm, max y 20.15. Start tangent 44° (a corner at the kept nodes, as ADR-371 Amd 1 Consequences say). With the free fit disabled, the hump and wave tests fail | 8-node circle, delete 1 / 2 / 3 adjacent nodes: radial miss 0.006 / 0.058 / 0.335 mm, joins stay smooth (kink 0°), so the free fit does not kick in on ordinary curves | **Holds** |
| #1506 L6-P3-3 / 4 / 5 | Floor, Smooth / Corner refusals, M at half length, node + own handle | Silent; t = 0.5; handle moved twice | `path-node-edit-polish.test.ts` 6/6 | — | **Holds** (PR tests only) |

**Test truth (L7).** Each fix was disabled through the alias and the PR's tests re-run:

| PR | File | Tests failing with the fix disabled |
|---|---|---|
| #1501 | `offset-nesting.test.ts` | 10 of 16; the 6 that pass are the "overlap still unions" no-change pins |
| #1501 | `offset-separate-holes.test.ts` | 5 of 7 (Outer shapes only and overlap pass on both) |
| #1502 | `NumericEditsBar.outline-size.test.tsx` | 5 of 7. The circle reads 70.711, a 9.804 mm miss, scale 2 |
| #1502 | `object-extent.test.ts` | 6 of 10. **The flip test passes (N3-P3-2)** |
| #1506 | `path-node-delete-fillet-tabs.test.ts` | 4 of 4 |
| #1506 | `curve-node-delete.test.ts` | 2 of 14 (hump, wave). The circle case passes on both by design |

On main all of these pass. So do `offset-round-chord-error` 26/26, `closed-enough-contours` 3/3, `pen-tool` 17/17, `path-node-edit-polish` 6/6 and `path-node-curve-command-tabs` 14/14.

**Conflict survival (L8).** Every added non-comment `src` line of each merge was grepped in main's file:

| PR | Added | Missing on main |
|---|---|---|
| #1501 | 302 | 0 |
| #1502 | 330 | 2, both in `selection-transform.ts` `rotateSelection`. #1504 rewrote them and kept the single-object own-bounds pivot (`selection-transform.ts:256-281`) |
| #1506 | 384 | 0 |

**Interactions.**
- **#1504 (ADR-678).** A typed angle on a group pivots on the tight box (`selection-transform.ts:265`). Typing 37° then 0° on a lopsided two-object group leaves it 1.401 mm off (3.783 with the pre-#1502 box), and 15.4 mm after 11 round trips (41.6 before). ADR-678 Consequences accept this ("can leave a lopsided one shifted by a little"). #1502 reduces it.
- **#1511 (ADR-683).** Fill pools a layer even-odd. ADR-410 Amd 3 Context relies on that to say Fill also makes a separate inner shape a hole. It does, so Offset and Fill agree on nested shapes. They differ on overlapping plates, by decision.
- **#1505.** It shares no file with these PRs. SVG/DXF export does not read `transformedBBox` (no consumer under `src/io`).

## Findings

### N3-P1-1 — A resized rounded rectangle is rebuilt at its new size (ADR-144 Amd 1) but keeps each placed tab's fraction of the old outline: on a 100 × 50 r 10 part typed to W 200, the tabs burn 21.3 and 21.7 mm from where they scaled to before #1502, one on a corner arc, with no warning

- **Where:**
  - `src/core/shapes/rectangle-resize.ts:28-41` (`withObjectTransform`) and `:70-82` (`bakeRectangle`) regenerate the outline through `rematerializeParametricShape`.
  - `src/core/shapes/rematerialize-shape.ts:82-87` returns `{ ...object, spec, bounds, paths }`. So `laserTabAnchors` and `cncTabAnchors`, which are fractions of the contour from its start (ADR-156), are kept unchanged.
  - The new outline starts at `(w − r, 0)` (`primitives/rectangle.ts:60`) with different edge-to-arc shares.
  - Output places each tab at that fraction of the new outline: `cnc-tab-anchors.ts:67-75`, and `laser-tab-anchors.ts:29-31`, which calls it.
  - **Routes:** every writer #1502 added the bake to.
    - `selection-transform-actions.ts:364`: toolbar, Match size, remote.
    - `store-actions.ts:427`: canvas handle drag frames.
    - `jig-canvas-selection.ts:243`.
    - `object-properties-actions.ts:120`: Shape Properties.
- **Anchor:**
  - **Contract:** WORKFLOW F-A7c item 4 (`WORKFLOW.md:1150-1151`): placed tabs "move, rotate and scale with the artwork".
  - **Contract:** ADR-494 Amendment 1, Context (`docs/decisions/ADR-494-amendment-1-tabs-through-path-commands-and-inner-shapes.md:16-17`): "Any command that changes where a contour starts, which way it runs, or which object carries it must keep each tab at the same physical place, or deliberately handle it."
  - **Twin:** the same resize of a sharp rectangle (r 0, never baked), and the same resize with the bake disabled (pre-#1502), keep both tabs exactly where the stretch puts them.
- **Scenario:**
  1. A 100 × 50 rectangle with Corner radius 10 at (100, 100). Tabs are placed by hand (laser and CNC) at the middle of its right edge, world (200, 125), and of its top edge, (150, 150).
  2. Type W 200 in the toolbar (aspect unlocked, anchor NW). The part is now 200 × 50 with round corners, as ADR-144 Amd 1 intends.
  3. The right-edge tab now burns at (297.823, 146.217), on the top-right corner arc, instead of the middle of the right edge (300, 125): **21.33 mm** away.
  4. The top-edge tab burns at (178.289, 150) instead of (200, 150): **21.71 mm**.
  5. No toast. Placed tabs are drawn only while a tab tool is open.
  - **Other routes:**
    - The canvas east-handle drag to the same size gives the same result.
    - A locked 2× resize (which also bakes, keeping r 10) moves both tabs **7.57 mm**.
  - **Earlier sibling.** Shape Properties (Width 200) moves them the same way. That route rematerialized the spec with kept fractions before #1502 too: a sharp rectangle there moves 16.7 mm. #1502 extended it to the toolbar, the handles and the jig canvas, which until then kept tabs exactly.
- **Evidence:** REPRO, `src\ui\state\zz-n3-recttabs.test.ts` (real store actions, `scaleObjectByHandleDrag` + `setObjectTransforms`, `compileJob` tab spans in machine coordinates):
  ```text
  r10.W200     before.spans [{"x":200,"y":275},{"x":150,"y":250}]  expected [{"x":300,"y":125},{"x":200,"y":150}]
               after spec {"widthMm":200,"heightMm":50,"cornerRadiusMm":10} scale [1,1]
               after.where.laser [{"x":297.823,"y":146.217},{"x":178.289,"y":150}]  spans [{"x":297.78,"y":253.817},{"x":178.289,"y":250}]  toasts []
  r10.locked2x after [{"x":300,"y":157.567},{"x":192.433,"y":200}]  expected [{"x":300,"y":150},{"x":200,"y":200}]
  r10.handleE  after [{"x":297.823,"y":146.217},{"x":178.289,"y":150}]
  r0.W200      after [{"x":300,"y":125},{"x":200,"y":150}]  spans [{"x":300,"y":275},{"x":200,"y":250}]
  N3_STUB=1502 r10.W200 after [{"x":300,"y":125},{"x":200,"y":150}]  spans [{"x":300,"y":275},{"x":200,"y":250}]
  ```
- **Severity:** P1. This is v7's design rule ("geometry that differs … from what the app shows … burn is wrong with no warning") and the L6-P1-1 precedent: an edit moves a hand-placed tab across the part with no warning. It is a regression: before #1502 the same toolbar, handle and jig-canvas resizes kept the tabs exact.
- **Test truth:** none of `NumericEditsBar.outline-size.test.tsx`, `rectangle-resize` users or the tab suites resizes a tabbed rounded rectangle.
- **Novelty:** new. It was introduced by #1502. `docs/audits/**` has no report of tabs through a Shape Properties spec edit either (grep: "Shape Properties" / "rematerializ" with "tab").
- **Refuter: CONFIRMED, P1 kept. The regression holds on #1502's literal parent.**
  - **What would make it false:**
    - an ADR that lets a resize keep tab fractions on a rebuilt outline;
    - a notice;
    - the pre-#1502 code moving the tabs the same way, so no regression;
    - output that does not read the stale fraction.
  - **Own repro on main `c1acfdff6`.** `zz-n3r-recttabs.test.tsx` used:
    - the real `NumericEditsBar` and `SelectedObjectProperties`;
    - tabs placed with `addSelectedLaserTabAnchor`, and CNC tabs with `seedSelectedCncTabAnchors` then dragged to the same two points;
    - GRBL `compileJob` and `emitGcode`, tab power 20 %.

    Results:
    - **Toolbar W 200:** laser and CNC tabs land 21.328 and 21.711 mm from their stretched places. No toast.
      - G-code tab spans: `G0 X179.289 Y250.000 S0` → `G1 X177.289 Y250.000 … S100`, and `G0 X297.163 Y253.033 S0` → `G1 X297.916 Y253.889 … S100`. The second span is on the top-right corner arc.
    - **Locked 2×:** 7.567 mm.
    - **Canvas drag-frame action** (`setObjectTransforms`, which `apply-transform-drag.ts:70,121` calls): 21.328 / 21.711 mm.
    - **Sharp r 0 controls:** 0 mm.
  - **Parent run.** The same file ran on a plain `git archive` export of `548f67ecb` (#1502's parent, which has no `rectangle-resize.ts`). The export sat in the scratchpad outside `j7-main` and resolved packages from the same `node_modules`.
    - Toolbar W 200, locked 2× and the canvas frame action each leave the rectangle at scale (2, 1) or (2, 2), with both tabs at 0 mm.
    - G-code tab spans: `G0 X201.000 Y250.000` → `G1 X199.000 Y250.000 … S100`, and `G0 X300.000 Y274.000` → `G1 X300.000 Y276.000 … S100`.
    - So the toolbar, locked and canvas routes are a regression from #1502.
  - **The Shape Properties route is older than #1502, and is not KNOWN.**
    - Width 200 in Shape Properties moves the tabs 21.328 / 21.711 mm on r 10 and 16.667 mm on r 0. It does this on the parent and on main alike.
    - A grep of `docs/audits/**` outside v8 finds no report (tab together with Shape Properties, Inspector, rematerialize, resize or corner radius). v7 L2 and L6 never put a tab on a drawn shape.
    - So it is an older sibling of the same defect, and new to the audits.
  - **No ADR accepts it.**
    - ADR-156 Decision (`DECISIONS.md:7839-7840`): "Move, rotate, mirror, scale, duplicate, save, and reload preserve the normalized anchors". Its Context asks for the same physical positions "after ordinary object transforms".
    - ADR-494 item 4 (`ADR-494-laser-tabs-and-closed-shape-starts-lightburn-gap-batch-7.md:87`): "Move, rotate, scale, copy and paste … carry them".
    - ADR-144 Amd 1 does not mention tabs.
    - ADR-494 Amd 1 Consequences let a reshape keep each tab's fraction. That clause names node edits (Smooth, Corner, Curve or Line, dragging a node or a handle), not a resize. v7 L6's refuter used it only for a sub-millimetre fillet shift.
  - **No warning.** No route pushes a toast. Placed tabs are drawn only while a tab editor is open (`draw-scene.ts:257-264`).
  - **LightBurn: UNVERIFIED.**
    - The 1.7 Add Tabs page (https://docs.lightburnsoftware.com/1.7/Reference/AddTabs/, fetched 2026-10-29) covers only placing and removing tabs.
    - Primary Shapes (`…/1.7/Reference/PrimaryShapes/`) has no text about tabs.
    - The finding rests on KerfDesk's own contracts and on the parent twin.
- **Fix direction:**
  - In `withObjectTransform` and `rematerializeShapeSpecEdit`, carry placed tabs through the rebuild:
    1. Map each tab's old local place by the stretch the bake replaces (`after / before` scale on each axis).
    2. Project it onto the new outline with the #1506 projector (`createTabPolylineProjector`).
    3. Toast as ADR-494 Amd 2 does when one leaves the outline.
  - Add a tabbed rounded-rectangle case to `NumericEditsBar.outline-size.test.tsx` that compiles the tab spans.

### N3-P1-2 — Optimize Shapes restarts a closed contour at its first corner and keeps each tab's fraction: on L6-P1-1's own part the laser tab span moves from `(132, 300)` to `(140, 288)`, 14.42 mm onto another edge, and the toast says "the outlines did not move"

- **Where:**
  - `src/core/geometry/shape-optimize/contour-corners.ts:79-87`: a closed contour with corners is split into runs starting at `corners[0]`.
  - `optimize-contour.ts:56-58`: the new curve starts at the first run's first point.
  - `src/ui/state/optimize-shapes-plan.ts:139-151` (`optimizedSceneObject`): `{ ...object, paths: result.paths, bounds }` keeps `laserTabAnchors` / `cncTabAnchors` as they were.
  - The module header claims safety (`optimize-object.ts:2-4`: "Every contour keeps its place in its path, so tab anchors … still point at it"). They still point at the contour, but at the wrong fraction of it.
  - The notice: `optimize-shapes-notice.ts:52-55`.
- **Anchor:**
  - **Contract:** ADR-494 Amendment 1, Context (`…amendment-1….md:16-17`, quoted under N3-P1-1).
  - **Contract:** WORKFLOW F-A7c item 4 (`WORKFLOW.md:1150-1161`) lists the commands that keep placed tabs in place.
  - **Twin:** ADR-494 Amendment 2 fixed exactly this mechanism for Delete node and Radius / Fillet, with a helper whose contract is an edit that "keeps each contour's index, as Delete and Fillet do" (`edited-tab-anchors.ts:39-40`). Optimize Shapes keeps contour indices too (`optimize-object.ts:2-4`).
  - **Twin:** Delete node on the same part now moves the tabs 0 mm.
- **Scenario:**
  1. Take L6-P1-1's part: a 40 × 20 contour drawn from the middle of its bottom edge (an SVG export or a trace), with a laser tab 12 mm along at (32, 0) and a CNC tab on the top edge.
  2. Tools → Optimize Shapes, default options.
  3. The outline is unchanged: 5 points became 4 segments. It now starts at the corner (40, 0).
  4. Both tabs move round the part by the old start's share: **14.42 mm**. The laser tab gap goes from the bottom edge to the right edge.
  5. The only message is "Optimized 1 object: 5 points became 4 segments; the outlines did not move."
  - **Other cases:**
    - An L-shaped contour that starts mid-edge moves its tabs 15.23 / 15.81 mm.
    - Lines-and-arcs only, without smoothing, gives the same 14.42 mm.
- **Evidence:** REPRO, `src\ui\state\zz-n3-tabs.test.ts` (`optimizeSelectedShapes(DEFAULT_SHAPE_OPTIMIZE_OPTIONS)` on the real store, GRBL `compileJob` with tab power 20 %):
  ```text
  optimize.gcode {"spansBefore":[{"x":132,"y":300}],"spansAfter":[{"x":140,"y":288}],"cncBefore":[{"x":108,"y":120}],"cncAfter":[{"x":100,"y":108}],"start":{"x":40,"y":0}}
  sib.optimize-shapes {"moved":{"laser":[14.4222],"cnc":[14.4222]},"toasts":["Optimized 1 object: 5 points became 4 segments; the outlines did not move."],"undo":true,"redo":true}
  sib.optimize-shapes.L {"moved":{"laser":[15.2315,15.8114],"cnc":[15.2315]}}
  sib.delete-start (twin) laser [0] cnc [0], spans [{"x":132,"y":300}] -> [{"x":132,"y":300}]
  ```
- **Severity:** P1, exactly as L6-P1-1, which reached the same G-code numbers: the outline is identical, the burned and cut tabs move, and the app's only message affirms that nothing moved.
- **Novelty:** new. `docs/audits/**` has no Optimize Shapes / tab report (grep).
- **Refuter: CONFIRMED, P1 kept.**
  - **What would make it false:**
    - the command being unreachable;
    - an ADR that lets Optimize Shapes keep tab fractions;
    - a notice;
    - output that does not read the stale fraction.
  - **Reach.**
    - The command is in Tools → Vector → Optimize Shapes… (`tools-vector-menu-ids.ts:19`, `optimize-shapes-commands.ts:6-21`). It is enabled for any selection.
    - The dialog's Apply calls the same `optimizeSelectedShapes(options, plan)` (`OptimizeShapesDialogHost.tsx:36`), which builds each object through `optimizedSceneObject`.
    - There is no remote or MCP route: a grep of `src/ui/remote-control` and `electron/mcp` finds none. P1 has no reach clause, so the menu route is enough.
  - **Own repro.** `zz-n3r-geom.test.ts` used the real store and `emitGcode`, with tab power 20 %.
    - The G-code tab span moves from `G0 X133.000 Y300.000 S0` → `G1 X131.000 Y300.000 … S100` to `G0 X140.000 Y289.000 S0` → `G1 X140.000 Y287.000 … S100`.
    - The laser and CNC resolvers both move 14.422 mm.
    - The toast reads exactly "Optimized 1 object: 5 points became 4 segments; the outlines did not move."
    - It is one Undo step, and Undo puts the tabs back.
    - **Control:** the same part drawn from a corner is left alone ("Nothing changed: …").
  - **No ADR accepts it.**
    - ADR-499 item 7 (2026-09-28) says imported and traced artwork "keeps its kind, id, operations and tab anchors". That keeps the anchor records, not the places where the tabs burn.
    - ADR-494 Amd 1 is dated a day later (2026-09-29). It requires any command that changes where a contour starts to keep each tab "at the same physical place, or deliberately handle it".
  - **Precedent.** These are the G-code numbers of v7 L6-P1-1, which the v7 coordinator confirmed as P1.
- **Fix direction:**
  - Call `withTabsFollowingEdit(object, optimized)` in `optimizedSceneObject`, and append `movedTabsNotice` to the toast. Both are already exported by #1506.
  - Add the 40 × 20 mid-edge case to `optimize-shapes-actions.test.ts`.

### N3-P1-3 — The jig editor's shared artwork size writes the plain transform, so a rounded rectangle there is stretched: r 3 typed to 40 × 10 compiles 6 × 3 mm corners, where ADR-144 Amd 1 D1 names the jig editor among the writers that keep corners round

- **Where:**
  - `src/ui/state/registration-jig-artwork-actions.ts:247-254` (`applyRegistrationJigArtworkSize`): `return transform === undefined ? object : { ...object, transform };`. There is no `withObjectTransform`.
  - It is called by the jig editor sidebar (`src/ui/workspace/registration-jig/JigEditorSidebar.tsx:149, 212-225`, rendered for every jig) and by the store action `resizeRegistrationJigArtwork` (`:62-68`).
  - The jig canvas handles do bake (`jig-canvas-selection.ts:243`).
- **Anchor:**
  - **Contract:** ADR-144 Amendment 1, Decision 1 (`docs/decisions/ADR-144-amendment-1-a-resized-rectangle-keeps-round-corners.md:34-36`): "Every writer of resize transforms applies it: the selection transforms (toolbar, Match size, the remote control and the other selection commands), the canvas drag frames and the registration jig editor."
  - **Twin:** the same 2 × 1 stretch through the toolbar or the jig canvas handles gives round corners.
- **Scenario:**
  1. A jig set of two 60 × 40 outlines. The artwork is a 20 × 10 rectangle with Corner radius 3, centred in the outlines.
  2. In the jig editor sidebar, unlock the aspect and type 40 × 10.
  3. Both copies are spec 20 × 10 r 3 at scale (2, 1). The compiled cuts are 40 × 10 with **6 × 3 mm** corners.
  4. No message appears. The jig editor shows no corner radius or Shape Properties. The main editor's Shape Properties would read "3" with the note "The corners are stretched to 6 × 3 mm", but only if the user selects that artwork there.
  - With the aspect locked (the default), a 2× resize keeps a plain scale. The corners stay round at r 6, which Shape Properties then reads correctly, but D1's "keeps its corner radius" does not hold.
- **Evidence:** REPRO, `src\ui\state\zz-n3-rect.test.ts`, calling exactly what the sidebar calls (`applyRegistrationJigArtworkSize(…, { widthMm: 40, heightMm: 10, preserveAspect: false })`) and the store action, then `compileJob` on the jig project:
  ```text
  jig.sidebar  {"outcome":{"kind":"ok"},"art":[{"spec":{"kind":"rect","widthMm":20,"heightMm":10,"cornerRadiusMm":3},"scale":[2,1]}, …]}
  jig.storeAction {"res2":{"kind":"ok"},"art":[{"spec":{…"cornerRadiusMm":3},"scale":[2,1]}, …]}
  jig.compiled {"cuts":[{"w":60,"h":40,…},{"w":60,"h":40,…},{"w":40,"h":10,"alongX":6,"alongY":3},{"w":40,"h":10,"alongX":6,"alongY":3}]}
  ```
- **Severity:** P1 by the rule that L2-P2-1 was re-rated under: the corner the user typed (r 3) burns 6 × 3 and no warning reaches the operator before output.
  - The jig editor, where the edit is made, shows nothing.
  - The Shape Properties note is a passive readout in another panel. METHOD §3 (rolling v3 G6) does not count that as a warning.
  - **Boundary for the refuter:** this note is the fix's own mitigation, and it does name the mismatch. If the coordinator counts it as reaching the operator, this is P2.
- **Novelty:** new. It is a gap in #1502's writer list.
- **Refuter: CONFIRMED, P1 kept** (the auditor's P2 boundary still applies).
  - **What would make it false:**
    - a rounded rectangle cannot reach the shared size box;
    - the jig edit never reaches output;
    - a warning shows in the jig editor before output;
    - an ADR exempts the shared size box.
  - **Own repro** (`zz-n3r-geom.test.ts`):
    1. A 1 × 2 jig of 60 × 40 outlines.
    2. A 20 × 10 r 3 rectangle drawn and centred with `centerSelectionInRegistrationBox`, which fits it at a plain 2.7× scale.
    3. Exactly what the sidebar calls: `applyRegistrationJigArtworkSize(…, 40 × 10, unlocked)`.

    Results:
    - Both copies are spec 20 × 10 r 3 at scale (2, 1).
    - The compiled cuts are 40 × 10 with **6 × 3 mm** corners.
    - The store action with the aspect locked gives scale (2, 2) and 6 × 6 corners.
    - No toast.
  - **The note is not shown in the jig editor.**
    - The jig sidebar's only fields are X, Y, Width, Height and Rotation (`JigSelectionFields.tsx:35-72`), plus the shared size box. It has no Shape Properties and no corner radius.
    - The jig canvas draws the true outline (`jig-canvas-paint.ts:12,46`, `drawScene`), but the canvas is not a warning (METHOD §3, rolling v3 G6).
  - **The edit reaches output.**
    - Save to canvas commits the draft to the project (`RegistrationJigEditor.tsx:123,141` → `commitJigEditorSession`, `use-jig-editor.ts:164`). The project then compiles like any other, as shown above.
    - After saving, the "The corners are stretched to 6 × 3 mm" note shows only if the operator selects that artwork in the main editor (`SelectedShapeGeometryFields.tsx:142-147`). The Corner radius box above the note still reads 3.
    - Job Review and preflight say nothing.
  - **Only the shared size box misses D1.** The jig editor's own selection fields and its canvas handles do bake (`JigSelectionFields.tsx:22-28` → `withJigTransforms` → `withObjectTransform`).
  - **Why it is not lowered.**
    - For P2: the typed W/H burn exactly, and the note is truthful wherever it shows.
    - Against: the radius the user typed burns as a 6 × 3 mm ellipse, against ADR-144 Amd 1 D1, which names the jig editor. No warning reaches the operator before output.
    - Neither lowering condition of METHOD §3 holds. If the coordinator counts the Shape Properties note as reaching the operator, this becomes P2.
  - **Also seen, not raised:** the Centre fit also writes a plain uniform scale. After a 2.7× fit, r 3 burns as round r 8.1 corners, and Shape Properties reads 8.1. The same `withObjectTransform` fix covers it.
- **Fix direction:**
  - Use `withObjectTransform` at `registration-jig-artwork-actions.ts:253`.
  - Add the sidebar case to the jig size tests.

### N3-P2-1 — Weld, Subtract and Offset Shapes with Delete original objects drop hand-placed tabs with no notice, where Extend names the same loss

- **Where:**
  - The results are new objects built without tab anchors:
    - `offset-shapes.ts:289-311` (`resultObject`);
    - `vector-path-weld.ts:25-…`;
    - `vector-path-booleans.ts:51-…`;
    - the store mutations in `vector-path-actions.ts:208-…` and `offset-shapes-actions.ts`.
  - None of these pushes a tab notice: `grep -n "[Tt]ab" src/ui/state/vector-path-actions.ts` is empty, and nothing in `src/ui/commands` mentions placed tabs.
- **Anchor:**
  - **Contract:** ADR-156 Consequences (`DECISIONS.md:7852-7853`): "a future topology-changing editor must deliberately remap or invalidate them rather than guessing". Invalidating is allowed. Doing it silently is the gap.
  - **Twin:** Extend drops placed tabs and says so: "Placed tabs on the extended contour were removed. Undo restores them." (`extend-shapes-actions.ts:106`). Trim remaps them (L6 report).
- **Scenario:**
  1. Place one laser tab and one CNC tab by hand on a part.
  2. Weld a feature onto it, Subtract a hole from it, or Offset Shapes it outward 0.1 mm with Delete original objects.
  3. The result carries no placed tabs and no toast appears.
  4. With tabs on, the operation's automatic tabs then apply wherever the automatic rule puts them. Job Review's detail line changes from "…, 1 placed by hand" to the automatic count, and nothing names the change.
  - Undo restores the tabs.
- **Evidence:** REPRO, `zz-n3-tabs.test.ts`:
  ```text
  weld.result [{"id":"welded-paths","laser":0,"cnc":0}]   sib.weld-with-other {"moved":{"laser":["lost"],"cnc":["lost"]},"toasts":[],"undo":true}
  subtract.result [{"id":"subtract-paths","laser":0,"cnc":0}]   toasts []
  offset.result {"objects":[{"id":"offset-paths","laser":0}]}   toasts []
  ```
- **Severity:** P2. ADR-156 lets a topology-changing edit invalidate tabs, and the outline visibly changes. The defect is the missing notice, which the twin gives.
  - **Precedent for the coordinator:** v7 L7-P1-2 (paste drops placed tabs, which become automatic ones, with no warning) was P1. That edit leaves the outline unchanged, which is why this one is held at P2.
- **Novelty:** new. `docs/audits/**` has no report (grep "placed tabs" with drop / lost / Weld / Boolean / Offset).
- **Refuter: CONFIRMED, P2 kept.**
  - **Own repro.** `zz-n3r-geom.test.ts`, plus a debug run that compiles with the project's own layers.
    - The Weld / Boolean dialog defaults are "keep originals" off and "keep live compound" off (`BooleanDialogHost.tsx:119-120`).
    - Setup: one placed laser tab on the 40 × 20 plate, burning a span at (112, 300).
    - Three edits were run: Weld with a feature on the right, Subtract of a 10 × 10 hole, and Offset Shapes 0.1 mm with Delete original objects.
    - Each result has no laser or CNC anchors. Subtract and Offset put the result on a new operation that copies the source's tab settings.
    - Each result is cut with four automatic tab spans, none at the placed one:
      - **Weld:** (117.5, 300), (147.5, 295), (132.5, 280), (100, 282.5).
      - **Subtract:** (115, 300), (140, 295), (125, 280), (100, 285).
      - **Offset:** (115, 300.1), (140.1, 295), (125, 279.9), (99.9, 285).
    - No toast appears. Undo restores the anchors.
  - **Why it is not P1 (the L7-P1-2 question).**
    - In L7-P1-2 the edit was paste. ADR-494 item 4 says "copy and paste … carry them", and WORKFLOW F-A7c item 4 names paste too. So the automatic tabs there were wrong output by contract.
    - Weld, the Booleans and Offset Shapes appear in neither list. A grep finds no ADR or WORKFLOW text saying they keep placed tabs.
    - ADR-156 Consequences let a topology-changing editor "remap or invalidate" anchors. ADR-156 Decision gives an object without anchors automatic tabs.
    - So the burned tabs are the defined fallback after an invalidation the ADR permits. What is missing is the notice that the twins give: Extend's toast, and ADR-494 Amd 2 D2.
    - A broken twin with a misleading result is P2.
- **Fix direction:**
  - Push the Extend notice from Weld, the Booleans and Offset Shapes (Delete originals) when any source carried placed tabs.
  - For Offset Shapes, the tabs could instead be projected onto the nearest offset contour, as `placedTabPointsForKerfContours` does for kerf.

### N3-P3-1 — #1501's nesting step grows about with the cube of the nesting depth: 100 concentric separate rings take 10.1 s and 300 take 301 s (0.11 s and 0.54 s before), which the ADR's cost note does not cover

- **Where:**
  - `src/core/geometry/vector-path-nesting.ts:127-166`. `ringDepths` visits rings largest first, and `deepestEncloser` tests every larger ring of another batch whose box encloses the ring. For a chain of nested rings, each one is deeper than the last, so the `deeper <= depth` skip never fires and all k larger rings are tested.
  - Each test is two `differenceD` calls (`encloses` / `within`, `:169-176`).
  - `paintedRegion` (`:205-217`) then runs one Clipper op per depth level against the growing region.
- **Anchor:** Contract. ADR-410 Amd 3 Consequences (`docs/decisions/ADR-410-amendment-3-…md:104-108`): "Separately drawn holes cost a containment check each", measured only on flat cases.
- **Scenario:** Offset Shapes or the Offset outlines row on artwork whose closed shapes nest deeply as separate paths. Examples: a topographic map imported with one SVG element per contour (each ColoredPath is a batch), or a set of concentric rings.
  - The work runs in the vector worker (ADR-609), and Apply stays disabled until the preview arrives (`OffsetShapesDialog.tsx:73,95`). So the app does not freeze; the preview and Apply wait minutes.
- **Evidence:** REPRO, `src\ui\state\zz-n3-offset.test.ts` (64-node rings; core `offsetShapes`), on main and with `N3_STUB=1501`:

  | Case | Before (old union, wrong result) | After |
  |---|---|---|
  | 1,600 separate holes in a plate | 119 ms | 1,353 ms (ADR: 50 → 200 ms on its PC) |
  | 100 concentric separate rings | 112 ms | 10,115 ms |
  | 300 concentric separate rings | 538 ms | 300,638 ms |
  | 5,000-node plate + 5,000-node hole | 125 ms | 482 ms |
- **Severity:** P3. The output is right, and the UI stays responsive. Only the wait grows, by about n³.
- **Refuter: CONFIRMED, P3 kept.**
  - **Re-timed on main.** `zz-n3r-rings.test.ts` called core `offsetShapes` on 64-node concentric rings, 2 mm apart, each its own object, offset 0.5 mm outward with round corners.

    | Rings | `offsetShapes` | `nestedSelectionRegion` alone |
    |---|---|---|
    | 25 | 0.46 s | 0.22 s |
    | 50 | 1.19 s | 0.94 s |
    | 100 | 6.59 s | 5.73 s |

    - The nesting step grows ×4.3, then ×6.1, per doubling.
    - The auditor's 10.1 s for 100 rings is the same order of magnitude.
  - **Why it stays P3.** The step runs in the vector worker, and Offset stays disabled until the preview settles (`OffsetShapesDialog.tsx:73,95`). The output is right.
- **Fix direction:**
  - In `deepestEncloser`, scan the larger rings from the smallest up, or stop once a candidate's depth plus one cannot beat the best found.
  - Batch `paintedRegion` into one even-odd pass per maximal chain.
  - Add a deep-nesting case to the ADR's cost table.

### N3-P3-2 — Test-truth gaps: #1502's flip test passes with the fix disabled, and none of N3-P1-1, N3-P1-2 or N3-P1-3 has a test

- **Where:** `src/core/scene/object-extent.test.ts:165-192`, "flips a turned triangle in place instead of moving it 10 mm".
- **Anchor:** the test's own claim, and METHOD L7.
- **Evidence:** REPRO.
  - With `N3_STUB=1502` (old box), `object-extent.test.ts` fails 6 of 10, but the flip test passes.
  - Its triangle (0,0) (40,0) (0,20) fills three corners of its own bounds, so the old box's centre already flips it in place.
  - My triangle (0,0) (40,0) (10,30) at 30° moves 8.66 mm under the old box (`N3_STUB=1502` `flip.triangle`: minX 93.66 → 85.00), and 0 on main.
- **Severity:** P3 (test gap).
- **Refuter: CONFIRMED on the literal parent, P3 kept.** `zz-n3r-flip.test.ts` (`buildSelectionFlipEdit`, outline flattened to 0.001 mm) ran on main and on the `548f67ecb` export.
  - **The PR's triangle** (0,0) (40,0) (0,20) at 30° keeps minX 40.000 when flipped on the parent too. So the test cannot fail before the fix.
  - **The audit's triangle** (0,0) (40,0) (10,30) moves from minX 43.660 to 35.000 (8.66 mm) on the parent, and 0 on main.
- **Fix direction:**
  - Use a triangle that does not fill three corners of its bounds.
  - Add the three tests named in the P1 fix directions.

### N3-P3-3 — ADR-677 Decision 3 says every consumer of the object box follows the outline; some still measure the turned own-bounds box, and the ADR names only part of them

- **Where:**
  - **Single-object handles:** they stay on the object's own turned frame, by design (`src/ui/workspace/handles.ts:9-10`, `:32-61`).
  - **Jig "fit artwork":** `src/ui/workspace/registration-jig/fit-jig-artwork.ts:29` measures `transformedBounds(object.bounds, …)`.
  - **Material experiment capture:** `src/ui/material-library/capture-material-experiment.ts:69` records the cell box from `transformedBounds`.
  - The ADR's Consequences name only fit-to-bed / board / region and Convert to Bitmap as exceptions.
- **Anchor:** Contract. ADR-677 Decision 3 (`docs/decisions/ADR-677-…md:40-48`): "Every consumer of the object box follows, because they share `transformedBBox`: … the selection handles and drag-resize …".
- **Evidence:** READ.
  - Fit to bed was run to show the documented exception: a Ø600 circle at 45° is fitted to 254.558 mm. The tight fit would be 360.
  - That is conservative and is named in the ADR's Consequences.
- **Severity:** P3 (doc/code drift; each case is conservative or not output).
- **Refuter: CONFIRMED (READ), P3 kept.**
  - **The code.**
    - `handles.ts:9-10` puts single-object handles on "the object's transformed local bounds".
    - `fit-jig-artwork.ts:29` and `capture-material-experiment.ts:69` both measure with `transformedBounds(object.bounds, …)`.
  - **The ADR.**
    - ADR-677 D3 lists "the selection handles and drag-resize" among the consumers that follow the outline.
    - Its Consequences exempt only Convert to Bitmap and fit to bed, board or region.
  - **Why it stays P3.** Each case is conservative or does not reach output.
- **Fix direction:** list single-object handles, jig "fit artwork" and the material experiment capture under the exceptions, or route them through `transformedBBox`.

## KNOWN re-observed

- **v7 L1-P3-1 (open): Boolean, Weld and Offset results keep chords only.** Not in #1501's scope. Offset Shapes results are still polylines (`offset-shapes.ts:296-298`), now flattened from a 0.005 mm source.
- **v7 L2-P3-1 (open): four-cubic circles.** Not in #1502's scope. Ellipse-tool shapes are unchanged.
- **v7 L2-P3-3 and L2-P3-5 (open).** #1502 does not touch the polygon Radius field or Design Studio's number boxes.
- **v7 L6-P2-2 (P3, open) and L6-P3-1 / L6-P3-2 (open), named "not done" in #1506.**
  - Corner on a circle still re-aims both handles. Placed tabs there keep their fraction, as ADR-494 Amd 1 Consequences accept for reshapes: they moved 2.97 / 4.22 / 1.82 mm in `sib.corner.circle`.
  - Break still drops the segment into the node.
- **ADR-678 Consequences (#1504, N6's area): typed group rotation drifts on a lopsided layout.** 1.401 mm per 37° round trip and 15.4 mm after 11. #1502's tight box lowers this from 3.783 and 41.6 mm. Not raised: the ADR accepts it, and Undo restores exactly.
- **ADR-677 Consequences: Fit to bed / board / region measure turned art by its own bounds.** A Ø600 circle at 45° is fitted to 254.6 mm, not 360. The ADR calls this "a little smaller"; at 45° it is 29 % smaller. It is conservative and documented, so it is not raised.

## Refuter method

- **When:** 2026-10-29. A fresh context, without the auditor's reasoning.
- **Tree:**
  - `origin/main` is now `c1acfdff6`. `git diff --stat 33bc394c6 origin/main` touches only constant-power advice, the Marlin worker and stop, tracer small marks and their tests. No geometry, shape, tab or jig file changed.
  - The cited files in `…\scratchpad\j7-main\` hash-match `origin/main`.
- **Repro command,** one file at a time from `j7-main`:

  `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n3r-vitest.config.ts --silent=false --disableConsoleIntercept`

  The config is the repo's `vitest.config.ts`, plus an `fflate` alias and one worker.
- **Literal parent tree.**
  - Instead of the auditor's alias stubs, `git archive 548f67ecb src public electron package.json` was extracted to `…\scratchpad\zz-n3r-parent\`, outside `j7-main`, with no links inside.
  - It ran through `zz-n3r-parent.config.ts` in `j7-main`. The config sets `test.dir` to the export and `resolve.dedupe` to every package in `package.json`, so bare imports resolve from `j7-main`'s `node_modules` while every source module comes from the parent.
  - The parent run left the rectangle at scale (2, 1), which shows the parent's code ran.
- **Files and what each checked** (all deleted at the end):

  | File | Checked |
  |---|---|
  | `src\ui\commands\zz-n3r-recttabs.test.tsx`, main and parent | N3-P1-1, through the real toolbar, Shape Properties and `setObjectTransforms`, with the compiled job and G-code |
  | `src\ui\state\zz-n3r-geom.test.ts`, plus a short debug variant | N3-P1-2, N3-P1-3, N3-P2-1 |
  | `src\core\geometry\zz-n3r-rings.test.ts` | N3-P3-1 |
  | `src\core\scene\zz-n3r-flip.test.ts`, main and parent | N3-P3-2 |
- **Other checks:**
  - **Novelty:** greps of `docs/audits/**` outside v8 for each symptom. `gh pr list --state open` shows no open PR touching these files: #1517 is trace, #1478 is CNC and camera.
  - **ADR text:** quoted from `docs/decisions` and `DECISIONS.md` on main.
  - **LightBurn 1.7 docs:** fetched 2026-10-29. Add Tabs, Boolean Tools, Optimize Selected Shapes and Primary Shapes say nothing about what happens to placed tabs on resize or on these edits, so that anchor is UNVERIFIED.
- **Not done:** browser pointer events, a CNC compile (the CNC resolvers were used), and hardware.

## Refuted

The refuter refuted none of the seven findings.

These candidates were dropped before raising:

- **A turned rounded rectangle typed to W 40 burns 39.959 (0.041 mm short).** Chords sit inside the curve, up to 0.025 mm per side. The circle (39.998) and ellipse (39.985) are within the same flattening. Not a defect.
- **The tight-bounds cache thrashes when copies share one `paths` array at different angles.** It does: 500 copies of a 5,000-node path take 55 ms per `combinedBBox`, against 1.4 ms for the old box. But a real circular array does not share `paths`: 100 copies show `shared: false`, and after the first measure (69 ms) a call takes 0.4 ms and a snap move 1.3 ms. Unreachable through the copy path tried, so not raised.
- **The drag-drawn rectangle got r 12.5 after W 200, H 50 and radius 5.** My direct `setShapeSpec` passed 5 in the object's own units. The Shape Properties field divides by the smaller scale first. Through the real field the PR's UI test gives 5 × 5 (7/7 on main).
- **A separate hole that pokes 0.01 mm past the plate's edge is merged into the plate.** Overlap is not enclosure (ADR-410 Amd 3 item 2, LightBurn's "contained within"). A 0.0004 mm (sub-grid) poke is treated as enclosed (1584 mm²).
- **Text on a plate becomes holes under Offset Shapes.** Decided by ADR-410 Amd 3, as LightBurn does. Outer shapes only gives the old result.
- **The out-of-bed outline and Move to bed now ignore kerf, overscan and lead-ins on turned art.** They never included them for unturned art either. Preflight gates on the compiled job (`out-of-bounds.ts:1-3`). Start From and Frame read compiled bounds.

## Verified clean

- **#1501 nesting algebra** (`zz-n3-offset.test.ts`).
  - All 18 join / direction / Outer-shapes-only combinations equal the compound twin.
  - Nesting 3 levels deep (all three directions), holes touching the outer, two touching holes, duplicate holes and plates, a reversed hole, open + closed, text and converted text all behave as decided.
  - The panel offset keeps the hole. Undo after Delete originals restores byte for byte.
  - Curved offsets stay within 0.025 mm out to +100 mm.
- **#1502 typed W / X** on circle, ellipse, hexagon, rounded rectangle, text-like glyph and triangle. Align, distribute, flip, grid gap, Move to bed, marquee, snapping and out-of-bed all follow the outline (REPRO, `zz-n3-bounds.test.ts`).
  - Board-array cell, remote bounds, the Circular / Copy Along Path centre and the Point Rotation pivot use `combinedBBox` / `transformedBBox` (READ: `board-array-plan.ts`, `remote-control/transform-bounds.ts`, `array-dialog-centre.ts`, `CopyAlongPathDialog.tsx`).
  - **Performance:** a 5,000-node path at 30° measures in 0.95 ms. 1,000 moves take 0.98 ms in all (cached), and 100 rotation frames 19 ms. 500 turned objects with their own paths take 3.4 ms first and 1.0 ms after.
- **#1502 rounded-rectangle bake** on every route except the jig sidebar (N3-P1-3): toolbar, group, mirrored, handle frames (no compounding), turned handle, locked at 0° and 30°; one Undo step.
- **#1502 pen:** exact clicks, version stamp honoured by the load migration, dragged nodes curve, close on the first vertex.
- **#1506 tabs** through Delete node (start, middle, circle, non-uniform scale) and Fillet, with exact Undo / Redo. Start, Reverse, Break + Close, Insert, segment conversion, Delete segment + Close and Join keep tabs at 0 mm.
  - **Performance:** deleting the start node of a 5,000-node contour with tabs takes 13.5 ms. A 500-contour path takes 33.5 ms.
- **#1506 fit:** the hump keeps its crest, and ordinary deletes on an 8-node circle keep smooth joins.
- **ADR text against code.** These match the code (where they do not, see N3-P1-3, N3-P3-1 and N3-P3-3):
  - ADR-410 Amd 3 D1–D7. The 0.019 mm cap is 0.025 − 0.005 − 0.001, and 9.5 mm = 0.019 × 500.
  - ADR-677 D1, D2, D4–D6.
  - ADR-144 Amd 1 D2–D5.
  - ADR-214 Amd 1 D1–D3.
  - ADR-307 Amd 3 (READ).
  - ADR-494 Amd 2 D1–D3 and Consequences: circle tabs under 0.3 mm.
  - ADR-371 Amd 1 D1–D3.

## Not verified

- **Browser:** the Offset Shapes and Combine dialogs, the jig editor sidebar and the canvas handles were driven through their store actions and core calls, not real pointer events.
- **Test truth by stubs.** It was checked with alias stubs of each fix's core module, not with literal parent trees. #1502's pen change (`fairingMode: 'exact'`) was not stubbed; v7's repro of the old fairing (10 cubics) stands for "before".
- **LightBurn** was not run. Its handling of manual tabs through Weld / Boolean / resize is unknown.
- **Not traced:** the rulers, the CNC stock check, the Optimize Shapes dialog's live plan path (`startOptimizeShapes` + `planReusing`; Apply was used), and remote / MCP rounded-rectangle resizes beyond `applySelectionTransforms`.
- **Hardware:** none used.

## Repro files

All were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and deleted one at a time at the end. No repo file other than this report was touched. Nothing under the `node_modules` junction was deleted.

| File (under `j7-main\`) | What it did |
|---|---|
| `zz-n3-vitest.config.ts` | Repo config + `fflate` alias + one worker + the `N3_STUB` aliases that disable one fix at a time |
| `src\ui\state\zz-n3-offset.test.ts` | #1501: store repro (all directions, Outer only, row ±1, Undo), joins vs compound twin, 3-level nesting, touching / duplicate / open / text cases, panel offset, Weld / Subtract, curve deviation, closed-enough Weld, cost (N3-P3-1) |
| `src\ui\state\zz-n3-bounds.test.ts` | #1502 ADR-677: typed W / X on six turned shapes against the compiled job, align, distribute, flip, grid gap, Move to bed, marquee, snapping, out-of-bed, fit to bed, typed rotation (single, group / #1504), quarter turns, performance |
| `src\ui\state\zz-n3-rect.test.ts` | #1502 ADR-144 Amd 1: toolbar, radius, Undo, drag flow, narrow-widen, group, uniform 0° / 30°, mirrored, handle frames, turned handle, jig sidebar and store action with compiled corners (N3-P1-3) |
| `src\ui\state\zz-n3-recttabs.test.ts` | N3-P1-1: tabbed rounded / sharp rectangle through toolbar W, locked 2×, handle drag and Shape Properties, with tab spans |
| `src\ui\state\zz-n3-pen.test.ts` | #1502 ADR-214 Amd 1: `finishPen` house, dragged node, zig-zag, compiled box, load migration |
| `src\ui\state\zz-n3-tabs.test.ts` | #1506: Delete node / Fillet repros with compiled spans, the sibling commands (N3-P1-2, N3-P2-1), hump and 8-node circle fits, performance |
| `src\core\geometry\zz-n3-stub-nesting.ts` | `N3_STUB=1501`: `nestedSelectionRegion` → null |
| `src\core\scene\zz-n3-stub-extent.ts` | `N3_STUB=1502`: `objectGeometryExtent` → null |
| `src\core\shapes\zz-n3-stub-rect.ts` | `N3_STUB=1502`: plain-transform `withObjectTransform`, unbaked `rematerializeShapeSpecEdit` |
| `src\core\geometry\zz-n3-stub-tabs.ts` | `N3_STUB=1506`: `withTabsFollowingEdit` returns its input |
| `src\core\geometry\zz-n3-stub-fitfree.ts` | `N3_STUB=1506`: `fitCubicFree` → null |

Two scratch lists used for the tree hash check (`…\scratchpad\zz-n3-hashes.txt`, and a `git ls-tree` dump) were also deleted.

```json
[
  {"id":"N3-P1-1","severity":"P1","area":"fix-geometry","file":"src/core/shapes/rectangle-resize.ts","line":28,"anchor":"Contract: WORKFLOW.md:1150-1151 F-A7c item 4 (placed tabs 'move, rotate and scale with the artwork'); ADR-494 Amd 1 Context (keep each tab at the same physical place, or deliberately handle it); Twin: sharp rectangle and pre-#1502 resize keep tabs exact","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1502: the ADR-144 Amd 1 bake rebuilds a rounded rectangle at its new size via rematerializeParametricShape, which keeps laser/CNC tab anchors as fractions of the old outline; 100x50 r10 with tabs at mid right and mid top edges typed to W 200 burns them 21.33 and 21.71 mm from the scaled places (one on the corner arc; spans (300,275)/(200,250) -> (297.78,253.817)/(178.289,250)); locked 2x 7.57 mm; handle drag same; no toast; r0 and pre-#1502 exact. Shape Properties spec edits did this before #1502 (sharp: 16.7 mm)","refuter":"CONFIRMED, P1 kept. Own repro on main c1acfdff6 through the real NumericEditsBar: toolbar W 200 moves laser and CNC tabs 21.328/21.711 mm (G-code spans G0 X179.289 Y250 -> G1 X177.289 S100 and G0 X297.163 Y253.033 -> G1 X297.916 Y253.889 S100, on the corner arc), locked 2x 7.567 mm, canvas setObjectTransforms same; no toast; r0 controls 0. Same file on a literal git-archive export of 548f67ecb (#1502 parent): scale (2,1)/(2,2), tabs 0 mm, spans X199-201 Y250 and X300 Y274-276 -> regression confirmed. Shape Properties Width 200 moves tabs on parent and main alike (21.3/21.7 r10, 16.7 r0): older sibling, not KNOWN (grep). ADR-156 Decision and ADR-494 item 4 say scale carries/preserves anchors; ADR-494 Amd 1 reshape clause names node edits only; ADR-144 Amd 1 silent on tabs. LightBurn 1.7 Add Tabs page silent: UNVERIFIED"},
  {"id":"N3-P1-2","severity":"P1","area":"fix-geometry","file":"src/ui/state/optimize-shapes-plan.ts","line":144,"anchor":"Contract: ADR-494 Amd 1 Context; WORKFLOW F-A7c item 4; Twin: ADR-494 Amd 2 withTabsFollowingEdit fixes Delete node/Fillet (0 mm on the same part)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Optimize Shapes restarts a closed contour at its first corner (contour-corners.ts:79-87) and keeps tab fractions (optimizedSceneObject spreads the object): on L6-P1-1's 40x20 mid-edge part the GRBL tab span moves (132,300) -> (140,288) and the CNC tab 14.42 mm, while the toast says 'the outlines did not move'; L-shape 15.2/15.8 mm","refuter":"CONFIRMED, P1 kept. Reachable from Tools > Vector > Optimize Shapes (dialog Apply uses the same optimizedSceneObject); no remote/MCP route. Own emitGcode repro: tab span G0 X133 Y300 -> G1 X131 Y300 S100 becomes G0 X140 Y289 -> G1 X140 Y287 S100, laser and CNC 14.422 mm, toast \"...the outlines did not move.\"; Undo restores; corner-start control unchanged. ADR-499 item 7 (2026-09-28) keeps anchor records, ADR-494 Amd 1 (2026-09-29) requires physical place. Same numbers as L6-P1-1 (P1)"},
  {"id":"N3-P1-3","severity":"P1","area":"fix-geometry","file":"src/ui/state/registration-jig-artwork-actions.ts","line":253,"anchor":"Contract: ADR-144 Amd 1 D1 ('Every writer of resize transforms applies it: … the canvas drag frames and the registration jig editor'); Twin: toolbar and jig canvas handles bake","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"The jig editor sidebar's shared artwork size (applyRegistrationJigArtworkSize) writes {...object, transform}; an r3 rounded rectangle typed to 40x10 unlocked stays spec 20x10 r3 at scale (2,1) and compiles 6x3 mm corners; no warning in the jig editor (Shape Properties' stretched note only if selected in the main editor). Refuter boundary: P2 if that note counts","refuter":"CONFIRMED, P1 kept (auditor P2 boundary stands). Own repro: applyRegistrationJigArtworkSize 40x10 unlocked -> spec 20x10 r3 at scale (2,1), compiled 40x10 with 6x3 corners; locked store action 6x6; no toast. Jig sidebar has only X/Y/W/H/rotation (JigSelectionFields.tsx:35-72), no Shape Properties, so the stretched note is not shown in the jig editor; Save to canvas commits (commitJigEditorSession) and the project compiles; the note appears only if the art is selected in the main editor, beside a radius box reading 3; Job Review silent. Jig selection fields and handles do bake. Also seen: the jig Centre fit writes a plain uniform scale (r3 -> r8.1 round), same fix"},
  {"id":"N3-P2-1","severity":"P2","area":"fix-geometry","file":"src/core/geometry/offset-shapes.ts","line":289,"anchor":"Contract: ADR-156 Consequences (DECISIONS.md:7852-7853, deliberately remap or invalidate); Twin: Extend toasts 'Placed tabs on the extended contour were removed. Undo restores them.' (extend-shapes-actions.ts:106); precedent L7-P1-2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Weld, Subtract and Offset Shapes with Delete original objects produce result objects with no laser/CNC tab anchors and push no notice; hand-placed tabs vanish and automatic tabs (if on) apply instead; Undo restores","refuter":"CONFIRMED, P2 kept. Own repro with the project layers: one placed tab (span 112,300) becomes four automatic spans elsewhere after Weld, Subtract or Offset Shapes (Delete originals); result anchors 0; no toast; Undo restores. Not P1: unlike paste (L7-P1-2, named in ADR-494 item 4 and F-A7c item 4), Weld/Booleans/Offset are named in no carry list, and ADR-156 lets a topology-changing editor invalidate anchors with automatic tabs as the fallback; the missing notice (Extend twin, ADR-494 Amd 2 D2) is P2"},
  {"id":"N3-P3-1","severity":"P3","area":"fix-geometry","file":"src/core/geometry/vector-path-nesting.ts","line":147,"anchor":"Contract: ADR-410 Amd 3 Consequences ('Separately drawn holes cost a containment check each', flat cases only)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Nesting depth cost ~n^3: 100 concentric separate rings 112 ms -> 10,115 ms, 300 rings 538 ms -> 300,638 ms (worker; Apply disabled until done); 1,600 flat holes 119 -> 1,353 ms","refuter":"CONFIRMED, P3 kept. Re-timed on main (core offsetShapes, 64-node rings 2 mm apart, one object each): 25/50/100 rings 0.46/1.19/6.59 s, nestedSelectionRegion alone 0.22/0.94/5.73 s; worker, Apply disabled until preview, output right"},
  {"id":"N3-P3-2","severity":"P3","area":"fix-geometry","file":"src/core/scene/object-extent.test.ts","line":165,"anchor":"Test truth (L7)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"#1502's 'flips a turned triangle in place' test passes with the extent disabled (its triangle fills three corners of its bounds); a (0,0)(40,0)(10,30) triangle at 30 deg moves 8.66 mm under the old box. No tests for N3-P1-1/2/3","refuter":"CONFIRMED on the literal 548f67ecb export, P3 kept: the PR triangle (0,0)(40,0)(0,20) at 30 deg flips in place on the parent too (minX 40 -> 40); the audit triangle (0,0)(40,0)(10,30) moves 43.66 -> 35.00 on the parent, 0 on main"},
  {"id":"N3-P3-3","severity":"P3","area":"fix-geometry","file":"docs/decisions/ADR-677-selection-box-is-the-smallest-box-around-the-outline.md","line":40,"anchor":"Contract: ADR-677 D3 vs handles.ts:9-10, fit-jig-artwork.ts:29, capture-material-experiment.ts:69","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"ADR-677 Decision 3 says every consumer follows the outline incl. selection handles; single-object handles, jig fit-artwork and material experiment capture still use the turned own-bounds box and are not among the named exceptions","refuter":"CONFIRMED (READ), P3 kept: handles.ts:9-10, fit-jig-artwork.ts:29, capture-material-experiment.ts:69 use the own-bounds box; ADR-677 D3 names the selection handles, Consequences exempt only Convert to Bitmap and fit helpers"}
]
```
