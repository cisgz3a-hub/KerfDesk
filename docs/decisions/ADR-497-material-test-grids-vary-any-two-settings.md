## ADR-497 - Material Test grids vary any two settings, engrave or cut (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds item 5 of the Rayforge comparison's build list and LightBurn gap LBG-M05, under the owner's
direction of 2026-09-27 to build everything Rayforge does better and make it better than theirs.
It extends ADR-044's Material Test. No new guard or refusal (ADR-228).

### Context

Material Test drew one kind of grid: engraved (Fill) cells with speed changing by row and power by
column. Rayforge offers Power × Speed, Power × Passes, Speed × Passes and Speed × Offset grids, and
each can engrave or cut. KerfDesk's scan-offset coupon already covers Speed × Offset. Testing how
many passes cut through a material, or which hatch spacing engraves cleanly, needed hand-built
layers.

A test grid's fastest cells are the ones whose edges suffer when the runway is too short. The
engraved rows kept a Fill's stored 5 mm, which at 500 mm/s² is too short above about 4,700 mm/min.
With small cells, the first column's runway could also reach left of the grid's origin.

### Decision

1. **Rows and columns each vary one setting**: speed, power, passes, or hatch spacing (Engrave
   only). They are always two different settings. Choosing the other axis's setting for one axis
   swaps them. The settings not varied take one value each. Omitting both keeps speed rows by power
   columns, and that grid is generated as before.
2. **Engrave or Cut.** Engrave fills each cell, as before. Cut burns each cell's outline with a
   Line operation, to find the power, speed and passes that cut through. A Cut grid cannot vary
   hatch spacing: choosing Cut moves an axis off hatch spacing.
3. **Gentlest cell first.** Every axis runs from its lowest-risk value: fastest speed, lowest power,
   fewest passes, widest hatch spacing. So the first cell burned is the gentlest, as ADR-044
   ordered speed and power.
4. **One operation per row, one override per column.** Each row is its own operation carrying the
   row's value. A power column scales the row's highest power per cell (`powerScale`), as before.
   A speed, passes or hatch spacing column is a per-cell artwork override of that one setting. The
   compiler already groups cells by their effective settings.
5. **Whole passes.** A passes axis keeps one row or column per whole number in its range, so 1 to
   3 passes gives three columns even if ten were asked for.
6. **Runway sized for the fastest cell.** Each engraved row runs the stored 5 mm, or the whole
   run-up its fastest cell needs (ADR-495's v² / 2a plus 10%, from Machine Setup's acceleration),
   whichever is longer. Shorter is never used: the grid should burn as the operator's jobs will.
   The grid's left gutter widens to at least that runway, so the motion stays right of the grid's
   origin. The dialog says so when the runway is longer than 5 mm.
7. **Labels.** Burned labels show each row's and column's value; speeds show the feed the job runs,
   as before. Operation names say what the row varies ("Material test 3 passes"). The toast after
   Generate names both axes.

### Alternatives

- **One grid per setting pair, each a separate command.** Rejected: one dialog with two choices
  covers every pair and the cut variant.
- **Automatic overscan on the generated rows.** Rejected: it can be shorter than 5 mm, so the grid
  would not burn as a job with the stored runway does.
- **Speed × scan offset in this dialog, as Rayforge has.** Not added: KerfDesk's scan-offset coupon
  (Machine Setup) already does this with a saved correction table.

### Consequences

- The default grid is unchanged in settings. With small cells, cells now start at least 5 mm right
  of the origin, where the label column was narrower than the runway.
- A grid with a speed, passes or hatch spacing column carries artwork overrides; the artwork's Cut
  Settings shows them.
- The draft keeps its storage key; new fields fall back to their defaults.

### Verification

- `material-test-grid-axes.test.ts`:
  - Power × Passes and Speed × Passes grids compile per cell.
  - The passes columns are whole numbers.
  - Hatch spacing rows run widest to densest, and speed columns burn the effective feed.
  - An axis is never repeated.
  - A Cut grid compiles cut groups and has no hatch spacing axis.
  - Runways: the stored 5 mm where enough, 11 mm for 6000 mm/min, one per speed row, and motion
    right of the origin.
- `material-test-grid.test.ts` still passes unchanged.
- `MaterialTestDialog.axes.test.tsx`:
  - The axis swap, the generated options and the Cut mode's missing hatch spacing.
  - Range checks and the runway note.
- Not tried on a machine.
