## ADR-410 Amendment 1 - Round offsets stay within the machine curve tolerance (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-410 item 3 maps Round to Clipper's round join and says nothing about how finely the arc is
chorded. The offset result is stored as polylines and cut as they are, so the chords are the
shape. Clipper's default arc tolerance is the offset distance divided by 500, which makes the
chord error grow with the offset: 0.05 mm at 25 mm, 0.1 mm at 50 mm and 2 mm at 1 m, against the
0.025 mm machine curve tolerance (`DEFAULT_MACHINE_CURVE_TOLERANCE_MM`) that every other curve in
the app is held to. Small offsets were never faceted: at 1 mm the chords sit 0.002 mm off the
circle. The properties-panel offset (ADR-103) makes the same Clipper call. The 2026-09-28 weakness
audit found this (E-6).

### Decision

1. The round corners and round end caps of Offset Shapes, and the round corners of the
   properties-panel offset, are built with an explicit arc tolerance: the smaller of Clipper's own
   default (distance / 500) and 0.024 mm. That is the machine curve tolerance less one step of the
   1 µm grid Clipper rounds every vertex to, so the stored chords, not only the exact ones, stay
   within 0.025 mm of the true circle.
2. Offsets up to 12 mm get the tolerance Clipper chose before, so their output does not change.
   Larger offsets add chords until the arc is within the tolerance. A 50 mm corner has 26 chords
   instead of 13, and a 1 m corner 114.
3. Only these two call sites pass a tolerance. Clipper's default and every other caller (kerf
   offset, pockets, V-carve, stroke outlines, nesting, adaptive clearing) are unchanged. Bevel and
   Corner draw no arcs and are unaffected.

### Alternatives

- **A flat 0.025 mm for every distance.** Rejected: a 1 mm corner would be cut into 4 chords where
  it has 13 today, a visible loss for small shapes.
- **Change Clipper's default or a shared offset helper.** Rejected: the CNC offsets have their own
  reasons and their own audit, and a shared default would change their output.

### Consequences

- A large round offset carries more points around its corners. The count follows the total turning
  of the outline, so it stays small next to the shape's own vertices.
- `src/core/geometry/offset-round-chord-error.test.ts` measures the arcs of both tools, outward,
  inward and as open-line caps, from 0.5 mm to 200 mm, and pins the small offsets to their fine
  tolerance.
