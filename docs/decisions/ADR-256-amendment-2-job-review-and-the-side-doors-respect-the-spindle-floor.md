## ADR-256 Amendment 2 - Job Review and the card's side doors respect the spindle floor (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

Amends ADR-256 Amendment 1, which gave the Neotronics 4040 starter a 3,000 RPM spindle floor.
Closes CNC audit v3 P3s N7r-P3-1 and N7r-P3-2, both found in that amendment's verification.

### Context

- **N7r-P3-1.** The low-chip-load warning (ADR-233 Amendment 2) always advised "raise the feed,
  or lower the spindle speed". A 1/4" MDF recipe on the 4040 already runs at the 3,000 RPM floor,
  so a lower speed was not on offer. A hand-typed RPM under the floor got no warning at all.
- **N7r-P3-2.** Amendment 1 lets an automatic RPM plan from the spindle's full speed, so a speed
  lowered for one material does not hold down the next. Two callers were missed: the "Use
  <material> values" button after a bit change and a stage recipe's material starter. On a
  starter-seeded layer at S3000, a 1/16" aluminium recipe came out at S3000 F60 from them and
  S12000 F250 from the Material picker. The chip load matched the chart either way, but the same
  bit and material got two recipes.

### Decision

1. `cncSpindleMinRpm(profile)` returns the floor recorded by the profile's starter, if any.
2. **At the floor, the advice changes.** When a group's S is at or below the floor, the
   low-chip-load warning says the spindle is already at its minimum and offers what is left: a
   higher feed if the machine can take it, or a smaller bit, whose chart chip load is lower.
3. **Under the floor, Job Review says so.** The machine-limit review names the slowest operation
   or stage recipe under the floor, with and without a compiled job. A 0 RPM spindle is still
   refused by preflight (ADR-233 Amendment 1).
4. **Both side doors pass `automaticSpindleRpm`.** They now share the rule in
   `cnc-material-starter-patches.ts`. An RPM is automatic when the operation still has a feed
   source; any hand edit clears it. For a stage recipe, the RPM must also be the operation's own:
   a stage RPM typed separately stays hand-set and stays the upper bound.

### Consequences

- Profiles whose starter records no floor are unchanged.
- The floor is the starter's assumption about the fitted spindle. The warning says so and asks the
  operator to confirm a spindle that runs slower.
