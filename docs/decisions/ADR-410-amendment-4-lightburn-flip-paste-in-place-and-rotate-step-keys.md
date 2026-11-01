## ADR-410 Amendment 4 - Flip, Paste in Place and the 45° / 1.5° rotate keys are LightBurn's (2026-10-28)

**Status:** Accepted, under the maintainer's standing direction "research what LightBurn does and
copy". | **Date:** 2026-10-28

Amends ADR-410 decisions 1 (Rotate 90°) and 4 (Paste in Place). WORKFLOW F-A15 and the Keyboard
Shortcuts list follow.

### Context

Rolling audit v7, area L8 (`docs/audits/2026-10-28-rolling-v7/L8-canvas-interaction-history.md`,
L8-P2-1 and L8-P2-2) pressed LightBurn's documented keys into KerfDesk's real window listeners. An
independent refuter and the coordinator confirmed it.

LightBurn's sources, re-read on 2026-10-28:

- The Windows hotkey cheatsheet, "Rev 2.0 - November 13 2025"
  (`https://docs.lightburnsoftware.com/2.1/download/LightBurnWindowsHotkeysV2.0.pdf`, SHA-256
  `b47b95bf99b1c5e62ddbefe5f797b1ac6d9ac074966a6eb29685f57a949c5333`, the same file the audit
  read). It gives Flip horizontal `Ctrl Shift H`, Flip vertical `Ctrl Shift V` and Paste in place
  `Alt V`. Its rotate keys are 45° on `Shift .` / `Shift ,`, 15° on `Ctrl .` / `Ctrl ,` and 1.5° on
  `Ctrl Shift .` / `Ctrl Shift ,`.
- The 1.7 Arrange menu page, which gives Flip Horizontal and Flip Vertical as
  "Shift + Ctrl / Cmd + H" and "+ V".

Decision 4 said of `Ctrl/Cmd+Shift+V`: "LightBurn lists no shortcut; this chord is the Illustrator
and Figma one and was free". That rested on the 1.7 Edit menu page alone. The chord was not free:
it is LightBurn's Flip Vertical. So a LightBurn user who copied a part and then pressed
Ctrl+Shift+V to flip some artwork got no flip. Instead a copy landed exactly on top of the copied
part.

- The canvas looked unchanged. The Undo list gained "Paste in Place".
- A Line part burned twice (the refuter measured 240 → 320 mm of lit length, with no stacking
  warning for vectors).
- On a Fill operation the stacked copy cancelled the part: it burned nothing (L8-P1-1).

Ctrl+Shift+H and Alt+V did nothing.

LightBurn's 15° keys, Ctrl+. and Ctrl+,, are KerfDesk's Abort and Settings. The refuter lowered
that finding to P3 because both are decided bindings (WORKFLOW F-A15, ADR-362 item 2, ADR-499
decision 4), and the clash only ever stops a job. But no ADR recorded it, and the 45° and 1.5° keys
did nothing.

### Decision

1. **Ctrl/Cmd+Shift+H and Ctrl/Cmd+Shift+V flip** the selection horizontally and vertically.
   - They run the same store action as Arrange → Flip Horizontal / Vertical and the bare `H` / `V`
     keys, which stay, and they name the undo step the same way.
   - With nothing selected the chord is still consumed and does nothing, so it never falls
     through to the browser (Firefox opens its history on Ctrl+Shift+H).
   - In a text field the browser keeps the chord (Ctrl+Shift+V pastes plain text there).
2. **Paste in Place is Alt/Option+V**, LightBurn's key.
   - It is read the way every Alt-letter chord is (`isAltLetterChord`), so Option+V works on
     macOS, where it types a symbol.
   - The Edit menu shows `Alt+V`. Ctrl/Cmd+Shift+V no longer pastes anything.
3. **Rotate by a step.**
   - `Shift+.` / `Shift+,` turn the selection 45° clockwise / counter-clockwise.
   - `Ctrl/Cmd+Shift+.` / `Ctrl/Cmd+Shift+,` turn it 1.5°. That is LightBurn 2.x; its 1.7 page
     gave 5° for this chord.
   - The turn is about the centre of the selection's combined bounds. It is one undo step, named
     for example "Rotate 45° Clockwise".
   - Shift changes the character a key types, so these chords are matched by the physical key
     (`Period`, `Comma`). On a layout where Shift on that key types a full stop or a comma (Shift
     on AZERTY's `Comma` key types `.`), the chord is not a step rotation. It stays whatever that
     character already meant: the 90° turn of decision 1, Abort or Settings.
4. **LightBurn's 15° keys are not bound.**
   - `Ctrl/Cmd+.` stays the software Abort (PROJECT.md non-negotiable 9, ADR-362 item 2). It still
     listens in the capture phase and ignores every other gate.
   - `Ctrl/Cmd+,` stays Settings (ADR-499 decision 4).
   - The Keyboard Shortcuts list names the 45° and 1.5° keys and no 15° key. An operator who
     presses Ctrl+. out of LightBurn habit during a burn stops the job, which is the safe
     direction.

### Alternatives

- **Keep Ctrl+Shift+V as Paste in Place and document the difference.** Rejected. The hidden stack
  burns a part twice, or not at all on Fill, and the flip that a LightBurn user expects is
  visible and undoable.
- **Put the 15° turn on another chord.** Not done. LightBurn has no second key for it to copy, and
  the Arrange menu and Numeric Edits already turn by any angle.

### Consequences

- Muscle memory changes for KerfDesk users who pasted in place with Ctrl+Shift+V. The same press
  now flips the selection: visible, and undone with Ctrl+Z. The desktop update notes say so.
- Abort is unchanged: `installAbortShortcut` is untouched. On a US keyboard Ctrl+Shift+. reports
  `>` and does not reach it, and a layout that reports `.` for that chord still aborts with it.

### Verification

- `src/ui/app/editing-tool-shortcuts.test.ts` covers the flip chords, which never paste, and the
  chord consumed with nothing selected. It covers Alt+V, including macOS Option+V, and leaves
  Alt+Shift+V and Ctrl+Alt+V to other handlers. It covers the four step rotations, and a Shift
  chord that types `.` or `,` staying with its old binding.
- `src/ui/app/lightburn-shortcut-parity.test.tsx` presses the keys into the real `useShortcuts`,
  the capture-phase Abort and the keyboard jog listeners:
  - Ctrl+Shift+V with artwork on the clipboard gives exactly the menu's vertical flip, still
    three objects, undo step "Flip Vertical".
  - Alt+V adds one copy at the copied position, undo step "Paste in Place".
  - Shift+. turns 45°, and Ctrl+Shift+, turns 1.5° counter-clockwise.
  - Ctrl+. during a job calls Abort once and turns nothing.
  - Ctrl+Shift+. during a job turns 1.5° and does not abort.
  - Ctrl+. while idle is not consumed.
- No keyboard other than jsdom's synthetic events was tried, and no browser-reserved chord was
  run in a real browser tab.
