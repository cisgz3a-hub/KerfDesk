## ADR-572 Amendment 4 - Projected tabs are measured from the floor the relief leaves, and a roughed-only relief starts the ladder above its surface (2026-11-09)

**Status:** Accepted; software-verified through compile, Job Review and analytic G-code stock
simulation tests, hardware qualification pending. | **Date:** 2026-11-09
**Fixes:** rolling audit v12 findings X6-P1-1 (P1 by the coordinator on the W6-P2-1 precedent; the
refuter argued P2), X6-P2-1 (P2) and, on the same root, X6-P3-2 (P3).

Amends ADR-572 Amendment 3. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

- **Tabs (X6-P1-1).** Amendment 3 raised a projected loop to its tab top inside each window. On a
  set stock thickness that top is one tab height above the stock bottom, whatever the relief
  surface under the loop. Where the relief already stands lower, the window rides in air and the
  tab is only the floor the relief left. The refuter's plaque:
  - **Floors:** a 5 mm floor in 6 mm stock left 1.00 mm bridges, 5.5 mm left 0.50, 5.8 left 0.20,
    5.95 left 0.05, and a floor at the stock bottom left none.
  - **Job Review** still said "6 × 2 mm above the stock bottom".
  - **The cut-free note** could not fire once a window existed.
  - **Amendment 3's Consequences** called this "only Z travel".
  - **The 2D twin:** the profile's overcut note said tabs "stay 3 mm thick" in the same situation.
- **Step-down start (X6-P2-1).** The ladder stepped down from the relief's target surface. A layer
  as created roughs only (no finishing bit), and roughing leaves its allowance plus up to one
  terrace above that surface. So the first pass of a 0.5 mm-per-pass engrave took 2.58 mm (3.80 mm
  with 3 mm roughing passes), while Job Review said "passes of up to 0.5 mm".
- **Deepest tip (X6-P3-2).** "Deepest" was read before the tabs, so a loop its windows lifted
  whole still reported a depth it never cut.

### Decision

1. **The material a loop leaves.** On its emitted last level, each point leaves material from the
   stock bottom up to the lower of the tip and the relief surface there.
   - A tabbed loop's tab thickness is the thinnest such material wherever the loop stands at or
     above its tab top. It is recorded as `thinnestTabMm` in the projection evidence.
   - A closed loop is cut free when no point keeps more than 0.1 mm, tabs or not.
   - The deepest tip is the deepest emitted one.
   - The tab top itself is unchanged: no thicker tab is possible where the material is not there.
2. **Job Review and the stock advisory name the real tab.**
   - When the tabs are thinner than the set (stock-limited) height, Job Review's line reads "tabs 4
     per shape (6 mm) on 1 of 1 closed shape, only 0.5 mm thick: the relief floor under them is
     that far above the stock bottom (3 mm set)".
   - The advisory names the thickness and the reason. Under 1 mm it adds "Tabs this thin can break
     and free the parts".
   - When the floor is at the stock bottom, the cut-free note says that the tab windows leave no
     more than 0.1 mm.
   - The 2D profile's overcut note now says its tabs "reach" the set height above the stock bottom,
     and that "a relief or pocket cut deeper under them first leaves them thinner". It no longer
     says they "stay" that thick. Measuring the 2D case per tab is left open.
3. **A roughed-only target starts the ladder above its surface.** When this job carves the target
   relief and its layer has no finishing bit available, the ladder covers the Vertical depth plus
   the target's finish allowance plus one roughing terrace (its Depth per pass, or its Slope step
   when smaller). Its first level sits one Depth per pass under that top. Job Review adds "from 2
   mm above it (the relief is only roughed first)".
   - A finished target, or one this job does not carve (an earlier job), starts at its surface as
     before.
   - A finished target that the output order cuts after the projection keeps the order warning,
     which now names the first-pass load that order brings.

### Consequences

- In the refuter's L1 case, the worst projection move removes 0.58 mm at 0.5 mm per pass (2.58 mm
  before). The extra is a flat bit crossing the 1:8 ramp, slope × radius.
- On the plaque, Job Review and the advisory name the 1.0 and 0.5 mm bridges the simulation leaves.
  The floor at the stock bottom is reported as cut free.
- A roughed-only target gets more levels, the top ones partly in air where roughing reached the
  allowance. That costs time, not material.
- Not verified on hardware.
