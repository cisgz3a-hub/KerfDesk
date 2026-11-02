# Rolling audit v9 — R3 Tabs and jig fixes (#1522, #1518)

- **When:** 2026-11-02 +0800   **Tree:** origin/main @ `f862d0d8d` (`git fetch origin main` unchanged at the end).
  - Merge commits: #1522 `7dd26ea04` (parent `6a72b3661`), #1518 `7d7cedcd6` (parent `4f71f1f41`).
  - **Repros ran on main's tree, not the worktree,** in `…\scratchpad\j7-main\`. The 11 source files this report cites most were hash-checked against `origin/main`: all match.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-r3-vitest.config.ts --silent=false --disableConsoleIntercept`. The config is the repo's `vitest.config.ts` plus an `fflate` alias and one worker.
  - **Older code:** plain `git archive <sha> src public package.json` exports of `adf300522` (1.0.27), `33bc394c6` (1.0.28), `6a72b3661` (#1522's parent) and `4f71f1f41` (#1518's parent), in `…\scratchpad\zz-r3-trees\`, outside `j7-main` and with no links. `zz-r3-tree.config.ts` ran them, resolving bare imports through `j7-main`'s `node_modules`.
- **Scope:** fix verification and siblings of:
  - #1522, ADR-494 Amd 3: placed tabs follow a resized rounded rectangle, Shape Properties and Optimize Shapes; Weld, the Booleans and Offset Shapes say when they drop them. Findings fixed: v8 N3-P1-1, N3-P1-2, N3-P2-1.
  - #1518, ADR-144 Amd 1 coverage note: the jig size box and Centre + copy keep round corners. Finding fixed: v8 N3-P1-3.
- **Lenses run:**
  - **L10:** every original repro with tab places measured in emitted GRBL G-code (and CNC rises for the rectangle); siblings; regressions; ADR text against the code; test truth on literal parents.
  - **L9:** toolbar, Shape Properties, canvas handle frames, group resize, jig canvas, jig size box, Centre + copy, Optimize Shapes, Weld, Booleans, Offset Shapes, Dogbone, Shear, Warp, Design Studio sketch and part review, text edit. The remote route was read, not run.
  - **L11:** projects saved by the real code of 1.0.27 and 1.0.28, opened on main, compiled and resized.
  - Not run: browser pointer events (store actions and `scaleObjectByHandleDrag` were driven directly), and LightBurn.
- **Counts:** 7 raised → 0 refuted → P1 2 / P2 3 / P3 2 (+ 5 KNOWN re-observed).
  - **Refuter:** 7 confirmed, 0 plausible, 0 refuted, 0 found KNOWN. No severity changes. See "Refuter method".

## Headline

**Both fix PRs hold for every path they name, on every route tried.** Each original repro now gives the right burn:
- **#1522:**
  - 100 × 50 r 10 typed to W 200 burns its tab spans at machine `(200, 250)` and `(300, 275)`, 0 mm from the stretch. Locked 2×, a three-frame handle drag, the jig canvas and Shape Properties Width all do the same, and the CNC rises equal a part drawn at that size.
  - Optimize Shapes on the 40 × 20 part keeps `(132, 300)`.
  - Weld, Subtract, Intersect, Exclude and Offset Shapes say the tabs were removed, and only then.
- **#1518:** the jig size box to 40 × 10 and Centre + copy keep r 3 on every copy. Placed tabs stay at the middle of their edges on every copy (`rel [1, 0.5]` and `[0.5, 1]`).

Neither PR regressed ordinary shapes. All 13 no-tab scenes emit byte-identical G-code on main and on #1522's parent. A sweep of 74 tabs across 12 resizes found no wrong edge (0 mm worst on straight edges). All 13 of #1522's non-control tests and all 3 of #1518's fail on the literal parents.

Five gaps remain, none in the code these PRs changed for their named paths:

- **R3-P1-1 (sibling, older than both PRs).** Design Studio sketches and parts are rebuilt from their settings but keep each tab's fraction. A Panel part typed from W 100 to W 200 moves tabs at mid-right and mid-top 16.67 mm, and a tab elsewhere up to 30 mm. No notice, and the review says settings "remain attached".
- **R3-P1-2 (gap in #1522's mechanism).** The handle drag re-projects tabs on every frame, so a drag that shrinks and returns ends with tabs moved. One drag of a 300 × 100 r 25 part down to W 50 and back to W 300 leaves two tabs on the top edge 13.41 and 7.89 mm off, with no notice. The final place is still on a straight edge, which ADR-494 Amd 3 D1 says lands "exactly". A sharp rectangle moves 0.
- **R3-P2-1 (sibling of N3-P2-1).** Dogbone drops placed tabs with no notice.
- **R3-P2-2 (sibling).** Shear, Warp and Deform keep each tab's fraction: 2.6 / 6.9 / 16.7 mm at 30° / 45° / 60° shear on a 100 × 50 part, up to 46 mm in a warp.
- **R3-P2-3 (sibling).** A text edit keeps tabs by glyph index: put a letter in front and each tab sits on another letter; take one away and its tab silently stops applying.

The two P3s are test gaps, and a release note for tabs that 1.0.28 already displaced in saved files.

## Fix verification (L10)

| Original finding | Before (literal parent or v8) | After (main) | Siblings | Verdict |
|---|---|---|---|---|
| N3-P1-1, toolbar W 200 | Spans `(178.289, 250)` plus a tab split across the corner arc (parent `6a72b3661`, `expected … length of 2 but got 3`) | Spans `(200, 250)`, `(300, 275)`, laser and CNC at (300, 125) and (200, 150). Spec 200 × 50 r 10. No toast. Undo / Redo exact | Mirror flag, negative scale, 90° and 30° turn, group (both parts), Match size (same edit, read), stadium r max, thin 100 × 2 r 1 to W 300 and W 3, tiny 10 × 5: all on their edge or corner. CNC rises = twin drawn at that size | **Holds** |
| N3-P1-1, locked 2× | 7.567 mm (parent) | (300, 150), (200, 200); r 10 | — | **Holds** |
| N3-P1-1, canvas handle drag | 21.33 / 21.71 mm (v8) | (300, 125), (200, 150) through `scaleObjectByHandleDrag` frames; one Undo step | **A drag that shrinks and returns moves tabs (R3-P1-2)** | **Holds as reported; gap** |
| N3-P1-1, jig canvas | 21.33 / 21.71 mm (parent test fails) | (300, 125), (200, 150) | Jig size box with tabs, below | **Holds** |
| N3-P1-1, Shape Properties Width (r 10, r 0) | 21.3 / 21.7 and 16.7 mm (v8) | (300, 125), (200, 150), no toast | Polygon R 50, star R 60, ellipse W 160: exact, no toast. Sides 6→5→8, star points and ratio: nearest point with the toast. **Sketch and part width: R3-P1-1** | **Holds for drawn shapes** |
| N3-P1-1, Shape Properties Radius | Tabs carried round the part (parent) | r 20: edge tabs 0 mm, no toast. r 0, r 25, r 40 (clamped): corner and swallowed-edge tabs move to the nearest point with the toast; mid-edge tabs 0 mm. Undo / Redo exact | r 0 ↔ r 25 round trip: toast each way | **Holds** |
| N3-P1-2, Optimize Shapes | 14.42 mm, `(132, 300)` → `(140, 288)` (parent) | `(132, 300)` kept, laser and CNC 0 mm; toast exactly "…the outlines did not move."; Undo / Redo exact | Scaled 3 × 0.5 at 20°: 0. Sliver 200 × 0.4, keyhole (out and back), L, tabs 0.1 mm from corners, two contours 0.05 mm apart: 0, and each stays on its contour. Rounded rectangle and ellipse converted by Optimize: at most 0.021 / 0.013 mm, no tab note. Heavy smoothing (0.14 mm): toast names the tabs. 5,000 nodes: 80 ms | **Holds** |
| N3-P2-1, notices | `[]` (parent, 3 of 3 fail) | Weld, Subtract, Intersect, Exclude, Offset with Delete originals: named sentence. Undo restores | **Silent, correctly:** keep operands, Offset kept originals, no placed tabs, refused Intersect, collapsed Offset. A tab only on the other operand: named. Live compound: named, and Expand does not restore them, so the text is true. **Dogbone: silent drop (R3-P2-1)** | **Holds for the three named; sibling** |
| N3-P1-3, jig size box 40 × 10 | 6 × 3 mm corners (v8); parent test fails | Both copies spec 40 × 10 r 3 at scale 1. Tabs at the middle of their edges, spans `(165, 195)`, `(185, 200)`, `(235, 195)`, `(255, 200)`. Locked 80 × 20 keeps r 3. Undo / Redo exact | r 0: plain (2, 1) scale, as ADR-144 Amd 1 D1 says. 90° turn: bakes. 30° unlocked: bakes; r 6.56 from its earlier even fit, clamped by the outline | **Holds** |
| N3-P1-3 "also seen", Centre fit | r 8.1 (parent test fails) | Both copies 54 × 27 r 3; tabs at the middle of their edges on each copy | 30° even fit: plain scale (ADR-144 Amd 1 D2), tabs follow | **Holds** |

**Test truth.** The PRs' tests were copied into the literal parent exports and run one file at a time:

| PR | File | On the parent | On main |
|---|---|---|---|
| #1522 | `NumericEditsBar.rect-tabs.test.tsx` | 4 of 4 fail (7.567 mm; 3 spans where 2 belong) | 4/4 |
| #1522 | `resized-rectangle-tabs.test.ts` | 4 of 4 fail (17.44 mm; x 154.03 instead of 200) | 4/4 |
| #1522 | `optimize-shapes-tabs.test.ts` | 2 of 2 fail (14.42 and 7.21 mm) | 2/2 |
| #1522 | `removed-tabs-notice.test.ts` | 3 of 5 fail; the 2 that pass are the controls | 5/5 |
| #1518 | `RegistrationJigEditor.round-corners.test.tsx` | 3 of 3 fail | 3/3 |

This matches the PR's "13 of 15". The neighbouring suites pass on main: `path-node-curve-command-tabs` 14/14, `path-node-delete-fillet-tabs` 4/4, `path-cleanup-actions` 13/13, `vector-path-join` 12/12, `break-apart-actions` 5/5, `materialized-tab-anchors` 1/1, `trim-cut-shapes-actions` 11/11, `extend-shapes-actions` 13/13.

**Returning user (L11).** Each scene was built and saved by the release's own code (`prepareProjectForPersistence`), then opened on main with `deserializeProject` and `setProject`:

| Saved by | Scenes | G-code moves against the release | Resized once more on main |
|---|---|---|---|
| 1.0.27 `adf300522` | 9 tabbed, 13 no-tab | All identical | Fresh, plain-stretched (2, 1), locked (2, 2): bakes, tabs **0 mm** from the stretch; r 20 kept for the locked one. Sharp, ellipse, mid-edge part: plain scale, 0 mm. Undo exact |
| 1.0.28 `33bc394c6` | 9 tabbed, 13 no-tab | All identical | Fresh, sharp, ellipse, mid-edge: 0 mm. Undo exact. **Tabs 1.0.28 already displaced stay displaced (R3-P3-2)** |
| #1522's parent `6a72b3661` | 9 tabbed, 13 no-tab | All identical | As 1.0.28 |

- A 1.0.27 rectangle at scale (2, 1) burns 20 × 10 corners until it is resized or edited. Then it turns round, as ADR-144 Amd 1 intends. Its tabs follow.
- Agrees with R7's matrix row ("rounded rectangles with tabs … identical"; "resized once more on main … Clean").

**Regression (no tabs).** Thirteen no-tab scenes, each run on main and on `6a72b3661`, with automatic tabs on: rounded rectangle W 200, locked, drag frames, radius; sharp W 200; ellipse; polygon typed; polygon sides; Optimize (mid-edge and rounded rectangle); Weld; Subtract; Offset. **All 13 `.nc` files are byte-identical (`cmp`).** Tabbed scenes with no resize are identical too (`T-fresh`). Both PRs leave the compile code untouched, so automatic tabs and lead-ins with tabs take the same path as before (READ of #1522's and #1518's file lists).

**ADR text against the code.**
- **ADR-494 Amd 3:**
  - D1: both call sites and the box-stretch place match `edited-tab-anchors.ts:131-141`. "Exactly" holds for one step; see R3-P1-2 for a drag.
  - D2: the threshold (tolerance × (1 + largest stretch)) matches `edited-tab-anchors.ts:85-88`, and it reduces to 0.05 mm with no stretch.
  - D3, D4, D5 and the Verification section: match.
- **ADR-144 Amd 1 coverage note:** matches `registration-jig-artwork-actions.ts:94,255`. "The jig's import fit is unchanged": `jig-editor-artwork.ts:38-52` is reached only from the jig import path (READ).
- **WORKFLOW F-A7c item 4** matches the code for everything it names.

## Findings

### R3-P1-1 — Design Studio sketches and parts are rebuilt from their settings but keep each tab's fraction: a Panel part typed from W 100 to W 200 moves tabs at mid-right and mid-top 16.67 mm, up to 30 mm elsewhere, with no notice

- **Where:**
  - `src/core/parts/regenerate-part-generator.ts:37-54` and `:139-149` (`retainTabs`): `{ ...tab, pathIndex: index }`, so `pathT` is unchanged.
  - `src/ui/state/constrained-sketch-bindings.ts:27-39` (`remapAnchors`): `{ ...anchor, pathIndex }`, the same.
  - Neither calls `withTabsFollowingRebuild` (`edited-tab-anchors.ts:62`), which #1522 added beside them.
- **Anchor:**
  - **Contract:** ADR-494 Amd 3 D1 ("When an object is rebuilt from its settings, each laser and CNC tab is located on the old outline … moved by the stretch") names rectangles, ellipses, polygons and stars as covered, but gives no carve-out for other rebuilt objects.
  - **Contract:** ADR-156 Decision (`DECISIONS.md:7839`), scale preserves the anchors; WORKFLOW F-A7c item 4 (`WORKFLOW.md`, "They move, rotate and scale with the artwork").
  - **Twin:** a Shape Properties Width on a sharp rectangle moved the same way (16.7 mm) and was rated P1 under N3-P1-1. #1522 fixed it. The same 100 × 50 rectangle there moves 0 mm.
  - **Misleading text:** the part review says "Artwork placement, rotation …, operation settings and overrides remain attached" (`PartGeneratorReview.tsx:38-39`). The sketch review (`SketchSolveReview.tsx:38-41`) says nothing about tabs.
- **Scenario:**
  1. Create a Panel part, 100 × 50. Place tabs at mid-right (250, 200) and mid-top (200, 225).
  2. Reopen it, type Width 200, review and apply.
  3. The tabs burn at (350, 183.333) and (266.667, 225). The stretch puts them at (350, 200) and (250, 225): **16.67 mm** each.
  - **Other tabs on the same part:** tabs at fractions 0.125–0.8 land 12.5, 30, 10, 12.5 and 30 mm from the stretch.
  - **Sketch:** the default 60 × 30 sketch with `width` 120 moves mid-right and mid-top 10 mm each; other fractions move up to 18 mm.
  - A longer edit moves more. Placed tabs are drawn only while a tab tool is open, and no toast appears.
- **Evidence:** REPRO, `src\ui\state\zz-r3-jig.test.ts` and `zz-r3-sib.test.ts`, through the real `preparePartGenerator` / `acceptPartGenerator` and `reviewConstrainedSketch` / `applyConstrainedSketch`, with `burnedTabSpans` on emitted GRBL:
  ```text
  part.tabs  {"world":[[250,200],[200,225]],"a":[…"pathT":0.4166…,…"pathT":0.6666…]}
  part.after {"world":[[350,183.333],[266.667,225]],"expected":[[350,200],[250,225]],"t":[],"spans":[[350,216.667],[266.667,175]]}
  sk.tabs    {"world":[[230,200],[200,215]],"t":[170,185]}
  sk.after   {"world":[[290,190],[240,215]],"expected":[[290,200],[230,215]],"t":[]}
  sk.spans   [[240,185],[290,210]]
  part.W200  {"p":[[212.5,175],[300,175],[350,200],[287.5,225],[200,225]],"t":[]}   (from [[187.5,175],[240,175],[250,210],[212.5,225],[160,225]])
  ```
- **Severity:** P1, as N3-P1-1: an edit that types a size moves a hand-placed tab along or across the part with no warning. For CNC, a tab that leaves its place can let a part break free. Undo restores it (`sk.undo` exact).
- **Novelty:** new. A grep of `docs/audits/**` for sketch, part generator or regenerate together with placed tabs finds only the v9 R7 line on a stretched sketch, which is not about tabs. `constrained-sketch-bindings.test.ts` and `regenerate-part-generator-bindings.test.ts` pin the path remap, not the place. No open PR touches these files.
- **Fix direction:** after the key remap, re-measure each tab with the #1522 helper, per contour. The whole-object stretch fits the boundary; a hole moves by its own definition, so use each contour's own box. Add the moved sentence to the toast, and say in both reviews that placed tabs follow.
- **Refuter: CONFIRMED, P1 kept, and worse than reported.** False if a Studio object cannot carry placed tabs, if a rebuild drops them, if a notice appears, or if an ADR allows the move. None holds.
  - **Reachable through the real UI path.** `LineTabFields` and `CncTabPositionControls` gate only on one unlocked selected object with `paths` that uses the operation, and they use the path's colour, so a part whose path colour differs from its operation colour still works. `ParametricPartControls` reopens the part. A real `addSelectedLaserTabAnchor` on a new Panel, then `preparePartGenerator` / `acceptPartGenerator`, keeps all the tabs. The sketch does the same through `reviewConstrainedSketch` / `applyConstrainedSketch`. These actions were driven directly; the dialogs were read, not clicked.
  - **Numbers reproduced:** 16.667 mm at mid-right and mid-top. No toast, one Undo step, and the anchor count survives into the review object.
  - **The tab can change edge, which the report did not say.** On the same part W 100 → 200, a tab on the right edge at (250, 180) lands on the bottom edge at (325, 175), 25.5 mm from the stretch. A tab on the left edge at (150, 220) lands on the top edge at (175, 225). The sketch does the same with width 60 → 120: (230, 188) lands at (275, 185). The sketch code's own comment says a removed entity "never transfers a tab to its neighbour", yet a tab does move from one named line to the next here.
  - **CNC, which the auditor did not run.** `compileCncJob` on `profile-outside`, against a twin part drawn at W 200 with tabs placed at the stretched places: deepest-pass rises at (298.746, 226.588), (320.413, 226.588), (351.588, 221.254), (271.254, 173.413), against the twin's (329.412, 226.588), (351.588, 224.588), (351.588, 204.587), (254.587, 173.413). One right-edge tab rises on the bottom edge's cut.
  - **Contract check.** No ADR allows the move, and the report missed the most direct anchor. ADR-573 Decision: "Regeneration preserves machining settings and tabs through uniquely recoverable semantic path identity." The best defence is that this promises only which path a tab stays on, and `retainTabs` does that. But it promises to preserve tabs and gives no leave to move them along or off their edge, and ADR-156's Context asks for "the same physical positions" after ordinary transforms (a regeneration is not named there). ADR-494 Amd 1 Consequences accepts the fraction for edits that "reshape a contour", but Amd 3 D1 opens with "rebuilt from its settings", and its twin (Shape Properties Width on a sharp rectangle) was this same 16.7 mm, rated P1 and fixed.
  - **One correction to the report.** The part review's sentence does not name tabs. It lists "Artwork placement, rotation (…°), operation settings and overrides". So it is an omission that implies nothing moved, not a false statement about tabs. No warning reaches the operator either way, so the correction does not lower the severity.

### R3-P1-2 — The handle drag re-projects placed tabs on every frame, so a drag that shrinks and returns ends with tabs moved: 13.41 and 7.89 mm on a 300 × 100 r 25 part back at its starting size, with no notice

- **Where:**
  - `src/core/shapes/rectangle-resize.ts:46-48`: each `withObjectTransform` bakes, then projects onto the outline at that size.
  - `src/ui/state/store-actions.ts:427`: `applyTransformsToScene` applies it to the current object on every frame. `apply-transform-drag.ts:70` (single object) and `:94-95` ("Applied to the CURRENT objects each frame") feed it.
  - Once a frame has projected a tab onto a corner arc, its old place is gone. `edited-tab-anchors.ts:101-103` then stretches the arc point.
- **Anchor:**
  - **Contract:** ADR-494 Amd 3 D1: "A tab on a straight edge lands exactly where a plain stretch would have burned it, while that place is still on a straight edge of the new outline." At release the place (145, 200) is on the straight top edge, and the tab burns at (158.407, 200).
  - **Contract:** the same drag is one Undo step, and D2 says "Resizes say nothing" on the ground that a tab "stays on that corner". Here a tab that started on an edge ends elsewhere on it.
  - **Twin:** the same drag of a sharp rectangle (plain scale): **0 mm**. The same part dragged only outward and back: 0 mm. The same drag before #1502 scaled by transform and kept the tabs exactly.
- **Scenario:**
  1. A 300 × 100 r 25 part at (100, 100), with tabs on its top edge at x = 145 and x = 175, one at x = 250, and two on the right edge.
  2. Drag the east handle in to x = 150 (W 50) and back out to x = 400 (W 300), one drag: frames 340, 280, 200, 150, 200, 280, 340, 400.
  3. The part is back at 300 × 100 r 25, and it looks unchanged. The tabs at x = 145 and x = 175 now burn at **158.407** and **182.89**. The other three are exact.
  4. No toast.
  - **Ending at another size:** back out only to W 200, the same two tabs land 8.94 and 5.26 mm from the stretch.
  - **Typed in two steps:** W 50, then W 300 gives 19.73 and 7.89 mm. It is two edits, each within D1's words, so this variant is a consequence rather than a separate defect, but it is equally silent.
  - **Small drags stay exact.** A drag that never brings a tab into a corner moves nothing (W 110, 120, 110, 100: 0 mm). Fifty frames from W 100 to W 200 land exactly on straight edges; a corner tab drifts 0.18 mm against one jump.
  - Escape (`cancelInteraction`) restores everything.
- **Evidence:** REPRO, `src\ui\state\zz-r3-more.test.ts`, with the real `scaleObjectByHandleDrag` and `setObjectTransforms`:
  ```text
  over.start [[145,200],[175,200],[250,200],[400,125],[400,175]]
  over.frame150 {"w":50,"t":[[110.149,195.082],[113.815,197.337],[125,200],[150,125],[150,175]]}
  over.end {"spec":{…"widthMm":300,"heightMm":100,"cornerRadiusMm":25},"after":[[158.407,200],[182.89,200],[250,200],[400,125],[400,175]],"moved":[13.407,7.89,0,0,0],"toasts":[],"spans":[[158.407,200],[182.89,200],…],"undoDepth":1}
  over.end200 {"after":[[138.938,200],[155.26,200],…],"expected":[[130,200],[150,200],…],"toasts":[]}
  over.typedBack {"moved":[19.73,7.89,0,0,0],"toasts":[]}
  over.typedBack.r0 {"moved":[0,0,0,0,0]}
  ```
- **Severity:** P1 by METHOD §3 (position, silently, no reach clause).
  - **Boundary for the refuter:** the tab stays on its own edge and the part stays held, and it takes a drag deep enough to put a tab into a corner. If the coordinator weighs "still on its edge" as harmless to the cut, this is P2. Against that: the burn is 13 mm from where it was, on a part whose size did not change.
- **Novelty:** new. It comes from the per-frame projection #1522 added; N3-P1-1 and the PR's tests use only outward frames (130, 170, 200).
- **Fix direction:** during an interaction, measure each tab from the object at the start of the drag (`pendingUndo` already holds it) rather than from the previous frame, so every frame is one stretch from the start. Add a test with a frame that shrinks past the corner and returns.
- **Refuter: CONFIRMED, P1 kept.** False if a real drag maps each frame from its start, or if frames do not commit. Neither holds. `use-workspace-drag.ts:331` calls `applyTransformDrag` on every pointer move with the live project, `nextTransformForDrag` reads `obj.transform` and `obj.bounds` from the current object, and `setObjectTransforms` commits each frame through `withObjectTransform`. The start's anchors survive only in `pendingUndo`, which the frames do not read; only Escape or the end of the drag touches it.
  - **Driven through the real `applyTransformDrag`,** a step closer to the pointer than the auditor's `scaleObjectByHandleDrag` (anchor `nw`, the default): frames 340, 280, 200, 150, 200, 280, 340, 400 give spec 300 × 100 r 25 and tabs at (158.407, 200) and (182.89, 200), **13.407 and 7.89 mm** off. Burned spans match, and CNC deepest-pass rises are 162.994 and 187.478 against 149.587 and 179.588 for an untouched part. No toast, one Undo step.
  - **Same result with two parts selected,** through the `selection-scale` branch: 13.407 and 7.89 mm. **Typed in two steps:** 19.73 and 7.89 mm, as reported.
  - **What the bug needs.** It takes a frame that brings a tab into a corner, then a frame that grows back. A one-way grow is 0 mm. A one-way shrink to W 200 is 0 mm. A one-way shrink to W 50 ends on the corner, 5.586 and 2.97 mm from the stretch, which D1 allows. Down to W 100 and ending at W 220 gives 1.112 mm. Down to W 50 and ending at W 160 gives 5.966 and 3.669 mm. A shallow excursion barely moves it: 100 × 50 r 10 with a tab 15 mm along, down to W 60 and back, gives 0.008 mm. A sharp rectangle gives 0 mm on the reported drag.
  - **Severity decision.** METHOD §3 allows lowering only if the output is not wrong or a clear warning comes first. No warning comes. The output is wrong: the part is the same size, nothing was asked of the tab, and it burns 13 mm from where it was placed. ADR-156's stated purpose for placed tabs is moving them away from weak or visible places, so staying on the same edge does not make the place right. That the depth of drag it needs is uncommon is reach, which cannot lower a reachable defect. ADR-494 Amd 3 D1 does list "the canvas handle drag's frames" as one writer, so each frame alone follows D1, but D1's "lands exactly" sentence fails for the drag as a whole, and D2's reason for saying nothing ("a tab on a corner stays on that corner") does not cover it. For the coordinator: the magnitude is mid-size and needs a deep excursion, but that is not a ground the rules offer.

### R3-P2-1 — Dogbone drops placed tabs with no notice, where Weld, the Booleans and Offset Shapes now name the same loss

- **Where:**
  - `src/ui/state/vector-path-actions.ts:150-157`: `dogboneOperationRegions` then `prepareDogboneEdit`.
  - `:390-400`: `prepareDogboneEdit` copies `locked`, `powerScale` and `operationOverride`, but not the anchors.
  - `src/core/geometry/dogbone-operations.ts:27` starts from `materializeVectorObject`, which carries none.
  - The row: `src/ui/layers/DogboneRow.tsx:61`.
- **Anchor:**
  - **Contract:** ADR-156 Consequences ("deliberately remap or invalidate them rather than guessing"), `DECISIONS.md`.
  - **Twin:** ADR-494 Amd 3 D4 and `removed-tabs-notice.ts` for Weld, Booleans and Offset; Extend's toast.
- **Scenario:** a CNC profile part 100 × 50 with a tab placed by hand on its right edge. Click Dogbone (bit 6 mm). The outline gains its reliefs (5 → 61 points) and the object now has no `cncTabAnchors` and no `laserTabAnchors`. With tabs on, automatic tabs apply wherever their rule puts them. Undo restores the tab. No toast at all.
- **Evidence:** REPRO, `zz-r3-jig.test.ts`:
  ```text
  db.before {"k":"shape","n":5,"a":[{"layerColor":"#000000","pathIndex":0,"polylineIndex":0,"pathT":0.41666…}]}
  db.after  {"k":"imported-svg","n":61,"t":[],"undo":1}     (no anchors)
  db.undo   [{"layerColor":"#000000","pathIndex":0,"polylineIndex":0,"pathT":0.41666…}]
  ```
- **Severity:** P2, held to N3-P2-1's reasoning: ADR-156 permits invalidation, automatic tabs are the defined fallback, and the missing part is the notice.
- **Novelty:** new. A grep of `docs/audits/**` for dogbone with placed tabs or anchors finds no report. N3 did not try Dogbone.
- **Fix direction:** push `removedTabsNotice([...], 'relieved shapes')` after commit. Better, keep them with `withTabsFollowingEdit`: a dogbone leaves most of each edge in place. It would need `materializeVectorObject`'s frame change handled as in `materializedTabAnchors`.
- **Refuter: CONFIRMED, P2 kept.** False if a notice exists or the anchors survive. Real `dogboneSelection(6)` on a tabbed part: 61 points, no `cncTabAnchors` or `laserTabAnchors`, no toast, one Undo step that restores the anchor. `dogboneSelectionMutation` pushes a toast only for `operation-failed`, and `DogboneRow.tsx` has none. Compiled on CNC, the one placed rise at (200, 279.588) becomes four automatic rises at (200, 268.694), (143.694, 250), (100, 281.307), (156.306, 300). ADR-156 permits invalidation and automatic tabs are the defined fallback, so this stays P2 on N3-P2-1's reasoning. The missing part is the notice.

### R3-P2-2 — Shear, Warp and Deform keep each tab's fraction: tabs move 2.6 / 6.9 / 16.7 mm at 30° / 45° / 60° shear on a 100 × 50 part, up to 46 mm in a warp, and the toast says only "Sheared 1 object."

- **Where:**
  - `src/ui/state/shear-actions.ts:59-67`: `{ ...object, paths, bounds }`, anchors unchanged.
  - `src/ui/state/warp-deform-plan.ts:163-164`: `convertAndWarp` copies the anchors as they are. The path branch at `:125` does the same.
  - A shear lengthens the sloped sides but not the others, so each edge's share of the contour changes.
- **Anchor:**
  - **Contract:** WORKFLOW F-A7c item 4: "They move, rotate and scale with the artwork". A shear is the same kind of linear map as a stretch.
  - **Twin:** a non-uniform scale of the same part keeps every tab exact.
  - **Against:** ADR-494 Amd 1 Consequences (lines 104-106) let edits that "reshape a contour rather than restart it" keep the fraction. That text names node edits and Join, not Shear or Warp.
- **Scenario:** a 100 × 50 imported part from a corner, tabs at the middle of each edge. Shear X 60°. Each tab lands 16.67 mm along its edge from the sheared middle, for example (214.434, 133.333) instead of the middle of the right edge at y 125. Warp pulling one corner 60 mm moves the mid-right tab 46 mm, nearly to the corner.
- **Evidence:** REPRO, `zz-r3-more.test.ts`, with the place computed by applying the same map to the old tab place (`warpDeformMap(...).apply`):
  ```text
  shear30 {"moved":[2.578,2.579,2.579,2.578],"toasts":["Sheared 1 object."],"spans":[[98.711,277.233],[138.145,300],[161.855,250],[201.289,272.767]]}
  shear45 {"moved":[6.904,6.904,6.904,6.904],…}
  shear60 {"moved":[16.667,16.666,16.666,16.667],…}
  warp    {"a":[[258.687,101.094],[179.367,150],[164.684,100],[100,132.342],[125.873,100],[213.965,138.363]],"want":[[223.077,130.769],[150,150],[180,100],[100,130.769],[132,100],[180,150]],"moved":[46.354,29.367,15.316,1.573,6.127,35.903],"t":["Warped 1 object."]}
  ```
- **Severity:** P2. The outline visibly changes, and Amd 1 accepts the fraction for reshapes by analogy, so the burn is not plainly against a stated rule.
  - **Boundary for the coordinator:** METHOD §3 has no reach clause and no ADR names these commands, so they could be held to P1 as N3-P1-1 was. The strongest case is Shear, which has an exact answer.
- **Novelty:** new. The grep finds no report.
- **Fix direction:** map each tab's old place through the same matrix or `PointMap`, project with `withTabsFollowingEdit`'s loop, and add the moved sentence. If Warp stays as it is, name it with node edits in Amd 1 Consequences.
- **Refuter: CONFIRMED, P2 kept, with a larger worst case than reported.** False if a fraction stays on the same feature under these maps. It does not, because a shear changes each edge's share of the contour.
  - **Shear, real `shearSelection`:** mid-edge tabs move 0.063 / 0.588 / 2.579 / 6.904 / 16.667 mm at 5° / 15° / 30° / 45° / 60°, matching the report.
  - **The report's worst case is too low.** A tab 4 mm from a corner moves 0.122 / 1.129 / 4.55 / 12.41 / **31.527 mm** at the same angles. From 30° up it also **changes edge**: (196, 100) on the bottom edge lands at (186.041, 100.823) on the sloped side at 30°. Burned spans and CNC rises follow the resolved places.
  - **Warp, real `applyWarpDeform`,** one corner pulled (+60, +60): **45.327 mm** worst (37.715, 45.327, 42.893, 15.182, 26.401, 33.099). This is the report's magnitude; the 46.354 came from a different handle pull. Toasts name only the command.
  - **Why not P1, including Shear.** The reason here is not reach. ADR-156 lists move, rotate, mirror and scale as preserving the anchors and does not list shear. ADR-494 Amd 1 Consequences accepts that edits which "reshape a contour rather than restart it" keep the fraction, so "a tab on an untouched edge shifts by its fraction of the change in length", and these commands keep the contour's start and order. Unlike R3-P1-1, nothing here is rebuilt from settings. The fraction is what the accepted model produces, so the burn is not plainly against a stated rule, and the broken part is the unstated exception.
  - **For the coordinator.** Amd 1 does not name Shear or Warp, and Shear has one exact answer. If the coordinator reads Amd 1 narrowly, Shear is the one to raise, on the 31.5 mm and edge-change figures above.

### R3-P2-3 — A text edit keeps placed tabs by glyph index: with a letter put in front, each tab sits on another letter, and with one taken away its tab silently stops applying

- **Where:** `src/ui/state/scene-mutations.ts:458` (`...objectTabAnchorFields(existing)`, followed by the new `paths` at `:461`). Tabs can be placed on text: `laser-tab-actions.ts:82` allows any object with `paths`.
- **Anchor:**
  - **Contract:** ADR-156 Consequences: "a future topology-changing editor must deliberately remap or invalidate them rather than guessing".
  - **Contract:** ADR-494 Amd 3 D1's "rebuilt from its settings".
  - **Twin:** Design Studio's `remapAnchors` drops the anchor of a removed entity rather than giving it to a neighbour.
- **Scenario:**
  1. Text "AB", with a tab on A and one on B.
  2. Edit to "XAB". The anchors stay at contours 0 and 1, so the tabs are now on X and A, and B has none. A contour with no placed tab takes automatic tabs, or with tabs off none at all.
  3. Edit "AB" to "A". The second anchor stays in the object with `null` position.
  - No toast either way. Font and Bold edits with the same contour count keep the fraction of a different outline.
- **Evidence:** REPRO for the action, `zz-r3-more.test.ts`, the real `upsertTextObject` with hand-built glyph contours (no font was loaded):
  ```text
  text.before    [[110,110],[125,110]]
  text.prepended {"p":[[110,110],[125,110]],"an":[{…"polylineIndex":0…},{…"polylineIndex":1…}],"t":[]}   (X at x 0, A at x 15, B at x 30)
  text.removed   {"p":[[110,110],null],"an":[…two anchors…],"t":[]}
  ```
- **Severity:** P2, on the N3-P2-1 pattern: the user changed what is shown, and the missing part is the remap or notice. Real fonts were not run.
  - **Boundary:** if a refuter reproduces it with a real font and a CNC stencil, where a letter loses its only tab, the effect argues for P1.
- **Novelty:** new. The grep finds no report of tabs through a text edit.
- **Fix direction:** on a content or font edit, drop anchors whose contour identity is lost and say so, as Extend does. Keep them only when the glyph run is unchanged (a size change).
- **Refuter: CONFIRMED with a real font, P2 kept.** False if real glyph contours kept tabs on their letters, or if a notice appeared. Neither holds. Roboto through the real `textToPolylines` and `upsertTextObject`, tabs on the outer contour of A and of B in "AB" (contours: A 0, 1; B 2, 3, 4):
  - **"XAB":** the anchors stay at contours 0 and 2, which are now X's outer contour and **A's counter (a hole)**. The report's hand-built contours could not show the second one. No toast.
  - **"A":** the second anchor stays in the object and resolves to `null`, so it silently stops applying. It would apply again if a later edit brought back a third contour. **"B":** the second tab lands on B's lower counter. **"BA":** both tabs land on B, none on A.
  - **Adding at the end ("ABC")** keeps both on their letters, shifted only by the new line box.
  - **Font change (Anton):** same contour count, so the same fraction falls on a different outline: (115.879, 121.328) becomes (105.01, 125.781).
  - **No letter loses its hold,** which is the boundary the report set for P1. CNC `profile-on-path` deepest-pass rises per contour, 2 tabs per shape: "XAB" with the stale anchors gives X 1, A outer 2, A counter 1, B outer 2, B counters 2 and 2. Every contour without a placed tab takes automatic tabs, as ADR-156 says. On `profile-outside`, the per-contour counts differ from the same text with no anchors only by one rise added on A's counter. So the hand-placed choice on B is lost and a tab appears where nobody put it, but nothing comes free.
  - **Severity:** P2. The user changed what is shown, automatic tabs still hold each letter, and ADR-156 ("remap or invalidate … rather than guessing") is the broken contract. The dialog text and `applyUpsertText` carry no notice. Tabs off is not a separate case, because placed tabs apply only while tabs are on.

### R3-P3-1 — Test gaps: no test carries a placed tab through the jig size box or Centre + copy, or through a polygon, star or ellipse Shape Properties edit

- **Where:**
  - `RegistrationJigEditor.round-corners.test.tsx` measures corners only.
  - ADR-494 Amd 3 D1 says the jig size box and "ellipses, polygons and stars" are covered, but its Verification and tests use rectangles only.
- **Anchor:** METHOD L7, and ADR-494 Amd 3 D1.
- **Evidence:** READ of the tests, and REPRO that the behaviour holds today (`zz-r3-jig.test.ts` `jig.size.spans`; `zz-r3-sib.test.ts` `hex.R50`, `star.R60`, `ell.W160`).
- **Severity:** P3.
- **Fix direction:** add a tabbed case to the jig test and one Shape Properties case per shape kind. Add a drag-overshoot case with R3-P1-2's fix.
- **Refuter: CONFIRMED, P3 kept.** `RegistrationJigEditor.round-corners.test.tsx` has no mention of an anchor. A search of test files that use tab anchors and build a polygon, star or ellipse finds only `vcarve-shape-compilation.test.ts`, which is not a Shape Properties edit. The behaviour itself was not re-run; this is a test gap only.

### R3-P3-2 — Tabs that 1.0.27 and 1.0.28 already displaced stay displaced in saved projects, and nothing tells a returning user to check them

- **Where:** no code path applies; the anchors in the file are simply the anchors. No release note exists yet.
- **Anchor:** ADR-494 Amd 3 Context (N3-P1-1 "regression from #1502", N3-P1-2), and R7's returning-user lens.
- **Scenario:**
  - A rounded rectangle resized on 1.0.28, with tabs at mid-right and mid-top, is saved with them at (297.823, 146.217) and (178.289, 150).
  - On main it burns the same, as a faithful open must. The fix cannot repair it, because the old place is not recorded.
  - The same holds for Optimize Shapes and Shape Properties edits on 1.0.27 or 1.0.28.
- **Evidence:** REPRO, `zz-r3-gen.test.ts` (`33bc394c6.T-typedW200`, `adf300522.T-spW200`, `33bc394c6.T-optimized`): identical moves, tab places as above.
- **Severity:** P3. Output is unchanged and faithful. The improvement is one sentence in the next release's notes ("if you resized a rounded rectangle with placed tabs on 1.0.28, or ran Optimize Shapes on a part with them, check them with the tab tool").
- **Refuter: CONFIRMED, P3 kept.** On main, a 200 × 50 r 10 part given the fractions of the 100 × 50 part resolves to the report's (297.823, 146.217) and (178.289, 150), and `serializeProject` then `deserializeProject` leaves them there. This rebuilt the saved state on main rather than using a file from 1.0.28; the auditor's byte comparison covers the real files. `CHANGELOG.md` has no note telling users to check them.

## KNOWN re-observed

- **ADR-494 Amd 1 Consequences (lines 104-106):** Smooth, Corner, Curve / Line, node and handle drags keep each tab's fraction, and Join of two open paths keeps the first path's fractions. Accepted, and not raised. It is the "against" anchor for R3-P2-2.
- **v8 N3-P3-1:** the nesting cost of Offset Shapes is unchanged. Not re-timed.
- **v8 N3-P3-3:** `fit-jig-artwork.ts` still measures with the own-bounds box. Not re-raised.
- **v7 L1-P3-1:** Weld and Boolean results keep chords only. Seen in `N-weld`, not re-raised.
- **v9 R7:** the matrix row on resized tabbed rectangles agrees with this report's L11.

## Refuter method

- **Tree and command:** main `f862d0d8d` (unchanged by `git fetch origin main` at start and end), in `…\scratchpad\j7-main\`, one file at a time, with a repo config plus an `fflate` alias and one worker. Fresh context, no auditor test files reused.
- **Per finding,** I stated what would make it false and checked that:
  - **R3-P1-1:** read the tab controls' gates, `ParametricPartControls`, `preparePartGenerator` and the ADRs. Ran a Panel and the default sketch through the real store actions, including `addSelectedLaserTabAnchor`. Compiled GRBL and CNC against a twin drawn at the new size.
  - **R3-P1-2:** read `use-workspace-drag.ts`, `apply-transform-drag.ts`, `drag-state.ts`, `handles.ts` and `store-actions.ts`. Drove the real `applyTransformDrag` per move with the live project, for one object and for `selection-scale`, through 12 frame sequences.
  - **R3-P2-1:** real `dogboneSelection`, CNC rises before and after, and the toast code.
  - **R3-P2-2:** real `shearSelection` at 5 angles with mid-edge and near-corner tabs, real `applyWarpDeform`. Expected places came from the sheared corners and from `warpDeformMap`.
  - **R3-P2-3:** Roboto and Anton through `textToPolylines`, then `upsertTextObject`, with CNC rises assigned to the nearest contour.
  - **Holds claim spot-checked:** `applyObjectTransform` to W 200 on 100 × 50 r 10 gives spec 200 × 50 r 10, spans `(200, 250)` and `(300, 275)`, 0 mm from the stretch, no toast. `applyObjectTransform` is a resize writer that goes through `withObjectTransform`; the toolbar itself was not clicked.
- **Limits:**
  - No browser pointer events. `applyTransformDrag` is the call the pointer handler makes, but snapping in `snapWorkspacePointer` was not in the path, and it can only change the point fed in.
  - On `profile-outside` the offsets of close letters merge, so per-contour rises are clearest on `profile-on-path`.
  - Deform was not run separately. It shares `warpObjectPaths` with Warp (READ).
  - Severity reasoning rests on METHOD §3 and the design rules. Coordinator notes are in R3-P1-2 and R3-P2-2.
- **Files:** `zz-r3r-vitest.config.ts` and `src\ui\state\zz-r3r-h.ts`, `zz-r3r-a.test.ts` to `zz-r3r-d.test.ts`, all deleted individually. No `zz-r2*` file or junction content was touched.

## Refuted

The refuter refuted none of the seven findings. These candidates were dropped by the auditor before raising:

- **The bake drops per-path operation bindings.** `rematerializeParametricShape` regenerates paths without `operationIds`. A hand-built rectangle with object operations `[a, b]` and path operations `[b]` compiled `b` before and `a, b` after. It is not reachable: a shape has one path, and `assignSelectionToLayer` binds at object level (`bindSceneObjectToOperations`). A Shape Properties edit did the same before either PR.
- **`BooleanCompoundOperandFields.tsx:19` writes `{ ...object, transform }` and misses the bake.** Operands are `ImportedSvg` (its props type), so no rounded rectangle reaches it.
- **Other `{ ...object, transform }` writers.** `board-outline-register.ts:93` only turns artwork. `array-selection-copies.ts:33,63,67` move and mirror. `jig-editor-artwork.ts:52,80` are the import fit and text. `snapping.ts:41`, `move-point-snap.ts:135` and `remote-control/transforms.ts:89` are measurements. `jig-image-trace.ts:102` holds traced artwork. `remote-control/writes.ts:89` and `arrange.ts:58` use `applySelectionTransforms`, which bakes.
- **The projection picks a wrong edge on a thin shape or near a corner.** It does not. A sweep of 74 tabs across 12 resizes (including 3 × 0.3, 0.11 × 0.11, 10 × 10) shows 0 mm worst for each place still on a straight edge. A sliver 200 × 0.4, a keyhole, tabs 0.1 mm from corners and two contours 0.05 mm apart all stay in place.
- **Tab mapping is slow.** 10 tabs: 0.29 ms per frame. 1,000: 5.5 ms. 10,000: 48 ms. A rectangle with none: 0.017 ms, unchanged. 1,000 tabbed rectangles in one frame: 155 ms, which is not a realistic drag. 5,000-node Optimize with tabs: 80 ms.
- **Mirrored resize lands wrong.** The first run looked off because of a mistake in my setup. Mirror flag and negative scale both land on the stretched edge.
- **30° jig size box "misses" 40 × 10.** The box is measured in the object's own frame (`frameRotationDeg`), unchanged by #1518. r 6.56 comes from the earlier even fit (ADR-144 Amd 1 D2) and the outline clamps it to 5.

## Verified clean

- **Rounded rectangle tabs through:** toolbar, locked, handle frames, jig canvas, Shape Properties Width and Radius, group resize, mirror flag, negative scale, 90° and 30° turn, stadium, thin, tiny; Undo / Redo of each; laser and CNC (`c.W200` rises equal the drawn twin).
- **Parametric shapes:** polygon, star, ellipse through Shape Properties and the toolbar. Sides, points and ratio toast only when a tab really left its place.
- **Other commands:** Reverse, Convert to Path (fresh and after a resize), Break Apart of one contour: 0 mm (REPRO). Close Path, Start, Join, Trim, Extend: existing suites pass on main; I placed no new tab through them (N3 measured 0 mm on them).
- **Notices:** only when tabs were really lost, across keep, refused and collapsed cases.
- **Jig:** size box and Centre + copy, locked and unlocked, 0°, 90°, 30°; r 0 stays plain; one Undo step; every copy carries its tabs.
- **L11:** 1.0.27, 1.0.28 and parent files: identical moves on open, correct on the next resize.
- **Regression:** 13 no-tab scenes byte-identical; automatic tabs included.
- **ADR text and test truth:** see above.

## Not verified

- **Browser pointer events:** the frames used `scaleObjectByHandleDrag` and `setObjectTransforms`, but not a real pointer. The jig sidebar was driven through its action (`applyRegistrationJigArtworkSize`) rather than the UI; #1518's own UI test covers the UI.
- **Remote route:** read, not run (`writes.ts:89`).
- **CNC cut for a sketch:** laser places only. The refuter compiled the CNC cut for the part (R3-P1-1), and the sketch's anchors read the same fraction.
- **Variable text records and path text with tabs.** The refuter ran text with real fonts (R3-P2-3).
- **Barcode regeneration with tabs,** retained arrays, Saved Artwork insert.
- **Array dialog scale:** `array-selection-copies.ts:73-88` writes a plain even scale, so a rounded rectangle's radius grows with it. I could not confirm a UI route sets `placement.scale`, so it is not raised.
- **Lead-ins with tabs:** not run. The compile code is unchanged by either PR (`line-tabs.ts:33`: tabbed contours get no laser leads).
- **LightBurn** was not run; its handling of tabs through these edits is unknown.
- **Hardware:** none used.

## Repro files

All were deleted individually at the end. Nothing under the `node_modules` junction was touched, and no `zz-r2*` file was touched. No repo file other than this report changed.

| File | What it did |
|---|---|
| `j7-main\zz-r3-vitest.config.ts` | Repo config + `fflate` alias + one worker |
| `j7-main\zz-r3-tree.config.ts` | Runs a test inside an exported older tree, with bare imports from `j7-main` |
| `j7-main\src\ui\state\zz-r3-helpers.ts` | Part builder, tab measurement, typed and drag helpers (also copied into each export) |
| `j7-main\src\ui\state\zz-r3-core.test.ts` | Original N3-P1-1 routes; resizes through mirror, turn, group, stadium, thin; Radius toasts |
| `j7-main\src\ui\state\zz-r3-sib.test.ts` | Polygon, star, ellipse, sketch, part; Optimize variants; every notice; Reverse, Convert, Shear, Warp, Break Apart |
| `j7-main\src\ui\state\zz-r3-jig.test.ts` | Jig Centre and size with tabs; sketch and part spans; CNC rises; Dogbone |
| `j7-main\src\ui\state\zz-r3-more.test.ts` | Drag overshoot (R3-P1-2); projection sweep; thin and keyhole Optimize; performance; Shear and Warp distances; text edit |
| `j7-main\src\ui\state\zz-r3-last.test.ts` | Heavy smoothing notice; per-path operations through a bake (refuted) |
| `j7-main\src\ui\state\zz-r3-gen.test.ts`, `…\scratchpad\zz-r3-gen.test.ts` | Save phase in each tree, open phase on main (L11, byte comparison) |
| `…\scratchpad\zz-r3-run.sh`, `zz-r3-truth.sh`, `zz-r3-l11.sh`, `zz-r3-suites.sh` | Runners, one test file at a time |
| `…\scratchpad\zz-r3-trees\` | Exports of `adf300522`, `33bc394c6`, `6a72b3661`, `4f71f1f41`, plus the PRs' test files copied in for test truth |
| `…\scratchpad\zz-r3-saves\` | Saved `.lf2` projects and `.nc` files for each release |

```json
[
  {"id":"R3-P1-1","severity":"P1","area":"fix-tabs-jig","file":"src/core/parts/regenerate-part-generator.ts","line":139,"anchor":"Contract: ADR-573 Decision (regeneration preserves machining settings and tabs through semantic path identity), ADR-494 Amd 3 D1 (rebuilt from settings carries each tab by the stretch), ADR-156 Decision (scale preserves anchors), WORKFLOW F-A7c item 4; Twin: Shape Properties Width on a rectangle, 0 mm since #1522","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Design Studio parts and sketches are rebuilt from settings but retainTabs / remapAnchors keep pathT: Panel W 100 to 200 moves mid-right and mid-top tabs 16.67 mm (spans (350,216.667),(266.667,175)), other tabs up to 30.67 mm, and a tab can change edge ((250,180) right edge to (325,175) bottom edge); sketch width 60 to 120 moves them 10 mm, up to 18.33; CNC rises differ from a twin drawn at W 200; no toast; part review lists what stays attached without naming tabs"},
  {"id":"R3-P1-2","severity":"P1","area":"fix-tabs-jig","file":"src/core/shapes/rectangle-resize.ts","line":46,"anchor":"Contract: ADR-494 Amd 3 D1 ('lands exactly where a plain stretch would have burned it, while that place is still on a straight edge'); Twin: sharp rectangle 0 mm, pre-#1502 exact","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Handle drag re-projects tabs each frame on the current object: 300x100 r25 dragged to W 50 and back to W 300 in one drag leaves top-edge tabs 13.41 and 7.89 mm off through the real applyTransformDrag, single object and selection-scale, burned spans and CNC rises agree, no toast, one Undo step; ending at W 200 8.94 / 5.26 mm; typed W 50 then W 300 19.73 / 7.89 mm. One-way grow 0 mm; needs a frame bringing a tab into a corner, then growth. Stays on its edge but P1 kept: output is wrong, no warning, depth of drag is reach"},
  {"id":"R3-P2-1","severity":"P2","area":"fix-tabs-jig","file":"src/ui/state/vector-path-actions.ts","line":390,"anchor":"Contract: ADR-156 Consequences (deliberately remap or invalidate); Twin: ADR-494 Amd 3 D4 removedTabsNotice for Weld, Booleans, Offset; Extend's toast","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Dogbone rebuilds the object without laser or CNC tab anchors and pushes no toast; one placed CNC rise becomes four automatic rises; Undo restores"},
  {"id":"R3-P2-2","severity":"P2","area":"fix-tabs-jig","file":"src/ui/state/shear-actions.ts","line":59,"anchor":"Contract: WORKFLOW F-A7c item 4 (move, rotate and scale); Twin: non-uniform scale exact; Against: ADR-494 Amd 1 Consequences lines 104-106 (reshape keeps fraction, names node edits and Join only)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Shear, Warp and Deform keep each tab's fraction: 2.578 / 6.904 / 16.667 mm at 30 / 45 / 60 degree shear on 100x50 for mid-edge tabs, 4.55 / 12.41 / 31.527 mm for a tab 4 mm from a corner, which changes edge from 30 degrees; up to 46.354 mm in a warp; toast names only the shear or warp. P2 kept on ADR-494 Amd 1's reshape rule, not on reach; Amd 1 does not name them, so Shear is the coordinator's call"},
  {"id":"R3-P2-3","severity":"P2","area":"fix-tabs-jig","file":"src/ui/state/scene-mutations.ts","line":458,"anchor":"Contract: ADR-156 Consequences (remap or invalidate rather than guessing); Twin: Design Studio remapAnchors drops a removed entity's anchors","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"upsertTextObject keeps anchors by contour index, with Roboto: AB to XAB leaves tabs on X's outline and A's counter and none on B; AB to BA puts both on B; AB to A leaves an anchor with null position; a font change keeps the fraction of another outline; no toast. Every contour without a placed tab takes automatic tabs, so no letter comes free"},
  {"id":"R3-P3-1","severity":"P3","area":"fix-tabs-jig","file":"src/ui/workspace/registration-jig/RegistrationJigEditor.round-corners.test.tsx","line":1,"anchor":"METHOD L7; ADR-494 Amd 3 D1 names the jig size box and ellipses, polygons and stars","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"No test carries a placed tab through the jig size box, Centre + copy, or a polygon, star or ellipse Shape Properties edit; behaviour holds today by repro"},
  {"id":"R3-P3-2","severity":"P3","area":"fix-tabs-jig","file":"docs/decisions/ADR-494-amendment-3-tabs-follow-rebuilt-outlines.md","line":18,"anchor":"ADR-494 Amd 3 Context; R7 returning-user lens","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tabs 1.0.27 or 1.0.28 already displaced (resize, Shape Properties, Optimize) stay displaced in saved files, faithfully; the next release notes should tell users to check them with the tab tool"}
]
```
