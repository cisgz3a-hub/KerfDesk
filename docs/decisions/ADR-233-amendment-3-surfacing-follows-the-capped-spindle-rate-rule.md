## ADR-233 Amendment 3 - Surfacing follows the capped-spindle rate rule (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

Amends ADR-233 Amendment 1 (a capped spindle scales its feeds). Closes CNC audit v3 N7-P3-3, a
sibling of N6-P2-1.

### Context

Amendment 1 made layer, relief and registration groups cap S to the Spindle maximum and scale the
feed and plunge by the same ratio, so each tooth keeps its planned chip load. Surfacing kept its own
`Math.min` caps: a typed 24,000 RPM on a 12,000 RPM machine sent S12000 with the typed feed, twice
the chip load. The panel's "Output uses ... after machine limits" note repeated the same numbers.

### Decision

1. `surfacingSentRates` routes the typed feed, plunge and RPM through `cncCuttingRates`. The
   surfacing Save and the panel note both read it, so the note shows what the file sends.
2. When the spindle is capped, the note adds that feed and plunge are lowered by the same ratio to
   keep the chip load planned at the typed RPM.
3. **An invalid value is passed through unchanged.** For 0, a negative or a non-finite value, the
   shared rule would send F1; surfacing instead refuses it by name, as before.

### Consequences

- A surfacing program typed within the machine's limits is byte-identical.
- A typed RPM above the Spindle maximum runs slower, at the planned chip load.
