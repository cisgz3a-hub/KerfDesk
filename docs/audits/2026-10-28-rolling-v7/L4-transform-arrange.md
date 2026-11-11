# Rolling audit v7 — L4 Transform and arrange

- **When:** 2026-10-28, about 14:00–14:30 +0800.
- **Tree:** origin/main @ `6e388bb56` (#1499) at the start (`git fetch origin main`).
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\`** (main `f1d919fbf`). `git diff --name-only f1d919fbf 6e388bb56 -- src electron` lists 64 files: device profiles, timing, controllers, preflight and project device validation. None is in L4's scope.
  - The 29 audited files below were checked with `git show origin/main:<path> | cmp - j7-main/<path>` and are byte-identical. `WORKFLOW.md` differs only at line 4748, outside F-A6. The files are `selection-transform.ts`, `selection-rotate.ts`, `selection-align.ts`, `selection-distribute.ts`, `array-layout.ts`, `array-grid-layout.ts`, `array-circular-layout.ts`, `hit-test.ts`, `tile-into-region.ts`, `board-array-plan.ts`, `copy-along-path.ts`, `copy-along-path-guide.ts`, `vector-path-tools.ts`, `arrange-entities.ts`, `transform-selection.ts`, `selection-transform-actions.ts`, `array-actions.ts`, `array-selection-copies.ts`, `NumericEditsBar.tsx`, `TransformAnchorPicker.tsx`, remote `board.ts`, `transforms.ts` and `arrange.ts`, `snapping.ts`, `handles.ts`, `rotate-handle.ts`, `BoardArrayForm.tsx`, `DECISIONS.md` and `electron/mcp/tool-info.ts`.
  - **fflate alias.** The junctioned `node_modules` has no top-level `fflate`, so every repro used a temporary `zz-l4-vitest.config.ts`: the repo config plus one alias to `.pnpm/fflate@0.8.3/…/esm/browser.js`, with `maxWorkers: 1`.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --config zz-l4-vitest.config.ts --silent=false --disableConsoleIntercept`.
- **Scope:**
  - **Transforms:** move, scale, rotate and mirror, typed and by handle. Code: `core/scene/selection-transform.ts`, `selection-rotate.ts`, `selection-placement.ts`, `ui/commands/NumericEditsBar.tsx`, `ui/workspace/handles.ts` and `rotate-handle.ts`. Also nudge, and Two-Point Rotate / Mirror Across Line by reading.
  - **Arrangement:** align and distribute (`selection-align.ts`, `selection-distribute.ts`, `selection-units.ts`). Arrays: Grid, Circular and Point Rotation (ADR-307: `array-*-layout.ts`, `array-actions.ts`, `array-selection-copies.ts`). Copy Along Path (`copy-along-path*.ts`). Fill the board (ADR-125: `board-array-plan.ts`, `tile-into-region.ts`, `board-tile-actions.ts`). Duplicate.
  - **Organisation:** groups, nested groups, ungroup, lock and hide.
  - **Snapping:** move-drag box and grid snap (`snapping.ts`), point snap (`snap/scene-snap-query.ts`, `move-point-snap.ts`), and the 15° rotate snap.
  - **Design Studio ops:** `arrange-entities.ts`, `scale-entities.ts`, `stretch-entities.ts`, `translate-entities.ts` and `transform-selection.ts`.
  - **Remote/MCP:** `transform_artwork` (move, resize, rotate), `arrange_artwork` (align, distribute, mirror, group, duplicate) and `place_on_board` (array). The same commands run inside `apply_edits`.
- **Lenses run:**
  - **L2 ground truth:** analytic positions, angles and gaps. LightBurn 1.7 docs at versioned paths, all fetched 2026-10-28: Numeric Edits Toolbar, Align, Distribute, Circular Array and Copy Along Path.
  - **L4 adversarial:**
    - 1,000-step accumulation: 360 × 1°, 1,000 × 0.1 mm nudges, 1,000 alternating resizes, 400 quarter turns;
    - all 9 anchors;
    - a rotated, scaled and mirrored asymmetric shape;
    - a negative handle scale;
    - huge rotations (3.6e6 to 1e17°);
    - 0-, 1- and 10,000-copy arrays;
    - nested groups;
    - a locked group member;
    - tiny and oversized cells on board arrays.
  - **L9 entry-point parity:** desktop toolbar, handles and menus against Design Studio and remote/MCP; canvas against `.lf2` against compiled output; Undo.
  - **Skipped:** L7, except where a P3 notes a test gap; canvas pixels (L8); Design Studio snapping internals (L5).
- **Counts:** 8 raised → 1 refuted (L4-P3-6) → P1 0 / P2 2 / P3 5 (+ 2 KNOWN re-observed; 5 older items re-checked as fixed).
  - **Refuter (2026-10-28, fresh context):** 7 CONFIRMED, 0 PLAUSIBLE, 1 REFUTED (L4-P3-6). Each confirmed finding was re-run with the refuter's own repro on `j7-main`.
    - During the refutation main moved to `47ff19d8d` (#1500, Marlin and network streaming, ADR-676). Its diff from `6e388bb56` touches no L4 file. `NumericEditsBar.tsx`, `selection-transform.ts`, `remote-control/board.ts`, `tile-into-region.ts`, `board-array-plan.ts`, `selection-transform-actions.ts` and `copy-along-path.ts` in `j7-main` match `origin/main`.
  - **Severity changes:** none.
    - L4-P2-2 stays **P2**, not P1. Every copy that burns has the planned position and scale, and canvas, file and output agree. The missing copies would not fit the board. The wrong part is the receipt.
    - L4-P2-1 stays **P2**. No other desktop route takes a typed angle for a multi-selection.
  - **Corrections:**
    - **L4-P3-3:** both WORKFLOW drift claims fail. The finding narrows to the missing ADR.
    - **L4-P3-2:** the MCP reference is documented in `electron/mcp/README.md`, though not in the tool description.
    - **L4-P2-2:** the phone app has no place-on-board control. Only MCP agents reach the command.
    - **L4-P3-4:** the centre shift depends on the shape's size. A 20 × 10 rectangle gives half the auditor's figures.
    - **L4-P3-6:** the cap is recorded in an ADR-125 amendment and in WORKFLOW F-BC2.

## Headline

**The transform core is exact, including under accumulation.** All of these held to at most 2.1e-14 mm, with the 1,000-nudge sum the only exception:
- typed X/Y at all 9 anchors;
- typed W/H at all 9 anchors, on a multi-selection that includes a 90° object;
- typed R;
- 360 typed angles in sequence;
- 360 × 1° rotate-by on one object, and on a three-object selection (7.6e-13 mm);
- 400 quarter turns;
- 1,000 alternating resizes;
- flip, flipping twice, and Mirror Across Line;
- align and distribute against analytic positions;
- grid, circular and Point Rotation placements;
- node and centre snaps on a rotated, scaled and mirrored object;
- remote rotate against desktop rotate-by (difference 0).

The 1,000 × 0.1 mm nudges drift 2.0e-12 mm, which is float noise. The compiled output matches the canvas after a flip with arc moves on (4 arcs, 111.423 mm against 111.416 analytic) and after a negative handle scale. `.lf2` keeps `scaleX −1`.

**Refuter spot-check: the headline holds.** These are the refuter's own numbers (`zz-l4r-core.test.ts`), against analytic values:
- **1,000 × 0.1 mm nudges** from x 10.3 end at 110.29999999999802, an error of −1.98e-12.
- **360 × 1° rotate-by** returns a single 20 × 10 rectangle within 1.6e-14 mm. A three-object layout (one at 30°, one mirrored and scaled) returns within 3.2e-13 mm.
- **360 typed angles in sequence** return within 1.6e-14 mm.
- **Circular array** of 6 copies, r 40, centred at (100, 100): placement error 0 and rotation error 0 (90, 150 … 390).
  - End 90° with 5 copies gives 0, 22.5, 45, 67.5, 90.
  - End 360° with 4 copies gives 0, 90, 180, 270, with no doubled copy.

**Where results depart from what was typed, requested or documented:**

- **L4-P2-1.** Numeric Edits' **Rotation box is disabled for any multi-object selection, including a single group.** It is empty, and nothing explains why. A grouped design therefore cannot be turned by a typed angle on the desktop. The only ways are 90° turns, Shift's 15° steps, or Two-Point Rotate by clicks.
  - LightBurn 1.7: "Use the Rotate field to turn the current selection by a precise number of degrees", with "all objects in your current selection … treated as a single unit".
  - The remote `transform_artwork` rotate does the same job exactly.
- **L4-P2-2.** Remote **`place_on_board` array** answers `{"status":"placed","action":"array","artworkCount":1}` however many copies fit.
  - A 5 × 5 request on a 200 × 100 board placed **20** copies.
  - The desktop form says "20 fit; 25 requested." The remote receipt says nothing about the shortfall, or about the 500-copy cap.
  - Only MCP agents reach this command; the phone app has no place-on-board control. The refuter kept it at P2: the burned copies are right, and the receipt misleads.
- **P3s:**
  - **L4-P3-1.** Copy Along Path with Rotate copies turns each copy by the chord of the 0.025 mm-flattened guide, not the curve's tangent. Copies on a circle guide are off by up to 5.66° at r 5, **3.85° at r 10**, 1.79° at r 50 and 0.90° at r 200. The Circular Array twin is exact (0°).
  - **L4-P3-2.** The Align reference has three rules.
    - A marquee selection aligns to the **top-most** object. LightBurn uses the first in draw order.
    - Design Studio aligns to the selection's bounds.
    - MCP uses the last listed id, which the tool description does not say.
  - **L4-P3-3.** Rotation always pivots about the centre. LightBurn's 9-dot anchor "determines the center of rotation". The choice was made in a commit (`1326b05b1`) and no ADR records it. The refuter found that WORKFLOW F-A6 is consistent with it.
  - **L4-P3-4.** A huge typed angle is not reduced mod 360 before the trig, so R = 1e17 moves the "fixed" centre 1.72 mm on the auditor's shape. The refuter measured 0.86 mm on a 20 × 10 rectangle; the shift grows with the shape's size.
  - **L4-P3-5.** A locked group member stays put while desktop transforms move the rest of the group. The remote refuses the same edit whole.
  - ~~**L4-P3-6.**~~ **REFUTED.** Array on board's 500-copy cap is recorded in ADR-125's 2026-07-08 amendment and in WORKFLOW F-BC2 (see Refuted).

**KNOWN 08-P3-3 (re-rated P1 in v7 L2) reaches every arrange tool.** Align, distribute, grid gaps, flip, box snaps, Point Rotation's pivot and the Circular / Copy Along Path source centre all measure a rotated object by its rotated own-bounds rectangle. New L4 consequences, all by repro:
- a Ø50 circle at 45° aligned Left sits **10.36 mm** off the reference edge (the refuter's own repro gives 10.358);
- a grid with a typed 2 mm gap burns a **22.72 mm** gap;
- Flip Horizontal moves a 30° right triangle **10 mm** sideways.

This is cited, not re-raised.

| operation | input | expected | KerfDesk | verdict |
|---|---|---|---|---|
| Typed X/Y, each of 9 anchors (2 objects, one at 90°) | X 123.456, Y 78.9 | anchor lands on the typed point | max error 1.4e-14 mm | exact |
| Typed W/H unlocked, each of 9 anchors (same selection) | 150.5 × 60.25 | anchor fixed; W/H exact | anchor error 0; W/H error 0; tight geometry 150.5 × 60.25 | exact |
| Typed W locked, rectangle at 30° | W 100 | 100 | readout 100, tight 100; NW anchor fixed (1.8e-15) | exact |
| Typed R, single object | 75 | 75 about the centre | 75; centre shift 0 | exact |
| Typed R 1, 2 … 360 in sequence | 360 entries | back to start | geometry difference 2.1e-14 mm | exact |
| Rotate-by 1° × 360, single object | — | identity | 2.1e-14 mm | exact |
| Rotate-by 1° × 360, 3 objects (L layout) | — | identity | 7.6e-13 mm (single 360°: 2.9e-14) | exact |
| Quarter turn × 4 and × 400, 3 objects | — | identity | 1.0e-14 mm | exact (not bit-identical) |
| Nudge 0.1 × 1000 against one move of 100 | x0 10.3 | 110.3 | 110.29999999999802 (−2.0e-12) | exact (float) |
| W alternating 50.123 / 80.456 × 1000, anchors c / se / nw | — | anchor fixed | drift ≤ 7.1e-15 mm; final W error 0 | exact |
| Flip H, triangle at 37°, scale (1.3, 0.7), mirrorY | — | reflection about the selection centre | max error 0; twice gives an identical transform | exact |
| Mirror Across Line y = x | — | (x, y) → (y, x) | 7.1e-15 mm; twice gives identity | exact |
| Typed R, huge | 3.6e6+30 / 1e10+30 / 1e15 / 1e17 | centre fixed | shift 9.5e-11 / 8.6e-8 / **0.019** / **1.72 mm** | **L4-P3-4** |
| Align ×7 kinds, three rects of mixed sizes, reference C | — | analytic edges and centres | exact for all 21 boxes | exact |
| Distribute H spacing / H centres, 4 rects (10, 30, 5, 20 wide) | — | equal gaps / equal centre steps | gaps 45, 45, 45 / steps 61.667 × 3 | exact; matches LightBurn's "Spaced" / "Centered" |
| Align Left: Ø50 circle at 45° to a rect | — | circle edge on the reference edge | **10.36 mm** off (loose box flush) | KNOWN 08-P3-3 |
| Grid 3 × 4, gap 5 × 2, on 20 × 10 | — | dx 0, 25, 50, 75; dy 0, 12, 24 | same | exact |
| Grid by centres 30 × 15; row shift 12.5 / column shift −3 | — | analytic | same | exact |
| Grid gap on a Ø50 circle at 45° | gap 2 | 2 | **22.72** | KNOWN 08-P3-3 |
| Circular 6, r 40, centre (100, 100), rotate copies | — | ring points every 60°; rotation θ + 90 | centre error 1.4e-14; rotation error 0 | exact |
| Circular, end 90°, 5 copies / end 360°, 4 copies | — | 0, 22.5 … 90 / 0, 90, 180, 270 | same; no doubled end copy | exact |
| Point Rotation 4 over 360° | — | 0, 90, 180, 270 about the selection centre | same | exact (pivot: KNOWN 08-P3-3 for rotated art) |
| Copy Along Path, circle guide r 5 / 10 / 50 / 200, 12 copies, rotate | — | copy turned to the tangent | angle step error ≤ 0.008°; radial ≤ 0.022 mm; **tangent error 5.66° / 3.85° / 1.79° / 0.90°** | **L4-P3-1** |
| Copy Along Path, open 100 mm line | spacing 25 / 30; gap 5 (10 mm art); count 5 with offsets 10 / 10; spacing 0 | 0 … 100 step 25; 0, 30, 60, 90; 0, 15 … 90; 10, 30 … 90; refused | same; spacing 0 is `no-step` | exact |
| Fill the board, rect 200 × 100, 30 × 20 cell, gap 2 | fill / grid 5 × 5 | inside, no overlaps | 24 / 20 tiles, 0 overlaps, 0 outside | clean |
| Fill the board, circle Ø150, rows / square packing | fill | inside the circle, no overlaps | 18 / 12 tiles, 0 / 0 | clean |
| Fill the board, 1 × 1 cell | fill | 20,000 fit | 484 (cap 500; named on the desktop form) | recorded cap (ADR-125 Amd 2026-07-08); L4-P3-6 refuted; silent remotely (L4-P2-2) |
| Remote `place_on_board` array | rows 5, cols 5 | receipt names the shortfall, as the desktop form does | 20 placed; receipt "placed", no count | **L4-P2-2** |
| Point snap on a rect at 33°, scale (1.7, 0.6), mirrorX | node / centre | exact world point | 7.1e-15 / 0 mm | exact |
| Flip H of a rounded rect at 30°, arcs on, `emitGcode` | — | burned length = perimeter 111.416 | 111.423 before and after (4 G2/G3 + 4 G1) | exact (arc direction kept) |
| Handle scale: `e` dragged past the anchor | to x −30 | canvas = compiled = `.lf2` | scaleX −1; canvas x −30…10 = compiled; `.lf2` keeps −1 | exact |
| Remote rotate 37° against desktop rotate-by 37° | 2 objects | identical | max difference 0 | exact |
| Design Studio rotate-right × 4, rotate-left × 400, flip H × 2 | rect r3, arc, circle, path | identity | identical / bounds drift 0 | exact |
| Design Studio uniform scale 2.5 about (10, 10) | — | 2.5 | 2.5 on every entity | exact |
| Array 2 × 2 of a nested group (2 in 3) | — | 4 instances, nesting kept | 12 objects, 8 groups, 4 with a parent, positions exact; Undo gives the identical Project | exact |
| Array 100 × 100 / circular 10,000 more | — | room check (ADR-307 Amd 1) | 10,000 accepted at the limit; the next refused with a notice | clean |
| Flip H of a right triangle at 30° | — | stays in its box (as Design Studio does) | tight box moves 40…74.64 → 50…84.64 (**10 mm**) | KNOWN 08-P3-3 |

## Findings

### L4-P2-1 — Numeric Edits' Rotation box is disabled for any multi-object selection, including a single group, so a grouped design cannot be turned by a typed angle

- **Where:**
  - `src/ui/commands/NumericEditsBar.tsx:141`: `rotationValue: metrics === null ? null : metrics.rotationDeg`.
  - `:179`: `disabled={model.rotationValue === null}`.
  - `src/core/scene/selection-transform.ts:75`: `rotationDeg` is `null` unless `objects.length === 1`.
  - `:255`: the core also refuses with `multi-rotation`. The message at `NumericEditsBar.tsx:420`, "Rotate one object at a time in Numeric Edits.", is never shown, because the box is disabled first.
  - Since `4750a1685` ("feat: add precision numeric edits"). No ADR covers it (`grep` of `DECISIONS.md` and `docs/decisions` for multi-rotation).
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Numeric Edits Toolbar (https://docs.lightburnsoftware.com/1.7/Reference/NumericEditsToolbar/, versioned path, fetched 2026-10-28):
    - "Use the Rotate field to turn the current selection by a precise number of degrees."
    - "all objects in your current selection are treated as a single unit".
  - **Contract.** WORKFLOW.md F-A6 "Typed values with math" (`:578`): "The X, Y, Width, Height and Rotation boxes take a number or a sum". No single-object limit is stated.
  - **Twin (L9).**
    - Remote `transform_artwork` rotate turns any selection or group about its combined centre (`remote-control/transforms.ts:91-119`; tool text `electron/mcp/tool-info.ts:90-94`, "rotate around the grouped centre").
    - The canvas rotate handle does the same for multi-selections (WORKFLOW F-A6 `:539`).
- **Scenario:**
  1. Group a logo and its border (two objects) and select the group.
  2. Rotation shows empty and greyed. Its title still reads "Type an angle in degrees or math like 45+15…". No reason is shown.
  3. To turn the group by 37.5°, the only desktop routes are approximate: an unsnapped handle drag, Shift's 15° steps, quarter turns, or Two-Point Rotate by three clicks (`two-point-tool.ts`, no typed angle). Ungrouping does not help, because any multi-selection is refused.
- **Evidence:** REPRO, `…\j7-main\src\ui\commands\zz-l4-ui.test.tsx`, through the real `NumericEditsBar` and store:
  - `R-box-single {"disabled":false,"value":"0"}`;
  - `R-box-group {"selected":2,"disabled":true,"value":"","title":"Selection rotation. … Type an angle in degrees or math like 45+15, 360/7 or atan(3/4)."}`.
  - Twin: `zz-l4-store.test.ts` `remote-vs-desktop-rotate37 {"maxDiff":0}` shows the remote and the core rotate-by already turning a 2-object selection exactly.
- **Severity:** P2. An operation refuses valid input (v7's P2 list) for an ordinary design. No geometry is wrong.
- **Novelty:** new. No audit mentions the multi-object Rotation box (`grep` of `docs/audits` for multi-rotation, "Rotate one object at a time", rotation box).
- **Fix direction:**
  - For a multi-selection, show 0 and apply the typed value as a relative turn about the combined centre (`buildSelectionRotateByEdit`), as LightBurn does.
  - Or show the reason in the box's title.
  - Add a NumericEditsBar test for a group.
- **Refuter: CONFIRMED, P2 kept.**
  - **What would refute it:**
    - another desktop route to a typed angle for a multi-selection;
    - an ADR that chooses single-object rotation;
    - a reason shown in the UI.
  - **Own repro.** `zz-l4r-ui.test.tsx` uses the real `NumericEditsBar` and store.
    - Clicking one member of a two-rectangle group selects both. The Rotation box is then `disabled` and its value is `""`. Its title only lists what the box accepts.
    - With one object selected, the box is enabled and shows `"0"`.
    - Width stays enabled for the group (`"60"`).
    - In core, two ungrouped objects give `rotationDeg null`, and the rotate edit returns `multi-rotation`.
  - **No other desktop route takes a typed angle:**
    - **Arrange → Rotate & flip** holds only Rotate 90° CW/CCW, Flip H/V, Mirror Across Line and Two-Point Rotate / Scale (`app-menu-groups.ts:48-57`, `layout-commands.ts:26-29`).
    - **Two-Point Rotate** takes three clicks and no typed angle (`two-point-tool.ts:34-60`).
    - **`rotateSelectionBy`** has one UI caller: the node-edit A key, which snaps a segment to 45° (`node-edit-keys.ts:100-110`).
    - **Design Studio** offers 90° buttons only (`DesignSelectionPanel.tsx:76-111`).
    - **The jig editor's** Rotation field hides itself for more than one object (`JigSelectionFields.tsx:70-76`).
    - **The only exact workaround** is a 2-copy Point Rotation array at twice the angle, then deleting the original. That is not a rotate command.
  - **No ADR or contract limits the box.**
    - `multi-rotation` dates from `4750a1685` (2026-06-14).
    - ADR-480 item 7 and WORKFLOW F-A6 (`:133`, `:578`) list Rotation among the boxes with no single-object limit.
    - The 2026-07-12 competitive audit described "multi-object rotation blocked" as evidence (`data/S01-evidence.json:106`) but raised no gap for it. The finding is new. No open PR touches the file (`gh pr list`: only #1478).
  - **LightBurn source re-fetched** (1.7 Numeric Edits Toolbar, 2026-10-28). Both quotes are verbatim.
  - **Severity.** v7's P2 list names "an operation that refuses valid input". No size or position is wrong, so it is not P1. Grouped designs are ordinary, so it is not P3.

### L4-P2-2 — Remote `place_on_board` array reports "placed" with no count when fewer copies fit than were requested, or when the 500-copy cap applies; the desktop form names both

- **Where:**
  - `src/ui/remote-control/board.ts:76`: `return { status: 'placed', action: args.action, artworkCount: args.artworkIds.length };`.
  - `:78-92`: `tileBoardSelection` passes `rows`/`cols` (validated 1–50, `validation.ts:175-180`) to `tileSelectionIntoBoard`.
  - The plan clamps rows and columns to what fits (`board-array-plan.ts` `requestedGrid`) and to 500 in total (`tile-into-region.ts:63-67`). `board-tile-actions.ts` shows no notice for either.
  - The desktop form names both: `BoardArrayForm.tsx:31-35` shows "`${plan.offsets.length} fit; ${plan.requestedCount} requested.`" and "Layout capped at 100 per axis and 500 copies.".
- **Anchor:**
  - **Twin (L9):** the desktop Array on board form, as quoted above.
  - **Contract:** MCP `place_on_board` text, "Center, fit or array existing artwork inside the captured board" (`electron/mcp/tool-info.ts:25-29`). It mentions neither a shortfall nor a cap.
- **Scenario:**
  1. An agent or phone user on a 200 × 100 mm captured board asks for a 5 × 5 array of a 30 × 20 mm coaster with a 2 mm gap.
  2. KerfDesk lays out 4 × 5 = 20 copies and answers "placed".
  3. The agent reports 25. Only the PC canvas shows 20.
  4. The same happens with `fill` on a small design: 484 copies against 20,000 that fit, silently.
- **Evidence:** REPRO, `zz-l4-ui.test.tsx`, real store plus `placeOnBoard`:
  - `remote-board-array-5x5 {"receipt":{"status":"placed","action":"array","artworkCount":1},"copiesMade":20,"toasts":[]}`;
  - plan twin: `board-rect-grid5x5 {"count":20,"overlaps":0,"outside":0,"requested":25,"limited":false}`;
  - `board-tiny-fill {"count":484,"limited":true,"wouldFit":20000}`.
- **Severity:** P2, a misleading receipt (v7 P2 "misleading readout").
  - The copies that are made are correctly placed: no overlap, none outside.
  - The coordinator may weigh P1 under "copies … silently lost". The burn has fewer pieces than the remote user requested, and nothing on the remote path says so. The PC canvas is not a warning (METHOD §3, G6).
- **Novelty:** new. J9 and G7 cite `place_on_board` for masks and the board outline, not the count.
- **Fix direction:**
  - Return `placedCount`, `requestedCount` and `capped` in the receipt, from the same `planBoardArray` the desktop form reads.
  - Or refuse a grid that does not fit, with `unsupported_operation` and a reason.
  - Say it in the tool description.
- **Refuter: CONFIRMED, P2 kept (not P1).**
  - **Own repro.** `zz-l4r-ui.test.tsx` uses the real store, `addCapturedBoardBox(200, 100)` and `adapter.execute('place_on_board', …)`.
    - **5 × 5 grid** (30 × 20 rectangle, `rows 5, cols 5, gapMm 2`):
      - receipt `{"status":"placed","action":"array","artworkCount":1}`;
      - 20 copies;
      - no toast on the PC.
    - **Fill** (1 × 1 rectangle, `action array`, no rows):
      - the same receipt;
      - 484 copies, where 20,000 fit at gap 0;
      - no toast.
    - **Analytic check:**
      - grid: ⌊202/32⌋ = 6 columns and ⌊102/22⌋ = 4 rows give 5 × 4 = 20;
      - fill: 100 × 100 shrinks by √(500/10,000) to 22 × 22 = 484 (`tile-into-region.ts:63-67`).
    - The remote allows up to 50 × 50 (`validation.ts:174-179`, `input-schemas.ts:103-104`). A large grid of a small design is therefore also cut to 500 or fewer, silently.
  - **Phone UI.**
    - The phone app never calls `place_on_board` (`git grep` of `services/remote-control/app/src`: no match). Neither does the MCP App bundle (`electron/mcp/workspace-app-ui.ts`).
    - Only MCP agents reach the command: the desktop MCP server, or the relay's `/mcp`, which the phone's More screen gives for pairing an agent (`MoreScreen.tsx:8`).
    - The receipt is therefore the only remote surface. The output schema has no field for a count (`output-schemas.ts:232-237`).
    - The scenario's "phone user" should read "an agent, including one paired through the phone".
  - **P1 or P2.** P1 needs one of these, with no warning before output:
    - wrong physical output;
    - design geometry that differs from what was typed or shown;
    - shapes silently dropped.

    None happens here:
    - every copy that burns is at the planned position and scale, inside the board, with no overlap;
    - canvas, `.lf2` and output agree on 20;
    - no existing shape is dropped;
    - the five missing copies cannot fit the board, so making them would put them off the material.

    The fault is the receipt, which lets the agent report 25. That is v7's "misleading readout", P2. The fill cap is the same case: it is a recorded cap (see L4-P3-6 under Refuted) that only the desktop form names.
  - **Novelty.**
    - v3 G7 refuted "`place_on_board` array makes unbounded copies" by citing these caps (`G7-app-shell-remote.md:368-369`). It did not look at the receipt.
    - v5 J9 logged the same receipt shape for masks.
    - The finding is new.

### L4-P3-1 — Copy Along Path's Rotate copies follows the chord of the 0.025 mm-flattened guide, not the curve: copies on a circle are off the tangent by up to 5.66° (r 5), 3.85° (r 10) and 1.79° (r 50)

- **Where:**
  - `src/core/geometry/copy-along-path-guide.ts:70,82`: the guide is `materializeVectorObject(object)` polylines, flattened at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM = 0.025` (`vector-path-tools.ts:102-121`, `curve-path.ts:14`).
  - `copy-along-path.ts:142-161`: `tangentAtDistance` is "the edge leaving that point".
  - `:270-288`: `placementAt` turns the copy by that edge's angle.
- **Anchor:**
  - **Twin.** The Circular Array places the same ring exactly (rotation error 0; `array-circular-layout.ts`).
  - **Ground truth.** The analytic circle tangent. LightBurn 1.7 Copy Along Path (https://docs.lightburnsoftware.com/1.7/Reference/CopyAlongPath/, fetched 2026-10-28) says copies are "oriented acording to the changes in direction of the path" [sic].
- **Scenario:** 12 tick marks (4 × 2 mm) along a Ø20 mm circle with Rotate copies.
  - Each tick is turned by the chord it lands on, so ticks lean between 0° and 3.85° off radial, unevenly.
  - Positions stay within 0.0017 mm of the circle, and the angular steps within 0.0002°.
  - On a Ø400 guide the lean is 0.9°.
- **Evidence:** REPRO, `…\j7-main\src\core\geometry\zz-l4-path.test.ts` `cap-circle`:
  - r 5: `"guidePoints":33,"maxTangentErrDeg":5.66`;
  - r 10: `49`, `3.85`;
  - r 50: `101`, `1.79`;
  - r 200: `201`, `0.896`;
  - with `maxRadialErrMm` ≤ 0.0221 and `maxAngularStepErrDeg` ≤ 0.00778.
- **Test truth:** `copy-along-path.test.ts` (25/25) checks rotation on polygon guides only (`:148-171`). No curved guide is checked.
- **Severity:** P3. The lean is visible on the canvas and does not change any copy's size or place.
- **Fixed (2026-11-11).** Each flattened guide edge is now mapped back to its canonical segment (`copy-along-path-tangent.ts`). A copy on a cubic or arc turns with the curve's tangent at its nearest curve point, and a copy on a straight segment keeps the edge direction, so real corners stay edge-aligned. Measured on 12 and 997 copies at r 5, 10, 50 and 200: an SVG arc circle leans 0.0000°. The Circle tool's circle leans 0.054–0.072° at every radius, which is its four-quarter-cubic form's own tangent wobble that the copies now follow. Tests: `copy-along-path-tangent.test.ts`.
- **Fix direction:** take the tangent from the canonical curve (`ColoredPath.curves`) at the copy's parameter, or from the two walk points straddling the copy. Add a circle-guide tangent test.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro.** `zz-l4r-core.test.ts`: a `createEllipse` guide, then `splitCopyAlongPathSelection`, then `copyAlongPathLayout`; 12 copies with Rotate on. The results match the auditor's exactly:

    | guide | guide points | max lean |
    |---|---|---|
    | r 5 | 33 | 5.661° |
    | r 10 | 49 | 3.849° |
    | r 50 | — | 1.790° |
    | r 200 | — | 0.896° |

    - At r 10 the lean per copy repeats 3.849, 3.353, 3.353.
    - The radial error is at most 0.0221 mm.
    - The bound is about half of one flattened segment's turn. At r 10 that is 48 segments of 7.5°, giving 3.75°.
  - **Stronger anchor (Contract).** ADR-498 decision 4 says "a rotated copy turns with the path direction at its point" (`docs/decisions/ADR-498-…md:90-91`). The chord leaving the flattened vertex is not that direction.
  - **LightBurn 1.7 Copy Along Path**, re-fetched: "oriented acording to the changes in direction of the path" [sic].
  - **Novelty.** No audit mentions a tangent or chord for Copy Along Path.
  - **Severity.** The canvas shows the lean truthfully, and each copy's place and size are right, so it is not P1. The lean is a few degrees, and only on small guides, so it stays P3.

### L4-P3-2 — The Align reference has three different rules: a marquee aligns to the top-most object (LightBurn: first in draw order), Design Studio to the selection bounds, and MCP to the last listed id (undocumented)

- **Where:**
  - `src/ui/state/selection-transform-actions.ts:204-206`: "A selection made at once (a marquee, Select All) has no click order, so it falls back to the last selected id, which is the top-most in the stack".
  - `:260-272`: the fallback `ids[ids.length - 1]`. The marquee is `selectObjects(ids)` (`use-workspace-drag.ts:412-413`).
  - Design Studio, `src/core/design/ops/arrange-entities.ts:22-48`: "Align against the selection's bounding box, retaining the outside edge".
  - Remote, `src/ui/remote-control/arrange.ts:52`: `const referenceId = requested.at(-1)`. The tool text (`tool-info.ts:105-109`) does not name the reference.
- **Anchor:** **Ground truth.** LightBurn 1.7 Align (https://docs.lightburnsoftware.com/1.7/Reference/Align/, fetched 2026-10-28):
  - "by default, all objects are aligned to the last object you added to your selection";
  - and when several are added at once, "aligned to the first object in the draw order".
  - The click case matches LightBurn (verified below).
- **Scenario:** Draw A (x 0), B (x 50), C (x 100), then marquee all three and choose Align Left.
  - KerfDesk moves A and B to x 100.
  - LightBurn's rule moves B and C to x 0.
  - The same three in Design Studio go to the leftmost edge.
- **Evidence:** REPRO.
  - `zz-l4-store.test.ts`:
    - `align-left-after-selectObjects(A,B,C) [100,100,100]`;
    - `align-left-after-clicks(C,A,B) [50,50,50]` (last click B, correct).
  - `zz-l4-path.test.ts`: `ds-align-left [10,10]` (the selection's left edge).
- **Severity:** P3, parity. The result is visible and undoable.
- **Fix direction:**
  - Use the first object in stacking order for an at-once selection, as LightBurn does.
  - Give Design Studio the same last-clicked reference, or document its rule.
  - Name the reference (the last listed id) in `arrange_artwork`'s description.
- **Refuter: CONFIRMED, P3 kept, with one correction.**
  - **Own repro.** Three rectangles: A at x 0, B at x 50, C at x 100.
    - `selectObjects(['A','B','C'])`, then Align Left: all three go to x 100.
    - `selectObjects(['C','B','A'])` gives the same result. The selection is rebuilt in stacking order (`scene-group-actions.ts:216-231`), so the reference is always the top-most object.
    - Clicking C, A, B in turn aligns everything to x 50 (B).
  - **LightBurn 1.7 Align**, re-fetched: when several objects are selected at once from nothing, "they are aligned to the first object" in the draw order.
  - **No ADR picks the at-once reference.** DECISIONS.md and `docs/decisions` were searched. The rule lives only in comments (`selection-transform-actions.ts:204-206`, `selection-reference.ts:1-17`).
  - **Correction.** The MCP reference is documented in `electron/mcp/README.md:103-104`: "Alignment uses the last requested artwork as its reference". It is missing only from the description agents see (`tool-info.ts`).
  - **Design Studio's rule** was confirmed by reading `arrange-entities.ts:21-48`.

### L4-P3-3 — Rotation always pivots about the centre, while LightBurn's 9-dot anchor sets the centre of rotation; this is decided only in code, and WORKFLOW F-A6 drifts from it twice

- **Where:**
  - `src/core/scene/selection-transform.ts:45-49`: "Rotation always pivots about the selection centre, so it carries NO anchor".
  - `:257`: `anchorPointForBBox(bbox, 'c')`.
  - The decision is commit `1326b05b1` (2026-07-29), "the numeric rotate field pivots about the centre too".
  - The UI discloses it: `TransformAnchorPicker.tsx:106`, "Rotation always pivots about the centre."
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Numeric Edits Toolbar (versioned path, fetched 2026-10-28): "The chosen location in the 9-Dot Control determines the center of rotation."
  - **Contract drift:**
    - `WORKFLOW.md:133`: changing the Anchor popover's presentation "does not change the X/Y reference, resize anchor, or rotation centre". This implies the anchor sets a rotation centre.
    - `WORKFLOW.md:596-597`: "Edge — non-uniform scale with rotation: Math handles this correctly". But an unlocked W/H edit of an oblique object is refused (`selection-transform.ts:224-235`; repro `oblique-rect-unlocked-W100 "non-uniform-rotated-selection"`).
  - No ADR records either choice (`grep` of `DECISIONS.md` and `docs/decisions` for rotation pivot / centre of rotation).
- **Evidence:**
  - SOURCE (LightBurn) and READ.
  - REPRO that the centre is the pivot: `zz-l4-core.test.ts` `typed-R75 {"rotation":75,"centreShift":0}`.
- **Severity:** P3. A disclosed parity deviation plus doc drift.
- **Fix direction:**
  - Record the decision in an ADR (the commit message gives the reason).
  - ~~Fix WORKFLOW `:133` and `:596-597`.~~ The refuter found no drift there (see below).
- **Refuter: CONFIRMED as a disclosed LightBurn deviation with no ADR. The WORKFLOW drift does not hold. P3 kept.**
  - **LightBurn 1.7**, re-fetched: "The chosen location in the 9-Dot Control determines the center of rotation."
  - **The centre is the pivot (repro).** `zz-l4r-core.test.ts`:
    - typed R 3,600,030 leaves the centre within 4.8e-11 mm;
    - 360 typed angles in sequence return the shape within 1.6e-14 mm.
  - **No ADR.** DECISIONS.md and `docs/decisions` name a rotation centre only in two places:
    - Point Rotation (ADR-307 D3);
    - ADR-138's 2026-09-19 amendment, which moved the anchor into a popover "without changing transform semantics".

    The choice lives in commit `1326b05b1` (PR #495) and the anchor tooltip. The 2026-09-05 PR audit reviewed it (`2026-09-05-pr301-501-audit.md:495`).
  - **WORKFLOW `:133` is not drift.** It says the anchor popover "does not change the X/Y reference, resize anchor, or rotation centre". That is true: the centre stays the centre.
  - **WORKFLOW `:596-597` is not drift.**
    - Handle drags scale a rotated object along its own axes (`handles.ts:139-182`; `inverseVectorToLocalScaleFrame`, `:279-288`). Non-uniform scale with rotation therefore works there.
    - The toolbar's refusal of unlocked W/H is a separate limit, and a toast announces it (`NumericEditsBar.tsx:417-418`).
  - **What remains:** record the centre-pivot choice in an ADR.

### L4-P3-4 — A huge typed angle is not reduced mod 360 before the trig: R = 1e15 moves the "fixed" centre 0.019 mm and R = 1e17 moves it 1.72 mm

- **Where:**
  - `src/core/scene/selection-transform.ts:258-259`: `deltaDeg = edit.rotationDeg - …` goes straight to `rotatePoint`, and `:382` computes `deltaDeg * Math.PI / 180`.
  - The object's own `rotationDeg` is reduced with `normalizeDeg`. So the orbit and the spin disagree once the radian product loses precision.
  - The same applies to `selection-rotate.ts:42-44` (rotate-by), `array-selection-copies.ts:95` and `rotate-handle.ts:181`.
  - The remote clamps the angle to ±36,000° (`validation.ts:251`, `design-validation.ts:145`). The Numeric Edits box accepts any finite value.
- **Anchor:** **Twin:**
  - `array-layout-math.ts:21-43` reduces first, "Exact at the quarter turns";
  - remote validation bounds the angle.
- **Evidence:** REPRO, `zz-l4-core.test.ts`:
  - `typed-R-huge` for 3600030 / 1e10+30 / 1e15 / 1e17 gives `centreShift` 9.5e-11 / 8.6e-8 / 0.0189 / 1.72 mm, with rotation 30 / 310 / 280 / 280;
  - `rotateBy-huge` gives the same.
- **Severity:** P3. Adversarial input, and the shift shows on the canvas.
- **Fix direction:** reduce `deltaDeg % 360` before converting to radians in every rotate helper, or bound the box like the remote.
- **Refuter: CONFIRMED, P3 kept. The size of the shift depends on the shape.**
  - **Own repro.** `zz-l4r-core.test.ts` `typedR-huge` uses a 20 × 10 rectangle at (30, 40):

    | typed R | centre shift | stored rotation |
    |---|---|---|
    | 3,600,030 | 4.8e-11 mm | 30 |
    | 1e10 + 30 | 4.3e-8 mm | 310 |
    | 1e15 | 0.0095 mm | 280 |
    | 1e17 | 0.86 mm | 280 |

    - These are half the auditor's figures, so the auditor's shape was twice as large.
    - The shift grows with the distance from the shape's local origin to the pivot.
  - **Reach.**
    - The box accepts any finite value; `numeric-expression.ts:125` refuses only non-finite results. So typing `10^17` works.
    - The other rotate helpers get bounded angles from their UI callers: the node-edit A key (at most 45°), Two-Point (`atan2`) and the handle drag. The typed R box is the only practical entry.
    - The remote bounds the angle and also reduces it with `angle % 360` before the trig (`transforms.ts:103`).
  - **Severity.** The input is adversarial and the result shows on the canvas, so P3.

### L4-P3-5 — A locked member of a group stays put while the rest of the group flips, rotates or moves on the desktop; the remote refuses the same edit whole

- **Where:**
  - Desktop: `src/ui/state/selection-transform-actions.ts:392-400` (selection drops locked objects) and `:360` (edits skip them). `scene-group-actions.ts:234-243` keeps locked members out of a click selection.
  - Remote: `remote-control/transforms.ts:44-53`. `editableArtwork` throws `not_editable` when any expanded group member is locked, so `transform_artwork` and `arrange_artwork` refuse.
- **Anchor:**
  - **Twin (L9):** desktop against remote for the same group transform.
  - **Contract:** WORKFLOW F-A6 Rotate 90°, "Locked or hidden artwork does not move". It does not say the group then splits.
- **Scenario:** Group A and B, lock A from the design tree, click B, then Flip H and rotate 90°.
  - B flips and turns about its own centre.
  - A stays, and the group's layout is broken, with no notice.
  - An agent's `transform_artwork` on the same group is refused.
- **Evidence:** REPRO, `zz-l4-store.test.ts` `locked-in-group-desktop {"selected":["B"],"A":{"x":0,"y":0,…},"B":{"x":30,"y":10,"rot":90,"mirrorX":true}}`. The remote refusal is READ (`transforms.ts:50`).
- **Severity:** P3. Lock is honoured, and the split shows on the canvas.
- **Fix direction:** pick one rule, either refuse or warn on the desktop when a group has a locked member, or transform the unlocked part on the remote too. Then write it into WORKFLOW.
- **Refuter: CONFIRMED, P3 kept.**
  - **Own repro.** `zz-l4r-ui.test.tsx`: a group of A and B, with A `locked`.
    - `selectObject('B')` selects only B, because `orderedLiveIds` drops locked members (`scene-group-actions.ts:234-243`).
    - Flip H and then Rotate 90° CW leave A at (0, 0). B ends at x 45, y 15, turned 90° and mirrored on X.
    - No toast appears.
    - The remote `transform_artwork` rotate on `['B']` returns `not_editable` ("The requested artwork is locked or hidden.").
  - **Each side follows a rule of its own:**
    - ADR-568: "locked, hidden, missing or unsupported targets refuse the complete request" (remote);
    - WORKFLOW F-A6: locked artwork does not move (desktop);
    - Quick Nest: it "does not split a partially selected/locked group" (`nest-actions.test.ts:108`).

    Nothing says how these rules apply to a group with a locked member.
  - **Novelty.** No audit mentions a locked group member under transforms.

### ~~L4-P3-6~~ — REFUTED by the refuter; moved to Refuted below

## KNOWN re-observed

- **Rolling v2 08-P3-3 (re-rated P1 in v7 L2; fix card open): the rotated own-bounds rectangle.** It is not re-raised. L4 adds these consequences, all from the same `combinedBBox` → `transformedBBox` (`hit-test.ts:255-293`):
  - **Align/Distribute** (`selection-units.ts:38` → `combinedBBox`): a Ø50 circle at 45° aligned Left sits **10.36 mm** right of the reference edge (`align-left-rotated-circle {"circleTightLeft":10.3582,"circleLooseLeft":7.1e-15}`).
  - **Grid array gap** (`array-actions.ts:342` bounds → `gridSteps`): typed gap 2 mm, actual edge gap **22.72 mm** (`grid-gap2-rotated-circle`).
  - **Flip H/V** (`selection-transform.ts:136-138`): a right triangle at 30° jumps **10 mm** sideways (tight box 40…74.64 → 50…84.64, `flip-rotated-triangle`). Design Studio flips about the exact bounds (`transform-selection.ts:27-34,125-160`), so the twin differs.
  - **Move snapping** to object edges, guides and the grid (`snapping.ts:42,105-118`) uses the loose box, so a rotated circle's geometry is not what lands on the grid line (READ). Point snaps are exact (see the table).
  - **Point Rotation pivot** (ADR-307 D3, "transformed combined selection-bounds center"), the Circular / Copy Along Path source centre (`array-circular-layout.ts:61`, `copy-along-path.ts:96`) and the board-array cell (`board-tile-actions.ts:60`, conservative: fewer copies, never overlap) all use the same box (READ).
  - Remote `transform_artwork` resize ("resize grouped bounds") is the same toolbar path with anchor `nw` (`transforms.ts:61-67`).
  - **Refuter: align reproduced independently; still KNOWN, not re-raised.**
    - **Repro.** `zz-l4r-core.test.ts`, `buildSelectionAlignEdit`: a Ø50 circle at 45° aligned Left to a rectangle at x 0.
      - The circle's true left edge lands at **10.358 mm**.
      - Its loose box lands at 7.1e-15.
      - Analytic: 25√2 − 25 = 10.355, plus flattening.
    - **Card scope.** The coordinator's fix card says "check every consumer of those bounds: … align/distribute".
      - Align and distribute are named.
      - The grid gap, flip and box snaps fall under "every consumer" but are not named.
    - **Two consumers carry decisions of their own:**
      - Point Rotation's pivot is ADR-307 D3, "the transformed combined selection-bounds center". Changing it needs an ADR-307 amendment.
      - The board-array cell is conservative: it gives fewer copies and never overlaps.
    - **Suggestion.** Name the grid gap, flip and the Point Rotation pivot in the card.
- **Rolling v2 08-P3-6 (P3): no-op transforms add an Undo step and mark the project dirty.** Still on main.
  - `moveSelectionToBed('c')` twice gives Undo depth `[1,2]`.
  - **New sibling:** a 1 × 1 Grid (or Point Rotation with 1 copy, which the dialog allows with `min={1}`) adds an "Array" step and sets dirty with nothing changed (`no-op-steps {"array1x1":{"undo":1,"dirty":true}}`; `array-actions.ts:230`).
- **Re-checked and fixed on main:**
  - **08-P2-2:** lines resize along their extent (`selection-transform.ts:208-212`, `zero-width-selection` / `zero-height-selection`).
  - **08-P3-2:** held arrows coalesce into one step (`selection-transform-actions.ts:289-309`).
  - **J9-P1-1:** Array on board copies masks via `sceneObjectCopyClosure` (`board-tile-actions.ts:67-69`).
  - **July S2-F12:** nested groups now exist (`parentId`), and Array keeps them (repro above).
  - **July S2-F3:** Duplicate is in place (`duplicate-scene-selection.ts`, no offset).

## Refuted

**Refuted by the refuter (raised, then dropped):**
- **L4-P3-6: "Array on board keeps a 500-copy total cap (and 100 per axis) that ADR-125 does not record; ADR-307 removed the same 500 cap from Array as a forbidden policy cap."**
  - **The auditor's evidence holds.**
    - `tile-into-region.ts:28-33,63-67` and `board-array-plan.ts:119-127` cap the layout.
    - A 1 × 1 design fills 484 of 20,000 (the refuter's repro: 484 copies through the remote).
    - The desktop form names the cap (`BoardArrayForm.tsx:35`).
  - **The contract claim fails.**
    - **ADR-125 records the cap.** Its 2026-07-08 amendment, "review-driven fixes", says: "`MAX_TILE_TOTAL` (500) caps the total copies" (`DECISIONS.md:6867`). The auditor cited only Decision 2 (`:6841-6842`).
    - **WORKFLOW F-BC2 documents it:** "capped at 100 per axis and 500 copies, with a notice in the preview" (`WORKFLOW.md:5040-5041`).
    - **ADR-307 decision 5 covers the Array command only.** It names "Grid, Circular, and Point Rotation" (`DECISIONS.md:19101-19103`), not Array on board.
    - **ADR-307 Amendment 1 knows about the board cap.** Its Context says "Array on board (ADR-125) tiles one design up to 500 times across a placed board", and the amendment leaves that cap in place (`docs/decisions/ADR-307-amendment-1-array-copies-are-limited-by-the-project.md`).
  - **What remains.**
    - The remote receipt does not mention the cap. That stays in L4-P2-2.
    - Whether ADR-307's "policy cap" reasoning should also apply to the board cap is a question for the maintainer, not a finding.

**Candidates the auditor checked and dropped:**
- **Accumulated rotation drift.** The selection centre changes as a multi-object selection turns, which could make 360 × 1° drift. Measured 7.6e-13 mm: rotation about the loose-box centre is self-consistent.
- **Mirror arcs turning the wrong way.** Arc moves are fitted on machine-mapped samples (`cut-arc-moves.ts:68-71`). The burned length after a flip equals the unflipped length (111.423 mm, 4 arcs).
- **Negative scale lost in `.lf2` or output.** `requireScale` accepts `|scale| ≤ max` (`project-shape-primitives.ts:56-61`). Raster compile reads `mirrorX !== scaleX < 0` (`compile-job-raster.ts:354-355`). The repro round-trips `scaleX −1`, and the compiled x-range equals the canvas.
- **Hidden artwork inside a typed resize.** Hiding an operation removes its artwork from the selection (`operation-list-actions.ts:125-129`), so the NumericEditsBar bbox cannot include it.
- **Circular "Rotate copies" turning the original.** The first copy at start 0° gets 90°. LightBurn 1.7 Circular Array only says "the same part of each duplicate faces the center"; KerfDesk's copies face outward-up, which meets that. The original's own rotation is not documented.
- **Grid negative spacing silently 0.** Every UI box has `min={0}` (`ArrayGridFields.tsx:73,84`). Only a direct call reaches `finiteNonNegative`.

## Verified clean

- **Typed transforms:** X/Y at 9 anchors, W/H at 9 anchors with a 90° member, locked W on a 30° rectangle, R single-object about the centre (see the table).
- **Accumulation:** 360 typed angles, 360 × 1° and 36 × 10° rotate-by (1.2e-13 mm), 4 and 400 quarter turns, 1,000 nudges, 1,000 alternating resizes at c / se / nw.
- **Mirror:** Flip about the selection centre is an exact reflection for rotated, scaled and mirrored objects. Flipping twice gives an identical transform. Mirror Across Line is exact and an involution.
- **Align and distribute:** all 7 align kinds and both distribute kinds match analytic results. Groups count as one unit (`selection-units.ts`), as LightBurn 1.7 Align says ("Grouped objects are treated as single objects"). Single-object align is a no-op. Remote align uses the same core and groups.
- **Arrays:**
  - Grid counts, spacing by gap and by centres, row and column shifts.
  - Circular full / end / 360-end with no doubled copy, rotate copies on the ring.
  - Point Rotation angles.
  - Nested groups copied with their `parentId`.
  - The masks closure (J9 fix).
  - Room refusal at 10,000 objects.
  - Undo returns the identical `Project`.
- **Copy Along Path:** count, spacing, gap, start/end offsets and the no-step refusal on an open line. Positions on circle guides lie within 0.022 mm.
- **Fill the board:** rect and circle boards, fill and grid: no overlap, nothing outside.
- **Snapping:** node and centre snaps exact on a rotated, scaled, mirrored rectangle. The rotate handle snaps 15° with Shift (`rotate-handle.ts:108,155`).
- **Twins:**
  - Remote rotate = desktop rotate-by.
  - Remote resize refuses the same oblique non-uniform edit as the desktop (`unsupported_operation`).
  - Canvas = compiled = `.lf2` for flip with arcs and for a negative scale.
- **Design Studio:** quarter turns, flips, uniform scale, a stretch (circle 2 × 1 → ellipse 14 × 7, ADR-272 Amd 4) and distribute spacing are exact.
- **Existing tests,** on main's tree, one at a time:
  - `selection-transform.test.ts` 11/11;
  - `selection-align.test.ts` 6/6;
  - `selection-distribute.test.ts` 6/6;
  - `selection-rotate.test.ts` 3/3;
  - `array-layout.test.ts` 13/13;
  - `array-circular-layout.test.ts` 9/9;
  - `copy-along-path.test.ts` 25/25;
  - `transform-selection.test.ts` 19/19.

## Not verified

- **Canvas pixels and the real handle drag.** `scaleObjectByHandleDrag` was called directly, and no browser was used (L8).
- **LightBurn itself.** Only its 1.7 documentation was used. Whether its Copy Along Path follows chords, and its Circular Array first-copy rotation, are unknown.
- **Design Studio snapping** (`core/design/snap`) beyond reading (L5).
- **Text, raster and barcode objects under every transform.** Only vector shapes and imported paths were compiled. Raster mirror handling was read.
- **CNC output** of transformed shapes (only laser G1/G2/G3).
- **Hardware:** none used.

## Repro files

All were created under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and deleted afterwards, one file at a time. No repo file except this report was touched.

| File (under `j7-main\`) | What it did |
|---|---|
| `src\core\scene\zz-l4-core.test.ts` | Anchors (move and resize), typed and accumulated rotation, huge angles, nudge and resize accumulation, flip and mirror exactness, align and distribute, grid / circular / Point Rotation placements, rotated-circle gaps |
| `src\core\geometry\zz-l4-path.test.ts` | Copy Along Path on circle and line guides, Design Studio transform / align / distribute / scale / stretch, point snaps on a rotated object |
| `src\ui\state\zz-l4-store.test.ts` | Store-level align reference, nested-group array and Undo, 0 / 1 / 10,000-copy arrays, locked group member, remote against desktop rotate / resize / align, `emitGcode` after flip with arcs, negative scale and `.lf2`, no-op Undo steps |
| `src\ui\commands\zz-l4-ui.test.tsx` | Real NumericEditsBar Rotation box (single against group), flip of a rotated triangle, Fill-the-board plans, remote `place_on_board` receipt |
| `zz-l4-vitest.config.ts` | The repo's vitest config plus an `fflate` alias to `.pnpm` and `maxWorkers: 1` |
| `src\core\scene\zz-l4r-core.test.ts` (refuter) | Nudge, rotate-by and typed-angle accumulation; huge typed R; circular placements; Copy Along Path tangent on circle guides; 08-P3-3 align of a rotated circle |
| `src\ui\commands\zz-l4r-ui.test.tsx` (refuter) | Real NumericEditsBar Rotation box (group against single); Align reference for a marquee and for clicks; locked group member on the desktop and remote; remote `place_on_board` 5 × 5 and fill receipts |
| `zz-l4r-vitest.config.ts` (refuter) | The repo config plus the `fflate` alias and one worker. All refuter files were deleted one by one afterwards. |

```json
[
  {"id":"L4-P2-1","severity":"P2","area":"transform-arrange","file":"src/ui/commands/NumericEditsBar.tsx","line":179,"anchor":"Ground truth: LightBurn 1.7 Numeric Edits 'Use the Rotate field to turn the current selection by a precise number of degrees' and the selection is 'treated as a single unit' (re-fetched by the refuter 2026-10-28); Contract: WORKFLOW F-A6 :578 and :133, ADR-480 item 7 list Rotation with no single-object limit; Twin: remote transform_artwork rotate (transforms.ts:91-119) and the rotate handle turn multi-selections","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real NumericEditsBar: clicking a group member selects both, Rotation box disabled and empty, title gives no reason; single object enabled '0'; W stays enabled. No other desktop typed-angle route: Arrange Rotate & flip has only 90-degree turns, flips, Mirror Across Line and Two-Point (clicks); rotateSelectionBy's only UI caller is the node-edit A key (45-degree snap); Design Studio 90-degree buttons only; jig Rotation field hidden for >1 object. No ADR; P2 kept (refuses valid input)","known":false,"summary":"Rotation box is disabled and empty for any multi-object selection including one group (rotationValue null when count != 1, selection-transform.ts:75); no reason shown; a grouped design cannot be turned by a typed angle on the desktop (only 90-degree turns, Shift 15-degree steps, Two-Point clicks), while the remote rotates the same selection exactly (diff 0)"},
  {"id":"L4-P2-2","severity":"P2","area":"transform-arrange","file":"src/ui/remote-control/board.ts","line":76,"anchor":"Twin: desktop BoardArrayForm.tsx:31-35 shows 'N fit; M requested.' and the 500-copy cap; Contract: MCP place_on_board text (tool-info.ts:25-29) and output schema (output-schemas.ts:232-237) carry no count","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro through adapter.execute: 5x5 of 30x20 gap 2 on a 200x100 board -> receipt {status:'placed',action:'array',artworkCount:1}, 20 copies, no PC toast; fill of a 1x1 design -> same receipt, 484 copies. Phone app never calls place_on_board; only MCP agents (desktop server or relay /mcp) reach it. P2 kept, not P1: every burned copy is at the planned place and scale inside the board, canvas/file/output agree, the missing copies cannot fit the board; the receipt is the misleading part","known":false,"summary":"Remote place_on_board array answers {status:'placed',action:'array',artworkCount:1} regardless of how many copies fit: 5x5 of a 30x20 design on a 200x100 board placed 20 with no shortfall in the receipt; fill on a 1x1 design places 484 of 20,000 (500 cap) silently; reached by MCP agents only (the phone app has no place-on-board control)"},
  {"id":"L4-P3-1","severity":"P3","area":"transform-arrange","file":"src/core/geometry/copy-along-path.ts","line":280,"anchor":"Contract (refuter): ADR-498 decision 4 'a rotated copy turns with the path direction at its point'; Twin: Circular Array exact on the same ring (rotation error 0); Ground truth: analytic tangent; LightBurn 1.7 Copy Along Path 'oriented acording to the changes in direction of the path' (re-fetched)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro identical to the auditor's: r5 33 points 5.661 deg, r10 49 points 3.849, r50 1.790, r200 0.896, radial <= 0.0221 mm; bound is about half a flattened segment's turn","known":false,"summary":"Rotate copies uses the chord of the 0.025 mm-flattened guide (copy-along-path-guide.ts:70,82): 12 copies on a circle lean off the tangent by up to 5.66 deg (r 5), 3.85 (r 10), 1.79 (r 50), 0.90 (r 200); positions within 0.022 mm; tests cover polygon guides only"},
  {"id":"L4-P3-2","severity":"P3","area":"transform-arrange","file":"src/ui/state/selection-transform-actions.ts","line":270,"anchor":"Ground truth: LightBurn 1.7 Align 'aligned to the last object you added to your selection' / several at once 'aligned to the first object' in draw order (re-fetched); Twins: Design Studio arrange-entities.ts:21-48 aligns to selection bounds; remote arrange.ts:52 last listed id, documented in electron/mcp/README.md:103-104 but not in tool-info.ts","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: selectObjects([A,B,C]) and selectObjects([C,B,A]) both align Left to C (x 100), since the selection is rebuilt in stacking order; clicks C,A,B align to B (50). Correction: the MCP reference is in the MCP README, missing only from the agent-facing tool description","known":false,"summary":"Marquee A,B,C then Align Left moves A and B to C (x 100, top-most) where LightBurn's rule keeps A (x 0); click order works (reference B); Design Studio aligns to the selection's left edge; MCP tool description does not name the reference"},
  {"id":"L4-P3-3","severity":"P3","area":"transform-arrange","file":"src/core/scene/selection-transform.ts","line":257,"anchor":"Ground truth: LightBurn 1.7 Numeric Edits 'The chosen location in the 9-Dot Control determines the center of rotation.' (re-fetched); decision only in commit 1326b05b1 (PR #495); UI discloses it (TransformAnchorPicker.tsx:106)","evidence":"SOURCE","verdict":"CONFIRMED","refuter":"Confirmed narrowed: centre pivot by repro (typed R 3,600,030 keeps the centre within 4.8e-11 mm); no ADR records it. The WORKFLOW drift claims do not hold: :133 says the popover does not change the rotation centre (true); :596-597 holds for handle drags, which scale rotated objects along their own axes (handles.ts:139-182,279-288); the toolbar W/H refusal is toast-disclosed","known":false,"summary":"Rotation always pivots about the centre (typed R and handles), unlike LightBurn's 9-dot anchor; disclosed in the anchor tooltip but no ADR records the choice"},
  {"id":"L4-P3-4","severity":"P3","area":"transform-arrange","file":"src/core/scene/selection-transform.ts","line":258,"anchor":"Twin: array-layout-math.ts:21-43 reduces angles first; remote clamps angleDeg to +/-36000 (validation.ts:251) and reduces angle % 360 before the trig (transforms.ts:103)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro on a 20x10 rect: shifts 4.8e-11 / 4.3e-8 / 0.0095 / 0.86 mm for 3,600,030 / 1e10+30 / 1e15 / 1e17 (half the auditor's; the shift scales with the shape's size). The typed R box is the only practical entry (numeric-expression.ts:125 refuses only non-finite values)","known":false,"summary":"Typed R is not reduced mod 360 before deg->rad: R 1e15 shifts the fixed centre 0.0095-0.019 mm and 1e17 shifts it 0.86-1.72 mm depending on the shape's size (rotation stored 280); the same helpers in rotate-by, array copies and the rotate handle only get bounded angles from the UI"},
  {"id":"L4-P3-5","severity":"P3","area":"transform-arrange","file":"src/ui/state/selection-transform-actions.ts","line":398,"anchor":"Twin: remote editableArtwork refuses any group with a locked member (transforms.ts:44-53; ADR-568 'locked, hidden, missing or unsupported targets refuse the complete request'); Twin: Quick Nest does not split a partially locked group (nest-actions.test.ts:108); Contract: WORKFLOW F-A6 'Locked or hidden artwork does not move'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: group A+B with A locked; selectObject('B') selects only B; Flip H + Rotate 90 CW leave A at (0,0) and turn B (x 45, y 15, 90 deg, mirrorX); no toast; remote transform_artwork on B returns not_editable","known":false,"summary":"Group A+B with A locked: clicking B and Flip H / rotate 90 transforms B alone about its own centre, A stays, the group splits with no notice; remote transform_artwork/arrange_artwork refuse the same group"},
  {"id":"L4-P3-6","severity":"none","area":"transform-arrange","file":"src/core/scene/tile-into-region.ts","line":33,"anchor":"Contract claim fails: ADR-125 Amendment 2026-07-08 records 'MAX_TILE_TOTAL (500) caps the total copies' (DECISIONS.md:6867); WORKFLOW F-BC2 :5040-5041 documents the cap; ADR-307 D5 covers Grid/Circular/Point Rotation only and ADR-307 Amd 1 names the board's 500 cap without removing it","evidence":"REPRO","verdict":"REFUTED","refuter":"The 500-copy board cap is recorded and documented; the 484-of-20,000 repro is the recorded cap. Remote silence about it is carried by L4-P2-2","known":false,"summary":"Raised as: Array on board's 500-copy cap is not recorded in ADR-125 and contradicts ADR-307 D5. Refuted: ADR-125's 2026-07-08 amendment and WORKFLOW F-BC2 record it, and ADR-307 D5 is scoped to the Array command"},
  {"id":"08-P3-3","severity":"P1 (as re-rated in v7 L2; not re-raised)","area":"transform-arrange","file":"src/core/scene/hit-test.ts","line":255,"anchor":"Ground truth: LightBurn 1.7 Numeric Edits smallest rectangle containing the selection; Twin: Design Studio transforms use exact bounds (transform-selection.ts:125-160)","evidence":"REPRO","verdict":"KNOWN","refuter":"Align consequence reproduced independently: a 45-degree circle aligned Left sits 10.358 mm off the reference edge (analytic 25*sqrt(2)-25 = 10.355). Fix card names align/distribute; grid gap, flip and snaps fall under 'every consumer'; Point Rotation's pivot is ADR-307 D3 and needs an amendment to change","known":"rolling v2 08-P3-3 (v7 L2 re-rated P1, fix card open)","summary":"New L4 consequences of the loose rotated own-bounds box: Align Left leaves a 45-degree circle 10.36 mm off the reference edge; typed grid gap 2 burns 22.72; Flip H moves a 30-degree triangle 10 mm; box/grid snaps, Point Rotation pivot (ADR-307 D3), circular/copy-along-path source centre and board-array cell use the same box"},
  {"id":"08-P3-6","severity":"P3","area":"transform-arrange","file":"src/ui/state/array-actions.ts","line":230,"anchor":"Twin: endInteraction skips unchanged drags; single-object Align pushes 0 steps","evidence":"REPRO","verdict":"KNOWN","known":"rolling v2 08-P3-6 (still open) + new sibling","summary":"Move to bed centre twice gives 2 Undo steps; a 1x1 Grid (or 1-copy Point Rotation, dialog min 1) adds an 'Array' step and sets dirty with no change"}
]
```
