# T11 Radius Fillet — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.radius-fillet`.

## Map
- Menu: Tools → Fill repair → **Radius / Fillet...** (`src/ui/commands/layout-commands.ts:197-203`). It is enabled only by `ctx.canEditSelectedPaths` (`layout-commands.ts:222-229`, `design-tools-command-context.ts:35,61`). Otherwise it is disabled with "Select imported, traced or drawn-line artwork first."
- Dialog: `src/ui/commands/RadiusFilletDialog.tsx`. It has three radio modes (Round, Reverse radius, Remove fillets) and a Radius box in mm, default "2". `valid` needs `Number.isFinite(r) && r > 0` unless the mode is Remove. The text shows "Applies to the N picked corners" when nodes are picked.
- Store: `src/ui/state/path-fillet-actions.ts` `filletSelection` → `filletMutation`. It covers selected, unlocked, `isPathEditable` objects (imported SVG, traced, pen polyline shape). It skips an object stretched unevenly (`|‖sx‖−‖sy‖| > 1e-9`, absolute). The local radius is `r/|sx|`. Picked nodes limit the corners. `materializeCurves` re-flattens at 0.05 mm. `withTabsFollowingEdit` re-places tabs (ADR-494 Amd 2). The whole edit is one `pushUndo`, followed by a toast.
- Core: `src/core/geometry/curve-fillet.ts`. `filletCurveCorners`: `lineCorner` (line–line corners only, 1e-6 rad collinear cut-off) → `fittingCorners` (each side must hold both neighbours' tangent distances) → `filletNode` in descending node order. `removeCurveFillets`/`tangentAt` replaces a minor circular arc or a cubic that is tangent (1°) to two lines with the lines' intersection.
- Governing: no fillet-specific ADR (none in DECISIONS.md / docs/decisions). ADR-494 Amd 2 and Amd 3 cover tabs. ADR-629 keeps dialogs in mm. WORKFLOW.md ~l.1250 covers tabs.
- Changes since 2026-10-16 (on origin/main): b247d1747 (2026-10-28, rolling v7 L6-P1-1: fillet keeps placed tabs) and ab3226fd1 (2026-11-10, C2-P3-1 shared helpers). The tool itself is 1cc361c57 (2026-10-12).

## October register re-check
Row #57: "V: tangent fillets, reverse bite, removal; too-large radius/short edges/transforms; dense-corner stress absent".
- Tangent fillets: **still correct.** Script A checked θ = 5°…179.9°, both turn directions. The tangent points lie exactly r·cot(θ/2) from the corner (6 dp). Every flattened arc point lies r from the centre at r/sin(θ/2) on the bisector (max |d−r| = 0.000000), all on the correct side. Path length matches 200 − 2r·cot(θ/2) + r(π−θ) to within the flattening chord error (≤5e-4).
- Reverse bite: **correct at convex corners.** The arc is centred on the corner, r, lies inside the wedge, and its length matches 2(100−r)+rθ.
- Removal: **correct for the tool's own fillets.** Square r4 → remove gives area 400.0000. Hexagon r3 → remove matches the original area exactly.
- Too-large radius, short edges, transforms: **too large is skipped** (r 5.000001 / 6 on a 10 mm square → 0 corners, toast). Short edges are skipped. A uniform scale gives the world radius (local area matches r/s). Mirror and negative scale are handled. Non-uniform scale is skipped with a toast. **New defect at the boundary:** a radius that exactly fills a side is applied to only half the corners (T11-P2-1).
- Dense-corner stress: **still absent** from the tests. Measured: a 20 000-gon takes 4.4 s on the main thread (T11-P3-3).

## Checks run
| check | method | result |
|---|---|---|
| Corner oracle, round and reverse, θ 5…179.99999°, both turn senses | script `zz-t11/t11.test.ts` A, own centre/tangent formulas, flattened at 0.0005 | exact (see above). 179.99999° is treated as collinear and left alone |
| Area vs analytic: squares CW/CCW, 3-4-5 triangle, hexagon, pentagon, 60×2 strip | script B, shoelace vs A0 − Σr²(cot(θ/2) − (π−θ)/2); reverse vs A0 − Σr²θ/2 | all within the flattening error (≤0.016 mm²) |
| Concave L shape (reflex corner) | script B | round: the reflex corner gets a cove (+r²(1−π/4)) ✓. Reverse: the reflex corner gets a convex quarter disc, adding material (T11-P3-4) |
| Exact-fit radius (arcs meet) | script C + `t11b.test.ts` via store + G-code | **2 of 4 corners** on 10 mm square r5, 30×10 r5, 25.4×12.7 r6.35, 0.3×0.1 r0.05; triangle 1 of 3; hexagon 3 of 6 (T11-P2-1) |
| Radius ± 1e-6 around exact fit | script C | 4.999999 → 4 of 4; 5.000001 → 0 of 4 (consistent "doesn't fit") |
| Neighbour that cannot fit | `t11b` | a corner that fits alone is left sharp because a neighbour (which itself does not fit) claims the shared side (T11-P3-2) |
| Curved edges: line–arc corners, original arc kept | script D | line–arc and line–cubic corners are skipped. The r10 `elliptical-arc` is kept byte-identical. Area matches. **No T10-P2-1 weakness:** no arc endpoint ever moves (only lines are shortened; the start moves only onto the new arc's end) |
| Remove on non-fillet tangent arcs | script D + `t11b` (store, G-code) | tapered slot (2° taper): one end becomes a spike 254 mm long, burn bbox x 53 → 306.5 mm, lit 87 → 589 mm, toast "Sharpened 1 corner." (T11-P2-2) |
| Transforms | script E (store) | uniform ×2, ×0.5 + rot 30, ×1.5 + mirrorX + rot 45, scaleX −1.5: local radius = r/s, so world r = 2 ✓. 2×1 is skipped with a toast. Scales 1/3 vs 0.33333333 (Δ 3.3e-9) are skipped as "stretched" (T11-P3-5) |
| Holes / multi-subpath | script F (store), Fill layer, G-code | outer 1592.27 (exp 1592.27), hole 392.27 (exp 392.27); hole corners rounded the right way. Fill lit length × 0.1 = 1200 = analytic |
| Open paths | script F | end nodes untouched. An open path whose ends coincide: 3 corners rounded, the joined end left sharp (same as an open path; not a defect) |
| Picked nodes | script F | node 2 → only (20,20), arc (20,18)→(18,20) ✓ |
| Polyline without curves, duplicate closing point | script F | 4 corners, area ✓ |
| Line burn through `prepareOutput` → G-code | script G | lit 80 → 76.515 (exp 76.566, chord error); remove → 80.000 |
| Kerf 0.5 after fillet | script G | 79.677 vs outward rounded oracle 79.708 ✓ |
| Undo / Redo / save-reopen | script G | undo == before, redo == after (JSON), reopened G-code identical. Pen polyline shape reopens with curves and the right area |
| Second Round on a rounded shape; locked only; rect-tool shape in a mixed selection | script G | no change, but the toast says the sides are too short (T11-P3-1). A rect shape is skipped; a rect-only selection disables the command (T11-P3-6) |
| Tabs placed by hand (L6-P1-1 fix) | script G, `createCncTabAnchorPositionResolver` | tab at (10,0) stays. Tab at (0.8,0) inside the consumed run moves to the nearest arc point, and the toast says so ✓ |
| Store guards 0, −2, NaN, ∞, 1e9, 1e-12 | script G | no change, no undo step. ∞/1e9/1e-12 give the "no corner could take that radius" toast; the dialog blocks 0/neg/NaN/∞ |
| Dense stress | `t11b` | smooth 5000-gon r1: 102 ms; 20 000-gon: **4379 ms** (quadratic) (T11-P3-3) |
| Dialog | READ ONLY (no browser run) | Number(text): "", "2mm", "abc", "0,5" → NaN, Apply disabled with no reason given (same pattern as T08-P3-3). 1e9 is accepted. Unit is fixed mm (ADR-629). Enter submits the form, Cancel just closes |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/RadiusFillet/ (via fetch) | positive radius = fillet, negative = bite, click a rounded corner = remove. Too large → the corner is unavailable ("not enough space"). Works on primary shapes (rectangles, ellipses) without Convert to Path; text needs conversion. Inside corners are not described |

Scripts and logs: `C:\Users\stolk\kd-t1\zz-t11\t11.test.ts` → `t11.log`, `C:\Users\stolk\kd-t1\zz-t11\t11b.test.ts` → `t11b.log`. Run from the tree root with `node node_modules/vitest/vitest.mjs run --config ../zz-t11/vitest.config.mts --maxWorkers=1` and `NODE_OPTIONS=--no-experimental-webstorage`.

## Findings

### T11-P2-1: A radius that exactly fills a side rounds only half the corners (10 mm square r 5, 1×½ in plate r ¼ in, 30×10 slot r 5)
- Severity: P2. It is a wrong, asymmetric result that the user will see on the canvas, and it burns that way. A full-round end (obround or slot, "radius = half the width") is a common request, and the inch case 25.4 × 12.7 with r 6.35 hits it exactly. It is not P1, because the canvas shows the half-rounded shape and one Undo restores it.
- Where: `src/core/geometry/curve-fillet.ts:124-125` (`fittingCorners` admits `distance + before <= inLength + EPS`) and `curve-fillet.ts:139` (`filletNode` refuses `distance > inLength - EPS`). After the first corner shortens the shared side to exactly `distance`, the second corner fails the stricter re-check. Corners are processed in descending order, so every other corner survives. The file header (l.104-106) promises the opposite: "left sharp, the same way at both ends, so applying a radius to a whole shape stays symmetric".
- Repro: `zz-t11/t11.test.ts` C and `zz-t11/t11b.test.ts` "exact-fit". 10×10 square r5: toast "Rounded 2 corners.", segments `lAllAl`, Line burn 40.000 → 35.682 mm; expected circle 31.416. 30×10 r5: 75.682 vs 71.416. 25.4×12.7 r6.35: 70.724 vs 65.298. Equilateral triangle at its inradius: 1 of 3. Hexagon r = 5·tan 60°: 3 of 6. Reverse r5 on the 10 mm square: 2 of 4. r 4.999999 gives 4 of 4 and r 5.000001 gives 0 of 4, so only the exact value (the one a user types) is broken.
- Oracle: the tangent distance r·cot(θ/2) = 5 on each 10 mm side, so the two arcs meet at the side's midpoint. All 4 corners fit (the fit test itself says so), and the result is a circle of length 2π·5 = 31.416, or a stadium for the slot.
- Suggested fix: in `filletNode`, accept `distance <= inLength + EPS` (the fit was already decided by `fittingCorners`), and drop the zero-length line left between arcs that meet.

### T11-P2-2: "Remove fillets" turns a tapered slot's rounded end into a spike hundreds of millimetres long, with only "Sharpened 1 corner."
- Severity: P2. The result is wrong and grows the burn far outside the artwork: on a 38 mm part, lit length 87 → 589 mm and the burn box runs to x 306 mm. The only report is "Sharpened 1 corner." Remove works on the whole selection, and the user does not pick which arcs it touches. It is not P1, because the spike shows on the canvas and Undo restores it.
- Where: `src/core/geometry/curve-fillet.ts:217-234` (`removeFilletAt`) and `:235-256` (`tangentAt`). Any minor circular arc (or cubic) tangent to two converging lines counts as a fillet, whatever its turn angle. The restored corner lies R·tan(turn/2) from the arc with no limit.
- Repro: `zz-t11/t11b.test.ts` "remove fillets on a tapered slot". A slot with a 2° taper and ends R5 / R4.5 (the small end is a 178° `elliptical-arc`, the big end is a large arc and is skipped) runs through the store `filletSelection(0,'remove')` and then `prepareOutput` → G-code. Burn bbox x 14.8..53.0 → 14.8..306.5 mm, lit 87.136 → 589.104 mm, toast "Sharpened 1 corner." With a 10° taper the spike is 31.4 mm (bbox 56.9 → 88.8). With a 30° taper it is 8.6 mm. The same rule hits any rounded tip of a tapered shape (arrow, teardrop, keyhole) whose end is one arc segment, and that is what Optimize Shapes / arc fitting, trim pieces and this tool's own output produce.
- Oracle: two lines at half-angle α from the axis meet at R/sin α from the arc's centre. For α = 1° and R = 4.5 that is 257.8 mm, which matches the measured tip. A tapered slot end is not a fillet that was applied; the help says Remove restores "sharp corners" of rounded corners. LightBurn removes the radius from a corner the user clicks, not from every arc in a selection.
- Suggested fix: skip, or list in the toast, any corner whose restored apex lies more than a few radii from its arc, or outside the selection's bounds grown by the arc radius. Or, with nothing picked, limit Remove to arcs that turn less than ~150°, and say how many were left.

### T11-P3-1: The "too short" message is shown when the real cause is locked artwork, already-rounded corners or uneven stretch
- READ + ran (script G/E). On a locked-only selection, a second Round on a rounded shape, or a 2×1 stretched object, the toast starts "No corner could take that radius: a corner needs two straight sides long enough for the arc." The stretched case appends the true reason after this false one. `path-fillet-actions.ts:110-125`.
- Fix: count locked, already-curved and stretched objects separately and name the real reason.

### T11-P3-2: A corner that fits on its own stays sharp when a neighbour that cannot fit claims the shared side
- Ran (`t11b`): a 40 × 20 outline with a 1.5 mm side then a 0.5 mm step, r 1 at 90°. Corner B (sides 40 and 1.5) needs 1 mm and gets it when picked alone, but is left sharp in "all corners" mode, because the corner past it (0.5 mm side, never rounded) still counts its 1 mm claim. `curve-fillet.ts:115-127`.
- Fix: drop the claims of corners that fail their own sides before testing their neighbours (iterate to a fixed point).

### T11-P3-3: Dense outlines: every near-collinear vertex gets a micro-fillet, and the work is quadratic (20 000 nodes = 4.4 s main-thread freeze); no stress test
- Ran (`t11b`): a smooth 20 000-gon (turn 0.018° per vertex) with r 1 gives "Rounded 20000 corners." after 4379 ms (5 000 nodes: 102 ms). Each `filletNode` copies the whole segment array (`replaceCorner` splice, `curve-fillet.ts:264`) inside the per-corner loop (`:53-58`). The collinear cut-off is 1e-6 rad (`:87`), so traced or flattened curves are filled with 0.0003 mm arcs. The October row's "dense-corner stress absent" is still true.
- Fix: build the output in one pass. Treat turns below a small angle (e.g. 0.5°) as straight. Add a dense-outline time-budget test.

### T11-P3-4: "Reverse radius (concave bite)" adds a convex quarter-disc at inside (reflex) corners
- Ran (script B): on an L shape with r 3, the five convex corners lose πr²/4 each, but the reflex corner gains πr²/4 (area 471.73 = A0 − 5·7.07 + 7.07). The arc centred on the corner takes the minor side, which at a reflex corner lies outside the material. The dialog label promises a concave bite. LightBurn's page does not describe inside corners. This is a design question, not a confirmed defect.
- Fix: decide and document it (skip reflex corners in reverse mode, or bite the material side), then match the label.

### T11-P3-5: Uniform-scale test is an absolute 1e-9, so scales that differ in the 9th digit are refused as "stretched"
- Ran (script E): scaleX 1/3 vs scaleY 0.33333333 gives "1 object was skipped: stretched unevenly". The values could come from rounded imported transforms. Whether the app's own resize ever produces this is not checked. `path-fillet-actions.ts:33,54`.
- Fix: use a relative tolerance (e.g. 1e-6·max(|sx|,|sy|)).

### T11-P3-6: Rectangles, ellipses, polygons and stars from the shape tools are not filleted (LightBurn applies Radius/Fillet to primary shapes)
- READ + ran (script G): `isPathEditable` (`path-cleanup-actions.ts:128-135`) admits only `polyline` shapes. A rect-only selection disables the command with "Select imported, traced or drawn-line artwork first." In a mixed selection the rect is skipped silently. A rectangle can still take Shape Properties corner radius, but a star or polygon needs Convert to Path first. The disabled-command reason does not say that.
- Fix: mention Convert to Path in the disabled reason and the toast, or convert primary shapes as LightBurn does.

## Not a defect / limits
- **T10-P2-1 weakness (arc re-solved between moved endpoints):** absent. Fillet and Remove only shorten or replace `line` segments; adjacent `elliptical-arc` segments are kept verbatim (checked byte-identical). The contour start moves only onto the new arc's end (`replaceCorner`) or onto the restored corner (`removeFilletAt`).
- Corners between a line and a curve are left alone by design (header l.2-3). LightBurn's documentation does not settle this either.
- A path whose ends coincide but is not closed keeps its joined end sharp. It is treated as open, which is consistent with Close Path existing.
- A radius too large is skipped, not clamped, which matches LightBurn ("not enough space").
- The dialog radius is mm only, by ADR-629. Typed units and comma decimals are refused silently, the same pattern as T08-P3-3 (known).
- Area deficits of ≤0.016 mm² and length deficits of ≤5e-4 mm come from chord flattening at 0.0005 mm, not from the geometry.
- Not checked: a browser run of the dialog (keyboard, focus, Cancel), and fillet on Design Studio sketch objects. Whether the app's own aspect-locked resize can produce a 1e-9 scale mismatch was not checked either.

## Totals
Raised 8; P1 0; P2 2; P3 6; known 0. The dialog's unit/comma refusal is the same pattern as T08-P3-3 and is not counted.
