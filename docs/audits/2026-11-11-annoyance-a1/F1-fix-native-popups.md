# Fix group F1 — native popups (slice 1)

Decision: [ADR-707](../../decisions/ADR-707-questions-are-asked-in-the-app.md). Findings: [REPORT.md](REPORT.md) section A1.

The audit was a static read with no refuter pass, so each finding was reproduced before it was fixed.

## Reproduction

| ID | Result | Evidence |
|---|---|---|
| A1-P2-1 | **Reproduced; the cause in the report is wrong.** The report says Electron's `prompt()` "returns null and shows nothing". It throws | A hidden `BrowserWindow` (sandbox and context isolation on) in Electron 44.9.1, Chromium 152.0.7977.167, the version `package.json` pins. `window.prompt('Preset name')` threw `Error: prompt() is not supported.` after 10 ms. `AdjustImageDialog.tsx` called it from a click handler with no `try`, so the handler died, no preset was saved, and `use-global-error-handlers.ts` showed its "Something went wrong in KerfDesk…" toast with that text under details. So the report's "no message says why" is also not exact: a generic error toast appears |
| A1-P2-4 | Reproduced | `job-aware-dialogs.test.ts` on `main`: confirm returns false and prompt returns null with the one fixed toast while a job streams. The three callers read: delete material preset (adds "Delete cancelled."), delete library, name an image preset |
| A1-P3-1 | Reproduced | `CommandShell.tsx` called `jobAwareAlert(SAFETY_NOTICE_TEXT)` and `jobAwareAlert(aboutText())`: plain text in a native box, a toast during a job |
| A1-P3-3 | Reproduced | `start-job-authorization-reporting.ts` and `start-job-transmission.ts` each called `reportStartBlockers` and then `jobAwareAlert` |
| A1-P3-8 | Reproduced | The five prompt texts each ended in "OK: … Cancel: …" lines |

Nothing was refuted outright. Not checked: the packaged desktop app (the Electron check used the pinned binary with a blank page, not KerfDesk's own window), and real hardware.

## Fix status

| ID | Status | What changed |
|---|---|---|
| A1-P2-1 | **Fixed** | Save asks the name in an in-app prompt; a refused name is said under the field. The dialog's eight alerts are toasts |
| A1-P2-4 | **Part fixed** | Delete material preset, delete library and naming an image preset work during a job. Still open: add the calibration target (`CalibrationSetupStep.tsx`) and the rotary test pattern (`RotarySetupHost.tsx`), which also belong to A1-P3-7 |
| A1-P3-1 | **Fixed** | Help > About and Help > Safety & liability are dialogs; the safety guide is a link; both open during a job |
| A1-P3-3 | **Fixed** | A refused Start is the banner plus one keyed error toast |
| A1-P3-8 | **Fixed** | Named buttons: Unlock, Home now, Set origin here, Zero Z here, Restore origin, Home and restore origin. The offers and their safety wording are unchanged (ADR-367) |

## Found while fixing

- **A live question can go stale.** A native box froze the page, so Frame's offers acted on what was read before asking. An in-app question does not freeze it. Each offer now counts a yes only if the controller session and the offer's own condition are unchanged; otherwise nothing is sent. The CNC Zero Z step read the status sequence before asking, so a report that arrived while the question was open would have passed for the position after zeroing; it now reads after the answer.
- **A held Enter would have answered a question** opened from a button pressed with Enter (ADR-207 Amendment 3). In-app dialogs cancel auto-repeated Enter and Space, and the Frame offers open with focus on the dialog itself.

## Test gap left open

`collectRefusals` in `e2e/fixtures/recovery-flow.ts` records native boxes whose text starts with "Cannot" or "Could not". The recovery and second-pass specs assert it stays empty. A refused Start is now a toast, so that guard no longer sees one; those specs still assert that the job ran. The helper should read the toast store when the recovery flows move (A1-P2-3). It was left alone here because changing that fixture pulls every spec that imports it into the pull-request smoke run.

## Still open in F1

A1-P2-3 (stacked confirms in recovery, resume, Run G-code file, camera target), A1-P3-2 (release motors), A1-P3-4 (recovery error popups), A1-P3-6 (`$32` send buttons), A1-P3-7 (undoable confirms), A1-P3-9 (export refusals), A4-P3-5. A1-P3-5 (the Console `$` confirm) belongs to the Console fix session. A1-P2-2 waits on the maintainer.
