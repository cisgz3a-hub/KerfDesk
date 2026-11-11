# O4 — nesting-box-geometry (Oracle audit O1, batch 2)

**Audited:** `origin/main` at `5c9441ba8` (2026-11-12). **Scope:** `src/core/nesting/`, `src/core/box/`, `src/core/parts/`, and the UI paths that apply their results (`src/ui/state/nest-actions.ts`, `nest-outline.ts`, `box-insert-mutation.ts`, `src/ui/box/BoxFitTestDialog.tsx`, `box-draft.ts`, the part-generator rescale path).

## Headline

The geometry is sound. Independent checks found no overlap, no lost part and no badly assembled box:

- **Nesting.** Over 300 random and adversarial layouts, no two nested parts overlapped, every gap was at least the requested spacing, every part stayed inside the sheet, and nothing was dropped without being reported.
- **Boxes.** Every generated box assembled with no gap and no double material, and its outer size matched what was typed. This held for 398 random boxes (closed, open-top and open-front, with and without dividers) and 120 slide-lid and lift-off-lid boxes.
- **Parts.** All 2,451 valid random part definitions came out at exactly the typed size.

There is one P2, in the Box Fit Test. KerfDesk leaves laser kerf to the cutting layer, and a new layer's kerf offset is 0. On such a layer every rung of the coupon comes out loose by about twice the kerf. The coupon would not accept a ladder starting below 0, so it could never reach the press fit that the Box Generator itself can cut. Fixed in PR #1793.

Counts: **raised 5, refuted 0, contradicted 0, P1 0, P2 1, P3 4.** One P2 and one P3 are fixed; three P3s are listed for the maintainer.

A separate refuter used different methods (Clipper offsets and areas, exact arrangement-cell enumeration, a different input generator) and broke nothing.
- It **weakened** O4-P2-1. My kerf arithmetic was wrong (play is c + 2k, not c + k), and I had missed an existing Job Review warning.
- It **upheld** O4-P3-1 and O4-P3-2, and all four clean claims.
- It raised two more P3s (O4-P3-3, O4-P3-4).

## Oracle plan

This plan was written before reading the code closely. The claims are labelled N (nesting), B (box) and P (parts).

| # | Claim | Oracle |
|---|---|---|
| N1 | No two placed parts overlap. | My own even-odd point-in-polygon test and segment-crossing test. The module's Clipper and collision code is not used. |
| N2 | Each pair of parts is at least the requested spacing apart, and so is each part and each locked obstacle. | My own segment-to-segment minimum distance. |
| N3 | Every part lies inside the sheet, at least half the spacing from its edge. The dialog promises this margin. | Bounding box of the transformed outline, compared with the sheet rectangle. |
| N4 | The part count is conserved: all parts are placed, or the unplaced ones are reported by id. | Count property. |
| N5 | The transform is rigid and its rotation is one of the permitted angles. | I rebuild the transform myself (rotate about the box centre, then translate the box minimum) and check the angle against the item's allowed set. |
| N6 | Production nesting conserves requested = produced + unplaced for every part, and an oversize part is reported, never placed. | Count property, plus N1–N3 on every sheet. |
| B1 | The assembled outer size equals the typed outer size. In inner mode, the cavity equals the typed size, plus the layers each style adds. | Arithmetic on the typed numbers: outer = inner + 2T per wall pair. The module's `deriveBoxDims` is not used. |
| B2 | Mating edges interlock with zero gap and zero overlap, and every corner cube belongs to exactly one panel. | Independent 3D assembly. I sample random points in the box and count which panels' extruded outlines contain each one, using frames re-derived from the documented drawing convention. I also check volume: the sum of panel areas × T must equal the shell volume. |
| B3 | Joint play c is split as a tab f − c/2 against a slot f + c/2. | boxes.py `play` (widens the slot by `play`) and the boxes.py and MakerCase kerf rules, checked by the research verifier. |
| B4 | Lids and dividers fit their slots. Nothing occupies the cavity except dividers. | The same 3D assembly, at nominal fit. |
| B5 | The fit coupon tests what it claims, and its rungs map onto the clearance the generator accepts. | Hand calculation, plus the layer kerf defaults. |
| P1 | Typed dimensions are exact: bounds, hole diameters, holes inside the part and not overlapping. | I measure the emitted paths myself. |
| P2 | An even rescale folds into the typed lengths exactly. A stretch is never folded silently. | Scaling property: geometry(scale(def, k)) must equal k × geometry(def). |
| P3 | Impossible inputs are refused: NaN, ≤ 0, ∞, more than 100,000 mm, non-integer counts. | A catalogue of degenerate inputs. |

## Findings

### O4-P2-1: on a laser layer without a kerf offset, the Box Fit Test cannot find a press fit

- **Where:** `src/core/box/fit-coupon.ts`, `validate`/`collectFieldIssues` (refused a start below 0: "Ladder start must be 0 or greater"). Also `src/ui/box/BoxFitTestDialog.tsx`: the Ladder start field had `min={0}` and the default ladder is 0.05–0.30 mm. The rest of the chain:
  - `src/core/box/panel-fit.ts` header: kerf is left to "the shipped pipeline (kerf-offset at compile)".
  - `src/core/scene/layer.ts`: `LAYER_DEFAULTS.kerfOffsetMm = 0`.
  - `src/ui/box/box-draft.ts`: the laser default clearance is `'0'`, and its comment calls this "a laser press fit".
  - `src/core/box/box-spec.ts`: the generator accepts a negative clearance (|c| < min(cell, T)/2) for closed, open-top and open-front boxes.
- **What goes wrong:** the generator draws nominal panels. On a layer with kerf offset 0, the beam removes about k/2 from each cut edge (k is the beam width). Each tab comes out k narrower and each slot k wider, so a joint drawn with clearance c has a physical play of about c + 2k. The coupon's rungs are all at c ≥ 0, so on such a layer every rung is loose by at least 2k. The default rung 0 (0.05 mm) is looser still. ADR-119 promises that "the rung that feels right on the bench IS the number to type". On a default laser setup no rung can feel right, and the press fit the generator can cut (c ≈ −2k) is out of the coupon's reach. The Box Generator and the Box Fit Test did not mention kerf. Job Review does warn: `job-intent-warnings.ts` `appendGeneratedBoxKerfWarning` flags box panels on a 0 mm kerf Line operation and advises entering a measured kerf "or cut the fit coupon on the intended material first". On exactly those layers, that coupon route was the dead end described here.
- **Reproduction:**
  - `generateFitCoupon({thicknessMm: 3, fingerWidthMm: 9, startClearanceMm: -0.2, stepClearanceMm: 0.05, rungCount: 6, relief: {kind: 'none'}})` returned `invalid` ("Ladder start must be 0 or greater") on `5c9441ba8`. In the dialog, typing −0.15 into Ladder start failed native validation.
  - `generateBox` with clearance −0.1 on the same material is accepted.
  - The two regression tests in PR #1793 fail on `5c9441ba8` and pass with the fix.
- **Oracle:** physical kerf arithmetic, against two vendor references:
  - boxes.py bakes kerf correction into every part. Its manual says `burn` is "half the width of the laser cut", default 0.1 mm in `boxes/__init__.py`, and that "Bigger burn values make a tighter fit".
  - MakerCase offers kerf compensation as a download option, with default none.
- **Research verdict:** VERIFIED, for both references. Sources: boxes.py user manual (florianfesti.github.io/boxes/html/usermanual.html), `boxes/__init__.py` (the `--burn` default 0.1; burn applied as an outward offset in `corner()`), and MakerCase `download.md` and its app bundle (kerf option with compensation type none by default). Note that boxes.readthedocs.io is an unrelated Python library and is not a boxes.py source.
- **Refuter verdict:** WEAKENED.
  - Upheld: the per-rung law is exact (tabs 8.975 … 8.850 and notches 9.025 … 9.150 for f = 9 and a 0.05 + 0.05·i ladder), negative starts were refused, the generator accepts c = −1.4 and refuses −1.6, and box panels get no automatic kerf.
  - Corrected: the play is c + 2k. The fix PR's ADR and WORKFLOW text use c + 2k.
  - Added: the existing Job Review warning. With that warning a user is not left silent, so this stays P2 only because the warning's own advice was unreachable.
- **Owner re-check:** I re-read `fit-coupon.ts`, `BoxFitTestDialog.tsx`, `layer.ts`, `panel-fit.ts`, `box-draft.ts` and `box-spec.ts` at `5c9441ba8`.
- **Severity:** P2. An ordinary laser user hits this on default settings, and the coupon's result is misleading. It is not P1: the cut geometry is exactly what was drawn, and the looseness comes from not compensating kerf, which other generators also leave optional.
- **Fix:** PR #1793 (ADR-119 Amendment 1):
  - The ladder may start below 0. The same bound as the generator applies at both ends.
  - The Ladder start field no longer has a native minimum.
  - On a laser, the dialog says to cut on the box's layer and to go below 0 or set the layer's kerf offset if rung 0 is already loose.
  - Coupons that start at 0 or above are unchanged.

### O4-P3-1: Fast nest keeps a full spacing at the sheet edge, while the dialog promises half

- **Where:** `src/core/nesting/quick-nest.ts`, `quickNest`. The free rectangle is inset by `padding/2`, and the candidate is then placed at `rect.minX + padding/2`.
- **What goes wrong:** the Quick Nest dialog says "Spacing also reserves half its value at the boundary". `validateNest`, the outline method's staging and the outline compactor all use half. The Fast method keeps a full spacing from the sheet edge. With 4 mm spacing on a 100 mm sheet, a 10 mm part lands at (4, 4) with Fast and at (2, 2) with Outline. On a 14 mm sheet, Fast refuses the part ("do not fit") even though 2 + 10 + 2 = 14 meets the stated rule.
- **Oracle:** the dialog's own text and `validateNest`. This is an internal contract, with no outside standard.
- **Research verdict:** not applicable (internal contract).
- **Refuter verdict:** UPHELD.
  - The gap between parts is correct; only the boundary margin is a full spacing.
  - The UI reaches this path: `nest-actions.ts` with method `fast`, and `layout-nest.ts` for tidy or compact with Fast.
  - No ADR documents a full margin.
- **Severity:** P3. The result errs on the safe side and only wastes margin or refuses a borderline fit.
- **Not fixed. Listed for the maintainer:** fixing it moves where Fast nest places parts. The one-line change would be `insetRect(bin, 0)` in `quickNest`, which keeps part-to-part and part-to-obstacle gaps at the full spacing.

### O4-P3-2: ADR-119 and WORKFLOW F-K8 describe index nicks the coupon never cuts

- **Where:** ADR-119 Decision 1 ("i+1 index nicks (1 mm square)"), WORKFLOW F-K8 step 2, and the `combStrip` comment in `fit-coupon.ts` ("index notches in the bottom edge"). The file header says "deliberately no cut index marks". Rungs are identified by the asymmetric margins instead.
- **Oracle:** the document against the emitted geometry. No notches exist in the generated rings, and `fit-coupon.test.ts` pins the margins.
- **Refuter verdict:** UPHELD. No amendment superseded the nicks before PR #1793.
- **Severity:** P3 (documentation drift).
- **Fix:** in PR #1793. ADR-119 Amendment 1 withdraws the nicks, and the WORKFLOW text and the comment now match the code.

### O4-P3-3: the coupon's press-fit bound uses the typed finger width, but the generator uses the real cell width

- **Where:** `fit-coupon.ts` bounds rungs by min(f, T)/2 with the typed f. `box-spec.ts` `collectClearanceIssues` bounds clearance by min(smallest cell, T)/2, where the cells are re-divided from the box spans and can be narrower than the target.
- **What goes wrong:** a strongly negative winning rung that the coupon accepts can be refused by the Box Generator. The refusal is shown to the user, so nothing is silent. Realistic press fits (around −2k, a few tenths of a millimetre) sit far inside both bounds.
- **Refuter:** raised by the refuter. I re-checked the code.
- **Severity:** P3, not fixed; listed.

### O4-P3-4: Fast nest refuses an exact-fit part on a sheet far from the origin, because of float rounding

- **Where:** `quick-nest.ts` compares `width(rect) - packedWidth < 0` with no tolerance.
- **What goes wrong:** with a sheet at minX −4987.123, the computed width is 37.30000000000018. With spacing above 0, every exact-size case (40 tried) was refused, because of the full margin in O4-P3-1. At spacing 0, a 37.3 mm part on that sheet was refused by Fast and accepted by Outline.
- **Refuter:** raised by the refuter.
- **Severity:** P3, because no realistic sheet is sized to the micron. Not fixed: a tolerance changes which nests Fast accepts. Listed with O4-P3-1.

### Note for the maintainer (not a finding)

- **Laser default ladder.** Should a laser's default Box Fit Test ladder straddle zero, for example −0.15 to +0.10 mm, so that a first coupon on a default layer brackets the press fit? This changes what users see by default, so the fix leaves the default at 0.05 / 0.05 / 6 and the dialog hint explains instead.

## Refuted

No finding was refuted.

The research verifier did correct one outside fact the plan had assumed. boxes.py sizes are not simply "inner by default". Plain `--x`/`--y` are documented as inner, but generators that declare `outside` without a default (ClosedBox, ABox, UniversalBox) treat sizes as outer by default (`boxes/__init__.py` around L600–604). This is CONTRADICTED as worded. It does not affect KerfDesk, which asks for inner or outer explicitly and was checked against the typed numbers.

## Verified clean

All were checked on `5c9441ba8` with the harnesses described. The harnesses are not committed. Their method is recorded here so it can be repeated.

- **Nesting core (N1–N5).** The inputs:
  - 300 seeded cases: 1–9 parts each, drawn from rectangles, L, U, star, comb, triangle and rings with holes.
  - Rotation sets {0}, {0,90}, {0,180}, all four, {90} and {270,180}.
  - Spacing 0, 0.5, 2 and 3.7 mm; sheets offset from the origin; and in 40 % of cases a locked obstacle.

  These ran through `quickNest`, through `outlineNest`, and through `layoutNest` with each goal (tidy, compact, grid) at trials 0, 3 and 7. Results:
  - No overlap deeper than 1e-5 mm. The planner rounds positions to 1e-6 mm, and with zero spacing parts may touch.
  - Every gap was at least the spacing (tolerance 1e-5 mm).
  - Every part was inside the sheet with at least half the spacing to its edge.
  - Every rotation was permitted.
  - The `rotated90` flag was consistent with the angle.
  - Every refusal reported its unplaced ids.

  The transform the scene applies (`nest-actions.ts` `rotateUnit`/`placeUnit`, rotation about the unit box centre) gives the same geometry as the core's oriented outline. I derived this by hand with `applyTransform` (scale → mirror → rotate about the local origin → translate). Tight `transformedBBox` extents commute with quarter turns.
- **Production nest (N6).** 60 seeded cases, quantities 1–3, two stocks (one remnant with a differently cased material key), and an oversize 500 × 20 part. `requested = produced + unplaced` held for every part, the oversize part was always reported unplaced, and every sheet passed N1–N3.
- **Second-method confirmation (refuter).** The refuter repeated these checks with different methods:
  - Nesting: Clipper round-offset intersection over 280 cases × 8 methods. The inputs included thin parts (0.02 mm), exactly bin-sized parts, spacing 15–55 mm, single-angle rotation sets, an obstacle covering 85 % of the sheet, and bins offset by ±5000 mm.
  - Production: 120 runs.
  - Boxes: 500 specs by exact arrangement-cell enumeration over 1.74M cells, with negative controls detected, plus 160 lid cases.
  - Parts: 3,000 definitions, using Clipper containment and overlap.
  - All had zero violations. Out of contract: an outline whose bounding box does not start at the origin would be placed off-sheet. The UI always normalises outlines to their bounds (`nest-outline.ts`), so this cannot happen in the app.
- **Box walls and dividers (B1, B2, B4).**
  - The inputs were 398 seeded specs across closed, open-top and open-front styles, with:
    - thickness 1.5–12 mm and inner or outer mode;
    - finger targets of 2–27 mm;
    - clearance 0, 0.1 or 0.2 mm;
    - 0–2 dividers per axis.
  - Each spec was assembled in 3D from the generator's own output, using frames I derived myself. 6,000 sample points per spec were taken, half of them hugging the faces. Results:
    - no point covered twice, including at divider egg-crate crossings;
    - no gap in the shell at clearance 0;
    - no wall material in the cavity;
    - every panel's bounding box equal to the expected face rectangle, from the typed numbers, within c/4;
    - wall volume equal to shell volume at clearance 0 without dividers.
  - The other two specs were refused loudly ("compartments under twice the thickness").
- **Lid styles (B4).** 120 seeded slide-lid and lift-off-lid specs, built with `buildSlideLidParts` and `buildLiftLidParts` at nominal fit and assembled in 3D: 20,000 points each, half of them in the lid bands. There were no gaps and no double cover.
  - The only "extra material" hits lay in the sliver between the true circle and the 12-segment thumb-notch polygon, which is expected.
  - By hand: the slide lid has a through-channel, a captive strip, and a tongue running to the back wall's inner face. The lift-off lid's lip is the opening minus c, half on each side, matching its header.
- **Joint play law (B3).**
  - `panel-fit.ts` offsets inward by c/4: the tab narrows by c/2 and the recess widens by c/2, so play = c. The coupon uses the same per-rung law: tab f − c/2, notch f + c/2.
  - This matches boxes.py's `play`, which the verifier confirmed is applied to the counterpart slot as `f += play` (`boxes/edges.py`), meaning the total width difference.
  - Finger count: KerfDesk uses an odd count of equal cells over the inner span. boxes.py instead centres the leftover with `surroundingspaces`, verified in `edges.py` `calcFingers`. These are different rules, and both give complementary mating edges by construction. The 3D assembly confirms KerfDesk's.
- **Box insert path.**
  - `box-insert-mutation.ts` inserts the panels with an identity transform, in mm.
  - The panel layout is a bounding-box grid with gaps of at least the part spacing, by construction (`layout.ts`).
  - CNC panels cut full depth and slots are pocketed (ADR-106 Amendment 2).
- **Parts (P1–P3).**
  - 3,000 seeded definitions across panel, bracket, hole grid and fixture; 2,451 were valid. For every valid one:
    - the bounding box was exactly 0…W × 0…H;
    - each hole's arc radius equalled its polyline radius (to 1e-9), and the panel diameter matched what was typed;
    - no hole centre was outside the part, no hole touched an edge, and no two holes touched.
  - Rescaling by 0.5, 1.1, 2 and 3.7 always stayed valid and reproduced k × geometry to within 1e-6 mm.
  - NaN, −1, 0, ∞ and 1e6 in every length and count field of every kind were refused.
  - A stretch is not folded silently: `retainedSourceScale` returns `stretched` and the editor shows `RetainedScaleNotice`.

## Not verified

- **Physical cuts.** No hardware was used. The kerf behaviour in O4-P2-1 is arithmetic from the outside references, not a measured cut.
- **The compile-time kerf offset itself** (`kerf-offset.ts`): its direction on outlines versus holes. It has been audited many times before and is outside this area.
- **Advanced nesting worker** (`packing-solver-adapter.ts` and the external solver). Only its validation entry point is shared with the paths above; its own search was not exercised.
- **The `.lf2` production nest validator** (`src/io/project/project-production-nest-validator.ts`), which is outside this area's scope.
