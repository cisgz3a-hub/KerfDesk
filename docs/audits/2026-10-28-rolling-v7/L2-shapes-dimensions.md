# Rolling audit v7 — L2 Shapes and dimensions

- **When:** 2026-10-28, about 13:30 +0800.
- **Tree:** origin/main @ `f1d919fbf` at the start. During the audit main moved to `5f3c420f4` (#1498), which changes only `docs/` (`git diff --name-only f1d919fbf 5f3c420f4 -- src electron` is empty), so every cited line holds on both.
  - **Repros ran on main's tree.** They ran in the scratchpad copy `…\scratchpad\j7-main\`, which matches main's non-doc files. The audited source files were checked with `cmp` against the worktree.
  - **fflate alias.** The junctioned `node_modules` has no top-level `fflate` link; the package exists only under `.pnpm`. The UI repros therefore ran with a temporary `zz-l2-vitest.config.ts`. It is the repo's `vitest.config.ts` plus one alias to `.pnpm/fflate@0.8.3/…/esm/browser.js`.
  - **Command,** from `j7-main`, one file at a time: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=3072" node node_modules/vitest/vitest.mjs run <file> [--config zz-l2-vitest.config.ts] --silent=false --disableConsoleIntercept`.
- **Scope:**
  - **Primitives:**
    - `src/core/shapes/**`: rectangle and rounded rectangle, ellipse and circle, polygon, star, bulge, polyline/pen, registration box, `shape-from-drag`, `rematerialize-shape`;
    - `core/geometry/ellipse-curve.ts`.
  - **Entry points:**
    - the drawing tools (`ui/workspace/draw-tool.ts`, `pen-tool.ts`, `pen-curve.ts`);
    - the Shape Inspector fields (`ui/layers/SelectedShapeGeometryFields.tsx`, `object-properties-actions.ts`);
    - the Numeric Edits toolbar (`ui/commands/NumericEditsBar.tsx`, `core/scene/selection-transform.ts`, the 9-dot anchor, the aspect lock);
    - units and entry (`core/numeric-expression.ts`, `ui/display-length.ts`, `format-display-millimetres.ts`; ADR-629);
    - the twins: Design Studio's `to-scene-object.ts` and field parsers, remote/MCP `add_rectangle` / `add_ellipse` / `add_polyline`, `.lf2` save/load, and laser G-code (G1 and the ADR-432 arc profile).
  - **Governing ADRs:** ADR-051, ADR-159, ADR-214, ADR-272, ADR-432, ADR-629.
- **Lenses run:**
  - **L2 ground truth:** analytic geometry; LightBurn 1.7 docs at versioned paths.
  - **L3 twins:** Inspector, canvas metrics, `.lf2`, G-code, Design Studio, MCP.
  - **L4 adversarial:** zero, negative, tiny and huge sizes; radius above half the side; 1/2/1000 sides; star ratio 0/1/1.5; NaN and empty input; expressions.
  - **L7 test truth:** existing tests named under "Test truth".
  - **Skipped:** transform accumulation and the rotation pivot (L4's area), canvas pixels (L8), and Design Studio internals (L5).
- **Counts:** 7 raised → 0 refuted → P1 1 / P2 1 / P3 5 (+ 2 KNOWN re-observed).
  - **Refuter (2026-10-28, fresh context):** all 7 findings CONFIRMED, each by its own repro on `j7-main` (cmp-identical to `src` on `5f3c420f4`; `git diff --stat f1d919fbf origin/main -- src electron` is empty).
  - **Severity changes:**
    - L2-P2-1 is re-rated **P2 → P1**. The ID is kept for traceability.
    - KNOWN rolling v2 08-P3-3 is CONFIRMED. The refuter recommends re-rating it **P3 → P1** for the toolbar's typed W/H/X/Y on rotated non-rectangular artwork (see KNOWN re-observed).
    - L2-P2-2 stays P2.
  - Both KNOWN items were re-checked: 08-P3-3 and 13-P3-1 (by repro).

## Headline

**Exact where it should be.** Typed sizes are stored at full double precision and reach G-code exactly at its 3 decimals:
- 50, 31.75 (`1.25in`), 33.333, 0.1, 50.8 (`2*25.4`) and 3.333 (`10/3`) mm rectangles burn at exactly those sizes, on both the G1 and the arc profile;
- a `.lf2` round trip keeps spec, bounds, transform and curves identical, and the G-code byte-identical;
- 9-dot resizes keep their anchor to within 2e-14 mm over 20 alternating edits at 0/90/180/270°;
- inch display re-entry is idempotent.

**Where the burn departs from what the user typed or reads:**

- **KNOWN 08-P3-3, P1 candidate under v7.** A rotated round or irregular shape is measured by its rotated bounds *rectangle*.
  - A 50 mm circle at 45° reads **W 70.711**, both on the toolbar and in the Shape Inspector's "Rotated footprint on the bed: 70.711 × 70.711 mm" note. G-code burns it at **49.994** wide.
  - Typing **W = 50** (aspect locked) burns a **35.32 mm** circle. A hexagon (r 25) at 45° burns 36.60 mm, and a 60×30 r15 rounded rectangle burns 40.20 mm.
  - LightBurn defines the box as "the smallest possible rectangle that can contain every object in your selection".
- **L2-P2-1 (refuter: re-rated P1).** After a toolbar W/H resize, a rounded rectangle's corners are elliptical. The **Corner radius** field shows only the smaller axis.
  - Example: a 100×50 r10 rectangle resized to W 200 shows "10" but burns **20 × 10 mm** corners.
  - Typing 6 burns 12 × 6. The field can never produce a circular corner on that shape.
- **L2-P2-2.** The Line/pen tool silently rounds a plain click-by-click path once it has ≥ 4 open or ≥ 5 closed vertices.
  - A 5-click 100 × 100 house burns with walls bowed up to **1.51 mm**, and the toolbar reads W **102.535**.
  - Dragging any one node makes every plain click a straight corner again (W 100.000).
  - LightBurn's default is corner nodes.

**Curve accuracy (L2-P3-1).** Circles, ellipses and rounded corners are four cubic Béziers per turn, not arcs.
- The radial error is +2.7253e-4 × r: 0.0136 mm at Ø100, **0.0546 mm at Ø400** and 0.136 mm at Ø1000.
- That passes the 0.025 mm machine tolerance from Ø184 mm up, and the arc profile adds its own fit (Ø400: 0.0612 mm).
- Polygons and stars are analytically exact.

| shape | typed | stored | displayed | output (G-code) | verdict |
|---|---|---|---|---|---|
| Rectangle | 50 × 50 | 50 × 50 | 50 × 50 | 50.000 × 50.000 | exact |
| Rectangle | `1.25in` × 33.333 | 31.75 × 33.333 | 31.75 × 33.333 | 31.750 × 33.333 | exact |
| Rectangle | 0.1 × 0.1 | 0.1 × 0.1 | 0.1 × 0.1 | 0.100 × 0.100 | exact |
| Rectangle | `10/3` × `2*25.4` | 3.3333333333333335 × 50.8 | 3.333 × 50.8 | 3.333 × 50.800 | exact (3-dp output) |
| Rectangle (Inspector) | width `0` / `-5` / `0.001` | 0.01 (clamped, 1 undo step) | 0.01 | 0.010 | L2-P3-2 (toolbar refuses 0) |
| Rounded rect 100×50 r10 → toolbar W 200 | Corner radius `6` | spec r 6, scale (2, 1) | "6" | corner **12 × 6** | **L2-P2-1** (refuter: P1) |
| Circle | Ø50 / Ø200 / Ø400 | spec exact; curve +0.0068 / +0.0273 / +0.0545 | 50 / 200 / 400 | G1: +0.0068 / +0.0275 / **+0.0546**, −0.025; arcs: +0.0018 / +0.0235 / **+0.0612** | L2-P3-1 above Ø184 |
| Ellipse 300 × 100 | 300 × 100 | exact spec | 300 × 100 | curve ray error 0.039 | L2-P3-1 |
| Circle Ø50 at 45° | toolbar W `50` (locked; unlocked is refused with "Lock the aspect ratio to scale evenly") | scale 0.7071 | toolbar W 50, note "footprint 50 × 50"; Inspector Ellipse width 35.355 ("own, unrotated size") | **35.32** wide | KNOWN 08-P3-3 (refuter: re-rate P1) |
| Circle Ø50 at 45° | — | — | W **70.711**, note "footprint 70.711 × 70.711" | 49.994 | KNOWN 08-P3-3 |
| Polygon 3/5/6/64, r 25 | r 25 | vertices exact (0 error), first vertex up, clockwise on screen | — | — | exact |
| Polygon dragged 100 × 50 | Radius `30` | spec r 1.2, scale (57.7, 25) | Radius shows **25** before | box 120 × 60, left edge +1.547 | L2-P3-3 |
| Star | inset 0 / 1 / 1.5 | clamped 0.05 / 0.95 | 5% / 95% | — | clean (visible clamp) |
| Bulged heptagon / star | bulge 0.33 / 1 | exact arcs | toolbar 62.175 × 61.713 | 62.136 × 61.713 | clean (≤ 0.04, inscribed chords) |
| Pen house (5 clicks, closed) | 100 × 100 box | spec = clicks; curve = 10 cubics | W **102.535** × 100.298 | same bow, up to **1.51 mm** off the clicked walls | **L2-P2-2** |
| Pen square (4 clicks, closed) | 100 × 100 | lines | 100 × 100 | 100 × 100 | exact |
| `.lf2` round trip | r `10/3`×33.333 r`1/7`; ellipse 31.75×0.1; heptagon r12.7 bulge 0.33 | identical | — | G-code byte-identical | exact |

## Findings

### L2-P2-1 — After a toolbar W/H resize, the Corner radius field shows only the smaller axis of now-elliptical corners; typing a radius burns an R × 2R corner, and a circular corner can no longer be made

- **Where:**
  - `src/ui/layers/SelectedShapeGeometryFields.tsx:117`: `scale={Math.min(props.scale.x, props.scale.y)}`. The comment at `:115-116` says "under a non-uniform scale the smaller one is what the corner can actually fit inside".
  - `:299`: the commit divides by that one scale, `result.value / scale`.
  - `src/core/scene/selection-transform.ts:312-328` (`scaleTransformAboutPoint`): the toolbar resize scales only `transform.scaleX/scaleY`.
  - `src/core/shapes/primitives/rectangle.ts:64` builds each corner in spec space, so the transform stretches it.
- **Anchor:**
  - **Twin.** The Inspector's Corner radius readout disagrees with the compiled corner of the same object. Its Width and Height fields in the same panel do report bed millimetres (`specScale`, `:65-81`; PR #451 "shape size fields report bed mm, matching the toolbar").
  - **Contract.** The fields promise bed millimetres ("These fields report bed millimetres — the same quantity the toolbar names", `:70-71`); a radius has no single bed value here.
- **Scenario:**
  1. Draw a 100 × 50 rectangle and set Corner radius 10.
  2. Type W = 200 in the toolbar (aspect unlocked, the default). Scale becomes (2, 1).
  3. The Inspector shows Width 200, Height 50, **Corner radius 10**. The canvas and G-code corners are 20 mm along X and 10 mm along Y.
  4. Typing 6 stores spec r 6 and burns 12 × 6 corners. The burned corner is twice the typed radius along X.
- **Evidence:** REPRO.
  - `src/ui/layers/zz-l2-fields.test.tsx`, through the real panel and store:
    - `rr-after-resize {"width":"200","height":"50","corner":"10","cornerMax":"25","spec":{…"cornerRadiusMm":10},"scale":[2,1],"burnedCornerXY":[20,10]}`;
    - `rr-type-6 {"field":"6",…"burnedCornerXY":[12,6]}`.
  - `src/io/gcode/zz-l2-output.test.ts`, from the G-code: `roundrect-nonuniform {"fieldShowsCornerRadius":10,"out":{…"w":200,"h":50},"cornerHorizontalMm":20,"cornerVerticalMm":10}`.
- **Severity:** P2, a misleading readout plus a typed value that is not burned on one axis.
  - The canvas does draw the elliptical corner, which is why this is not rated P1.
  - A strict reading of v7's P1 clause ("differs … from what the user typed") would make it P1. The coordinator may weigh this.
- **Novelty:** new. PR #451 fixed Width/Height only. No audit names the corner radius under scale (`git grep` of `docs/audits`). No open PR touches the file.
- **Refuter: CONFIRMED, re-rated P1.**
  - **What would refute it, and what was found:**
    - **An ADR that chooses stretched corners.** The closest is ADR-144, Consequences (DECISIONS.md:7616-7617): "Width and radius values remain object-local geometry; the existing selection transform controls continue to own whole-object scale, rotation, and mirror."
      - This accepts the transform architecture. It does not decide that a single radius readout may describe an elliptical corner.
      - Its "object-local" fields were later changed to bed mm by commit `40e46b114`, with no amendment. That commit's message gives the min-scale radius as a code choice ("Radius fields … use the smaller scale"), not as an ADR decision.
      - The Design Studio twin rules elliptical corners out. ADR-272 Amendment 4, item 3, says "a true stretch makes the corners elliptical, which `RectangleSpec` cannot hold", and keeps the corners circular.
    - **A misread of LightBurn.** LightBurn 1.7 Primary Shapes (https://docs.lightburnsoftware.com/1.7/Reference/PrimaryShapes/, fetched 2026-10-28), heading "Corner Radius — Rectangle Only", says the radius "remains consistent even if the dimensions of the rectangle are later changed". The same page says Width and Height change "in the Shape Properties Window and the Numeric Edits Toolbar". This resolves the report's "Not verified" item: the finding now has a ground-truth anchor as well as the twin.
    - **A UI cue.** None. No note, tooltip or toast says the corner is elliptical.
  - **Own repro:** a real `NumericEditsBar` plus `SelectedObjectProperties`, with typed input. Corners were measured from the `emitGcode` G1 points.
    - 100 × 50 r 10, toolbar W `200`: scale [2, 1]; the field shows "10"; the G-code corner is **20 × 10**.
    - Corner radius `6`: the field shows "6"; the G-code corner is **12 × 6**.
    - **The everyday flow also hits it.** A drag-drawn rectangle stores its drag size at scale 1 (`shape-from-drag.ts:39-45`). Drawing 40 × 20, typing toolbar W `200` and H `50`, then Corner radius `5`: the field shows "5", the spec stores r 2, and the G-code corner is **10 × 5**.
  - **Why P1:**
    - v7's design P1 says "a design operation produces geometry that differs in … shape from what the user typed … so the burn is wrong with no warning".
    - The typed radius (10, then 6, then 5) burns twice as long along X, and the field keeps echoing the typed number.
    - The only route to P2 is to count the canvas drawing of the elliptical corner as a warning. METHOD §3 (rolling v3 G6) rejects that: the operator has to notice the mismatch unprompted.
    - That route would also lower 08-P3-3, whose canvas likewise draws the true geometry.
    - v7's P2 example, "a wrong boolean result on screen", has no typed value that the readout contradicts. This finding does.
- **Fix direction:**
  - Either re-bake a non-uniform toolbar resize of a parametric rect/ellipse into its spec (scale → 1), so corners stay circular as the spec says;
  - or show the corner as "X × Y" when the axes differ and offer "make circular".
  - Add a test that asserts the burned corner equals the typed radius after a toolbar resize.

### L2-P2-2 — The Line/pen tool rounds a plain click-by-click path (≥ 4 open or ≥ 5 closed points) into fitted cubics: a 5-click house burns with walls bowed up to 1.51 mm, yet dragging any one node makes every plain click a straight corner

- **Where:**
  - `src/ui/workspace/pen-tool.ts:228-235`: `createPolyline`, and the exact `curvedPenShape` only `penHasHandles(penDraft.handles) ? … : shape`.
  - `src/core/shapes/create-polyline.ts:27-28,46`: thresholds 4 open / 5 closed, default `'round'`.
  - `src/core/shapes/round-polyline-curve.ts:16`: `fitCubicsThroughPoints(…, new Set(), …)` declares no corners. The fit tolerance is 2% of the diagonal, clamped to 0.25–3 mm (`create-polyline.ts:24-26`).
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Draw Lines (https://docs.lightburnsoftware.com/1.7/Reference/DrawLines/, versioned path, fetched 2026-10-28): "Placing corner nodes and creating lines is the default behavior". Smooth nodes come from click-and-drag, or from an opt-in Auto-Smoothed mode (S key).
  - **Twin.** `pen-curve.ts:1-5` says "LightBurn Draw Lines: click for a corner … A segment between two plain vertices stays a straight line". That holds only after some node was dragged.
  - **Twin.** Design Studio deliberately avoids `createPolyline` because it "FAIRS its input … Either would quietly bend a precisely specified arc" (`core/design/to-scene-object.ts:18-23`).
  - **Contract.** PROJECT.md:28 says KerfDesk "deliberately copies LightBurn's UX shape and workflow". No ADR records rounding plain clicks: ADR-214 only version-stamps the fairing, and the behaviour came from PRs #188 and #194.
- **Scenario:**
  1. With grid snap, click a house outline: (100,140), (150,100), (200,140), (200,200), (100,200), then close.
  2. The burned walls bow outward. The toolbar reads 102.535 × 100.298 instead of 100 × 100. The worst point is 1.51 mm off the clicked edges.
  3. The same with any one node dragged gives straight walls, 100 × 100.
  4. A 4-click open zig-zag 60 × 20 deviates 0.58 mm. A 4-click closed square stays straight.
- **Evidence:** REPRO.
  - `src/ui/workspace/zz-l2-pen.test.ts`, through the real `finishPen` and the store:
    - `pen-plain-clicks {"kinds":["cubic"×10],"toolbarWH":[102.535,100.298]}`;
    - `pen-one-dragged {"kinds":["cubic","cubic","line","line","line"],"toolbarWH":[100,100]}`.
  - `src/core/shapes/zz-l2-core.test.ts`: `house-closed-5 … "maxDeviationFromClickedEdgesMm":1.51`, `zigzag-open-4 … 0.581`, `square-closed-4 … 0`.
  - `src/io/gcode/zz-l2-output.test.ts`: `pen-house {"houseGcodeBox":[102.515,100.296],"squareGcodeBox":[100,100]}`.
- **Severity:** P2. A visible wrong shape that an ordinary user will notice. The canvas shows it before the burn, so it is not P1.
  - It is deliberate code: `create-polyline.test.ts` "rounds sparse alternating pen bends", and PR #194. It is still raised because there is no ADR and the tool's own twin comment contradicts it. A refuter may treat it as a product decision; that needs an ADR.
- **Sibling (not raised separately):**
  - MCP and phone `add_polyline` use the same materializer (`ui/remote-control/touch-shapes.ts:14`).
  - The tool description discloses this: "with the same curve fairing as the PC pen" (`electron/mcp/tool-info.ts:88`). An agent sending exact vertices still gets fitted cubics.
- **Novelty:** new as a finding. PRs #188 and #194 introduced it. No audit names it (`git grep` of `docs/audits` for `roundPolylineCurve`, `fairing`, `pen`).
- **Refuter: CONFIRMED, P2 kept.**
  - **What would refute it, and what was found:**
    - **An ADR.** ADR-214's subject is "pen-drawing fairing", so the feature is ADR-acknowledged. Its decision only version-stamps the migration. No ADR decides that plain clicks lose their corners.
    - **The PRs.** PR #188 ("fair drawn polylines with tracer curves") and PR #194 ("round pen paths with tracer spline") show the behaviour is deliberate. They give no UX rationale against LightBurn.
    - **A UI hint.** None discloses it. Two more twins contradict it:
      - the tool's own tooltip, `help-topics.ts:121-125`: "Draw connected line segments; click and drag to place a smooth curve node with Bezier handles";
      - the draft preview, `draw-pen-preview.ts:30-31`: "The placed path as it will be drawn: straight between corner clicks".
      - The only statement of the fitting is a code comment, `pen-tool.ts:243-244`.
    - **LightBurn.** LightBurn 1.7 Draw Lines (versioned path, re-fetched 2026-10-28) says "Placing corner nodes and creating lines is the default behavior of the Draw Lines tool". Smooth nodes come from click-and-drag, or from S, which toggles the mode.
  - **Own repro:** the real `finishPen` and the store, then `emitGcode`, for the house (100,140), (150,100), (200,140), (200,200), (100,200), closed.
    - **Plain clicks:** 10 cubics. The toolbar reads **102.535 × 100.298**, and the G-code box is 102.515 × 100.296. The burn is at most **1.51 mm** off the clicked edges (sampled cubics against the clicked polygon).
    - **One node dragged:** cubic, cubic, then three lines. G-code 100 × 100.
  - **Why P2, not P1:**
    - Once the path is finished, the canvas, the toolbar W/H and the burn all agree.
    - No typed value is contradicted. The burn departs from the draft preview, the tooltip and LightBurn's convention. That is v7's P2 "visibly wrong behaviour … on screen", like its "wrong boolean result on screen" example.
    - The change appears in the drawing view at the moment of finishing, before any output.
    - If the coordinator reads the draft preview as "what the app shows" under the P1 clause, this becomes P1. The refuter does not, because the finished shape replaces the preview on screen at once.
- **Fix direction:**
  - Make plain clicks corners by default, as LightBurn and `pen-curve.ts` describe, and keep fitting as an explicit smooth mode (the S toggle);
  - or record the decision in an ADR and pass every plain vertex as a corner to the fitter.
  - Give `add_polyline` an exact mode.

### L2-P3-1 — Circles, ellipses and rounded corners are four cubic Béziers, not arcs; their radial error (2.7253e-4 × r) passes the 0.025 mm machine tolerance from Ø184 mm and reaches 0.055 mm at Ø400

- **Where:**
  - `src/core/geometry/ellipse-curve.ts:3,41`: quarter-turn cubics with the `4/3·tan(θ/4)` handle;
  - used by `core/shapes/primitives/ellipse.ts:41-48` and `rectangle.ts:64`.
- **Anchor:**
  - **Ground truth:** the analytic circle and ellipse.
  - **Twin.** Bulged polygon sides are "exact elliptical-arc segments, so the outline needs no fitting" (`bulge-outline.ts:3-5`), and the scene supports `elliptical-arc` (`curve-path.ts` `flattenArc`).
  - **Twin.** `to-scene-object.ts:12-15` calls the circle and ellipse carrier "exact".
  - **Contract.** ADR-432 D1 bounds output to "the 0.025 mm machine tolerance", measured from the canonical curve, which is already off.
- **Scenario:** A Ø400 mm circle burns up to 0.0546 mm outside the circle on the G1 profile, and 0.0612 mm with arcs (fitted arc radii 199.41–200.97). A Ø1000 CNC disc is 0.136 mm off near 19.4° and 70.6° of each quarter. (Refuter correction: the report first said "the 22.5° points".) The cardinal extents stay exact, so W/H readouts look right.
- **Evidence:** REPRO.
  - `zz-l2-core.test.ts`: `circle {"diameter":184,"curveMaxOutMm":0.02507,"exceedsMachineTol":true}`, Ø400 `0.05451`, Ø1000 `0.13626`, `relative 2.7253e-4`; rounded rect r 50 corner `0.01363`; ellipse 300 × 100 ray error `0.03888`.
  - `zz-l2-output.test.ts`: `circle-out {"arcs":false,"d":400,"maxOutMm":0.0546}`, `{"arcs":true,"d":400,"arcMoves":13,"arcRadiusRange":[199.41,200.97],"maxOutMm":0.0612}`.
- **Severity:** P3. Below a laser kerf at ordinary sizes, but above the app's own tolerance for large work.
- **Test truth:** `ellipse-curve.test.ts` (2/2) checks structure and seam only; `ellipse.test.ts` (3/3) checks only the compatibility polyline's vertices. Neither would fail on this error.
- **Refuter: CONFIRMED, P3.**
  - **Own repro.** Sampling `ellipseToCurve` at 2,000 points per cubic gives a maximum radial error of exactly **2.7253e-4 × r** at Ø50/184/400/1000: 0.00681, 0.02507, 0.05451 and 0.13626 mm. That is the known constant for a quarter-turn cubic with k = 4/3·tan(π/8).
  - **Own G-code, Ø400 on the default profile:** box 400.000 × 400.000; worst point +0.0546 mm outside, −0.0005 inside. The arc-profile figure (0.0612 mm) was not re-run.
  - **Correction.** The worst points are near **19.4° and 70.6°** of each quarter (t ≈ 0.211 and 0.789). They are not the 22.5° points, and each quarter's 45° midpoint lies exactly on the circle.
  - **Anchors.**
    - The `to-scene-object.ts:12-15` "exact" claim is about the *spec carrier* representing the entity, not the curve, so it is a weak twin.
    - ADR-432's 0.025 mm bound is measured against the sampled source curve, so the ADR is not breached on its own terms.
    - The anchor that holds is ground truth: the analytic circle. P3 stands.
- **Fix direction:** emit `elliptical-arc` segments for ellipses and rounded corners (exact, and G2/G3-ready), or subdivide the cubics until the error is under 0.001 mm. Add a radial-error test.

### L2-P3-2 — Shape Inspector size fields silently turn `0`, negatives and sub-0.01 entries into a 0.01 mm shape (one Undo step, no message); the toolbar refuses the same entry

- **Where:** `src/ui/layers/SelectedShapeGeometryFields.tsx:96,106,140,150,181,232` (`min={0.01}`) and `:349-361` (`clampFieldValue`). `rematerialize-shape.ts:37` would itself refuse ≤ 0, but the clamp happens first.
- **Anchor:** **Twin.** `NumericEditsBar.tsx:421` refuses with "Width and height must be greater than 0." (`selection-transform.ts:220-222`).
- **Scenario:** Typing `0` or `-5` into Rectangle width collapses a 40 mm rectangle to a 0.01 mm sliver (a double burn line). The box shows 0.01, not marked invalid.
- **Evidence:** REPRO, `zz-l2-fields.test.tsx`: `width-entry {"typed":"0","stored":0.01,"shown":"0.01","invalid":"false","undoSteps":1}`, and the same for `-5`, `0.001` and `1e-400`. `abc` is marked invalid and keeps the value.
- **Severity:** P3. Visible on the canvas and undoable.
- **Refuter: CONFIRMED, P3.**
  - **Own repro, through the real panel.** On a 40 × 20 rectangle, typing `0` or `-5` stores 0.01 with one Undo step each. The box shows "0.01", `aria-invalid` is false, and the toolbar W also reads 0.01.
  - Every readout agrees with the burn, and the collapse is visible, so P3 stands.
- **Fix direction:** validate ≤ 0 as an error, as the toolbar does, and clamp only positive values below the minimum.

### L2-P3-3 — Polygon and star Inspector: Radius on a drag-drawn polygon is the smaller axis of a non-uniform scale, and a Radius or Sides edit grows about the circumscribed-square corner, so the shape's visible top-left moves

- **Where:**
  - `src/core/shapes/shape-from-drag.ts:102-120` (unit radius at `:111`): a unit-radius polygon plus a non-uniform `scaleX/scaleY`.
  - `SelectedShapeGeometryFields.tsx:180` (min scale).
  - `primitives/polygon.ts:25`: vertices around (r, r), so local (0, 0) is the circumscribed square's corner, not the bounds corner.
- **Anchor:**
  - **Ground truth.** LightBurn 1.7 Shape Properties gives a polygon Width, Height and Sides; for example "Width: the length of the polygon in the horizontal (X Axis) dimension." (https://docs.lightburnsoftware.com/1.7/Reference/ShapeProperties/, fetched 2026-10-28).
  - **Twin.** A rectangle or ellipse edit keeps its top-left fixed.
- **Scenario:**
  - A hexagon dragged 100 × 50 shows Radius **25**.
  - Typing 30 makes it 120 × 60, and its left edge moves from 10 to 11.547.
  - Changing Sides to 5 moves the left edge to 5.09 and the height to 45.2.
- **Evidence:** REPRO.
  - `zz-l2-fields.test.tsx`: `drag-polygon-field {"radius":"25",…}`, `drag-polygon-radius30 {"worldBox":{"minX":11.547,"maxX":131.547,"minY":10,"maxY":70}}`.
  - `zz-l2-core.test.ts`: `worldAfterSides5 {"minX":5.09,…"maxY":55.23}`.
- **Severity:** P3, polish and parity.
- **Refuter: CONFIRMED, P3.**
  - **Own repro.** Used `shapeFromDrag` polygon (10,10)→(110,60) with the real panel and `emitGcode`.
    - Radius shows "25"; scale is [57.735, 25].
    - Typing `30` changes the G-code box from 100 × 50 at minX 10 to **120 × 60 at minX 11.547**. The toolbar X then reads 11.547.
  - **Why it stays P3, not P1 like L2-P2-1:**
    - The stretched hexagon is what the user drew.
    - After the edit, the Radius readout (30, the smaller axis) agrees with the burn on that axis.
    - The shift shows on the canvas and in toolbar X.
    - No LightBurn contract defines a polygon "radius". LightBurn uses Width and Height.
- **Fix direction:** offer Width and Height for polygons and stars (LightBurn's model), or anchor spec edits at the bounds corner.

### L2-P3-4 — The corner-radius clamp is written into the spec, so narrowing a rectangle and widening it again loses the radius

- **Where:** `src/core/shapes/rematerialize-shape.ts:41`. The geometry already clamps on its own (`rectangle.ts` `clampRadius`).
- **Anchor:** **Twin.** The rectangle geometry clamps at materialization and would keep the authored radius.
- **Scenario:** 50 × 50 at r 20 → Width 10 → r is stored as 5 → Width 50 → r stays 5.
- **Evidence:** REPRO, `zz-l2-fields.test.tsx`: `radius-shrink-restore {"afterWidth10":{…"cornerRadiusMm":5},"afterWidth50":{…"cornerRadiusMm":5}}`.
- **Severity:** P3. Visible, and Undo restores it.
- **Refuter: CONFIRMED, P3.**
  - **Own repro, through the real panel.** 50 × 50 r 20 → Width `10` stores r 5 → Width `50` keeps r 5, and the field shows "5".
  - The readout matches the burn, so P3 stands.
- **Fix direction:** keep the authored radius in the spec and clamp only in geometry and display.

### L2-P3-5 — Numeric-entry twins and quirks: Design Studio's fillet and chamfer boxes ignore units and math silently, Design Studio accepts a decimal comma the main boxes refuse, a unit inside an exponent scales the exponent, and toolbar and shape boxes round a tiny nonzero size to "0"

- **Where:**
  - `src/ui/design-studio/DesignOptionsBar.tsx:61` → `design-field-format.ts:61-70`. `Number()` after stripping only `mm`/`°`/`deg`, so `1/8in` or `3/16"` → null → the commit is dropped with no message.
  - `ShapeInspectorField.tsx:35`: `draft.replace(',', '.')` before `evaluateNumericEntry`, which itself refuses commas (`numeric-expression.ts:161`).
  - `numeric-expression.ts:255-259`: `2^3in` = 2^(76.2) = 8.68e22 mm, accepted as finite.
  - `NumericEditsBar.tsx:413` and `SelectedShapeGeometryFields.tsx:346`: `toFixed(3)` shows `0` for 0.0004 mm. `format-display-millimetres.ts` deliberately never does this.
- **Anchor:**
  - **Twin.** LBG-F12 entry (math and units) in every length box; `numeric-expression.ts` header.
  - **Twin.** `formatDisplayMillimetres` ("never rounding nonzero to 0").
- **Evidence:**
  - REPRO, `zz-l2-core.test.ts` `expr`: `"2^3in" → 8.679e22`; `"1,5" → ERR use a dot for decimals`.
  - READ for the Design Studio boxes and the formatters.
- **Severity:** P3.
- **Refuter: CONFIRMED, P3.**
  - **Own repro.**
    - `evaluateNumericEntry`: `2^3in` = 8.679e22 mm, and `1,5` is refused with "use a dot for decimals, not a comma".
    - Design Studio's `parseFieldNumber`: `1/8in` → null and `3/16"` → null (the commit is dropped with no message), while `1,5` → 1.5.
    - A 0.0004 mm-wide rectangle reads "0" in both the toolbar W and the Inspector Width.
  - **Note.** Both comma policies are deliberate in their own code: the `design-field-format.ts:58-59` comment says it accepts "a comma decimal separator", and `numeric-expression.ts` refuses commas with a reason. The finding is the twin inconsistency, not either policy.
  - The `2^3in` behaviour is commented as deliberate ("A power's units are applied inside it", `numeric-expression.ts:254`). The 8.7e22 mm result is still accepted as finite, which overlaps KNOWN 13-P3-1.
- **Fix direction:**
  - Route the Design Studio option boxes through `evaluateNumericEntry`.
  - Pick one comma policy.
  - Refuse a length unit inside an exponent.
  - Reuse `formatDisplayMillimetres` in the two formatters.

## KNOWN re-observed

- **Rolling v2 08-P3-3 (open, P3): rotated round or irregular artwork is measured by its rotated bounds rectangle.** Re-observed with new evidence, a new sibling and a v7 severity note.
  - **Still on main.** `selectionMetrics` → `combinedBBox` → `transformedBBox` (`core/scene/selection-transform.ts:68-78`, `hit-test.ts:255-293`); `out-of-bounds.ts:12`; `overlays.tsx:165`.
  - **New sibling in L2's scope.** The Shape Inspector note `SelectedShapeGeometryFields.tsx:43-55` states the wrong number as fact: "Rotated footprint on the bed: 70.711 × 70.711 mm" for a Ø50 circle at 45°. The scale-drag readout (`overlays.tsx:165`) uses the same box.
  - **REPRO** (`zz-l2-output.test.ts` `rotated`, `zz-l2-fields.test.tsx` `rotated-note`):

    | shape at 45° | toolbar / note | G-code | after typing W = 50, locked |
    |---|---|---|---|
    | circle Ø50 | 70.711 | 49.994 | toolbar 50, G-code **35.32** |
    | ellipse 80 × 20 | 70.711 | 58.31 | 41.22 |
    | hexagon r 25 | 65.974 | 48.296 | 36.60 |
    | rounded rect 60 × 30 r 15 | 63.64 | 51.208 | 40.20 |

  - **Ground truth** (closes 08's "LightBurn unverified"): LightBurn 1.7 Numeric Edits Toolbar (https://docs.lightburnsoftware.com/1.7/Reference/NumericEditsToolbar/, versioned path, fetched 2026-10-28) defines the selection as "the smallest possible rectangle that can contain every object in your selection".
  - **v7 severity.** Typing W = 50 burns 35.32 mm while every readout says 50. That is v7's P1 example ("the displayed size is not the burned size") with no warning. The canvas outline shows the circle, but no surface names the mismatch. Recommend the coordinator re-rate it P1 for the W/H and X/Y entry; out-of-bed and Move to bed stay as 08 rated them.
  - **Test truth.** `SelectedShapeGeometryFields.test.tsx` "names the rotated footprint…" (9/9 pass) asserts only that the text contains "Rotated footprint", so it would not catch the wrong number.
  - **Refuter: CONFIRMED. Recommend re-rating 08-P3-3 from P3 to P1 for the toolbar's typed W/H and X/Y on rotated non-rectangular artwork.** The ID is kept.
    - **Own repro.** A real `NumericEditsBar` plus `SelectedObjectProperties`; a Ø50 circle at 45°; anchor nw; X/Y measured from `emitGcode` G1 points.
      - **At rest:** toolbar W/H 70.711. The note reads "Rotated footprint on the bed: 70.711 × 70.711 mm. Width and height above are the shape's own, unrotated size — the toolbar shows this footprint." The G-code is 49.994 wide.
      - **W `50` with the aspect unlocked (the default):** refused. The toast reads "Unlocked width/height edits need every selected object turned by a multiple of 90°. Lock the aspect ratio to scale evenly."
      - **After the lock is clicked, W `50`:** scale 0.7071; toolbar W/H 50; the note reads "footprint on the bed: 50 × 50 mm"; the Inspector Ellipse width reads 35.355. The G-code is **35.319 × 35.32**.
      - **Then X `100`:** toolbar X reads 100, but the G-code left edge is **107.34**. The typed position is also not burned.
      - **Hexagon r 25 at 45°:** toolbar 65.974, G-code 48.296.
    - **Does the note disclose that W/H is the rotated box?** No.
      - It promises a *bed footprint*, as did commit `ef2f8677d` (#597), which added it to name "the bed footprint". That is true only for rectangles.
      - For a circle it states a false footprint as fact, and tells the user the toolbar shows that footprint. It reinforces the wrong belief instead of warning.
      - The correct diameter (Inspector Ellipse width 35.355) is labelled as the shape's "own, unrotated size", next to a note saying the bed footprint is 50 × 50.
    - **No ADR chooses loose rotated bounds.** A grep of `DECISIONS.md` and `docs/decisions` for transformedBBox, "rotated bounds" and "footprint" finds only ADR-125's board-fit use.
    - **The registration-jig twin already measures rotated art in its own axes.** `selectionMetricsInFrame` ("A rotated single object therefore reports its local-axis W/H", `selection-transform.ts:80-82`) is used by `RegistrationJigArtworkSizeControls.tsx:98`.
    - **LightBurn, re-fetched.** LightBurn 1.7 Numeric Edits Toolbar (https://docs.lightburnsoftware.com/1.7/Reference/NumericEditsToolbar/, fetched 2026-10-28):
      - "Width and Height display and determine the length of your selection in the X (Width) and Y(Height) dimensions";
      - the selection is "the smallest possible rectangle that can contain every object in your selection".
      - For a Ø50 circle at 45° that rectangle is 50 × 50, so typing W 50 should leave it 50.
      - The page says nothing specific about rotated objects.
    - **Why P1:**
      - v7: "geometry that differs in size, position … from what the user typed or what the app shows … with no warning". Typed W 50 burns 35.32. Typed X 100 burns from 107.34. The toolbar and the note echo 50 / 100 / "50 × 50".
      - METHOD §3: the output is wrong and no warning names the mismatch. The canvas drawing the smaller circle inside the 50 mm frame is not a warning (rolling v3 G6).
      - The refusal toast steers the user onto the path that burns wrong.
      - Reach is ordinary: one click on the lock. Reach cannot lower a reachable P1.
    - **What stays P3:** the false out-of-bed outline (it over-warns, and preflight gates on G-code) and the Move-to-bed gap (visible, and lands inside the bed). The same fix covers both.
- **Rolling v2 13-P3-1 (P3): numeric edits have no ceiling, while Save enforces |coordinate| ≤ 1,000,000 mm.** The Shape Inspector is a sibling: `rematerializeParametricShape` accepts a 5,000,000 mm width (`zz-l2-core.test.ts` `remat-rect … "widthMm":5000000`). Save of that geometry was not run (READ against `project-shape-primitives.ts:49-54`).
  - **Refuter: CONFIRMED** by its own repro. `rematerializeParametricShape` returns spec widthMm 5,000,000 with bounds maxX 5,000,000. The limit is `MAX_PROJECT_COORDINATE_MAGNITUDE_MM = 1_000_000` (`project-shape-primitives.ts:2`). P3 is kept.

## Refuted

The refuter refuted none of the 7 raised findings or the 2 KNOWN re-observations.

Candidates the auditor checked and dropped:

- **Inch re-entry drift.** `NumericEditsBar` commits only edited text (`commitIfEdited`, `:299-301`, and Enter `:347-351`), and re-typing the shown 4-decimal value is idempotent.
  - The bound is ≤ 0.00127 mm absolute per first re-entry, and it does not accumulate.
  - Switching units commits nothing (ADR-629 D4). `NumericEditsBar.inches.test.tsx` passes 6/6.
- **Shape Inspector fields stay in mm under the Inches preference.** ADR-629 D3/D5 places them in a later increment, and the box says `mm`.
- **MCP `add_polyline` rounding as its own finding.** It is disclosed in the tool description. It is folded into L2-P2-2 as a sibling.
- **Design Studio and main canvas circle parity.** Both go through `createEllipse` (`to-scene-object.ts:113`), so the result is identical.
- **Bulged polygon and star bounds against output.** The toolbar is ≤ 0.04 mm above the G-code, because the chords are inscribed at 0.025 mm (`zz-l2-bulge.test.ts`).
- **Raw `sides` > 64 or `innerRadiusRatio` ≥ 1 stored by `createPolygon`/`createStar`.** Every UI and remote path sanitizes or uses fixed defaults; only a hand-made `.lf2` reaches it, and that file carries its own paths. Latent, not raised.
- **Registration box silently clamps < 1 mm (`registration-box.ts:95-96`).** Its callers validate first: the jig editor refuses "must be at least 1 mm" (`registration-jig-set-actions.ts:216-217`), and board capture avoids the clamp (`board-capture/constants.ts:4`).
- **Corner radius above half the side.** It clamps to the maximum and the box shows the clamped value on blur (`rr-type-40 {"field":"25"}`). This is visible and correct.

## Verified clean

- **Rectangles.** Typed, stored and G-code sizes match exactly (3-decimal output) for 50, `1.25in`, 33.333, 0.1, `10/3` and `2*25.4`, on the default (G1) and a GRBL 1.1 arc-on profile (`rect-out`).
- **Polygons and stars.** Vertices match the analytic values exactly. The first vertex points up, with clockwise order on screen (y-down). Sides clamp to 3–64 and the star inset to 5–95%, both shown on blur.
- **Expressions.** `10/3` is stored at full precision and shown 3.333. `2*25.4` = 50.8, `1/2in` = 12.7, `3/4"` = 19.05, `1in+2mm` = 27.4, and `10mm/2` = 5. Empty, `abc`, `1/0`, `1e400`, `1,5`, `1 1/2`, `5deg` in a length box and `%` outside W/H are all refused with a reason, and the value is kept (`expr`; `numeric-expression.test.ts` 19/19).
- **9-dot anchor and aspect lock.** Resize keeps the anchor within 1.6e-14 mm over 20 alternating W/H edits at 0/90/180/270°, and typed X/Y land exactly on the anchor (`zz-l2-anchor.test.ts`). The lock is off by default, matching LightBurn's independent W/H.
- **`.lf2` round trip** of a rect with `10/3` width and `1/7` radius, an ellipse 31.75 × 0.1, and a bulged heptagon: spec, bounds, transform and curves are identical, and the G-code is byte-identical (`lf2`).
- **Compile uses the canonical curves,** not the 8-segment rounded-rect or 0.05 mm ellipse compatibility polylines (`compilation-polylines.ts:20-33`). The compatibility polyline sag (0.24 mm at r 50) therefore never reaches the output.
- **Remote and MCP shapes.** `add_rectangle` and `add_ellipse` use `createRectangle`/`createEllipse` with `xMm`/`yMm` as the top-left corner, as the tool description says (`tool-info.ts:75-84`).
- **Design Studio rect, circle and ellipse** cross into the scene as the same parametric specs (`to-scene-object.ts:84-121`).
- **Existing tests run on main's tree, one at a time:**
  - `ellipse-curve.test.ts` 2/2;
  - `ellipse.test.ts` 3/3;
  - `numeric-expression.test.ts` 19/19;
  - `create-polyline.test.ts` 6/6;
  - `rematerialize-shape.test.ts` 2/2;
  - `SelectedShapeGeometryFields.test.tsx` 9/9;
  - `NumericEditsBar.inches.test.tsx` 6/6;
  - `pen-tool.test.ts` 15/15.

## Test truth (L7)

- **Pinned:**
  - parametric rematerialization and clamps (`rematerialize-shape.test.ts`);
  - the drag box for every primitive (`shape-from-drag.test.ts`);
  - Inspector bed-mm display after a scale and stale-draft safety (`SelectedShapeGeometryFields.test.tsx`);
  - inch entry and no-commit-on-untouched (`NumericEditsBar.inches.test.tsx`);
  - pen rounding as intended behaviour (`create-polyline.test.ts:69-87`, which a fix for L2-P2-2 must change).
- **Not pinned:**
  - the canonical curve's radial accuracy (L2-P3-1);
  - the corner radius under a non-uniform scale (L2-P2-1);
  - the footprint note's number (08-P3-3);
  - the Inspector's handling of `0` and negatives (L2-P3-2);
  - the plain-click versus dragged-node twin (L2-P2-2).

## Not verified

- **Canvas pixels** (real browser) and the rulers' Y direction against the toolbar's Y. Those belong to L8, as does the drag readout's mm-only label, which is permitted by ADR-629.
- **Rotation pivot.** LightBurn 1.7 says "The chosen location in the 9-Dot Control determines the center of rotation". KerfDesk rotates about the centre by decision (commit `1326b05b1`, `selection-transform.ts:45-48`). Handed to L4.
- ~~**LightBurn's handling of a non-uniformly scaled rounded rectangle**~~. **Resolved by the refuter.** LightBurn 1.7 Primary Shapes says the corner radius "remains consistent even if the dimensions of the rectangle are later changed" (see L2-P2-1).
- **CNC output** of shapes (the CNC arc emitter, ADR-260). Only laser G1 and laser arc output were compiled.
- **Hardware:** none used.

## Repro files

All were created in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\j7-main\` and deleted after the run, one file at a time. No repo file other than this report was touched.

| File (under `j7-main\`) | What it did |
|---|---|
| `src\core\shapes\zz-l2-core.test.ts` | Typed → stored rect; circle, ellipse and rounded-rect radial error; polygon and star vertices and adversarial specs; rematerialize adversarial; drag-polygon Inspector maths; pen fairing deviation; expression battery |
| `src\io\gcode\zz-l2-output.test.ts` | G-code twins: rects, circles (G1 and arcs), rounded rect after a non-uniform resize, rotated shapes against the toolbar and typed W, `.lf2` round trip, pen house |
| `src\io\gcode\zz-l2-bulge.test.ts` | Bulged polygon and star toolbar bounds against G-code |
| `src\core\shapes\zz-l2-anchor.test.ts` | 9-dot resize anchor drift and position exactness at 0/90/180/270° |
| `src\ui\layers\zz-l2-fields.test.tsx` | Real Shape Inspector: corner radius after a toolbar resize, width entries (0/neg/tiny/expr), radius clamp loss, rotated footprint note, drag-polygon radius |
| `src\ui\workspace\zz-l2-pen.test.ts` | Real `finishPen`: plain clicks against one dragged node |
| `zz-l2-vitest.config.ts` | The repo's vitest config plus an `fflate` alias to `.pnpm` (the junction lacks the top-level link) |
| `src\ui\layers\zz-l2r-ui.test.tsx` (refuter) | Real toolbar plus Inspector: rotated circle and hexagon W/X with lock on and off, against G-code; rounded-rect corner after a toolbar resize and in the drag → W/H → radius flow; `1.25in` × 33.333 G-code |
| `src\ui\layers\zz-l2r-more.test.tsx` (refuter) | Real `finishPen` house, plain and with one node dragged; Inspector 0/−5, radius clamp loss, drag-polygon radius; entry quirks; radial-error constant; Ø400 G-code |
| `src\core\shapes\zz-l2r-ceiling.test.ts` (refuter) | 13-P3-1 sibling: 5,000,000 mm width |
| `zz-l2r-vitest.config.ts` (refuter) | Same `fflate` alias, `maxWorkers: 1` |

The refuter deleted its files one at a time after the runs. Nothing under the `node_modules` junction was deleted. Vitest itself may have refreshed its results cache there.

```json
[
  {"id":"L2-P2-1","severity":"P1","area":"shapes-dimensions","file":"src/ui/layers/SelectedShapeGeometryFields.tsx","line":117,"anchor":"Twin: Corner radius field (min of scaleX/scaleY) vs compiled corner of the same object; Contract: fields report bed mm (SelectedShapeGeometryFields.tsx:70-71, PR #451); Ground truth (refuter): LightBurn 1.7 Primary Shapes corner radius 'remains consistent even if the dimensions of the rectangle are later changed'; Twin: ADR-272 Amd 4 item 3 keeps Design Studio corners circular","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real NumericEditsBar + SelectedObjectProperties and emitGcode: 100x50 r10 -> W 200 field 10, G-code corner 20x10; radius 6 -> 12x6; drag 40x20 -> W 200, H 50 -> radius 5 -> 10x5. ADR-144 Consequences accepts transform scale but decides no corner readout. Re-rated P2 -> P1 (v7 design P1: typed radius not burned, field echoes it, canvas is not a warning per METHOD 3 G6); ID kept","known":false,"summary":"After a toolbar W/H resize (100x50 r10 -> W 200, scale 2,1) the corners are elliptical 20x10 mm in G-code while Corner radius shows 10; typing 6 burns 12x6; a circular corner can no longer be made on that shape"},
  {"id":"L2-P2-2","severity":"P2","area":"shapes-dimensions","file":"src/ui/workspace/pen-tool.ts","line":234,"anchor":"Ground truth: LightBurn 1.7 Draw Lines 'Placing corner nodes and creating lines is the default behavior'; Twin: pen-curve.ts:1-5 (plain vertices stay straight) and to-scene-object.ts:18-23 (createPolyline fairing bends specified geometry); Contract: PROJECT.md:28 copies LightBurn UX; no ADR; Twin (refuter): help-topics.ts:121-125 tooltip 'Draw connected line segments' and draw-pen-preview.ts:30-31 'as it will be drawn: straight between corner clicks'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real finishPen + emitGcode: plain house 10 cubics, toolbar 102.535x100.298, G-code 102.515x100.296, max 1.51 mm off clicked edges; one dragged node -> lines, 100x100. ADR-214 only version-stamps fairing; no ADR decides plain clicks lose corners. P2 kept: finished shape, toolbar and burn agree, no typed value contradicted (v7 P2 'wrong result on screen')","known":false,"summary":"Plain click-by-click pen paths with >=4 open / >=5 closed points are refitted as cubics with no corners (round-polyline-curve.ts:16): a 5-click 100x100 house reads W 102.535 x 100.298 and bows up to 1.51 mm off the clicked walls; with any one node dragged the same clicks stay straight (100 x 100). MCP/phone add_polyline shares it (disclosed in the tool text)"},
  {"id":"L2-P3-1","severity":"P3","area":"shapes-dimensions","file":"src/core/geometry/ellipse-curve.ts","line":41,"anchor":"Ground truth: analytic circle/ellipse; Twin: bulge-outline.ts:3-5 exact elliptical-arc segments, to-scene-object.ts:12-15 'exact'; Contract: ADR-432 D1 0.025 mm machine tolerance","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: sampled ellipseToCurve max radial error 2.7253e-4 r at d 50/184/400/1000 (known k=4/3 tan(pi/8) constant); G-code d400 +0.0546/-0.0005. Correction: worst near 19.4/70.6 deg per quarter, not 22.5; 45 deg midpoints exact. to-scene-object 'exact' refers to the spec carrier and ADR-432 measures against the source curve, so the anchor is ground truth only. P3 kept","known":false,"summary":"Circles, ellipses and rounded corners are four quarter-turn cubics: radial error +2.7253e-4 r, over 0.025 mm from 184 mm diameter; 400 mm circle burns +0.0546 mm (G1) / +0.0612 mm (arcs, radii 199.41-200.97); 1000 mm +0.136 mm; no test measures it"},
  {"id":"L2-P3-2","severity":"P3","area":"shapes-dimensions","file":"src/ui/layers/SelectedShapeGeometryFields.tsx","line":349,"anchor":"Twin: NumericEditsBar refuses W/H <= 0 ('Width and height must be greater than 0', selection-transform.ts:220-222)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real panel: 0 and -5 store 0.01, one undo step each, box '0.01', aria-invalid false, toolbar W 0.01. P3 kept","known":false,"summary":"Shape Inspector size fields clamp typed 0, -5, 0.001 and 1e-400 to 0.01 mm with an undo step and no error, turning a 40 mm rectangle into a 0.01 mm sliver; the toolbar refuses the same entry"},
  {"id":"L2-P3-3","severity":"P3","area":"shapes-dimensions","file":"src/core/shapes/shape-from-drag.ts","line":111,"anchor":"Ground truth: LightBurn 1.7 Shape Properties polygon Width/Height/Sides; Twin: rect/ellipse spec edits keep the top-left fixed","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: shapeFromDrag hexagon 100x50 shows Radius 25 (scale 57.735,25); 30 -> G-code 120x60, minX 10 -> 11.547, toolbar X 11.547. P3 kept: stretch is what the user drew, readout matches the burn on its axis","known":false,"summary":"A drag-drawn 100x50 hexagon shows Radius 25 (smaller axis of scale 57.7,25); typing 30 makes it 120x60 and moves its left edge 10 -> 11.547; Sides 5 moves it to 5.09 (growth about the circumscribed-square corner)"},
  {"id":"L2-P3-4","severity":"P3","area":"shapes-dimensions","file":"src/core/shapes/rematerialize-shape.ts","line":41,"anchor":"Twin: rectangle geometry already clamps at materialization (clampRadius)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real panel: 50x50 r20 -> width 10 stores r5 -> width 50 keeps r5, field 5. P3 kept","known":false,"summary":"The corner-radius clamp is stored: 50x50 r20 -> width 10 stores r5 -> width 50 keeps r5"},
  {"id":"L2-P3-5","severity":"P3","area":"shapes-dimensions","file":"src/ui/design-studio/DesignOptionsBar.tsx","line":61,"anchor":"Twin: LBG-F12 math/units in every length box (numeric-expression.ts); formatDisplayMillimetres never rounds nonzero to 0","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: 2^3in = 8.679e22 mm; main refuses '1,5'; Design Studio parseFieldNumber '1/8in' and '3/16\"' -> null (dropped silently), '1,5' -> 1.5; 0.0004 mm width reads '0' in toolbar and Inspector. Both comma policies are deliberate in their own code; the finding is the twin inconsistency. P3 kept","known":false,"summary":"Design Studio fillet/chamfer boxes use Number() and silently drop 1/8in or 3/16\"; Design Studio ShapeInspectorField accepts '1,5' that main boxes refuse; '2^3in' evaluates 8.68e22 mm (unit scales the exponent, REPRO); toolbar and shape formatters show 0 for 0.0004 mm"},
  {"id":"08-P3-3","severity":"P1 (refuter recommends re-rating from P3 for typed W/H/X/Y; out-of-bed outline and Move to bed stay P3)","area":"shapes-dimensions","file":"src/core/scene/selection-transform.ts","line":69,"anchor":"Ground truth: LightBurn 1.7 Numeric Edits 'the smallest possible rectangle that can contain every object in your selection'; Twin: Shape Inspector note and toolbar vs G-code extents; Ground truth re-fetched: LightBurn 1.7 Numeric Edits 'Width and Height display and determine the length of your selection in the X (Width) and Y(Height) dimensions'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real NumericEditsBar + SelectedObjectProperties and emitGcode: circle 50 at 45 deg toolbar 70.711, note 'footprint 70.711 x 70.711', G-code 49.994; unlocked W 50 refused with toast advising lock; locked W 50 -> toolbar 50, note 50x50, Inspector Ellipse width 35.355, G-code 35.32; X 100 -> G-code left edge 107.34; hexagon 65.974 vs 48.296. Note promises a bed footprint (commit ef2f8677d) and states a false one; no ADR chooses loose bounds. Recommend P1 under v7 design P1 and METHOD 3","known":"rolling v2 08-P3-3 (open); new sibling SelectedShapeGeometryFields.tsx:43-55 note","summary":"Rotated round/irregular shapes use the rotated bounds rectangle: circle 50 at 45 deg reads W 70.711 and the Inspector note says 'Rotated footprint on the bed: 70.711 x 70.711 mm' while G-code is 49.994; typing W 50 (locked) burns 35.32 mm (hexagon 36.60, rrect 40.20); v7 design severity reads this as P1"},
  {"id":"13-P3-1","severity":"P3","area":"shapes-dimensions","file":"src/core/shapes/rematerialize-shape.ts","line":34,"anchor":"Twin: project loader coordinate limit 1,000,000 mm vs unbounded edits","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: rematerializeParametricShape returns widthMm 5,000,000 (bounds maxX 5,000,000) vs MAX_PROJECT_COORDINATE_MAGNITUDE_MM 1,000,000. P3 kept","known":"rolling v2 13-P3-1 (Shape Inspector sibling)","summary":"rematerializeParametricShape accepts a 5,000,000 mm width; Save would refuse the geometry (not run)"}
]
```
