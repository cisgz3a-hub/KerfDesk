## ADR-258 Amendment 7 - An outline held only by a sliver thinner than a tab gets tabs, and the bridge measure stays on the cut beside each tab (2026-11-14)

**Status:** Accepted; software-verified on emitted programs, hardware qualification pending. |
**Date:** 2026-11-14

Amends ADR-258 Amendment 5 (decisions 2 and 4). Frame remains the sole ordinary Start policy gate
(PROJECT.md non-negotiable 21): the Job Review lines here are warnings.

### Context

CNC audit v3 N7 re-measured #1889 (Amendment 5) on emitted programs. Corner tabs, small holes and
seam leads hold. Two gaps remained.

**N7-P1-2 (P1).** Amendment 5 decision 4 tabs an open outline as a closed loop only when its ends
lie closer than the cut width, reasoning that "the material across its gap holds it" otherwise.
Just over that width, nothing holds it but a sliver of gap − D through the whole cut depth:

| Bit | Gap | Sliver | Section | One default tab (6 × 2 mm) |
| --- | --- | --- | --- | --- |
| ⅛" | 3.2 mm | 0.025 mm | 0.16 mm² | 12 mm² |
| ⅛" | 3.3 mm | 0.125 mm | 0.8 mm² | 12 mm² |
| ¼" | 6.36 mm | 0.010 mm | 0.06 mm² | 12 mm² |

These outlines got no tabs and no warning, and tear free on the last pass. The codebase's own
floor for "holds nothing" is `THIN_POCKET_FLOOR_MM`, 0.2 mm.

**N7-P3-1 (P3).** The tab-hold warning said small holes hold "by as little as 0 mm", while the
program leaves a 3.0–3.7 mm neck:

| Shape | Claimed | Measured |
| --- | --- | --- |
| Ø10 hole | 2.2 mm | 3.69 mm |
| ¼" Ø16 hole | 1.4 mm | 2.92 mm |
| Ø4 part | 2.6 mm | 3.97 mm |

The bridge measure (decision 2) looks for the cut running on from the other kerf end. On these
loops it walked past the short cut beside the window into the next window, where nothing is cut.
With a single window it walked round to the window's own kerf end, measuring the kerf against
itself.

### Decisions

1. **A sliver weaker than a tab is closed for tabs.** An open outline around more than the bit's
   footprint is tabbed as a closed loop while its gap is under D + max(0.2 mm, W × H / depth).
   That is, while the sliver's section (gap − D) × cut depth is smaller than one tab's,
   W × H, and in any case while the sliver is under 0.2 mm.
   - With the default 6 × 2 mm tabs through 6.35 mm, that means any gap under D + 1.89 mm.
   - Wider gaps leave an open line that the gap itself holds better than a tab would, so it stays
     untabbed (Amendment 4).
   - Code: `cutFreesOpenOutline` in `cnc-open-outline-tabs.ts`.
2. **Tabs keep off the gap.** The planned windows shift together until the gap's middle sits
   halfway between two of them (`planClearOfGap`). Nothing is cut across the gap, so a window
   there would hold nothing. This applies to gaps under D too, where the end kerfs sweep the gap.
3. **The warning says why.** The closed-gap line now reads "ends so close to its start that the
   … cut leaves less across the gap than a tab holds, so the cut frees it like a closed shape".
   This covers both a swept gap and a sliver.
4. **The bridge measure stays on the cut beside each window** (`cnc-tab-bridge.ts`):
   - It walks at most the cut arc between this window and the next, never into a window.
   - With a single window, it ignores points within two cut widths of the kerf end it is compared
     with, along the loop. That is the same kerf, not a far leg.
   - It skips a window whose cut arcs on both sides are shorter than max(2D, the window). Such a
     loop is mostly tab, and a measure across it reads the hole, not the tab.

   Acute tips are still measured: a dragged tab just past a 20° wedge tip is still named.
5. The loop geometry (`cnc-tab-loop.ts`) and bridge measure (`cnc-tab-bridge.ts`) move out of
   `cnc-tab-placement.ts`, which keeps its exports.

### Alternatives considered

- **Warn only ("held by an X mm sliver").** This would leave the part free unless the operator
  edits the drawing. Tabs cost nothing here, so the program holds the part instead.
- **A fixed D + 0.2 mm limit.** A 1 mm sliver through 6.35 mm is 6.35 mm², half of one default
  tab. Comparing sections follows the tab the operator set, and keeps 0.2 mm as the floor.
- **Measure every bridge on a cut-through stock model.** This is exact, but too costly for a
  per-loop planner. On every small loop the audit measured, the capped walk now names no narrow
  bridge, while acute tips are still measured.

### Consequences

- An outline drawn or imported a little short of closed is held by tabs and named in Job Review.
- Small holes no longer get advice to "drag those tabs to straighter edges" that cannot be
  followed on a circle.
- A narrow bridge on a loop that is mostly tab is no longer named. Such loops held in every case
  measured.

### Verification

- `src/core/cnc/compile-cnc-tab-gaps.test.ts` (emitted G-code, own reader). 8 of its 10 cases fail
  on main.
  - ⅛" gaps of 3.2, 3.3, 3.6 and 4.5 mm (On path), and 3.3 mm (Outside), all get four tab walls.
    The cut falls into five pieces, and the narrowest gap between pieces is the sliver itself.
  - The ¼" bit at 6.36 mm is tabbed. A 6 mm gap (an 18 mm² wall) stays untabbed.
  - None of these is named as a narrow bridge:
    - Ø8, Ø9 and Ø10 holes;
    - an 8 mm square hole;
    - a 10 mm hexagon;
    - a Ø4 part;
    - ¼" Ø12, Ø14 and Ø16 holes.
  - The acute wedge still is.
- `compile-cnc-tab-holds.test.ts` (Amendment 5) still passes, with its fixtures moved to
  `compile-cnc-tab-holds.test-support.ts`.
- `cnc-tab-hold-warnings.test.ts`: the new closed-gap wording.
