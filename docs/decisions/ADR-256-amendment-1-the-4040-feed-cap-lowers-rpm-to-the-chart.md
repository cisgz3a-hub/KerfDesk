## ADR-256 Amendment 1 - The 4040 feed cap holds, and RPM drops to meet the chart chip load (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13

Amends ADR-256 (4040 starter feeds revised). Follows ADR-233 Amendment 2, which added the Job
Review warning for a low chip load. Closes CNC audit finding FS-2, which the maintainer re-rated to
P2 on 2026-11-13 ("Re-rate FS-2/FS-5/JR-5 to P2").

### Context

ADR-256 set the Neotronics 4040 starter to 300 mm/min feed at 12,000 RPM from the maintainer's
experience on the physical machine. The material-recipe path caps its feed at the starter's
300 mm/min but kept the spindle at 12,000 RPM. With a 2-flute cutter that is
300 / (12,000 x 2) = 0.0125 mm/tooth: a fifth of the chart's 0.06 for a 1/8" bit in MDF, and 11%
of the chart's 0.11 for a 1/4" bit. At that chip load the bit rubs instead of cutting, which heats
and dulls it.

There were two ways to fix it: raise the feed cap, or keep it and lower the RPM. Asked to choose
on 2026-11-13, the maintainer chose **"Keep 300, lower RPM (Recommended)"**.

### Decision

1. **The 300 mm/min feed cap stays.** It is still the maintainer's value from ADR-256.
2. **A material recipe lowers RPM to meet the chart.** When the feed ceiling stops the recipe
   reaching the chart chip load, the RPM drops to
   feed ceiling / (flutes x chart chip load). It is rounded up to 50 RPM, so the chip load never
   exceeds the chart, and never goes below the spindle's minimum. For a 1/8" 2-flute bit at
   300 mm/min:

   | Material | Chart (mm/tooth) | RPM | Sent (mm/tooth) |
   | --- | --- | --- | --- |
   | Wood / MDF | 0.06 | 3,000 (2,500 floored) | 0.050 |
   | Hardwood | 0.04 | 3,750 | 0.040 |
   | Aluminium | 0.02 | 7,500 | 0.020 |

3. **The spindle minimum is the starter's.** The starter records `spindleMinRpm: 3000`, the
   500 W spindle's rated range of 3,000-12,000 RPM (the Neotronics spindle page the starter
   already cites). Only a starter that records its spindle's minimum lowers RPM. Every other
   machine keeps its feed cap without touching RPM, as before.
4. **The starter seed drops to 3,000 RPM.** It becomes revision 3: 300 mm/min feed, 250 mm/min
   plunge, 3,000 RPM and 0.75 mm per pass, which is 0.050 mm/tooth with the starter's 1/8"
   2-flute bit. Layers still carrying revision-2 starter provenance refresh to these numbers on
   the next setup action, as ADR-256 set out. Manual layers are untouched.
5. **A lowered RPM does not stick.** An operation whose RPM came from a recipe or a starter plans
   from the spindle's full speed when its material is applied or refreshed. Any hand edit already
   drops the feed source (ADR-233 decision 5), so this never overrides an operator. Without this,
   a layer lowered to 3,000 RPM for MDF would hold aluminium at 3,000 RPM too: 120 mm/min instead
   of 300. A hand-set RPM is still the upper bound for the recipe applied to it.
6. **The low-chip-load warning stays.** Where the 3,000 RPM floor still leaves the chip load
   under half the chart, Job Review says so (ADR-233 Amendment 2). For example, a 1/4" MDF bit
   needs 1,364 RPM to reach its chart at 300 mm/min. At 3,000 RPM it gets 0.050 mm/tooth, 45% of
   the chart's 0.11.

### Consequences

- Jobs on the 4040 profile with a material recipe or the machine starter now send S3000 to S7500
  instead of S12000, at the same feed. The chip load is 3 to 4 times what it was, which is the
  chart value, so the bit cuts rather than rubs.
- Cuts are no faster: the feed is unchanged. Only the spindle speed and the chip load change.
- The starter stays `unverified-starter`. The maintainer chose the policy, but there is still no
  attributable physical cutting record at 3,000 RPM.
- A 4040 fitted with the 710 W spindle variant, or one whose spindle stalls at 3,000 RPM under
  load, needs its own RPM. The starter notice already tells the operator to confirm the fitted
  spindle.
