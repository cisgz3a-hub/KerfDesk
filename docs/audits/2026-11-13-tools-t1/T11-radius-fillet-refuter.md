# T11 Radius Fillet — refuter report
Tree: origin/main @ 856cb3ae1. Command id: `tools.radius-fillet`. Scratch: `C:\Users\stolk\kd-t1\zz-t11r` (own geometry + G-code decoder `geo.ts`; tests `r11.test.ts`, `r11b.test.ts`, `r11c.test.ts`; output `r11.log`). Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t11r/vitest.config.mts --maxWorkers=1`. None of the auditor's scripts or decode helpers were used.

## Verdicts
| Claim | Verdict | Why |
|---|---|---|
| T11-P2-1 exact-fit radius rounds every other corner | **CONFIRMED (P2)** | Own oracle (sampled area + distance from each original corner to the result) shows a half-rounded outline. It is reached through the store, an inch SVG import and scaled objects, and it burns that way. Re-applying the same radius cannot finish the job. |
| T11-P2-2 Remove fillets turns a tapered rounded end into a long spike | **CONFIRMED (P2), with the trigger narrowed** | The core rule is as described. The auditor's sources are mostly wrong: SVG `A` arcs, DXF bulges, traced bitmaps and Optimize Shapes never produce a single-segment tip in my runs. A hand-drawn SVG tip written as one `C` cubic does, and gives a 28–47 mm spike on a 60 mm pointer. Inside the bed nothing warns. Past the bed edge the G-code preflight blocks it. |

## Evidence

### T11-P2-1
- **Core, own oracle** (`r11.test.ts` "P2-1: exact-fit…"): 10×10 r5 gives count 2. Area is 89.270 (all-round 78.540). The distances from the corners to the outline are `0.000, 2.071, 0.000, 2.071`, so corners 0 and 2 are still sharp. The same happens on 30×10 r5, 25.4×12.7 r6.35, 20×20 r10 and 3×1 r0.5. r·(1±1e-12) behaves the same as r. r−1e-6 gives 4 of 4 and the exact all-round area. Equilateral triangle at its inradius: 1 of 3. Reverse r5 on the 10 mm square: 2 of 4.
- **Cause, read and confirmed by the counts:** `fittingCorners` (`curve-fillet.ts:124-125`) admits ≤ side + EPS. After the first corner in descending order shortens the shared side to exactly `distance`, `filletNode` (`:139`) refuses with `distance > len − EPS`. So the corners alternate.
- **The user cannot repair it in place:** applying r5 again to the half-rounded 10 mm square rounds 0 more corners, even with all nodes picked. Only a radius such as 4.9999 rounds the 2 remaining corners.
- **Realistic route:** an SVG `width="1in" height="0.5in" viewBox="0 0 96 48"` rectangle imports as an exact 25.4×12.7 `llll` contour. Through the store, r 6.35 gives "Rounded 2 corners." and segments `llAlAl`. Store runs on objects scaled ×25.4 (a 1×0.5 local plate) and ×0.1 (100×50 local, r 2.5) also give 2 of 4.
- **Burn (own G-code decoder, G1/G2/G3 with I/J):** 10×10 lit 40.000 → 35.682 (all-round 31.416). 30×10: 80.000 → 75.682 (71.416). 25.4×12.7: 76.200 → 70.724 (65.298). Each is one Undo step. The laser output here is all G1 (G2/G3 count 0), and the lit length matches the half-rounded geometry, so the asymmetric shape is what burns.
- **Toast:** "Rounded 2 corners." The count is honest. It does not say that 2 corners that fit were left sharp, and the help says only corners "whose sides are too short" are left sharp (`layout-command-help.ts:98`). These sides are not too short.
- **Alternatives:** the Rectangle tool's Shape Properties corner radius is clamped to half the shorter side (`rectangle.ts:13-16,86-89`). It gives a correct circle or stadium: 10×10 r5 area 78.562 (exp 78.540), 30×10 r50 clamped gives a stadium with perimeter 71.420 (exp 71.416). A native rectangle therefore has a correct route, and this tool cannot take a rect shape at all (T11-P3-6). Imported, traced and pen-drawn rectangles have no other route, and the inch plate above is exactly that case. The Box Generator does not round corners.
- **Tests:** `curve-fillet.test.ts` uses a 20 mm square with r5 (not an exact fit) and r11 (too large). `path-fillet-actions.test.ts` uses 20 mm with r10 world on a ×2 object (local 20 mm, r5). No test asserts the exact-fit behaviour, either way.
- Severity stays P2 under AREAS.md: a wrong result the user will notice, shown on the canvas, undoable. It is not P1, because what burns is what the canvas shows.

### T11-P2-2
- **Core rule confirmed** (`r11.test.ts` "P2-2: remove on tapered ends"). My slot model gives the apex at the sides' intersection. With a 1° half-taper and a small end R4.5, maxX goes 32.99 → 286.49 (oracle 286.49) for both a single `elliptical-arc` end and a single tangent `cubic` end. 5°: 25.42 → 57.37. 15°: the arc end is removed (+10 mm). The 15° cubic end and 30° are left alone.
- **Where a single-segment tapered tip comes from** (`r11.test.ts` "sources", `r11b.test.ts`):
  - SVG `A` command: the imported segments are `lCClCCCl`. The 178° end becomes 2 cubics, because `transformSvgCurveSubpath` → `arcToCubics` splits it. Remove gives "No rounded corners to remove…" and the burn is unchanged. This holds in mm, in px and under a `transform`. **Not a trigger.**
  - DXF LWPOLYLINE bulge: segments `lCClCCC` (`bulgeCurveSegment` → `parametricEllipseCurve`, ≤90° per cubic). Remove does nothing. **Not a trigger.**
  - Traced bitmap (Line Art preset; 1°, 3° and 8° half-tapers): every contour is all cubics with no lines. Remove does nothing. **Not a trigger.**
  - Optimize Shapes on a dense 1° slot: `lCAClCA` (lines-arcs-curves) or many short arcs (lines-arcs). Remove does nothing. **Not a trigger in this sample.** The auditor's claim that "Optimize Shapes / arc fitting … produce" it is not supported.
  - The tool's own output: fillet a sharp 2° wedge tip with r4.5, then Remove, gives maxX 286.500, the original tip. This is the correct inverse, not a defect.
  - **Hand-drawn SVG tip as one `C`:** this is a trigger. A 60 mm pointer `M0 0 L60 2 C63 2.1 63 3.9 60 4 L0 6 Z` imports as `lCll`. Remove gives 1 corner and maxX 67.25 → 95.00 (sides meet at x 90 + 5 translate). A pencil-style end with a 1.7° half-taper goes 58 → 105. A `Q` tip whose control point is not on both side lines is left alone. So the defect is reachable through ordinary SVG import of hand-drawn art, but not through the paths the auditor named.
- **Scope:** Remove runs on the whole selection. A mixed selection of a rounded square and a slot gives "Sharpened 5 corners." with no per-corner choice. Picking nodes does not narrow it either (T11R-P2-1 below). LightBurn (docs.lightburnsoftware.com/latest/Reference/RadiusFillet/, fetched) removes a radius only from the corner the user clicks with the Radius tool. It has no selection-wide removal. When a corner will not revert, it suggests Optimize Selected Shapes.
- **Preview and preflight** (`r11c.test.ts`): with the pointer ending at x 379.5 on the 400 mm bed, Remove moves the G-code maxX to 408.00. The canvas out-of-bed hint turns on, and emit preflight returns `ok:false` "Line 9: X out of bed: 408". A spike that stays inside the bed gets no warning at all. My first x 300 slot check used `prepareOutput` alone, which returns ok; the out-of-bed gate is in the emit preflight.
- Severity stays P2: a wrong result that grows the burn, shown on the canvas, undoable, and blocked only when it leaves the bed. It is not P3, because ordinary hand-drawn SVG art reaches it and Remove cannot be scoped. The likelihood is lower than the auditor stated, so the finding text should drop the Optimize Shapes, trim and DXF/SVG-arc sources and name single-cubic tips instead.

## Extra findings

### T11R-P2-1: "Remove fillets" ignores picked nodes and sharpens every fillet in the picked contour, although the dialog says "Applies to the picked corner."
- Severity: P2. It is a wrong result the user will notice. The dialog (`RadiusFilletDialog.tsx:99-101`) and the help ("Nodes picked with the node tool limit it to those corners", `layout-command-help.ts:98`) promise per-corner scope, and per-corner removal is the only removal LightBurn documents. It also takes away the one way to keep T11-P2-2's spike off a tapered tip in the same contour. It is not P1, because the canvas shows it and Undo restores it.
- Where: `src/ui/state/path-fillet-actions.ts:64-71`. The picked nodes only choose which contours run. In remove mode, `removeCurveFillets(curve)` takes no node list (`curve-fillet.ts:160-173`) and removes every tangent curve in the contour.
- Repro: `zz-t11r/r11.test.ts` "P2-2: picked nodes…". A 20 mm square rounded r4 on all corners, with one node picked (pointIndex 1), then `filletSelection(0,'remove')` gives the toast **"Sharpened 4 corners."** For comparison, the same pick with Round r4 on a plain square gives "Rounded 1 corner."
- Oracle: the dialog's own text for one picked node is "Applies to the picked corner." Expected: 1 corner sharpened.
- Suggested fix: pass the picked node indices to `removeCurveFillets` and only remove a curve whose start or end node is picked. Otherwise word the dialog as "Removes every fillet in the picked contours."
- Earlier ledgers: not found (`docs/audits/**`, searched for fillet with pick, remove or sharpen).

## Totals
Claims checked 2: confirmed 2 (P2-1 as raised; P2-2 confirmed at P2 with the trigger corrected to single-cubic tips, not SVG/DXF arcs, trace or Optimize Shapes). Extra raised 1: P1 0; P2 1 (T11R-P2-1); P3 0. Known 0.
