## ADR-258 Amendment 6 - A set Stock thickness counts as set at any value, 6.35 mm included (2026-11-13)

**Status:** Accepted (maintainer decision: "6.35 mm stock counts as set"); software-verified
through compile, project and Machine Setup tests, hardware qualification pending. |
**Date:** 2026-11-13

Amends ADR-258 Amendments 1, 3 and 4. Frame remains the sole ordinary Start policy gate
(PROJECT.md non-negotiable 21): every Job Review change here is a warning or a detail line.

### Context

Amendments 1, 3 and 4 apply only when Stock thickness is set:

- Amendment 1 skips tabs over a floor at least one tab thick.
- Amendment 3 measures a kept tab from the stock bottom instead of the cut floor.
- Amendment 4 halves a tab no thinner than the stock.

"Set" was decided by comparing the thickness with the shipped default
(`DEFAULT_CNC_STOCK.thicknessMm`, 6.35 mm). Every rule in `cnc-tabs.ts`, the relief projection
compiler, the stock warnings and Job Review all made that comparison.

CNC audit v2 and v3 (J1-P3-3, confirmed and widened by the v3 refuter) found that a real 6.35 mm
(¼") sheet therefore always read as never set:

- A 3 mm groove in it took four 2 mm tab bumps, though its 3.35 mm floor holds the part.
- A through cut measured its tabs from the cut floor, so an overcut thinned them.
- The warnings told the operator to "Set Stock thickness". They could not: the field already
  showed 6.35, and re-entering that value commits nothing, because the field's debouncer drops a
  value equal to the last one committed.

### Decisions

1. **The stock records that its thickness was set.** `CncStock` gains an optional
   `thicknessSet: true`, written whenever the operator commits Stock thickness in Machine Setup,
   at any value, 6.35 mm included. Nothing writes `false`; the mark is only ever present or
   absent.
2. **One reading of "set".** `setStockThicknessMm(stock)` (`core/scene/machine.ts`) returns the
   thickness when it is set and `undefined` while it is not. It is set when the stock carries the
   mark, or, without the mark, when the thickness differs from the shipped default.
3. **The tab rules take the set thickness.** `stockLimitedTabHeightMm`, `cutCanFreePart`,
   `tabHeightAboveCutFloorMm` and `settingsWithStockTabGate` take `number | undefined` and treat
   `undefined` as unset, in place of the comparison with 6.35. The callers pass
   `setStockThicknessMm(...)`:
   - compile (`compile-cnc-layer-passes.ts`, `compile-cnc-relief-projection.ts`);
   - the stock and tab warnings;
   - Job Review.

   Text that names the stock ("cuts 7 mm into 6.35 mm stock") still reads the thickness shown.
4. **Old projects keep their reading.** A project saved before this amendment has no mark. Its
   stored 6.35 mm reads as unset and any other value as set, exactly as before, so no existing
   program changes when the project is reopened. A stored 6.35 cannot tell a real ¼" sheet from
   an untouched default, and reading it as set would silently drop or move the tabs of every old
   default project. The reader keeps only an exact `true` (`normalize-cnc-stock.ts`). No schema
   bump is needed: the field is optional, and an older app ignores it, reading the project as it
   always did.
5. **Machine Setup confirms a real 6.35 mm sheet.** While the thickness is unset, the Stock card
   shows "Stock thickness not set yet: holding tabs are measured from the cut floor." with a
   **Use 6.35 mm** button that adds the mark. Typing any thickness also marks it.
6. **The advice can be followed.** The warnings that relied on the default now say "Stock
   thickness has not been set" and "Set Stock thickness in Machine Setup (press Use 6.35 mm there
   if that is the real sheet)".

### Alternatives considered

- **Make `thicknessMm` optional (absent = unset).** This is cleaner on paper. But the 3D viewers,
  tiling, two-sided setup and depth warnings all need a number, and each would need its own
  fallback. The mark changes only the tab rules.
- **Read every stored 6.35 as set.** This would change the program of every old project left at
  the default with no action from the operator. Rejected.
- **Count finishing Machine Setup as setting the stock.** Operators click through the wizard, so
  passing it says nothing about the sheet on the bed.

### Consequences

- A real 6.35 mm sheet gets Amendments 1, 3 and 4 once marked:
  - a groove with a floor at least one tab thick has no tab bumps;
  - a through cut's tabs stand 2 mm above the stock bottom (Z-4.35) instead of 2 mm above the
    cut floor (Z-4.5 for a 6.5 mm cut).
- An unmarked default project behaves exactly as before.
- Undo restores the stock with or without the mark, like any other stock edit.

### Verification

- `src/core/cnc/compile-cnc-stock-thickness-set.test.ts` measures the emitted G-code:
  - a 3 mm groove in marked 6.35 mm stock has no fed rise off the floor; unmarked it has four, to
    Z-1;
  - a 6.5 mm through cut's tabs top out at Z-4.35 marked, and at Z-4.5 unmarked.

  The marked cases fail on main, which ignores the mark.
- `src/io/project/project-stock-thickness-set.test.ts`:
  - the mark survives save and load;
  - unmarked projects read as before;
  - a mark other than `true` is dropped.
- `src/ui/laser/device-setup/DeviceSetupCncStockFields.set.test.tsx`:
  - the button appears only while unset and marks the stock;
  - a typed thickness is marked.
- Updated:
  - `cnc-through-cut-tab-warnings.test.ts`: the warning and compiler parity loop now runs every
    thickness both marked and unmarked;
  - `compile-cnc-stock-tab-gate.test.ts`;
  - `job-review-detail-facts.test.ts`.
