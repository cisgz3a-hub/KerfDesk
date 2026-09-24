## ADR-238 Amendment 2 - Generic Scan Line uses the operator's full Overscan (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the 2026-07-28 ADR-238 amendment (generic Scan Line every-sweep runway). Changes nothing
in ADR-234's 4040-safe policy, ADR-236 Island Fill or ADR-239 contour entries.

### Context

The Fill Overscan field accepts up to 25 mm. The 2026-07-28 amendment gives every generic Scan
Line sweep a laser-off entry and exit at burn feed and prevents overlap by sharing each split gap
between the two runways. It chose no generic length cap. The implementation, however, sized those
runways with ADR-234's 4040-safe helper, `min(configured, 5 mm)`, so any positive Overscan above
5 mm compiled to 5 mm with no notice. A LightBurn import at 2.5% of 400 mm/s converts to 10 mm and
was cut to 5 mm the same way. The LightBurn gap audit of 2026-09-24 found the mismatch.

### Decision

1. A positive stored Overscan is the generic Scan Line runway: in full at each scanline's outer
   entry and exit, and `min(Overscan, gap / 2)` on each side of a split, with a laser-off rapid
   across any unused centre of a wider gap.
2. A stored value of zero or below, or a non-finite one, still resolves to the 5 mm default.
3. The 4040-safe Scan Line entry keeps ADR-234's 5 mm bound. The Overscan field shows that bound
   beside a larger stored value ("stored 10; 4040-safe Scan Line uses up to 5 mm") in the Cut
   Settings dialog and the operation inspector.
4. Output, preview, Frame motion bounds, optimisation and the time estimate keep reading
   `planFillSweeps`, so they agree. Preflight keeps reporting runways that leave the bed and
   accepts marked runways up to the configured Overscan.

### Consequences

- Output at the 5 mm default and below is byte-identical to before.
- Above 5 mm, a split gap up to twice the Overscan is crossed entirely by marked `G1 S0` runways
  at burn feed where part of it used to be a rapid. ADR-035's concern was faint lines from long
  laser-off feed moves on diodes; a longer Overscan is now the operator's explicit choice, and its
  burn quality is not yet hardware-verified.
- Job Review's heat-risk label on the 4040 still reports the requested Overscan rather than the
  5 mm used (ADR-236 asks it to report requested values). A follow-up can label the bound there.
- Raster Image overscan stays fixed at 5 mm; making it configurable is tracked with the
  LightBurn gap audit's "Overscan you can set" item.
