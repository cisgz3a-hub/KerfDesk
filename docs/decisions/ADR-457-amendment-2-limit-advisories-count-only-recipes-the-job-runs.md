## ADR-457 Amendment 2 - Limit advisories count only the recipes the job runs, and name the layer (2026-09-29)

**Status:** Accepted; software-verified through unit tests, hardware qualification pending. |
**Date:** 2026-09-29

Amends ADR-457 Amendment 1, decision 2. The Frame-first Start contract (ADR-228) is unchanged:
these remain Job Review advisories.

### Context

Amendment 1 made the CNC machine-limit advisories compare each output layer's stage recipes as
well as the layer, counting a recipe whenever its cutter is in the tool library. A layer keeps
recipes its current cut type does not use (ADR-481 decision 2: "Bindings the current cut type does
not use are kept"), and the compiler applies a recipe only to a stage cut with that recipe's cutter
(`cncStageRecipe`, `src/core/cnc/cnc-stage-settings.ts`). The second CNC audit
(`docs/audits/2026-09-29-cnc-audit-second-pass.md`, P2-review-4 and P2-advcam-2, reproduced)
showed the result: a profile layer at 1000 mm/min, 300 mm/min and 12,000 RPM with a leftover
V-carve clearing recipe of 5000/1500/18,000 got four advisories about values the program never
sends (it sends F300 to F1000 and S12000). A pocket whose roughing bit was removed, or that was
switched to Adaptive, kept warning about its hidden roughing recipe. None of the messages named
the layer.

### Decision

1. **With the compiled job, a recipe counts only where the job ran its stage.** Every compiled
   group that used a recipe carries its `cuttingStage`; a recipe is compared when a group of its
   layer carries that stage. Without a compiled job the Amendment 1 rule stays (cutter in the tool
   library), since that path has nothing better to go on. The Job Review, Save and Start paths pass
   the compiled job whenever they have one.
2. **Every advisory names its layer**, for example `Layer "Outline" requests feed 4000 mm/min,
   above the machine's reported max rate 3000 mm/min` and `The Wall finishing recipe on layer
   "Outline" requests feed 5000 mm/min, above ...`. The feed and plunge messages now use the same
   "requests" wording as the spindle messages.

### Verification

`src/ui/laser/cnc-machine-limit-warnings.test.ts` compiles a profile layer with a leftover V-carve
clearing recipe: no advisory with the compiled job, the four old advisories without it. A Wall
finishing recipe on a layer with a finish allowance is still compared and named with its layer, and
a layer's own feed names the layer. Without the change these three cases fail. No hardware result is
claimed.
