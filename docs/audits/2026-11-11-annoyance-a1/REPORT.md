# User annoyance audit A1 — report

Ledger and totals: [LEDGER.md](LEDGER.md). Tree: `origin/main` @ `a1518de75`.

## Method and limits

- **Static read only.** Nothing was run in a browser, in Electron or against a controller simulator. Every finding cites code that was read. Findings that depend on runtime behaviour say "runtime check owed".
- **Five areas.** The coordinator traced A2 (Start, Frame, Job Review). Four read-only agents covered A1, A3, A4 and A5, one area each.
- **Coordinator check.** Every P2 below was re-read in `main`'s code by the coordinator before it was ledgered. P3s are the area agent's reading unless marked.
- **No refuter pass.** The rolling-audit method (auditor, refuter, coordinator) was shortened to auditor and coordinator. Treat ratings as provisional until a fix session reproduces each one.
- **Deliberate design is listed, not overruled.** Where an ADR or the maintainer's own instruction set the behaviour, the finding says so and goes to the decisions list in the ledger.

Finding IDs are `A<area>-P<severity>-<n>`. `D` marks a decision for the maintainer.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Stops a user's work, or loses it. |
| P2 | Interrupts or blocks often. A workaround exists. |
| P3 | Polish: wording, a rare interruption, or an inconsistency. |

---

## A1 — Native popups and modal dialogs

### Count

109 call sites under `src/ui` reach a native box through `src/ui/state/job-aware-dialogs.ts`: 74 `alert`, 34 `confirm`, 1 `prompt`. Six more pass `jobAwareConfirm` as a callback. No code calls `window.alert/confirm/prompt` directly.

| Flow | alert | confirm | prompt |
|---|---|---|---|
| CNC recovery (pass and supervised) | 25 | 7 | 0 |
| Laser recovery, resume, Start from line | 15 | 4 | 0 |
| Start and resume refusals | 9 | 0 | 0 |
| G-code, `.rd` and tiled export | 8 | 0 | 0 |
| Image presets (Adjust Image) | 8 | 0 | 1 |
| Origin, release motors, Zero Z, accessories | 1 | 7 | 0 |
| Camera calibration target | 4 | 2 | 0 |
| Controller settings (Console `$`, `$32` buttons, Forget, device setup, rotary pattern) | 0 | 6 | 0 |
| Frame "fix in place" offers | 0 | 5 | 0 |
| Project and library open/save | 2 | 1 | 0 |
| Material library deletes | 0 | 2 | 0 |
| Help > About and Safety | 2 | 0 | 0 |

No control anywhere in `src/ui` remembers a dismissal ("don't ask again", "don't show again"): a search for those phrases finds nothing.

### A1-P2-1 — "Save" image preset does nothing in the desktop app

- `src/ui/raster/AdjustImageDialog.tsx:126-127`: `const name = jobAwarePrompt('Preset name'); if (name === null) return;`. The wrapper calls `window.prompt` (`job-aware-dialogs.ts:46`).
- Electron (pinned `44.9.1`, `package.json:124`) does not implement `prompt()`: it returns null and shows nothing. No override exists in `electron/` or `src/`.
- Result on desktop: the user clicks Save, nothing appears, no preset is saved, and no message says why.
- In a browser it works, but an empty name gives a second popup and the user starts again.
- **Runtime check owed** (read only). **Frequency:** every attempt on desktop.
- **Runtime check done 2026-11-11 (fix group F1):** on Electron 44.9.1 `prompt()` throws `Error: prompt() is not supported.`; it does not return null. The handler dies and the global error toast appears. Fixed by ADR-707; see [F1-fix-native-popups.md](F1-fix-native-popups.md).
- **Lighter form:** an inline name field beside the preset list, as CNC presets already have (`src/ui/layers/CncSaveCuttingPresetRows.tsx:46-49`).

### A1-P2-2 — A modal opens by itself after every finished laser job

- `src/ui/laser/second-pass/SecondPassCompletionPrompt.tsx:47`: a "Job complete" dialog asks "Would you like to darken selected areas?" with **Not now** and **Darken selected areas…**.
- It is offered on every completion (`src/ui/app/use-job-checkpoint.ts:83`) for every non-rotary GRBL-family laser job (`second-pass/second-pass-eligibility.ts:15-25`).
- There is no "don't offer again" and no setting. A user burning ten coasters dismisses ten modals.
- The dialog's own text says the same action stays in the Machine panel.
- **Deliberate:** ADR-341 Amendments 3 and 4. **Frequency:** every laser job.
- **Lighter form:** a non-modal "Job complete" card or toast with a "Darken areas…" button, or keep the modal and add "Don't offer after each job".

### A1-P2-3 — Recovery, resume and Run-file flows stack native confirms after an in-app review

Ordinary Start folds every acknowledgement into one click (`job-review/job-review-gate.ts:254-257`). The other start paths still chain native boxes:

| Path | Native boxes in a row | Evidence |
|---|---|---|
| Laser resume / Start from line | up to 3 (controller warning, unverified settings, resume summary) | `start-job-resume-stream.ts:171-189`, `resume-review-warnings.ts:41` |
| Saved laser recovery | the same 3 | `laser-recovery-flow.ts:107-118` |
| CNC pass recovery, after its wizard | 2 to 4, ending in the 12-line CNC attestation | `cnc-pass-recovery-flow.ts:132,233,242` |
| CNC supervised recovery | 2 to 3 | `cnc-supervised-recovery-flow.ts:271-277` |
| Run G-code file, after its review | laser-mode confirm, then the CNC attestation on every CNC run | `gcode-inspector/external-run.ts:246-259` |
| Camera target engrave | up to 3 | `camera/calibrate/transient-camera-job.ts:87-106` |

- **Deliberate in content** (ADR-237, ADR-630). No ADR requires the native, one-after-another form.
- **Frequency:** rare for recovery; every run for CNC users of Run G-code file.
- **Lighter form:** show the warnings, the summary and the attestation as sections of the wizard or review already on screen, with one Start button.

### A1-P2-4 — While a job runs, confirms fail closed with a message about something else

- During a job `jobAwareConfirm` returns false and `jobAwarePrompt` returns null, with one fixed toast: "A job is running — stop it before discarding or replacing work." (`job-aware-dialogs.ts:18-19,33-47`).
- "Running" is broad: `streaming`, `paused`, `tool-change`, `done` and `errored` (`laser-store-helpers.ts:75-78`).
- Callers where the toast is wrong: delete a material preset (`MaterialLibraryRecipeControls.tsx:68`, which then adds "Delete cancelled."), delete a library (`SavedLibrariesDialog.tsx:93`), name an image preset (`AdjustImageDialog.tsx:126`), add the calibration target (`CalibrationSetupStep.tsx:193`), rotary test pattern (`RotarySetupHost.tsx:31`).
- **Deliberate:** fail-closed protects non-negotiable 9 (no modal may block Abort). It does not require native boxes.
- **Frequency:** every long job for users who prepare the next piece meanwhile.
- **Lighter form:** in-app confirms do not freeze the page, so they can stay available during a job. At minimum each caller passes its own text.

### A1 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| A1-P3-1 | Help > Safety is a 43-line native alert with a link that cannot be clicked; during a job it becomes an 8 s toast in a 180 px stack. About is the same. ADR-613 moved the licence text to a React dialog for this reason and left these behind | `commands/CommandShell.tsx:120-122`, `help/safety-notice.ts:9-51`, `common/Toasts.css:6` | Reuse `help/LicenseNoticeDialog.tsx` |
| A1-P3-2 | "Release motors?" six-line confirm on every hand-positioning, including inside the Position job guide that then walks through Wake and Unlock anyway | `laser/hand-position-copy.ts:1-6`, `OriginRow.tsx:320`, `NoHomingPositionGuide.tsx:134` | No confirm inside the guide; "Don't ask again" on the Origin row |
| A1-P3-3 | A refused Start is reported twice: inline banner plus native alert. Frame uses banner plus toast | `start-job-authorization-reporting.ts:40-43`, `start-job-transmission.ts:130-132` | Banner plus toast |
| A1-P3-4 | Recovery error popups a user cannot act on ("The fail-closed recovery policy refused execution.", "The sealed semantic recovery manifest is missing…"). 40 alerts sit in flows that already have a wizard or card on screen | `cnc-supervised-recovery-flow.ts:266,323`, `start-job-source.ts:274` | Reason inside the open wizard, plain words plus one next step, detail folded |
| A1-P3-5 | Every `$N=value` typed in the Console asks "Send persistent controller setting?" for the line just typed. Five settings, five popups | `laser/console/run-console-command.ts:42-47` | "Don't ask again this session", or confirm only `$RST=` and position settings |
| A1-P3-6 | Buttons labelled for one write then confirm it (**Send $32=1**, **Send $32=0**) | `job-review/SendLaserModeButton.tsx:21`, `SendRouterModeButton.tsx:25` | No confirm; the label is the consent |
| A1-P3-7 | Confirms for undoable replacements, and a success shown as a blocking alert ("Imported 3 image presets."). Deleting a material preset asks; deleting an image preset does not and has no undo | `CalibrationSetupStep.tsx:193`, `RotarySetupHost.tsx:31`, `AdjustImageDialog.tsx:141-152,186-188` | Toast with Undo; toast for success |
| A1-P3-8 | Frame's Home / Unlock / Set origin / Zero Z offers are native OK/Cancel boxes that must explain their own buttons ("OK: unlock now. Cancel: leave it blocked."). A CNC Frame can show two in a row | `start-blocked-alarm-offers.ts:20-58`, `start-blocked-setup-offers.ts:44-55`, `frame-cnc-preparation.ts:29-32` | The existing blocker banner with named buttons. The offers themselves are good (ADR-367) |
| A1-P3-9 | Export refusals are native alerts ("Cannot save G-code:", "Cannot export tiles:", "Cannot save .rd file:") | `app/prepare-gcode-save.ts:39,71`, `save-tiled-gcode.ts:74-92`, `save-rd-action.ts:137` | Error toast with the `details` fold |
| A1-P3-10 | Desktop "No serial ports found" box loops on Retry, does not close when a port arrives, and points to Help, which cannot be opened while the box is up | `electron/serial-port-wait.ts:19-20,60-73` | Close on port arrival; add a Troubleshooting button |

### A1 checked and sound

- Closing the desktop app shows one box only (Save / Don't Save / Cancel, ADR-549).
- A renderer crash shows one box.
- Escape closes every in-app `Dialog`. No dialog closes on a click outside, which is consistent and protects drafts.
- Quick Nest, Quantity production, Paged import and Trace keep Cancel or Stop available while they work.

---

## A2 — Start, Frame and Job Review

### What a user meets

1. **Frame job.** No dialog on a healthy machine. With an alarm or a missing origin, Frame offers the fix (A1-P3-8).
2. **Start.** Greyed out until a Frame completes. The line beside it says why: "Not framed — Frame this job to unlock Start" or "Frame expired — …" (`JobActionControls.tsx:214-247`).
3. **Job Review.** One dialog, one **Start job** click. The laser-mode and CNC acknowledgements are sections of it, not separate popups (`job-review/JobReviewAcknowledgement.tsx`).

No policy refusal was found between a clean Frame and the first byte, which matches the 2026-07-27 and 2026-09-24 inventories. Disabled Start and Frame buttons always carry a reason in their tooltip (`JobActionControls.tsx:253-263,293-299`).

### A2-D-1 — Job Review opens on every Start, including Run again

- `start-job-flow.ts:125-128`, `framed-run-start-review.ts:52-62`; WORKFLOW "Repeat — Run again": "Each replay prepares and reviews the current exact program".
- There is no way to skip the review for a job whose bytes were already reviewed and have not changed.
- Focus lands at the top of the dialog, not on Start (`JobReviewDialog.tsx:61`, held-Enter guard), so a repeat run is Start, then a mouse move to **Start job**.
- **Deliberate:** ADR-224 and ADR-237 (one review surface), ADR-565.
- **Frequency:** every run. Ten coasters are ten reviews, plus ten "Job complete" modals (A1-P2-2).
- **Option for the maintainer:** let **Run again** of an unchanged, already-reviewed program skip the dialog, or shrink it to a one-line confirm with a "Show review" link.

### A2-D-2 — Any jog throws a finished Frame away, even when the job is placed by a fixed origin

- `framed-run-invalidation.ts:71-83,96-99,128-141`: a permit ends on any `motionOperation` (a jog is one, `laser-motion-operation.ts:70`), any alarm, autofocus, or any state other than Idle.
- `start-job-authorization.ts:173-190` then compares machine and work position exactly, so the head must be where the Frame left it.
- For a job placed at the head's Current Position that is right: a jog moves the job. For Absolute or User Origin placement a jog does not move where the job lands, yet Start greys out and the status line reads "Not framed" or "Frame expired — The controller session, position, origin, or CNC Z reference changed after Frame."
- Typical case: Frame, then jog the gantry back to load the blank, then Start is grey.
- **Deliberate:** ADR-372 ("any transient activity") and ADR-565 ("machine mutations retain their existing coordinate-evidence invalidation"). ADR-565 already lets an Absolute footprint survive an owned job run.
- **Option for the maintainer:** let a completed plain jog keep the Frame when placement is Absolute or User Origin and the work offset is unchanged.

---

## A3 — Controller blocks

Scope: everything outside Start and Frame. Timings below are derived from constants in the code, not measured. Statements about other senders are from memory and are marked so.

### A3-P2-1 — After any Unlock the head position is hidden, and several controls say to wait for a report that can never satisfy them

- An acknowledged `$X` sets `positionEvidenceSuppressed`, unless the alarm was a failed probe (`state/laser-console-completion.ts:88-126`). While it is set, every status report has its position blanked and the work offset forced to null (`state/laser-status-position.ts:67-75`). Only Home, Set origin here, a probe or a reconnect clears it.
- Dead-end wording while it is set:
  - Move to position, Go: "The controller has not reported its work offset yet. Wait for a status report and try again." (`laser/head-move-dispatch.ts:36-37`)
  - Move to position, Use current: "The head position is not known yet. Wait for a status report." (`laser/MoveToPositionSection.tsx:63-68`)
  - Origin row: "not reported yet" (`laser/StatusDisplay.tsx:158`)
- Side effects: every jog raises the 249-character "position is unresolved" toast (A5-P2-2), and Fire is disabled with a tooltip that never says why (`laser/MomentaryFireControl.tsx:59,130-136`).
- The hiding is broader than the app's own advice: the alarm card says of ALARM:2 "The position is kept, so Unlock ($X) is safe." (`laser/alarm-card-advice.ts:47-49`), and the position is hidden anyway. `alarm-codes.ts` already carries a `positionLost` flag per alarm, which Unlock does not read.
- **Deliberate in part:** ADR-367 and its Amendment 2, which fixed this wording for Frame only.
- **Frequency:** after every alarm cleared with Unlock, which is the only route on a machine without homing switches.
- **Rating note:** the area agent rated this P1. The coordinator kept P2: jog, Set origin here, Home and Frame all still work, and Frame names the way out.
- **Lighter form:** reuse Frame's message on Move to, Use current, the origin row and the Fire tooltip. Hiding the position only for alarms marked `positionLost` is a decision for the maintainer.

### A3-P2-2 — Quick jog taps are dropped: the queued step jog of ADR-674 cannot be reached from the jog pad (bug)

- `laser/LaserWindow.tsx:89`: `stepJogsOnly = useLaserStore(canQueueStepJog) && jogPadDisabled && !jogBlocked`.
- `canQueueStepJog` needs `motionOperation.kind === 'jog'` (`state/step-jog-queue.ts:46-54`).
- `jogBlocked` is true whenever `jogFrameCommandBlockMessage` is non-null (`LaserWindow.tsx:212-216`), and that returns the motion-active message whenever `motionOperation !== null` (`state/laser-store-helpers.ts:202-207,223-227`).
- The two conditions exclude each other, so `stepJogsOnly` is always false. The line has read this way since the commit that added it (`472e06dd8`).
- The unit test renders `<JogPad disabled stepJogsOnly />` directly (`JogPad.motion-controls.test.tsx`); nothing tests the wiring in `LaserWindow`.
- **User effect:** the arrows grey out, with no tooltip, for the whole of each step and for roughly 0.5 to 0.75 s after it stops (two Idle reports at the 250 ms poll, then a marker and one more report). A second tap in that window is lost.
- **Runtime check owed** (logic read only). **Frequency:** every session.
- **Fix:** separate the job part of the block from the motion-operation part, and add a `LaserWindow`-level test.

### A3-P2-3 — Opening a lid or door at Idle leaves a controller reset as the only way out on screen

- `laser/live-motion-unowned.ts:4-6`: "Deliberately no Resume". The bar says: "The controller paused when its door or lid input opened, and stays paused after it closes. Release it with the machine's cycle-start button if it has one, or press ABORT MOTION here to clear it with a controller reset" (`:21-23,86-90`).
- ABORT MOTION is a soft reset (`state/unowned-motion-stop.ts:64-67`). On stock GRBL and FluidNC that clears an origin set with Set origin here; a machine with homing on comes back locked in Alarm, which leads into A3-P2-1.
- The Console already accepts a lone `~` for exactly this (`core/controllers/grbl/console-command.ts:161-165`), but the bar does not say so.
- **Deliberate:** ADR-375 item 10. **Frequency:** every material load on a machine whose door input is live at Idle. Which machines report Door at Idle was not checked on hardware.
- **Lighter form:** with no job and nothing pending, offer **Resume (cycle start)** beside ABORT MOTION.

### A3-P2-4 — Console: Enter does nothing while a command is blocked, and every G-code line blocks the next for up to a second

- The form ignores submit when a block reason exists (`laser/console/ConsoleCommandDeck.tsx:124-127`). The reason is only a hover tooltip.
- After any command that is not read-only the store clears `statusReport` (`state/laser-console-actions.ts:379-395`), and the idle poll runs once a second.
- Until that poll, Send is disabled with "Controller status is not known yet. Wait for an Idle status report before jogging or framing." (`console-command-availability.ts:62`), which talks about jogging for a console line. The jog pad greys out too.
- **Frequency:** every pair of console commands typed quickly, and macros run back to back.
- **Lighter form:** show the reason inline on Enter; ask for a status report straight after the command's `ok`.

### A3-D-1 — Every Abort ends locked in Alarm 3 and needs a recovery action

- Abort sends the soft reset at once (`state/laser-job-stop.ts:119-129`), so GRBL-family controllers answer ALARM:3. The rail then shows "You stopped the job" with four recovery buttons (`laser/AbortStoppedCard.tsx:118-164`). Plain Unlock leads into A3-P2-1.
- **Deliberate:** ADR-341 Amendment 11 (the card). ADR-215 Amendment 1 deferred hold-then-reset; ADR-398 Amendment 8 rejected hold-first for the crash stop because the beam stays on while slowing.
- **Option for the maintainer, keeping the immediate beam-off:** on a machine without homing, run the card's primary action by itself (Unlock plus restoring the origin; the head does not move) and show "Stopped. Origin restored; Frame to check". Also say on the Pause tooltip that Pause first stops without losing position.

### A3 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| A3-P3-1 | `$RST=`, `$N…=` and `$I=` are refused with "This persistent controller command is blocked in the Console. Back up settings and use Machine Settings in a later lane." "Later lane" is plan wording; Machine Settings is read and export only, so `$RST=$` cannot be sent from KerfDesk at all | `core/controllers/grbl/console-command.ts:42-43,286-293`, `laser/MachineSettingsPanel.tsx:126-137` | Say it is not supported, or allow it behind a typed confirmation with a backup offer |
| A3-P3-2 | A lid opened mid-job needs Pause then Resume; a plain controller hold names no software route | `laser/LiveMotionBar.tsx:375,379-380` | One Resume button that does the same sequence |
| A3-P3-3 | **Reset origin** is disabled after Home or a reset and points to "Clear persistent origin", which sits in Advanced origin behind a native confirm | `state/laser-home-action.ts:225-235`, `laser/OriginRow.tsx:129,263,407-411` | Let Reset origin clear the temporary offset and offer the stored one only if an offset remains |
| A3-P3-4 | Controls disabled with no reason: Home, the jog arrows, Set origin here, Disconnect during a jog or Frame, Review recovery when busy. Tooltips keep their normal text | `laser/JobSetupControls.tsx:91-99`, `JogArrowGrid.tsx:96-99`, `OriginRow.tsx:82-87`, `ConnectionBar.tsx:214-224` | Pass the store's block message as the tooltip, as the Console quick buttons do |
| A3-P3-5 | Internal wording reaches toasts: "Manual motion could not obtain a fresh same-session controller status…", "Home finished without fresh session-bound Idle settlement evidence.", "Controller recovery was superseded by another session or operation.", "Wait for GRBL to report Idle" on Marlin, "isolated recovery capsule" | `state/manual-motion-fresh-idle.ts:42-43`, `laser-home-action.ts:115,274,375`, `laser-store-helpers.ts:40-41`, `CheckpointResumeBanner.tsx:226-236` | Plain words plus one next step |
| A3-P3-6 | Jog is refused while Fire or the laser dot is on. Deliberate, ADR-664, so a slow jog cannot draw a line. Keep; listed for completeness | `state/laser-store-helpers.ts:42-43` | None proposed |

A recovery attempt that failed blocks Review for five minutes (`state/recovery/recovery-model.ts:55`). The stacked confirms in recovery are A1-P2-3, the Console write confirm is A1-P3-5, and the release-motors confirm is A1-P3-2.

### A3 checked and sound

- Feed, power and rapid overrides during a job are one click.
- "Not responding" and reconnect notices are already quiet (ADR-611, ADR-639).
- An errored stream releases itself at Idle. A cancelled jog or Frame is released at Idle even when a reply is lost (ADR-640, ADR-696).
- Home can hold the controls for up to 120 s (30 min on stock GRBL whose settings were not read), but ABORT MOTION stays available throughout.

---

## A4 — Workspace and file-flow blocks

### A4-P2-1 — Autosave is switched off for the whole length of a job

- `src/ui/state/autosave-loop.ts:96`: `if (snap.isStreaming) return;`. `src/ui/app/use-autosave.ts:96-97` sets it for `streaming` and `paused`.
- Design work done while a job runs has no recovery copy. A crash or power cut during a two-hour engrave loses everything drawn in that time.
- The only disclosure is one sentence in Settings > General ("…every 30 seconds, except while a job is running…").
- **Spec conflict:** WORKFLOW F-C3 says "Every 30 s, and when the window closes" with no exception. No ADR was found.
- The stated reason (`use-autosave.ts:142-146`: the interval must not "perturb the render loop") predates the autosave worker (`autosave-preparation-client.ts:28-30`).
- **Frequency:** every job for anyone who designs the next piece while one burns.
- **Lighter form:** keep autosaving through the worker; if a guard is still wanted, lengthen the interval during a job.

### A4-P2-2 — After touching any panel control, Delete, Ctrl+Z, copy/paste, arrows and Esc stop working

- `src/ui/common/keyboard-targets.ts:99-101` treats every `INPUT` (checkbox, slider and colour included) and every `SELECT` as a text field. `src/ui/app/shortcuts.ts:343` (and the tool and nudge handlers) return early on that.
- Number fields commit on Enter without releasing focus (`kit/DraftNumberInput.tsx:60-66`).
- So: tick Output, drag a power slider or pick from a dropdown, then press Ctrl+Z or Delete, and nothing happens, with no message. The user must click the canvas first, which can change the selection.
- **Deliberate for text typing only** (comment at `shortcuts.ts:336-342`).
- **Frequency:** every session.
- **Lighter form:** count only text-like inputs as editable; blur number fields on Enter.

### A4-P2-3 — Locked artwork can only be freed with "Unlock All"

- Locked ids are dropped from every selection (`state/store-actions.ts:396-406`). The only lock commands are `lockSelection` and `unlockAllObjects` (`state/scene-lock-actions.ts:6-9`).
- The artwork tree's row for a locked item is disabled, with the unchanged title "Select {name} directly for editing." (`layers/DesignRowButtons.tsx:31-36,73`).
- To edit one of several locked items the user unlocks everything, then locks the rest again.
- **Frequency:** every session for users who lock templates or jigs. No ADR found.
- **Lighter form:** an Unlock button on the locked row and a right-click Unlock on the canvas.

### A4-P2-4 — Save G-code is always a modal plus a second click

- Ctrl+Shift+E opens "Preparing your G-code file…" with no progress. When ready, the user must click **Save as…** before the file picker opens, even if preparation took 50 ms (`app/GcodeSaveDialog.tsx:29-31,53-57,72-78`).
- On failure a native alert appears, and behind it the dialog stays open with only Cancel (`prepare-gcode-save.ts:39,69-72`). An empty canvas goes through all of that to say "No output layers."
- Project Save As does the same for any project with 250 or more objects, about 5,000 path points, a 375 KB image or embedded fonts (`app/ProjectSaveDialog.tsx:17-30`, `project-save-size.ts:3,20-32`).
- **Deliberate in part:** ADR-656 (bytes before the picker). Its decision 2 says to open the picker at once while the click is still live; `pick-prepared-save-target.ts:31` does, but these two dialogs never take that path.
- **Frequency:** every export; every first save of a real project.
- **Lighter form:** open the picker straight away when preparation finishes in time; show the dialog only when it is slow.

### A4-P2-5 — In Preview the canvas silently becomes pan-only, but keyboard edits still change the design

- `workspace/use-workspace-drag.ts:197,214` (`panOnly: args.previewMode`). The tool strip never checks Preview (`workspace/ToolStrip.tsx` has no `previewMode`).
- Clicking or dragging an object pans the view with no hint. Delete, cut, paste, arrows and flips still act on the selection kept from before Preview (`shortcuts.ts:286-297,437-444`).
- **Frequency:** every session for anyone who leaves Preview on.
- **Lighter form:** one line in the Preview dock on the first ignored click, grey the tool strip, and gate Delete and nudge in Preview.

### A4-P2-6 — Ctrl+S does nothing inside Design Studio, Image Studio or any dialog

- `app/use-shortcuts.ts:45,53` returns before `preventDefault` whenever a modal owns the keyboard. Both Studios register as modals.
- On desktop the key is ignored in silence. In a browser it falls through to "Save page as".
- Nothing is lost: the Studio session is kept on close (ADR-590 Amendment 1). The user only believes they saved.
- **Deliberate:** ADR-242 and ADR-272. **Frequency:** every Studio session.
- **Lighter form:** let Ctrl+S through, or swallow it with a toast ("Apply the drawing, then save").

### A4-P2-7 — "More cut settings" greys out with no reason during a job, jog, Frame or autofocus

- `layers/use-cut-settings-launcher.ts:14-19`. The tooltip still reads "Open Cut Settings: …". Speed and power beside it stay editable.
- If the dialog is open when motion starts, it is closed and the draft dropped without a word (`:17-19`).
- **Frequency:** every job for users who prepare the next operation meanwhile. No ADR found.
- **Lighter form:** allow it during a job, or say "Available when the machine is idle" and never close an open draft.

### A4 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| A4-P3-1 | Esc pressed to deselect during a slow import cancels the import. Progress toasts use internal words ("reading in worker") | `app/import-worker-controls.ts:26-29,47-54` | Cancel button on the progress toast; drop the global Esc |
| A4-P3-2 | One Open on unsaved work can stack four dialogs (Save changes?, Save project, OS save picker, OS open picker) | `commands/open-project-command.ts:31`, `app/confirm-discard.ts:35-44` | Fixing A4-P2-4 removes one |
| A4-P3-3 | Opening a project with a different machine setup is refused during a job; a different bed size alone triggers it. Deliberate, ADR-416 Amendment 2; the message is good | `state/job-machine-lock.ts:34-56` | Offer "Open with the current machine setup" |
| A4-P3-4 | Number fields clamp silently on leaving (9999 becomes 6000). Deliberate, M25 | `layers/use-debounced-commit.ts:79-90` | Flash the field or say "Limited to 6000" once |
| A4-P3-5 | The rotary test pattern and camera target ask to replace artwork with a native OK/Cancel; other generators use Save / Don't Save / Cancel | `laser/RotarySetupHost.tsx:29-34`, `CalibrationSetupStep.tsx:193` | Route both through `confirmDiscard` |

### A4 checked and sound

- Import size limits are advisories only (ADR-228).
- Disabled commands carry a reason in menus, the toolbar and Ctrl+K (`commands/command-types.ts:375-393`).
- Design Studio and Image Studio close on Esc without a prompt and keep the session.
- The Live Motion bar, with Abort, sits above every overlay (`laser/LiveMotionBar.tsx:426`).
- Vector operations run in a worker and can be superseded.

---

## A5 — Nags and notice noise

### Toast facts

- About 586 `pushToast(` lines under `src/ui`. By folder: app 200, state 89, laser 83, commands 68.
- About 10 call sites reuse a slot with a `key`. Identical unkeyed messages stack.
- Lifetime depends on the variant only: success 4 s, everything else 8 s (`state/toast-store.ts:19-24`). Length does not count, and there is no pause on hover.
- Only the newest three render (`common/Toasts.tsx:22-25`). Older ones expire unseen. There is no history.

### A5-P2-1 — An autosave failure is said once per session, in an 8 s toast, with no lasting sign

- `app/use-autosave.ts:77-88` ("Warns once per session for each cause"): "Autosave could not preserve the newest project. Save the .lf2 file manually…".
- A user who looked away works the rest of the session unprotected and is never told again. No status-bar sign exists.
- Same pattern: "Your machine settings could not be saved for next session." (`use-machine-profile-persistence.ts:32-35`).
- **Lighter form:** keep the toast and add a status-bar chip that stays while the last write failed.

### A5-P2-2 — Jog warnings raise a new long toast on every jog click

- `state/laser-jog-warnings.ts:183-186` pushes an unkeyed warning per jog request and per queued step.
- The bounds text embeds the target coordinates (`:143-147`), so it can never collapse. The unresolved-position text is 249 characters (`:153-156`).
- A never-homed diode laser is compared with machine zero where it powered up, so jogging toward the origin warns on every click. Ten clicks make ten toasts.
- **Deliberate:** warn-only, ADR-232. The log already receives the text.
- **Lighter form:** one keyed slot that rewrites in place.

### A5-P2-3 — Closing with "Don't Save" still brings "Restore it?" on the next launch

- The close dialog offers Save / Don't Save / Cancel (`electron/desktop-window-close.ts:74-86`). The unload handler then writes an autosave whenever the project is dirty (`app/use-autosave.ts:140-152`).
- `clearAutosaveForDiscard` is called only from in-app New and Open (`app/confirm-discard.ts:40`). So "Don't Save" inside the app clears the copy, and "Don't Save" at close does not.
- **Deliberate:** ADR-688 decision 3.
- **Lighter form:** after an explicit Don't Save at close, keep the copy under File > Recover unsaved work but do not show the card.

### A5-P2-4 — A correctly set-up machine gets the same advisories on every job

- **Traced artwork:** one warning per traced object per operation, on every job and again as a toast on every Save G-code: "Trace "X" is vector Line output, not raster image engraving. It will run as M4 dynamic-power vector moves…" (`laser/job-intent-warnings.ts:84-93`, `app/save-gcode-notices.ts:65`). Five traced logos give five warnings each time.
- **Saving without a connection:** "Exported G-code assumes GRBL $30=… and laser mode ($32=1) — not verified…" on every save, for users who carry files on SD or USB (`save-gcode-notices.ts:67,81-84`).
- **Browser jobs:** a 330-character keep-awake warning in every Job Review (`job-review/browser-keep-awake-warning.ts:12-20`).
- **Deliberate:** ADR-687, ADR-224, ADR-117 Amendment 1. All advisory.
- **Lighter form:** one line for all traced images; rank the trace and `$30` notes as technical so they fold; fold a note the user has seen several times on the same machine, as "Before you start" already does.

### A5-P2-5 — Step-by-step instructions are shown as toasts that vanish

- A 390-character success toast (4 s) ends "Zero X/Y at the area's front-left corner and Z on the surface before running…" (`machine/save-surfacing-program.ts:112-115`).
- A 231-character one tells the user how to finish camera calibration (`camera/calibrate/CalibrationSetupStep.tsx:197,237-238`).
- **Lighter form:** scale lifetime with length, pause on hover, and put instructions in the panel that owns the next step.

### A5-P2-6 — Bursts lose messages

- An SVG import can push seven or more toasts in order (`app/import-toasts.ts:18-61`); opening a project up to nine (`state/project-load-notices.ts:17-50`). Only three render, and the first are never seen.
- ADR-687 fixed this for Save G-code only.
- **Lighter form:** one keyed summary per action with details folded, and a small notice history in the status bar.

### A5-P2-7 — Nothing lets a user quieten any of this

- Settings holds theme, units, layout, Simple view, recent projects, snapping, markers, nudge and Labs. No notification setting exists.
- The only remembered quietening is the per-machine "Before you start" fold and the per-snapshot Start fresh.
- **Suggested minimum:** a Settings > Notifications group ("Show confirmations", "Show setup cards and tips"), a notice history, and "seen" folding for repeat advisories.

### A5-D-1 — Every launch and reload holds a splash for about 4.75 s and blocks all input

- `app/startup-splash.ts:1-3,31-44,94`: 4,000 ms minimum plus a 750 ms fade, with the app `inert` and every keydown swallowed, even when the workspace has already painted.
- **Deliberate:** ADR-049 Amendment 2, on the maintainer's word that the splash was too fast.
- **Option for the maintainer:** hold the full time only on the first launch after an install or update; otherwise release when the workspace paints, or let a click skip it.

### A5 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| A5-P3-1 | Firefox and Safari users get a 60-word full-width banner on every launch; the dismissal is not remembered. ADR-688 decision 4 | `app/BrowserFilesNotice.tsx:24,53` | Remember the dismissal |
| A5-P3-2 | The starter-machine card returns on every launch until Machine Setup is saved, so design-only users see it for good. ADR-500 | `app/MachineSetupBanner.tsx:39,79` | After a few "Not now" clicks, shrink to a status chip |
| A5-P3-3 | The update card returns on every launch with no "skip this version". Four releases shipped in 12 days. ADR-561 Amendments 5 and 7 | `licensing/UpdatePrompt.tsx:39,49-52,219-227` | Remember "Not now" per version for a week; the toolbar button carries it meanwhile |
| A5-P3-4 | "Machine settings detected: controller settings were read successfully in Machine Setup." on every launch that connects. ADR-611 Amendment 2 | `laser/DetectedSettingsToast.tsx:110` | Log line only when nothing needs doing |
| A5-P3-5 | Confirmation toasts for things already visible: "Saved", "Opened <file>", "Frame complete — press Start…", "Added artwork: …" | `app/project-save-completion.ts:55`, `laser/frame-dispatch-support.ts:27-28`, `commands/CommandShell.tsx:309,326` | Drop those whose result is on screen, or one "Show confirmations" setting |
| A5-P3-6 | Licence friction is light (one dialog, one click back, no work lost, no timed reminders). Three wording points: every failure reads "This request could not be completed. Please try again."; the browser dialog reads as if Pro may not exist; the trial ends with no notice until the next Pro click | `licensing/ProFeatureDialog.tsx:43,185-186`, `ProInDesktopDialog.tsx:33-35` | Specific error text; one notice in the last three days of a trial |
| A5-P3-7 | A caution-coloured "Relative view — physical bed position unverified" stays in the status bar for no-homing machines, where it is the normal state | `workspace/canvas-motion-badge.tsx:35-36,214,224-227` | Neutral colour unless the start is Absolute |

### Launch sequence

| Who | What appears, in order | Clicks to a clean workspace |
|---|---|---|
| Web, first visit (Chrome, Edge) | Splash; "Choose your workspace." modal; starter-machine card; one "Ready to work offline." toast | 2 |
| Web, returning | Splash; starter-machine card if no machine is saved; recovery card after an unsaved session | 0 to 2 |
| Firefox or Safari | As above plus the browser-files banner, every launch | 1 more |
| Desktop, first launch | "Opening KerfDesk…"; splash; starter-machine card; update card if one exists | 1 to 2 |
| Desktop, returning | Splash; auto-connect and its "settings detected" toast; update card on most launches; recovery card after Don't Save or a crash | 0 to 2 |

### A5 checked and sound

- No sounds and no system notifications anywhere.
- Tutorials and the guided first job open only when asked.
- The PWA update is a passive button. Auto-connect fails silently. The licence poll shows nothing.
- No panel or view switches by itself.
