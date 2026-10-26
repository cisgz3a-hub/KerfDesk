## ADR-499 Amendment 1 - A held arrow key is one nudge step, and arrow-key widgets keep their keys (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

Amends ADR-499 decisions 5 and 6 (align keys, fine nudge) and its consequence "Each nudge press is
still its own undo step". Keeps ADR-493 decision 6: bare arrows still nudge the selection (F104),
including from a plain button.

### Context

The rolling canvas audit of 2026-10-21 (`docs/audits/2026-10-21-rolling-v2/08-canvas-commands.md`,
08-P2-3 and 08-P3-2) reproduced two faults through the real `useShortcuts` hook:

- The Artwork panel's tab strips handle ArrowLeft and ArrowRight as an ARIA tablist and call
  `preventDefault`, but the window nudge still ran. One key switched the tab and moved the
  selected artwork 1 mm (10 mm with Shift), with an undo step. Alt+arrow switched the tab and
  aligned the selection in the same way. The jog keys already stand down there
  (`use-jog-shortcuts.ts`); the nudge did not.
- Every auto-repeat of a held arrow pushed its own undo step. Browsers repeat a held key at the
  operating system rate, about 30 a second on Windows, so about 2 s of holding pushed the whole
  50-step history out, and an earlier deletion could no longer be undone. The align keys already
  ignore repeats ("one press is one undo step").

### Decision

1. An arrow key that a focused widget answers itself does not nudge: the event was already
   `defaultPrevented`, or its target has a role that uses arrow keys (tab, tablist, tabpanel,
   radio, radiogroup, slider, spinbutton, scrollbar, separator, listbox, option, grid, gridcell,
   row, tree, treeitem, combobox, menu, menubar, menuitem and its checkbox and radio forms, region
   or log). See `isArrowKeyWidgetEvent` in `src/ui/common/keyboard-targets.ts`. The align keys skip
   an event that is already `defaultPrevented`. A plain button is not such a widget, so a bare
   arrow there still nudges (ADR-493 decision 6), and the Artwork panel as a whole is not exempt.
2. A held arrow key moves the selection as one undo step. The press pushes the step as before.
   Each auto-repeat (`KeyboardEvent.repeat`) continues it while the project is still the one the
   previous nudge left. Anything else that changes the project in between, including Undo, makes
   the next repeat start a new step. Separate presses stay separate steps, as the consequence above
   says. The node nudge (an arrow with a path node selected) is unchanged.

### Consequences

- Keyboard tab navigation in the Artwork panel no longer moves the burn position.
- Holding an arrow to slide artwork costs one history step, so the 50-step history keeps older
  edits.
- A widget that calls `preventDefault` on an arrow key for some other reason also stops the nudge.
  None was found among the panel's widgets.

### Verification

- `src/ui/app/arrow-key-widgets.test.tsx`: the real `useShortcuts` with the real
  `ArtworkPanelTabs` and `ArtworkEditorTabs`. ArrowRight and Shift+ArrowRight switch tabs without
  moving the artwork, Alt+ArrowRight on a tab aligns nothing, and ArrowDown on a plain button
  still nudges. Without the change, the first two fail.
- `src/ui/app/nudge-held-arrow.test.ts`: 60 key events (one press, 59 repeats) after a Delete
  leave two undo steps, "Move rectangle" and the Delete, and two Undos restore the deleted object.
  A new press, and a repeat after a flip, start new steps.
- `src/ui/app/nudge-step.test.ts` checks that repeats are marked.
- Not tried in a real browser or in the desktop app. jsdom does not repeat keys, so the tests
  send the repeat flag themselves.
