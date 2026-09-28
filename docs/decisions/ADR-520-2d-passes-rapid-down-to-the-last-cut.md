## ADR-520 - Repeated 2D paths rapid down to just above their earlier cut (2026-09-28)

**Status:** Accepted; software verification only, hardware qualification pending.

Addresses CW-02 of the CNC gap audit with ADR-489's optional air-floor descent. The emitter's
entry mechanism and Frame-first Start policy are unchanged. An unproved pass feeds from safe Z.

### Decision

`withPassAirFloors`, called by `cncGroupForPasses`, may assign a floor only when an earlier pass
of the same output primitive used the identical full source XY vertex sequence. A native arc
requires the same source start, end, centre and direction. Identical source inputs continue to
produce identical XY geometry and contour precision selection after shared placement, reflection
and rounding. The floor is no lower than the earlier path's highest requested or represented Z,
rounded upward to the output grid. With several earlier matches, the lowest proven floor wins.

This deliberately excludes restarted or subdivided paths, different arc sweeps, cross-primitive
coverage and helix-only credit. A broader proof requires final represented motion. The proof
does not invent a closing edge from `closed`: only supplied vertices are cut by the emitter.
Skipped stationary contours and underspecified paths do not count as stock removal.

The first pass has no floor. Existing producer floors and stay-down links remain owned by
their producer. Recovery and clipped tiles must drop clearance certificates when preceding
cuts are unavailable. Matching paths use a linear vertex comparison with no geometric slack.

On outside/inside profiles with leads, the Retract between passes field explains that each
pass starts at its lead and lifts either way. Setting Profile leads to None permits ordinary
same-position depth progression. The setting and the actual retract policy are unchanged.

### Audit findings and tests

The initial implementation incorrectly credited skipped stationary contours, skipped zero-radius
helices, and the full circle of a near-full arc that emitted G1 chords. Each allowed an emitted
`G0 Z-2.000` before a first real cut. Further challenges exposed a 4e-7 mm path shift across a
rounding boundary and a raw-collinear subdivision whose new vertex rounded off the earlier line.
Those geometries now receive no floor.

Tests check the actual emitted program, including shared translation and reflection after the
certificate is computed. Positive repeated profiles, pockets, tabbed path3d paths, drill pecks and
identical arcs still gain floors; mixed or unproved cases explicitly retain slow descent.
Stock simulation checks 15 compiled job types and manually constructed wide-stepover pockets
without treating untouched cusps as removed. One tabbed-profile snapshot returns to its previous
plunge from safe Z because the complete represented paths differ.

The original candidate's time-saving tables do not qualify this narrower implementation.
The current output revision is `air-floor-repeated-paths-20260928-v12`.

No controller interpolation, lost-step margin, air-cut or material qualification is claimed.
The intended physical follow-up remains an air cut and a profile in scrap on the 4040.
