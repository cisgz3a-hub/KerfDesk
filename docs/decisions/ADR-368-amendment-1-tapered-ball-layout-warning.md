## ADR-368 Amendment 1 - A tapered ball nose that sets offsets or stepover gets a Job Review warning (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

ADR-368 models a tapered ball nose by its ball tip and taper for relief finishing, the simulators
and removal stamping. Item 4 still treats it like any other non-flat cutter in layout: pocket and
profile offsets, and relief roughing stepover, use the stored `diameterMm`. For this bit that is
the widest diameter, at the top of the flutes.

At ordinary depths the bit cuts far narrower. With a 6.25 mm top and a 1/16" tip:

- a 6 mm outside profile comes out about 1.8 mm oversize per side, with a tapered wall;
- a 3 mm pocket's walls land about 2 mm inside the line, with ribs between the rings;
- relief roughing leaves ribs.

Nothing warned. The 2026-09-25 audit of PRs #845-#904 found this (CNC-1).

### Decision

1. Job Review warns when an output operation's main bit is a tapered ball nose and that bit sets
   the layout: an outside profile, an inside profile, a pocket, or relief roughing. The warning
   names the bit, the diameter used and the effect, and suggests a flat end mill or the 3D removal
   preview.
2. On-path profiles, engraves, V-carves and drills do not warn, because their offsets do not use
   the diameter.
3. Compilation is unchanged, and the warning never blocks save or Start (PROJECT.md
   non-negotiable 21).

### Consequences

- An operator who chooses a tapered ball nose for a cutout or a pocket is told before cutting.
- Basing offsets and stepover on the cut width at depth for non-flat bits, which would make the
  output right rather than warned about, remains a follow-up.
