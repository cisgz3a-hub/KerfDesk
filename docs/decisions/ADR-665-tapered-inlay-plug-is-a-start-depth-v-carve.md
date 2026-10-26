## ADR-665 - A tapered inlay plug is a start-depth V-carve of its waste

**Status:** Accepted; software-verified with an independent height-field fit check, no material
or hardware trial yet. | **Date:** 2026-10-23

Fixes CNC audit v1 F5-P2-1 (`docs/audits/2026-10-23-cnc-v1/F5-cnc-inlay.md`), confirmed by an
independent refuter, and its P3 "no test seats the cut plug in the cut pocket". Implements the
geometry of the CNC leaders plan's C09 (`docs/audits/2026-10-08-cnc-leaders/IMPLEMENTATION.md`),
which names VCarve's V-inlay as the target. ADR-540 Amendment 6 (a tapered pair is a Pro V-carve)
is unchanged. Job Review findings stay warnings; Frame, Start and output policy are unchanged.

### Context

The tapered pair (`src/core/cnc/tapered-inlay.ts`) built the plug as a morphological opening of
the design: it shrank the source by the engagement inset `E·tan(θ/2) + c` (`plugTop`), then
V-carved the waste around `plugTop` from Z0. Shrinking keeps a convex corner sharp, but the cone
grows it back round, and anything narrower than twice the inset disappears. The pocket kept both.

- The plug lost convex corners and narrow parts. The refuter measured voids of 0.60 mm at square
  corners and 2.6 mm and 4.4 mm at star tips; 30 mm Roboto "AB" on a 60 degree bit lost 79% of its
  letters; 25 mm "AB" on 60 degrees and 40 mm "AB" on 90 degrees were refused outright ("No source
  detail is wide enough").
- Job Review printed the lost area as "cannot be reproduced at the nominal engagement", which
  suggested a setting would fix it. None did.
- No ADR recorded this geometry.

VCarve and Carbide Create cut the plug differently. Vectric's help defines Start Depth as the
depth a V-carve toolpath is calculated from
(https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/form/VCarve%20Toolpath%20Creator/). For an
inlay plug it is how far the plug enters the pocket before the design lines up, and
glue gap = pocket depth − plug start depth (Carbide 3D community guides, e.g.
https://community.carbide3d.com/t/vcarve-inlays-with-vcarve-desktop-details-and-discoveries/6552).
Their forums also report the cost: a V-carve with a nonzero start depth plunges straight to it,
and users add a V-carve from 0 to the start depth first
(https://forum.vectric.com/viewtopic.php?t=38528).

Geometry, with slope `s = tan(θ/2)` and `d` the distance from the source outline: the pocket is
cut `min(P, d/s)` deep inside the design. A V-carve of a region with every tool tip `T` lower cuts
`T − d/s` into the area outside that region. So V-carving the plug's waste (the border minus the
mirrored design) from `T = E + c/s` cuts the design `T − d/s` deep: the pocket wall, offset by the
radial gap `c`, on every corner and every detail however narrow. Seated, the walls touch when the
plug's top is `T` into the pocket.

### Decision

1. **The plug is the waste V-carved from a start depth.** The waste is the plug border minus the
   whole normalized source, mirrored as before. The start depth is
   `T = engagement + radial fit gap / tan(θ/2)` (`taperedInlayWallStartDepth`). The carve's flat
   depth is the plug depth minus `T`, so the waste floor stays at engagement + surface
   clearance. The opening, `plugTopContours`, `lostDetailContours`, `lostDetailAreaMm2`,
   `engagementInsetMm` and the "cannot be reproduced" finding are removed. The old construction is
   not kept as a mode: it had no advantage, and its loss no setting could remove.
2. **No level cuts deeper than the depth per pass.** The waste is planned once, at its flat depth.
   Every plug level is that one plan, no deeper than its first wall level and shifted down from
   the stock top in depth-per-pass steps until it reaches `T`. The wall levels follow, stepped
   the same way. One plan keeps every level's routes and floor ridges in the same place. Two
   plans, one shallow and one at the wall, put their V-bit floor ridges (pitch / (2·s) high, about
   0.09 mm here) in different places, and the measured cut reached 0.31 mm at 0.25 mm per pass.
   When the whole plug fits in one pass, it is cut in one.
3. **A fit gap needs room above the waste floor.** If `c / s` reaches the surface clearance, the
   plug walls would start deeper than the waste floor, so the pair is refused with "Surface
   clearance must be more than … mm, the depth the radial fit gap adds to the plug walls on this
   V-bit." The previous construction had the same limit without naming it.
4. **The settings say what the fit gap does.** On a taper a radial gap cannot stay open: the plug
   sinks `c / s` deeper until the walls touch, which uses that much of the glue gap (audit P3).
   The field tooltip says so. The panel no longer promises a Job Review report of lost engagement
   geometry; it says the plug is V-carved from a start depth.
5. **Narrow-feature warnings skip the tapered pair.** It V-carves its detail into both pieces, like
   a V-carve operation (ADR-433 Amendment 2).

### Consequences

Measured with the refuter's oracle (`f5-oracle.mjs`: its own G-code parser, exact cone sweep and
distance transform, no app code), at a 0.03 mm grid, with the plug aligned by the known mirror:

| Case | Before | After |
|---|---|---|
| 30 mm "AB", 60 degrees, default settings: emitted pair, widest void at the surface | 11.83 mm, 232.7 mm² | 0.03 mm (one cell), 1.44 mm² |
| 25 mm "AB", 60 degrees | refused | compiles; 0.03 mm |
| Square with a counter, 60 degrees, `c` 0.3, glue 0.2: plug vs the exact start-depth plug | 1.02 mm deeper at corners | 0.022 mm |
| Same, 90 degrees, `c` 0.6 | 1.02 mm | 0.012 mm |

In the AB pair the plug seats 0.015 mm short of its designed 2.587 mm. In the counter cases the
face meets the pocket floor first (`c / s` exceeds the glue gap), so a real radial gap of the
designed size remains, as for the exact plug.

`src/core/cnc/tapered-inlay-fit.test.ts` seats the emitted plug of a square with a counter, a
five-point star and a 0.5 mm stroke at 60 and 90 degrees (grid 0.025 mm, its own height fields):

- In the exact V-carved pocket the plug seats within 0.008 mm (60) and 0.0065 mm (90) of its
  designed seat, and its widest gap is 0.035 mm, one diagonal cell. On the old planner the widest
  gap was 4.6 mm (the stroke and the star tips) at 60 degrees, and the plug sank 0.052 mm too deep
  at 90 degrees.
- In the emitted pocket the plug stops 0.069 mm (60) and 0.075 mm (90) short. The cause is the
  pocket's flat-floor inside-corner fins next to the counter (audit F5-P2-2, fixed separately
  under F1-P2-1), which stop it with star-tip gaps of 0.125 and 0.23 mm. The test asserts that the
  shortfall is no larger than the pocket's undercut at the first contact plus 0.02 mm, so it
  requires the seam to close once the fins are cleared.
- No plug move deepens the stock by more than the depth per pass; no pocket move by more than
  that plus the V-carve's 0.01 mm sweep tolerance.

The plug has at most one level more than before: `ceil(T / pass) + ceil((plug depth − T) / pass)`
against `ceil(plug depth / pass)`. The defaults (2.5 mm engagement, 1 mm surface clearance,
0.05 mm fit, 1.5 mm per pass, 60 degrees) give three levels either way.

Not changed: the plug border rule; the pocket; the straight pair (ADR-155). Fit, glue and cutter
deflection still need a matched trial in material, as the existing finding says.
