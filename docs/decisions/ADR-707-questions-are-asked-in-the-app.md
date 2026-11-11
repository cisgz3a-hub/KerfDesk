## ADR-707 - Questions are asked in the app: an in-app confirm, alert and prompt replace the native boxes

**Status:** Accepted (fix group F1 of the user annoyance audit A1,
`docs/audits/2026-11-11-annoyance-a1/`). First slice: the module and five migrations. The rest of
the native boxes move in later changes, listed under "Plan". No G-code, Start guard, Frame gate or
controller command changes: an offer that was made is still made, with the same safety wording.
| **Date:** 2026-11-11

### Context

- 109 call sites under `src/ui` reach `window.alert`, `window.confirm` or `window.prompt` through
  `src/ui/state/job-aware-dialogs.ts` (74 alert, 34 confirm, 1 prompt).
- A native box suspends the renderer: Pause and Abort cannot be clicked, the status poll stops and
  the ack-driven sends stall. PROJECT.md non-negotiable 9 forbids a modal that blocks Abort. So the
  wrapper refuses confirm and prompt while a job is active and shows one fixed toast, "A job is
  running — stop it before discarding or replacing work.", whatever was asked.
- "Active" is wide: `streaming`, `paused`, `tool-change`, `done` and `errored`.
- A native box has two buttons it cannot name, so the text must explain them ("OK: unlock now.
  Cancel: leave it blocked."). It cannot hold a link, a text field with its own check, or a
  "Don't ask again".

The audit was a static read, so each finding in this slice was reproduced first:

| Finding | Result |
|---|---|
| A1-P2-1 Save image preset on the desktop app | **Reproduced, with a different cause.** The audit read that Electron's `prompt()` returns null and shows nothing. On the pinned Electron 44.9.1 (Chromium 152) it **throws** `Error: prompt() is not supported.` (a hidden window, sandbox on, `window.prompt('Preset name')`, 10 ms). The click handler dies, no preset is saved, and the global handler shows "Something went wrong in KerfDesk…". Not run in the packaged app |
| A1-P2-4 confirms refused during a job | Reproduced by `job-aware-dialogs.test.ts` on `main` and by reading the three callers: delete material preset (which then adds "Delete cancelled."), delete library, name an image preset |
| A1-P3-1 Help > Safety and About | Reproduced by reading: both were `jobAwareAlert` of plain text, so a toast during a job |
| A1-P3-3 refused Start said twice | Reproduced by reading: `reportStartBlockers` then `jobAwareAlert`, at two sites |
| A1-P3-8 Frame offers explain their own buttons | Reproduced by reading the five prompts |

### Decision 1 - One promise-based module, drawn on the shared Dialog

`src/ui/state/app-dialogs.ts` exports `appConfirm`, `appAlert` and `appPrompt`. Each returns a
promise. The request waits in `app-dialog-store.ts`; `AppDialogHost` (`src/ui/common/`) draws the
first one on `kit/Dialog`, as `ConfirmSaveDialog` does for Save / Don't Save / Cancel.

- Requests queue. A notice raised while a question is open waits its turn; it never replaces what
  the operator is reading.
- The host is the last dialog `App.tsx` mounts, so a question asked from inside another dialog
  paints above it and is the topmost modal for Escape and the focus trap.
- Buttons carry the caller's words. A confirm names what yes does ("Delete", "Home now"), never
  "OK". The confirm button comes first and Cancel second, as in `ConfirmSaveDialog`. Escape is
  Cancel.
- `appPrompt` takes a `validate` function. A refused value is said under the field and the dialog
  stays open with the typed text, so a bad name no longer costs a second popup and a restart.

### Decision 2 - A question may be asked during a job; a caller names the ones that may not

An in-app dialog does not suspend the page, so nothing forces it to be refused during a job.
`appConfirm` and `appPrompt` are therefore asked whenever they are called, unless the caller passes
`refuseDuringJob`: the text of a toast. With it, a question asked while a job is active is answered
no and the toast is shown, and so is a yes given after a job began while the question was open.

A caller sets `refuseDuringJob` when its yes replaces or discards the open project, or sends the
machine a command. Every such caller writes its own sentence; the one fixed toast is not reused.
`job-aware-dialogs.ts` is unchanged and still serves the call sites that have not moved.

### Decision 3 - The dialog never covers or disables Abort

This is a property of `kit/Dialog`, which the host must keep using:

- its backdrop is `--lf-z-dialog` (1000) and the Live Motion bar is the highest stacking order, so
  the bar paints above it;
- the backdrop is padded by `--lf-live-motion-inset`, so the dialog sits above the bar, not under it;
- the workspace behind is hidden from assistive technology with `aria-hidden`, never `inert`, and
  the bar is exempt (`hide-outside-modal.ts`);
- `Ctrl+.` aborts from inside a dialog, as before.
- the crash screen mounts no host. Its own Abort button has no Live Motion bar above it, so a
  question drawn there could cover it. When the host unmounts, every waiting question is answered
  as cancelled; one asked after that stays unanswered. Either way its action is never taken.

`AppDialogHost.abort-reachable.test.tsx` holds this for confirm, alert and prompt during a
streaming job: ABORT JOB is enabled, outside any `aria-hidden` or `inert` ancestor, calls
`stopJob` when clicked, and leaves the question open and unanswered; a timer and a streamer step
both run while the question is open. `e2e/app-dialogs.e2e.ts` clicks ABORT JOB with a
real pointer in Chrome while a dialog is up, and checks that the dialog ends above the bar.

### Decision 4 - A held key never answers a question (ADR-207 Amendment 3)

Chromium clicks a focused button on every auto-repeated Enter. A dialog that opens because a button
was pressed with Enter would otherwise be answered by the same held key.

- Everything inside an in-app dialog is behind one guard built on `use-fresh-key-activation.ts`: an
  auto-repeated Enter or Space, and the release of a Space that was pressed before the dialog
  opened, are cancelled before the browser turns them into a click or a form submit. A fresh press
  works as usual. Space typed in the prompt's text field is a character and is left alone.
- A caller may ask for `initialFocus: 'surface'`. The dialog then focuses itself, as Job Review
  does, so a key on its way to another control presses nothing. Tab reaches every button.
- "Don't ask again" never takes the opening focus.

`e2e/app-dialogs.e2e.ts` holds Enter for two seconds, as Windows delivers a held key, on a button that
opens a question: the question opens, its confirm button is focused, and it stays unanswered. A
fresh Enter then answers it.

### Decision 5 - "Don't ask again" is opt-in, by key

A caller opts in with `dontAskAgainKey`. The dialog then shows a "Don't ask again" box. Ticking it
and answering yes stores `kerfdesk.dont-ask-again.v1.<key>` in localStorage, and the same question
is then answered yes without being shown. A no is never remembered. Every read and write is inside
`try/catch`: when storage is missing, full or blocked, the question is asked again.

Rules for callers:

- never on a question whose yes sends the machine a command, or cannot be undone;
- `refuseDuringJob` is checked before the remembered answer;
- the first caller to opt in must also add the way to bring the questions back
  (`forgetDontAskAgain`, meant for Settings > Notifications, fix group F3).

No caller opts in in this slice. The first planned one is "Release motors?" (A1-P3-2).

### Decision 6 - A live page means a question can go stale

A native box froze the page, so the controller could not be seen to change while it was open. An
in-app question can stay open for minutes with status reports arriving. A caller whose yes sends a
command must read the state again after the answer and never act on what it read before asking.

Frame's offers go through `askMachineOffer` (`src/ui/laser/machine-offer.ts`). A yes counts only if
the controller session is the one that was asked about and the offer's own condition still holds
(the same alarm; Work Z still unset; the same unrestored origin). Otherwise nothing is sent and a
toast says "The controller changed while the question was open, so nothing was sent. Frame the job
again." The Zero Z step also reads the status sequence after the answer: read before it, a status
report that arrived while the question was open would have passed for the position after zeroing.

### Decision 7 - This slice

1. **Image presets (A1-P2-1).** Save asks the name with `appPrompt`; the name rules are checked in
   the dialog. The dialog's success and error alerts are toasts.
2. **Deletes during a job (A1-P2-4).** Delete material preset and Delete library ask with
   `appConfirm` and a "Delete" button, and work during a job. Naming an image preset does too.
3. **Help > About and Help > Safety & liability (A1-P3-1)** are dialogs
   (`help/HelpNoticeDialogs.tsx`), as the licence notice became under ADR-613 Amendment 1. The
   safety guide is a link, and both can be read during a job.
4. **Frame's offers (A1-P3-8)** keep what they offer (ADR-367) and their safety wording. Their
   buttons are "Unlock", "Home now", "Set origin here", "Zero Z here", and "Restore origin" or
   "Home and restore origin", each with "Cancel". The "OK: … Cancel: …" lines are gone; where one
   said what happens next, it is now a sentence ("Frame continues when the cycle finishes."). They
   open with focus on the dialog itself and are refused during a job with the store's own
   active-job sentence.
5. **A refused Start (A1-P3-3)** is said by the banner and one keyed error toast, as Frame does.

### Plan

Later changes, each its own PR. None is started here.

| Finding | What moves |
|---|---|
| A1-P2-3 | The stacked confirms in laser resume and Start from line, saved laser recovery, CNC pass and supervised recovery, Run G-code file, and the camera target engrave: one in-app review with its warnings, summary and attestation as sections |
| A1-P3-2 | "Release motors?": no confirm inside the Position job guide; "Don't ask again" on the Origin row |
| A1-P3-4 | Recovery error popups: the reason inside the open wizard |
| A1-P3-6 | The **Send $32=1** and **Send $32=0** buttons: the label is the consent |
| A1-P3-7 | Confirms for undoable replacements; deleting an image preset gets an Undo |
| A1-P3-9 | Export refusals: an error toast with the `details` fold |

Not part of this plan: the Console's `$` write confirm (A1-P3-5, owned by the Console fix
session), the "Job complete" second-pass modal (A1-P2-2, ADR-341, waiting on the maintainer), and
the desktop "No serial ports found" box (A1-P3-10, a main-process dialog).
`job-aware-dialogs.ts` is deleted when its last caller has moved.

### Consequences

- Save image preset works in the desktop app.
- Deleting a preset or a library, and naming an image preset, work while a job runs.
- A question now sits over the workspace without stopping it. Callers that send commands must
  re-check state after the answer (Decision 6). The remaining native callers keep the old freeze
  until they move, so they need no such check yet.
- A keyboard user answers a Frame offer with Tab then Enter, one key more than the native box's
  Enter. That is the price of Decision 4 for a button that moves the machine.
- A flow test that stubbed `window.confirm` for a migrated question now mocks `appConfirm` or uses
  `answerAppDialogs` (`app-dialog-test-helpers.ts`). An unanswered question leaves its promise
  pending, so such a test times out instead of passing by accident.
- Evidence: `app-dialogs.test.ts`, `AppDialogHost.test.tsx`,
  `AppDialogHost.abort-reachable.test.tsx`, `machine-offer.test.ts`,
  `AdjustImageDialog.preset-dialogs.test.tsx`, `HelpNoticeDialogs.test.tsx`,
  `start-job-authorization-reporting.test.ts`, the updated offer and delete suites, and the e2e
  spec above. Not run in the packaged Electron app or on real hardware.
