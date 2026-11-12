# O10 `sketch-and-design-carve` — Oracle audit O1, batch 4

**Area:** `src/core/sketch-constraints/` (the constrained-sketch solver, parameters, scaling and materialisation), `src/core/shapes/` (rectangle, ellipse, polygon, star, bulge, drag sizing, rematerialise and resize), `src/core/design-carve/` (the Design Studio instant carve preview), and the UI paths that apply them: `src/ui/layers/Sketch*.tsx`, `ConstrainedSketchDialog.tsx`, `SelectedShapeGeometryFields.tsx`, `src/ui/state/constrained-sketch-actions.ts`, `src/ui/design-studio/preview3d/`.
**Read at:** `origin/main` 5c351a6b3 (2026-11-12). Method, severity and rules: [AREAS.md](AREAS.md).
**Fix PR:** [#1812](https://github.com/cisgz3a-hub/KerfDesk/pull/1812): O10-P3-1, O10-P3-3, O10-P3-5 and O10-P3-6. No toolpath changes.

## Headline

**The sketch solver does what a constraint solver should, measured against outside oracles.**

| Check | Result |
|---|---|
| Typed dimensions | Met within 1e-6 mm on every sketch tried, across 770 sketches between auditor and refuter |
| Solving the solved sketch again | Moves nothing (drift 0) |
| DOF count | Equals 2·points + circles − rank. The rank was computed independently (auditor: Jacobi eigenvalues of a hand-written Jacobian; refuter: its own Jacobian and SVD), 370/370 agreement |
| Inconsistent dimensions (+5e-5 to 5 mm) | Reported as over-constrained 1,000/1,000 times, naming the right constraint, and never applied |
| Redundant but consistent constraints | Counted as redundant, not called a conflict |

This matches what FreeCAD Sketcher, SolveSpace and Onshape document: conflicts are shown and never solved into a compromise, and "fully constrained" means 0 DOF.

**Shapes are exact.**
- Rectangle bounds are exact.
- Polygon vertices sit on the circumradius to 1e-14, with side 2R·sin(π/n).
- Star radii and bulge sagittas match closed form.
- The ellipse cubic error is the published 2.73e-4 of the radius.

**The carve preview's distance transform overstates distance by up to 8.2%; its comment said ~4%.**

There is **no P1 and no P2**. Six P3s:
- The two that matter most are both silent degenerate results, each the kind of thing the area question asks about:
  - A line marked both horizontal and vertical solves "fully constrained" into a **point**, so a rectangle becomes a triangle with no warning (O10-P3-1, fixed).
  - An **inward bulge** makes polygon and star sides cross from as little as −15% to −30%. On a −100% triangle, the default even-odd Fill leaves the centre unburned (O10-P3-2, listed: a clamp would move toolpaths).
- Three more P3s are fixed in #1812; one more is listed.
- Three candidates were already known to earlier audits.
- One research verdict contradicted an oracle-plan assumption about LightBurn's polygon tool.

| Raised | Refuted (known or intended) | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 9 (7 auditor, 2 refuter) | 3 | 2 (R9; R10 in part) | 0 | 0 | 6 (4 fixed, 2 listed) |

## Oracle plan

This plan was written before the code was read closely, from the file list only. It is kept as written.

| # | Claim | Oracle |
|---|---|---|
| S1–S3 | Solved distance, angle, horizontal and vertical, radius or diameter, concentric, tangent, equal and symmetric constraints equal the typed value | geometry by hand |
| S4 | solve(solve(x)) == solve(x) | property |
| S5 | A fully constrained sketch has one solution up to tolerance; DOF = unknowns − rank(J) | linear algebra (independent rank) |
| S6 | Conflicting dimensions fail loudly, with no silent compromise geometry | FreeCAD Sketcher, SolveSpace docs |
| S7 | Redundant consistent constraints are solved and reported as redundant, not as a conflict | FreeCAD, SolveSpace |
| S8 | Under-constrained sketches report DOF > 0 | FreeCAD, SolveSpace |
| S9 | Degenerate catalogue: zero-length lines, coincident points, distance 0, negative or NaN values, impossible triangles: loud, no NaN | IEEE 754; loud-failure rule |
| S10 | Scaling a sketch scales every length constraint and keeps ratios | similarity property |
| S11 | Materialised paths keep the solved geometry | geometry by hand |
| H1–H8 | Rectangle bbox and corner radius (clamped); n-gon circumradius and side; star radii; ellipse bbox and Bézier error ≈ 0.027%; drag box; rematerialise idempotent; fillet; registration box | closed form; Bézier literature; LightBurn docs |
| D1–D5 | Exact Euclidean distance transform; V-carve depth law; grid maps back to mm with no half-cell shift; disc stamp radius; no NaN on degenerate masks | Felzenszwalb & Huttenlocher 2012; closed form |

**What the code turned out to cover.** The solver supports only `x`, `y`, `coincident`, `horizontal`, `vertical`, `distance`, `equal` (line length) and `diameter`. The angle, tangent, concentric and symmetric claims (S2, S3) have no code to test. Concentric can be expressed as `coincident` centres, which was tested.

## Method as run

- **Auditor (this session).** Scratch Vitest probes ran on the real modules (deleted afterwards). Each check is listed with what it was compared against:
  - **Solver:** a rectangle from a skewed start; conflict, redundant and degenerate catalogues; a 3-4-5 triangle from collinear and 400 random starts at scales 1e-3 to 1e3; a 30-gon distance chain; scale ∘ solve vs solve ∘ scale with a parameter expression. The DOF was compared with Jacobi-eigenvalue rank of a hand-written Jacobian.
  - **Shapes:** went through `compilationPolylines` at 0.0005 mm, the same flattening the output uses. They were compared with closed-form geometry.
  - **Carve:** compared with a brute-force Euclidean distance and with area counts.
- **Refuter (fresh subagent).** It used different generators: rigid quads with diagonals, circle sketches with parameter expressions, under-constrained variants, and its own Jacobian and SVD rank, 370 sketches in all. It also used half-plane masks for the chamfer and a segment-crossing sweep for bulge. It compared even-odd with nonzero Fill on a crossing outline and searched earlier audits and ADRs for each candidate.
- **Research verifier (fresh subagent, web).** It checked 10 outside claims against primary sources:
  - FreeCAD: its wiki export repository and source;
  - SolveSpace: its reference pages and source;
  - Onshape: its help pages;
  - LightBurn: the 2.2 and 2.1 docs at docs.lightburnsoftware.com;
  - Riškus (ITC 2006);
  - Felzenszwalb & Huttenlocher (Theory of Computing 8, 2012).
- **Owner re-check.** There is no P1 or P2. The session re-read O10-P3-1 and O10-P3-2 in `src/core/sketch-constraints/sketch-constraint-jacobian.ts`, `sketch-solve-summary.ts`, `src/core/shapes/primitives/bulge-outline.ts` and `src/ui/layers/SelectedShapeGeometryFields.tsx` at 5c351a6b3.

## Research verdicts

| # | Claim | Verdict | Source |
|---|---|---|---|
| R1 | FreeCAD tells redundant from conflicting constraints and never applies a compromise | **VERIFIED** (no-compromise part from source) | FreeCAD wiki *Sketcher_Dialog*, "Solver messages"; `SketchObject::solve` writes geometry back only on `Success` |
| R2 | FreeCAD reports DOF; "fully constrained" only at 0 | **VERIFIED** | same; `FullyConstrained.setValue(lastDoF == 0)` |
| R3 | SolveSpace fails a solve, lists the problem constraints, flags redundancy, shows DOF | **VERIFIED** | solvespace.com/ref.pl; `src/textscreens.cpp` ("SOLVE FAILED! redundant constraints", "allow redundant constraints") |
| R4 | Onshape: over-defined red, fully defined black, under-defined blue | **VERIFIED** | cad.onshape.com/help, *colors* page: "Red means a constraint problem (overconstrained)." |
| R5 | Typed dimensions are met to solver precision | **VERIFIED** (source) | FreeCAD planegcs `convergence(1e-10)`, success at squared error ≤ 1e-20; SolveSpace `LENGTH_EPS`/100 = 1e-8 per equation. KerfDesk accepts 1e-5 mm per equation and stops at 1e-6 |
| R6a | LightBurn clamps a rectangle corner radius | **UNSOURCED** | 2.2 *ShapeProperties* says nothing about a clamp |
| R6b | LightBurn sizes a polygon by its box | **VERIFIED** (box); circumcircle UNSOURCED | 2.2 *ShapeProperties*, "Polygons" (Width, Height, Sides) |
| R7 | Cubic quarter-arc k = 0.5523, error ≈ 0.027% | **VERIFIED** | Riškus, ITC 35(4) 2006, §3: error "varies from 1.96·10-4 to 2.73·10-4" |
| R8 | Felzenszwalb–Huttenlocher gives the exact squared EDT in linear time | **VERIFIED** | Theory of Computing 8 (2012) 415–428, Theorem 2.1 |
| R9 | A LightBurn polygon drag is always regular, with a Radius field | **CONTRADICTED** | 2.2 *PrimaryShapes*, "Shape Creation": Shift makes it regular, Ctrl draws from the centre; Shape Properties has no Radius |
| R10 | LightBurn polygon and star bulge range | **CONTRADICTED** in part | 2.2 *PrimaryShapes*, "Points, Bulge, and Ratio — Stars Only": "Accepted values range from 0 to 1." Nothing about crossing or clamping (UNSOURCED) |

## Findings

### O10-P3-1 — A line marked horizontal and vertical solves "fully constrained" into a point, with no warning (fixed)

**Where:** `src/core/sketch-constraints/sketch-constraint-jacobian.ts` and `sketch-solve-summary.ts`. Horizontal plus vertical on one line has an exact solution, a point. The residual is then 0, so the summary cannot call it a conflict. `SketchSolveReview.tsx` had no degenerate-geometry check.

**Reproductions:**
- **Auditor:** a line with `horizontal` + `vertical` gives under-constrained, DOF 2, a zero-length line. `equal` to a line from a point to itself shrinks the other line to a point.
- **Refuter:** a 60 × 30 rectangle with the bottom line marked vertical by mistake (H + V on `bottom`, H `top`, V `left`, origin, left length 30, diagonal 67.082).
  - The solver reports **fully-constrained, DOF 0** with `b` = `a` = (0, 0). The outline burns as the triangle (0,0)–(60,30)–(0,30).
  - The review reads "Size 60.000 × 30.000 mm". Only the small preview shows the triangle.

**Oracle:** the area question ("fail loudly … when degenerate"), and the loud-failure behaviour of FreeCAD and SolveSpace (R1, R3). No primary source covers a constraint set that collapses an edge, so the finding is capped at P2. It is P3 because the preview does show the triangle.

**Refuter:** CONFIRMED and stronger (the fully-constrained case above).

**Fix (#1812):** `sketchCollapsedLines` lists every line whose ends meet within `SKETCH_SOLVE_TOLERANCE_MM`. The review shows a `role="alert"` line for each: "Line bottom has no length after solving. Check its horizontal, vertical and equal relations." The solve is unchanged. Two tests fail on `origin/main`.

### O10-P3-2 — An inward bulge makes polygon and star sides cross, with no clamp or warning (listed)

**Where:** `src/core/shapes/primitives/bulge-outline.ts`. `clampBulge` allows [−1, 1], and `BulgeField` in `SelectedShapeGeometryFields.tsx` offers −100% to 100% on polygons and stars.

**Reproduction:**
- **Auditor:** R 25. A triangle at b = −1 has inward semicircles that reach 9.15 mm past the centre, so the sides cross. A square at −1 pinches to a point at the centre.
- **Refuter:** a segment-crossing sweep found where crossing starts:

  | Shape | Crossing starts at |
  |---|---|
  | Triangle | −30% |
  | Square | −45% |
  | Pentagon | −55% |
  | Hexagon | −65% |
  | 12-gon | −85% |
  | Star, 3–5 points (ratio 0.5) | −30% |
  | Star, 12 points (ratio 0.5) | −15% |

  - **Analytic bound:** adjacent arcs cross when |b| > tan(interior angle / 4), which gives 0.268, 0.414, 0.577 and 0.767 for n = 3, 4, 6 and 12.
  - **Fill:** on a triangle at b = −1, even-odd Fill (the default) burns 735 mm² and nonzero burns 1,064 mm², so the centre (winding −2) is left unburned.

**Oracle:** geometry (simple closed outline), plus LightBurn 2.2, which documents bulge for **stars only, 0 to 1** (R10). The negative range on polygons came in with commit 8ae4e6e6a ("LightBurn parity D017"), and no ADR covers it.

**Severity: P3.** The canvas strokes the same paths, so the loops are visible before a burn. It is a KerfDesk extension, not a broken vendor contract.

**Refuter:** CONFIRMED and stronger.

**Not fixed here:** clamping inward bulge to the non-crossing limit would reshape existing designs, which moves toolpaths. It is listed for the maintainer.

### O10-P3-3 — The carve distance transform overstates distance by up to 8.2%; its comment said ~4% (fixed: comment; exact EDT listed)

**Where:** `src/core/design-carve/distance-transform.ts`, a two-pass (1, √2) chamfer.

**Reproduction:**
- **Auditor:** brute-force Euclidean distance on 80 × 80 masks; worst ratio **1.0824**.
- **Refuter:** half-plane masks with the half-cell bias from `layer-surface.ts`. The worst is 1.0733 at 22.5°, rising toward 1.0824 at large distance.
  - A 6 mm stroke at 22.5° previews a centre distance of 3.199 mm against 3.000 (+6.6%); at 0° it is −1.7%.

**Oracle:** mathematical property. The chamfer ball is an octagon, so the error is 1/cos 22.5° = √(4 − 2√2) ≈ 1.0824. An exact alternative exists (Felzenszwalb & Huttenlocher 2012, R8, VERIFIED).

**Severity: P3.** Only `applyVCarve` (the Design Studio preview) calls it; G-code does not. The preview can still show a V-groove up to about 8% deeper than the cut, while `layer-surface.ts` says the preview and the G-code "cannot disagree about shape".

**Refuter:** CONFIRMED (math); about 7.3% in practice.

**Fix (#1812):** the comment states the real bound. A test pins it against a brute-force distance and checks that it is exact on axes and diagonals. Switching to an exact EDT changes the preview, so it is listed for the maintainer.

### O10-P3-4 — A dimension typed as `50mm` or `50,5` gets a generic "Malformed or over-budget 2D sketch." (listed)

**Where:** `sketchConstraintValue` treats any non-number as a parameter name, and the zod id regex then rejects it in `sketch-validation.ts`.

**Reproduction:** set a distance value to `50mm` → `{ parameter: '50mm' }` → "Malformed or over-budget 2D sketch."

**Oracle:** loud and *specific* failure; the O8 locale rules (decimal comma).

**Severity: P3.** It is loud but does not say which box or why.

**Not fixed here:** a better message needs a choice about whether to accept a unit suffix. Listed.

### O10-P3-5 — The polygon and star tool tooltips did not mention Shift or Ctrl (fixed)

**Where:** `src/ui/help/help-topics.ts`. The rectangle and ellipse tooltips name Shift and Ctrl; the polygon and star ones did not.

**Context:** a plain drag stretches a polygon to fill the box, so even a 50 × 50 drag burns a non-regular hexagon, with sides of 27.95 and 25 mm. LightBurn 2.2 does the same, and Shift makes it regular (R9). The in-app tutorial says so (`drawing-tutorials.ts`); the tooltip did not.

**Fix (#1812):** the tooltips name Shift (equal sides or points) and Ctrl (from the centre). The test fails on `origin/main`.

### O10-P3-6 — Sketch dimension boxes read hexadecimal: `0x10` became 16 mm (fixed)

**Where:** `sketchConstraintValue` (`src/ui/layers/sketch-constraint-draft.ts`), `SketchParameterEditor.tsx` and the primitive composer in `SketchGeometryEditor.tsx` used `Number(text)`.

**Reproduction:** `0x10` → 16, `0b101` → 5, `0o17` → 15.

**Oracle:** the ECMAScript `StringToNumber` grammar, which accepts `0x`, `0b` and `0o` prefixes.

**Refuter:** CONFIRMED. The initial-point boxes are `type="number"` and were not affected.

**Fix (#1812):** these boxes use the shared `parseEnglishDecimalInput`. One side effect: exponent text such as `1e3` is no longer read as a number. The test fails on `origin/main`.

## Refuted

- **Cubic circle and ellipse error passes the 0.025 mm machine tolerance above r ≈ 92 mm.** Measured: 2.725e-4 × r, so 0.041 mm at r 150. This is already rolling v7 L2-P3-1 and is written into ADR-159 Amendment 2, which defers the 45° split as a separate decision. *Known.*
- **A plain polygon or star drag gives a stretched, non-regular shape, and Radius shows the shorter axis.** The stretch is intended (test "fills the visual drag box for a polygon") and matches LightBurn 2.2 (R9 CONTRADICTED the plan's assumption). The Radius readout is rolling v7 L2-P3-3, still open. *Intended, and known.* The tooltip gap is O10-P3-5.
- **A tangent-type solution reads "fully constrained" while the point lands a few hundredths of a mm off.** For example, x = 0 plus a distance D to (D, 0), or a hole set by two equal distances D from two fixed holes:
  - p.y depends on the start, up to 0.038 mm (auditor) or 0.035 mm (refuter) at D = 500;
  - the expected offset is about √(2·D·residual).

  It is stable: Apply stores the solved sketch, and re-solving moves nothing. Rolling v7 L5 measured the same effect (3.8 µm) and accepted it as within the 1e-5 tolerance, and ADR-573 promises no tighter uniqueness. *Known and accepted.* For the maintainer: FreeCAD stops at a squared error of 1e-20 (R5). Iterating past the residual test would shrink this to nanometres, but it would also move every solved sketch slightly.

## Verified clean

**Solver**
- **S1, S4, S5:** a rectangle by distances from a skewed start gives 50.00000038 × 30.00000013, DOF 0, rank 8 by an independent method. Re-solving moves nothing.
  - 400/400 random 3-4-5 triangle starts and a collinear start give fully-constrained.
  - The refuter's 370 sketches: worst residual 9.8e-7 mm, DOF agreement 370/370.
- **S6:** a conflict (x b = 40 against distance 50) is reported over-constrained with `ax`, `bx` and `w` named. Materialise refuses it, and the UI says "Conflicting dimensions remain". Injected inconsistencies were reported 1,000/1,000 times.
- **S7:** redundant consistent constraints solve fully-constrained with 1 redundant equation; the default bracket has 3.
- **S8:** a 30-gon distance chain is under-constrained with DOF 28 (60 − 32 exactly) and side error 1.9e-8.
- **S9:** distance 0, a negative distance or diameter 0 are refused ("needs a positive dimension").
  - A distance from a point to itself, coincident + distance, H + V + length, and a 1-1-5 triangle are all over-constrained.
  - No NaN reaches the output, because the schema refuses non-finite values.
  - Conflicts under 2e-5 mm are absorbed by the documented 1e-5 tolerance.
- **S10:** scale(solve(x)) equals solve(scale(x)) for factors 2, 0.37 and 1.1, including the expression `width/4 - 1.5e0mm + (2mm)*0.5` (max error 7e-15).
- **S11:** circles materialise as exact elliptical-arc pairs; profile closing edges are explicit.

**Shapes**
- **H1:** the rectangle bbox is exact. Rounded corners are within r × 2.7e-4 + flattening, and the radius clamps to min(w, h)/2 in the outline (ADR-144 Amd 1).
- **H2:** polygon vertices are on the circumradius (1e-14) with side 2R·sin(π/n). The bulge sagitta equals b·chord/2, and bounds match the flattened outline.
- **H3:** star outer, inner and alternate radii are exact.
- **H4:** the ellipse bbox is exact; the cubic error is 2.725e-4 relative (R7 VERIFIED).
- **H5:** rectangle and ellipse drag boxes are exact (60 × 40, Shift 60 × 60, Ctrl 120 × 80).
- **H6:** a rounded rectangle resized W × 2 becomes spec 200 × 50 r 10 at scale 1 (ADR-144 Amd 1).

**Carve**
- **D2–D4:** the disc mask area is 314.40 against 314.16, and a disc stamp of r 3 covers 28.31 against 28.27 mm².
- The V-carve recentres the chamfer's half-cell bias.
- `carveGrid` rounds the stock to whole cells (a 10 mm square at 0.3 mm cells reads 9.9 mm), which is fine for a preview.

## Not verified

- **R6a**, whether LightBurn clamps an over-large corner radius, has no primary source. KerfDesk clamps in the outline and keeps the typed value.
- Whether LightBurn draws polygons by circumcircle is known only from a forum post, which is not a primary source.
- The kerf offset of a self-crossing bulged outline (O10-P3-2) was not run.

## For the maintainer

1. **O10-P3-2:** clamp inward bulge to |b| < tan(interior angle / 4), or limit polygons to LightBurn's star-only 0–1 range. Either moves existing toolpaths.
2. **O10-P3-3:** replace the chamfer with an exact EDT in the carve preview. This changes the preview only.
3. **O10-P3-4:** accept a `mm` suffix, or name the box, in the sketch dimension error.
4. **Known, from Refuted:** the 45° split for large circles (ADR-159 Amd 2); the polygon Radius readout (v7 L2-P3-3); tighter solver convergence for tangent-type solutions.
