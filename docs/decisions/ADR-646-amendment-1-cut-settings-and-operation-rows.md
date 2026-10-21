## ADR-646 Amendment 1 - Cut Settings and operation rows light up their artwork too (2026-10-20)

**Status:** Accepted. Amends ADR-646 (decisions 3 and 5, Consequences) and ADR-620 (operation row pulse). | **Date:** 2026-10-20

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
2. **A row's More controls light exactly that operation's artwork.** The menu and the row's
   Remove Focus Test Z act on this one operation, so focus there uses the edit glow (owner
   `operation-row:<id>`): every piece the operation runs, in its colour, and not same-settings
   lookalikes. Starting the edit pulses, and each change it makes (Include in output, Paste,
   order) pulses again. Show only is the exception: it changes every operation's visibility, so
   it lights all artwork, each piece in its own operation's colour; once it has hidden the others,
   only this operation's artwork is drawn.
3. **Plain focus on the row keeps the row pulse.** The activation button, the eye and the menu's
   own toggle still set the row hover, widened to same settings, as ADR-620 decided.
4. **The row steps aside for its own edit.** ADR-646 decision 4 says a hover wins over an edit,
   and the pointer is always over the row while its menu is clicked. So while the row's own edit
   holds the canvas, that row releases its hover and does not set it again, even when the pointer
   settles on it. Another row, or artwork on the canvas, still wins over the edit as before. When
   the edit ends with focus on a plain control of the row, the row pulse returns.
5. **A control lights what it changes, not what its editor usually does.** A control whose reach
   differs from its editor's carries `data-edit-scope`, and `useSettingsEditGlow` lights that
   scope's artwork while it has focus:
   - `operation`: the operation name, Include in output, Show on canvas and Remove Focus Test Z
     change the operation itself, so in the Operation editor they light every piece it runs, even
     while the selection has its own settings.
   - `selection`: Make unique and Add operation change only the selected artwork, so they light
     only the selected pieces, even where an edit there would reach the whole operation. Either
     one then opens the new operation in a new editor, without focus, so the glow ends there
     (ADR-646 decision 5); the new operation's own edits light it once focus is back in it.
   - `everything`: Show only, as above.

   A toggle that only opens or closes an editor changes nothing, so it lights nothing: the power
   multiplier's glow covers the disclosure's body, not its Advanced artwork settings summary.
6. **The multi-operation CNC depth lights up too.** With several CNC artworks that share no
   operation, the bulk Cut depth (or Insert depth) field sets the depth of each of their
   operations. Focus there lights every piece those operations run, selected or not.
7. **Another edit pulses, the same edit does not.** The edit's identity includes its editor, and
   the store makes a new edit object each time one begins (the same edit set again keeps its
   object). The canvas numbers edits by that object, so focus moving straight to another editor
   of the same artwork pulses, and so does an edit that ended and began again while a hover hid
   it. One that only returns from under a hover brings its edge back without a pulse.
8. **The edit ends with its focus.** A press outside the editor ends the edit before the pressed
   control acts on click, so another row's eye or a drag never pulses the old edit. With focus
   still in the editor, the press blurs it next. A field that commits on blur (a typed value
   inside its debounce, a rename) lands as the edit's last change and pulses, and the edit ends
   with that blur. If no blur comes, the edit ends right after the press. After a click or key
   inside the editor, if focus has fallen out of it because the focused control removed itself
   (Remove Focus Test Z), the edit ends too: that sends no blur.

Display only, session only: no selection, output, Frame or Start behaviour changes.

### Consequences

- `useOperationRowHover` takes whether the row's own edit holds the canvas.
- `useSettingsEditGlow` takes optional `scopes`, the reach of controls marked `data-edit-scope`.
  `LayerFocusTestNotice` takes the row's edit glow handlers, because in a row it sits outside
  the menu.
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
- `SelectedOperationInspector.edit-glow.test.tsx`: Include in output and Show light both pieces
  of the operation while the selected piece has its own settings, and Power and Speed only the
  selected one; an outside press releases the edit during the press; the multi-operation CNC
  depth lights every piece of its operations, including an unselected one, and not a third
  operation's piece.
- `SelectedOperationInspector.edit-glow.test.tsx` also: Make unique and Add operation light only
  the selected piece while Power lights both; the operation name lights both pieces while the
  selected one has its own settings; the Advanced artwork settings summary lights nothing, and
  focus moving back to it from the power multiplier ends the glow; a typed value committed by
  the blur an outside press causes reaches the scene while the edit holds, and the edit ends
  with that blur; Make unique and Add operation end the glow as the editor moves to the new
  operation.
- `LayerRow.edit-glow.test.tsx` also: Show only lights all artwork in every operation; Remove
  Focus Test Z lights exactly its operation without the row pulse, and the glow ends once the
  button removes itself.
- `CutSettingsDialog.edit-glow.test.tsx` also: Cancel closes the dialog and the same glow stays
  as focus returns to the editor.
- `artwork-pulse.test.ts`: focus moving straight to another editor of the same artwork pulses;
  an edit that began again under a hover pulses when the hover ends, and one that only returns
  does not. `ArtworkPulseOverlay.test.tsx`: an edit released and set again under a row hover,
  equal to the one before, pulses when the hover ends.
- `LayerRow.hover.test.tsx` unchanged and passing.
- **NOT verified:** on hardware (display only).
