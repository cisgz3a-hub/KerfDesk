## ADR-616 - The Artwork panel has one name, one disclosure style and room for Power and Speed (2026-10-18)

**Status:** Accepted. | **Date:** 2026-10-18

This amends ADR-430 rule 1 (the inspector header), ADR-211 rule 6 and ADR-595 (which steps a
laser Run order card shows), and gives the panel's first tab its final name. Settings storage,
effective operations, compiled output, Frame and Start do not change. No guard is added
(ADR-228).

### Context

A UI audit of the Artwork panel found:

1. One panel with four names. The desktop toggle said "Layers", the heading and compact tab said
   "Artwork", the Window menu "Artwork Panel", and the collapsed rail "Artwork / Operations". The
   status bar counted "Layers" while the panel calls them operations.
2. The first tab was called "Settings", the same word as the app's Settings window (Edit →
   Settings, Ctrl+,).
3. Choosing Image on vector artwork inserted the "needs a Line or Fill process" warning above the
   Line / Fill / Image switch, so the switch dropped 29 to 46 px right after the click.
4. With nothing selected, the header named the artwork ("cut-outline") but the Artwork picker
   under it listed operation names ("Operation 1").
5. Visibility and output each had a third copy as checkboxes inside every row's ••• menu.
6. The All operations bulk tools were seven unstyled buttons with group names only in
   `aria-label`; Delete sat in a row with Copy and Paste; move arrows were 22 × 24 px and the
   panel collapse chevron 22 × 22 px.
7. Disclosures came in two styles: native triangles (Advanced artwork settings, Find or jump to
   a run) and cards with a chevron (All operations).
8. Run order cards named the operation twice and printed "#1" beside "Laser output step: 1".
   Number on canvas, a niche mode, was the loudest control in the panel.
9. At 1280 × 720 three stacked tab rows and a boxed header left Speed below the fold.

### Decision

1. **The panel is called Artwork everywhere a user sees it**: the toggle, heading, compact tab,
   collapsed rail and Window menu (Artwork Panel). Its accessible names follow ("Artwork panel",
   "Collapse Artwork panel"). Layers are **operations** in the panel and the status bar
   ("Operations: 3 (3 output)").
2. **The first tab is Properties**, chosen by the maintainer: Properties | Run order |
   Materials (Recipes in CNC).
3. **A process warning appears under the Line / Fill / Image switch**, never above it, so the
   control the operator just clicked does not move. CNC's raster note keeps its place above the
   CNC fields.
4. **The Artwork picker lists artwork names**, numbered when two share a name, the same names
   the header shows.
5. **The row ••• menu no longer repeats Show and Output.** The row's eye and the editor's Show on
   canvas and Include in output own them; the bulk tools still switch every operation at once.
6. **The ••• menus use the shared button styles.** Bulk tools show their group names (Output,
   Visibility, Order) above `lf-btn` buttons; each button keeps its full action as its accessible
   name, which contains the shorter visible word. In a row menu Delete is on its own row, apart
   from Copy and Paste, in danger style. Move arrows and the panel collapse chevrons are 28 px.
7. **Artwork panel disclosures are cards with a chevron**, like All operations. Advanced artwork
   settings and Find or jump to a run use it. CNC operation sections keep their style until the
   CNC inspector pass ADR-430 already defers.
8. **A Run order card names the artwork once.** Its title is the artwork's name, like the header
   and picker; the operation line appears only when it differs from the title. A laser card hides
   its output step when that single step equals its run number, because the #N badge already
   says it. Laser cards still show every step that differs, Output off, and unavailable steps;
   CNC cards always show their actual steps (ADR-211). Number on canvas is an ordinary button.
9. **The header is one line plus a light tab row** (amends ADR-430 rule 1): a short word
   (Selected or Editing) and the artwork's name, or "N artworks selected", then the Operation |
   Artwork switch as underline tabs instead of a boxed card. On windows 820 px tall or less the
   panel tightens its spacing only; every control stays.

### Consequences

- Power and Speed are visible without scrolling at 1280 × 720 and 1366 × 768 with one artwork
  selected and the project-machine notice dismissed. A longer scope line or mixed-settings note
  can still push Speed down; the panel scrolls as before.
- An operation's output is switched from its editor (select its artwork, or pick it in the
  Artwork picker) or from the bulk tools, no longer from its row menu.
- Run order cards for unnamed shapes read "Rectangle"; the #N badge and the operation line tell
  them apart, as the picker numbers them.
- Lessons and docs say Properties and Artwork panel.

### Verification

- Unit tests cover the picker labels, the warning under the switch, the trimmed row menu, the
  labelled bulk-tool groups, the Run order card's step and operation lines, and the renamed
  labels.
- Browser screenshots before and after at 1600 × 960 and 1280 × 720 in the desktop-mode dev
  server; at 1280 × 720 the Speed field ends above the scroller's bottom edge, and choosing Image
  on vector artwork leaves the switch where it was (0 px shift, before 29 px).
- **NOT verified:** on hardware, or perceptually at every breakpoint.
