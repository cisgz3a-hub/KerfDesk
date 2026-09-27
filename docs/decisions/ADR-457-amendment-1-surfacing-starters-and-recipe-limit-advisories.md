## ADR-457 Amendment 1 - Surfacing starters stay conservative and recipes reach the machine-limit advisories (2026-09-27)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-09-27

Amends ADR-457 items 1 and 6. The Frame-first Start contract (ADR-228) is unchanged: nothing here
adds a guard or a refusal. Every change is a starting value or an advisory.

### Context

A review of PR #959 found three gaps in the stage-recipe and surfacing work:

1. Item 6 seeded the Surfacing panel from the generic material calculator. That calculator is a
   slotting and profiling model: depth per pass is a material factor times the cutter diameter.
   For a 25.4 mm facing cutter in softwood it proposes 12.7 mm per pass, 4560 mm/min feed and
   1820 mm/min plunge. The surfacing defaults before ADR-457 were 0.5 mm per pass, 2500 mm/min and
   600 mm/min. The repo has no surfacing-specific feeds data that would justify the larger values.
2. Stage recipes emit their own feed, plunge and RPM, but the CNC machine-limit advisories
   (reported `$110`/`$111` max rate, `$112` Z max rate, `$30` spindle max and the configured
   spindle ceiling) only read the layer's own values.
3. Wall finishing with its own RPM keeps each part's rough/finish order, so the spindle changes
   speed twice per part (retract, `M3 S`, spin-up dwell each time).

### Decision

1. Surfacing starter values never exceed the earlier surfacing defaults:
   `min(calculator, 0.5 mm)` per pass, `min(calculator, 2500 mm/min, max feed)` feed and
   `min(calculator, 600 mm/min, max feed)` plunge (`surfacingStarterValues`,
   `src/core/cnc/surfacing.ts`). The calculator can lower a value for a slower material but can no
   longer raise one. RPM still comes from the calculator and the configured spindle ceiling.
   Values the operator types are not capped; they remain the operator's recipe.
2. The machine-limit advisories compare each output layer's stage recipes as well as the layer.
   A recipe counts only when its cutter is in the machine's tool library, since a recipe for an
   absent cutter cannot emit. The message names the source, for example "The Wall finishing
   recipe's plunge 1500 mm/min is above the machine's reported Z max rate ($112)". These stay
   Job Review advisories.
3. Wall finishing keeps its per-part order. Grouping all wall finishes after all roughing would
   remove the extra spindle changes, but it changes when each part is cut free relative to its
   finishing pass, which bears on workholding and tabs. That needs its own decision and a coupon
   test, so it is recorded as a follow-up and not changed here. Operators who want fewer spindle
   changes can give the wall-finishing recipe the roughing RPM.

### Verification

`src/ui/machine/surfacing-starter-values.test.ts` shows the 25.4 mm softwood calculator result
exceeds 0.5 mm per pass and that the seeded values stay at or below 0.5 mm, 2500 mm/min and
600 mm/min, with a lower calculator value kept and the machine max feed respected.
`src/ui/laser/cnc-machine-limit-warnings.test.ts` covers a wall-finishing recipe above `$110`,
`$112` and `$30`, the offline configured-ceiling comparison, and a recipe for a cutter outside the
library staying silent. No hardware result is claimed.
