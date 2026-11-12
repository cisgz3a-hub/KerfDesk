# User annoyance audit A2 (round two) — report

Ledger and totals: [LEDGER.md](LEDGER.md). Round one: [../2026-11-11-annoyance-a1/LEDGER.md](../2026-11-11-annoyance-a1/LEDGER.md). Tree: `origin/main` @ `95489484e`.

## Method and limits

- **Static read only.** Nothing was run in a browser, in Electron, on a phone or against a controller simulator, and no live service was called. Every finding cites code that was read. Findings that depend on runtime, browser or operating-system behaviour say "runtime check owed".
- **Six areas**, the ones round one skipped. One read-only agent per area.
- **Coordinator check.** Every P2 below was re-read in `main`'s code by the coordinator before it was ledgered. P3s are the area agent's reading unless marked.
- **No refuter pass.** Ratings are provisional until a fix session reproduces each finding.
- **Deliberate design is listed, not overruled.** No finding asks to remove a licence gate or a safety confirmation.

Finding IDs are `B<area>-P<severity>-<n>`. `D` marks a decision for the maintainer.

## Severity

| Level | Meaning in this audit |
|---|---|
| P1 | Stops a user's work, or loses it. |
| P2 | Interrupts or blocks often. A workaround exists. |
| P3 | Polish: wording, a rare interruption, or an inconsistency. |

---

## B1 — Browser prompts, installing and updating

No browser or operating-system behaviour was observed. Statements about what a browser, Windows or macOS does are from memory unless a repository file states them. The installer's own page templates were not read.

**Correction to round one.** Its "checked and sound" list for A5 says there are no system notifications anywhere. The desktop app does raise an operating-system notification for an update (`electron/desktop-licensing.ts:72-78,263-278`); see B1-P3-1.

### B1-P1-1 — Web: one click on Update during a job reloads the page and stops the burn

- `src/ui/common/PwaUpdateButton.tsx:28-37`: the status-bar button's title is "A new version of KerfDesk is ready — click to reload and apply it." and its click runs the staged update with no job check. The apply path reloads the page (`src/ui/app/PwaUpdateWatcher.tsx:80-93`). Neither file reads the job state.
- No question is asked: the unsaved-changes prompt is off during a job (`use-unsaved-changes-guard.ts:28-33`, `dirty && !jobActive`), and unload sends a best-effort stop (`use-unload-stop.ts:28-32`).
- The button is present most days, because a deploy lands on nearly every merge (ADR-227). The click during a job is rare, but one click costs the job.
- The only warning is on the website: "The button stays available during a job, so update while your machine is idle."
- **Deliberate, and recorded as open:** ADR-227 and ADR-228 keep it a passive command. ADR-561 Amendment 7 decision 7 says "that reload has no job guard… Moving it there needs that guard first, as a separate decision".
- **Rated P1** because a single click with no question stops a running job. The desktop button already does the right thing: "Update after job" (`toolbar-update-state.ts`).
- **Lighter form:** copy the desktop button. While machine work is active, show "Update after job" and do nothing. That gates the update, not Start, so the frame-first rule is untouched.

### B1-P2-1 — Recovered work comes back nameless and cut off from its file

- "Autosaves carry no file name" (`src/ui/app/autosave-recovery-summary.ts:3`). `restoreAutosaveSnapshot` (`use-autosave.ts:236-249`) restores the project and marks it changed; it sets no saved name and no save target.
- So after a restore, Ctrl+S opens the picker suggesting `untitled.lf2`. The user must find the original and confirm the overwrite, or ends up with a second copy.
- **Frequency:** every recovery: a crash, a reload, a web Update with unsaved edits, File > Recover unsaved work. ADR-688 does not discuss the file link.
- **Lighter form:** keep the file name and the recent-project entry in the autosave; show the name on the card, and re-attach the file on the first Save.

### B1-P2-2 — Windows: every update is the whole installer again, and an unused download is thrown away

- `electron/manual-update-quit.ts:46-48` relaunches the installer with no arguments: "No shell or NSIS update/silent/force-run arguments can bypass the interactive flow". The installer is `oneClick: false` with a changeable directory and a licence page (`electron-builder.yml:82-88`).
- Per update: Update, Install now, Save or Don't Save if needed, then the installer's licence, location and finish pages. About five to seven clicks, and the licence is accepted again each time. (The installer's page order is from memory.)
- `electron/manual-update-download.ts:36-54` deletes every cached installer at each start ("Forgotten downloads are never executable authority on the next launch"). A user who downloads, clicks Not now and closes must download again.
- **Deliberate:** ADR-561 decisions 3 and 4 and Amendment 3. **Frequency:** each release; round one counted four in 12 days.
- **Lighter form, still explicit and never silent:** pass the installer's "updated" flag so it skips the licence and location pages but still shows; keep a verified download across restarts, since its hash and signature are re-checked before install anyway.

### B1-P2-3 — Web: Save over an opened project asks for permission late, and may fail for big projects

- Write permission is requested inside the write step, after the project has been prepared (`src/platform/web/web-adapter.ts:231-252`).
- A browser shows that prompt only shortly after a click (about five seconds, from memory). The code handles this limit for file pickers (`pick-prepared-save-target.ts`) but not here. A photo-heavy project could then fail on every Ctrl+S with "KerfDesk may not change X. Use Save As to save a copy.", a refusal the user never gave.
- Opening a recent project asks to read; the first Save asks again to edit. That is two prompts per project per browser session. Deliberate, ADR-378 and ADR-550.
- **Runtime check owed** (not reproduced; ADR-550 itself says "not yet tried… in a browser with a real file").
- **Lighter form:** ask for edit permission at the Open Recent click for a project file (one prompt), and in Save ask first, before preparing.

### B1-P2-4 — Mac: about ten steps per update, and two different sets of instructions on one page

- The download page's steps: drag and Replace, open, Done, System Settings > Privacy & Security > Open Anyway with a password ("You do this once for each new version you download."), then the keychain prompt (`public/download.html:1230-1251`).
- The Preview section of the same page and `website/pages/download.mjs` still say "Control-click KerfDesk.app… choose Open", which no longer works on recent macOS (from memory).
- **Frequency:** each release, for Mac users. The unsigned build is the maintainer's known position; the finding is the conflicting instructions and the step count.
- **Lighter form:** one set of Mac steps; announce updates less often on the download-page route, or allow "skip this version".

### B1 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B1-P3-1 | One desktop update is announced three ways: an OS notification, the canvas card and a pulsing toolbar ring. The notification is not held back during a job, has no click action, and still says "Open Help > Check for Updates to download it." The ring never stops until the update is installed | `electron/desktop-licensing.ts:263-278`, `manual-update.ts:153-160` | No notification during machine work; correct the text; hold the ring still after "Not now" |
| B1-P3-2 | Every file picker shares one remembered folder, so artwork, projects and G-code each start wherever the last picker was | `src/platform/web/web-adapter.ts:71-74,97-100,129` | Give each kind its own picker id |
| B1-P3-3 | Windows and Linux: "Open with > KerfDesk", or dropping an SVG, image or G-code file on the icon, does nothing and says nothing | `electron/desktop-project-paths.ts:44`, `desktop-project-open.ts:74-86` | Hand it to import, or say how to import it |
| B1-P3-4 | Web: Help > Check for Updates does not check; it only shows a toast | `src/ui/licensing/CommercialUpdates.tsx:70-78` | Ask the service worker to check, and report the result |
| B1-P3-5 | The port chooser returns at every start on some setups: USB adapters with no serial number on macOS and Linux, and desktop USB lasers ("Nothing is remembered across restarts"). The desktop chooser is a native box with one button per port. ADR-366, 552, 607, 702 | `serial-port-grants.ts:13-17`, `electron/desktop-usb-devices.ts:1-5`, `desktop-serial-chooser.ts:66-76` | When one attached port matches the last one, connect without the box |
| B1-P3-6 | Firefox: the keep-my-storage prompt is fired from the 30 s autosave timer, not from a click. ADR-688 Amendment 2 | `src/ui/app/use-autosave.ts:114-126` | Ask from a button in the browser-files banner |
| B1-P3-7 | Uninstall is silent about data: settings, licence, recents and autosaves stay in `%APPDATA%\laserforge`, and no page says so or how to remove them. (The upside: reinstalling keeps everything.) | `electron/desktop-identity.ts:10,22-24`, `electron-builder.yml` | One line on the download page |

### B1 checked and sound

- Web Serial: the chooser shows only on a click, a granted port reopens without it, and auto-connect never prompts.
- The camera prompt fires only from Start, and a refusal has clear text and a retry.
- The PWA installs from an explicit button, never reloads by itself, and leaves other tabs alone.
- Recent Projects keeps its file handles; a missing or refused file has a message and "Choose file…".
- The Windows installer is per-user with no administrator prompt and never kills a running KerfDesk.
- On desktop nothing closes or restarts by itself, and the update waits for a job ("Update after job").
- A second launch raises the existing window; window size and position are remembered.
- The download page states the unsigned status and the exact warning steps before the download.

---

## B2 — Licences, trials, activation and check-ins

### Two corrections first

- **Paid licences do not check in.** ADR-623 Amendment 2 removed it (`electron/licensing-clock.ts:52-59`: "a paid licence activated here keeps working offline indefinitely"). Only a trial checks in, every 3 days. `AGENTS.md:34` still says "paid 30 days, trial 3 days"; that line is the maintainer's to correct.
- **Failures are mostly specific.** Round one (A5-P3-6) said every failure reads "This request could not be completed. Please try again." That text shows only when the app's own call throws. The service's refusals have about 30 specific messages (`electron/licensing-messages.ts:33-110`). The real problem is B2-P2-1: they do not stay on screen.

### B2-P2-1 — Licence messages vanish within 30 seconds, or as soon as the user switches windows

- Every action's result is shown from `status.message` (`src/ui/licensing/LicencePanel.tsx:50`, `ProFeatureDialog.tsx:52`). The provider re-reads the status every 30 s, on window focus and on visibility change (`EditionProvider.tsx:288-309`) and replaces the whole status (`:324-340`). A plain read carries no action message (`electron/licensing-runtime.ts:145-150`).
- Messages lost this way include "This licence is already active on three devices…", "This licence key was not accepted. Check the key and try again.", the clock-error text, and "The KerfDesk purchase page opened in your browser. After paying, copy the licence key it shows and enter it here under Licence key."
- The purchase case is certain: opening the browser takes focus away, so the instruction is gone when the user returns.
- **Runtime check owed.** **Frequency:** every failed activation and every purchase.
- **Lighter form:** keep the last action's message until the next action or Close; a background read updates the rights, not the message.

### B2-P2-2 — "Deactivate this device" is one click, forgets the saved key, and cannot be undone offline

- `LicenceControls.tsx:98-105` runs `client.deactivate` directly, beside **Refresh licence**. The same panel asks twice for "Forget this order" and for removing another device.
- `electron/licensing-signout.ts:40-57` writes the signed-out record and locks Pro before the network call; that record drops the saved key.
- Offline, the seat is still held on the service, and neither offered button keeps the device activated. Each release also counts against six per 30 days.
- **Deliberate in part:** locking at once is (ADR-540, ADR-523 Amendment 2). The missing confirmation is not.
- **Frequency:** rare, but it costs a paying user Pro until they have internet and their key (see B2-P2-7).
- **Lighter form:** a second step that says Pro stops now and that the key is needed again, with **Copy key**.

### B2-P2-3 — A paying user whose seat is removed elsewhere silently becomes "Free · Try Pro" and is offered a trial

- The background refresh receives the removal and drops the credential (`electron/licensing-runtime.ts:261-277`). Its message ("This computer was removed from its licence from another device…") is discarded: `electron/desktop-licensing.ts:170-183` ignores the result and only signals a re-read.
- The chip changes from "Pro" to "Free · Try Pro". The next Pro click offers "Start free 30-day trial" as the main button (`ProFeatureDialog.tsx:127-135,190`). Help > Licence gives no reason either.
- **Deliberate in part:** the revocation is (ADR-592, ADR-623 Amendment 2). The silence is not.
- **Frequency:** after any remote removal, which B2-P2-6 makes easy to do by mistake.
- **Lighter form:** save the reason and show it until the next grant; do not lead with the trial while a saved key exists; add "Activate with saved key".

### B2-P2-4 — A trial needs the internet every three days; nothing says so beforehand, and the failure text contradicts itself

- `CHECK_IN_LIMIT = { trial: 3 * DAY }` (`electron/licensing-clock.ts:57-59`). The pause applies at the next status read, mid-session; the workspace stays mounted and nothing is lost.
- The trial offer says only "Starting the trial needs an internet connection." The rule is in the privacy notice, not in the app.
- `checkInDueAt` is computed and sent to the renderer, but no screen reads it (a search of `src/ui` finds no use). The first sign is the chip "Pro trial · check-in needed".
- **Refresh licence** offline answers "Unable to reach the licence service. Your saved licence keeps working offline." (`electron/licensing-messages.ts:170-172`) in the same dialog that says "This device needs to reach the licence service before Pro tools open again."
- **Deliberate:** ADR-592 decision 2, kept by ADR-623 Amendment 2.
- **Frequency:** every trial user in a workshop without internet, from day 4.
- **Lighter form:** keep the rule; say it at the start, show "Next check-in by <date>", and give a due check-in its own failure text.

### B2-P2-5 — After Pro ends, fixing a typo in V-carved text answers "V-carve is a Pro tool" with no reason, and the edit is dropped

- `src/ui/licensing/pro-operation-mutation.ts:19-33` refuses the change and opens the standard Pro dialog with nothing to run afterwards.
- The dialog does not say that this artwork is bound to a Pro operation, or that its settings, moving, scaling and deleting still work.
- Duplicate, paste and array of the same artwork ask the same way but keep the edit and apply it after unlock.
- **Deliberate:** ADR-592 and its Amendment 2. **Frequency:** every ended-trial user who reopens a Pro project.
- **Lighter form (wording only):** "This text is carved by a V-carve operation, which needs Pro to change. You can still change its settings, move, scale or delete it, and Frame and Start work."

### B2-P2-6 — Manage devices lists every computer as "Windows computer" and does not mark this one

- The label is fixed by platform (`electron/desktop-licensing.ts:37-41`), a privacy choice. Rows show only that label and "Activated <date>" (`LicenceDevicesPanel.tsx:203-209`).
- The panel warns that removing this computer here is the wrong way to do it, but gives no way to tell which row it is.
- **Frequency:** every user at the three-seat limit; a wrong pick leads to B2-P2-3.
- **Lighter form:** mark "This computer"; the app already holds its own activation ID, so nothing new is sent.

### B2-P2-7 — The app tells users to find the key in "your email", but the checked-in service configuration sends no key email

- "Copy the key from the purchase page or your email first" (`LicenceKeyForm.tsx:15-16`); the same phrase in `electron/licensing-messages.ts:126-127`.
- `services/desktop-licensing/wrangler.jsonc:27-30` sets `LICENCE_EMAIL_ENABLED` to `"false"`, with a comment that it waits on email onboarding.
- So the key exists only in Help > Licence on an activated computer, in the buying browser's site data, and wherever the buyer saved it. A dead PC, or a deactivation (B2-P2-2), then needs support.
- **The live setting was not checked.** **Deliberate:** ADR-579 decided the email; it is not switched on in the repository.
- **Lighter form:** switch the email on when onboarding is done; until then drop "or your email" and add **Save key to a file**.

### B2 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B2-P3-1 | "Start free 30-day trial" stays the main button where it can never start (after a Windows reinstall, a reset, or an expired trial) | `ProFeatureDialog.tsx:160-167`; `services/desktop-licensing` `authority.mjs:134,202-209` | Remember the refusal and lead with Buy Pro and the key |
| B2-P3-2 | Reinstalling Windows mid-trial forfeits the remaining days. Deliberate, ADR-592 | `electron/licensing-device.ts:80-107`, `authority.mjs:126-134` | Resume the bound trial with its original end date |
| B2-P3-3 | Some failures name the wrong cause: a short or foreign key gets "try again later"; three different faults share one "unavailable" message; removing another computer at the limit says "so this computer stays active" | `licensing-messages.ts:69-72,126-127,174-176`, `licensing-runtime.ts:178` | Map each cause to its own text |
| B2-P3-4 | The device-limit message sends the user to another computer when **Manage devices** on the same screen fixes it | `licensing-messages.ts:9-10` | "…or choose Manage devices below" |
| B2-P3-5 | The Pro prompt has no button into Help > Licence, says some text twice, hides the key field after Buy Pro, shows no progress for up to about 20 s, and can sit on "Checking your licence…" if the first read throws | `ProFeatureDialog.tsx:56-85,181-197`, `EditionProvider.tsx:195-201` | A link, one sentence, the field open, a progress line, a failure state |
| B2-P3-6 | After paying, the buyer must click **Check payment** by hand | `public/desktop-browser-purchase.mjs:147-156` | Poll for about a minute after checkout closes |
| B2-P3-7 | The browser's "Open this project in the desktop app" overpromises: desktop Free refuses the same file | `src/ui/app/ProProjectDesktopDialog.tsx:113-149` | "…in the desktop app with Pro or its 30-day trial" |
| B2-P3-8 | "…not saved on this computer" can be untrue from the user's seat (reinstalled Windows, reset password, older project). Accepted in ADR-592. **Unlock Pro** also closes the dialog without reopening the file | `ProProjectDesktopDialog.tsx:64-90`, `electron/project-seal-key.ts:46-49` | Reword; reopen the file after unlock |

### If the licence window is turned on

`DESKTOP_LICENCE_WINDOW` is held off (ADR-623 Amendment 3), so none of this applies today. Read from `DesktopLicenceGate.tsx`:

1. An offline trial computer would not open on day 4, even to jog or run a Free job.
2. A first launch would need the internet and a working service, with no way into Free.
3. Projects made in a trial could not be opened anywhere after it ends.
4. Recovery copies would be behind the gate.
5. No machine control behind the gate: an unreadable saved licence would block jog, unlock and the Console.
6. B2-P2-1, P2-2 and P2-3 would each become a locked app.
7. A manually installed version beyond the update year would not open, with no link to older installers.
8. The gate offers only Check for updates and Quit, and does not say what is wrong.

### B2 checked and sound

- Paid licences never check in and never read the clock. Launch never waits on the network.
- A licence change never unmounts the session, and an outage never removes rights.
- There are still no timed reminders.
- Opening a Pro project without Pro changes nothing in the file or the workspace.
- Key entry is forgiving, and clock errors are specific.
- Moving computers needs no support if the user has the key (three seats, six releases per 30 days).
- Reinstalling KerfDesk keeps the licence.
- What a check-in sends matches the privacy notice. One gap: the in-app trial offer does not link the notice.

---

## B3 — Machine, camera and rotary setup

The question here was not whether a beginner can finish setup (the U1 audit asked that) but how much is repeated or forced for a user who already knows their machine.

### B3-P2-1 — A Marlin or Smoothieware laser is told "Controller settings cannot be fully verified" on every job, with GRBL advice it cannot follow

- A Start counts as verified only when the controller reports settings (`src/ui/state/laser-mode-start-evidence.ts:91-105`). Marlin and Smoothieware report `settings: 'none'` (`src/core/controllers/marlin/driver.ts:46`, `smoothieware/driver.ts:43`), so they can never be verified.
- Every Job Review therefore shows the warning banner with: "Controller settings cannot be fully verified. KerfDesk could not confirm, or observed a mismatch in, the GRBL power scale ($30) or laser mode ($32=1) … Cancel and use the fix Job Review offers (Send $32=1 when laser mode is off) when possible…" (`src/ui/laser/laser-mode-start-acknowledgement.ts:10-13`). None of that applies to this firmware.
- The new Run again shortcut (ADR-237 Amendment 3) needs a verified laser, so these users never get it.
- **Deliberate in part:** the honesty rule (ADR-095 in the code, ADR-224). No ADR requires GRBL wording on other firmware. Whether FluidNC is affected depends on what its settings dump carries, which was not checked.
- **Frequency:** every job, for good. Nothing the user does clears it.
- **Lighter form (keep, but lighter):** firmware without `$` settings gets its own wording; let the user record once per machine "I checked the power scale"; after that show one neutral line and let Run again carry the review.

### B3-P2-2 — A homed grblHAL, FluidNC, Marlin or Smoothieware machine can never earn a "verified" bed position

- `src/ui/state/native-bed-frame.ts:100-119,139-149`: the bed mapping resolves only for the Falcon A1 Pro command set, or for stock GRBL 1.1 after a Home in this session. Every other firmware gets nothing, whatever the user does.
- Consequences on those machines:
  - Click-to-move on the canvas is refused: "The controller-to-bed mapping is unverified. Home with a supported coordinate mapping before moving to a canvas point." (`src/ui/workspace/position-laser-click.ts:63-72`). Nothing says what a supported mapping is.
  - Every Job Review carries "KerfDesk can't check where this job sits on your bed…".
  - The camera burn check is unavailable (`src/ui/camera/job-watch/burn-check-run.ts:60`).
  - The status line reads "Relative view — physical bed position unverified", and its hover says "This is normal until your machine is connected and homed.", which is untrue here.
- **Deliberate?** ADR-322 Amendment 3 covers the A1 Pro. No ADR was found that limits verification to stock GRBL.
- **Frequency:** every session and every job on those firmware families. Round one's A5-P3-7 raised the badge colour for machines without homing; this is the homed case and the dead-end refusal.
- **Lighter form:** a per-machine statement in Machine Setup ("Home is at this corner, coordinates run this way"), accepted after a confirmed Home. Until then the refusal names the real reason.

### B3-P2-3 — "Machine settings detected … updates are ready in Machine Setup" returns on every connect when the difference is intended

- `src/ui/laser/DetectedSettingsToast.tsx:79-80`: the once-per-run rule is skipped whenever any difference exists.
- Differences that never go away: a listed machine that keeps its listed bed against the controller's travel (ADR-637 Amendment 2); any CNC in CNC mode (`$32=0` and an RPM `$30` against a laser-shaped profile); a maximum feed the user lowered on purpose.
- Inside Machine Setup the CNC user then reads "This setup already matches what the controller reports." (`device-setup/DeviceSetupFoundMachine.tsx:155`), because Setup drops those fields. The toast and the card disagree.
- The laser user gets a primary **Use detected values** and no way to say "intended".
- **Deliberate:** ADR-611 Amendment 2 ("updates always announce"). It collides with ADR-637 Amendment 2 and ADR-416. Extends round one's A5-P3-4.
- **Frequency:** every connect and reconnect for those cases.
- **Lighter form:** compute "updates" with the filter Setup uses; remember an unchanged offer per profile; add **Keep my values**.

### B3-P2-4 — A calibrated camera puts every non-Absolute job under a camera warning, and hiding the picture is forgotten each session

- `overlayVisible: true` and `placementActive: false` are plain defaults that are not saved (`src/ui/state/camera-store.ts:154,162`). A calibrated camera starts by itself at launch (`src/ui/camera/helpers/install-camera-helpers.ts:86-110`), and its picture on the canvas switches camera placement on (`src/ui/camera/camera-placement-latch.ts:27-33`).
- Job Review then says, for User Origin, Current Position or Verified Origin: "Camera placement is on, but Start from is …. The camera picture shows positions on the bed, so this job burns where … puts it, not where the artwork sits on the camera picture. Choose Absolute Coordinates…" (`src/ui/laser/start-job-readiness-policy.ts:160-171`).
- **Exit camera placement** also hides the picture, and both come back at the next launch.
- **Deliberate:** ADR-663 Amendments 1 and 4; ADR-228 Amendment 1.
- **Frequency:** every job and every session for camera owners who place by origin, which is the normal mode on a machine without homing.
- **Lighter form:** remember the picture's visibility and Exit per machine; switch placement on when artwork is moved under the picture, not merely because the camera started.

### B3-P2-5 — The quick camera fix burns its ring at default power after a restart, and calls that "the calibration target's settings"

- `src/ui/camera/calibrate/camera-calibration-store.ts:142-158`: the store is in memory only, with defaults of 35 % and 3000 mm/min. `withRemembered` (`:262-267`) restores only the layout.
- The nudge step has no power or speed field and says "The ring burns at {power}% power and {speed} mm/min, the calibration target's settings." (`NudgeSteps.tsx:69-72`). After a restart those are the defaults, not what the user calibrated with.
- The only way to change them is to open the full wizard's Target step and its "Engrave settings" fold first.
- **Frequency:** each "Fix a small offset" after a restart. No ADR found; ADR-441 Amendment 4 remembers the layout only.
- **Lighter form:** remember the engrave settings per machine with the layout, and show power and speed as fields in the nudge step.

### B3-P2-6 — Every calibration helper takes over the canvas

- Material test, Interval test, Focus test, the rotary pattern and the camera's "Add target to canvas" all replace the scene (`src/ui/commands/CalibrationGridDialogs.tsx:21,44`, `src/ui/calibration/FocusTestDialog.tsx:62`, `src/ui/laser/RotarySetupHost.tsx:28-38`). The two grid dialogs do so with no question.
- A user part-way through a design who wants a scrap test has their artwork replaced, burns the test, then undoes back.
- The lighter path already exists: the camera target can run as a temporary job ("Your project and undo history are not touched.", `CalibrationSetupStep.tsx:78-82`).
- **Frequency:** each new material, lens or rotary. Round one's A4-P3-5 covered only the form of two of the confirms.
- **Lighter form:** run generated tests as the same temporary job, or add them beside the artwork.

### B3 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B3-P3-1 | "The camera may have moved": Dismiss lasts only until the app closes, though the button and ADR-663 Amendment 3 say "for the current calibration"; the check has no off switch | `camera/helpers/camera-moved-store.ts:43-58`, `panel/CameraMovedNotice.tsx:63` | Save the dismissal with the view reference; add a switch |
| B3-P3-2 | "Confirm bed coordinates" changes nothing but a box's colour, and expires on every reconnect, reset or alarm. Its value is written to the Start snapshot and read nowhere | `camera/OverlayControls.tsx:238-251`, `laser/start-machine-snapshot.ts:59` | Remove it, or make it feed a Job Review fact |
| B3-P3-3 | Changing one machine value means the whole wizard: Save exists only on step 3, and the "Before your first run" checklist shows every time. ADR-205, ADR-240 | `device-setup/DeviceSetupShell.tsx:204-212`, `DeviceSetupReviewStep.tsx:160-188` | Save on every step once the profile has been saved before |
| B3-P3-4 | Machine Setup asks what only the machine can answer (home corner, switch direction) but is modal, so Jog, Home and the Console are unreachable behind it | `device-setup/DeviceSetupWizard.tsx:107-112`, `DeviceSetupConfirmStep.tsx:70-73` | A Minimize that keeps the draft, as the camera wizard has |
| B3-P3-5 | Connect pressed inside Machine Setup re-fills a finished machine (feed, S range, acceleration); its one Undo also drops later edits. ADR-420 | `device-setup/use-controller-auto-fill.ts:53`, `device-setup-flow.ts:200-205` | On a configured profile, offer the explicit card |
| B3-P3-6 | No list of machines: only one "last machine" is kept, so a second machine means import, Review and Save at every swap. ADR-500 Amendment 2 | `state/last-machine-persistence.ts:18` | A saved-machines list with one-click switch |
| B3-P3-7 | Focus test forgets its seven values on each open, and its result is applied by hand ("Inspect the narrowest line and set focus manually.") | `calibration/FocusTestDialog.tsx:15,39-46,93` | Save the draft; ask which line was thinnest and offer the Z move |
| B3-P3-8 | Rotary: the same long raster disclosure on every job, and scale correction by trial with no field for the measured value. ADR-315, ADR-373 Amendment 1 | `job-review/rotary-raster-qualification-warnings.ts:5-21`, `laser/RotaryTestRotationPanel.tsx:131-140` | Rank it as technical once seen; add "It measured ___ mm" |

### Redone each session or reconnect

| Item | Whose doing |
|---|---|
| Home | The controller. KerfDesk also clears its Home record on every disconnect |
| Set origin | The controller on stock GRBL and FluidNC. grblHAL keeps it, and KerfDesk then warns it "was not set in this session" |
| Verified bed position | KerfDesk (B3-P2-2) |
| `$30`/`$32` check | Automatic on each connect, except B3-P2-1 |
| Camera placement, picture, "moved" dismissal, bed-coordinates confirm | KerfDesk (B3-P2-4, B3-P3-1, B3-P3-2) |
| Network camera login in a browser | KerfDesk, deliberate (ADR-692); the desktop app keeps it |

### B3 checked and sound

- Rotary on and off is one click beside Start, and its setup lives in the profile.
- Machine Setup has no forced order, and closing it asks only when the operator's own edits differ.
- Opening a file saved for the same machine keeps the current setup and camera.
- Camera calibration needs one burn and one photo, a bed-size change shifts the picture without a recalibration, and a failed step returns to the same step.

---

## B4 — CNC flows

Statements about what a real controller keeps or drops come from the code's own comments and ADR text and were not checked on a machine. The CNC audit of the same day ([../2026-11-11-cnc-v2/LEDGER.md](../2026-11-11-cnc-v2/LEDGER.md)) was read; nothing below repeats it.

A healthy single-bit job is lean: jog to the stock, Zero Z, Frame, Start, Start job. The cost is at bit changes, after any stop, and at the start of each project.

### B4-P1-1 — A multi-bit job cannot Continue past a bit change unless the next bit already is the project's Default bit

- At the hold the user reads: "Job paused for a tool change. Load {bit}, select it as the Active bit, and re-zero Z on the stock top (jog, then Zero Z), then Continue to resume." (`src/ui/laser/JobRunControls.tsx:23`).
- Continue stays off while the Work Z record's bit differs from the pending bit: "Work Z belongs to a different bit. Load {bit}, select it as the Active bit, then touch it to the stock top and Zero Z — or probe again — before continuing." (`src/ui/state/laser-store-helpers.ts:154-159`).
- Zero Z and the probe tag Work Z with the project's selected bit (`laser-origin-actions.ts:157-161`, `laser-probe-actions.ts:70`), which is `machine.toolId` (`src/core/scene/machine.ts:392-395`), not with the pending bit the hold already knows (`tool-change-hold-entry.ts:41`).
- The only control that writes `machine.toolId` is Machine Setup's **Default bit** (`device-setup/DeviceSetupCncJobStep.tsx:177-182`). The store's `updateCncMachine` has no caller in any component.
- That Save is refused for the whole of a job, the hold included: "Finish or stop the running job before saving Machine Setup. Nothing was saved; your changes stay in this draft." (`device-setup/use-machine-setup-save.ts:24-25,52-55`; ADR-416 Amendment 1).
- So a two-bit job dead-ends at its hold unless the user set Default bit to the second bit before Start. A job with three different bits dead-ends at the second hold whatever they do. The only exit is Abort (B4-P2-1).
- The messages say "Active bit"; the control is labelled "Default bit".
- **Runtime check owed.** No end-to-end test changes bits through the interface, and the store tests set the record directly (`laser-store-tool-change-continue.test.ts`). A fix session must reproduce this first.
- **Rated P1** because, as read, it stops a multi-bit job with no way forward. **ADR:** ADR-416 Amendments 1 and 3, ADR-171.
- **Lighter form, same safety:** at the hold, bind the next Zero Z or probe to the pending bit, with one "Loaded: {bit}" line the operator confirms by pressing Zero Z. Keep "which bit is in the spindle" as session state, separate from the project's Default bit.

### B4-P2-1 — Every CNC Abort resets mid-motion, so one stop costs the alarm card, the XY origin, Work Z and the Frame

- Abort sends the soft reset at once (`src/ui/state/laser-job-stop.ts:119-131`). Any reset voids Work Z. The card says "The reset cleared work Z too: zero Z again." A CNC job is excluded from the new automatic origin restore (`abort-auto-restore-eligibility.ts:77-80`).
- The **Zero Z** button sends `G92 Z0` (`src/core/controllers/grbl/commands.ts:95`), the volatile form that stock GRBL and FluidNC drop at a reset, while the probe stores its offset with `G10 L20`. So Abort destroys the zero that the app's own button set. (Controller behaviour from the code's comments.)
- After a simple stop the user redoes: Home or Unlock, restore the origin, touch off Z again (the stock top at the origin may already be cut away), Frame, and Job Review with its checklist.
- **Deliberate:** ADR-398 Amendment 8, ADR-341 Amendment 11. ADR-215 Amendment 1 records the lighter option as deferred: "Have CNC Abort send the door byte and wait for the hold before resetting…".
- **Frequency:** every Abort.
- **Lighter form:** make Zero Z a stored offset like the probe (no decision needed); when a reset was not into motion, read the offsets back and do not ask for a new touch-off. Sending a hold before the reset is the maintainer's deferred decision.

### B4-P2-2 — Touch-plate numbers go back to defaults after every controller reset and every New or Open

- The probe form is an in-memory store with no persistence (`src/ui/laser/probe-form-store.ts:68-77`), keyed by document, probe setup and controller session (`:79-85`). The controller session changes on every reset: every Abort, every pause-and-lift, every reconnect.
- Defaults: plate thickness 15 mm, maximum travel 25 mm (`src/core/controllers/grbl/probe.ts:70-78`).
- A user with a 19 mm plate re-types it each session and after each stop. If they do not notice, Z zero lands 4 mm off.
- The stated intent is that geometry "from a different physical setup cannot silently become this Run's input"; the effect is that a factory default silently does.
- **Frequency:** every session, every stop, every project. No ADR found.
- **Lighter form:** store plate thickness and corner geometry on the machine profile, and show "Plate 19 mm (saved)" beside Run probe.

### B4-P2-3 — Each new project starts on factory stock and bit, and stock can only be changed through Machine Setup

- New keeps the machine parameters and the bit library but resets stock to 6.35 × 400 × 400 mm, material to none, and Default bit to the 1/8 in end mill (`src/ui/state/project-actions.ts:121-147`, `src/core/scene/machine.ts:302-307,375`).
- The stock chip on the canvas is read-only: "Read-only here. Select to view the saved stock or edit it in Machine Setup." (`src/ui/workspace/CncStockCanvasHud.tsx:56`).
- Changing thickness costs: expand the chip, Edit in Machine Setup, type, Next, Save. Four clicks and a three-step dialog for the value that changes most often.
- **Deliberate:** ADR-306 ("CNC settings have one writable owner"). **Frequency:** every project.
- **Lighter form within ADR-306:** seed New from the last saved stock, material and bit for this machine; let the chip edit thickness and size through the same store action.

### B4-P2-4 — Work Z must be proved again after events where the controller may still hold it, and the shortcut is hidden

- Work Z evidence is cleared on reconnect, Home, any alarm, any reset, a coordinate-system change and each bit change (`src/ui/state/laser-store-helpers.ts:478-483` and siblings). A job that ends normally keeps it.
- A probed zero can be read back without touching off, but only through a collapsed "Advanced: Reuse existing controller setup", then **Use existing controller Z zero**, then a native confirm (`src/ui/laser/WorkZRecoveryControl.tsx:63-83,130-134`).
- Users of the Zero Z button have no shortcut, because that zero is the volatile kind (B4-P2-1).
- **Frequency:** every session and every stop. **ADR:** ADR-192, ADR-228.
- **Lighter form:** when a stored Z offset exists and the bit is unchanged, show one inline line: "Controller still holds Z0 for {bit}. Use it / Zero again".

### B4-D-1 — On a CNC, any Z move after Frame throws the Frame away

- A Z jog, and Move to position or click-to-position (their safe-Z lift moves Z), expire the Frame (`src/ui/state/jog-held-frame.ts:34,61`; ADR-565 Amendment 1).
- Frame returns the bit to its starting Z, which is touching the stock if the user zeroed there. Lifting the bit before Start is a natural reflex and costs a second trace.
- The CNC program opens with an absolute move to safe Z before the spindle starts, so the Z the bit starts from does not change where it cuts.
- **Deliberate:** ADR-565 Amendment 1, decided the same day as this audit, took the cautious answer for Z and says its CNC rows were read from the code, not tested.
- **Option for the maintainer:** on a CNC keep the Frame through an app-owned Z jog; keep expiring it on Zero Z, probe, origin change, alarm and reset.

### B4 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B4-P3-1 | Saved positions and click-to-move are refused until Z is zeroed, which is when they are wanted: "CNC point move blocked: set or probe Work Z before moving." ADR-192 | `state/laser-jog-actions.ts:420-421` | Lift relatively, or offer "Move at the current height" |
| B4-P3-2 | Job Review is read-only for CNC, so one feed change is a full round trip. Deliberate, ADR-306 | `job-review/JobReviewCncOwnerActions.tsx:22-24` | Allow feed, plunge and RPM in the card |
| B4-P3-3 | The "Confirm CNC setup" banner is the same 12 lines on every Start, repeats included. One line lists things the connection already rules out (WebUI, Telnet, SD on a USB GRBL). It ends "Start?", which is leftover confirm wording. Deliberate; keep | `state/cnc-setup-attestation.ts:4-13` | Four short bullets with the long form under Details |
| B4-P3-4 | CNC Feed and Plunge snap to the machine maximum without a word; the laser side already shows "Capped to Output max feed…" (ADR-361) | `layers/CncLayerPrimitives.tsx:78-90`, `CncLayerAdvancedFields.tsx:142-156` | Reuse the feed-ceiling note |
| B4-P3-5 | Seven CNC warnings name the operation by its internal id (`Layer operation-…`) | `laser/cnc-default-feed-warnings.ts:30`, `cnc-on-path-size-warnings.ts:43`, and five more | Use the operation's name |
| B4-P3-6 | "…skips its holding tabs" returns on every job for a deliberate groove. ADR-258 Amendment 2 | `laser/cnc-through-cut-tab-warnings.ts:122-130` | A one-click "Turn tabs off for this operation" |
| B4-P3-7 | The Abort card tells a router user "The laser is off." | `laser/AbortStoppedCard.tsx:246-265` | "The spindle was commanded off; check it has stopped." |
| B4-P3-8 | A test touch is needed before every probe run. Deliberate (ADR-103 Amendment 2); keep | `laser/ProbeCircuitLine.tsx:24` | Let one test stand for a retry in the same idle period |

### Already recorded elsewhere

- Real 6.35 mm stock reads as "never set": J1-P3-3 in the CNC audit. B4-P2-3 makes it more frequent, because New restores 6.35.
- An offset pocket on a large sign prepares for about three minutes with only "Preparing preview…": S8-P3-3 in the performance audit, still a maintainer decision. It runs in a worker and leaving Preview cancels it.

### B4 checked and sound

- The ordinary start path is one gate, one review, one click. A missing Work Z, a first-bit mismatch and an unremoved plate are warnings, not refusals.
- Work Z survives a normally finished job.
- Pause lifts the bit, Resume spins up above the cut, and the text says what will happen.
- A tool-change hold says why Continue is off, and Continue needs no new Frame (the exception is B4-P1-1).
- The Zero Z overwrite guard asks only when a zero exists and the bit is more than 0.5 mm from it.
- The 3D result pane updates as you edit and never blocks Start.

---

## B5 — The phone remote

Paths: **phone** = `services/remote-control/app/src/`, **worker** = `services/remote-control/src/`, **desktop** = `src/ui/`. No phone, network or Worker was used; anything about a real device is not verified.

Remote access exists only in the packaged desktop app; the web app cannot be paired. Several findings share one cause: the phone follows a machine action only by polling its own receipt, and never reads the `operation` the desktop already puts in every status reply (`desktop/remote-control/machine-control-registry.ts:256-272`).

### B5-P2-1 — A phone review that changes, is blocked or is closed leaves the phone stuck

- Tapping Review on the phone opens the PC's real Job Review dialog. The phone polls until the receipt reaches `awaiting_review`, then stops for good (`phone/core/control-operation.ts:12-26`).
- **Stale review:** any change on the PC, or a tap on the phone's own Design tab, makes the desktop rebuild the review under a new id. The phone keeps the old sheet; sliding sends the old id and gets "That value isn't accepted. Check it and try again." The Review button only reopens the old sheet.
- **Blocked review:** the desktop explains itself ("A setting is being edited in the Job Review on the PC. Save or discard it there, then approve the new review.", `desktop/remote-control/machine-review-presenter.ts:15-17`). The phone hides every message while the state is "preparing" (`phone/ui/machine-job.tsx:15-16,83-85`), so the user sees only a spinner, and after 150 polls (about three minutes) it stops asking.
- **No way back:** closing the sheet cancels nothing. While the PC review is open, Jog, Frame and Review are refused with "A Job Review already owns this Start." (`desktop/remote-control/machine-projections.ts:207-217`). The only exit on the phone is the red Abort.
- **Deliberate in part:** the gate is (ADR-569, ADR-638 Amendment 1). The phone-side tracking is not.
- **Lighter form:** read the operation from each status reply; disable the slider when the review is out of date and say so; show the desktop's message while preparing; add "Cancel review".

### B5-P2-2 — The pairing ends silently on a fixed clock, with no warning, even mid-job

- A session lasts a fixed 8 hours from approval, or 30 days if the PC user ticks a box (`worker/protocol.ts:15-17`). Use never renews it, and neither side shows the expiry.
- At expiry the phone drops to the first-run screen (`phone/entry-phone.tsx:35-40`). The prepared message ("This phone is no longer approved. Pair it again on the PC.") is never shown, because the store is reset first.
- During a job the Running card, Pause and the Abort dock disappear with it. The job continues, and getting the phone back needs a new link, a scan and a PC approval.
- **Deliberate in part:** the lifetimes are (ADR-583). The silence is not.
- **Lighter form:** show "Signed in until 17:40" on both sides, warn 15 minutes before and before a Start that would outlast it, and say why on the pairing screen.

### B5-P2-3 — An alarm is a dead end on the phone

- The phone has no Unlock. Home is greyed in Alarm because its availability reuses the jog gate (`desktop/remote-control/machine-projections.ts:97,121`), although the desktop's own Home accepts Alarm (`desktop/state/laser-home-action.ts:112-115`) and ADR-585 lists Home as allowed in "Idle/Alarm".
- The phone shows "Alarm", a red dot and a 3.5 s toast. Nothing says "go to the PC".
- **Frequency:** after every alarm.
- **Lighter form:** give Home its own availability; in Alarm show a card with the alarm text and "Unlock or Home on the PC".

### B5-P2-4 — Pairing asks for the permissions twice, unticked on the PC, and a missed tick means pairing again

- About six PC clicks and three phone taps, with two trips between devices. The entry point is a toolbar button labelled "MCP".
- The PC's approval boxes all start unticked (`desktop/remote-access/RemotePairingHost.tsx:19-21`); with none ticked the main button reads "Allow viewing".
- The PC only offers boxes for what the phone asked for, so a phone that left Control off can never be given it. Nothing can be changed afterwards without revoking and pairing again.
- Escape on the PC modal rejects, and the code is then spent.
- **Deliberate:** ADR-569 ("choices … start unchecked") and ADR-583.
- **Lighter form, with the PC still the only approver and nothing pre-ticked:** let the PC change scopes on an existing connection; always show all boxes; label the button "Allow viewing only — no machine control" when control was asked for; make Escape close without deciding.

### B5-P2-5 — Greyed buttons and refused actions do not say why in words a phone user can see

- Frame, Review, Start, Home, Set origin, Zero Z, Pause and Resume put the reason only in a `title` attribute (`phone/ui/machine-parts.tsx:22-23`), which a touch screen does not show. ADR-582 item 7 promises "visible reasons for unavailable actions".
- A refused Frame loses its reason: the PC reports the real cause on its own screen and hands the phone a bare "unavailable" (`desktop/remote-control/machine-execution.ts:156-158`), which reads "This information is not currently available." (`fault.ts:14`).
- Wording written for AI clients reaches the phone: "…Do not automatically repeat it with a new ID.", "The owned operation was cancelled."
- Failures arrive as a 3.5 s toast; the 244-character Zero Z refusal cannot be read in that time.
- **Frequency:** every session.
- **Lighter form:** print the reason under each disabled button; carry the Frame refusal to the phone; give the phone its own text per state.

### B5-P2-6 — The red Abort dock stays on screen after a phone-started job longer than about three minutes

- The phone stops polling the Start receipt after 150 attempts. The receipt stays "running" in the phone's store, and the dock treats any unfinished receipt as "moving" (`phone/ui/MachineScreen.tsx:241-253`).
- After the job ends, Abort stays docked at Idle until the next action or a reload. Tapping it sends a real Abort with no confirmation.
- **Lighter form:** follow the receipt from status reads (the same change as B5-P2-1), or drop the receipt once the job is no longer active.

### B5-P2-7 — Quick step taps are refused, and a minute of nudging can hit the request limit

- A second tap that arrives before the first jog has settled gets "busy" (`desktop/remote-control/machine-control-registry.ts:180-191`): "The PC is busy with another action. Wait for it to finish, then try again."
- Each tap costs several requests (the area agent counted about four), against a limit of 120 a minute per phone (`services/remote-control/wrangler.jsonc:41`). About 30 taps in a minute would reach it, and status reads then fail too. Abort keeps its own lane.
- **Runtime check owed.** This is the phone's counterpart of round one's A3-P2-2, on a different code path.
- **Lighter form:** queue one pending step on the phone; show "moving…" on the pad, not a red toast.

### B5-P2-8 — A closed or sleeping PC is reported as "may have received that", and the stale screen stays live

- With no desktop connected, the Worker returns the same "unavailable" as for a lost reply (`worker/device.ts:327-338`), so the phone says "The PC may have received that. Tap Apply again to check…".
- The one fitting sentence, "The PC is offline. Keep KerfDesk open and the computer awake.", has no code path that produces it.
- The Machine tab keeps the last position, percentage and time with its buttons enabled. The only sign is a small "PC offline" in the top bar, which also appears when the phone itself has no network.
- **Lighter form:** a distinct "offline" answer; a banner "PC not reachable — showing the state from 14:32" with motion buttons disabled. Abort stays enabled.

### B5-P2-9 — During a job the phone can sleep, and the result is a 3.5 s toast

- The phone app never asks to keep the screen awake (no wake lock anywhere in the phone sources).
- Job end is "The job finished." or "The job stopped. Check the machine." for 3.5 s, and only if the app is in front. Nothing afterwards records how the job ended.
- Push alerts exist but stay off until the maintainer sets their keys (ADR-583); the live state was not checked.
- **Lighter form:** hold a wake lock while a job is active and the Machine tab is visible; keep a "Last job: finished 14:32" line until the next Start.

### B5-P2-10 — A CNC tool-change hold shows as "Running", with nothing to do

- The desktop reports a tool-change state. The phone's title is `paused ? 'Paused' : starting ? 'Starting' : 'Running'` (`phone/ui/machine-job.tsx:114`). Pause is greyed with a hidden reason, and there is no Continue.
- **Frequency:** every bit change.
- **Lighter form:** title "Waiting for a bit change — continue on the PC". A remote Continue would be a separate safety decision.

### B5-D-1 — No "Run again" on the phone

- A repeat costs Review, a wait, the full sheet and a slide every time, and the sheet shows every warning in full each time.
- **Deliberate:** ADR-237 Amendment 3 excludes the remote approval on purpose.
- **Option for the maintainer:** when the phone approved the previous run and the comparison finds the same program and warnings, offer "Slide to run the same reviewed job again". The slide stays as the one affirmative gesture.

### B5 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B5-P3-1 | 4,096 machine actions per pairing, then "This phone has used all its machine actions. Pair again on the PC." Refused and offline taps count too. Deliberate (ADR-569, ADR-585) | `worker/control-actions.ts:12,122-128` | Show the remaining count; warn at 10 % |
| B5-P3-2 | After the phone wakes, live updates and hold-to-move can take up to 30 s to return | `phone/core/phone-transport.ts:253-261` | Reconnect at once when the page becomes visible |
| B5-P3-3 | A hold stops after 100 mm (20 mm on Z) without a word beside the pad. Deliberate (ADR-585) | `desktop/remote-control/machine-hold.ts:29-30,109` | Clear the ring and say why beside the pad |
| B5-P3-4 | The phone's pairing help names controls the PC does not have ("Settings → Phone & MCP → Add a phone"); the PC has "Create pairing link" behind a button labelled "MCP" | `phone/ui/Pairing.tsx:140,170`, `desktop/remote-access/PairingControls.tsx:38` | Match the words |
| B5-P3-5 | "Disconnect this phone" revokes the pairing on one tap, with no confirmation | `phone/ui/MoreScreen.tsx:105-115` | The two-step confirm Home already uses |
| B5-P3-6 | Wrong and expired codes get one generic sentence; after five wrong tries the offer is dead while the PC still shows it counting down | `phone/core/phone-transport.ts:4-5`, `worker/approvals.ts:206` | Say which, and end the PC's countdown |
| B5-P3-7 | The camera is one still per tap, appears only when the PC's camera is already live, and depends on a sharing setting whose label does not mention the camera | `phone/ui/MachineScreen.tsx:194-236` | Refresh while the card is on screen |
| B5-P3-8 | Desktop side: a phone's Review opens the PC's large Job Review over whatever the PC user is doing, with nothing saying the phone asked; no badge names which phone holds control; one failed local poll ends remote access until restart | `desktop/remote-access/renderer-session.ts:267-291` | Say who asked; retry, or a Reconnect button |

### B5 checked and sound

- Abort is one tap, docked above every sheet, on its own rate lane, and never queued behind another request.
- Hold-to-jog has a PC-side dead-man of 600 ms and releases on a closed connection or a hidden page.
- Start is a slide, greyed until Frame is complete.
- A pairing survives a PC restart, a relay drop and phone sleep within its lifetime.
- QR pairing needs no typing.
- Touch targets are 48 px or more, and the jog pad 64 px.
- Pause, Resume and Abort skip the revision check, so a design edit cannot block a stop.

---

## B6 — Editing feel and waiting

The waits are in better shape than the editing: almost every wait read has a status line and a Cancel. Statements about LightBurn are from memory unless the repository records them.

### B6-P2-1 — A right-click throws away a multi-selection

- `src/ui/workspace/workspace-context-menu.ts:46-52`: every stationary right-click calls `selectObject(hitId)`, which replaces the selection with that one object, or clears it on empty canvas (`src/ui/state/store-actions.ts:259-271`).
- So right-clicking one of five selected objects leaves one selected, and the menu that opens offers Group, Align and Distribute, which need the selection the click just destroyed.
- **Frequency:** every right-click on a multi-selection. No ADR found.
- **Lighter form:** if the object under the pointer is already selected, keep the selection; on empty canvas keep it and open the empty-canvas menu.

### B6-P2-2 — Click tolerance is a fixed 2 mm of artwork, not screen pixels

- `src/core/scene/hit-test.ts:32`: `VECTOR_STROKE_HIT_TOLERANCE_MM = 2`. `hitTest` takes no zoom. Handles and node picks are already sized in screen pixels (`workspace/handles.ts:27,62`).
- Zoomed out on a large bed, 2 mm is about a pixel and thin line art is very hard to click. Zoomed in, 2 mm is tens of pixels and a press anywhere near a line grabs it. (Arithmetic from the constants.)
- The topmost object within 2 mm wins, not the nearest (`hit-test.ts:59-66`).
- A press inside any closed outline selects it (`hit-test.ts:237-251`, ADR-196), so a marquee cannot be started inside a border: the press picks up the border and moves it.
- **Frequency:** every edit at high or low zoom. ADR-196 covers geometry-first picking, not the 2 mm.
- **Lighter form:** about 5 px through `pxToMm`, capped at 2 mm; nearest stroke wins; a drag from an unselected interior starts a marquee.

### B6-P2-3 — There is no drag threshold: a click that slips one pixel moves the artwork, and snapping can make it jump

- A press on an object returns a `move` drag at once (`workspace/drag-state.ts:204-216`), and the first pointer move writes transforms (`apply-transform-drag.ts:24-70`). Move, scale and rotate have no threshold; the draw tool and the right-click do.
- With snapping on (grid 10 mm, reach 8 px), that one-pixel move is pulled to the nearest grid line or edge.
- Result: click to select, the object lands somewhere else, the project is dirty and undo holds a Move.
- Whether such a slip also expires a completed Frame was not checked; ADR-565 keys the Frame on placement, so it probably does.
- **Frequency:** every session, more on trackpads and pens. No ADR found.
- **Lighter form:** start move, scale and rotate only after 3 to 4 px of travel.

### B6-P2-4 — Paste always lands at "source + 10 mm", so repeated pastes stack exactly, and a paste can land off-screen

- `src/ui/state/scene-clipboard-actions.ts:29,188-191`: each paste offsets the clipboard copy's original position by 10 mm. The clipboard is never updated, so a second Ctrl+V lands exactly on the first.
- Paste ignores the pointer and the visible area. After panning away, nothing visible happens and the natural reaction is to press Ctrl+V again.
- Stacked exact copies matter on a laser: on a Line operation every copy burns again.
- **Frequency:** every multi-paste. WORKFLOW documents "offset from the source"; no ADR weighs repeated paste.
- **Lighter form:** paste at the pointer when it is over the canvas, otherwise step the offset per paste; pan to a paste that lands outside the view. Paste in Place stays.

### B6-P2-5 — The pen tool cannot take back one point

- `src/ui/workspace/pen-tool.ts:46-60,150-166`: a click only starts, appends or closes. Nothing removes the last point.
- Esc discards the whole draft (`src/ui/app/shortcuts.ts:328-333`). Backspace and Delete fall to the global binding and delete whatever artwork is still selected. Ctrl+Z undoes the last project edit, not the last point.
- One wrong click on a 30-point outline means losing all of it, or finishing and repairing in node edit.
- **Frequency:** every pen drawing of more than a few points. No ADR found.
- **Lighter form:** while a draft exists, Backspace and Ctrl+Z remove the last point; the first Esc removes the draft and a second leaves the tool.

### B6-P2-6 — On a small selected object the resize handles cover the whole body

- Handle hit boxes are 8 px (`workspace/handles.ts:27`) and are tested before the body (`drag-state.ts:263-294`).
- A selected object under about 20 px across is all handles: dragging it resizes it, at once, because of B6-P2-3.
- **Frequency:** every edit of small parts at fit zoom. No ADR found.
- **Lighter form:** below about 24 px keep only corner handles outside the box, or let the body win inside it.

### B6-P2-7 — A decimal comma is refused everywhere

- `src/ui/layers/english-decimal-input.ts:3-4`: "Enter a number using English digits and a decimal point (for example 12.5). Commas are not accepted." The expression parser says the same (`src/core/numeric-expression.ts:25-26,161`).
- On many European keyboards the numeric keypad's decimal key types a comma (from memory), so keypad entry fails on every number.
- **Deliberate by code comment** ("refused rather than guessed at"); no ADR found.
- **Frequency:** every number, for comma-locale users.
- **Lighter form:** a single comma between digits with no dot can only be a decimal; accept it and keep refusing "1,234.5".

### B6-D-1 — A trackpad cannot pan the main canvas; two-finger scroll zooms

- `src/ui/workspace/use-workspace-wheel.ts:44-80`: every wheel event zooms; horizontal delta is never read. Panning needs Space+drag, the middle button or a right-drag.
- **Deliberate:** ADR-359 Amendment 2 ("A two-finger trackpad scroll zooms 1.1x per 100 px"). The trace preview does the opposite (ADR-407: two-finger drag pans, pinch zooms).
- **Frequency:** every edit on a laptop.
- **Option for the maintainer:** treat pinch as zoom and a two-finger scroll as pan, as the trace preview does; mouse-wheel notches keep zooming.

### B6 P3 findings

| ID | Finding | Evidence | Lighter form |
|---|---|---|---|
| B6-P3-1 | The view re-fits to all objects after every import and every trace, even when the result lands where the user is zoomed in | `state/import-actions.ts:84,96`, `object-insert-actions.ts:153,183,350,374` | Re-fit only when the new artwork is outside the view or the scene was empty |
| B6-P3-2 | The toolbar's X, Y, W, H and R boxes keep the keyboard after Enter (left open by ADR-706), and no number box selects its content on click | `commands/NumericEditsBar.tsx:317-333,364-369` | Blur on Enter; select all on focus |
| B6-P3-3 | Undo holds 50 steps and every arrow-key tap is one | `state/undo-stack.ts:11` | Fold consecutive nudges; raise the depth |
| B6-P3-4 | The artwork tree selects one row at a time (no Ctrl or Shift) and does not scroll to the canvas selection | `layers/DesignRowButtons.tsx:33-37` | Ctrl toggles, Shift ranges, scroll into view |
| B6-P3-5 | Drawing tools return to Select after each shape. Deliberate (maintainer request, 2026-07-07) | `workspace/draw-tool.ts:100-105` | Double-click the tool to lock it until Esc |
| B6-P3-6 | Resizing by a handle never snaps | `workspace/drag-snap.ts:42` | Snap the dragged edge to grid and guides |
| B6-P3-7 | Zoom stops at 16 times the bed fit, so a large bed cannot be zoomed far; the view is neither kept per project nor reset on Open | `state/ui-store.ts:34-35` | Cap by pixels per mm; fit on Open |
| B6-P3-8 | Aspect lock is off for typed sizes, on for handle drags, and forgotten each launch | `commands/NumericEditsBar.tsx:115-118` | Remember it as a preference |
| B6-P3-9 | Plain-clicking one of several selected objects does not narrow the selection to it | `workspace/drag-state.ts:206-208` | Narrow on release without travel. **Fixed (ADR-196 Amendment 1)** |
| B6-P3-10 | The clipboard is KerfDesk's own: Ctrl+V of an SVG, image or text from another program does nothing, with no message | `state/scene-clipboard-actions.ts:57-70` | Route a pasted image or SVG into import |
| B6-P3-11 | Undo back to the saved state still shows the project as changed | `state/store-actions.ts:184` | Compare with the last saved project |

### Waiting

Still open in the performance audit (`../2026-11-02-performance-s1/P3-SWEEP.md`), not re-measured and not counted again here:

| Wait | What the user gets | Source |
|---|---|---|
| A large vector result arriving (an SVG of 50,000 paths, 801–863 ms; opening 10,000 objects) | Window frozen after the progress toast has gone | S3-P3-2 |
| Exclude on many shapes (500 shapes 2.5 s; 2,000 shapes 55 s) | "Updating preview…" with no percentage | S6-P3-2 |
| Trace without a trace worker | Stalls of 205–285 ms | S5-P3-2 |

### B6 checked and sound

- Marquee direction, Shift to add, Alt+click to cycle through stacked artwork.
- Esc cancels only the drag in hand, and a whole drag is one undo step.
- Shift constrains, Ctrl scales from the centre, Alt suspends snapping.
- The wheel zooms about the pointer; F and 0 fit the bed.
- The numeric bar accepts sums, units and percentages.
- Undo keeps the view; history is cleared only by New or Open.
- The Studios, Trace and Frame each show what they are doing and offer a way out.

Not covered: click counts for per-object power and speed, tooltip timing, node editing beyond the pen, and text on a curve.
