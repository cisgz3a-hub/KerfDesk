## ADR-258 Amendment 1 - Default tabs apply only where the cut can free the part (2026-09-24)

**Status:** Accepted. The maintainer chose it on the 2026-09-24 settings audit. | **Date:** 2026-09-24

### Context

ADR-258 defaults CNC holding tabs on for profile cuts and gates them on one thing: the cut must
be deeper than the tab (`passNeedsTabs`, `depthMm > tabHeightMm`). It never compares the cut with
the stock. So a 4 mm decorative outline in 19 mm stock gets four 2 mm bridges at the bottom of
its groove. They hold nothing, because the 15 mm floor under the groove already holds the part,
and they leave four bumps the operator has to clean out or remember to switch off per layer.

The trigger ADR-258 set out to match is Easel's. EASEL-STUDY D-14 records Easel's documented
rule (*How To Use Tabs*, https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs):
tabs are added automatically when the cut depth of an outline shape equals the material
thickness. The same entry already named the follow-up this amendment makes: "scoping tabs to
passes that genuinely reach through-depth".

### Decision

A profile keeps its default-on tabs only when the floor left under the cut is thinner than one
tab height: `stockThicknessMm - depthMm < tabHeightMm` (`cutCanFreePart`, `cnc-tabs.ts`). A floor
at least one tab tall is a continuous bridge around the whole shape, which holds the part better
than any set of tabs.

- **Where it applies.** `passesForCncLayerWithEvidence` passes the layer settings through
  `settingsWithStockTabGate` before any pass is built, so roughing passes, finishing-allowance
  passes and the tab-aware ramp entry all see the same answer. ADR-258's depth rule still runs
  inside `passNeedsTabs`, unchanged.
- **Tolerance, not equality.** Easel's rule is depth equal to thickness. Here a cut that stops
  just short of the stock bottom still gets tabs, so a stock thickness entered a little thicker
  than the real sheet cannot silently drop the tabs from a real through-cut.
- **The shipped stock thickness means "not set".** A project still carrying the default 6.35 mm
  stock is indistinguishable from one whose operator never entered the thickness, the same
  reasoning `controller-profile-compatibility.ts` applies to the stock receive window. On that
  value any cut may go through, so the gate is off and ADR-258's depth-only rule decides, exactly
  as before this amendment.
- **Job Review says so.** The layer's detail line keeps the configured tabs and adds
  "skipped: the N mm floor holds the part", so the operator never reads tabs that will not be cut.

### Alternatives considered

- **Easel's exact rule, depth ≥ thickness.** Rejected: an operator who types a through depth for
  a 6 mm sheet while the stock still says 6.5 mm would lose every tab and free the part under a
  running spindle, with no advisory, since the through-cut warning keys off the same thickness.
- **Keep ADR-258 as is and warn about shallow tabs.** Rejected: the bumps are the default outcome
  for every decorative profile deeper than 2 mm, and a warning the operator must act on every
  time is the friction the defaults exist to remove.

### Consequences

- G-code changes only for a project whose stock thickness has been set away from the default and
  whose profile leaves at least a tab height of floor. Every tabbed pass in the existing test
  suite runs on the default stock and is unchanged.
- The straight inlay pair keeps its own tab handling. Its plug is cut from separate stock, so the
  job's stock thickness says nothing about whether the plug profile goes through.
- The through-cut advisory (`cnc-through-cut-tab-warnings.ts`) and the full-coverage advisory are
  unchanged. A gated layer cuts below its tab top, so the coverage advisory stays silent for it.

### Verification

- `compile-cnc-stock-tab-gate.test.ts` pins: no tab rises on a 4 mm profile in 19 mm stock; tabs
  on a through-cut and on an 18 mm cut in 19 mm stock; tabs on the 4 mm profile when the stock is
  still the shipped default; a floor exactly one tab tall counts as holding the part.
- `job-review-detail-facts.test.ts` pins the "skipped" wording and its absence on a through-cut.
