# Rolling audit v8 — N6 Canvas and key fixes (#1511, #1510, #1504)

- **When:** 2026-10-29, late evening +0800   **Tree:** origin/main @ `4f71f1f41` (#1517 merged; #1514–#1517 touch only constant-power advice, the Marlin worker and the tracer).
  - Merge commits: #1504 `7037dec09` (first parent `76511fb89`), #1510 `6b79c2e2e` (first parent `3bf24619f`), #1511 `0cdee525a` (first parent `6b79c2e2e`, so #1511's parent already holds #1510). `git log 0cdee525a..origin/main` over `draw-scene.ts`, `fill-pools.ts`, `hit-test.ts`, `cancelled-fill-copies.ts` and `object-display.ts` is empty: nothing touched them after #1511.
  - **Repros ran on the scratchpad copy `…\scratchpad\j7-main\`.** `git hash-object --stdin-paths` over all 10,239 files that `origin/main` tracks under `src` and `electron`: every `.ts` / `.tsx` file matches `4f71f1f41`. The 17 mismatches are fixture data files (`.svg`, `.clb`, `.lbrn2`) that differ only in line endings.
  - **Test truth.** Each PR's parent version of a file was swapped in through a Vitest alias (`zz-n6-vitest.config.ts`, `N6_STUB=1511|1510|1504`), in the same copy.
- **Scope:** fix verification (L10) and sibling routes (L9) of:
  - **#1511** (ADR-683, pointer amendments on ADR-410 and ADR-480): the canvas pools a Fill operation even-odd, holes are not click targets, and stacked Fill copies are named. Findings fixed: L8-P1-1 (with the refuter's Duplicate / Paste in Place extension) and L8-P2-5.
  - **#1510** (ADR-410 Amd 4, ADR-493 Amd 2, ADR-499 Amd 2): LightBurn's flip, paste-in-place, rotate-step, draw-order and Move Together keys; Z jog moved to Ctrl/Cmd+Alt+PgUp / PgDn. Findings fixed: L8-P2-1, L8-P2-3, L8-P2-4, and the P3s L8-P2-2, L8-P2-7, L8-P3-9.
  - **#1504** (ADR-678, ADR-125 Amd 4): the Rotation box turns a group or multi-selection; remote `place_on_board` array names its count. Findings fixed: L4-P2-1, L4-P2-2 (and L4-P3-4, L4-P3-2 by record).
- **Lenses run:**
  - L10: every original repro, through the real store, the real window key listeners (`useShortcuts`, the capture-phase Abort, the real `JogPad` on a CNC with Z ready), `drawScene` with a recording context, and `compileJob` hatch.
  - L9, Fill canvas: three overlapping shapes, a hole with an island, text (non-zero glyphs) in Fill, a per-object angle override, a per-object Line override, a Line sub-layer, two Fill operations on one path ("Add operation"), a hidden operation, a photo between pool members, Alt operation colours, Wireframe, a laser project switched to CNC, 5,000 objects.
  - L9, keys: the LightBurn Edit, Arrange and Tools keys (table below), text and number fields, focused buttons, a modal (the jig editor), key repeat, NumLock-off keypad, AltGr, AZERTY, a Russian layout, macOS Cmd / Option.
  - L9, rotation: a nested group with text, a photo and a mirrored part; Undo / Redo; repeated turns.
  - L9, remote arrays: `place_on_board` partial fit, the 500-copy cap, 50 × 50 rows × cols, no fit, a jig outline in the scene. KerfDesk has no remote grid or circular array command (`types.ts` lists `set_board_photo`, `place_on_board`, `set_selection`, `add_text`, `update_text`, `arrange_artwork`, `undo`, `add_rectangle`, `add_ellipse`, `add_polyline`, `transform_artwork`, `update_operation`).
  - L8: each PR against #1502 (tight bounds), #1505 (design I/O) and #1509 (Studio).
  - L7: each PR's regression tests against the parent code.
  - L2: LightBurn 1.7 Arrange, Edit and Tools menu pages, fetched 2026-10-29 (`https://docs.lightburnsoftware.com/1.7/Reference/UI/ArrangeMenu/`, `…/EditMenu/`, `…/ToolsMenu/`), and the Windows hotkey cheatsheet Rev 2.0 as pinned by v7 L8 (SHA-256 `b47b95bf…5333`; not re-downloaded here).
  - Not run: a real browser or GPU (canvas timings are jsdom with a no-op context), real keyboards (synthetic events), hardware.
- **Repros:** 7 temporary Vitest files, 7 parent-version stubs and one config, plus 8 existing test files. Each ran alone with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-n6-vitest.config.ts --silent=false --disableConsoleIntercept`. They are listed under "Repro files" and were all deleted afterwards. No machine was operated: the jog action was a recorder.
- **Counts:** 9 raised → 0 refuted → P1 2 / P2 1 / P3 6. N6-P3-5 is KNOWN (recorded in ADR-683 Consequences), so the new findings are P1 2 / P2 1 / P3 5 (+ 5 KNOWN: N6-P3-5 and the 4 re-observed).
- **Refuter (2026-10-29, fresh context):** all 9 CONFIRMED, none refuted, no severity changed. N6-P3-5 is reclassified as KNOWN. The two P1s were reproduced independently: through the real Operation inspector button, `drawScene`, `compileJob`, `emitGcode` preflight and the Preview toolpath, against a no-pool model of #1511's parent. One correction to N6-P2-1: a Line square drawn *above* the window object keeps a clickable outline. Main moved to `7d7cedcd6` after the audit, but only #1518 merged (`registration-jig-artwork-actions.ts` and one test), so no cited file changed. The 13 cited files in the repro tree hash-match main.

## Headline

**Every path the v7 findings named is fixed on main.**
- A 40 × 30 plate with a separate Ø16 circle on one Fill operation now shows the ring it burns. Ctrl+D and Paste in Place on a Fill plate show an unfilled outline, the hatch is 0 mm, and preflight gives `fill-stacked-copies-cancel` ("2 stacked copies on Fill operation "Operation" burn nothing…"). A third copy burns and shows solid again.
- Clicking through a filled plate's window picks the Line square inside it.
- Ctrl+Shift+V flips (no copy), Ctrl+Shift+H flips, Alt+V pastes in place, PgUp / PgDn restack, Alt+Shift+H / V move together.
- Bare PgUp / PgDn never jog. Only Ctrl/Cmd+Alt+PgUp / PgDn jog Z: one step at 600 mm/min, never in a text or number field, a modal, on a repeat, or from the keypad.
- A clicked nested group turns rigidly by a typed 37.5° (worst vertex error 1.4e-14 mm), as one Undo step.
- A remote 5 × 5 array that fits 20 now answers `placedCount 20, requestedCount 25` with the PC's notice.

**#1510 and #1504 hold. #1511 does not fully hold: pooling introduced two new canvas-against-burn twins, and the hit test does not follow the pooled holes.**
- **N6-P1-1 (regression from #1511).** A path on two Fill operations, which the Operation inspector's **Add operation** button makes, is pooled under its first operation only. Select the circle of the plate-and-circle design and press Add operation: the canvas shows the circle as a hole, while "Operation 2" hatches it. Preflight is empty. #1511's parent painted it solid, as it burns.
- **N6-P1-2 (regression from #1511).** A pool is painted at its lowest member's place in the drawing order. A photo drawn between two members of one cluster now covers the upper member. Frame (Fill), then photo, then a caption on the frame's Fill operation: main paints frame and caption first, then the photo over them, so the caption vanishes from the canvas and still burns. The parent painted the caption after the photo.
- **N6-P2-1 (sibling of L8-P2-5).** The hit test treats each object alone. A window made by a separate Fill object, or a pair of cancelled stacked copies, is now drawn empty, but a click there still picks that object, never the Line square the canvas shows inside it.

## Fix verification (L10)

| Original finding | Before (parent) | After (main) | Siblings (L9) | Verdict |
|---|---|---|---|---|
| **L8-P1-1** plate + separate circle on one Fill op: canvas solid, burn ring | parent `draw-scene.ts`: ink at the circle centre, burn none (`draw-scene-fill-pools.test.ts` 4 of 6 fail on the parent) | `zz-n6-fill`: centre canvas `-`, burn `-`; body ink, hatch | Clean: three overlapping shapes (A, AB, ABC, AC, C agree), hole + island, text (non-zero glyph) on a plate, per-object 45° angle, per-object Line override, Alt colours (one pooled `evenodd` fill), Wireframe (0 fills), separate operations. **Not clean:** a path on two Fill operations (N6-P1-1); a photo between members (N6-P1-2) | **Fixed for the reported path; two regressions** |
| **L8-P1-1 ext.** Ctrl+D / Paste in Place on a Fill part: burns 0, canvas solid, no warning | 12,000 → 0 mm, canvas solid | Ctrl+D and Paste in Place: canvas `-`, burn `-`, outline drawn; fill 2,400 → 0 mm; advisory 1; three copies: 2,400 mm, no advisory | A hidden operation still gets the advisory (correct: hidden + output burns, LightBurn's rule). With a Line sub-layer the advisory says "burn nothing" while the outline burns twice (N6-P3-2). Remote `arrange_artwork` duplicate gives no receipt notice; the remote Start review carries Job Review's warnings (`machine-review-pages.ts:65-66`) | **Fixed** |
| **L8-P2-5** a Fill hole is a solid click target | `zz-n6-hit` with the parent `hit-test.ts`: edge, centre, empty window, body all `ring` | edge `inner`, centre `inner`, empty window `ring` (interior), body `ring`; `hit-test.test.ts` 2 of 3 new cases fail on the parent | **Not clean:** a hole made by a separate Fill object, or cancelled copies (N6-P2-1) | **Fixed for one object** |
| **L8-P2-1** Ctrl+Shift+V pastes in place; Ctrl+Shift+H, Alt+V nothing | stacked copy, burn twice | `zz-n6-keys`: Ctrl+Shift+V `Flip Vertical`, still 3 objects; Ctrl+Shift+H `Flip Horizontal`; Alt+V `Paste in Place` | Text field: none of them consumed (browser keeps Ctrl+Shift+V). macOS Cmd+Shift+V flips, Option+V (`√`) pastes in place. Russian layout: Alt+V pastes (physical-key fallback), Ctrl+Shift+V does nothing (N6-P3-6) | **Fixed** |
| **L8-P2-3** PgUp / PgDn jog Z | jog `[1]`, `[-1]` | PgUp / PgDn / Ctrl+PgUp / Ctrl+PgDn restack, jog `[]`; Ctrl+Alt+PgUp / PgDn jog `{dz: ±1, feed: 600}` and restack nothing | Cmd+Option jogs (documented). No jog in a text field, a number field, a modal (jig editor, `modalDepth 1`), on `repeat`, or from Ctrl+Alt+NumLock-off keypad 9. A focused button jogs on the chord and restacks on bare PgDn (ADR-493 Amd 2 D3). NumLock-off keypad 9 restacks (it sends PageUp; LightBurn reads it the same way) | **Fixed** |
| **L8-P2-4** Alt+Shift+H / V distribute | b 50 → 65 | a 80, b 100 (`Move H Together`); Alt+Shift+V `Move V Together` | One object selected: consumed, nothing. Distribute spacing has no key | **Fixed** |
| L8-P2-2 / L8-P2-7 / L8-P3-9 (P3s) | Shift+. nothing; Shift+= nothing; Ctrl+Y nothing | Shift+. 45°, Ctrl+Shift+, 1.5° CCW; Ctrl+. idle not consumed; AZERTY Shift+(;.) turns 90° (ADR-410 Amd 4 D3) | Ctrl+. and Ctrl+, stay Abort and Settings, now recorded (ADR-410 Amd 4 D4) | **Fixed / recorded** |
| **L4-P2-1** Rotation box disabled for groups | disabled, empty | nested group (text, photo, mirrored part) via a click on an inner member: box `0`, typed 37.5 → all at 37.5, rigid to 1.4e-14 mm, one Undo step; Undo and Redo restore identical objects | Mixed angles: blank, "Mixed", turns by the typed angle. Drift after turning back (N6-P3-1) | **Fixed** |
| **L4-P2-2** remote array "placed" without a count | `{status, action, artworkCount}` | 5 × 5 of 30 × 20 on 200 × 100: `placedCount 20, requestedCount 25` + notice + PC toast; fill 1 × 1: 484 + cap notice; 50 × 50 of 1 × 1: "484 of the 2500 requested copies: … capped" | A design wider than the board: `unsupported_operation` "not supported by the current remote tool", no count (N6-P3-4). A jig outline drawn first: Place Board replaces it, one box remains (refuted) | **Fixed** |

### Test truth (L7)

| PR | Test | Parent result |
|---|---|---|
| #1511 | `draw-scene-fill-pools.test.ts` | 4 of 6 fail with the parent `draw-scene.ts` (the separate-operations and lone-parts controls pass) |
| #1511 | `hit-test.test.ts` | 2 of 21 fail with the parent `hit-test.ts`: both new through-the-hole cases; the non-zero overlap control passes |
| #1511 | `cancelled-fill-copies.test.ts`, `JobReviewStackedFillCopies.test.tsx` | new module; fail by absence |
| #1510 | `lightburn-shortcut-parity.test.tsx` | 12 of 16 fail with the parent `editing-tool-shortcuts.ts`, `arrange-shortcut-keys.ts` and `use-jog-shortcuts.ts` swapped in (the Shift+= and Ctrl+Y cases live in files not swapped; the two Abort cases are controls) |
| #1510 | `JogPad.keyboard-jog.test.tsx` | not runnable as a hybrid: main's `FocusJogControls.tsx` imports `FOCUS_JOG_KEY_LABELS`, which the parent `use-jog-shortcuts.ts` lacks. The jog cases of the parity test cover it (`expected [] to deeply equal [[1],[-1]]`) |
| #1504 | `selection-transform.test.ts` | 4 of 14 fail with the parent `selection-transform.ts` (shared angle `null` vs 30, rigid multi-turn `error` vs `ok`, huge angle centre off 0.71 mm) |
| #1504 | `NumericEditsBar.group-rotation.test.tsx` | 2 of 2 fail with the parent `selection-transform.ts` (box `''` vs `'0'`; mixed turn `[0, 30]` vs `[15, 45]`) |
| #1504 | `board.test.ts` "array counts" | 3 of 3 fail with the parent `board.ts` (receipt without `placedCount` / `notices`) |

### ADR amendments against the code

- **ADR-683 D1** ("The objects whose filled paths use one operation … are pooled"): the code pools a path under the one operation that styles it on the canvas (`object-display.ts:97-106`, the first visible binding), not under every Fill operation it uses (N6-P1-1). D1 also says a cluster "is painted once, where its lowest member sits in the drawing order" — true, and the cause of N6-P1-2, which the ADR does not weigh.
- **ADR-683 D2** ("artwork shown through the hole is picked first"): true for one object's holes only (N6-P2-1).
- **ADR-683 D3**: matches (laser only, even counts, odd counts silent, Job Review button). The message is wrong with a Line sub-layer (N6-P3-2).
- **ADR-410 Amd 4, ADR-493 Amd 2, ADR-499 Amd 2**: every decision item matches the code and the repro, including "consumed with nothing selected", AltGr+PgUp jogging, Shift held never jogging, and Alt+Shift+= not zooming (`view-shortcuts.ts:47`).
- **ADR-678**: D1–D6 match. Its Consequences say turning back "can leave a lopsided one shifted by a little"; measured 10.18 mm (N6-P3-1).
- **ADR-125 Amd 4**: D1–D3 and D5 match. D4 ("The copies that fit are placed, as on the desktop") is silent on zero fits, which the remote refuses with a misleading code (N6-P3-4).

### Regressions against #1502, #1505 and #1509

- **#1502 (ADR-677).** ADR-678 pivots on `combinedBBox`. The rigid-turn oracle used the outline vertices' box and matched to 1.4e-14 mm, so the tight bounds and the pivot agree. Fill clustering uses `vectorObjectWorldBounds` (`object-viewport.ts:45-51`), which reads every path's polylines and curve bounds, a superset of what pools.
- **#1505 (ADR-681).** ADR-681 writes exports pooled per operation (cited in ADR-683's Context); N5 owns the export side. A path on two Fill operations (N6-P1-1) was not traced through export.
- **#1509.** #1511's change to `draw-vector-strokes.ts` is type-only (`Placed`); N5 confirmed #1509's closing `lineTo` reaches the pool outline (`fill-pools.ts:135`).
- **#1510 against #1511.** Alt+V (Paste in Place) on a Fill part now makes the cancelling pair that #1511 shows and names: verified through the store (fill 2,400 → 0 mm, advisory 1).

## LightBurn keys, Edit / Arrange / Tools (L2)

KerfDesk column from the sweep in `zz-n6-keys` (real `useShortcuts`, two of three rectangles selected). LightBurn column: the 1.7 menu pages fetched 2026-10-29, and the Rev 2.0 cheatsheet as pinned by L8 where the 1.7 page gives no key (marked W). "Not bound" = not consumed, nothing happens; those are KNOWN as L8-P3-8 and not re-raised.

| Menu | LightBurn | KerfDesk on main | Note |
|---|---|---|---|
| Edit | Undo Ctrl+Z, Redo Ctrl+Shift+Z | same; Ctrl+Y also redoes | #1510 |
| Edit | Select all Ctrl+A, Invert Ctrl+Shift+I | same | |
| Edit | Duplicate Ctrl+D | same, one step "Duplicate" | on Fill: named by ADR-683 D3 |
| Edit | Paste in Place: none (1.7 page); Alt+V (W) | Alt+V | #1510 |
| Edit | Convert to Path Ctrl+Shift+C | not bound | KNOWN |
| Edit | Convert to Bitmap Ctrl+Shift+B (W) | same (opens the dialog) | the fetched 1.7 summary also listed Ctrl+Shift+C here: UNVERIFIED, cheatsheet used |
| Edit | Auto-Join Alt+J, Optimize Alt+Shift+O | not bound | KNOWN |
| Edit | Delete Duplicates Alt+D | same | |
| Arrange | Group Ctrl+G, Ungroup Ctrl+U | same | |
| Arrange | Flip H / V Shift+Ctrl+H / V | same | #1510 |
| Arrange | Mirror Across Line Shift+Ctrl+M, Two-Point Rotate Ctrl+2, Break Apart Alt+B | not bound | KNOWN |
| Arrange | Rotate 90° `.` / `,` | same | |
| Arrange | Rotate 15° Ctrl+. / Ctrl+, (TransformControls) | Abort / Settings | decided, ADR-410 Amd 4 D4 |
| Arrange | Rotate 45° Shift+. / ,; 1.5° Ctrl+Shift+. / , (2.x) | same | #1510 |
| Arrange | Move H / V Together Alt+Shift+H / V (Distribute page; W) | same | #1510 |
| Arrange | Push in Draw Order: none (1.7 page); PgUp / PgDn / Ctrl+PgUp / Ctrl+PgDn (W) | same | #1510; a browser tab keeps Ctrl+PgUp / PgDn (ADR-493 Amd 2 Consequences) |
| Arrange | Align centres Alt+Home (W) | not bound; Alt+PgUp / PgDn align centres | KNOWN |
| Tools | Select Esc; Lines Ctrl+L; Rectangle Ctrl+R; Ellipse Ctrl+E | same | |
| Tools | Edit Nodes Ctrl+\`, Add Tabs Ctrl+Tab, Edit Text Ctrl+T, Weld Ctrl+W, Boolean Assistant Ctrl+B, Offset Alt+O, Cut Shapes Alt+Shift+C, Adjust Image Alt+I | not bound (KerfDesk text is bare T) | KNOWN |
| Tools | Trim Shapes Ctrl+K | opens Find a command | KNOWN (ADR-604) |
| Tools | Boolean Union Alt++, Intersect Alt+* | not bound | KNOWN |
| Tools | Boolean Subtract Alt+- | zooms out (0.8×) | KNOWN, ADR-499 Amd 2 Consequences |
| Tools | Measure Alt+M (W) | same | the fetched 1.7 summary gave Ctrl/Cmd+M: UNVERIFIED |
| Tools | Trace Image Alt+T | same (gated on an image) | |

## Findings

### N6-P1-1 — Regression from #1511: a path on two Fill operations ("Add operation") is pooled under its first operation only, so the canvas shows a hole where the second operation burns

- **Where:**
  - `src/ui/workspace/fill-pools.ts:155-180`: `operationMembers` keys each filled path by `path.operationId` only (`:162-165`).
  - `src/ui/workspace/object-display.ts:96-106`: that id is `resolution.operation?.id`, the first visible bound operation (`src/core/scene/visibility.ts:65-85`, "The first visible operation supplies deterministic canvas styling").
  - The binding comes from the Operation inspector's **Add operation** button (`src/ui/layers/OperationInspectorControls.tsx:98-107`, title "Add another operation to this artwork, then edit its settings") → `addOperationForObjects` (`src/ui/state/operation-actions.ts:158-165`) → `cloneArtworkOperations(…, additive = true)` → `appendSceneObjectOperationBinding` (`src/ui/state/clone-artwork-operations.ts:48`). The new operation copies the source, so it is Fill too.
  - The compiler hatches every output operation separately (`compile-job.ts`, `outputOperationLayers`), so the second operation burns the path solid.
- **Anchor:**
  - **Twin:** the design canvas against the compiled Fill.
  - **Contract:** ADR-683 D1: "The canvas paints each Fill operation as the one region it burns", pooling "the objects whose filled paths use one operation".
  - **Adjacent KNOWN:** `docs/audits/rolling/2026-07-17-0815-layers-panel-parity.md:13` (multi-bound artwork is styled by its first operation; "Canvas-only nuance — output is unaffected"). Pooling turns that styling choice into a shape error.
- **Scenario:** a plate and a logo on one Fill operation. The operator selects the logo and presses **Add operation** to give it its own settings ("Operation 2", Fill).
  - The canvas shows the logo as a hole in the plate.
  - The burn: "Operation" burns the plate with the logo as a hole, and "Operation 2" burns the logo solid. Together the logo area is engraved.
  - Preflight is empty. Before #1511 the canvas showed the logo solid, as it burns.
  - The same happens to two overlapping parts when one gets a second Fill operation: the overlap shows empty and burns.
- **Evidence:** REPRO.
  - `zz-n6-fill2.test.ts`, real store `addOperationForSelection`, `drawScene`, `compileJob`, `emitGcode`, `runPreflight`:
    ```text
    N6FILL2 after Add operation: layers [["#000000","Operation","fill",true,true],["operation-circle","Operation 2","fill",true,true]] … undo 1
    N6FILL2 after: canvas ink at circle centre false burn ops through centre ["Operation 2"]
    N6FILL2 after: preflight codes []
    N6FILL2 overlapping a,b; Add operation on b: canvas ink at overlap false burn ops ["Operation 2"]
    ```
  - Same file with `N6_STUB=1511` (parent `draw-scene.ts`): `canvas ink at circle centre true`, `canvas ink at overlap true`.
  - `zz-n6-fill.test.ts` with hand-built bindings: `circle on A+B, plate on A | centre: canvas=- burn=hatch MISMATCH`; with B listed first the canvas and burn agree (`centre: canvas=ink burn=hatch`).
- **Severity:** P1. The burn differs from what the canvas shows, with no warning (v7 design severity; the class of L8-P1-1). It is reachable from an ordinary inspector button, and it is a regression: the parent canvas matched the burn.
- **Novelty:** new. No audit names pooling with multi-operation bindings.
- **Refuter:** CONFIRMED, P1 kept.
  - **What would refute it, and what was checked:**
    - A guard: none. `emitGcode` preflight returns `[]`. Job Review has no check for artwork on several operations (`src/ui/laser/job-review/` matches `operationIds` only in tests).
    - An ADR accepting it: none. ADR-683 D1 pools "the objects whose filled paths use one operation" and says "Different operations are never pooled together". It is silent on one path bound to two operations. `visibility.ts:61-63` picks the first visible binding only "for deterministic canvas styling".
    - An unreachable path: no. The path is the inspector's default button.
  - **Own repro, `zz-n6r-addop.test.tsx`:**
    - Setup: the real `SelectedOperationInspector` is mounted with the circle selected. The button titled "Add another operation to this artwork, then edit its settings" is clicked.
    - Result: the circle path's `operationIds` become `["#000000","operation-circle"]`, a Fill layer "Operation 2" is added, and Undo gains 1 step. Circle centre: canvas ink `false`, compiled Fill groups through it `["Operation 2"]`. Plate body: ink `true`, burned by `["Operation"]`. Preflight codes: `[]`.
    - The Preview window, from `buildPreviewToolpath`, the same prepared job as Save and Start: 122 cut steps, and a hatch passes through the circle centre (scene coordinates). So Preview shows the circle engraved, but Preview is not a warning.
    - Two overlapping parts, with Add operation on the upper one: overlap canvas `false`, burn `["Operation 2"]`.
  - **Before #1511:** the same file with `planFillPools` stubbed to paint each object's own display, which is what the parent's per-object `drawObjectPolylines` did. Canvas ink is `true` at the centre and at the overlap, so the parent matched the burn.
  - **Scope:** once Operation 2 is switched to Line, the canvas and the burn agree again (overlap `false` / `[]`). The mismatch lasts while the added operation stays Fill. That is what the button creates, and editing power or speed keeps it Fill.
  - **Hover:** hovering the piece or the Operation 2 row pulses the circle (`pulse-piece-bitmap.ts:144-155`). That is transient and is not a warning.
- **Fix direction:**
  - Pool each filled path under every visible Fill operation it is bound to (the same `pathUsesOperation` test the compiler and `cancelledFillCopies` use), and paint every operation's pool, so a point any operation burns is inked.
  - Pin it with a `drawScene` test of Add operation on a pooled member, in the style of `draw-scene-fill-pools.test.ts`.

### N6-P1-2 — Regression from #1511: a pool is painted at its lowest member's place, so a photo drawn between two members now covers the upper one; artwork placed over a photo can vanish from the canvas and still burn

- **Where:**
  - `src/ui/workspace/fill-pools.ts:72-79`: a cluster's pool is queued at `cluster[0].index`, its lowest member.
  - `src/ui/workspace/draw-scene.ts:337-349`: pools are drawn before the object at that index; each member's closed fills are removed from its own display (`fill-pools.ts:318-325`, `withoutPooledFills`); a raster photo is drawn at its own index (`drawObjectBitmap`, `:349`) with full opacity (`draw-raster.ts:206-223`, no alpha).
  - Clusters are linked by overlapping boxes (`fill-pools.ts:184-212`), so a frame around a photo is in one cluster with anything on its Fill operation inside it.
- **Anchor:**
  - **Twin:** the design canvas against the compiled Fill (the caption burns).
  - **Contract:** ADR-683 Consequences: "A lone object, and every scene without overlapping objects on one Fill operation, paints exactly as before." The ADR does not mention the drawing-order change for clusters.
- **Scenario:** a photo plaque.
  - The operator draws a Fill frame (a ring with a window), imports a photo into the window, and adds a caption or logo over the photo on the frame's Fill operation.
  - The caption's box lies inside the frame's box, so the two pool. The pool is painted where the frame sits, under the photo. The photo is then drawn over the caption.
  - The canvas shows the photo with no caption. The burn engraves the photo and then hatches the caption over it.
  - Before #1511 the caption was painted after the photo.
- **Evidence:** REPRO, `zz-n6-zorder.test.ts`. The real `drawScene` with a recording context; `drawRasterImage` is replaced by a recorder because jsdom cannot decode a bitmap:
  ```text
  N6Z MAIN paint order: INK FILL (3 contours) -> IMAGE photo
  N6Z PARENT paint order: INK FILL (2 contours) -> IMAGE photo -> INK FILL (1 contours)
  ```
  The three contours on main are the frame's outer ring and window plus the caption. The caption burns: it lies in the frame's window, covered by one shape of the operation.
- **Severity:** P1 by the same rule as N6-P1-1: artwork disappears from the canvas and burns, with no warning. The refuter may weigh reach: it needs a photo drawn between two box-overlapping members of one Fill operation, which a frame-photo-caption plaque is.
- **Novelty:** new.
- **Refuter:** CONFIRMED, P1 kept.
  - **Own repro, `zz-n6r-zorder.test.ts`:** the real `drawScene` with a recording context; `drawRasterImage` is mocked to record its call, because jsdom cannot decode the bitmap.
    - Layout: an 80 × 60 outer rectangle and a 60 × 40 window rectangle on one Fill operation; a 60 × 40 photo filling the window on an Image operation; a 30 × 6 caption over the photo on the Fill operation.
    - Main: `INK FILL (3) -> INK STROKE (3) -> IMAGE photo`. The caption's fill **and its outline** are both painted before the photo.
    - Main with the caption selected: the only thing drawn after the photo is its selection box (`#3175d0` strokes).
    - No-pool model of the parent: `INK FILL (1) -> INK FILL (1) -> IMAGE photo -> INK FILL (1)`.
    - Control, with no other Fill member in the caption's box: `INK FILL (1) -> IMAGE photo -> INK FILL (1)` on both.
    - Compiled hatch: caption centre `true`, window centre `false`, frame body `true`.
  - **Is the caption visible some other way?**
    - Transparency: no. `drawBitmapAtTransform` blits with `drawImage` and sets no alpha (`draw-raster.ts:204-225`). Only a photo with an alpha channel, or the run-focus dim (0.24), would let the caption show through.
    - Selection: it shows only the caption's box, not its glyphs.
    - Hover: the pulse paints the caption alone while the pointer is over it. That is transient and is not a warning.
  - **Is the layout realistic?** Yes. It is L8-P1-1's plate-and-window pattern, with a photo in the window and Fill artwork over the photo on the same operation. Only box overlap is needed.
  - **Is it a regression?** Yes: the parent model paints the caption after the photo.
  - **Does the ADR accept it?** No. ADR-683 D1 states the lowest-member placement, but its Consequences claim only that scenes *without* overlapping objects paint as before. It does not weigh a non-member drawn between members.
  - **Can reach lower it?** No. Under METHOD §3 reach cannot lower a P1 that is reachable today.
- **Fix direction:**
  - Paint a pool at its **highest** member's index when anything not in the pool lies between its members and overlaps it. Or split a cluster at any non-member that overlaps it in drawing order, paint each part where it sits, and keep parity across the parts with a clip (the parity of the members below the split is already known).
  - Pin it with a frame-photo-caption `drawScene` order test.

### N6-P2-1 — Holes made by pooling are still solid click targets: artwork the canvas now shows through a separate Fill window, or inside cancelled stacked copies, cannot be clicked

- **Where:** `src/core/scene/hit-test.ts:44-58` tests objects topmost first, one at a time; `:138-154` (`hitPath`) decides solidity from the object's own contours only. ADR-683's pools (`fill-pools.ts`) are not consulted.
- **Anchor:**
  - **Twin:** the canvas (the window drawn empty since #1511) against the hit test.
  - **Contract:** ADR-683 D2: "A point in a hole is an interior hit … artwork shown through the hole is picked first"; ADR-196 "preserving access to nested artwork".
- **Scenario:** a Line square sits in the window of a plate whose window is a separate Fill object on the plate's operation (or a cut-out drawn later). The canvas shows the window empty and the square inside it. Clicking the square's outline or centre selects the window object; only Alt+click reaches the square. The same happens inside a pair of cancelled stacked copies, which #1511 draws unfilled.
- **Evidence:** REPRO, `zz-n6-hit.test.ts` (real `hitTest`):
  ```text
  N6HIT square drawn first, then plate, then hole: innerEdge(45,50)=hole innerCentre(50,50)=hole emptyHole(35,50)=hole body(15,50)=plate
  N6HIT square, plate, circle hole: innerEdge(45,50)=circleHole innerCentre(50,50)=circleHole …
  N6HIT stacked copies over a Line square: innerCentre(50,50)=copyB empty(35,50)=copyB
  ```
  Control, the original L8-P2-5 layout on main: `innerEdge=inner innerCentre=inner emptyHole=ring`.
- **Severity:** P2, the severity of L8-P2-5 (a wrong selection on an ordinary design, no output change). The mismatch is new with #1511: the parent painted the window solid, so selecting it matched the picture.
- **Novelty:** new; sibling of L8-P2-5.
- **Refuter:** CONFIRMED, P2 kept, with one correction.
  - **Own repro, `zz-n6r-hit.test.ts`, real `hitTest`:** a 60 × 40 Fill plate, a separate 30 × 30 Fill window and a 10 × 10 Line square.

    | Drawing order (bottom to top) | Square edge | Square centre | Empty window | Plate body |
    |---|---|---|---|---|
    | square, plate, window | `hole` | `hole` | `hole` | `plate` |
    | plate, square, window | `hole` | `hole` | `hole` | — |
    | plate, window, square | `square` | `hole` | `hole` | — |
    | square, copyA, copyB | `copyB` | `copyB` | `copyB` | — |

  - **Correction:** the square's outline stays clickable when the square sits *above* the window object in drawing order. Its centre and the empty window always go to the window object.
  - **ADR wording:** ADR-683 D1 says each member "keeps its own selection outline, hover pulse and hit test". That states the mechanism. It does not weigh the pooled-hole consequence, and D2's purpose ("artwork shown through the hole is picked first") and ADR-196 are unmet for pooled holes.
  - **Severity:** the symptom is L8-P2-5's, which v7 confirmed at P2, so P2 is kept.
- **Fix direction:** for a Fill object, decide solidity by the parity of its pool at the point (the pool's world contours are already built), so a point the canvas shows empty is an interior hit.

### N6-P3-1 — Typed rotation of a multi-selection does not come back: 37.5° then 0 moves a lopsided pair 10.18 mm; ADR-678 calls it "a little"

- **Where:** `src/core/scene/selection-transform.ts:256-280`: several objects pivot about the centre of the axis-aligned selection box (`metrics.bbox`), which moves as the layout turns.
- **Anchor:** **Contract:** ADR-678 Consequences: "Typing an angle and then the old one returns a symmetric layout exactly, but can leave a lopsided one shifted by a little." D3: the typed value "replaces the shown angle … (type the old angle to turn it back)".
- **Scenario:** an L made of a 60 × 8 bar and an 8 × 40 leg, selected together. Type 37.5, then 0: the box shows 0 again and every vertex is up to 10.18 mm from where it started. The nested group (text, photo, mirrored part) moves 3.27 mm; a mixed pair turned +10 then −10 moves 0.81 mm. Undo restores exactly.
- **Evidence:** REPRO, `zz-n6-rotate.test.tsx` (real `NumericEditsBar` and store):
  ```text
  N6ROT typed 37.5: rigid error vs exact turn about bbox centre 1.42e-14 mm; … undo + 1
  N6ROT then typed 0: max vertex move from the start (drift) 3.2658 mm
  N6ROT L pair 37.5 then 0: max vertex move 10.1754 mm
  N6ROT mixed +10 then -10: rotations [0,30] max vertex move 0.8055 mm
  ```
  Twelve typed 30° steps back to 360 returned exactly (0.0000 mm).
- **Severity:** P3. The canvas and the X/Y boxes show the moved artwork, so nothing burns differently from what is shown; the ADR understates the size.
- **Novelty:** new measurement; the behaviour is recorded in ADR-678.
- **Refuter:** CONFIRMED, P3 kept.
  - **Analytic recompute:** a bar from (0,0) to (60,8) and a leg from (0,8) to (8,48).
    - Turning 37.5° about the box centre moves that centre by 15.83 mm.
    - Turning back by −37.5° about the new centre shifts every point by 2·sin(18.75°)·15.83 = **10.1754 mm**, the auditor's figure exactly.
    - So the drift is ADR-678 D4's pivot rule working as written, not an error in the turn.
  - **What ADR-678 says:**
    - The Consequences say "Typing an angle and then the old one returns a symmetric layout exactly, but can leave a lopsided one shifted by a little".
    - D3's "(type the old angle to turn it back)" is written for "One object and a shared angle".
  - **Why not P2:**
    - The behaviour is recorded; only "a little" understates its size, which is doc/code drift.
    - The canvas and the X/Y boxes show the moved artwork, so the burn matches what is shown.
    - Undo restores it exactly.
    - The rotate handle and the remote rotate use the same pivot.
- **Fix direction:** when the selection shares an angle, pivot about the centre of its box in that rotated frame (`selectionMetricsInFrame`, `selection-transform.ts:84`), which turns with the artwork, so typing the old angle returns it exactly. Otherwise state the size in ADR-678.

### N6-P3-2 — With a Line sub-layer, the stacked-copy advisory says the copies "burn nothing" while their outline burns twice

- **Where:** `src/core/preflight/cancelled-fill-copy-issues.ts:16-21`; `src/core/job/cancelled-fill-copies.ts:34-38` checks only the Fill entries of `outputOperationLayers`.
- **Anchor:** **Contract:** ADR-683 D3 message "burn nothing"; the compiled output.
- **Scenario:** a Fill operation with a Line sub-layer (LightBurn's Fill + Line). Ctrl+D on a 40 × 30 plate: the fill burns 0 mm, the sub-layer cuts the outline twice (2 × 140 mm), and the advisory reads "2 stacked copies on Fill operation "Operation" burn nothing."
- **Evidence:** REPRO, `zz-n6-fill.test.ts`: `fill+line sublayer dup: fill mm 0.0 all mm 280.0 single all mm 2540.0 advisory ["2 stacked copies on Fill operation \"Operation\" burn nothing. …"] groups cut`.
- **Severity:** P3. The advice to delete the copy is right; the claim is wrong in part.
- **Refuter:** CONFIRMED (READ plus the auditor's REPRO), P3 kept.
  - The message is literal: "…burn nothing." (`cancelled-fill-copy-issues.ts:18`).
  - `outputOperationLayers` emits each sub-layer as its own output layer (`layer.ts:453-457`). `cancelledFillCopies` skips operations whose effective mode is not Fill, so the Line sub-layer cuts both outlines.
  - 2 copies × 2 × (40 + 30) = 280 mm, the auditor's figure.
- **Fix direction:** say "leave no fill" (or name the outline passes) when the operation has an output Line sub-layer.

### N6-P3-3 — Dense Fill clusters redraw several times slower: 5,000 mutually overlapping circles take 611–1,000 ms a frame against 71–443 ms before #1511

- **Where:** `src/ui/workspace/fill-pools.ts:69-86` (`planFillPools` each frame), `:184-212` (pairwise sweep; quadratic when every box overlaps), `:223-244` (world contours rebuilt when any member changes).
- **Anchor:** **Contract:** ADR-683 Consequences ("A pooled cluster rebuilds its world contours when a member changes").
- **Evidence:** REPRO, `zz-n6-fill2.test.ts`, jsdom, a no-op context and one persistent display cache, 4 frames then one member moved:
  ```text
  N6FILL2 MAIN 5000 overlapping D50 circles: frames 1000/617/611/704 ms; after one member moves 926 ms
  N6FILL2 PARENT 5000 overlapping D50 circles: frames 443/71/92/280 ms; after one member moves 190 ms
  N6FILL2 MAIN 5000 tiles overlapping neighbours: frames 95/74/50/55 ms; after one member moves 49 ms
  N6FILL2 PARENT 5000 tiles overlapping neighbours: frames 85/45/44/49 ms; after one member moves 54 ms
  ```
  Tile arrays and grids are unaffected. Preflight's stacked-copy scan took 44–212 ms at 5,000 objects.
- **Severity:** P3 (performance on an unusual scene; jsdom timings, not a browser).
- **Refuter:** CONFIRMED, P3 kept.
  - Own repro, `zz-n6r-perf.test.ts`: 5,000 Ø50 circles scattered over a 40 mm square, a no-op context, one display cache, 4 frames and then one member moved.

    | Scene | Main | Parent (no-pool model) |
    |---|---|---|
    | 5,000 overlapping circles, 4 frames (ms) | 1216 / 413 / 544 / 681 | 661 / 103 / 111 / 50 |
    | Same, after one member moves (ms) | 795 | 67 |
    | 5,000 tiles, 5 frames (ms) | 80 / 66 / 45 / 48 / 52 | 58 / 67 / 51 / 40 / 50 |

  - When every box overlaps, the sweep at `fill-pools.ts:195-204` never breaks early, so it is quadratic.
- **Fix direction:** cache the cluster plan by the members' identities and boxes, as the contours already are; or skip pooling a cluster above a size bound and say so.

### N6-P3-4 — A remote board array that fits no copy is refused as "not supported by the current remote tool", with no count

- **Where:** `src/ui/remote-control/board.ts:80` (`unsupported_operation` when the scene is unchanged); `src/ui/remote-control/fault.ts:6`. The desktop form disables Array on board and shows the count (`BoardArrayForm.tsx:16,42`).
- **Anchor:** **Contract:** ADR-125 Amd 4 D2–D4 (the receipt names the counts; "The copies that fit are placed, as on the desktop").
- **Evidence:** REPRO, `zz-n6-board.test.ts`: a 250 × 20 design on a 200 × 100 board, `rows 2, cols 2` → `{"ok":false,"error":{"code":"unsupported_operation","message":"This operation is not supported by the current remote tool."}}`, no PC toast.
- **Severity:** P3. Nothing is placed and nothing burns; an agent may report the tool as unavailable.
- **Refuter:** CONFIRMED (READ plus the auditor's REPRO), P3 kept.
  - With no offset in the plan, `applyTileSelectionIntoBoard` returns the state unchanged (`board-tile-actions.ts:59-60`).
  - `board.ts:80` then throws `unsupported_operation`, and the counts computed at `:79` (`placedCount 0`) are discarded.
- **Fix direction:** return `placedCount: 0` with a "no copy fits the board" notice, or a refusal reason.

### N6-P3-5 — The phone's vector canvas still tints each Fill object separately, so a pooled hole shows darker, not empty

- **Where:** `src/ui/remote-control/scene-projection.ts:164` (`fill: path.paint.kind === 'fill'` per path); the phone draws each path with `fill-rule: evenodd` at 18 % opacity (`services/remote-control/app/src/ui/app.css:914-917`, `canvas-layers.tsx:84-90`). Overlaps add up instead of cancelling.
- **Anchor:** **Contract:** ADR-683 Consequences ("Not changed: the phone's vector projection … still fill object by object"). The phone's PNG preview does pool (`preview-projection.ts:69-72`).
- **Evidence:** READ.
- **Severity:** P3. Recorded in the ADR; the tint is light and outlines stay visible.
- **Refuter:** CONFIRMED by READ, P3, but **KNOWN**.
  - **What the code does:**
    - `scene-projection.ts:163-164` sends a `fill` flag per path.
    - `canvas-layers.tsx` draws one `<path>` per path.
    - In `app.css`, `.art-path.fill` is `fill-opacity: 0.18; fill-rule: evenodd`.
    - So two stacked 18 % fills tint a pooled hole darker.
  - **Why KNOWN:** ADR-683 Consequences record it as deliberately left: "Not changed: the phone's vector projection … still fill object by object". It is counted as KNOWN, not new.
- **Fix direction:** send per-operation pooled contours (or a parity flag per region) to the phone.

### N6-P3-6 — Ctrl/Cmd+Shift+H / V read only the typed letter, so on a non-Latin layout the flip keys do nothing, while Alt+V and Alt+Shift+H / V fall back to the physical key

- **Where:** `src/ui/app/editing-tool-shortcuts.ts:83-94` (`e.key.toLowerCase()` only); compare `isAltLetterChord` (`shortcuts.ts:390-394`) and `altShiftLetter` (`arrange-shortcut-keys.ts:80-86`), which fall back to `e.code` when the key is not a Latin letter.
- **Anchor:** **Contract:** ADR-410 Amd 4 D1–D2 (flip chords; Alt+V "read the way every Alt-letter chord is").
- **Evidence:** REPRO, `zz-n6-keys.test.tsx`: `Russian layout Ctrl+Shift+V (key М) | prevented=false | NO CHANGE`; `Russian layout Alt+V (key м) | prevented=true | … [Paste in Place]`.
- **Severity:** P3 (layout parity polish; the Ctrl+letter edit keys share the limitation).
- **Refuter:** CONFIRMED (READ plus the auditor's REPRO), P3 kept.
  - `tryShiftChord` compares only `e.key.toLowerCase()` (`editing-tool-shortcuts.ts:84-86`). `isAltLetterChord` (`shortcuts.ts:390-394`) and `altShiftLetter` (`arrange-shortcut-keys.ts:80-86`) fall back to `e.code`.
  - ADR-410 Amd 4 D1 says nothing about layouts.
  - Ctrl+D (`shortcuts.ts:282`) reads `e.key` too, so this is the general Ctrl-letter limitation.
- **Fix direction:** use the same `e.code` fallback for the Ctrl/Cmd+Shift letter chords.

## KNOWN re-observed

- **N6-P3-5** (reclassified by the refuter). The phone's vector canvas fills object by object, which ADR-683 Consequences record as "Not changed". It stays listed under Findings for its fix direction.
- **L8-P3-8** (v7): most LightBurn Edit / Arrange / Tools keys unbound; Alt+- zooms out; Ctrl+K opens Find a command. Unchanged; ADR-499 Amd 2 Consequences leave Alt+- for a later pass.
- **L8-P2-2** (v7, P3): Ctrl+. and Ctrl+, stay Abort and Settings; now recorded in ADR-410 Amd 4 D4.
- **L4-P3-3 / L4-P3-5** (v7): the centre pivot (now recorded in ADR-678 D4) and locked group members staying put (ADR-678 Consequences).
- **2026-07-17 layers-panel parity, line 20:** a hidden operation with Output on still burns (LightBurn's rule). Seen here as `hidden op | body: canvas=- burn=hatch`; the stacked-copy advisory still fires there, which is right.

## Refuted

- **Refuter (2026-10-29):** none of the 9 raised findings was refuted. Correction to N6-P2-1: the inner square's outline is still picked when the square sits above the window object in drawing order. Reclassified: N6-P3-5 is KNOWN (ADR-683 Consequences), not new. The candidates below were refuted by the auditor.
- **"Ctrl+Alt+PgUp / PgDn can still move the machine from a text field or the jig editor."** No: a text field, a number field, a modal (`modalDepth 1`, which the jig editor registers, `RegistrationJigEditor.tsx:20`), a repeat and the keypad all give `jog=[]`.
- **"A remote array lands in a jig outline drawn before the captured board."** No: `addCapturedBoardBox` leaves one registration box (`boxes in order ["captured-board:…"]`), and the array fills it.
- **"The remote 50 × 50 grid count is wrong at the cap."** No: 484 of 2,500 with the cap notice, the same plan the desktop form reads (√(500/2500) × 50 = 22 per axis).
- **"Typed rotation is not rigid for mirrored, non-uniformly scaled or image members."** No: `applyTransform` turns after scale and mirror (`transform.ts:10-21`), and every vertex matched an exact turn to 1.4e-14 mm.

## Verified clean

- Fill siblings that match the burn point for point: three overlapping shapes, a hole with an island, a non-zero glyph over a plate (and alone), a per-object 45° hatch override, a per-object Line override, Alt operation colours (one pooled `evenodd` fill in the layer colour), Wireframe (no fills), selection (unchanged pool).
- Off-canvas culling cannot change a pool's visible parity: a culled member lies wholly off screen, and parity changes only inside a member (`draw-scene.ts:459-462`).
- `cancelledFillCopies`: laser only (`cancelled-fill-copy-issues.ts:9`), output operations only, even counts only; Job Review's warning reaches the remote Start review (`machine-review-pages.ts:65-66`).
- #1510's documentation: WORKFLOW F-A15 (`:548`, `:1896`, `:1914-1921`, `:1957-1961`), the shortcut list (`shortcut-list.ts:30,43,73-74`), the menu labels from the one Arrange key table, and the update note all carry the new keys; no stale "PgUp jogs Z" or "Ctrl+Shift+V pastes" text remains outside audits and ADR history.
- Key sweep: every changed key is consumed once and names its Undo step; Ctrl+Shift+V in a text field is left to the browser.
- #1504's ADR-678 D5: the angle is reduced before the trig (`selection-transform.ts:263`); twelve 30° typed steps return to 0.0000 mm.

## Not verified

- Canvas pixels and sprite timing in a real browser; the N6-P1-2 photo opacity is read from `draw-raster.ts`, not seen.
- The hover pulse and edit glow (ADR-646) on a pooled member: they paint the member alone (`pulse-piece-bitmap.ts:129-156`); how far that tints a pooled hole was not measured.
- A laser project switched to CNC keeps `mode: 'fill'` and pools on the canvas (`layer mode fill` after `setMachineKind('cnc')`), while CNC on-path (the default cut type) cuts both copies. The canvas shows the outline either way; not raised.
- Real keyboards, real AZERTY / QWERTZ / Russian layouts, Electron's macOS native Edit menu, and Ctrl+PgUp / PgDn in a browser tab (ADR-493 Amd 2 admits the last).
- Windows AltGr+V (Ctrl+Alt+V) runs ordinary Paste because the Ctrl+V binding ignores Alt (`shortcuts.ts:257-260`); this predates #1510 and was not raised.
- Save showing the stacked-copy advisory: READ (`preflight.ts:179`), not run.
- The LightBurn 2.0 cheatsheet was not re-downloaded; its rows come from v7 L8's pinned copy.

## Repro files

All under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\`, deleted after the run, one file at a time.

| File | Purpose |
|---|---|
| `zz-n6-vitest.config.ts` | repo config + `fflate` alias + one worker; `N6_STUB` swaps parent files |
| `src\ui\workspace\zz-n6-fill.test.ts` | L8-P1-1 and its extension; Fill siblings; sub-layer advisory; CNC switch; 5,000-object timings (recording context) |
| `src\ui\workspace\zz-n6-fill2.test.ts` | N6-P1-1 (Add operation) on main and parent; frame timings (no-op context) on main and parent |
| `src\ui\workspace\zz-n6-zorder.test.ts` | N6-P1-2 paint order on main and parent |
| `src\core\scene\zz-n6-hit.test.ts` | L8-P2-5 re-run and N6-P2-1, main and parent |
| `src\ui\app\zz-n6-keys.test.tsx` | #1510 repros through `useShortcuts`, Abort and the real `JogPad`; layouts; the LightBurn key sweep |
| `src\ui\commands\zz-n6-rotate.test.tsx` | L4-P2-1 through the real `NumericEditsBar`; rigid check; Undo / Redo; drift |
| `src\ui\remote-control\zz-n6-board.test.ts` | L4-P2-2 and remote array siblings |
| `src\ui\workspace\zz-n6-p1511-draw-scene.ts`, `src\core\scene\zz-n6-p1511-hit-test.ts` | #1511 parent files (`6b79c2e2e`) |
| `src\ui\app\zz-n6-p1510-editing-tool-shortcuts.ts`, `src\ui\commands\zz-n6-p1510-arrange-shortcut-keys.ts`, `src\ui\laser\zz-n6-p1510-use-jog-shortcuts.ts` | #1510 parent files (`3bf24619f`) |
| `src\core\scene\zz-n6-p1504-selection-transform.ts`, `src\ui\remote-control\zz-n6-p1504-board.ts` | #1504 parent files (`76511fb89`) |

Existing tests run: `draw-scene-fill-pools.test.ts` 6/6, `hit-test.test.ts` 21/21, `lightburn-shortcut-parity.test.tsx` 16/16, `JogPad.keyboard-jog.test.tsx` 10/10 on main, each also against the parent (the JogPad hybrid does not render); `selection-transform.test.ts`, `NumericEditsBar.group-rotation.test.tsx` and `board.test.ts` against the parent only (CI covers main). Two parent runs first failed to start a worker while other agents' suites loaded the PC and were re-run alone. The hash check also wrote four lists outside `j7-main` (`zz-n6-tree.txt`, `zz-n6-paths.txt`, `zz-n6-hashes.txt`, `zz-n6-hasherr.txt` in the scratchpad), deleted too.

## Refuter method (2026-10-29)

- **Fresh context.** The report, METHOD §3–§5 and §8, v7 and v8 `AREAS.md`, ADR-683, ADR-678 and ADR-410 Amd 4 were read at `origin/main`.
- **Main moved.** `git fetch` gave `7d7cedcd6`. Since `4f71f1f41` only #1518 merged (`src/ui/state/registration-jig-artwork-actions.ts` and one test), which touches no cited file. In `j7-main`, 13 cited files were hash-checked against `origin/main` (`fill-pools.ts`, `draw-scene.ts`, `object-display.ts`, `hit-test.ts`, `visibility.ts`, `operation-actions.ts`, `clone-artwork-operations.ts`, `cancelled-fill-copies.ts`, `cancelled-fill-copy-issues.ts`, `selection-transform.ts`, `board.ts`, `editing-tool-shortcuts.ts`, `scene-projection.ts`): all match.
- **Open PRs.** `gh pr list --state open` gives #1478, #1519 and #1520. None touches these files.
- **Parent model.** The parent version of `draw-scene.ts` was not swapped in. Instead, `vi.mock('./fill-pools')` with `N6R_PARENT=1` stubs `planFillPools` to "no pools, each object's own display". That is what #1511's parent painted through `drawObjectPolylines`, and it is a separate line of evidence from the auditor's file swap.
- **Repro files,** all under `j7-main`, run one at a time with `--config zz-n6r-vitest.config.ts` (the repo config, the `fflate` alias and one worker):

  | File | What it checks | Result |
  |---|---|---|
  | `src\ui\workspace\zz-n6r-addop.test.tsx` | N6-P1-1 through the mounted `SelectedOperationInspector` button, `drawScene`, `compileJob`, `emitGcode` preflight and `buildPreviewToolpath`; main and the parent model | 2/2 each |
  | `src\ui\workspace\zz-n6r-zorder.test.ts` | N6-P1-2 paint order, with `drawRasterImage` recorded; main and the parent model | 2/2 each |
  | `src\core\scene\zz-n6r-hit.test.ts` | N6-P2-1 with the real `hitTest`, in three drawing orders plus stacked copies | 1/1 |
  | `src\ui\workspace\zz-n6r-perf.test.ts` | N6-P3-3 frame timings; main and the parent model | 1/1 each |

- **Other checks.** N6-P3-1 was recomputed analytically, in a node one-liner. N6-P3-2, P3-4, P3-5 and P3-6 were checked by reading the cited code, alongside the auditor's repros.
- **Clean-up.** Every `zz-n6r-*` file was deleted afterwards, one literal path at a time. `zz-n7*` and the earlier `zz-j7-*` files were left alone. No hardware was used.

```json
[
  {"id":"N6-P1-1","severity":"P1","area":"fix-canvas-keys","file":"src/ui/workspace/fill-pools.ts","line":162,"anchor":"Contract: ADR-683 D1 (the canvas paints each Fill operation as the one region it burns; objects whose filled paths use one operation are pooled); Twin: compiled Fill per output operation; adjacent KNOWN rolling 2026-07-17 layers-panel parity line 13 (multi-bound artwork styled by first operation)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1511: operationMembers pools a filled path under path.operationId, the first visible bound operation (object-display.ts:97-106, visibility.ts:65-85). Add operation (OperationInspectorControls.tsx:98-107 -> addOperationForObjects -> appendSceneObjectOperationBinding) binds the selected circle of a plate+circle Fill design to a copied Fill 'Operation 2'. Canvas ink at the circle centre false, burn hatched by Operation 2, preflight []; overlapping parts likewise. #1511 parent canvas: ink true (matched the burn)","refuter":"CONFIRMED: refuter REPRO through the mounted SelectedOperationInspector Add operation button: circle path ops [#000000, operation-circle], centre canvas ink false, compiled fill through centre [Operation 2], emitGcode preflight [], Preview toolpath hatches the centre; no-pool parent model ink true; overlapping pair same; agrees again once Operation 2 is Line. ADR-683 silent on multi-bound paths. P1 kept (no warning; Preview is not a warning)"},
  {"id":"N6-P1-2","severity":"P1","area":"fix-canvas-keys","file":"src/ui/workspace/fill-pools.ts","line":77,"anchor":"Twin: canvas vs compiled Fill; Contract: ADR-683 Consequences (only overlapping Fill objects change; drawing-order change for clusters not recorded)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Regression from #1511: a cluster's pool is painted at its lowest member's index (fill-pools.ts:72-79, draw-scene.ts:337-349) and members lose their own closed fills. Frame (Fill ring) -> photo -> caption on the frame's Fill operation: main paint order INK FILL (3 contours) -> IMAGE photo, so the opaque photo (draw-raster.ts:206-223) covers the caption, which still burns; parent order frame -> photo -> caption","refuter":"CONFIRMED: refuter REPRO frame(outer+window)/photo/caption: main INK FILL(3) -> INK STROKE(3) -> IMAGE photo (caption fill and outline under the photo; selected: only its box after); parent model caption after photo; control unaffected; caption burns. drawImage has no alpha; hover pulse transient. P1 kept"},
  {"id":"N6-P2-1","severity":"P2","area":"fix-canvas-keys","file":"src/core/scene/hit-test.ts","line":138,"anchor":"Contract: ADR-683 D2 ('artwork shown through the hole is picked first'), ADR-196; Twin: canvas pooled hole vs per-object hit test","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Sibling of L8-P2-5: hitTest decides solidity per object, so a window made by a separate Fill object (drawn empty since #1511) or a cancelled stacked pair still captures clicks: Line square edge and centre pick 'hole' / 'circleHole' / 'copyB'; only Alt+click reaches it. Single-object holes are fixed (innerEdge=inner)","refuter":"CONFIRMED: refuter REPRO real hitTest; correction: a Line square drawn above the window object keeps its outline clickable, its centre and the empty window always pick the window object; ADR-683 D1 keeps each member own hit test (mechanism, consequence not weighed); P2 kept as L8-P2-5"},
  {"id":"N6-P3-1","severity":"P3","area":"fix-canvas-keys","file":"src/core/scene/selection-transform.ts","line":264,"anchor":"Contract: ADR-678 Consequences ('shifted by a little'), D3 (type the old angle to turn it back)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Multi-selection typed rotation pivots about the axis-aligned box centre, which moves: 37.5 then 0 leaves an L pair 10.18 mm off, a nested group 3.27 mm, mixed +10/-10 0.81 mm; Undo exact; rigid to 1.4e-14 mm per turn. Fix: pivot in the shared rotated frame (selectionMetricsInFrame)","refuter":"CONFIRMED: refuter analytic recompute 10.1754 mm (box centre moves 15.83 mm, 2 sin 18.75 deg x 15.83) = ADR-678 D4 pivot rule; recorded behaviour, size understated; shown on canvas and X/Y, Undo exact; P3 kept (not P2)"},
  {"id":"N6-P3-2","severity":"P3","area":"fix-canvas-keys","file":"src/core/preflight/cancelled-fill-copy-issues.ts","line":18,"anchor":"Contract: ADR-683 D3 message; compiled output","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Fill operation with a Line sub-layer, Ctrl+D on a plate: fill 0 mm, outline cut twice (280 mm), advisory says the copies 'burn nothing'","refuter":"CONFIRMED: refuter READ (message literal; outputOperationLayers emits the Line sub-layer; 2 x 140 mm) + auditor REPRO; P3 kept"},
  {"id":"N6-P3-3","severity":"P3","area":"fix-canvas-keys","file":"src/ui/workspace/fill-pools.ts","line":184,"anchor":"Contract: ADR-683 Consequences (cluster rebuild cost)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"5,000 mutually overlapping Fill circles: 611-1000 ms per frame on main vs 71-443 ms on the parent, one member moved 926 vs 190 ms (jsdom, no-op context, persistent cache); tile arrays unaffected","refuter":"CONFIRMED: refuter REPRO 5,000 overlapping circles main 413-681 ms/frame (one moved 795) vs parent model 50-111 (67); tiles unchanged; P3 kept"},
  {"id":"N6-P3-4","severity":"P3","area":"fix-canvas-keys","file":"src/ui/remote-control/board.ts","line":80,"anchor":"Contract: ADR-125 Amd 4 D2-D4; Twin: BoardArrayForm.tsx:16,42 disables with the count","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Remote place_on_board array of a design wider than the board: unsupported_operation 'This operation is not supported by the current remote tool.', no count, no PC toast","refuter":"CONFIRMED: refuter READ board-tile-actions.ts:59-60 returns state for zero offsets, board.ts:80 throws unsupported_operation, counts discarded; + auditor REPRO; P3 kept"},
  {"id":"N6-P3-5","severity":"P3","area":"fix-canvas-keys","file":"src/ui/remote-control/scene-projection.ts","line":164,"anchor":"Contract: ADR-683 Consequences (phone vector projection not changed); Twin: phone PNG preview pools","evidence":"READ","verdict":"CONFIRMED","known":true,"summary":"The phone's vector canvas fills each path even-odd at 18% opacity per object, so a pooled hole shows a darker tint where nothing burns","known_ref":"ADR-683 Consequences (Not changed: phone vector projection)","refuter":"CONFIRMED by READ, KNOWN: ADR-683 Consequences record the phone vector projection as not changed (fills object by object); P3"},
  {"id":"N6-P3-6","severity":"P3","area":"fix-canvas-keys","file":"src/ui/app/editing-tool-shortcuts.ts","line":85,"anchor":"Contract: ADR-410 Amd 4 D1-D2; Twin: isAltLetterChord / altShiftLetter e.code fallback","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"On a Russian layout Ctrl+Shift+V (key М) does nothing while Alt+V (key м) pastes in place: the flip chords read e.key only","refuter":"CONFIRMED: refuter READ tryShiftChord e.key only vs isAltLetterChord/altShiftLetter e.code fallback; Ctrl+D shares it; + auditor REPRO; P3 kept"}
]
```
