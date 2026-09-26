## ADR-258 Amendment 3 - A set stock thickness measures tabs from the stock bottom (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-258 places the tab top one tab height above the cut floor (`tabTopZMm`). CNC audit TP-1
(`docs/audits/2026-09-24-cnc-full-audit.md`, high, reproduced) showed what that does to a through
cut: extra depth thins the tabs and can remove them. On 6.35 mm stock with 2 mm tabs, a cut 0.5 mm
into the spoilboard leaves 1.5 mm tabs. A cut 2.15 mm past the bottom puts the whole tab below the
stock, so the part comes free while the layer still says tabs are on. The audit's fix has two
halves:

- adding tabs only to cuts that reach the stock bottom, which Amendment 1 did (`cutCanFreePart`);
- measuring the tab top from the stock bottom, which it left to the maintainer because it changes
  ADR-258.

Maintainer decision, 2026-09-26: measure from the stock bottom, as Easel does. Its tabs keep their
height with additional depth ("This is compatible with tabs and will not affect tab position or
height", *Additional Depth*, https://easel.com/features/additional-depth-cut-throughs).

### Decision

1. **With Stock thickness set, a kept tab is one tab height above the stock bottom.** The tab top
   is at Z = -(stock thickness - tab height) for every cut that keeps its tabs under Amendment 1:
   a through cut, a spoilboard overcut, or a cut stopping within a tab height of the bottom. On 6 mm
   stock with 2 mm tabs the top is Z-4 for 6.5, 8.15 and 5.5 mm cuts alike.
2. **One place applies it.** `settingsWithStockTabGate` already hands the pass builders their
   layer settings. It now also sets their tab height, measured up from the cut floor, to the value
   that puts the top there (`tabHeightAboveCutFloorMm`). `tabTopZMm`, `passNeedsTabs`, the tab
   ramps, finish allowance and the 3D preview use the compiled passes unchanged. The full tab
   coverage warning reads the same gated settings.
3. **The shipped stock thickness keeps the cut-floor rule.** As in Amendment 1, the default value
   cannot be told apart from never set. Measuring from a guessed bottom could put tabs far above a
   thicker sheet's real bottom, or below a 3 mm groove. Inlay pairs, whose plug is cut from its own
   board, do not pass through this gate and are unchanged.
4. **The overcut warning states the tab thickness.** With Stock thickness set, it says the tabs stay
   full height above the stock bottom, which relies on that thickness being right. On the shipped
   default, it says how much of each tab the overcut leaves in the stock, or that the tabs sit
   below it and the part comes free, and asks for Stock thickness. Job Review's layer line adds
   "above the stock bottom" when that rule applies. These are warnings only (PROJECT.md rule 21).
5. **The emitter revision advances** to `tabs-from-stock-bottom-20260926-v1`, because tabbed
   profiles on a set stock thickness now emit different G-code.

### Consequences

- Cutting a little deeper to be sure of a clean through cut no longer weakens or removes tabs,
  as long as Stock thickness is set.
- Tabs now depend on Stock thickness being right, as Amendment 1 already made their presence
  depend on it. A value thicker than the real sheet raises the tab top by the difference; Amendment
  2's warning names the thickness when tabs are dropped, and the overcut warning names it here.
- Not changed: an operator who types exactly the shipped 6.35 mm still gets the cut-floor rule.
  Telling a confirmed value from a default would need its own setting.

### Evidence

- `compile-cnc-stock-tab-gate.test.ts` compiles a 40 mm square profile with 2 mm tabs. On 6 mm
  stock the tab rises reach Z-4 for 6.5, 8.15 and 5.5 mm cuts; on the shipped stock a 0.5 mm overcut
  still tops out at the cut-floor height. Forcing the old rule fails the three stock-bottom cases.
- `cnc-through-cut-tab-warnings.test.ts` covers the three new warning sentences and their absence
  for pockets and tab-less profiles. `job-review-detail-facts.test.ts` covers the layer line.
