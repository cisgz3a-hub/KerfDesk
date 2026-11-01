## ADR-499 Amendment 2 - Alt+Shift+H / V move together; Distribute spacing has no key; Ctrl+Y redoes and Shift+= zooms (2026-10-28)

**Status:** Accepted, under the maintainer's standing direction "research what LightBurn does and
copy". | **Date:** 2026-10-28

Amends ADR-499 decision 5 (align and distribute keys). It also records two smaller key fixes from
the same audit to the WORKFLOW F-A15 Edit and View lists: Ctrl+Y and Shift+=. The Keyboard Shortcuts
list follows.

### Context

Rolling audit v7, area L8 (`docs/audits/2026-10-28-rolling-v7/L8-canvas-interaction-history.md`),
was confirmed by an independent refuter and the coordinator.

- **L8-P2-4.** Decision 5 bound Alt+Shift+H and Alt+Shift+V to Distribute spacing: "LightBurn has
  none; these follow Figma". Its own Context concedes that "the LightBurn and Rayforge reference
  pages were not re-read for this batch".
  - LightBurn's 1.7 Distribute page gives **Move H Together** as "Alt/Option+Shift+H" and **Move V
    Together** as "Alt/Option+Shift+V". Its Windows hotkey cheatsheet Rev 2.0 (SHA-256
    `b47b95bf…5333`, re-read on 2026-10-28) agrees: "Move H-together Alt Shift H". The cheatsheet
    binds no Distribute-spacing key.
  - So a LightBurn user's Alt+Shift+H equalised the gaps (b went from 50 to 65) instead of
    closing them. KerfDesk's own Move H / V Together had no key.
- **L8-P2-7 (refuter: P3).** F-A15 lists "`+` / `=` — Zoom in". But the View handler refused every
  Shift chord before it read `+`, so `+` typed as Shift+= on a US keyboard did nothing.
- **L8-P3-9.** Design Studio redoes on Ctrl+Y (WORKFLOW, Design Studio step 1), but the main canvas
  did not.

### Decision

1. **Alt/Option+Shift+H is Move H Together and Alt/Option+Shift+V is Move V Together**, as in
   LightBurn.
   - They run the Arrange menu commands' store action and name the undo step after them. The menu
     shows the keys.
   - Like the align keys they need two or more objects or groups. With fewer, the chord is
     consumed and nothing changes.
   - The key is still read by position on macOS, where Option+Shift types a composed character.
2. **Distribute spacing has no key**, as LightBurn gives it none. Arrange → Distribute and Find a
   command (Ctrl+K) still run it.
3. **Ctrl/Cmd+Y redoes on the main canvas**, the Windows convention and Design Studio's key.
   Ctrl/Cmd+Shift+Z, LightBurn's only documented Redo, stays. A text field keeps its own Ctrl+Y.
4. **`+` typed with Shift zooms in**, as F-A15 always said. Shift is allowed for `+` only.
   Alt with it is left alone, because Alt++ is LightBurn's Boolean union. Unshifted `=` and the
   keypad `+` zoom as before.

### Consequences

- KerfDesk users who distributed spacing with Alt+Shift+H / V now move the selection together.
  That is visible and undoable. The desktop update notes say so.
- The audit's other View-key finding, that View keys ignore Alt so Alt+- zooms out (L8-P3-8), is
  not changed here. Alt+P is LightBurn's Preview and works only because of that, so refusing Alt
  needs its own pass over LightBurn's Alt keys.

### Verification

- `src/ui/app/arrange-shortcuts.test.ts` covers:
  - Alt+Shift+H / V calling Move Together, including macOS Option letters, and never with fewer
    than two units;
  - a Distribute-spacing command whose menu item shows no key;
  - every key in the Arrange table appearing beside its menu command, whether the command is
    enabled or not.
- `src/ui/app/lightburn-shortcut-parity.test.tsx` presses the keys into the real `useShortcuts`:
  - Alt+Shift+H and Alt+Shift+V give exactly the store's Move Together result, not the distribute
    one, with the undo step named after the command;
  - Shift+= zooms 2 → 2.5, and Alt+Shift+= does not;
  - Ctrl+Y after Ctrl+Z restores the flipped project.
