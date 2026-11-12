## ADR-708 - Toast rules: lifetime by length, a paused countdown, one slot per repeat, one toast per action, and a notice history (2026-11-11)

**Status:** Accepted. Fixes user annoyance audit A1 findings A5-P2-2, A5-P2-5 and A5-P2-6
(`docs/audits/2026-11-11-annoyance-a1/`, fix group F2). Extends ADR-687 decision 4 (a toast may fold
a short list of notes). Keeps ADR-232 (bounds and no-go zones warn, they never refuse or change a
move), ADR-207 and UX audit U7-P2-1 (a live region must not be flooded) and PROJECT.md
non-negotiable 9 (nothing covers or delays the Abort control). Frame, Start, output policy, G-code
and licences are unchanged. Unit-tested; no machine was operated. | **Date:** 2026-11-11

### Context

Each finding was reproduced on `main` before it was changed.

- **A toast's lifetime depended on its colour only**: 4 s for a success, 8 s for the rest. A
  231-character instruction left as fast as "Saved". Nothing stopped the countdown while the
  operator was reading.
- **A5-P2-2.** `warnJogMotionPolicy` pushed an unkeyed warning for every jog request and every queued
  step. Ten jogs with an unknown position stacked ten 249-character toasts. The bounds text embedded
  the target's coordinates, so five queued steps past the edge were five different toasts.
- **A5-P2-6.** An SVG import described seven toasts for one file and File > Open pushed one per
  note. Only the newest three render, so the first were never seen, and there was no history.
- **A5-P2-5.** The Surfacing save and the camera target's "what to do next" were toasts.
- A keyed toast that newer toasts had pushed out of the visible three was rewritten where nobody
  could see it. The live region announces additions only, so a keyed warning rewritten with new text
  was never spoken.

### Decision

1. **Lifetime grows with the text** (`toastLifetimeMs`): two seconds to notice the toast plus 60 ms
   a character (about 200 words a minute), never less than the variant's minimum (success 4 s,
   others 8 s) and never more than 30 s. "Saved" still leaves in 4 s; a 249-character warning stays
   about 17 s. Only the message counts, not folded notes.
2. **The countdown stops while the operator points at a toast or has keyboard focus inside it**, and
   resumes with the time that was left, at least 2 s. The toast body still takes no pointer input:
   the pointer is watched on the document and compared with each toast's box
   (`use-toast-pause.ts`), so a click or drag through a toast reaches the canvas as before. A pointer
   with a button held is a drag, not reading, and does not pause. A toast whose notes were opened
   stays until dismissed, as before.
3. **A keyed toast is one slot.** The same key rewrites it and restarts its time. It keeps its place
   while it is on screen; if newer toasts pushed it out of the visible three, it returns as the
   newest. Rewritten under the pointer, it stays paused.
4. **Jog warnings share one slot** (`jog-motion-policy`). All findings of one jog are said together,
   so a no-go crossing cannot overwrite a bounds warning. The on-screen text drops what changes with
   each click and what the operator cannot act on:
   - bounds: "Jog target is outside the configured machine bounds X…, Y…. Controller limits still
     apply." (no target coordinates);
   - unknown position: "The machine XY position is unresolved, so this jog is not checked against
     the configured bounds or no-go zones. It is sent unchanged.";
   - no-go zone: "This jog path crosses the configured no-go zone "name". It is sent unchanged; use
     Cancel Jog to stop it."

   The console log keeps every full sentence, one line per finding per jog, as before. The jog is
   still sent unchanged. A Frame's route warnings are not jog clicks and stay as they were. A remote
   jog's receipt (ADR-585 Amendment 3) repeats the text the PC showed, so it carries this on-screen
   wording.
5. **One toast per action** (`folded-notice.ts`). An action's result and its notes are one keyed
   toast:
   - the result is the first line;
   - up to three notes follow in the open, one a line. That is what the stack of three toasts
     showed, so a warning that was in view stays in view (the bed-fit and white knock-out notices of
     ADR-686 among them). Warnings and errors take the open lines before plain notes, and among
     equals the later ones do, because callers put what must stay in view last;
   - any further notes fold under a last line, "n more warnings and m more notes below.", and open
     on a click, warnings first.

   The toast takes the most serious variant among its parts, and its lifetime counts every open
   line. Used by SVG import (one slot per file), File > Open of a KerfDesk or LightBurn project and
   New from template (one slot for the project, so the next project's notices replace the last
   one's), autosave Restore and a sheet switch (these two have no result line: one note is said as
   itself, several under "About this project:"). Remote Control still returns each line of an SVG
   import separately, and its toasts on the PC are unchanged (ADR-125 Amendment 2).
6. **The status bar lists the session's warnings and errors.** Every warning and error toast is
   also recorded (`notice-history.ts`): newest first, at most 50, a repeat is one row with a count,
   held in memory only. A **Notices** control appears in the status bar with the first one and shows
   "(n new)" until opened. Its list shows each notice's time, text and folded notes, and has Clear.
   It opens over the canvas's own space, above the Live Motion popup, which stacks over it; it never
   covers a rail or the Abort control. Escape and a press outside close it, and the keys that scroll
   it do not reach the window's shortcuts.
7. **A screen reader hears each warning once.** The region stays `aria-live="polite"` and
   additions-only. A warning or error rewritten with new text is put in as a new node, so it is
   announced once with its severity. The same text again changes nothing in the page and is not
   repeated, and an info or success slot (an import's progress) still changes in place, silently.
8. **Two instructions moved to where the next step is taken.** The Surfacing panel shows "Before
   you run the saved program: zero X/Y at the area's front-left corner and Z on the surface…" under
   its Save button after a save, and the camera wizard's waiting photo step shows "Next: … Frame and
   Start it like any job, leave the sheet where it is, then take the photo here." Their toasts now
   confirm and point there.

### Alternatives

- **Show more than three toasts.** Rejected in ADR-687: a fourth pushes into the drawing.
- **Make the toast body a hover target.** Rejected: it swallowed the mousedown that starts a canvas
  drag (Toasts.tsx header). Watching the pointer needs no target.
- **Fold every note under the result.** Tried first and rejected: it hid the bed-fit and white
  knock-out warnings, which earlier decisions keep in view because the burn no longer matches the
  file. ADR-687 itself folds only technical notes.
- **Unfold every note of an action.** Rejected: nine project notes of about 200 characters each do
  not fit the 240 px band.
- **Dismiss the jog slot when the next jog is clean.** Rejected: with queued steps the warning for
  step one would vanish before it could be read. It runs out by itself and stays in Notices.
- **Persist the history or add notification settings.** Out of scope here; A5-P2-7 covers settings.

### Consequences

- A long toast stays up to 30 s; × still dismisses it at once.
- An action's fourth and later notes are one click away instead of lost. The toast says how many
  there are and takes the warning colour, and Notices keeps the whole toast.
- Tests that waited for one toast per note now read the lines of one toast.
- A remote import's toasts on the PC, and the DXF, HPGL and image imports, still push one toast per
  note. They can use the same helper.
- The confirmation toasts ("Saved", "Opened", "Frame complete…", A5-P3-5) are unchanged; a setting
  for them belongs to the notification settings of A5-P2-7.
