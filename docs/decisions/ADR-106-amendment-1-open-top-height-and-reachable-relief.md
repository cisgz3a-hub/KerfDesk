## ADR-106 Amendment 1 - Open-top height counts only the bottom, and CNC relief is a dogbone the bit can reach (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

A full audit of the Box Generator placed every generated part in 3D and compared it with the box
the operator asked for, and ran the generated CNC panels through the shipped profile-outside
compensation. Two contracts in ADR-106 did not hold.

1. **Open-top height.** ADR-106 says the inner dimensions are "what the contents need", and
   F-K1 labels the mode "Inner (contents)". `deriveBoxDims` added 2T to the height for every
   style except the slide lid, so an open-top box added a thickness for a top panel it does not
   have. An inner 60 × 40 × 30 mm open-top box in 3 mm stock stood 36 mm tall with a 33 mm deep
   cavity; in outer mode the dialog reported an inner height one thickness short of the real
   cavity. Dividers carried a matching "+T rim band" so they stayed flush. The referees read
   their spans from `deriveBoxDims`, so they could not see the error.
2. **CNC relief placement.** Relief was a circle of one bit radius centred on each seat
   corner. A round bit can cut that circle only with its centre exactly on the corner, and any
   centre short of the corner gouges the recess walls. So the region is unreachable, and the
   offset that profile-outside compensation computes skips it. Measured on generated panels,
   the bit centre stayed √2·r from every seat corner with relief on or off. The corners kept a
   bit-radius fillet, and square tabs could not seat. Tests measured the drawn circle, never
   the toolpath.

### Decision

1. Outer height = inner height + one thickness per horizontal layer around the cavity: closed
   2T (bottom and top), open-top T (bottom), slide-lid 3T (bottom, lid band and captive strip,
   unchanged). Dividers rise the full inner height for every style, which on an open top is
   flush with the rim. The slide-lid builder's open-top surrogate adds 2T to keep its 3T walls.
2. Each CNC relief is a dogbone the bit can cut: the capsule a bit sweeps along the bisector of
   the open (waste) side, from the centre one bit radius from the corner (where its edge touches
   the corner) out to the centre where it meets both walls (r / sin(θ/2), √2·r for a square
   corner). The capsule's radius is the bit radius + 0.05 mm, and it is drawn as a polygon that
   circumscribes it. Its eroded interior is a lane at least 0.1 mm wide, so the compensated
   toolpath runs from the main contour into each corner and back as part of the same loop. A
   dogbone circle alone leaves the lane pinched shut under clipper's miter joins, so the bit
   reaches it only as a separate island loop, which a holding tab can bridge whole. The relief
   Boolean runs at 1e-3 mm precision. A bit edge now passes each seat corner by about 0.05 mm.
   The ordering (clearance offset first, then relief) and which corners are relieved are
   unchanged. The thumb notch on the loose lid is still never relieved. The shape lives in
   `corner-dogbone.ts`, shared with the standalone Dogbone tool (ADR-103 Amendment 1).
3. The verification contract for relief is the toolpath, not the drawing. After
   profile-outside compensation with the relief tool, the bit centre passes within one radius
   of every seat corner (reflex outline corners and convex cutout corners), in one loop per
   ring, for every style, dividers and the Box Fit Test strips. A sampled 3D occupancy test checks every style and
   mode against the requested outer and inner dimensions, not against `deriveBoxDims`.

### Consequences

- Open-top boxes generated before this change came out one thickness taller than entered.
  Regenerating the same inner values now gives the requested depth. Outer-mode open-top panels
  keep their size, and the dialog now reports the true inner height.
- CNC panels with relief on change shape: dogbone bites along each corner's bisector replace the
  larger centred overcuts, and the bit reaches every seat. Laser output and relief-off CNC output are
  unchanged apart from the open-top height.
- The standalone Dogbone tool (F-CNC26, `dogbone.ts`) used the same centred-circle convention
  and had the same reach defect; ADR-103 Amendment 1 moves it to the shared capsule.
- Physical fit remains unverified until the named hardware cuts in ADR-106 are made.
