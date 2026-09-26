## ADR-159 Amendment 2 - Imported SVG arcs become cubics that stay on the arc (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-159 makes stored curves canonical: job compilation flattens them at 0.025 mm
(`DEFAULT_MACHINE_CURVE_TOLERANCE_MM`). SVG import stores a path's `A` arcs as cubics. The import
transform (the viewBox scale and element transforms) passes through `transformSvgCurveSubpath`,
which converts each arc with `arcToCubics` (`src/io/svg/flatten-curves.ts`). The import-time display
polyline (`flattenArc`), clip containment, SVG bounding boxes and SVG export under a matrix use the
same cubics.

`arcToCubics` splits an arc into `ceil(|Δ| / 90°)` equal pieces of eccentric angle. It put each
control point at α times the ellipse's parametric derivative from its end, with Maisonobe's
α = sin Δ · (√(4 + 3 tan²(Δ/2)) − 1) / 3. At 90° that is 0.5486. The circle-matching arm is
(4/3) · tan(Δ/4), 0.5523 at 90°, which puts the cubic's midpoint on the arc.
`parametricEllipseCurve` already uses it for DXF and LightBurn arcs.

Measurement: each cubic was sampled at 4001 points and compared with the true ellipse, using the
nearest-point distance from Newton's method on the eccentric angle. The shapes were circles of
radius 30 and 100 and ellipses of 100×40 rotated 30°, 100×10 rotated −55° and 40×100 rotated 73°,
each from fourteen start angles. The old arm left 90° pieces up to 0.196% of the major radius inside
the arc, always at the cubic's midpoint: 0.196 mm at a 100 mm radius and 0.059 mm at 30 mm. The
error falls quickly with smaller pieces: 0.065% at 75°, 0.017% at 60° and 0.003% at 45°. Real arcs
reach the 90° case, because a quarter arc imports as one cubic, a semicircle as two and a
three-quarter arc as three. The `curve-bearing-svg` G-code snapshot cut its 20 mm radius semicircle
up to 0.040 mm inside the circle.

The same function had two floating-point faults:

- It took angles from `acos`, which loses half its digits near 0 and π. An arc whose chord is a
  diameter could end up to about 1e-8 rad short: 2.4 µm on a 180 × 90 ellipse arc.
- With λ ≥ 1, where SVG scales the radii up until the chord is a diameter (SVG 1.1 §F.6.6), the
  centre came from the square root of a rounding residue. That put it about 1e-8 of the radius off
  the chord midpoint and tilted both end tangents by about 1.3e-8 rad.

### Decision

1. **Each cubic's arms are (4/3) · tan(Δ/4) times the ellipse's parametric derivative.** Every
   cubic's midpoint lies on the arc. A 90° piece strays at most 0.0273% of the major radius, always
   outward: 0.027 mm at a 100 mm radius. On a rotated ellipse the cubic is the affine image of the
   circle's, so the bound is the same. Smaller pieces stray less: 0.0091% at 75°, 0.0024% at 60° and
   0.0004% at 45°.
2. **Pieces stay at most 90°**, as for DXF and LightBurn arcs. The number of segments in imported
   artwork is unchanged. Splitting at 45° would cut the bound to 0.0004%. It was not adopted here;
   see Consequences.
3. **Endpoints and tangents are exact.**
   - The first cubic starts at the authored start and the last ends at the authored end.
     Consecutive cubics share their joint, bit for bit.
   - Angles come from `atan2` of the cross and dot products.
   - With λ ≥ 1 the centre is the chord midpoint.
   - Each arm lies along the arc's tangent at its end.
4. **Only `arcToCubics` changes.** The other converters were checked:
   - DXF arcs, circles, ellipses and bulges, and LightBurn ellipses, already use
     (4/3) · tan(Δ/4) through `parametricEllipseCurve`.
   - HPGL arcs and native `elliptical-arc` segments are sampled on the true arc (`curve-path.ts`).
   - PDF has no arc operator.
   - SVG `<circle>`, `<ellipse>` and rounded `<rect>` import as outlines sampled on the true curve.
   - Centerline dot marks use (4/3) · tan(π/8).
5. **The emitter revision advances** to `svg-arcs-on-the-arc-20260926-v1`, because an SVG with arcs
   now compiles to different G-code. In the `curve-bearing-svg` snapshot, the semicircle's vertices
   now lie within 0.0054 mm outside and 0.0002 mm inside its circle. The G-code prints three
   decimals, so the 0.0002 is rounding. Before, they reached 0.040 mm inside.

### Consequences

- A new SVG import, library insert or **Re-import source** cuts arcs within 0.027% of the radius
  instead of up to 0.196% inside it.
- Saved projects keep the curves they imported, which ADR-159 makes canonical. Their G-code is
  unchanged until the artwork is re-imported. The header's emitter revision therefore names the
  build that exported a file, not the build that imported its arcs.
- The remaining error scales with the radius. It is 0.027 mm at 100 mm and 0.08 mm at 300 mm, and
  it exceeds the 0.025 mm compile tolerance beyond a radius of about 92 mm. Splitting at 45° would
  remove that at every size. That split would also change every importer's segment count, so it is
  a separate decision.

### Evidence

- `flatten-curves.test.ts`:
  - A 100 × 40 elliptical arc rotated 30°, made of three 90° cubics, stays within 0.03 mm of the
    ellipse, sampled at 65 points per cubic. The old arm measured 0.149 mm.
  - An arc with λ > 1 starts and ends exactly at its authored points, shares its joint, and has
    arms square to the radius (cosine below 5e-13; measured 7.5e-16). The original code missed the
    start by 5e-14 mm and the end by 0.09 µm, and its arms were 1.3e-8 rad off square.
- `parse-path-d.test.ts`: `M 0 100 A 100 100 0 0 1 200 100 A 100 100 0 0 1 0 100 Z` flattens to
  vertices within 0.03 mm of the circle. The old arm measured 0.196 mm.
- `svg-curve-transform.test.ts`: an arc of radius 50 scaled ×2, converted to cubics and flattened
  at 0.025 mm, stays within 0.03 mm of its 100 mm circle. The old arm measured 0.196 mm.
- Reverting only the arm formula fails the three accuracy tests. The original file fails all four.
- The `curve-bearing-svg` snapshot in `emit-gcode.snapshot.test.ts` changes only its semicircle's
  `G1` coordinates. The line count is unchanged.
- Not verified: rendered, air-cut or material output.
