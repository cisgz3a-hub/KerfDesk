# Rolling audit v9 — R5 Fill canvas fix (#1526)

- **When:** 2026-11-02 +0800   **Tree:** origin/main @ `54e0e19b8` (`git fetch origin main` gave the same SHA at the start).
  - Merge commit: #1526 `32faf9fd1` (first parent `7dd26ea04`). `git log 32faf9fd1..origin/main` over `fill-pools.ts`, `draw-scene.ts`, `hit-test.ts`, `hit-test-candidates.ts`, `fill-operations.ts`, `object-display.ts`, `fill-pool-clusters.ts` and `draw-vector-strokes.ts` is empty.
  - **Repros ran on main's tree, not the worktree,** in `…\scratchpad\j7-main\`. Six core files were hash-checked against `origin/main`: all match.
  - **Before #1526** means the first parent's seven changed source files, served by a Vitest `load` hook (`R5_PARENT=1`) from an export kept outside `j7-main`.
- **Scope:** fix verification and siblings of #1526 (ADR-683 Amendment 1). Findings it fixes: N6-P1-1, N6-P1-2, N6-P2-1, and it speeds up N6-P3-3.
- **Lenses run:**
  - **L10:** every original repro, through the real store (Add operation, Duplicate) where a store route exists, then `drawScene` against `compileJob`, rasterised on one 1 mm grid.
  - **L9:** overlaps, nested holes, sub-layers, hidden and disabled operations, per-object overrides, three fill styles, cross-hatch, text and non-zero paths, per-path bindings, members either side of a photo, Fill or Line object, jig runs, CNC, export and print, the phone's PNG.
  - **Clicks:** `hitTest`, `hitTestCandidates` and a grid sweep of `hitTestObject` against the painted picture.
  - **Performance:** a no-op context and one display cache, against the parent. Another agent may have been running, so timings are rough.
  - **L7:** the PR's tests against the parent's code.
  - **Not run:** a real browser or GPU, or hardware.
- **Counts:** 11 raised → after the refuter P1 3 / P2 2 / P3 6 (+ 5 KNOWN re-observed); confirmed 10, plausible 1, refuted 0. One P1 is a regression from #1526, one is an uncaught regression from #1511, and one is older than both with a KNOWN root. R5-P1-4 keeps its ID but is now P3 (latent).

## Refuter method

- **Tree:** main `54e0e19b8`, re-fetched at the end. Six core files were hash-checked against `origin/main`. "Parent" is `7dd26ea04`, served by a Vitest `load` hook from an export outside `j7-main`, including `hit-test.ts` and `hit-test-candidates.ts`.
- **Picture:** a recording context captured every `drawScene` call, and the calls were replayed into a **real Chromium 2D canvas** (Playwright headless shell, 3200 × 2400, 5.85 px/mm), so the browser did the even-odd fills, clips and strokes. Pixels were read at a **0.25 mm grid** and compared with `compileJob`'s hatch. "Core" areas below are mismatches left after eroding by 0.75 mm, which removes edge noise. Crops were also looked at by eye.
- **Actions:** real `addOperationForSelection`, `setLayerParam` (what "Include in output" and the mode control call), `useOperationForSelection` (Assign), `replaceRegistrationJigSet`, `centerSelectionInRegistrationBox`, `importLightBurnProject`, and `serializeProject` → `deserializeProject`. Photos are a magenta rectangle at the photo's box, because `drawImage` of a real bitmap was not replayed.
- **Controls:** the plate and circle alone, Add operation with Output on, a lone object on an Output-off operation, a whole pool on an Output-off operation, and one jig box all behaved as the matrix says.
- **Timings:** no-op context, one worker, 4 frames. Machine CPU load read 9% and 24% around the runs, with about 4 GB free. No raster cost is included.
- **Not run:** the app's own React canvas or GPU, or hardware. Repro files were deleted by literal path. Logs and recordings stay in `…\scratchpad\r5r-out`, `r5r-out-parent`, `r5r-parent`, and the scripts `r5r-replay.cjs` and `r5r-inspect.cjs`, all outside `j7-main`.

**Spot-check of what #1526 fixed, on the real canvas:**

| Finding | Main | Parent |
|---|---|---|
| N6-P1-1, Add operation on a plate's circle | circle ink, burn 1; core mismatch 0 | circle white, burn 1; burn with no ink 151.9 mm² |
| N6-P1-1, overlap | overlap ink, burn 1; core 0 | overlap white, burn 1; 175.6 mm² |
| N6-P1-2, frame, photo, caption | caption ink over the photo, burn 1; core 0 | caption under the photo, burn 1 |
| N6-P2-1, three drawing orders | square edge and centre pick `square`; empty picks `window`; body picks `plate` | `window` at the square in all three, except the edge in the plate, window, square order |

All three are fixed on main.

## Headline

**Refuter's changes to this headline:** R5-P1-4 is P3, because no app route creates a sub-layer today. Its live form is a Line-then-Fill binding, which `.lbrn` import does create, and that belongs with R5-P1-3's root. In R5-P1-1 the click half is not a regression. R5-P3-1's 20,000-object row is over the project limit.

**#1526 fixes all three findings it names, and it holds for each of them. It does not fully hold, because "every Fill operation" also counts operations with Output off.**

- **Fixed:**
  - N6-P1-1: the circle given a second Fill operation by the real Add operation action now shows inked, as it burns.
  - N6-P1-2: frame, photo, caption now paints the caption over the photo.
  - N6-P2-1: clicks reach the Line square, in all three drawing orders and through cancelled copies.
  - N6-P3-3: 5,000 overlapping circles fell from 269–294 ms a frame to 56–104 ms.
- **R5-P1-1 (regression from #1526).** Add operation on a plate's circle, then turn Output off on "Operation 2". The canvas shows the circle solid, but the burn has a hole there. The parent's canvas showed the hole. A Line square inside that hole also cannot be clicked, and the phone's PNG shows the same solid circle.
- **R5-P1-2 (regression from #1511, not caught by N6 or #1526).** With two or more jig boxes, each jig instance compiles in its own run, so it does not pool with anything else. The canvas pools across runs, so it shows a hole where the job burns solid.
- **R5-P1-3 and R5-P1-4 (older than #1511).** A Fill that burns under a path the canvas strokes is left out of the picture:
  - A circle on Line then Fill keeps a plate on that Fill solid on the canvas, while the burn has the hole.
  - A Line operation with a Fill sub-layer shows outlines only, while it burns a hatched ring.
- **R5-P2-1.** Print and SVG export still write N6-P1-1's hole. **R5-P2-2.** In Wireframe the plate's empty interior still takes the click.

## Matrix

The grid is 1 mm over the artwork. "Canvas" is the last fill, under its clips, or photo at the point. "Burn" is a compiled hatch line through the point. Rims of up to 16 points on a circle or turned shape are grid noise (the hatch tolerance is 0.3 mm) and count as a match. Under a photo, the photo is what shows, so a burn there is not compared.

| Scene | Canvas | Burn | Match? | Before #1526 | Verdict |
|---|---|---|---|---|---|
| Plate + circle, real Add operation on the circle | circle ink | circle hatched (2,400 mm) | yes | hole; 201 points burn with no ink | **Fixed** |
| Overlapping a, b; Add operation on b | overlap ink | overlap hatched | yes | 225 points burn with no ink | **Fixed** |
| Add operation on the plate | ink | hatched | yes | 201 points burn with no ink | **Fixed** |
| Frame, photo, caption | caption over photo | caption hatched | yes | caption under photo (180 points) | **Fixed** |
| Frame, caption, photo on top | photo over caption | caption hatched under it | yes, as drawn | same | Clean |
| 40 × 30 plate + Ø16 circle | ring | ring (2,001 mm) | yes | same | Clean |
| Ctrl+D on a Fill part (store) | no ink | 0 mm | yes | same | Clean |
| 3 overlapping; 4 nested; 3 stacked copies | parity | parity | yes | same | Clean |
| Fill + Line sub-layer; Fill + Fill 45° sub-layer; disabled sub-layer | ring | ring (+ outline cut) | yes | same | Clean |
| **Line main + Fill sub-layer** | **outlines only** | **hatched ring; 1,010 points** | **no** | same | **R5-P1-4** |
| **Add operation, Operation 2 Output off** | **circle ink** | **hole; 190 points** | **no** | hole, matches | **R5-P1-1** (regression) |
| **a[F], b[F, G off], overlapping** | **overlap ink** | **no hatch; 225 points** | **no** | matches | **R5-P1-1** (regression) |
| **plate[F], circle[G off, F]** | **circle ink** | **hole; 190 points** | **no** | same mismatch | **R5-P1-1** (not new in this order) |
| Lone object on an Output-off operation | ink | none | no, by rule | same | KNOWN (shown, not output) |
| plate[G off], circle[G off, F] | ring + circle ink | circle only | circle yes | 201 points burn with no ink | **Fixed** |
| Hidden first: plate[G hidden, F], circle[G hidden, F] | ring | ring + G's | visible part yes | same | Clean |
| Hidden first or second G on the circle only, Output on | hole | G burns the circle solid | no, by rule | same | KNOWN (hidden + Output burns) |
| Hidden and disabled second | hole | hole | yes | same | Clean |
| **circle[L, F], plate[F]** | **plate solid at circle** | **hole; 190 points** | **no** | same | **R5-P1-3** |
| circle[L, F] alone | outline | solid | no | same | KNOWN (ADR-683 Amd 1 "Not changed") |
| circle[F, L] | ring | ring + outline | yes | same | Clean |
| Per-object angle, power or powerScale on circle or plate; mixed powers on three | parity | parity (ownership cells, 3-way) | yes | same | Clean |
| Per-object Line override on circle or plate | stroke, solid other | same | yes | same | Clean |
| Fill override on a Line operation (one or both) | parity | parity | yes | same | Clean |
| Image-mode override; `byOperation` Line on the second op | as resolved | same | yes | same | Clean |
| Scanline, island, offset × plate + circle, overlap, three; cross-hatch | parity | parity | yes | same | Clean |
| Non-zero glyph, alone and on a plate; two overlapping paths in one object, alone and on a plate | object's union, then parity | same | yes | same | Clean |
| Path colours differ on one operation (one or two objects) | parity | parity | yes | same | Clean |
| Paths on different ops; second path on two ops | parity per op | same | yes | second case: 400 points burn with no ink | **Fixed** |
| Turned, scaled, mirrored window | parity | parity | yes | same | Clean |
| A, photo, C partly over A | C over photo, shared area empty | A under photo | yes | C hidden too (1,000 under photo, now 500) | **Fixed** |
| A, photo, window; A, Fill on op 2, C or window; A, Line, window; both ops interleaved | photo or other op shows in the hole | same | yes | same on the grid | Clean |
| Photo below everything; off to the side; on a hidden layer | hole shows it, or no split | same | yes | same | Clean |
| plate[F, G], photo, circle[F] | as burned | same | yes | 101 points burn with no ink | **Fixed** |
| Two jig boxes, copies not overlapped | parity | parity | yes | same | Clean |
| **Two jig boxes, ordinary window on a jig copy** | **hole** | **solid; 100 points** | **no** | same | **R5-P1-2** |
| **Overlapping jig boxes and copies** | **overlap empty** | **overlap burns; 100 points** | **no** | same | **R5-P1-2** |
| One jig box, ordinary on copy | hole | hole | yes | same | Clean |
| Phone PNG, plate[F] + circle[F, G off] | circle ink | hole | **no** | not run | **R5-P1-1** (same pool code) |
| CNC Pocket: overlap, nested | parity | no cut in the overlap; inner cut | yes | same | Clean |
| CNC Pocket: stacked copies | no ink | pocket cut once, with a note | no, warned | same | R5-P3-4 |

**Clicks** (`hit` at the Line square's edge and centre, an empty window, the plate body):

| Layout | Before #1526 | Main |
|---|---|---|
| square, plate, window | window, window, window, plate | **square, square,** window, plate |
| plate, square, window | window, window, window, plate | **square, square,** window, plate |
| plate, window, square | square, window, window, plate | square, **square,** window, plate |
| square, copy A, copy B | copyB, copyB, copyB | **square, square,** copyB |

- **Every kind under a hole** (Line, Fill on another operation, image, Fill text, Line text), below, between and above: edge and centre pick it, the empty window picks `window`, the body picks `plate`.
- **Alt+click** at the centre gives `[u, window, plate]` for all five.
- **Locked:** a locked plate leaves the window and square clickable; a locked window makes the plate the interior hit.

## Findings

### R5-P1-1 — Regression from #1526: an Output-off second Fill operation makes a path solid on the canvas; the burn has a hole there

- **Where:**
  - `src/core/scene/fill-operations.ts:31-35`: `pathFillOperations` lists every visible Fill operation, whatever its output.
  - `src/ui/workspace/object-display.ts:248-252` passes them on. `src/ui/workspace/fill-pools.ts:226-239` builds a pool for each, and `:107` paints a lone member when it is `shared`.
  - `src/core/scene/hit-test.ts:180-181` (`fills.some(pools)`) makes it solid to a click the same way.
  - The compiler uses only output operations (`src/core/scene/layer.ts:453-457`).
- **Anchor:**
  - **Contract:** ADR-683 Amendment 1 Consequences: "The canvas inks every point a Fill operation burns". Item 1 pools under "every visible Fill operation it is bound to" and does not weigh Output off. `fill-operations.ts:23` calls them the operations a path "burns under"; an Output-off operation burns nothing.
  - **Twin:** the design canvas against the compiled Fill. An Output-off operation painting its own artwork is the KNOWN rule. Filling a hole that an Output-on operation burns empty is not.
- **Scenario:** a plate and a logo on one Fill operation. The operator selects the logo, presses Add operation to try other settings on "Operation 2", then turns its Output off. The canvas fills the logo solid. The job engraves the plate with the logo as a hole. Nothing warns.
- **Evidence:** REPRO, `zz-r5-sib2.test.ts`, real `addOperationForSelection`, then `drawScene` and `compileJob`:
  ```text
  R5I layers [["#000000","Operation","fill",true],["operation-circle","Operation 2","fill",true]]
  R5M | R1 Add operation, Operation 2 Output off | inkNoBurn 190 burnNoInk 0 | fill 2001 cut 0
  R5I centre shown ink burn false
  R5M | R2 overlap a[F] b[F,G off] | inkNoBurn 225 burnNoInk 0 | fill 2700
  R5M | R3 plate[F], circle[G off, F] | inkNoBurn 190 burnNoInk 0 | fill 2001
  R5H S8 Line square in the hole {"sqEdge":"circle","sqCentre":"circle"}
  R5PH phone PNG disabled second op: fills 2 centre inked true
  ```
  - With the parent's files (`R5_PARENT=1`), R1 and R2 match the burn (`inkNoBurn 1`, `0`; the 1 is rim noise). R3, with the off operation first, already mismatched there.
  - `runPreflight` on that project returned only `empty-output`, from the empty G-code string the test passes; no issue names the difference.
- **Severity:** P1. The burn differs from what is shown, with no warning, reached by one inspector button and one Output toggle.
- **Novelty:** new. The PR's tests cover a hidden second operation (`hit-test-fill-pools.test.ts`) but never an Output-off one.
- **Fix direction:** when a path has any Output-on Fill operation, leave its Output-off ones out of both the pools and the parity. Only a path with no Output-on Fill keeps painting under its first operation. Pin it with an Output-off case in `draw-scene-fill-pool-parts.test.ts` and `hit-test-fill-pools.test.ts`.
- **Refuter: CONFIRMED, P1 kept.**
  - **False if:** the real toggle does not reach this state; an Output-off operation paints differently enough to tell; something warns; or the ink is only the recorded Output-off convention.
  - **Reproduced with the real toggle, on a real canvas:**
    ```text
    P1-1-ink      main    body=ink/burn1 centre=ink/burn0 | core inkNoBurn 154.8 mm² | fill 4000 mm
    P1-1-ink      parent  body=ink/burn1 centre=#ffffff/burn0 | core 0 | fill 4000 mm
    P1-1b-overlap main    overlap=ink/burn0 | core 178.9 mm²      parent overlap=#ffffff/burn0 | core 0
    ```
    The crop on main is a solid plate with no sign of the circle. The regression holds.
  - **No output-off colour or hatch at rest.** Both pools paint `artworkInk`; only the pool's outline width differs. The Alt palette does separate them (circle `#2563eb`, plate `#000000`), but only while Alt is held.
  - **No warning.** `runPreflight` returned no issues and `compileJob` no diagnostics. The row's 0.58 opacity (`LayerRow.tsx:221`) and "This operation is excluded from output" (`OperationInspectorControls.tsx:93-95`) say the operation will not run. They do not say the circle becomes a hole in another operation that is still on.
  - **The strongest argument against, weighed.** Output-off artwork is painted and does not burn, as a lone circle does here (centre ink, burn 0, on main and the parent). Read that way, the circle's ink is Operation 2's and "not burned" is right. It does not lower the finding: the circle is still bound to the Output-on operation, whose burn has a hole the canvas does not show, and the parent showed that hole.
  - **Corrections:**
    - The click half is **not** a regression, and not absolute. The parent also picks `circle` at the square's edge and centre, and Alt+click reaches it on main (`[circle, square, plate]`).
    - The `[G off, F]` row was set directly; no action here produced that binding order.
    - The phone was read, not re-run: `preview-projection.ts:70` calls `paintPooledObjectDisplays`, the same plan.

### R5-P1-2 — With two or more jig boxes, the canvas pools objects the job compiles in separate runs, so a hole on the canvas burns solid

- **Where:** `src/ui/workspace/fill-pools.ts:219-244` keys a pool by operation, colour and output only. `src/core/job/registration-jig-compilation-runs.ts:30,72` and `src/core/job/compile-job.ts:44-55` compile each jig instance, and the ordinary objects, as separate runs. Each run pools only its own objects. `src/core/scene/hit-test.ts:105-123` shares the canvas's view.
- **Anchor:**
  - **Twin:** the design canvas (and the jig editor, which calls `drawScene`, `jig-canvas-paint.ts:46`) against `registrationJigCompilationRuns`.
  - **Contract:** ADR-683 D1, as amended: the canvas paints a Fill operation "as the one region it burns". ADR-683 does not mention jig runs; Amendment 1 item 3 mentions only that a jig box is not pooled.
- **Scenario:** two jig boxes, a Fill copy of the artwork in each, and an ordinary label on the same Fill operation over one copy. The canvas shows the label as a hole in the copy. The job burns the copy solid in its jig run and the label solid in the ordinary run, so that area burns twice. The same happens where two boxes, and their copies, overlap. With one box, the job pools them and the canvas matches.
- **Evidence:** REPRO, `zz-r5-sib2.test.ts`, with `createRegistrationBox` and `registrationJigCopyId`:
  ```text
  R5M | J1 two jig copies, no overlap | inkNoBurn 0 burnNoInk 0 | fill 1600 cut 240
  R5M | J2 ordinary window over a jig copy | inkNoBurn 0 burnNoInk 100 | fill 1800 cut 240
  R5M | J3 overlapping boxes, overlapping copies | inkNoBurn 0 burnNoInk 100 | fill 1600 cut 240
  R5M | J4 one box, ordinary over copy | inkNoBurn 0 burnNoInk 0 | fill 600 cut 120
  ```
  The parent gives the same J2 and J3 lines. Before #1511 the canvas had no pools (N6's parent model), so it showed these areas inked. The regression dates from #1511. Neither N6 nor #1526 names it.
- **Severity:** P1. Artwork disappears from the canvas and burns, with no warning.
- **Novelty:** new. `docs/audits/**` has no note on pooling and jig runs.
- **Fix direction:** key pools, and the parity in `fillPoolParityAt`, by compile run when `registrationJigCompilationRuns` returns runs. Share one helper with the compiler so the two cannot drift.
- **Refuter: CONFIRMED, P1 kept.**
  - **False if:** the compiler pools across runs after all; a real jig cannot produce this scene; or the jig warns or previews a matching picture.
  - **Reproduced through real actions:** `replaceRegistrationJigSet` (1 × 2, 60 × 40), `centerSelectionInRegistrationBox` on the artwork, then a label added and put on the artwork's operation with `useOperationForObjects`.
    ```text
    runs [["#000000","art",["art"]],["#000000","registration-jig-copy:art:…",["registration-jig-copy:ar"]],
          ["#000000","label",["registration-box","060179bb-…","label"]]]
    P1-2-J2 two boxes, label  labelCentre=#ffffff/burn2 artBody=ink/burn1 | core burnNoInk 72.3 mm² | fill 15952 mm
    P1-2-J4 one box, label    labelCentre=#ffffff/burn0 artBody=ink/burn1 | core 0 | fill 7376 mm
    P1-2-J1 two boxes, none   core 0 | fill 15552 mm
    ```
    The crop shows a white square on the left copy. That area in fact burns **twice**, once in the copy's run and once in the label's, which is worse than "solid".
  - **Runs are separate:** `compile-job.ts:44-55` compiles each run's `vectorObjects` by itself. The parent gives the same result.
  - **No warning or matching view.** `runPreflight` returned no issues. The jig editor calls `drawScene` with the same pools (`jig-canvas-paint.ts`). Only the compiled Preview shows the truth, and that is not a warning (METHOD §3).
  - **How ordinary:** narrower than the finding's scenario suggests. Fresh artwork gets its own operation (ADR-211 Decision 4 in `DECISIONS.md`), and then there is no pool and no mismatch, so the operator must also share the operation (Use one operation, Assign). Reach does not lower a P1 that is reachable today.
  - **Corrections:** J3 (overlapping boxes) was not re-run. The grid action cannot overlap boxes (spacing is non-negative), so J3 needs boxes moved by hand; rely on J2. "Regression from #1511" was not run against a pre-#1511 build; it rests on the auditor's reading and on #1511 being what added pools.

### R5-P1-3 — A circle on Line then Fill stays out of the Fill's pool, so a plate on that Fill shows solid where the burn has the hole

- **Where:** `src/core/scene/fill-operations.ts:34` returns none when the first visible operation is not Fill. `src/ui/workspace/fill-pools.ts:224` skips any path painted as a stroke, and `src/core/scene/hit-test.ts:139-141` counts it the same way. The compiler counts every bound Fill (`layer-fill.ts:204`, `pathUsesOperation`).
- **Anchor:**
  - **Contract:** ADR-683 Amendment 1 Consequences "Not changed": such a path "is still stroked only (the KNOWN canvas styling …)". That records the circle's own outline, and the source audit (`2026-07-17-0815-layers-panel-parity.md`) calls the styling canvas-only. It does not weigh this effect: the path still changes **another object's** hole, which the canvas never shows.
  - **Twin:** the design canvas against the compiled Fill.
- **Scenario:** a logo on a Line operation. Add operation copies it to a second operation; the operator switches that one to Fill and Assigns a plate to it. The logo now binds `[Line, Fill]`. The canvas shows a solid plate with the logo's outline on it. The job engraves the plate with the logo as an empty hole.
- **Evidence:** REPRO, `zz-r5-sib2.test.ts`, real `addOperationForSelection`, then the mode and binding set as the inspector and Assign leave them:
  ```text
  R5I line-first bindings ["op-l","operation-circle"] line
  R5M | R4 real Add on a Line circle, Op2 -> Fill, plate assigned to Op2 | inkNoBurn 190 burnNoInk 0 | fill 2001 cut 50
  R5M | S10 Line first, Fill second on circle (plate on Fill) | inkNoBurn 190 burnNoInk 0 | fill 2001 cut 50
  ```
  The parent gives the same lines, so this is not from #1526. It predates #1511 too: without pools the plate painted solid. The Fill-first order `[F, L]` matches.
- **Severity:** P1. Ink is shown where nothing burns, with no warning. It is listed apart from the KNOWN stroked-only line because the effect is on a different object and on its shape. The refuter may weigh merging it with that KNOWN.
- **Novelty:** the effect is new; the root is KNOWN.
- **Fix direction:** add every bound visible Fill to the pool, even when the first operation is Line. Paint such a path's Fill through the pool and keep its stroke, which also fixes the KNOWN stroked-only case.
- **Refuter: CONFIRMED, P1 kept. Root KNOWN, effect new; do not merge it into the KNOWN line, but fix them together.**
  - **False if:** Assign cannot leave this state; or the KNOWN note already accepts this effect.
  - **Reproduced with every step real:** Add operation on the Line circle, `setLayerParam` to Fill on Operation 2, then Assign the plate with `useOperationForSelection`. Bindings: plate `[operation-circle]`, circle `[op-l, operation-circle]`.
    ```text
    P1-3 main and parent  body=ink/burn1 centre=ink/burn0 | core inkNoBurn 154.8 mm² | fill 4000 cut 50 mm
    click at the centre: plate. preflight: none.
    ```
  - **What is KNOWN.** ADR-683 Amd 1 "Not changed" records only that such a path "is still stroked only". Its citation, `2026-07-17-0815-layers-panel-parity.md:13`, is a P3 about visibility that says "output is unaffected". Neither weighs a burn differing from the picture, let alone on another object, so the auditor's split holds.
  - **New reach, closing this report's "not verified" item.** `importLightBurnProject` on a Cut layer with a Scan sub-layer, holding a rectangle and an ellipse, binds both paths `[#000000, #000000-sub1]` (Line, then Fill), with no import warnings. The canvas paints no fill and two ink outlines; the job burns a 4,000 mm hatched ring and 190 mm of cuts. A schema-2 project's Fill sub-layer migrates the same way (`[op line, op:sub-1 fill]`). So the KNOWN "stroked only" case also burns unseen artwork from an ordinary import, which is what R5-P1-4 describes. **The coordinator should re-rate that KNOWN against the P1 rule** rather than carry it as styling.

### R5-P1-4 — (P3 after the refuter, latent) A Line operation with a Fill sub-layer shows outlines only and burns a hatched ring

- **Where:** `src/ui/workspace/object-display.ts:229-231` (`resolvePaint`) reads only the main operation's mode. `src/core/scene/fill-operations.ts:31` walks only top-level operations. `src/core/scene/layer.ts:453-457` (`outputOperationLayers`) compiles each enabled sub-layer.
- **Anchor:**
  - **Contract:** ADR-683 title and D1, the canvas paints a Fill operation as it burns.
  - **Adjacent KNOWN:** N5-P3-1 (the same sub-layer in SVG export, strokes only). No audit names it on the canvas.
- **Scenario:** a plate and a circle on a Line operation with a Fill sub-layer. The canvas shows two outlines. The job hatches the plate less the circle and cuts both outlines. No warning names it. Selecting and hovering show the outlines too.
- **Evidence:** REPRO, `zz-r5-matrix.test.ts`:
  ```text
  R5M | S6 Line main with Fill sub-layer | MISMATCH | inkNoBurn 0 burnNoInk 1010 | fill 2001 cut 190
  ```
  The parent gives the same line, and pre-#1511 painting was also stroke-only. Controls clean: Fill main with a Line sub-layer, with a Fill 45° sub-layer, and with a disabled sub-layer.
- **Severity:** Raised as P1 by the design rule; the refuter lowered it to P3 because the state is not reachable. Long-standing, not a regression. The refuter may weigh that the operator chose the sub-layer in the panel, but the panel is not a warning about the picture.
- **Novelty:** new on the canvas.
- **Fix direction:** in the pool and paint, treat an enabled Fill sub-layer as a Fill operation of the path, with its own parity set. Add a sub-layer case to `draw-scene-fill-pool-parts.test.ts`.
- **Refuter: CONFIRMED as a mismatch, but lowered to P3 (latent): no app route reaches it today.**
  - **False if:** no one can make a `Layer.subLayers` entry.
  - **Picture and burn reproduce on a project round-tripped through a file:** body white, burn 1; core burn with no ink 850.3 mm²; no fills, two ink outlines; fill 4000, cut 190 mm.
  - **Nothing in the app creates the state:**
    - `LayerSubLayers` has no render site. Its only importer is `OperationControls.audit.test.tsx`. `git log -G'<LayerSubLayers'` shows #193 (`53f518075`, 2026-07-15) removing it from the panel, in the same commit that added schema 3 and `migrate-v2-operation-bindings.ts`.
    - ADR-211 Decision 7 in `DECISIONS.md`: "The always-visible Sub-layers editor is retired."
    - `addLayerSubLayer` has no caller outside that unrendered component and the store's own wiring.
    - Every other writer only copies an existing list.
    - The v2 migration flattens sub-layers (`[["op","line",0],["op:sub-1","fill",0]]`, run here).
    - `.lbrn` import makes separate operations (`subLayers` length 0, run here).
    - Job Review only shows sub-layers that already exist.
    - So only a hand-written or third-party schema-3+ file can hold one. `normalize-layer.ts:353` keeps it, and then the mismatch shows.
  - **Why P3:** METHOD §3 lets reach lower a finding only when the defect is not reachable today. That is this case. The live form of the same picture is a Line-then-Fill binding, under R5-P1-3.
  - **Also corrects N5-P3-1's "Reach: sub-layers are added from the Cuts list (`LayerSubLayers.tsx:63`)":** that component is not rendered.

### R5-P2-1 — Print and SVG export write N6-P1-1's hole: a path on two Fill operations is exported under the first only

- **Where:** `src/io/svg/export-fill-compounds.ts:42-49` (`exportOperationForPath`, "the first scene operation it uses"), `:94,:120,:156`. Print goes through `src/ui/app/print-artwork.ts:69`.
- **Anchor:** **Twin:** the Add-operation circle on the canvas and in the burn, against the file. **Contract:** ADR-681's stated purpose, per N5: a design file keeps what burns. N6 lists this path as "not traced through export".
- **Scenario:** plate + circle, Add operation on the circle. Canvas and burn show the circle engraved. Print on paper and the exported SVG show a hole. Importing that SVG and burning it loses the circle.
- **Evidence:** REPRO, `zz-r5-sib2.test.ts`, `exportSceneSvg`:
  ```text
  R5E add-op svg <g id="fill-0"><title>Operation</title><path d="M10 10h40v30h-40zm28 15c0 4.418-3.582 8-…" fill="#000000" fill-rule="evenodd" stroke="none"/></g>
  ```
  One compound with the hole, and no group for "Operation 2".
- **Severity:** P2. A visibly wrong print or file on an ordinary inspector path. The live burn is right.
- **Novelty:** new. N5 owned ADR-681 and has no multi-binding case.
- **Fix direction:** write one compound per output Fill operation, as the canvas does, each with its parity and colour.
- **Refuter: CONFIRMED, P2 kept.** Reproduced with real Add operation: one `fill-rule="evenodd"` path holding both the plate and circle contours, and no group for Operation 2. Print takes the same string (`print-artwork.ts:69`, READ). **Correction to the anchor:** ADR-681 Decision 1 says in terms "A path's operation is the first scene operation it uses", so the code follows that wording. This is a gap in that decision against its purpose, not a code departure, and the Twin anchor is what carries the finding. Compared with N5-P3-1, this one is reachable today, on an ordinary inspector path; that one is latent. The re-import step was not run.

### R5-P2-2 — In Wireframe, a Fill plate's empty interior still takes the click, so a Line square shown inside it cannot be picked

- **Where:** `src/core/scene/hit-test.ts:232-238` treats a filled path as solid by its mode; the hit test has no display mode. `src/ui/workspace/object-display.ts:231` strokes it in Wireframe.
- **Anchor:** **Twin:** the Wireframe canvas against the hit test. **Contract:** ADR-683 Amendment 1 item 3: "the artwork the canvas shows there is picked first". ADR-410 Wireframe outlines Fill artwork.
- **Scenario:** a Line square drawn before a Fill plate that covers it. In Wireframe the operator sees both outlines. Clicking the square's outline or centre selects the plate. Only Alt+click reaches it.
- **Evidence:** REPRO, `zz-r5-sib3.test.ts`:
  ```text
  R5W ink fills in wireframe 0 hit square centre plate hit empty plate
  ```
- **Severity:** P2, a click selecting an object other than what is shown. Pre-existing, not from #1526.
- **Novelty:** new. No audit covers Wireframe clicks.
- **Fix direction:** pass the display mode to `hitTest`, so a Wireframe click counts all Fill as Line (interior hit only).
- **Refuter: CONFIRMED, P2 kept.** On the real canvas, Wireframe has 0 mm² of ink (centre and body white), while `hitTest` gives `plate` at the square's edge and centre, on main and the parent. Alt+click gives `[plate, square]`. `hit-test.ts` never mentions Wireframe, and the workspace callers (`drag-state.ts:196` and others) pass no display mode. **Correction to the anchor:** ADR-683 Amd 1 item 3 and L8-P2-5 are about holes and pool parity, not Wireframe, and ADR-683 D1 only says Wireframe draws outlines. So this is a Twin finding: pre-existing, not a miss by #1526. Alt+click is a workaround, not a warning, and the click selects something the picture does not suggest.

### R5-P3-1 — Regression from #1526: every frame scans the objects between pool members, so a plate array then a window array slows about tenfold at 20,000 objects

- **Where:** `src/ui/workspace/fill-pools.ts:304-322` (`splitWhereCovered`) runs per cluster per frame, uncached, unlike the groups at `:254-269`. For pairs drawn far apart the total is members × gap.
- **Anchor:** **Contract:** ADR-683 Amendment 1 item 4: "a still frame does not sweep again". That is true of the sweep, not of this scan.
- **Evidence:** REPRO, `zz-r5-perf.test.ts`, no-op context, 4 frames, rough:
  ```text
  main   2500 plates then 2500 windows: 153/120/112/112 ms    10000 + 10000: 2189/2232/2029/1924 ms
  parent 2500 plates then 2500 windows:  58/54/39/29 ms       10000 + 10000:  253/160/251/142 ms
  ```
- **Severity:** P3. The scene is unusual, and the 5,000-object case stays usable.
- **Fix direction:** skip the scan for whichever clusters already have the same `objects`, keeping the parts with the cached groups, or test only boxes that overlap the cluster through one sweep.
- **Refuter: CONFIRMED, P3 kept, not P2. The headline size is over the project limit.**
  - **20,000 objects cannot exist.** `PROJECT_SCENE_LIMITS.objects` is 10,000 (`project-scene-integrity-validator.ts:6`). Commands that add objects refuse past it (`scene-copy-room.ts`) and the loader refuses a file above it. The "10,000 + 10,000" row is a scaling figure only.
  - **Re-timed** (still frames 2–4; first frame in brackets; no-op context, so no raster):
    | Plates, then windows | Main | Parent |
    |---|---|---|
    | 500 + 500 | 15–25 ms (61) | 9–11 ms (23) |
    | 1,000 + 1,000 | 39–40 ms (64) | 12–22 ms (19) |
    | 2,500 + 2,500 | 126–138 ms (169) | 29–35 ms (54) |
    | **5,000 + 5,000, the limit** | **424–462 ms (525)** | **54–61 ms (132)** |
    | 10,000 + 10,000, over the limit | 1,753–1,790 ms (1,912) | 105–121 ms (160) |
    | 5,000 interleaved pairs (control) | 50–55 ms (99) | 42–53 ms (86) |
  - **So the regression is real, quadratic and about 8× at the limit,** and it needs every plate drawn before every window. Interleaved pairs cost nothing extra. Clicks are unaffected (1–3 ms).
  - **Why not P2:** nothing is wrong or misleading, the result is correct, and it costs only frames that redraw (pan, zoom, drag). At the sizes people are likely to reach (2,000 objects, about 40 ms) it stays usable. **Feed to the performance audit:** 2 fps at the limit against about 16 on the parent, before raster.

### R5-P3-2 — The clip budget is per pool, not per frame as ADR-683 Amd 1 says; past it, the hit test picks a photo the canvas has painted over

- **Where:** `src/ui/workspace/fill-pools.ts:289` compares each pool's parts × segments with `CLIP_BUDGET_SEGMENTS` (`:91`), so several pools can each spend it. Past it, `:290` paints the pool at its highest member, while `hit-test.ts:48-55` still goes by object order.
- **Anchor:** **Contract:** ADR-683 Amendment 1 item 2: "Past 1,000,000 clipped segments a frame". The over-budget picture is a recorded trade; the click is not.
- **Evidence:** REPRO for the click, READ for the budget. `zz-r5-sib3.test.ts`:
  ```text
  R5B past budget: frame body under a photo: canvas ink hit photo-599 burn true
  R5B under budget: canvas photo hit photo
  ```
- **Severity:** P3. It needs a very dense split pool, and a burn hidden from the canvas does not result.
- **Fix direction:** keep one budget per frame in `planFillPools`, or correct the ADR wording.
- **Refuter: CONFIRMED, P3 kept.** A large member under 519 interleaved photos and 519 other members: under budget (100 parts) the point shows the photo and `hitTest` gives the photo; past it (520 parts) the real canvas shows **ink** and `hitTest` still gives `photo-519`, with burn 1 at the point in both. The budget is compared per pool at `fill-pools.ts:289`, with no frame counter (READ). The over-budget picture is what the ADR chose, so only the click and the words "a frame" are off.

### R5-P3-3 — A hover pulse floods one member alone, so a pooled hole tints solid while hovered

- **Where:** `src/ui/workspace/pulse-piece-bitmap.ts:129-156` (`paintVectorPiece`) paints the member by itself through `paintObjectDisplay`; `src/ui/workspace/draw-artwork-pulse.ts:287` blits it at `strength`.
- **Anchor:** **Twin:** the pooled canvas against the pulse (ADR-646/ADR-620). N6 listed this as not verified.
- **Scenario:** hovering a plate, or a Fill operation's row, tints the plate's whole region, including a hole made by a separate object. Hovering the window object tints the empty window.
- **Evidence:** READ only. The bitmap path was not run, because jsdom has no real canvas.
- **Severity:** P3. It is transient and does not change the resting picture.
- **Fix direction:** clip the flood to the pool's parity region (`clipClosedPolylines`).
- **Refuter: PLAUSIBLE, P3 kept.** Reading `paintVectorPiece` agrees: it filters the member's paths, paints them with `paintObjectDisplay`, and applies no parity clip. It was not run. ADR-683 D1 says each member "keeps its own selection outline and hover pulse", but does not say what shape the pulse takes, so this is not contradicted. It is transient.

### R5-P3-4 — CNC: pools apply to a Fill operation left from a laser project, so stacked Pocket copies draw empty while the pocket is cut once

- **Where:** `src/core/scene/fill-operations.ts:25-37` and `fill-pools.ts` have no machine check; ADR-683 D3's advisory is laser only. `src/core/preflight/cnc-stacked-copy-issues.ts:6-14` carries the CNC note.
- **Anchor:** **Twin:** the canvas against `compileCncJob`. Should pools apply on CNC? On the evidence yes, except here: Pocket's parity matches pools (partial overlap: no cut in the overlap; nested: inner cut, middle not).
- **Evidence:** REPRO, `zz-r5-sib2.test.ts` and `zz-r5-sib3.test.ts`:
  ```text
  R5C switch result {"kind":"selected","machineKind":"cnc"} modes [["fill",null]]
  R5C real route pocket copies: objects 2 modes fill canvas nothing
  R5C pocket stacked copies: canvas nothing; toolpath near body*1e5+total 3600095
  R5C pocket partial overlap: canvas nothing toolpath points within 4 mm of overlap centre 0
  R5C pocket nested: canvas inner ink mid nothing toolpath inner 28 mid 0
  ```
  The note "exact stacked copies … cut once" is READ here; the Job it reads was not built through Job Review.
- **Severity:** P3. The operator is told, and the route needs a laser project switched to CNC.
- **Fix direction:** on CNC, paint merged copies as one, or don't pool when `machine.kind` is `cnc`.
- **Refuter: CONFIRMED, P3 kept.** `cncOmissionProject` with two stacked squares and the operation's mode set to Fill: `compileCncJob` gives 23 cut points and `cncStackedCopyIssues` returns `cnc-stacked-copies-merged`, while `drawScene` issues one even-odd pool fill, which cancels. The switch from a laser project and the note in a real Job Review were not re-run. The operator is told, so it stays P3.

### R5-P3-5 — Test gap: nothing pins Output off, jig runs or a sub-layer against pools

- **Where:** `src/ui/workspace/draw-scene-fill-pool-parts.test.ts`, `src/core/scene/hit-test-fill-pools.test.ts`.
- **Anchor:** **METHOD L7.** R5-P1-1 passed review because the second-operation cases only try a hidden operation.
- **Evidence:** READ, plus the matrix above.
- **Fix direction:** add the matrix's scene list as a table test: scene → `drawScene` raster → `compileJob` raster.
- **Refuter: CONFIRMED, P3 kept.** A search of `draw-scene-fill-pool-parts.test.ts`, `draw-scene-fill-pools.test.ts` and `hit-test-fill-pools.test.ts` finds no `output: false`, sub-layer or registration case. The sub-layer gap now matters less (R5-P1-4 is latent); a Line-then-Fill case should take its place.

## ADR-683 Amendment 1 against the code

| Item | Code | Verdict |
|---|---|---|
| 1. Every visible Fill operation; lone one-operation object paints itself; lone shared member pools | `fill-operations.ts:31-35`, `fill-pools.ts:107` | Matches the words. The Consequence "inks every point a Fill operation burns" holds, but it also inks points only an Output-off operation covers (R5-P1-1) |
| 2. Split around overlapping artwork; each part clipped and outlined | `fill-pools.ts:273-322`, `:195-199`; O2 and S15 rows | Matches. "a frame" for the budget is per pool (R5-P3-2) |
| 2. Photo and relief boxes; phone draws frames first | `drawnBitmapBox`, `preview-projection.ts:68-70` | Matches (relief by READ) |
| 3. Parity on request, by object, by each path's rule; `hitTest` and `hitTestCandidates`; jig box unpooled | `hit-test.ts:44,:91,:105-144`, `hit-test-candidates.ts:19` | Matches. Sweep against the canvas clean (below). Silent on jig runs (R5-P1-2) and Wireframe (R5-P2-2) |
| 4. Faster groups, kept between frames | `fill-pool-clusters.ts`, `fill-pools.ts:254-269` | Matches; the new per-frame scan is outside it (R5-P3-1) |
| Measurements | see Performance | Agree in order of size |
| Verification counts: 4 of 6, 6 of 7 fail on the previous main | below | **True** |

## Test truth (L7)

Each file ran alone; "parent" serves the first parent's seven source files through the hook.

| Test | Main | Parent |
|---|---|---|
| `draw-scene-fill-pool-parts.test.ts` | 6/6 | 4 fail, 2 pass (the unsplit control and the photo above the plaque) |
| `hit-test-fill-pools.test.ts` | 7/7 | 6 fail, 1 passes (the other-operation control) |
| `draw-scene-fill-pools.test.ts` | 6/6 | 6/6 (#1511's own, not #1526's) |
| `hit-test.test.ts` | 21/21 | 21/21 |

The PR's "10 of the 13 cases fail" holds.

## Performance (rough)

No-op context, one display cache, one worker. Frames are the first, then three more. No browser raster cost is included.

| Scene | Main | Parent |
|---|---|---|
| 5,000 overlapping Ø50 circles | 314 / 104 / 56 / 58 ms; one moved 110 ms | 533 / 269 / 294 / 275 ms; one moved 310 ms |
| 5,000 tiles overlapping neighbours | 52 / 30 / 27 / 21 ms | 69 / 40 / 30 / 36 ms |
| 50,000 small separate shapes | 307 / 201 / 210 / 331 ms | 375 / 299 / 297 / 420 ms |
| 2,000 overlapping circles split by one photo | 173 / 34 / 34 / 31 ms | 225 / 72 / 77 / 91 ms |
| 800 overlapping rectangles alternating two Fill ops | 105 / 86 / 87 / 86 ms | 13 / 8 / 16 / 7 ms (no splits) |
| **2,500 plates, then 2,500 windows** | **153 / 120 / 112 / 112 ms** | 58 / 54 / 39 / 29 ms |
| **10,000 plates, then 10,000 windows** | **2,189 / 2,232 / 2,029 / 1,924 ms** | 253 / 160 / 251 / 142 ms |

**Hit test per pointer move:**
- 5,000 circles at the centre: 86 ms the first time (flattening), then 6–8 ms (parent ≤ 1 ms, early exit). Outside: about 1 ms on both.
- 50,000 shapes: 3–8 ms on main, 3.5–7 ms on the parent.

The hover pulse also waits for the pointer to settle (`ArtworkPulseOverlay.tsx:164`).

## KNOWN re-observed

- **N6-P3-5:** the phone's vector canvas fills object by object (ADR-683 Consequences; Amd 1 leaves it). Read, not re-run.
- **N6-P3-2:** the stacked-copy advisory's "burn nothing" with a Line sub-layer (Amd 1 "Not changed").
- **ADR-683 Amd 1 "Not changed" and 2026-07-17 layers-panel parity:** a path on Line then Fill alone is stroked only (`circle[L, F]` alone: 210 points). R5-P1-3 is a different effect of the same root.
- **2026-07-17 layers-panel parity:** a hidden operation with Output on still burns (rows above: `plate[F], circle[G hidden, F]` shows a hole, G burns it solid).
- **N5-P3-1:** a Fill sub-layer under a Line operation is exported as strokes. R5-P1-4 is its canvas twin. Refuter: both are latent, because no app route creates a sub-layer.

Open PR #1530 touches phone pairing only, so it fixes none of these.

## Refuted

The refuter refuted no raised finding outright; R5-P1-4's severity fell instead. The items below are the auditor's own.

- **"Members either side of an unrelated object paint wrongly."** No. Across A–photo–C, A–Fill–C, A–Line–window and interleaved ops, the hole shows what is between and each member keeps its place. Burns under a photo appear only where the member lies below it in the drawing order.
- **"Per-object power or angle breaks parity."** No. `ownedFillMaterial` keeps parity by cell (`fill-material-ownership.ts:38`), and every mixed-override row matches.
- **"Offset or island fill ignores the pool's parity."** No. All three styles match on all three scenes.
- **"Colour or per-object output splits a pool."** Colour does not (`S14`, `S14b` match). A per-object output does not exist: `object-operation-settings.ts:56` excludes output membership.
- **"CNC should never pool."** Not on the evidence: Pocket's parity matches on partial overlap and nesting (R5-P3-4 is only stacked copies).
- **Sweep hit.** `turned/scaled/mirrored` reported 2 of 6,300 points, both within 2 mm of a member's edge inside a parity-even area: the deliberate edge tolerance, not an error.

## Verified clean

- **Hit test against the canvas**, every grid point, with `hitTestObject` and the pool parity: plate + circle, a turned, scaled and mirrored stack, Fill text on a plate, three overlaps: 0 errors other than the edge above.
- **Marquee:** by box (`selection-marquee.ts:24`), so pools do not affect it (READ).
- **Jig editor canvas:** calls `drawScene` and `hitTest` (`jig-canvas-paint.ts:46`, `use-jig-canvas-gesture.ts:136`), so it shares both the fix and R5-P1-1 and R5-P1-2 (READ).
- **Preview window:** the faint underlay strokes and never pools; its routes come from the compiled job (READ).
- **Registration box:** excluded from pools and parity (`fill-pools.ts:222`, `hit-test.ts:91,132`); two-box scene J1 matches.
- **Hidden photo:** does not split; `drawnBitmapBox` needs `onCanvas`. `S15h`, `S15i` match.
- **Output-off colour:** Output off changes only the outline width (`artworkStrokeWidthPx`), not the ink, so an Output-off pool looks the same as a burning one. The Alt palette paints the operation's colour (`#2563eb` in R1).
- **`parts.length === 1`:** still the sprite route (`fill-pools.ts:288`, `:162`).
- **No later commit** changes any of #1526's source files. Compiled output is untouched, as the PR says.

## Not verified

- Sprite timing and clip cost in a real browser. Timings have no raster cost, so the alternating-ops row understates its clip cost. The refuter replayed the recorded paint in real Chromium for pixels, but the app's own canvas and GPU were not run.
- The hover flood (R5-P3-3) and `drawArtworkSprite` on dense pools.
- Real typed text: text rows use a `kind: 'text'` object with hand-built non-zero contours. The font path is R4's.
- Real relief objects (branch read only), a real Print dialog, a real Job Review for R5-P3-4.
- SVG import producing `[Line, Fill]` order. `.lbrn` import does produce it (refuter, under R5-P1-3). The Assign step of R5-P1-3 and the Output toggle of R5-P1-1 were then driven through the real store actions by the refuter, though not by clicking the React controls.
- A pre-#1511 build for R5-P1-2's "regression from #1511", and a real Job Review for R5-P3-4.
- Hardware: none was operated.

## Repro files

All under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` unless noted; each deleted by literal path afterwards. Run one at a time with `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node node_modules/vitest/vitest.mjs run <file> --config zz-r5-vitest.config.ts --silent=false --disableConsoleIntercept`.

| File | Purpose |
|---|---|
| `zz-r5-vitest.config.ts` | repo config, `fflate` stub, one worker; `R5_PARENT=1` serves the parent's files |
| `zz-r5-fflate-stub.ts` | empty `fflate` classes (not installed locally) |
| `src\ui\workspace\zz-r5-harness.ts` | records `drawScene`; canvas and hatch on one grid |
| `src\ui\workspace\zz-r5-matrix.test.ts` | originals and most siblings; main and parent |
| `src\ui\workspace\zz-r5-sib2.test.ts` | Add operation + Output off, Line-first, jig runs, CNC, export, click kinds and sweep; main and parent |
| `src\ui\workspace\zz-r5-sib3.test.ts` | CNC overlap, clip budget, Wireframe, phone PNG |
| `src\ui\workspace\zz-r5-perf.test.ts` | frame and hit-test timings; main and parent |
| `…\scratchpad\r5-parent\*.ts` (7, outside `j7-main`) | `7dd26ea04` versions of #1526's changed files |
| `…\scratchpad\r5-*.log` (outside `j7-main`) | run output |

```json
[
  {"id":"R5-P1-1","severity":"P1","area":"fix-fill-canvas","file":"src/core/scene/fill-operations.ts","line":31,"anchor":"Contract: ADR-683 Amd 1 Consequences (the canvas inks every point a Fill operation burns); Twin: design canvas vs compiled Fill","evidence":"REPRO","known":false,"summary":"Regression from #1526: pathFillOperations includes Output-off Fill operations, so Add operation + Output off on Operation 2 paints the plate's circle solid (inkNoBurn 190) while the burn has a hole; parent matched. Overlap a[F] b[F,G off] 225 points. Line square in that hole unclickable; phone PNG same. No warning.","refuter":"CONFIRMED","refuter_note":"P1 kept. Real toggle, real Chromium canvas: core ink with no burn 154.8 mm2; parent 0. No warning; no output-off colour at rest. The click half is not a regression (parent also picks circle; Alt+click reaches the square)."},
  {"id":"R5-P1-2","severity":"P1","area":"fix-fill-canvas","file":"src/ui/workspace/fill-pools.ts","line":219,"anchor":"Twin: canvas pools vs registrationJigCompilationRuns (compile-job.ts:44-55); Contract: ADR-683 D1 as amended","evidence":"REPRO","known":false,"summary":"With 2+ jig boxes each instance and the ordinary objects compile in separate runs and pool apart; the canvas pools across runs. Ordinary window on a jig copy: canvas hole, burn solid (burnNoInk 100). Overlapping copies likewise. Regression from #1511, unchanged by #1526.","refuter":"CONFIRMED","refuter_note":"P1 kept. Real jig actions: label centre white, burn in 2 runs; core burn with no ink 72.3 mm2; one box matches; no preflight issue. Needs the label on the copy's operation. J3 not re-run."},
  {"id":"R5-P1-3","severity":"P1","area":"fix-fill-canvas","file":"src/core/scene/fill-operations.ts","line":34,"anchor":"Contract: ADR-683 Amd 1 Not changed (stroked only; effect on another object's hole not weighed); Twin: canvas vs compiled Fill","evidence":"REPRO","known":false,"summary":"Circle bound [Line, Fill] with a plate on that Fill: canvas plate solid at the circle, burn has the hole (inkNoBurn 190), reached with real Add operation on a Line part. Parent identical; older than #1511. Root is KNOWN stroked-only; effect is new.","refuter":"CONFIRMED","refuter_note":"P1 kept. Root KNOWN, effect new; fix together, do not merge. Real Add, mode and Assign: core ink with no burn 154.8 mm2. .lbrn Cut + Scan sub-layer import also binds Line then Fill (outlines only, 4,000 mm ring burns); coordinator should re-rate that KNOWN."},
  {"id":"R5-P1-4","severity":"P3","area":"fix-fill-canvas","file":"src/ui/workspace/object-display.ts","line":229,"anchor":"Contract: ADR-683 D1; adjacent KNOWN N5-P3-1 (export twin)","evidence":"REPRO","known":false,"summary":"Line operation with a Fill sub-layer: canvas outlines only, burn hatched ring (burnNoInk 1010, fill 2001 mm, cut 190 mm). Parent identical; long-standing, not a regression.","refuter":"CONFIRMED","refuter_note":"Lowered P1 to P3, latent: LayerSubLayers has no render site since #193, addLayerSubLayer has no other caller, v2 migration and .lbrn import flatten sub-layers. Only a hand-written schema-3+ file holds one. Live form is under R5-P1-3."},
  {"id":"R5-P2-1","severity":"P2","area":"fix-fill-canvas","file":"src/io/svg/export-fill-compounds.ts","line":42,"anchor":"Twin: canvas and burn vs Print/SVG; N6 Regressions (not traced through export)","evidence":"REPRO","known":false,"summary":"Add-operation circle exported and printed under the first operation only: one even-odd compound with a hole, no group for Operation 2, while canvas and burn show the circle engraved.","refuter":"CONFIRMED","refuter_note":"P2 kept. ADR-681 Decision 1 names the first operation, so the anchor is the Twin, not a code departure from ADR-681."},
  {"id":"R5-P2-2","severity":"P2","area":"fix-fill-canvas","file":"src/core/scene/hit-test.ts","line":232,"anchor":"Twin: Wireframe canvas vs hit test; Contract: ADR-683 Amd 1 item 3","evidence":"REPRO","known":false,"summary":"In Wireframe (0 ink fills) a Fill plate's empty interior takes the click, so a Line square shown inside it, drawn before the plate, selects the plate. Pre-existing.","refuter":"CONFIRMED","refuter_note":"P2 kept. Wireframe has no ink; plate takes edge and centre; Alt+click reaches the square. Twin finding; pre-existing."},
  {"id":"R5-P3-1","severity":"P3","area":"fix-fill-canvas","file":"src/ui/workspace/fill-pools.ts","line":304,"anchor":"Contract: ADR-683 Amd 1 item 4","evidence":"REPRO","known":false,"summary":"Regression from #1526: uncached per-frame splitWhereCovered scan. At the project limit, 5,000 plates then 5,000 windows: 424-462 ms a frame vs 54-61 ms on the parent (no raster); 2,500+2,500: 126-138 vs 29-35 ms.","refuter":"CONFIRMED","refuter_note":"P3 kept, not P2. 20,000 objects exceeds the 10,000 limit. At the limit (5,000 + 5,000): 424-462 ms against 54-61 ms on the parent, no raster; interleaved order unaffected. For the performance audit."},
  {"id":"R5-P3-2","severity":"P3","area":"fix-fill-canvas","file":"src/ui/workspace/fill-pools.ts","line":289,"anchor":"Contract: ADR-683 Amd 1 item 2 (a frame)","evidence":"REPRO","known":false,"summary":"Clip budget is per pool, not per frame as the ADR says; past it the pool paints over a photo while the hit test picks the photo (canvas ink, hit photo-599).","refuter":"CONFIRMED","refuter_note":"P3 kept. 520 parts: canvas ink, hit photo-519; 100 parts: photo and photo."},
  {"id":"R5-P3-3","severity":"P3","area":"fix-fill-canvas","file":"src/ui/workspace/pulse-piece-bitmap.ts","line":129,"anchor":"Twin: pooled canvas vs hover pulse (ADR-646, ADR-620); N6 not verified","evidence":"READ","known":false,"summary":"Hover pulse floods a member alone, so a pooled hole tints solid while hovered. Transient.","refuter":"PLAUSIBLE","refuter_note":"P3 kept. Code reading agrees; not run."},
  {"id":"R5-P3-4","severity":"P3","area":"fix-fill-canvas","file":"src/core/scene/fill-operations.ts","line":25,"anchor":"Twin: canvas vs compileCncJob; N6 not verified","evidence":"REPRO","known":false,"summary":"Laser Fill project switched to CNC: stacked Pocket copies draw empty while the pocket cuts once, with the cnc-stacked-copies-merged note. Pocket parity otherwise matches pools.","refuter":"CONFIRMED","refuter_note":"P3 kept. 23 cut points with the merged-copies note; canvas cancels. Laser-to-CNC switch and Job Review not re-run."},
  {"id":"R5-P3-5","severity":"P3","area":"fix-fill-canvas","file":"src/ui/workspace/draw-scene-fill-pool-parts.test.ts","line":1,"anchor":"METHOD L7","evidence":"READ","known":false,"summary":"No test pins Output-off second operation, jig runs or sub-layers against pools.","refuter":"CONFIRMED","refuter_note":"P3 kept. No such cases in the three test files; a Line-then-Fill case should replace the sub-layer one."}
]
```
