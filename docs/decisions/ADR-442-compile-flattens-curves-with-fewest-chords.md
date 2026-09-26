## ADR-442 - Compile flattens curves with near-fewest chords within the tolerance (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This takes up the change ADR-391 and ADR-405 both left out ("chord-optimal cubic flattening in
compile"). It changes how every cubic and elliptical-arc segment becomes straight moves, for laser
and CNC alike. Line segments, the tolerance (`DEFAULT_MACHINE_CURVE_TOLERANCE_MM`, 0.025 mm at the
placement's largest axis scale) and the callers are unchanged, except Edit Nodes Delete, which read
an arc's end tangent off the flattened samples (see Consequences). The Frame-first contract (PROJECT.md
non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched: Frame, Start, Job Review, the estimate
and the G-code Inspector all read the compiled job, which is where the new chords appear.

### Context

`flattenCurveSubpath` (`core/scene/curve-path.ts`) is the one flattener behind compile
(`compilationPolylines`), fill, CNC contour collection, laser trace conditioning (ADR-391) and the
canvas. It split each cubic at its parameter midpoint until both control points lay within the
tolerance of the line through the ends, and cut arcs into equal angles sized for the larger radius.

Two defects, measured on the base (`c62084959`):

- **More chords than the tolerance needs.** Midpoint splitting only produces 1, 2, 4, 8... pieces
  per split level, and the control points' distance overstates the curve's own by up to a third,
  so most chords are shorter than they may be. Centerline cubics (ADR-405) raised laser
  burn moves by about 55% over the ADR-391 simplification (logo 809 to 1,224, dragon 17,108 to
  26,464 at 100 mm), and ADR-391 measured the same effect on contour cubics.
- **The tolerance was not a guarantee.** The test measured control points against the infinite
  line through the chord's ends, not against the chord. A cubic whose controls sit on that line but
  outside the ends runs past the chord end and passed as one chord: controls (0,0), (40,0), (-30,0),
  (10,0) emitted one move from x=0 to x=10 while the curve reaches x=12.8, 2.8 units off. On real
  data, the dragon's Line Art trace at 100 mm compiled with a largest deviation of 0.032 mm against
  the 0.025 mm tolerance, from such a cubic near a stroke end.

### Decision

`core/scene/curve-flatten.ts`, called by `curve-path.ts` for cubic and arc segments:

1. **Exact chord error.** A chord from curve point A to curve point B is accepted only when the
   largest distance from the curve piece between them to the segment AB is within the tolerance.
   For a cubic, the piece's offset from the line AB and its position along AB are cubic polynomials
   in the curve parameter, so their extremes lie at the piece ends or at the real roots of a
   quadratic (solved in the cancellation-safe form). For an elliptical arc they are sinusoids in the
   angle, whose extremes lie at the ends or at a closed-form pair of angles. When the piece stays
   between A and B this is the exact largest distance; when it runs past an end, the overrun is
   added as the hypotenuse of the two worst values, an upper bound. A zero-length chord (a closed
   cubic loop) is bounded by the farthest control point of the piece, which contains it.
2. **Near-fewest chords.** From each vertex, the chord runs nearly to the farthest point that
   fits. Within a short piece the error grows with the square of the chord's length, so each probe
   steps by the square root of the error ratio, kept inside a bracket of the longest fitting and
   shortest failing ends found so far and bisected when the step leaves it. The search stops at the
   first fitting chord that uses at least 98% of the tolerance (its length is within about 1% of the
   longest), that ends the segment, or whose end is within 2^-8 of its length of a failing end; so
   it does not always take the farthest fitting end. The count is near-minimal, not minimal. It
   would be minimal only if the search took the farthest end and the fit test were monotone (every
   sub-chord of a fitting chord fits, so no other solution's k-th vertex is ahead of the greedy
   k-th vertex); loops and cusps can break monotonicity. The tolerance bound (item 1) holds for
   every chord regardless.
3. **Even chords.** If that count of chords at equal parameter steps also fits, those are emitted
   (every circular arc qualifies, since its chord error depends only on the step, and equal steps
   flatten a curve and its reverse to the same vertices). Otherwise the vertex before the last is
   moved to where the last two chords' errors are equal (Illinois false position on the difference
   of their square roots, at most 12 steps), so no sliver is left at the end. The count never
   changes and both chords are checked.
4. **Unchanged contracts.** The first vertex is the segment start and the last is its end, exactly
   (the arc's end was computed before and could differ in the last bits). Every vertex lies on the
   curve, so the flattened bounds stay inside `curveSubpathBounds`. Output is deterministic.
   Geometry that is not finite (a NaN or infinite control point, radius or angle), or a chord error
   that overflows, is refused as `segment-budget-exceeded`, never drawn as a straight move. The
   midpoint splitter refused it the same way, by dividing to its depth cap of 2^24 pieces and
   running out of budget; the refusal is now immediate, also for callers with an unlimited budget.
   Upstream guards (the path-data parser's finite numbers, the `.lf2` finiteness check) already
   keep such geometry out. The step floor of 2^-24 in the curve parameter, the segment budget and
   its refusal are unchanged.

### Consequences

- Measured before and after on the same base, traces committed to a laser project 100 mm wide the
  way the dialog does and emitted as GRBL (burn moves; program bytes; `estimateJobDuration`; largest
  deviation of the compiled chords from the canonical curves, dense samples in mm; median span of
  consecutive 15-move windows):

  | Case | Moves | Bytes | Estimate (s) | Largest deviation (mm) | 15-move span (mm) |
  |---|---|---|---|---|---|
  | Arch House, Line Art | 2,902 to 2,201 (-24%) | 60,034 to 46,014 | 122.1 to 122.9 | 0.0186 to 0.0250 | 8.75 to 12.28 |
  | Arch House, Centerline | 1,224 to 842 (-31%) | 27,120 to 19,480 | 77.0 to 77.4 | 0.0185 to 0.0250 | 9.53 to 14.37 |
  | dragon, Centerline | 26,464 to 18,978 (-28%) | 617,553 to 467,837 | 1,506.8 to 1,523.8 | 0.0192 to 0.0250 | 4.58 to 6.47 |
  | dragon, Line Art | 51,963 to 42,920 (-17%) | 1,105,136 to 924,268 | 1,863.2 to 1,880.4 | **0.0320** to 0.0250 | 4.17 to 4.84 |
  | owl, Line Art | 65,559 to 53,275 (-19%) | 1,392,575 to 1,146,782 | 2,356.5 to 2,378.9 | 0.0223 to 0.0250 | 3.67 to 4.50 |
  | hummingbird, Line Art | 31,586, unchanged | 681,660, unchanged | 1,397.9, unchanged | no cubics | 4.83 |
  | synthetic discs, Line Art | 307 to 277 | 6,502 to 5,902 | 19.0, unchanged | 0.0161 to 0.0248 | 11.67 to 11.21 |
  | synthetic stars, Line Art | 325 to 237 | 6,760 to 5,000 | 23.0, unchanged | 0.0170 to 0.0250 | 13.06 to 15.49 |
  | circles and ellipses (4-cubic circles r 2, 10, 30; arc pairs r 5, 20; 30 x 8 ellipse) | 398 to 296 | 8,363 to 6,296 | 33.4, unchanged | 0.0130 to 0.0248 | 21.69 to 29.44 |

  The hummingbird trace commits no cubic subpath, so nothing changes. The chords now use the whole
  tolerance instead of about three quarters of it; none exceeds it.
- Centerline recovers most of what ADR-405 accepted: logo 842 against the 809 of ADR-391's
  simplification and dragon 18,978 against 17,108, while keeping the cubics for editing, export and
  rescaling.
- `estimateJobDuration` rises 0.6 to 1.1% (dragon Centerline 1,506.8 to 1,523.8 s at the default
  1,500 mm/min). Longer chords turn through larger angles at each vertex, and the junction deviation
  model slows each corner a little more. That estimator does not model GRBL 1.1's 15-block
  look-ahead, which the longer spans relieve: by ADR-391's formula, the square root of 2 x
  acceleration x the 15-move span, at 500 mm/s² the cap rises from about 4,060 to 4,830 mm/min on
  the dragon's Centerline and from 5,860 to 7,190 mm/min on the logo's (spans measured as above, so
  the absolute values differ from ADR-405's).
- For comparison, the official Potrace 1.16 binary, run out of process on the same images' luma at
  LightBurn's default settings (`-k 0.5 -t 2 -a 1 -O 0.2 -z minority -u 100`), with its cubics
  flattened by the same function at the same 0.025 mm: Arch House 2,447 to 1,845 chords, dragon
  73,265 to 57,366, owl 109,927 to 87,373, hummingbird 77,794 to 61,519. Both sides fall by a similar
  share, so the ranking does not move: our committed Line Art trace needs more moves than Potrace's
  curves on the Arch House logo (2,201 against 1,845) and fewer on the dragon, owl and hummingbird.
  Potrace thresholds the luma once and our Line Art preprocessing differs, so this compares output
  sizes, not tracer quality.
- CNC: traced outlines committed to a CNC project are byte-identical on Arch House (Line Art and
  Centerline), discs and stars, because ADR-260's fairing replaces the cubics with lines before
  compile. Native curves change: the circles and ellipses above cut in 296 moves instead of 398.
  The connected-script V-carve fixture (DancingScript glyph cubics) emits 1,095,146 bytes instead of
  1,083,336, and the connected-script multi-operation program 14,230 lines instead of 14,712; the
  V-carve "Drive" passes move by at most 0.04 mm (`vcarve-drive-regression.test.ts`). The V-carve
  program grows although its outlines have fewer chords: its medial axis is computed from the
  chords, so moving them moves the axis and every depth and feed word on it. The program gains
  about 130 lines (44,147 to 44,277) but 11,810 bytes, so most of the growth is longer lines (more
  words changing per move), not more moves; which feature of the new axis causes it was not
  isolated. V-carve depth is sensitive to chord deviation by 1 / tan(half the bit angle): the full
  0.025 mm tolerance can put a 60 degree bit up to about 0.043 mm deeper or shallower, where the
  base's chords, using about 0.019 mm, allowed about 0.033 mm. Both are within the tolerance
  contract; a finer V-carve depth needs a finer tolerance, not a different flattener.
- G-code changes wherever a cubic or an arc exists, and only there. Updated pins: the
  `curve-bearing-svg` snapshot in `emit-gcode.snapshot.test.ts` (one cubic, and a semicircle the
  SVG importer stores as two cubics: 64 moves become 33, and 32 become 16 on each quarter), `prepare-output-connected-script` and
  `connected-script-compile-performance` (script-font glyphs; length and SHA-256), and the V-carve
  pass positions above. Every other G-code snapshot, including the SVG rounded rectangle and ellipse
  (imported as polylines), is unchanged.
- Cubics and elliptical arcs choose a canonical endpoint direction before the greedy walk, then
  reverse the result for the opposite traversal. This keeps shared colour-layer seams on the same
  chords even when equal steps do not fit. Independent ellipse parametrisations can differ at
  floating-point rounding scale; both original segment endpoints are preserved exactly. The
  asymmetric 100 x 7 mm ellipse regression previously left a 0.023 mm seam gap at 0.025 mm
  tolerance. `curve-join.test.ts` also checks a reversed arc against the curve itself instead of
  expecting reversed vertices. `vector-path-weld.test.ts` bounds the welded outline's area change by
  what its 0.001 mm union grid can cause (perimeter times half a grid diagonal, about 0.018 mm²;
  measured 0.0005 mm²), and checks that the coarse compatibility polyline differs by more than
  0.1 mm².
- Edit Nodes Delete (`curve-node-delete.ts`) took an elliptical arc's end tangent from the first
  three flattened samples with a one-sided second-order difference, which is second-order only when
  the samples sit at equal angles, as the old arc flattener placed them. Uneven chords made it
  first-order: on a 100 x 2 ellipse rotated 30 degrees, merging two arcs gave a cubic whose start
  handle was 2.27 degrees off the arc. The tangent now comes analytically from the arc's centre
  parametrisation (`ellipticalArcEndDirection` in `curve-path.ts`), and a test pins that case to
  within 0.01 degrees. No other caller reads tangents or spacing from flattened samples.
- Cost: flattening every compiled path of the dragon's Centerline trace takes about 28 ms against
  6 ms (median of five warm runs in Node), the owl's Line Art 48 ms against 10 ms; the dragon's
  laser commit, which flattens several times for its topology check, about 100 ms against 28 ms.
  The canvas flattens at display tolerances through the same function and caches per tolerance.
  Interactive callers pay the same factor: a 5,000-cubic path takes about 74 ms against 13 to 20 ms
  at 0.025 mm and 73 ms against 9 ms at 0.05 mm. Hover and click hit testing (`hit-test.ts`), which
  flattened every path under the pointer on each move, now caches its polylines per path object.
  Node editing (`path-node-edit-geometry.ts`, `path-node-curve-command-actions.ts`,
  `path-node-curve-join-plan.ts`) still re-flattens the edited path at 0.05 mm on each change; on a
  large single-colour trace that may be felt while dragging a node and is to be profiled in the app.
- Tests: `curve-flatten.test.ts` measures each emitted chord against its own curve piece, both
  directions, by dense sampling after recovering each vertex's parameter: 300 random cubics at three
  scales and tolerances (a quarter with collinear controls that overrun their ends), 120 rotated
  ellipse arcs built from an independent centre parametrisation, the overrunning cubic above, the
  dragon cubic that measured 0.032 mm, the analytic chord count of a circular arc and a quarter
  circle, exact ends, line vertices kept exactly, determinism, bounds containment, a zero-length
  cubic loop, and named hard shapes at 0.001 and 0.025 mm (an interior cusp, a cusp at the start, a
  self-loop, single and double inflections, and degenerate cubics: a point, controls on the ends,
  coincident controls, a 1 um cubic). Five of its eight tests fail on the midpoint splitter (the arc
  test on its inexact end point); the line, loop and hard-shape tests pass on both.

Not part of this decision: emitting G2/G3 arcs on laser controllers; flattening against a
controller's own arc tolerance; the SVG importer's compatibility polylines (`io/svg/flatten-curves.ts`),
which compile does not read when a canonical curve exists.
