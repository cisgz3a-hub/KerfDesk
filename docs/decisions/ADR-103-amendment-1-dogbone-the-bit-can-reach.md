## ADR-103 Amendment 1 - The Dogbone tool relieves corners with a capsule the bit can reach (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

G6 shipped the Dogbone tool (F-CNC26) as a PROVISIONAL "corner overcut": a circle of one bit
radius centred on each sharp convex corner of the cut region. The Box Generator audit (ADR-106
Amendment 1) showed that a round bit can cut that circle only with its centre exactly on the
corner. That is an isolated point, which pocket and inside-profile compensation skip. Measured on
the inside-profile toolpath, the bit centre stopped exactly where it stopped without the tool
(for example 4.49 mm from each corner of a square slot with a 6.35 mm bit), for 45°, 60°, 90° and
120° corners alike. The tool drew a relief and changed nothing that was cut.

### Decision

1. Each relieved corner gets the shared capsule from `corner-dogbone.ts` (ADR-106 Amd 1):
   radius bit radius + 0.05 mm, from the centre one bit radius from the corner along the region's
   inward bisector out to the centre where the bit meets both walls (r / sin(θ/2)). It is unioned
   into the region at 1e-3 mm precision.
2. Corner selection (convex corners of outer boundaries sharper than 135°, islands untouched)
   and the tool's errors and undo behaviour are unchanged.
3. Tests judge the tool on the inside-profile toolpath: the bit centre passes within one radius
   of every relieved corner in a single loop.

### Consequences

- The Dogbone tool now changes the toolpath: a square slot's corners are reached, so a square
  part seats fully. Acute corners get a longer relief along their bisector, because that is how
  far a round bit has to travel to touch them.
- The capsule is up to 0.05 mm wider than the bit's own sweep, so walls next to a relieved corner
  can be cut up to 0.05 mm deeper over a short stretch.
