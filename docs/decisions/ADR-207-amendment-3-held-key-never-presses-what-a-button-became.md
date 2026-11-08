## ADR-207 Amendment 3 - A held key never presses what a focused button turned into (2026-11-08)

**Status:** Accepted on 2026-11-08 |
**Amends:** ADR-207 Amendment 2 Decision 7 (Pause → Pausing… → Resume flips in one focused
button) and the U7-P3-1 focus hand-back of Frame job and Set origin here. It changes no G-code, no Start guard and no
controller command: ABORT JOB and `Ctrl+.` act exactly as before, and a mouse click is untouched.

### Context

Rolling audit v10 (`docs/audits/2026-11-07-rolling-v10/V8-fix-help-a11y-wording.md`) found
V8-P2-1, which its refuter reproduced and raised to **P1**. Amendment 2 kept Pause, Pausing… and
Resume as one button so it keeps keyboard focus, and Start job hands focus to it. Chromium clicks a
focused button on every Enter **keypress**, auto-repeats included (Blink
`HTMLElement::HandleKeyboardActivation` has no repeat check). With a simulated GRBL in Chromium
156 the refuter saw:

- a 1 s hold of Enter on Pause sent `0x84`, then `0x7E` on the first repeat after the hold
  confirmed (about 508 ms): the burn resumed without a deliberate Resume;
- a 2 s hold toggled Pause and Resume about every 250 ms;
- a held Enter on Job Review's Start job paused and resumed the job once focus reached Pause;
- a 600 ms hold sent two resumes, and KerfDesk then sent its fail-dark `0x18`, ending the job.

The same audit's V9-P3-1 (P3, beam off) found the sibling: Frame job turns itself off while it
runs and `useFocusThroughDisable` hands focus back when it turns on again, so a 4 s hold of Enter
ran two extra Frame traces.

The shared paced GRBL e2e fixture decoded writes as UTF-8, which turns `0x84` into U+FFFD, so no
paced e2e run had ever paused.

### Decision

1. **A focused button that changes what it does in place acts only on a fresh key press made for
   what it says now** (`useFreshKeyActivation`, `src/ui/common/use-fresh-key-activation.ts`).
   It cancels, before the browser turns them into a click:
   - an auto-repeated Enter or Space (`KeyboardEvent.repeat`), including repeats that arrive after
     focus moved to the button while the key was down (Start job → Pause);
   - a second Enter or Space while one is still down: the button re-arms only on keyup;
   - a Space released after the button changed meaning (its label, or whether it is off), since
     Space clicks on release. Tool-change Continue turning on under a held Space counts.

   Focus leaving the button forgets the held key, so a keyup lost to another window never locks it.
2. **Where it applies:** the Live Motion bar's primary action (`LiveMotionActionButton`: Pause,
   Pausing…, Resume, Lifting…, Returning…, tool-change Continue), and the two buttons whose focus
   `useFocusThroughDisable` hands back when they turn on again (U7-P3-1): Frame job, which comes
   back as Frame again, so a held Enter cannot frame twice (V9-P3-1), and Set origin here.
3. **Checked and unchanged:** ABORT JOB (any press should abort; untouched by design) and `Ctrl+.`.
   Job Review focuses its own surface when it opens, so a held Enter on Start never reaches Start
   job. Other buttons that relabel while focused (Starting…, Stopping…)
   become truly `disabled`, so the browser cannot press them.
4. **The paced GRBL e2e fixture reads raw bytes** (`e2e/fixtures/paced-grbl-serial.js`) and models
   GRBL 1.1's safety door: `0x84` gives Door:2 while decelerating, then Door:0; `~` from Door:0
   gives Door:3 while restoring, then Run. Reports carry `Ov:`, so a laser's spindle-off proof
   holds. Every realtime command but `?` is logged with its time.

### Consequences

- A keyboard user still pauses with one Enter or Space and resumes with a second, separate press.
  Holding the key does nothing more.
- A platform that sends auto-repeat as keyup/keydown pairs without `repeat` would still look like
  fresh presses. Chromium sets `repeat` on Windows, macOS and Linux.
- Evidence: `use-fresh-key-activation.test.tsx` (rules, plus the button: a held Enter pauses once
  and never resumes; three of its button cases fail without the guard) and
  `e2e/live-motion-held-enter.e2e.ts` (CDP `Input.dispatchKeyEvent` with `autoRepeat: true`, as
  Windows delivers a held key: a 2.5 s hold on Pause sends one `0x84` and no `0x7E` or `0x18`, and
  a fresh press then resumes; a 2 s hold on Start job sends no realtime byte at all; a 4 s hold on
  Frame again runs one Frame, where the unguarded button ran more). Not run on the
  packaged Electron 44 app (Chromium 152) or on real hardware.
