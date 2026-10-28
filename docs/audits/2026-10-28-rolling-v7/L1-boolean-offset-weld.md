# Rolling audit v7 — L1 Booleans, offset and weld

- **When:** 2026-10-28, 13:30 +0800   **Tree:** origin/main @ `f1d919fbf` (fetched at the start). By the end main was at `5f3c420f4` (#1498, audit docs only). `git diff f1d919fbf 5f3c420f4 -- src electron WORKFLOW.md DECISIONS.md docs/decisions package.json` is empty, so every citation holds on both.
  - **Repros ran on main's tree, not the worktree.** They ran in the scratchpad copy `…\scratchpad\j7-main\`. Every non-test file under `src/core/geometry`, `src/core/scene`, `src/core/text`, `src/core/job`, `src/ui/state` and `src/ui/commands` there hash-matches `f1d919fbf` (0 differences).
  - Command, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> --silent=false --disableConsoleIntercept`.
- **Scope:**
  - Vector booleans: Subtract, Intersect, Exclude (ADR-103 G1; `vector-path-booleans.ts`, `vector-path-regions.ts`, `boolean-compound.ts`, the live compound).
  - Weld: `vector-path-weld.ts`, `vector-path-weld-change.ts`, the weld plan. Text glyph weld (ADR-321, `text-weld.ts`).
  - Offset: Offset Shapes (ADR-410 and Amendments 1-2, `offset-shapes.ts`, `offset-arc-tolerance.ts`), the properties-panel offset (`offsetVectorObjects`), the kerf offset and offset ladder (`kerf-offset.ts`, `offset-ladder.ts`, ADR-486 `layer-kerf.ts`).
  - Path cleanup: `close-within-tolerance.ts`, `contour-auto-join.ts`, `collapse-tiny-segments.ts`, `drop-collinear-points.ts` (read).
  - Entry points (L9):
    - **Tools menu:** Weld, Union silhouette, Join paths, Offset Shapes, Subtract, Intersect, Exclude. Weld, Subtract, Intersect and Exclude open the Combine Shapes dialog.
    - **Context menu:** Weld.
    - **Layers panel:** the **Offset outlines** row (Outward copy, Inward copy).
    - **Text editor:** **Weld overlaps**.
    - **No keyboard shortcut** is bound to any of these.
    - **Not exposed:** none of them is reachable from MCP or the phone. The `apply_edits` command list has no Boolean, offset or weld command (`electron/mcp/tool-info.ts:173`). Design Studio has no Boolean or offset op either (`src/core/design/ops/index.ts:1-5`).
- **Lenses run:** L2 ground truth (analytic area, perimeter, topology; clipper2-ts at 6 decimals on 20,000-gon circles as a test-only reference; the LightBurn docs), L4 adversarial, L3 twins, L7 test truth, L9 entry points.
  - Not run: L5 (no untrusted input path is specific to these ops).
- **Counts:** 4 raised → 0 refuted (refuter: 4 CONFIRMED, no severity change) → P1 1 / P2 0 / P3 3 (+ 1 KNOWN re-observed still open; 3 earlier findings confirmed fixed).

## Headline

**The geometry engine is right.** Every Boolean, Weld and offset of squares, nested and touching rings, holes-in-holes, self-intersecting paths and a star matches analytic truth. Squares are exact. Every other case is within the 1 µm grid (star offsets within about 0.013 mm² for every corner style, mitre limit included; refuter spot-check). Topology matches in every case: no component or hole is lost or added. On circles every result sits inside the 0.025 mm flattening: area −0.14 % to −0.44 %, boundary deviation 0.0224 mm. Text glyph weld matches the non-zero union the canvas draws, to −0.005 mm².

**The fault is in how a selection is turned into one region.** Offset Shapes and the **Offset outlines** row union every selected object with the non-zero rule before offsetting.

**L1-P1-1.** A shape drawn as its own object inside another is absorbed by that union, so it gets no offset at all. Examples: a hole drawn with the Rectangle or Ellipse tool inside a plate, or a separate SVG element that carries its own `fill-rule`.
- **Scenario:** a 50 × 30 plate and a separate 10 × 10 hole, Outward 1 mm with Delete original objects.
- **Result:** one 52 × 32 outline, no toast. The compiled cut goes from widths [50, 10] to [52], so the hole is gone from the design and the burn.
- **Twin:** the same artwork as one compound path gives [52 × 32, 8 × 8]. ADR-486 kerf shrinks that separate hole (the same rings give 1664 and 64 mm²).
- **Contract:** WORKFLOW and the dialog say that only **Outer shapes only** ignores shapes inside other shapes. Here the switch changes nothing.

The three P3s are:
- **L1-P3-1:** Boolean, Weld and offset results drop curves. Scaling a weld of two r 10 circles ×10 leaves 0.224 mm chords, where the same circle unwelded re-flattens to 0.0247 mm.
- **L1-P3-2:** offsetting a curved source stacks the source flattening on the round-join chords. A circle offset 50 mm sits 0.0296 mm off the true r + 50 circle, against the 0.025 mm that WORKFLOW F-A6c states. The chord test uses polygon sources only.
- **L1-P3-3:** Weld and Booleans refuse an open-flagged path that returns to its start, while Offset Shapes and Fill treat it as closed.

## Ground truth

Areas are mm². "Comp/holes" counts outlines and holes by even-odd depth of the result rings. Max dev is the largest distance of any result vertex or edge midpoint from the true boundary.

| Operation | Input | KerfDesk | Truth / clipper2 reference | Verdict |
|---|---|---|---|---|
| Weld | squares A [0,10]², B [5,15]×[0,10] | 150, 1/0, perimeter 50 | 150, 1/0, 50 | exact |
| Subtract / Intersect / Exclude | A, B | 50 / 50 / 100 (2 comp) | 50 / 50 / 100 (2 comp) | exact |
| Subtract / Intersect / Exclude / Weld | 20² square and a separate 10² square inside it | 300 (1 hole) / 100 / 300 (1 hole) / 400 | same | exact |
| Weld; Intersect | shared edge x = 10 | 200, 1 comp; `empty-result` | 200, 1; zero area | exact |
| Weld; Exclude | squares touching at one corner | 200, 2 comp; 200, 2 comp | same | exact |
| Exclude ×3 | A, B, [2.5,12.5]×[5,15] | 150, 2 comp | clipper xor 150 | exact |
| Subtract | one even-odd path 30² / 20² hole / 10² island, minus a 3² corner square | 596, 2 comp / 1 hole | 600 − 4 = 596, 2/1 | exact |
| Weld | same, plus a 2 × 40 bar across | 640, 1 comp / 2 holes | 640, 1/2 | exact |
| Subtract | same three squares as one non-zero path, same winding | 896, 1/0 | 900 − 4, solid | exact |
| Subtract (far clip) | pentagram R 10, one self-intersecting path | even-odd 77.565, 5 comp; non-zero 112.248, 1 comp | 77.568; 112.257 | Δ ≤ 0.009 (grid) |
| Weld | two r 10 Ellipse-tool circles, centres 10 mm apart | 504.402, 1/0, max dev 0.0224, 64 nodes, no curves | 505.482 (ref 505.482) | −0.21 %, within the 0.025 flattening |
| Subtract | same | 191.052 | 191.322 | −0.14 %, dev 0.0224 |
| Intersect | same | 122.298 | 122.837 (lens) | −0.44 %, dev 0.0224 |
| Exclude | same | 382.104, 2 comp | 382.645 | −0.14 %, dev 0.0224 |
| Panel offset | r 10 circle, +2 / −2 | 451.471 (dev 0.0219) / 200.353 (dev 0.0232) | 452.389 / 201.062 | within the flattening |
| Panel offset | r 10 circle, +50 | 11302.38, dev **0.0296**, 192 nodes | 11309.73 | L1-P3-2 |
| Panel offset | r 10 circle, −9.99 | `collapsed` | a 0.01 mm circle | below the flattening (apothem 9.9776); dropped |
| Offset Shapes Both 2 mm | r 10 circle, Round / Bevel / Corner | out 451.471 / 451.508 / 451.522; in 200.353 for all | 452.389; 201.062 | dev ≤ 0.0232 |
| Offset Shapes Both 0.5 mm | 5-point star R 10, inner 0.5 (tip 52.5°) | out 180.888 / 181.053 / 182.035; in 115.667 / 115.655 / 115.617 | analytic polygon-offset formula: 180.883 / 181.046 / 182.025; 115.671 / 115.659 / 115.619 | Δ ≤ 0.0094 (grid) |
| Offset Shapes Both 0.5 mm | star, inner 0.2 (tip 16°, past the ×4 mitre limit) | Corner = Bevel out 101.982; in Round / Bevel / Corner 24.384 / 24.321 / 24.084 | 101.977; 24.367 / 24.310 / 24.076 | squared at the limit, as ADR-410 says |
| Weld | star (inner 0.5) + r 6 circle | 154.869, 1/0 | ref 155.088 | −0.14 % (flattening) |
| Weld | annulus r 10 / 5 (one path) + 2 × 24 bar | 262.44, 1 comp / 2 holes | ≈ 263.4, 1/2 | topology exact |
| Text Weld overlaps | "my", Dancing Script, 20 mm (3 raw contours) | 60.4195, 1 comp / 1 hole, 1425 → 787 nodes, curves → polylines | non-zero union 60.4244 (2 rings); even-odd would give 60.0993 (3 rings) | −0.005, matches the canvas rule |
| Subtract | plate − text "my" (non-zero operand) | 652.276, 2 comp / 1 hole | ≈ 652.145 | +0.13 (0.025 flattening of glyphs) |
| **Offset Shapes Outward 1 mm** | **50 × 30 plate + separate 10 × 10 hole (+ separate r 4 circle)** | **1 ring, 52 × 32** (Outer shapes only on or off) | **52 × 32 and 8 × 8 (and r 3)**: the same art as one compound path gives exactly 52 × 32 + 8 × 8 | **L1-P1-1** |
| Kerf offset +1 | the same two rings | 1664, 64 | 1664, 64 | the hole shrinks (ADR-486) |

**Refuter spot-check.** The refuter ran these independently on the `j7-main` tree (`zz-l1r-core.test.ts`, deleted), with its own analytic numbers.

- **Circles.** Lens area 2r²·acos(d/2r) − (d/2)·√(4r² − d²) = 122.837, so Weld = 505.482, Subtract = 191.322 and Exclude = 382.645.
  - KerfDesk gives 504.401, 191.051, 122.298 and 382.103 (Exclude in 2 components).
  - Maximum boundary deviation is 0.0224 mm for all four (21 samples per edge), and no result carries curves.
  - All of this matches the table.
- **Nested rings.** All three rows match:
  - Subtract of the even-odd 30/20/10 squares minus a 3² corner square: 596, 2 components / 1 hole.
  - The same with a 2 × 40 bar welded across: 640, 1 / 2.
  - The non-zero version: 896, 1 / 0.
- **Star.** R 10 / r 5, five points, built directly as one polygon rather than with the Star tool. Its tips are 52.54°, with a mitre ratio of 2.26.
  - **Truth:** A = 146.946 and perimeter 66.407. Outward is A + P·d + the convex-corner joins − d²·tan(φ/2) at each reflex corner. Inward is the mirror of that.
    - Outward: 180.883 / 181.047 / 182.025 (Round / Bevel / Corner).
    - Inward: 115.671 / 115.659 / 115.619.
    - These agree with the auditor's truths to 0.001.
    - The Corner values were cross-checked by intersecting the offset lines directly: 182.0252 / 115.6187.
  - **KerfDesk:** outward 180.871 / 181.034 / 182.014, inward 115.659 / 115.647 / 115.609.
    - That is Δ −0.010 to −0.0125 mm² for every style and direction, a mean boundary shift under 0.2 µm, so grid level.
    - The Headline and Verified clean said "within 0.01 mm²"; that depends on the input, and both now read "within about 0.013 mm²".
- **Panel offset of a circle.**
  - **+2:** 451.471, deviation 0.0219. This matches.
  - **−2:** deviation 0.0232, which matches, but the area is 200.322 against the table's 200.353. The exact inward offset of the 48-vertex flattened source is 200.342. Both figures sit within grid noise of it and well inside the flattening, so the difference is immaterial.
  - **+50:** deviation 0.0306 with denser edge sampling (see L1-P3-2).

## Findings

### L1-P1-1 — Offset Shapes and the Offset outlines row drop a shape drawn inside another as its own object; Outer shapes only changes nothing

- **Where:**
  - `src/core/geometry/offset-shapes.ts:198` `const region = unionAll(closedBatches);` (NonZero union of every selected object's batches, `:273-278`). `:200-203` "Outer Shapes Only" only filters the rings left after that union.
  - `src/core/geometry/vector-path-booleans.ts:109-114` (panel offset), `vector-path-regions.ts:96-111` (NonZero `unionNormalizedRegions`).
  - With Delete original objects: `src/ui/state/offset-shapes-actions.ts:146,159-175` removes every source.
- **Anchor:**
  - **Contract:**
    - WORKFLOW.md F-A6c item 2: "**Outer shapes only** ignores holes and shapes inside other shapes" (`WORKFLOW.md:665-666`).
    - The dialog tooltip says the same: "Ignore holes and shapes inside other shapes; offset only the outer border." (`OffsetShapesDialog.tsx:137`).
    - When the switch is off, a shape inside another must therefore be offset. Today the result is identical with the switch on or off.
    - ADR-410 item 3 (`docs/decisions/ADR-410-everyday-editing-tools.md:54-55`) says the selection "is unioned as one design". The ADR does not address a shape inside another, and its own option description contradicts that union.
  - **Twin:**
    - **Same artwork as one compound path:** Offset Shapes keeps the hole and offsets it (52 × 32 and 8 × 8).
    - **ADR-486 kerf:** decision 1 makes a closed contour inside another path's contour a hole. Its context says that "Designs drawn on the canvas are made of exactly such separate objects". The kerf engine gives the same rings 1664 and 64 mm², and `compile-job-layer-kerf.test.ts` "shrinks a hole drawn as its own object" passes (15/15).
  - **Ground truth:**
    - **Source:** LightBurn Offset Shapes reference, versioned 1.7 docs, https://docs.lightburnsoftware.com/1.7/Reference/OffsetShapes/ (fetched 2026-10-28; the latest/2.2 RC page has the same sentence; no archive service was reachable from this session).
    - **What it says:** Outer shapes only "will ignore any shapes contained within others when creating the offset".
- **Scenario:**
  1. Draw a 50 × 30 rectangle and a 10 × 10 rectangle inside it (two objects, one Line operation).
  2. Select both and choose Tools → Offset Shapes: Outward, 1 mm, Corner, Delete original objects.
  3. **Result:** one 52 × 32 outline and no notice. The compiled cut has lost the hole.
  - **Other cases:**
    - Inward and Both lose the hole too: the inward result is 48 × 28 only.
    - A separate circle inside the plate is lost the same way.
    - Two same-colour ColoredPaths in one object are lost the same way. This is what an SVG with an explicit `fill-rule` on each element imports as (`parse-svg.ts:287`).
    - The layers-panel **Offset outlines** row, which F-CNC22 item 2 offers for "kerf compensation on a laser", gives the same single outline.
  - **Why the hole vanishes:** the non-zero union has already absorbed the inner shape before any offset runs.
- **Evidence:** REPRO.
  - `src/core/geometry/zz-l1-adversarial.test.ts`:
    ```text
    sep.outward outer=false {"outward":[{"area":1664,"x":[-1,51],"y":[-1,31]}],"inward":null}
    sep.outward outer=true  {"outward":[{"area":1664,"x":[-1,51],"y":[-1,31]}],"inward":null}
    sep.both outer=false    {"outward":[{"area":1664,...}],"inward":[{"area":1344,"x":[1,49],"y":[1,29]}]}
    cmp.outward outer=false {"outward":[{"area":1664,...},{"area":64,"x":[21,29],"y":[11,19]}],"inward":null}
    twopaths.outward        {"outward":[{"area":1664,...}],"inward":null}
    panel.sep +1 [{"area":1663.134,"x":[-1,51],"y":[-1,31]}]
    panel.cmp +1 [{"area":1663.134,...},{"area":64,"x":[21,29],"y":[11,19]}]
    kerf.same-call [1664,64]
    ```
  - Store and compile (`src/ui/state/zz-l1-twins.test.ts`, real `offsetShapesSelection` and `compileJob`):
    ```text
    before.cut-widths [50,10]
    after.objects [{"id":"offset-paths","kind":"imported-svg","rings":1}]
    after.cut-widths [52]
    after.toasts {"ok":true,"toasts":[]}
    ```
- **Severity:** P1 under the design rule ("silently drops … shapes or holes, so the burn is wrong with no warning").
  - The dialog draws the result over the grey selection and lists its size, but nothing names the missing outline. A preview the operator must compare unprompted is not a warning (METHOD §3, G6 clarification).
  - Without Delete original objects, the inner shape survives as its own object but still has no offset. The new outline the user asked for, for example a cut line around an engraving, is then missing a hole.
- **Test truth:** `offset-shapes.test.ts` pins holes and islands only inside one compound path ("keeps holes and islands by default", "offsets only the outer border when asked"). `offset-shapes-actions.test.ts` uses single sources. No test offsets a selection with a separately drawn inner shape, so neither would catch this.
- **Refuter: CONFIRMED, P1 kept.** Reproduced, and backed by a second, independent source.
  - **Hypotheses tested:**
    - **ADR-410 decides the union.** Item 3 does say the selection "is unioned as one design". It never addresses a shape drawn inside another, though, and that wording does not make the output right. ADR-486 decision 1 and its context treat exactly these separate objects as holes.
    - **A guard or warning the auditor missed.** None exists:
      - Offset Shapes has no "absorbed" check (`grep -i absorb` finds only the Weld review in `vector-path-weld-change.ts`).
      - `OffsetShapesDialog.tsx:193-199` only states the result's size.
      - Neither store action pushes a toast.
    - **Outer shapes only means something else.** No: the dialog tooltip (`OffsetShapesDialog.tsx:137`), WORKFLOW F-A6c item 2 and LightBurn all describe it as the switch that ignores contained shapes.
  - **Repro.** Run through the real store actions on the `j7-main` tree (`zz-l1r-p1.test.ts`, deleted). The scene was a 50 × 30 Rectangle-tool plate, a 10 × 10 Rectangle-tool hole and an 8 mm Ellipse-tool circle, all as separate objects on one Line operation.
    - **Outward 1 mm, Corner, Delete original objects:**
      - with Outer shapes only off or on, the scene holds only `offset-paths` [52 × 32];
      - `compileJob` cut widths go from [10 × 10, 50 × 30, 8 × 8] to [52 × 32];
      - toasts: [].
    - **Inward:** [48 × 28] only.
    - **Both:** [52 × 32] and [48 × 28] only.
    - **Selection order** does not change it: hole first gives the same result.
    - **Compound twin** (the same rings as one path): [52 × 32, 8 × 8], and Outer shapes only reduces it to [52 × 32]. The switch works only inside one path.
    - **Offset outlines row** (`offsetSelection`): +1 gives [52 × 32] where the compound twin gives [52 × 32, 8 × 8]; −1 gives [48 × 28] where the twin gives [48 × 28, 12 × 12]. No toast.
    - **Two same-colour ColoredPaths in one object** (core): 1664 mm², 1 ring, with the switch off or on. `parse-svg.ts:285-287` buckets each element with an explicit `fill-rule` apart.
  - **Delete original objects.** This option is what removes the hole from the burn.
    - Its default is off (`OffsetShapesDialog.tsx:30`). With it off, the plate, hole and circle stay and still burn (cut [10 × 10, 50 × 30, 52 × 32, 8 × 8]). Only the new outline lacks the inner contours.
    - The Offset outlines row always keeps its sources ("Keep the original and add a larger or smaller outline", `OffsetPathsRow.tsx:34`). Note that this row mounts in the selected object's properties (`SelectedObjectProperties.tsx:114`), not the Layers panel.
    - On their own, these keep-sources paths would be P2: an offset result that is visibly missing contours.
    - With Delete original objects on, the hole and circle are gone from the design and the cut, and nothing names them. That meets the design P1 rule ("silently drops … shapes or holes").
    - METHOD §3 has no reach clause ("a setting that is off by default" is its own example). Once applied, the option is also remembered for the session (`OffsetShapesDialogHost.tsx:8,23`). P1 therefore stands.
  - **LightBurn.**
    - **Docs.** The versioned 1.7 page (https://docs.lightburnsoftware.com/1.7/Reference/OffsetShapes/, fetched 2026-10-28) says Outer shapes only "will ignore any shapes contained within others when creating the offset". The 2.2 RC page says the same.
    - **Forum.** In "Zig Zags on Offset Shapes (Bug?)" (https://forum.lightburnsoftware.com/t/zig-zags-on-offset-shapes-bug/33988, 2021-02-17; live URL, not archived, fetched 2026-10-28), the LightBurn developer says the offsetter classed a separately selected circle lying inside another shape as a hole: "LightBurn is treating it as an inside (hole) as a result."
    - **Conclusion.** LightBurn does not merge such a shape away; it keeps it as a hole. KerfDesk's tooltip and WORKFLOW promise the same, so nothing excuses the merge.
  - **Novelty.** Not KNOWN.
    - `docs/audits/` on origin/main has no earlier report of this. Rolling v2 10-geometry covered only the zero-area case (P3-3).
    - No open PR touches `offset-shapes.ts`, `vector-path-booleans.ts` or `vector-path-regions.ts` (`gh pr list`: #1478, #1499, #1500).
- **Fix direction:**
  - Build the selection region the way ADR-486 decides sides. Classify each object's rings by strict containment depth across the selection (`containment-depth.ts`): a ring inside an odd number of other objects' rings is a hole, and an even count is an outline or island. Union only rings at the same depth.
  - Make **Outer shapes only** drop the odd-depth rings and everything inside them.
  - Add a test with a plate and a separately drawn hole, for Offset Shapes and for the panel row.
  - Amend ADR-410 item 3 to match.

### L1-P3-1 — Boolean, Weld and offset results keep only chords, so scaling the result later magnifies the flattening error

- **Where:**
  - The results are stored as polylines only (no `curves`): `vector-path-booleans.ts:71-76`, `vector-path-weld.ts:125-131`, `offset-shapes.ts:289-291`.
  - A curve source is re-flattened against its current scale (`vector-path-tools.ts:102-121`, `DEFAULT_MACHINE_CURVE_TOLERANCE_MM / largestScale`).
- **Anchor:**
  - **Twin:** the same circle before and after a Boolean.
  - **Contract:** ADR-410 Amendment 1 calls 0.025 mm "the machine curve tolerance … that every other curve in the app is held to".
  - **Not ground truth:** LightBurn's Boolean page does not say whether curves are kept (latest docs, fetched 2026-10-28), so no outside source is claimed.
- **Scenario:** Weld two Ellipse-tool circles (r 10, centres 10 mm apart), then scale the result ×10 with the handles.
- **Evidence:** REPRO (`src/ui/state/zz-l1-twins.test.ts`):
  ```text
  scale 1  {"weldChordDev":0.0224,"weldNodes":65,"circleChordDev":0.0225,"circleNodes":49}
  scale 4  {"weldChordDev":0.0896,"weldNodes":65,"circleChordDev":0.0246,"circleNodes":93}
  scale 10 {"weldChordDev":0.2240,"weldNodes":65,"circleChordDev":0.0247,"circleNodes":145}
  ```
  - At ×10 each 100 mm-radius arc is about 32 chords with a 0.22 mm sagitta.
  - For text weld the same trade is documented (`WORKFLOW.md:4018-4019`, `text-weld.ts:18-22`), but text weld starts from 0.001 mm.
  - Nothing documents it for vector Booleans, Weld or offsets.
- **Fix direction:** Either keep curve segments through the result (refit arcs or cubics to the chords), or flatten a polyline-only result again when it is scaled up. At least, document the trade in F-CNC22 and F-A6c.
- **Severity note:** this is rated P3 because nothing promises curves through a Boolean and the result is within tolerance when it is made. The coordinator may weigh P2 for large scale-ups.
- **Refuter: CONFIRMED, P3 kept.**
  - **Hypothesis tested:** that the trade is documented or deliberate for vector results.
    - WORKFLOW mentions sampled polygons only for text weld (`WORKFLOW.md:4018-4019`).
    - ADR-321 decision 4 does the same for text weld, which flattens at 0.001 mm.
    - Nothing in F-CNC22, F-A6c, ADR-103 or ADR-410 says either way.
  - **Repro.** `zz-l1r-core.test.ts` (deleted): weld two r 10 Ellipse-tool circles 10 mm apart, then materialize at scale s.
    - **Welded result:** 65 nodes at every scale, chord deviation 0.0224 / 0.0896 / 0.2240 mm at ×1 / ×4 / ×10.
    - **Unwelded circle:** re-flattens to 49 / 93 / 145 nodes and stays near the 0.025 mm tolerance. The refuter's measure, centred on the bounds, gave 0.0226 / 0.0246 / 0.0272 mm; the auditor's centring gave 0.0225 / 0.0246 / 0.0247.
    - **Code:** `vector-path-tools.ts:102-121` re-flattens only `curves`, and the result objects carry none.

### L1-P3-2 — An offset of a curved source stacks the source flattening on the round-join chords: 0.0296 mm from the true circle

- **Where:**
  - `offset-arc-tolerance.ts:21-31` budgets 0.024 mm for the round-join chords alone.
  - The source has already been flattened to 0.025 mm by `materializeVectorObject` (`vector-path-tools.ts:102-121`).
- **Anchor:** Contract. WORKFLOW.md F-A6c item 2 (`:666-667`) says round corners are "chorded within the 0.025 mm machine curve tolerance at any distance … so are the round corners of the properties-panel offset". ADR-410 Amendment 1 item 1 says "the stored chords … stay within 0.025 mm of the true circle".
- **Scenario:** Offset an r 10 Ellipse-tool circle +50 mm with the panel offset (Round). The true result is the r 60 circle.
- **Evidence:** REPRO (`zz-l1-ground-truth.test.ts`):
  ```text
  circ.panel-offset 50 {"truth":11309.73,"kd":{"area":11302.38},"maxDev":0.02957,"nodes":192}
  ```
  - At ±2 mm the deviation is 0.0219 / 0.0232.
  - The bound grows toward 0.025 + 0.024 mm because each join arc is centred on a chord vertex, not on the circle's centre.
- **Test truth:** `offset-round-chord-error.test.ts` (18/18 on main) uses only polygon sources: a square, a frame and a line. It measures each join against its own arc, so it cannot see this stack-up.
- **Fix direction:** Flatten curved sources at a finer tolerance before offsetting, as kerf does with `KERF_ARC_SOURCE_TOLERANCE_MM` = 0.005, or reduce the join tolerance by the source tolerance. Add a curved-source case to the chord test. The physical effect is about 5 µm over budget, which is why this is P3.
- **Refuter: CONFIRMED as measured, P3 kept, anchor corrected.**
  - **Repro.** `zz-l1r-core.test.ts` (deleted) offset an r 10 Ellipse-tool circle with the panel offset. Deviation from the true r + d circle, sampled at 21 points per edge:

    | Offset d (mm) | Max deviation (mm) |
    |---|---|
    | +2 | 0.0219 |
    | −2 | 0.0232 |
    | +12 | 0.0240 |
    | +25 | 0.0265 |
    | +50 | 0.0306 |
    | +100 | 0.0342 |

    - Offset Shapes Round +50 gives the same 0.0306.
    - The source itself sits 0.0226 mm off its circle.
    - The deviation exceeds 0.025 mm from about +20 mm. The auditor's 0.0296 used vertices and midpoints only.
  - **Contract anchor: a misread.**
    - WORKFLOW F-A6c item 2 and ADR-410 Amendment 1 item 1 bound each round join's chords against that join's own arc (`offset-arc-tolerance.ts`). That bound holds, and `offset-round-chord-error.test.ts` pins it.
    - Neither promises that the offset of an already-flattened curve stays within 0.025 mm of the analytic offset curve.
  - **The defensible anchor is a twin.**
    - ADR-486 decision 3 flattens curved kerf sources at 0.005 mm "so the arcs stay within 0.025 mm of the offset curve".
    - ADR-410 Amendment 1's context speaks of the 0.025 mm "that every other curve in the app is held to".
    - The finding stands as P3, an improvement and test gap.

### L1-P3-3 — Weld and Booleans refuse an open-flagged path that returns to its start; Offset Shapes and Fill treat the same path as closed

- **Where:**
  - `vector-path-tools.ts:155-157`: `isClosedPolygon` requires the `closed` flag.
  - `offset-shapes.ts:210`: Offset Shapes also accepts `isClosedEnough`.
  - `polyline-closure.ts:15-22`: `isClosedEnough` is the "closed enough to fill" predicate that Fill and Convert to Bitmap share.
- **Anchor:** Twin. The comment at `polyline-closure.ts:1-8` makes `isClosedEnough` the shared rule "so the two cannot disagree about which contours fill".
- **Scenario:** a `closed: false` square whose last point repeats its first.
  - Weld, or Subtract with a closed square, refuses: "Boolean, offset, and weld operations need closed contours only."
  - Offset Shapes Inward accepts it as a closed shape.
- **Evidence:** REPRO (`zz-l1-known.test.ts`): `closed-enough.weld "open-contours"`, `closed-enough.offset-inward "ok (treated as closed)"`.
  - Reach was not traced. The SVG and DXF importers set `closed` when the ends meet (`subpath-closure.ts`, `dxf-entities.ts:233-246`), so ordinary imports do not reach it.
- **Fix direction:** Use `isClosedEnough` in `normalizeVectorObjectBatches`, as Offset Shapes does, or normalize the flag once at the scene boundary.
- **Refuter: CONFIRMED, P3 kept.**
  - **Repro.** `zz-l1r-core.test.ts` (deleted), with `closed: false` on a 10 mm square whose last point repeats its first:
    - Weld gives `open-contours` ("Boolean, offset, and weld operations need closed contours only.").
    - Subtract with a closed square gives `open-contours`.
    - The panel offset gives `open-contours`.
    - Offset Shapes Inward 1 mm accepts it and gives 64 mm².
  - **Hypothesis tested: Weld and Booleans are at least consistent with their own UI.** They are. Both `selectionCanWeld` and `selectionCanCombine` read the `closed` flag (`selection-command-state.ts:90-97,141-147,163-177`).
    - Weld is disabled with "Select unlocked closed vector contours first."
    - Subtract, Intersect and Exclude are disabled with "Select two or more unlocked closed vector shapes first."
    - The Offset outlines row is hidden.
    - So in the app this path gets a disabled command rather than the refusal toast.
  - **What remains inconsistent: Select Open Shapes.** It uses `isClosedEnough` (ADR-410 item 5; `selection-query-actions.ts:113-115`), so it does not count this path as open. The user is told to select closed contours, but the tool for finding open paths passes this one over. That supports the twin.
  - **Reach** is still untraced. P3 is the floor either way.
  - **LightBurn.** Its Offset Shapes page (2.2 RC) defines closed as start and end nodes that match. That does not settle a coincident but unjoined end.

## KNOWN re-observed

- **Rolling v2 10-P3-1 (Clipper2 union fills a crack): still open.**
  - `clipper2-ts` is still pinned at `2.0.1-17` (`package.json:89`).
  - No post-check guards `vector-path-weld.ts:118-122` or `vector-path-regions.ts:52-54,84-93,102-110`.
  - REPRO (`zz-l1-known.test.ts`) with v2's three rings through `weldVectorObjects`: `{"inputs":[0,0,0],"output":1}`. The point (53.40, 54.80) is outside every input and inside the welded result.
- **Rolling v2 10-P3-3 (Offset Shapes on a zero-area closed path): fixed.**
  - Collinear rings now become open lines (`offset-shapes.ts:215-217`), and an empty result is an error (`:133-138`).
  - These tests pin it: "outlines a closed path with no area as the line it draws" and "refuses, with a reason, a selection that has nothing to outline" (`offset-shapes.test.ts` 19/19 on main).
- **Rolling v2 10-P2-1 (Weld "absorbed" warning on a bridge) and 10-K1 (Dogbone non-zero):** fixed by #1354 and #1384 per the v2 ledger. They were not re-run here.

## Refuted

These candidates were dropped before raising:
- **The panel offset of an r 10 circle by −9.99 mm reports `collapsed`, although the true result is a 0.01 mm circle.** The flattened polygon's apothem is 9.9776 mm, within the 0.025 mm flattening, and nothing physical is lost.
- **Inward or Both silently omits a separate small shape that the inward distance erases.** That is the exact erosion: the shape has no interior at that distance. LightBurn's Inward does the same.
- **Weld and Booleans refuse objects with an open path.** This matches LightBurn: "All selected shapes must be closed shapes." (https://docs.lightburnsoftware.com/latest/Reference/BooleanTools/, 2.2 RC banner, fetched 2026-10-28.) KerfDesk also gives a reason.
- **The Boolean subject is the bottom-most object, not LightBurn's first-selected.** ADR-103 records this as PROVISIONAL, WORKFLOW F-CNC22 documents it, and the Combine Shapes dialog names the subject before Apply (`BooleanDialogHost.tsx:87-91`), so it is not silent.
- **A gap under 0.5 µm between two shapes is welded shut, and one of 0.6 µm stays open.** This is 1 µm grid rounding, below any machine resolution.
- **Weld absorbs a separately drawn inner shape.** This is the documented filled union. The Combine Shapes review names the absorbed source before Apply (WORKFLOW F-CNC22 "Edge — Weld absorbs enclosed shapes"). It is unlike L1-P1-1, where no review names the loss.

## Verified clean

- **Boolean algebra and topology.** All rows of the ground-truth table above, except L1-P1-1, match truth:
  - Squares are exact.
  - Self-intersecting paths are within the grid. Under even-odd a pentagram keeps 5 tips; under non-zero it is solid.
  - Curved shapes are within the 0.025 mm flattening, always on the inside (inscribed chords).
  - No component or hole is lost or added. Touching corners, shared edges, collinear edges, holes in holes and three-way Exclude all hold.
- **Fill rule.** Canvas (`object-display.ts:216`), Fill (`layer-fill.ts:231`), Booleans, Weld and Offset Shapes all read an undefined rule as even-odd and text as non-zero. The pentagram repro shows each rule used as declared. Results store no rule, and their rings are disjoint and nested, so either rule fills them the same.
- **Corner joins and mitre limit (ADR-410, Amendment 2).**
  - Star offsets match the analytic polygon-offset formulas for Round, Square (Bevel) and Mitre (Corner) to within about 0.013 mm² (grid level; refuter spot-check).
  - Tips sharper than 2·asin(1/4) = 28.96° switch from mitre to square: inner ratio 0.2 has 16° tips, and its Corner equals Bevel.
  - Inward offsets keep convex corners sharp for every style.
  - clipper2-ts `Offset.ts` was read: `doSquare` cuts at one delta, and mitres within 2.5° of straight are forced.
- **Collapse past the inradius.** It is a typed `collapsed` error with a toast (panel offset). Under Both the outward half is kept with a notice (`offset-shapes-actions.ts:129-138`).
- **Kerf direction.** A hole shrinks and an outline grows for rings in one path (repro 1664 / 64). Across objects, `compile-job-layer-kerf.test.ts` (15/15 on main) covers holes, islands and the separate-object hole.
- **Adversarial inputs.**
  - Zero-length segments and repeated closing points are clean (75 mm² as expected).
  - Features of 0.01 and 0.004 mm are kept; 0.0004 mm falls under the 1 µm grid.
  - Near-tangent circles 0.4 µm apart stay separate.
  - Coordinates at 1e4 and 1e6 mm are exact. 1e9 was covered by v2.
  - A mirrored object under Outer shapes only keeps its outer ring.
  - Open paths get a reason from Weld, Booleans and the panel offset; Offset Shapes outlines them outward and refuses Inward with a reason.
- **Text glyph weld (ADR-321).** It equals the non-zero union of the flattened glyphs to −0.005 mm². Node count falls (1425 to 787), with no blow-up. Curves become polylines, as `text-weld.ts:18-22` and WORKFLOW `:4018-4019` document.
- **Twins.**
  - A retained compound (Subtract and Weld) re-evaluates to exactly its first result (`zz-l1-twins`: `reevaluatedEqual: true`).
  - Undo after Offset Shapes with Delete originals returns the identical project object.
  - Weld and Subtract Undo are pinned by `vector-path-weld-state.test.ts` ("round-trips one undo step") and `vector-path-actions.test.ts`.
  - The dialog preview and Apply share one core call (ADR-609 `vector-op-prepared.ts` reuse checks).
- **Path cleanup (read).**
  - `collapseTinySegments` (5 µm) never destroys a ring below a triangle.
  - `dropCollinearPoints` drops only vertices within 1e-9 mm and moving forward.
  - `closePathsWithinTolerance` moves both ends to the midpoint and carries cubic handles with them.
  - `joinTouchingContours` joins only anchored contours at allowed points, and snaps ends without adding a bridge.

## Not verified

- **LightBurn's actual output** for a shape inside another with Outer shapes only off. Only the documentation sentence was used; no LightBurn install was available.
  - The refuter added a developer statement from the LightBurn forum (2021, see L1-P1-1 Refuter): the offsetter classes a separately selected shape inside another as a hole.
  - LightBurn was still not run.
- **The Offset Shapes and Combine Shapes dialogs were not rendered in a browser.** The preview text for L1-P1-1 was read from code (`OffsetShapesDialog.tsx:193-199`).
- **Reach of L1-P3-3** (a pen, node-edit or MCP path that stores an open-flagged closed loop) was not traced.
- **Kerf on non-welded text with overlapping glyphs.** `kerf-offset.ts` uses even-odd topology there, while the text displays non-zero. The intended cut is ambiguous, so it was left out.
- **ADR-263 trace weld.** The open-chain welding in `core/toolpath` belongs to the trace area and was not re-tested.
- **Text weld on bent text and text on a path** was not run.

## Repro files

All of these were created under `…\scratchpad\j7-main\` and deleted at the end. No repo file except this report was touched.

| File | Purpose |
|---|---|
| `src\core\geometry\zz-l1-ground-truth.test.ts` | Ground-truth table: squares, nested and touching rings, holes in holes, fill rule (pentagram, bow tie), circles against the lens formulas and a 20,000-gon clipper2 reference, panel and Offset Shapes offsets of circles, star offsets against analytic formulas, text weld and text as an operand |
| `src\core\geometry\zz-l1-adversarial.test.ts` | L1-P1-1 core (separate hole, compound twin, two-path object, panel offset, Outer shapes only, island, mirror, kerf twin), open paths, zero-length segments, tiny features, sub-micron gaps, near-tangent circles, huge coordinates |
| `src\ui\state\zz-l1-twins.test.ts` | L1-P1-1 through the store with Delete originals and `compileJob`, Undo identity, compound re-evaluation, L1-P3-1 scale-up chords |
| `src\core\geometry\zz-l1-known.test.ts` | KNOWN 10-P3-1 re-check, L1-P3-3 closed-enough twin |

Existing tests run on main's tree: `compile-job-layer-kerf.test.ts` 15/15, `offset-shapes.test.ts` 19/19, `offset-round-chord-error.test.ts` 18/18.

The refuter's files were also created under `…\scratchpad\j7-main\` and deleted at the end:

| File | Purpose |
|---|---|
| `src\ui\state\zz-l1r-p1.test.ts` | L1-P1-1 through `offsetShapesSelection` and `offsetSelection` with `compileJob`. Covers Rectangle- and Ellipse-tool objects, Outer shapes only on and off, Delete originals on and off, every direction, selection order, the compound twin, and toasts. |
| `src\core\geometry\zz-l1r-core.test.ts` | Ground-truth spot-check (circle lens, nested rings, star against analytic and line-intersection truth). Also L1-P3-1 scale-up, L1-P3-2 offset deviation by distance, L1-P3-3 open-flagged loop, and the two-ColoredPath P1 variant. |

`git diff --stat f1d919fbf 5f3c420f4 -- src electron WORKFLOW.md DECISIONS.md docs/decisions` was re-run by the refuter and is empty. The source files under test hash-match `f1d919fbf` on `j7-main`: `offset-shapes.ts`, `vector-path-booleans.ts`, `vector-path-regions.ts`, `offset-shapes-actions.ts`, `vector-path-tools.ts`, `offset-arc-tolerance.ts` and `polyline-closure.ts`.

```json
[
  {"id":"L1-P1-1","severity":"P1","area":"boolean-offset-weld","file":"src/core/geometry/offset-shapes.ts","line":198,"anchor":"Contract: WORKFLOW.md F-A6c item 2 and OffsetShapesDialog.tsx:137 ('Outer shapes only' ignores shapes inside other shapes, so off must not); Twin: same art as one compound path keeps and offsets the hole (52x32 + 8x8), ADR-486 decision 1 kerf treats a separately drawn inner contour as a hole (1664/64); Ground truth: LightBurn 1.7 docs Reference/OffsetShapes ('will ignore any shapes contained within others'), fetched 2026-10-28; LightBurn forum t/33988 (2021-02-17, developer: a separately selected shape inside another is treated as a hole)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Offset Shapes and the Offset outlines row NonZero-union every selected object before offsetting, so a shape drawn as its own object inside another (Rectangle/Ellipse tool hole, separate same-colour path) is absorbed and gets no offset; Outer shapes only on or off gives the same result. Plate 50x30 + separate 10x10 hole, Outward 1 mm Corner, Delete originals: one 52x32 outline, no toast, compiled cut widths [50,10] -> [52]; compound-path twin gives 52x32 + 8x8. Refuter: reproduced via the store (also Ellipse-tool circle, Inward, Both, Offset outlines row); the hole leaves the burn only with Delete original objects (default off, remembered per session); with it off the originals still burn and only the new outline lacks the inner contours; P1 kept (no reach clause)"},
  {"id":"L1-P3-1","severity":"P3","area":"boolean-offset-weld","file":"src/core/geometry/vector-path-booleans.ts","line":71,"anchor":"Twin: an unwelded curve source re-flattens to 0.025 mm at any scale (vector-path-tools.ts:102-121); Contract: ADR-410 Amd 1 context (0.025 mm held for every curve)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Boolean/Weld/offset results are stored as chords only; welding two r 10 circles and scaling x10 leaves 0.224 mm chord deviation (65 nodes) where the same circle unwelded re-flattens to 0.0247 mm (145 nodes); undocumented for vector booleans (text weld documents it at a 0.001 mm base)"},
  {"id":"L1-P3-2","severity":"P3","area":"boolean-offset-weld","file":"src/core/geometry/offset-arc-tolerance.ts","line":21,"anchor":"Twin (refuter-corrected): ADR-486 decision 3 holds kerf contours within 0.025 mm of the offset curve by flattening curved sources at 0.005 mm; ADR-410 Amd 1 context (0.025 mm for every curve). The WORKFLOW F-A6c / ADR-410 Amd 1 item 1 bound is per join arc and holds","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Offsetting a curved source stacks its 0.025 mm flattening on the 0.024 mm join chords: an r 10 circle offset +50 mm sits 0.0296 mm (0.0306 sampled densely; over 0.025 from about +20 mm) from the true r 60 circle; offset-round-chord-error.test.ts uses polygon sources only"},
  {"id":"L1-P3-3","severity":"P3","area":"boolean-offset-weld","file":"src/core/geometry/vector-path-tools.ts","line":155,"anchor":"Twin: isClosedEnough is the shared closed-enough-to-fill rule (polyline-closure.ts:1-22) used by Fill and Offset Shapes (offset-shapes.ts:210)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An open-flagged polyline whose last point repeats its first is refused by Weld and Booleans ('need closed contours only'; the UI disables them via the closed flag) but treated as closed by Offset Shapes Inward and Fill; reach not traced (importers set the flag)"}
]
```
