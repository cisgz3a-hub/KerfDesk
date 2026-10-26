## ADR-646 - Editing settings lights up the artwork they change (2026-10-20)

**Status:** Accepted. Extends ADR-620 and ADR-632 (operation colour pulse). | **Date:** 2026-10-20

### Context

The maintainer liked the hover readout's power and speed (ADR-348 Amendment 1) and asked for the
artwork to light up while its settings are being changed: select artwork, change its power in the
settings panel, and see on the canvas which artwork that is. The pulse already lights artwork
when the pointer rests on it or on an operation row, but not while focus is in the settings.

### Decision

1. **Focus inside the settings lights the artwork up.** While focus is anywhere in the Operation
   editor (a number field, a slider, the Line/Fill/Image switch, a toggle) or in the Artwork tab's
   power multiplier, the canvas keeps the pulse's soft colour edge on the artwork an edit there
   changes. It pulses once when the edit begins.
2. **Each change pulses again.** A change that lands while focus stays (a typed value committed,
   a slider step) starts another pulse. The clock still lets a running pulse finish, so dragging
   a slider pulses at the pulse's own pace (1.9 s) instead of restarting on every step.
3. **Exactly the artwork the edit changes, never widened.** A hover widens to every piece sharing
   the same settings (ADR-620). An edit does not: other pieces with equal settings keep theirs.
   - Operation editor, no per-artwork override: every piece the operation runs, selected or not,
     so the operator sees everything the change reaches.
   - Operation editor while the selected artwork overrides the operation (laser): only the
     selected pieces.
   - Power multiplier: the selected pieces, in each of their operations.
   Only the parts of a piece that use the edited operation light up, each in its own colour.
4. **A hover wins over an edit.** Pointing at an operation row or at artwork shows that hover;
   when it ends, the edit's edge returns without another pulse.
5. **The glow ends when the edit does**: focus leaving the editor, a press outside it (a focused
   control that re-renders away sends no blur), or the editor unmounting.
6. **Display only, session only.** The edit lives in the UI store (`editedArtwork`), never in the
   project, and changes no selection, output, Frame or Start behaviour. Holding Alt still hides
   the pulse layer, and reduced motion shows the colour without the swell, as before.

### Consequences

- The "should this pulse" rules moved from the overlay's effect into `PulseTrigger`
  (`artwork-pulse.ts`), unchanged for hovers, so they are unit-tested directly.
- Settings edited in the Cut Settings dialog or in an operation row of the operation list do not
  light up yet; the row already pulses on hover.

### Verification

- `artwork-pulse.test.ts`: an edit lights exactly its artwork, not same-settings pieces; lights
  every piece of an operation edit, sweeping left to right; nothing once the artwork leaves the
  operation; pulses on start and on each change; returns after a hover without pulsing; hover
  rules unchanged.
- `SelectedOperationInspector.edit-glow.test.tsx`: focusing Power lights both pieces of the
  operation and not the third; moving to Speed keeps it; focus leaving, a press outside and
  unmounting end it; with an override only the selected piece; the power multiplier lights the
  selected piece.
- **NOT verified:** on hardware (display only).
