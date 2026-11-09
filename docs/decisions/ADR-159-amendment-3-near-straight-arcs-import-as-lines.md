## ADR-159 Amendment 3 - A DXF bulge or SVG arc that is straight to within 1e-9 of its chord imports as a line (2026-11-09)

**Status:** Accepted. | **Date:** 2026-11-09

This amends ADR-159 (stored curves are canonical) and its Amendment 2 (`arcToCubics`). It changes
DXF and SVG import only. Compile, Frame, Start and the G-code emitter are unchanged, so the
Frame-first contract (PROJECT.md non-negotiable 21, ADR-565) is untouched.

### Context

Rolling audit v11, W5-P1-1 (found by the refuter, P1):

- `bulgeCurveSegment` (`src/io/dxf/dxf-native-curves.ts`) treated only `bulge === 0` as straight.
  A floating-point-noise bulge such as `1e-17`, which a writer emitting `tan(sweep / 4)` of a
  near-zero sweep can produce, put the arc centre about `chord / (4 × bulge)` away: 1e17 to 1e19 mm.
  At that magnitude double rounding moves the cubic's control points by `radius × 2⁻⁵²`, tens of
  millimetres to metres. Only the end point was snapped.
- Compile and the canvas use that canonical cubic. A 40 × 30 mm plate with bulge `1e-17` on one edge
  compiled X 129.46..270.54 (141 mm wide), and `2.449e-17` compiled 70.4 mm wide, each with only
  "Imported 1 path". `1e-18` and `1e-19` made the drawing 1,226 and 4,612 mm wide and bed-fitted it to
  29.4 % and 7.8 % under "p.dxf is larger than the 400 × 400 mm bed".
- The polyline sampler beside it (`bulgeSegment`) was correct: a tiny sweep is one step, snapped
  to the end point.
- SVG twin: `arcToCubics` (`src/io/svg/flatten-curves.ts`) did the same for an arc whose radius is
  about 1e16 times its chord. `M0 0 A1e20 1e20 0 0 1 10 10` imported with polyline points up to
  y 6,145 mm and a cubic reaching 8,192 mm. Chromium 156 draws `A1e17` through `A1e20` as the
  10 × 10 line.
- Ground truth: a bulge's sagitta is exactly `|bulge| × chord / 2`. At `1e-17` on 40 mm it is
  2e-16 mm.

### Decision

1. **One straight test for both formats.** `NEAR_STRAIGHT_SAGITTA_PER_CHORD = 1e-9`
   (`src/core/geometry/near-straight-arc.ts`). An arc whose sagitta is at most 1e-9 of its chord is
   its chord: 1 nm on a 1 m edge, far below any machine step. At the threshold the centre is about
   1.25e8 chords away, so the rounding of an arc just above it stays below 3e-8 of the chord.
2. **DXF bulges.** `isNearStraightBulge(bulge)` is `|bulge| / 2 <= 1e-9`. Both `bulgeCurveSegment`
   (canonical curve) and `bulgeSegment` (display polyline) use it, so the two always agree: a
   near-straight bulge is one `line` segment and one point.
3. **SVG arcs.** `arcToCubics` returns one straight cubic (controls at a third and two thirds of
   the chord) for a small arc (`largeArc` false, λ < 1) whose sagitta bound
   `max(rx, ry) × λ / (1 + √(1 − λ))` is at most 1e-9 of the chord. λ is the squared half-chord in
   the unit-circle frame, so this is the circle's sagitta scaled by the larger radius, an upper bound
   for an ellipse. Callers (`flattenArc`, `transformSvgCurveSubpath`, the import range check) are
   unchanged.
4. **Out of scope.** A radius past float32 range (about 3.4e38) keeps its existing handling.
   Chromium draws nothing for such a path (W5-P3-1, refuted), and KerfDesk refuses the file
   between 1e38 and 1e76 and drops the segment beyond. A large-arc flag is never straightened: that
   arc goes round the far side.
5. **The emitter revision advances** to `near-straight-arcs-are-lines-20261109-v44` (v43 is held by
   open PR #1623), because a file with noise bulges now compiles to different G-code. No G-code
   snapshot changes.

### Consequences

- A new DXF or SVG import burns a noise-bulge edge, or a huge-radius arc, as the straight edge the
  file means, at its drawn size and with no false bed-fit.
- Saved projects keep the curves they imported (ADR-159). A project imported before this build
  keeps its looped curve until the artwork is re-imported.
- An ordinary arc is unchanged: the smallest bulge still bent is 2e-9, a sagitta of 4e-8 mm on
  40 mm.

### Evidence

- `src/io/dxf/dxf-near-straight-bulge.test.ts`: the 40 × 30 plate with bulges `2.449e-17`, `±1e-17`,
  `1e-18`, `1e-19`, `1e-20`, `6.12e-17`, `1.22e-16` and `1e-12` imports as four lines, bounds
  40 × 30; a diagonal edge stays on its chord; bulge `1e-6` still bends, with controls within
  1e-4 mm of the chord; the threshold sits between `2e-9` and `2.1e-9`.
- `src/ui/app/dxf-noise-bulge-burn.test.ts`: through the real store import and `compileJob`, the
  plate burns 40 mm wide at scale 1 for bulges `0`, `2.449e-17`, `1e-17`, `1e-18` and `1e-19`.
- `src/io/svg/flatten-curves-near-straight-arc.test.ts`: radii 1e16, 2.5e16, 1e17, 1e18 and 1e20 on
  a 10 × 10 chord give one straight cubic and, through the worker import, the polyline
  `(0,0)–(10,10)` and curve bounds 10 × 10; radius 1e5 stays an arc on its circle; a large-arc flag
  is not straightened.
- With the source change reverted, 34 of the 45 new cases fail.
- Not verified: rendered or burned output on a machine.
