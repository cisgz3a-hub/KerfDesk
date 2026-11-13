## ADR-233 Amendment 1 - A capped spindle scales its feeds, and a spindle at 0 RPM refuses output (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13

Amends ADR-233 (machine-aware CNC starters and automatic feeds) and records two compile-integrity
consequences under ADR-228 rule 7. Leaves the frame-first Start contract (ADR-228, ADR-230,
ADR-232, ADR-565) unchanged: the only new refusal is a program that cannot be produced truthfully.
CNC audit v3, area N6 (`docs/audits/2026-11-13-cnc-v3/N6-cnc-review-truth.md`), findings
N6-P2-1, N6r-P2-1, N6-P3-1 and N6-P3-2.

### Context

A CNC feed is a chip-load decision made at a spindle speed: feed = RPM x flutes x chip load
(`feeds-calculator.ts`). ADR-233 decision 3 already keeps that relationship for automatic material
values: when the machine's Spindle maximum or a live cap lowers the RPM, the material feed is worked
out again at the lower RPM.

Every compile site also capped the S word to Spindle maximum (`capSpindle`) when a layer asked for
more, but kept the layer's feed. That happens for a hand-set layer after the ceiling is lowered (a
machine preset, Machine Setup, Use detected values), for a project opened from a faster machine,
for a stage recipe (ADR-457, whose fields have no maximum) and through the remote or MCP
`update_operation`. Each tooth then took the planned chip load times the ratio. A 1/16" end mill
planned at 24,000 RPM and F1440 (0.030 mm/tooth) on a 9,000 RPM Genmitsu 4040-PRO ran at
`S9000 F1440`, 0.080 mm/tooth: 2.7x the repo's own chart for hardwood and aluminium. Job Review said
only that the spindle setting was limited, and advised checking the controller-to-spindle scale.
It showed a chip load only for a bit with a flute count, and no starter bit had one.

Separately, the remote and MCP operation schemas accepted `spindleRpm: 0`. The program then held
`M3 S0` followed by cutting moves, so the bit plunged into the stock without turning. Preflight
listed "spindle RPM must be greater than 0" as an advisory. The July 2026 commit that removed the
over-ceiling refusal (b1e5408b3) had kept this one on purpose, as compile integrity, but the code
later reported it under the advisory `cnc-settings-invalid` code, so Save and Start went ahead.

### Decision

1. **A capped spindle scales its feeds.** When an operation asks for more RPM than the machine's
   Spindle maximum, the compiler sends S at the maximum and multiplies the feed and plunge by
   (maximum / requested). It then caps both to CNC Max feed as before. Each tooth keeps the chip
   load planned at the requested RPM, and the job runs slower. One rule (`cncCuttingRates`,
   `src/core/cnc/cnc-cutting-rates.ts`) serves every compile site: the 2D pass groups (layers and
   stage recipes), relief groups and tile registration bores. A request at or under the maximum
   compiles exactly as before.
2. **The program and Job Review say what was capped.** A capped group records what the operation
   asked for (`spindleCap`: requested RPM, feed and plunge). The program carries a
   `; cnc spindle-capped:` comment with those values. Job Review's operation line shows the sent RPM,
   the request it was capped from, and the lowered feed and plunge. The machine-limit warning says
   the program sends S at the maximum, lowers the feed and plunge by the same ratio and keeps the
   planned chip load, and that setting the spindle to the maximum or reapplying the material plans
   at the speed the machine runs. It no longer points at the controller-to-spindle scale.
3. **A live `$30` below the sent S is a chip-load warning.** The program is compiled without the
   live controller settings, and ADR-362 item 6 holds that `$30` is the S value for full output, not
   always an RPM (a hybrid laser reports 1000). So the compiler does not scale for it. The warning
   says that if `$30` is the spindle's real top speed, each tooth takes S / `$30` times the planned
   chip load, and that setting Spindle maximum to `$30` in Machine Setup makes KerfDesk lower the
   feeds to match.
4. **Starter bits carry a flute count.** The starter end mills, the downcut and compression bits
   and the ball noses carry the two flutes the automatic feeds already assumed for them
   (`DEFAULT_ASSUMED_FLUTE_COUNT`), so planned feeds do not change and Job Review shows each
   operation's chip load. V-bits carry none: their cutting diameter changes with depth, so a chip
   load at the full diameter would not describe the cut. Saved projects keep the tools they were
   saved with; this changes only new machines and projects.
5. **A spindle at 0 RPM refuses Save and Start.** A cutting group whose S is 0 or less raises
   `cnc-spindle-off`, which is in `COMPILE_INTEGRITY_PREFLIGHT_CODES`. This is rule 7's compile
   integrity, not a policy judgment: a program that starts the spindle at S0 and then cuts is not
   the operation the layer describes, and no truthful program for it exists. With the compiled job,
   only a group that actually cuts counts, so an empty layer at 0 RPM does not refuse. The remote
   and MCP operation schemas now take the layer card's floor, 1000 RPM, so the value cannot be set
   that way.
6. **Advisories read what the program sends.** A stage recipe's feed or plunge above CNC Max feed
   gets the same preflight advisory as the layer's, named "The <stage> recipe on layer ..."
   (N6-P3-1). The machine-limit warnings compare the compiled groups' own feed, plunge and S words
   when the compiled job is available, so a layer with no artwork and a drill cycle's never-sent
   XY feed no longer warn (N6-P3-2). Without the compiled job they work the values out through the
   same rule and skip layers with no artwork. The generic-starter-feed advisory skips layers with no
   artwork too.

### Consequences

- A layer above the ceiling cuts slower and at its planned chip load. A layer at 12,000 RPM and
  F1000 (the generic default) on a 9,000 RPM preset now sends `S9000 F750` instead of `S9000 F1000`.
- Output for every request at or under Spindle maximum is unchanged, apart from the new
  `; cnc tool-flutes: 2` comment line for jobs cut with a starter end mill or ball nose.
- A cutting preset saved against a starter bit before this change records no flute count, so its
  tool context now reads as different from the same starter bit in a new project. That is an
  existing informational finding, not a refusal.
- The one new refusal (`cnc-spindle-off`) needs a spindle speed at or below 0, which the layer card,
  project load and stage-recipe validation already prevented; it now also covers the remote and
  MCP path and any future one.
- None of this is hardware qualification. The chip load shown is the programmed nominal value, not
  a measured one, and the flute count is an assumption the operator corrects in the bit library.
