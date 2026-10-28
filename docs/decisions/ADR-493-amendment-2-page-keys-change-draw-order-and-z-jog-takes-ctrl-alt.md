## ADR-493 Amendment 2 - PgUp / PgDn change the draw order; keyboard Z jog is Ctrl+Alt+PgUp / PgDn (2026-10-28)

**Status:** Accepted, under the maintainer's standing direction "research what LightBurn does and
copy". | **Date:** 2026-10-28

Amends ADR-493 (its Context and decision 6) and ADR-493 Amendment 1, which say "PageUp and
PageDown jog Z (ADR-362)". The rule in ADR-362 item 2 still holds for every Page key below: a
focused list, tab panel or the Artwork panel scrolls instead. WORKFLOW F-A15, the Keyboard
Shortcuts list and the Z+ / Z- tooltips follow.

### Context

Rolling audit v7, area L8 (`docs/audits/2026-10-28-rolling-v7/L8-canvas-interaction-history.md`,
L8-P2-3) found a clash, confirmed by an independent refuter and the coordinator. LightBurn's
draw-order keys moved the machine in KerfDesk.

- **LightBurn.** The Windows hotkey cheatsheet Rev 2.0 (SHA-256 `b47b95bf…5333`, re-read on
  2026-10-28) binds "Push forward in draw order PgUp", "Push backward in draw order PgDn", "Push to
  front Ctrl PgUp" and "Push to back Ctrl PgDn". LightBurn has no keyboard Z jog at all: the
  cheatsheet's jog keys are the four XY bracket chords, and the Move window page
  (`https://docs.lightburnsoftware.com/latest/Reference/MoveWindow/`, fetched the same day)
  documents keys for X and Y only.
- **KerfDesk before this amendment.** Bare PgUp / PgDn jogged Z one focus step (0.1 to 5 mm, at
  most 600 mm/min) on any connected, Idle CNC or a laser with confirmed Z travel, with no
  confirmation. KerfDesk's own Arrange → Draw order commands had no key. A LightBurn 2.x user who
  pressed PgDn to send a part back in draw order sent a CNC's bit down instead.

The task asked for a choice between two fixes. One was to give PgUp / PgDn to draw order and move
the Z jog to another documented key. The other was to keep the jog and fire it only when the jog
pad has focus.

### Decision

1. **PgUp / PgDn are draw order, as in LightBurn.**
   - Bare PgUp is Bring Forward and PgDn is Send Backward.
   - Ctrl/Cmd+PgUp is Bring to Front and Ctrl/Cmd+PgDn is Send to Back.
   - Each runs the Arrange → Draw order command's store action and names the undo step after it.
     The keys are shown beside those menu items. They come from the one Arrange key table
     (`src/ui/commands/arrange-shortcut-keys.ts`) that also feeds the menu.
   - They need a selection. Without one the key is consumed and nothing changes, like every
     Arrange key. A held key does not repeat.
   - A focused list, tab panel or the Artwork panel keeps its Page-key scrolling (ADR-362 item 2).
2. **Keyboard Z jog is Ctrl/Cmd+Alt/Option+PgUp / PgDn.**
   - It joins the same Ctrl-plus-Alt family as LightBurn's XY jog chords (Ctrl+Alt+[ / ]).
   - Every other rule is unchanged:
     - the jog pad must be shown and enabled, and Z focus ready (a CNC, or a laser with confirmed
       Z travel);
     - one step per press, with no auto-repeat;
     - nothing in a dialog, a text field or a focused scrolling list;
     - no keypad key, whatever Num Lock sends (Amendment 1).
   - Shift held with the chord does not jog.
   - Windows AltGr arrives as Ctrl+Alt, so AltGr+PgUp also jogs. The Page keys type no character
     for AltGr to compose.
   - The Z+ / Z- buttons' tooltips name the chord. On macOS they read ⌥⌘⇞ / ⌥⌘⇟.
3. **Why move the jog rather than scope it to the pad's focus.**
   - With focus scoping, the same key would restack artwork or move the machine depending on where
     keyboard focus happens to sit. After a click on Z+, focus is on the pad, so a LightBurn user's
     next PgDn, meant for the draw order, would still send the bit down.
   - Amendment 1 already removed one case of a key that moves the machine differently by hidden
     state. A chord with two modifiers is also much harder to press by accident than a bare key,
     which suits a key that moves the machine.
   - Removing keyboard Z jog altogether, as LightBurn has none, was rejected. It is a documented
     KerfDesk feature (MCH-07) that CNC users rely on.

### Consequences

- KerfDesk users who jogged Z with bare PgUp / PgDn now restack the selection instead. That is
  visible and undoable, and nothing moves. The desktop update notes say so.
- In a browser tab, Ctrl+PgUp / Ctrl+PgDn are the browser's tab-switch keys and may never reach the
  page. This was not tried in a browser; the desktop app receives them.
- Ctrl+Alt+PgUp / PgDn was not tried against Linux desktop window-manager shortcuts. No machine
  was operated.

### Verification

- `src/ui/app/arrange-shortcuts.test.ts` covers the four draw-order chords and Cmd on macOS, the
  undo name, and a key with nothing selected (consumed, no change). It leaves a focused listbox
  and the Artwork panel scrolling, and leaves the Z chord, Shift+PgUp and Ctrl+Shift+PgDn alone.
- `src/ui/laser/use-jog-shortcuts.test.ts` checks:
  - bare PgUp / PgDn, Ctrl+PgUp, Alt+PgDn, Shift+PgUp and Ctrl+Alt+Shift+PgDn never jog and are
    not consumed by the jog;
  - Ctrl+Alt+PgUp / PgDn and Cmd+Option jog Z;
  - the earlier scroll-region, Artwork-panel, consumed-key and keypad cases still hold with the
    chord held.
- `src/ui/laser/JogPad.keyboard-jog.test.tsx` repeats the audit's reproduction through the real
  pad on a CNC. Bare PgUp / PgDn send no jog. Ctrl+Alt+PgDn sends `{ dz: -1, feed: 600 }`.
- `src/ui/app/lightburn-shortcut-parity.test.tsx`, through the real `useShortcuts` and jog
  listeners:
  - PgUp, Ctrl+PgUp, PgDn and Ctrl+PgDn restack the fixture as the commands do, with no jog;
  - Ctrl+Alt+PgUp / PgDn jog `[1]`, `[-1]` and leave the draw order and the undo history alone.
