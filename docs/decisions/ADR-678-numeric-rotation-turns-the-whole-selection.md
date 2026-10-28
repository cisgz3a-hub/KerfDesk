## ADR-678 - The Rotation box turns the whole selection, a group or several objects

**Status:** Accepted; unit- and UI-tested through the real Numeric Edits toolbar and store, and
against the remote rotate. Not hardware-tested. | **Date:** 2026-10-28

Fixes rolling audit v7 finding L4-P2-1 (`docs/audits/2026-10-28-rolling-v7/L4-transform-arrange.md`),
which an independent refuter confirmed at P2. It also records the centre pivot that L4-P3-3 found
decided only in code (commit `1326b05b1`), and reduces the typed angle as L4-P3-4 asked. Extends
ADR-480 item 7 (typed values in the Numeric Edits boxes). Changes nothing in Frame, Start or output.

### Context

The Numeric Edits toolbar's Rotation box worked for one object only. With a group or any
multi-object selection it was disabled and empty, and nothing said why: `selectionMetrics` gave no
angle unless exactly one object was selected, and the core refused the edit as `multi-rotation`.
Its message, "Rotate one object at a time in Numeric Edits.", could never show, because the box
was disabled first. Clicking a member of a group selects the whole group, so a grouped design
could not be turned by a typed angle on the desktop at all. The only routes were 90° turns,
Shift's 15° handle steps, or Two-Point Rotate's clicks.

LightBurn 1.7's Numeric Edits Toolbar
(https://docs.lightburnsoftware.com/1.7/Reference/NumericEditsToolbar/) says "Use the Rotate field
to turn the current selection by a precise number of degrees", with "all objects in your current
selection … treated as a single unit". KerfDesk's remote `transform_artwork` rotate and the canvas
rotate handle already turn a multi-selection about the centre of its selection box.

A typed angle also went into the trig unreduced, so R = 1e17 moved the "fixed" centre by up to
1.72 mm (L4-P3-4).

### Decision

1. **The box is enabled for any selection.** It turns a group or several objects as one piece.
2. **It shows the angle every selected object shares**, within 1e-6°. A group of unturned
   objects shows 0, and after a typed 37.5 it shows 37.5. **When the angles differ, the box is
   blank, reads "Mixed" and stays editable.** Its tooltip says the objects are at different angles
   and that a typed angle turns them all by that much.
3. **One rule for the typed value: it replaces the shown angle, and a blank box counts as 0.** One
   object and a shared angle therefore behave alike (type the old angle to turn it back), and a
   mixed selection turns by the typed amount, as LightBurn's field does.
4. **The pivot is the centre, never the 9-dot anchor.** One object turns about the centre of its
   own bounds, which a turn never moves, as before. Several turn about the centre of the selection
   box (`combinedBBox`, ADR-677), the point the rotate handle and the remote rotate use. A typed
   37.5° turn of a two-object selection equals the remote rotate's result. The anchor stays the X/Y
   reference and the resize corner. The anchor picker's tooltip already says "Rotation always
   pivots about the centre." This keeps commit `1326b05b1`'s reason: pivoting at the default `nw`
   anchor shifted the artwork off its spot. LightBurn instead lets the 9-dot anchor set the centre
   of rotation. That difference is recorded here, not changed.
5. **The typed angle is reduced to 0–360° before the trig**, so the orbit and the stored rotation
   always agree: R = 1e17 stores 280° and keeps the centre still.
6. The `multi-rotation` refusal and its message are removed.

### Consequences

- A grouped design can be turned by an exact typed angle on the desktop, one Undo step.
- Several objects turn about their selection box centre, which moves as the layout turns, as with
  the rotate handle. Typing an angle and then the old one returns a symmetric layout exactly, but
  can leave a lopsided one shifted by a little. Undo restores it exactly.
- The registration jig editor's Rotation field reads the same shared angle. It now also shows for
  several jig objects turned to one angle, and turns them together. A mixed jig selection still
  hides it.
- Locked group members keep the existing desktop rule. They are not selected, so they stay put
  (L4-P3-5 is not changed here).
