## ADR-646 Amendment 1 - Cut Settings and operation rows light up their artwork too (2026-10-20)

**Status:** Accepted. Amends ADR-646 (Consequences) and ADR-620 (operation row pulse). | **Date:** 2026-10-20

### Context

ADR-646 listed two settings editors that did not light up their artwork yet: the Cut Settings
dialog opened by "More cut settings", and the operation rows in the operation list. Checking
each before changing it:

- **Cut Settings already lit up.** The dialog is not a portal: it renders inside the Operation
  editor, so focus in it reaches the editor's handlers and a press in it counts as inside the
  editor. It also applies to the same target as the editor. With per-artwork settings in force
  it writes the selected pieces' own settings, otherwise the operation. So it lit exactly the
  pieces its Apply changes. Typing in it changes nothing until Apply, which pulses as a change.
- **Operation rows have no settings fields.** Since ADR-631 a row holds the activation button,
  the eye and a More controls menu: order, Include in output, select artwork, show only, copy and
  paste settings, delete. Focus or the pointer anywhere on the row set the row pulse, which widens
  to every operation with the same settings (ADR-620). Switching Include in output or pasting
  settings lit operations the change does not touch, and a change under a hover does not pulse.

### Decision

1. **Cut Settings keeps the editor's glow.** No new handlers. A test now opens the dialog from
   More cut settings and checks: every piece of the operation lights up, or only the selected
   pieces while they override it; a press and typing in the dialog keep the glow; Apply changes
   exactly the lit pieces. If the dialog ever moves to a portal, it needs the edit glow handlers
   on its own root, because the press-outside check is DOM containment. The test catches that.
2. **A row's More controls light exactly that operation's artwork.** Everything in the menu acts
   on this one operation, so focus inside it uses the edit glow (owner `operation-row:<id>`): every
   piece the operation runs, in its colour, and not same-settings lookalikes. Starting the edit
   pulses, and each change it makes (Include in output, Paste, order) pulses again.
3. **Plain focus on the row keeps the row pulse.** The activation button, the eye and the menu's
   own toggle still set the row hover, widened to same settings, as ADR-620 decided.
4. **The row steps aside for its own edit.** ADR-646 decision 4 says a hover wins over an edit,
   and the pointer is always over the row while its menu is clicked. So while the row's own edit
   holds the canvas, that row releases its hover and does not set it again, even when the pointer
   settles on it. Another row, or artwork on the canvas, still wins over the edit as before. When
   the edit ends with focus on a plain control of the row, the row pulse returns.

The canvas side and the store are unchanged. Display only, session only: no selection, output,
Frame or Start behaviour changes.

### Consequences

- `useOperationRowHover` takes whether the row's own edit holds the canvas.
- The jig editor's outline settings (`RegistrationJigOperationSettings`), including its Advanced
  outline settings dialog, still do not light up; they edit the jig outline in Jig mode, not
  artwork.

### Verification

- `CutSettingsDialog.edit-glow.test.tsx`: the dialog from More cut settings lights every piece
  of the operation, keeps the glow through a press, typing and Apply, and lights only the
  selected pieces with per-artwork settings, matching what Apply changes; closing ends it.
- `LayerRow.edit-glow.test.tsx`: focus in the menu lights exactly the operation's two pieces,
  not the same-settings operation; a change keeps the glow; focus on the activation button
  brings back the row pulse; the row's hover steps aside under a settled pointer; a press
  outside and unmounting end the glow.
- `LayerRow.hover.test.tsx` unchanged and passing.
- **NOT verified:** on hardware (display only).
