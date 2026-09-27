## ADR-106 Amendment 2 - CNC box parts cut through, and slots are pocketed in their own operation (2026-09-27)

**Status:** Accepted (maintainer chose "Cut through" on the Box Generator audit card). | **Date:** 2026-09-27

### Context

The Box Generator audit (Amendment 1) traced generated CNC panels to G-code. Two things kept a
generated box from cutting out as inserted:

1. **Depth.** The new Box panels operation kept the generic CNC default depth of 1 mm, so
   nothing cut through until the operator changed it by hand.
2. **Slots and holding tabs.** Outlines and divider slots shared one profile-outside operation
   with the default holding tabs. A divider slot's loop is shorter than four tab windows, so the
   tab-ramp model rides the whole loop at the tab top (ADR-258, AUDIT A5). Measured in 6.35 mm
   stock at full depth, every slot stopped at Z -4.35 with a 2 mm skin. Profiling a slot also
   leaves a loose sliver or slug in its middle whenever the slot is wider than two bit widths.

### Decision

1. On a CNC machine, box insertion (and the Box Fit Test strips, which use the same path) sets
   every operation it creates to cut the material thickness the parts were generated for.
2. Outlines stay in the **Box panels** operation: profile-outside, default holding tabs.
3. When any part has cutouts, the slot rings go to a second **Box slots** operation with the
   pocket cut type. Each panel object keeps one object but carries two paths: the outline bound
   to Box panels and its slot rings bound to Box slots (path-level operation binding). A pocket
   clears the whole slot, so no piece is left for a tab to hold, and pocket operations never
   take tabs. Clearing runs before any profile can free a part (compile-cnc-job tool sections),
   so the slots are cut while the panel is still held by its outline.
4. Laser insertion is unchanged: one operation, one path per panel with the outline and its
   cutouts, kerf and inside-first ordering at compile.

### Consequences

- A CNC box now compiles to full-depth G-code as inserted. Measured on the dialog's default CNC
  box (6.35 mm stock, 3.175 mm bit, 1 × 1 dividers, relief on) for all three styles: the deepest
  cut is Z -6.35, slot pockets run before outlines, and each outline keeps its four holding tabs.
  Independent sampling of the emitted cutter sweep at 0.5 mm spacing found four points per
  closed/open-top box near the relief boundary with up to 0.006 mm of residual clearance beyond
  the sweep; the slide-lid sample found none. This demonstrates full-depth pocket clearing,
  not exact coverage of every point of the polygon. Offset approximation and emitted coordinate
  rounding remain part of the software result; physical fit is unverified until a real cut.
- A seat corner that falls under a holding-tab window is relieved only down to the tab top, like
  the rest of the tab. Trimming the tab clears it.
- The depth comes from the dialog's material thickness, which is prefilled from the machine's
  stock thickness. An operator who cuts thicker stock than the box was drawn for still has to
  change the depth.
- Operators see two operations for a box with dividers, with the slots in the second palette
  colour.
