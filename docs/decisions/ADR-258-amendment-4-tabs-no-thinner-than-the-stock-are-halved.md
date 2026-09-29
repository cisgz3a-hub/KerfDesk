## ADR-258 Amendment 4 - A tab no thinner than the stock is cut half the stock thick, and Job Review reads tabs from the compiled passes (2026-09-29)

**Status:** Accepted; software-verified through compile and Job Review tests, hardware
qualification pending. | **Date:** 2026-09-29

Amends ADR-258 and its Amendments 1 and 3. Frame remains the sole ordinary Start policy gate
(PROJECT.md non-negotiable 21): every Job Review change here is a warning or a detail line.

### Context

Amendment 3 puts a kept tab's top one tab height above the stock bottom when Stock thickness is
set. The pass builders measure a tab up from the cut floor, so `settingsWithStockTabGate` hands
them a height of tab + depth - stock, and `passNeedsTabs` keeps a tab only when the cut is deeper
than that. That holds only while the stock is thicker than the tab.

The second CNC audit (P2-toolpath-2, high, reproduced from the emitted G-code with an independent
stock model) found that a through cut or overcut whose tab is at least as thick as the stock gets
no tabs at all: the default 2 mm tabs on 2 mm or thinner acrylic, plywood or aluminium sheet, or
3 mm tabs on 3 mm stock. Before Amendment 3 (79677497), on 490708cf, the same overcuts kept thinner
tabs: 1.7 mm for a 2.3 mm cut in 2 mm stock, and 2.8 mm for 3 mm tabs cut 3.2 mm into 3 mm stock.
A 2 mm cut in 2 mm stock with 2 mm tabs had none there either, since a cut must go deeper than its
tab. Job Review still listed "tabs 4 per shape (6 × 2 mm) above the stock bottom", the overcut
warning dropped its tab sentence, and a cut equal to the stock raised no warning. The overcut note
was also built from the layer settings, so it told an open on-path line through 6 mm stock "Its
holding tabs stay 2 mm thick above the stock bottom", though an open path never gets a tab.

This breaks Amendment 3's own consequence, "Cutting a little deeper to be sure of a clean through
cut no longer weakens or removes tabs, as long as Stock thickness is set", and the reason tabs
exist (Easel, *How To Use Tabs*: "When you are cutting out a design entirely from your material,
there is a risk that your design will break free and become damaged by the bit").

### Decision

1. **A tab no thinner than the set stock is cut half the stock thick.** A requested tab height at
   least the stock thickness would reach the stock top, where no pass can cut over it. The
   compiler cuts it half the stock thick instead (`stockLimitedTabHeightMm`, `cnc-tabs.ts`),
   still standing on the stock bottom, so it does not change with the cut depth. 2 mm tabs on
   2 mm stock are 1 mm bridges for a 2, 2.3 or 3 mm cut; 3 mm tabs on 3 mm stock are 1.5 mm. A
   tab thinner than the stock keeps its requested height, as in Amendment 3, and the shipped
   stock thickness still reads as never set and keeps the cut-floor rule.
2. **The floor rule compares the floor with that thinned tab** (`cutCanFreePart`, Amendment 1).
   A groove whose floor is at least half the stock thick holds the part and skips its tabs. The
   compiler cut no tabs there before either; Job Review now says "skipped" instead of listing
   them.
3. **Job Review reads tabs from the compiled passes.** A tab is the same-XY vertical rise
   ADR-258 made it, and `compiled-tab-rises.ts` finds the operations whose profile passes climb
   one. The operation line drops its tab part when a cut deep enough for tabs compiled none:
   every path it cut is open, or its tab windows swallow every loop, which the full tab coverage
   advisory already reports (AUDIT A5). The spoilboard overcut warning says something about tabs
   only when a pass rises into one. Both say when a tab was thinned: "tabs 4 per shape
   (6 × 2 mm) above the stock bottom, thinned to 1 mm (half the 2 mm stock)" and "Its holding
   tabs are 1 mm thick above the stock bottom, thinned from the 2 mm set to half the 2 mm stock".
4. **A through cut with Tabs on still warns when no tab can be cut.** On the shipped stock a tab
   at least as tall as the cut is still dropped (ADR-258). The through-cut warning now names that
   case for an operation that carries a closed shape; before, it fired only with Tabs off.
5. These are warnings and detail lines only. Nothing blocks Frame, Start or a save.

### Alternatives considered

- **Fall back to the cut-floor rule when the tab reaches the stock top.** This restores
  490708cf's thinner tabs on an overcut, but a cut exactly as deep as the stock still gets none,
  and the tab thins again as the cut deepens, which Amendment 3 removed.
- **Clamp the tab just below the stock top.** Almost the whole sheet is a bridge the cutter
  barely skims and a part that has to be sawn out. Half the sheet holds the part, frees it
  easily, and is simple to state in Job Review.
- **Limit every tab to half the stock.** This would change tabs that work today, such as 2 mm tabs
  on 3 mm stock, which the audit did not find wrong.

### Consequences

- G-code changes only for tabbed profiles on a set stock whose tab height is at least the stock
  thickness and whose cut goes deeper than half the stock: they now carry tabs. The emitter
  revision is advanced once for the audit's whole change set, not in this change.
- The thinned tab relies on Stock thickness being right, as Amendment 3's tabs already do.
- An open path cut through the stock with Tabs off keeps the older "no holding tabs" warning; that
  wording was not part of this finding.

### Verification

- `compile-cnc-stock-tab-gate.test.ts` compiles a 40 mm square. With 2 mm stock cut 2 and 2.3 mm
  deep and 2 mm tabs, 3 mm stock cut 3.2 mm deep and 3 mm tabs, and 1.5 mm stock cut 1.7 mm deep
  and 2 mm tabs, the deepest pass reaches the full depth and climbs four tab walls to half the
  stock. The old rule fails every case. On 2 mm stock the tab top stays at Z-1 for 1.6 to 3 mm
  cuts, and a 1 mm groove skips its tabs.
- `compiled-tab-rises.test.ts` finds the tab walls through leads, ramp entries and on-path cuts,
  and none for tab-less, skipped, open-path or pocket operations.
- `cnc-through-cut-tab-warnings.test.ts` covers the thinned overcut sentence, silence for a cut
  that stops on the stock bottom, no mention of tabs for an open line through 6 mm stock, reading
  the compiled job it is given, and the through-cut warning for 8 mm tabs on a 6.35 mm cut. Its
  two Amendment 3 overcut tests now cut a closed square, because the note reads the compiled
  passes; their expected text is unchanged.
- `job-review-detail-facts.test.ts`, `job-review-effective-operations.test.ts` and
  `JobReviewLayersTable.test.tsx` cover the thinned tab line, the skipped groove, and an open line
  that shows no tab part beside a closed part that keeps its tabs.
- The audit's own probe, an independent stock model reading the emitted G-code, measures four
  bridges 1 mm into 2 mm stock for 2 and 2.3 mm cuts, 0.75 mm into 1.5 mm stock, and 1.5 mm into
  3 mm stock, where it measured none before.
- No hardware result is claimed.
