## ADR-233 Amendment 2 - Chip load is continuous in bit diameter, and Job Review checks depth and low chip load against the bit (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13

Amends ADR-233 (machine-aware CNC starters and automatic feeds) and the feeds calculator of
ADR-103 G5. Follows Amendment 1. The maintainer re-rated three known CNC catalogue findings to P2
on 2026-11-13 ("Re-rate FS-2/FS-5/JR-5 to P2"): FS-5 and JR-5 from the 2026-09-24 CNC audit, and
the warning half of FS-2. Adds no Start guard: every check here is a Job Review advisory.

### Context

- **FS-5.** The chip-load chart was looked up in stepped bands at 1.5, 3.175 and 6.35 mm. A 1/8"
  bit measured at 3.18 mm took the 1/4" value, so its hardwood feed jumped from 960 to 2,400
  mm/min. A 1/16" bit took the 1/8" value. A 0.5 mm bit took 0.03 mm/tooth in softwood, 2.4x the
  per-diameter guide of about 0.025 x D.
- **JR-5.** No starter or catalogue bit records a flute length, so the reach review (ADR-572)
  never compared a depth with one. A 1/8" end mill cutting 19 mm deep, or a single 4 mm pass,
  got no warning. The layer card's own hint says up to half the bit's diameter per pass in wood.
- **FS-2.** On the Neotronics 4040 profile the starter's 300 mm/min caps every material recipe
  while the spindle stays at 12,000 RPM, so a 1/4" MDF recipe sends 0.0125 mm/tooth, 11% of the
  chart. At that chip load the bit rubs instead of cutting. Nothing said so.

### Decision

1. **The chart is continuous in diameter.** Each chart value is the chip load for a bit of
   1.5, 3.175, 6.35 or 12.7 mm. Between two of them `chiploadFor` interpolates linearly. Below
   1.5 mm it scales with the diameter, as the per-diameter guide does. Above 12.7 mm it holds.
   The chart's own values are unchanged, so a 1/8" or 1/4" bit gets the same recipe as before.
   A 1/16" hardwood recipe at 12,000 RPM now sends F510 (0.021 mm/tooth) instead of F960.
2. **Job Review checks depth against the bit** (flat and ball-nose cutters only):
   - a depth per pass greater than the bit's diameter;
   - for a bit with no recorded flute length, a cut deeper than three times its diameter.
     Standard-length end mills have flutes about that long: a regular 1/8" end mill has 3/8" to
     1/2". The warning asks the operator to record the bit's flute length. With one recorded, the
     reach review compares the depth with it exactly, and this guide stays quiet.
3. **Starter bits do not get an invented flute length.** The starters name a size, not a
   product. Published flute lengths for a 1/8" two-flute end mill run from 3/8" (regular length)
   to 1/2" (router style), so any single value would be a guess recorded as a measurement. A
   recorded flute length would also turn on the full assembly review, with its unknown-stickout
   and disclosure lines, for every job. The diameter guide in item 2 covers the gap until the
   operator records their bit.
4. **Job Review names a low chip load.** Where a group's feeds came from a material recipe or a
   machine starter, the chip load the program sends is compared with the chart value for that
   bit and material. Under half the chart value, Job Review names both numbers, the feed and RPM
   behind them, and that the bit rubs rather than cuts. Hand-set values are not compared: no chart
   claim was made for them.

### Consequences

- Recipes for bits between the chart diameters change: smaller bits get lower feeds, and a bit
  just over 1/8" or 1/4" no longer jumps to the next band. Bits at the chart diameters are
  unchanged.
- Jobs on the Neotronics 4040 profile with a material recipe for a bit larger than the starter's
  1/8" show the low-chip-load warning until the cap itself changes. Raising the cap, or lowering
  RPM with it, is the rest of FS-2 and waits for the maintainer's choice, since ADR-256 records
  the 300 mm/min and 12,000 RPM as the maintainer's own values.
- None of this is hardware qualification: the chart is provisional, the chip load shown is the
  programmed nominal value, and the depth guide is a rule of thumb, not the bit's real length.
