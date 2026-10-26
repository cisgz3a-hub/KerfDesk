# Rolling audit v2 — App shell

- **When:** 2026-10-22 01:00–02:00   **Tree:** origin/main @ `902f1d0c0` (re-fetched; unchanged)
- **Scope:** `src/ui/app/**` (shell, file actions, unsaved-work guards, desktop close handoff,
  startup, autosave recovery, global error handling), `src/ui/settings/**`, `src/ui/help/**`,
  `src/ui/tutorials/**`, `src/ui/common/**`, `src/ui/kit/**`, `src/ui/theme/**`, `src/ui/a11y/**`,
  `src/ui/support/**`, and `src/ui/recent-projects/**` where report 13 left gaps. Followed into
  `electron/window-close-guard.ts`, `electron/desktop-window-close.ts` and `electron/support-log.ts`
  only to trace the shell's contracts. Governing: PROJECT.md non-negotiable 9, ADR-546 (+ Amd 1),
  ADR-549, ADR-482, ADR-117, ADR-227, ADR-561 Amd 3, ADR-378 (+ Amd 1), WORKFLOW F-A13, F-C3, the
  Phase B+ shortcut list (WORKFLOW.md:1736-1741), and the 2026-10-04 small usability, 2026-09-21
  interface and 2026-10-06 settings-sync audits.
- **Lenses run:** L1, L2, L4, L5 (support report), L6, L7. L3 ran inside L1/L6 (open vs save worker,
  desktop vs web close, web vs desktop update). No hardware was operated.
- **Counts:** 8 raised → 0 refuted → P1 0 / P2 3 / P3 5 (+ 5 KNOWN). Refuter: 8 CONFIRMED,
  0 PLAUSIBLE, 0 REFUTED; no severity changes.

## Headline

The documented panic key, Ctrl+., is silently swallowed while the operator types text on the
canvas, and inside Image Studio's Adjust, Colour, Resize and Text dialogs and the desktop Editors
panel. Those components stop every keydown before it reaches the window listener. The modal ones
also trap Tab, so no keyboard route to Abort is left (REPRO). Separately, any render crash
unmounts every app-wide protection while a job keeps streaming:

- the wake lock is released and recovery checkpoints stop;
- the web tab-close laser-off, the unsaved-changes prompt and autosave stop;
- the desktop close handshake goes away.

The crash screen offers no Save (REPRO). The support report also copies grblHAL's plain-text WiFi,
AP and MQTT passwords from `$$`, under a header that says it holds no password (REPRO + source).
Unsaved-work prompts on New, Open, Recent, drop, OS hand-over, templates, close and quit are sound.

## Findings

### P2-1 — Ctrl+. Abort never reaches its listener from the canvas text editor, Image Studio dialogs or the desktop Editors panel
- **Where:**
  - `src/ui/text/CanvasTextEditor.tsx:101-105`: `handleEditorKey` calls `event.stopPropagation()`
    first, for every key.
  - The same unconditional stop is at `src/ui/image-editor/AdjustDialog.tsx:66`,
    `ColorPickerDialog.tsx:54`, `ResizeDialog.tsx:40` and `TextDialog.tsx:38`.
  - `src/ui/artcraft-studio/DesktopEditorsPanel.tsx:36` does the same. That panel is also modal with
    `closeOnEscape: false` (`:26`).
  - The only Abort shortcut is a bubble-phase `keydown` listener on `window`
    (`src/ui/laser/use-job-shortcuts.ts:21-37`).
- **Anchor:**
  - Contract: PROJECT.md:465, non-negotiable 9: Abort is reachable "from any window state during
    a job. No modal can block it". PROJECT.md:340 repeats it for Image Studio: "Abort stays reachable
    while a job streams".
  - Contract: WORKFLOW.md:1738 defines `Cmd/Ctrl+.` as the software Abort.
    `use-job-shortcuts.ts:6-9` says Abort ignores modal and editable-target gates because "a panic
    happens mid-typing".
  - Twin: `CompactConnectionControls.tsx:127-132` (`isolateDetailsKey`),
    `workspace-context-keyboard.ts:7` and `menu-keyboard.ts:43` all let Ctrl+. through before they
    stop propagation. The five components above do not.
  - Ground truth: WCAG 2.2 SC 2.1.1, "All functionality of the content is operable through a
    keyboard interface".
- **Scenario:**
  - A job is burning and the operator is typing a name on the canvas (Text tool), or has an Image
    Studio colour or adjustment dialog open. Editing during a job is allowed.
  - They press Ctrl+., and nothing happens.
  - In the modal cases (Image Studio dialogs, Editors panel), Tab is trapped in the dialog, so the
    Live Motion bar's ABORT cannot be reached by keyboard either. Only the mouse can stop the job.
- **Evidence:** REPRO.
  - `node ../../../node_modules/vitest/vitest.mjs run src/ui/text/zz-27-text-abort.test.tsx` mounted
    the real `CanvasTextEditor` with `installJobShortcuts(window)` and a streaming job. Output:
    `control stopJob calls=1; canvas-text stopJob calls=0; defaultPrevented=false`. The same chord
    from a plain input reached `stopJob`; from the editor's textarea it did not.
  - `src/ui/image-editor/zz-27-picker-abort.test.tsx` used the real `ColorPickerDialog` with focus
    inside the dialog: `stopJob calls=0`.
  - DesktopEditorsPanel: READ (same pattern).
  - L7: the existing test "Ctrl+. stops even while a modal dialog is open"
    (`use-job-shortcuts.test.ts:74-86`) only patches store state and dispatches on `window`. It
    never mounts a dialog, so it cannot catch component-level `stopPropagation`.
- **Refuter:** CONFIRMED, stays P2. An independent repro mounted the real `CanvasTextEditor`
  (`beginAdd`) and the real `ColorPickerDialog` with `installJobShortcuts(window)` and a streaming
  job. Result: `control=1 canvasText=0 picker=0`. There is no other route: there is no Electron
  `before-input-event` or menu accelerator for Ctrl+., and neither component gates on job state.
  It is not P1:
  - Non-negotiable 9 (PROJECT.md:465) promises that the Abort *control* is reachable and that no
    modal blocks it. The Live Motion bar's ABORT is `position: fixed` at z-index 2147483647. That
    is above the text editor (25), Image Studio and its dialogs (1010/1020) and the Editors
    backdrop (10000), so the mouse still reaches it.
  - The failure is keyboard-only, with a documented shortcut (WORKFLOW.md:1738). That is a broken
    contract, not unexpected firing or motion.
  - Editors panel: its reach is near zero, because it is an opt-in prototype gated on
    `KERFDESK_ARTCRAFT_ROOT` (`electron/desktop-artcraft.ts`). By READ, its hosted native editor
    window (`use-native-editor-viewport.ts`) sits over the rectangle where the bar draws, so there
    the mouse ABORT may be covered too. This is not reproduced and is worth noting for the fix.
- **Fix direction:** Exempt `isMenuAbortShortcut` in every handler that stops all keys, as
  `CompactConnectionControls` does. Or move the Abort listener to the window capture phase. Add a
  mounted-component test for each surface.

### P2-2 — A render crash anywhere in the workspace drops every app-wide protection while the job keeps running; the crash screen offers no Save
- **Where:**
  - `src/ui/app/main.tsx:116-137`: the only general `ErrorBoundary` wraps `DesktopStartupGate` and
    `App`.
  - `src/ui/common/ErrorBoundary.tsx:61-72`: on a crash it replaces all children with
    `CrashScreen`.
  - `src/ui/app/App.tsx:114,124-149`: `AppLifecycle` (wake lock, job checkpoint, autosave, unload
    stop, desktop close receiver, unsaved-changes guard) is a child of `App`.
  - `App.tsx:112` mounts `SupportReportHost` there too. Only the four lazy overlays have their own
    boundary.
  - Cleanups that run on the crash: `use-active-job-wake-lock.ts:50-53`,
    `use-job-checkpoint.ts:94-98,466-468`, `use-autosave.ts:96-99`, `use-unload-stop.ts:38-42`
    (which also removes `installDesktopCloseReceiver`) and `use-unsaved-changes-guard.ts:47-48`.
- **Anchor:**
  - Contract: ADR-117 (wake lock held while a job is active).
  - Contract: C3 / H-U6 comments in `use-unload-stop.ts:1-16` and `use-unsaved-changes-guard.ts:1-19`
    (tab close mid-job sends a stop; dirty close prompts).
  - Contract: ADR-549 (close asks Save / Don't Save / Cancel) and ADR-546 item 3 (the report holds
    the window's last crashes).
  - Twin: the boundary already keeps the software Abort alive for this reason (`main.tsx:94-114`,
    F60/F65). The other lifecycle protections were not kept.
- **Scenario:**
  - A render bug in any panel, dialog or status-bar control throws while a long job streams on a
    dirty project. Streaming lives in the store, so the job continues under the crash screen.
  - The screen wake lock is released, so display sleep can now interrupt the burn.
  - Recovery checkpoint tracking stops, so a later interruption restarts from the pre-crash line.
    A completion is never recorded.
  - On the web, closing the tab sends no laser-off, and a dirty close no longer prompts.
  - The 30 s autosave loop and the `beforeunload` autosave write are gone, so up to the last 30 s of
    edits are lost.
  - On desktop, closing finds no receiver. Main shows "KerfDesk cannot reach its controls" and
    **Close app** destroys the window without the Abort handoff, although the renderer is alive.
  - Help > Save Support Report is unreachable. The only route to the in-memory project is
    **Try again**, which fails again for a persistent render bug.
- **Evidence:** REPRO.
  - `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-27-crash-lifecycle.test.tsx`
    mounted the real `App` inside `ErrorBoundary`, made the project dirty, set a streaming job, then
    made one leaf (`AutosaveRecoveryControl`, mocked) throw during render. Logged:
    `{"crashed":true,"stillDirty":true,"laserStoreSubscribersBefore":["handleStoreChange","anonymous","handleStoreChange","anonymous","anonymous","anonymous","sync","observe"],"laserStoreSubscribersAfter":["anonymous"],"wakeLockReleasedAfterCrash":1,"unsavedPromptBefore":true,"unsavedPromptAfter":false,"pagehideStopsBefore":1,"pagehideStopsAfter":0,"desktopCloseHandledBefore":true,"desktopCloseHandledAfter":false}`.
    `sync` is the checkpoint tracker.
  - L7: `ErrorBoundary.test.tsx` checks only the screen, ABORT and copy, not what the crash
    unmounts.
- **Refuter:** CONFIRMED, stays P2. An independent repro mounted the real `App` in `ErrorBoundary`.
  A mocked `AutosaveRecoveryControl` subscribed to the streamer and threw mid-job. Logged:
  `{"unsavedPromptBefore":true,"pagehideStopsBefore":1,"desktopReceiverBefore":true,"crashed":true,"crashScreenHasAbort":true,"jobStillActive":true,"wakeLockReleased":1,"pagehideStopsAfter":0,"beforeunloadStopsAfter":0,"unsavedPromptAfterIdleDirty":false,"desktopReceiverAfter":false}`.
  - The stream does continue. The pump is store and transport code: `connection.onLine` →
    `laser-stream-ack*`, with no React owner.
  - No other `beforeunload` or `pagehide` listener exists outside `AppLifecycle`, so nothing
    sends a laser-off on web tab close.
  - It is not P1. It needs a separate render bug first. The crash screen still shows a working
    ABORT while motion is live. On desktop, the unreachable-renderer dialog defaults to **Keep app
    open** and tells the operator to use the physical E-stop.
- **Fix direction:** Wrap the workspace (everything except `AppLifecycle`) in its own boundary, so
  the lifecycle hooks, `SupportReportHost` and the close receiver survive a render crash. Add a
  **Save a copy** action (for example the salvage export) to the crash screen.

### P2-3 — The support report copies grblHAL's plain-text WiFi, AP and MQTT passwords from `$$` under a header that says it holds no password
- **Where:**
  - `src/ui/support/save-support-report.ts:69-72` writes every `$$` row as `${code}=${rawValue}`.
  - `src/core/controllers/grbl/response.ts:28,96-101` and `grbl-settings.ts:29-50` keep unknown
    numbered settings verbatim.
  - `src/ui/support/support-report.ts:49-51`: the header reads "It holds no licence key, password or
    payment details."
  - `support-report-redaction.ts:2-4` redacts only `KD…` licence keys.
- **Anchor:**
  - Contract: ADR-546 item 2 ("Nothing secret goes in") and the report's own header.
  - Ground truth: grblHAL core `master` @ `4ec1ae44b` (2026-10-15).
    - `settings.c` (`setting_get_value`, Format_Password) prints the mask only if
      `hal.stream.state.webui_connected`; otherwise it prints the stored value.
    - `system.c` `output_settings`: `$$` runs `report_grbl_settings(true, …)` at the default
      `COMPATIBILITY_LEVEL`, which includes plugin settings.
    - `settings.h` defines `Setting_WiFi_STA_Password = 75`, `Setting_WiFi_AP_Password = 77`,
      `Setting_AdminPassword = 330`, `Setting_UserPassword = 331` and
      `Setting_MQTTBrokerPassword = 533`.
    - The ESP32 driver's `main/wifi.c` registers 75, 77 and 533 as `Format_Password`.
- **Scenario:** a grblHAL board with networking (ESP32 driver) connects over USB. KerfDesk reads
  `$$` during qualification. The operator then saves a support report and emails it as told. The
  file carries `$75=<home WiFi password>`, `$77=…` and `$533=…`, while its first lines promise there
  is no password.
- **Evidence:** REPRO and SOURCE.
  - `node ../../../node_modules/vitest/vitest.mjs run src/ui/support/zz-27-report-secrets.test.ts`:
    the real `classifyResponse` → `settingsMapToRows` → `formatSupportReport` pipeline gave
    `secrets present in report: ["hunter2-wifi","ap-secret-9","mqtt-pw"]` under the header above.
  - SOURCE: raw `grblHAL/core` `settings.c` and `report.c`, and `grblHAL/ESP32` `main/wifi.c`, as
    quoted in the anchor.
  - Reach not checked: which shipping laser boards (for example the Falcon A1 Pro grblHAL profile)
    enable the networking plugin.
- **Refuter:** CONFIRMED, stays P2. The refuter fetched `grblHAL/core` `master` and
  `grblHAL/ESP32` `main/wifi.c` independently.
  - `setting_get_value` prints the stored string for `Format_Password` unless
    `hal.stream.state.webui_connected`.
  - `output_settings` calls `report_grbl_settings(true, …)` at the default `COMPATIBILITY_LEVEL 0`.
    It includes plugin settings unless `flags.hidden`.
  - `wifi.c` registers 75, 77 and 533 as `Format_Password` with only `{ .allow_null = On }`, so
    they are not hidden.
  - A repro ran the real `classifyResponse` → `settingsMapToRows` → `formatSupportReport` path.
    All four planted secrets (75, 77, 330, 533) appeared under the "holds no … password" header.
    `redactSupportReportText` matches only `KD…` keys.
- **Fix direction:** Redact the values of known password settings (75, 77, 330, 331, 533 and
  FluidNC `*/Password`) in the settings section, the console lines and incident raw text. Change the
  header so it does not promise what the code cannot check.

### P3-1 — Web tab close or reload during Frame, jog, Home or Probe sends no stop; desktop close aborts them
- **Where:** `src/ui/app/desktop-close-controller.ts:198-203`: `bestEffortStop` acts only on
  `active || fireLatched`. Twin `src/ui/app/desktop-close-runtime.ts:68-79` (`stopBeforeClose`) also
  stops `motionOperation` and unsafe `controllerOperation`.
- **Anchor:** Twin, as above. Contract: `use-unload-stop.ts:3-8`, "this hook covers the other
  abandonment paths: tab close, window close, and navigation away".
- **Scenario:**
  - In the web app the operator closes or reloads the tab mid-Frame or mid-jog.
  - No jog-cancel or reset is written; the controller finishes its buffered perimeter or jog after
    the page is gone.
  - On desktop the same close aborts first.
  - The unsaved guard also stays armed during Frame, because `isActiveJob` excludes motion.
- **Evidence:** READ. Close cousin of KNOWN 04-P3-21, which covers Windows session end, not web
  unload.
- **Refuter:** CONFIRMED (repro + twin).
  - The repro used `installUnloadStop(window)` with `motionOperation` set to `frame`, no streamer
    and no Fire. `beforeunload` plus `pagehide` produced `stopJob=0`, `cancelJog=0`.
  - Frame is a `motionOperation`, not a streamer, so `isActiveJob` is false. `stopForAttempt`
    and `stopBeforeClose` on desktop do cover `hasOwnedMotion`.
- **Fix direction:** Let `bestEffortStop` use the same predicate as `prepare`
  (`hasOwnedMotion`). Laser-off jogs carry little risk, so P3.

### P3-2 — Desktop close "Don't Save" keeps the discarded work as autosave and offers it back at the next launch; in-app Don't Save clears it
- **Where:**
  - `electron/window-close-guard.ts:149-158`: `leave` goes straight to approve and close.
  - On unload, `src/ui/app/use-autosave.ts:83-95` writes the still-dirty project.
  - The 30 s IndexedDB snapshot is never cleared.
  - Twin: `src/ui/app/confirm-discard.ts:33-41` (`clearAutosaveForDiscard`), and
    `isAutosaveDiscardPending`, which keeps the discarded revision out of autosave.
- **Anchor:** Twin, the two Don't Save paths. Contract: ConfirmSaveDialog's "Don't Save discards the
  changes permanently", and `use-autosave.ts:182` ("Declining is an explicit discard").
- **Scenario:** the operator closes KerfDesk with edits and chooses **Don't Save**. On the next
  launch the status bar offers "Recover autosave" for the work they discarded. ADR-549 is silent on
  this.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (repro + protocol read).
  - The main→renderer close protocol has only `prepare`, `prepare-update`, `save`, `approve` and
    `cancel` (`desktop-close-runtime.ts` `isCloseRequest`). The renderer is never told "Don't
    Save" and cannot mark a discard.
  - A repro mounted `useAutosave` with a dirty project and dispatched `beforeunload`. Local
    autosave snapshots went from 0 to 1.
  - `readLatest` recovers abandoned sessions' slots.
  - The desktop dialog's own detail says only that changes "may be lost". Keep at P3.
- **Fix direction:** On a desktop `leave` decision, mark the current revision discard-pending and
  clear the session slot before approving. Or record that it is kept on purpose in ADR-549.

### P3-3 — Web **Update** clicked during a job reloads and aborts the burn with no warning; the desktop twin waits
- **Where:**
  - `src/ui/common/PwaUpdateButton.tsx:26-36`: its tooltip says only "click to reload and apply it".
  - `PwaUpdateWatcher.tsx:85-89` → `window.location.reload()`.
  - The unsaved guard is skipped mid-job (`use-unsaved-changes-guard.ts:27-32`), and the unload stop
    aborts the job (`use-unload-stop.ts:28-31`).
  - Twin: `desktop-close-runtime.ts:133-143` and ADR-561 Amd 3 refuse to close for an update during
    machine work.
- **Anchor:** Twin, as above. Contract: ADR-227 item 3 keeps the button reachable mid-job but says
  nothing about what the click does to the burn. `lazy-load-failure.ts:17-20` already tells
  operators to reload only "when no job is running".
- **Scenario:** a passive status-bar **Update** appears during a burn. One click reloads the page,
  which aborts the job, with no question and no warning text.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ, two paths).
  - The click runs `applyPromptedReload` → `window.location.reload()` with no machine-state
    check. On web, `beforeunload` → `bestEffortStop` → `stopJob('app-closing')`.
  - ADR-227 item 3 (DECISIONS.md) deliberately keeps the button reachable mid-job, and only says
    applying it "requires an explicit operator click". So the copy or confirmation is the only
    open point, and it is a maintainer decision. Stays P3.
- **Fix direction:** Keep the button (ADR-228). Make its tooltip and label say it stops a running
  job, or confirm first. This needs a maintainer decision, because ADR-227 and ADR-228 frame any
  job-state behaviour as a guard.

### P3-4 — Large-project Save has no fallback when the preparation worker cannot start or crashes; Open falls back to the main thread
- **Where:**
  - `src/ui/app/prepare-project-save.ts:42-56`: a `failed` result ends in `failProjectSave`.
  - `project-save-preparation-client.ts:18-23,48-54,66-67`: no Worker, a construction error or
    `onerror` → `failed`.
  - `project-save-action.ts:175` (`exportLargeProjectRecovery`): the raw recovery export takes the
    same worker path.
  - Twin: `project-open-parser.ts:56-71` opens on the main thread with an advisory, tested by
    `file-actions-worker-fallback.test.ts`.
- **Anchor:** Twin, open vs save of the same project.
- **Scenario:** in a session where module workers are blocked, or when the worker crashes with an
  out-of-memory error, the operator opens a 250-object project through the main-thread fallback.
  Every Save then fails with "project preparation failed: workers blocked", and the recovery export
  needs the same worker. Only autosave holds the work.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ, both twins).
  - Open: `document-import-worker-client.ts` `request` returns `null` when `ensureWorker()` fails.
    `project-open-parser.ts` then parses on the main thread.
  - Save: `prepareProjectSaveOffThread` returns `failed` for no `Worker`, a construction throw or
    `onerror`. `prepareUnsealedProjectSave` maps that to `failProjectSave`, with no fallback.
  - The large salvage path (`exportLargeProjectRecovery`) uses the same worker. The reach is
    narrow, so it stays P3.
- **Fix direction:** On `failed`, fall back to `prepareProjectForPersistence` on the main thread
  with the same advisory Open uses. At least, let the salvage export do so.

### P3-5 — An autosave failure is announced once per session as an 8 s toast, while Settings keeps promising autosave
- **Where:**
  - `src/ui/app/use-autosave.ts:46-54,74`: `createAutosaveFailureReporter` latches after the
    first warning for the hook's lifetime.
  - `src/ui/state/toast-store.ts:17-22`: warnings and errors auto-dismiss after 8 s, with no pause or
    history. `Toasts.tsx:21-22` also shows only the newest three.
  - `src/ui/settings/SettingsGeneralSection.tsx:34-37` states "Unsaved work is copied to this
    computer every 30 seconds…".
- **Anchor:**
  - Ground truth: WCAG 2.2 Understanding 2.2.1. "Any process that happens without user initiation
    after a set time … is a time limit." Its example is a toast that vanishes; that is acceptable
    only when the information is available elsewhere.
  - Twin: the settings text vs the actual failure state.
- **Scenario:**
  - An image-heavy project exceeds browser storage. One "Autosave could not preserve the newest
    project" warning shows for 8 s, perhaps while the operator is at the machine.
  - Nothing else ever says autosave is failing, and Settings still promises it.
  - A later crash finds no recovery.
- **Evidence:** READ. The WCAG Understanding page was fetched 2026-10-22.
- **Refuter:** CONFIRMED (READ).
  - `createAutosaveFailureReporter` latches after one toast for the hook's lifetime.
  - `toast-store.ts` auto-dismisses warnings after 8000 ms and has no pause.
  - A grep for `AUTOSAVE_FAILURE_MESSAGE` and autosave-failure state finds no other surface.
  - The WCAG 2.2.1 anchor is a stretch, but the Settings-promise twin holds. Stays P3.
- **Fix direction:** Keep a persistent status-bar indicator, or a sticky toast, while autosave is
  failing. Reflect the failing state in Settings → Autosave.

## Known (not re-raised)

- **04-P3-20:** the Electron renderer-crash prompt omits that an M3 laser or spindle stays on. P2-2
  covers the different, in-renderer React crash.
- **04-P3-5:** the support log keeps the Windows user name in `file://` stack frames. P2-3 is a
  different secret and a different section.
- **04-P3-21:** Windows session end treats Frame/Jog/Home/Probe as idle. P3-1 is the web-unload
  cousin.
- **13-P2-1:** the salvage prompt in `project-save-action.ts:158-162` blames "machine or output
  settings". Open PR #1352.
- **19-P2-1:** export paths in `src/ui/app` (`export-artwork-svg.ts`, `save-rd-action.ts`,
  `save-processed-bitmap.ts`) leave 0-byte files after the picker truncates them.

## Refuted

Candidates the auditor dropped while checking. The refuter refuted none of the eight raised
findings.

- **Camera RTSP credentials reach the support log through failed bridge fetches.** No.
  - Chromium's `FrameConsole::ReportMessageToClient` returns early for
    `ConsoleMessageSource::kNetwork` (`third_party/blink/renderer/core/frame/frame_console.cc:74`,
    chromium `main`). "Failed to load resource" lines never reach Electron's `console-message`.
  - Nothing logs ffmpeg stderr.
- **Ctrl+R (Rectangle) also reloads the desktop app through Electron's default View menu.** No. The
  app menu omits View (`electron/application-menu-policy.ts:11`, `main.ts:165-166`).
- **A malformed stored preference breaks startup.** No. Every settings store parser is wrapped in
  `try/catch` and normalises its value: theme, units, layout, snap, nudge, start markers, recent
  limit, dock, fonts, tutorials, Labs and start-point defaults.
- **An `errored` streamer suppresses the web unsaved prompt indefinitely.** No. The streamer is
  released at the next Idle (`laser-status-line.ts:73-89`).
- **A second Save-changes request overwrites the first and hangs its caller.** No.
  `confirm-save-store.ts:31-37` fails the newcomer closed.
- **Arrow-key nudge fields in Settings refuse values through native step validation (like 06-P2-4).**
  No. `NumberField` commits through `parse`, not `validity`.

## Verified clean

- **Unsaved-work guards on every replacing path:**
  - These go through `confirmDiscardAsync`, Save / Don't Save / Cancel with the document-epoch
    recheck: File New (menu and Ctrl+N), Open, Recent (`openProjectCommand`), drag-and-drop and OS
    hand-over (ADR-378), templates, production rows and local snapshot restore.
  - Recent and OS hand-over open through `openProjectCommand`. Hand-over and drop are held during a
    job or an open dialog (`external-project-open.ts:59-69`).
  - Autosave Restore acts only on an untouched empty document (`use-autosave.ts:117-151`).
  - Sheet and production-row switches archive the active sheet first.
- **Desktop close and quit (ADR-549):**
  - Save is the default and Esc cancels. Save runs the project's own Save with a user gesture.
  - A save that is cancelled, fails or ends stale keeps the window open.
  - Active work gets the Abort handoff before the question.
  - The update close (`prepare-update`) refuses during machine work.
  - File > Exit uses the same path.
- **Web `beforeunload`:** a dirty, idle tab gets the native prompt. During a job the prompt is
  suppressed by design, and the unload stop plus the synchronous autosave write run instead.
- **Crash screen:** it keeps a working ABORT when motion is live. Its diagnostic copy never uses a
  blocking prompt, and its copy is truthful ("No data leaves your machine").
- **Global handlers:** event-handler errors and unhandled rejections become toasts.
- **Save worker:** a failure yields a `failed` outcome with a message, not a hang.
- **Settings:**
  - Changes apply at once and persist per computer. A write failure shows Retry (F-02).
  - Reset nudge distances restores 0.1/1/10 mm, matching `DEFAULT_NUDGE_STEPS` and its tooltip.
  - Reset Workspace Layout restores `auto` and both panels.
  - No setting is stored in the project.
- **Support report:**
  - The picker opens first and cancelling gathers nothing.
  - Licence keys are redacted in the cells and again across the whole report. The edition line
    never includes the key or payment order.
  - The desktop log section is the main process's home-redacted text.
  - Remembered RTSP URLs are stored without credentials (`camera-preference-storage.ts:35-45`).
- **Dialog accessibility:**
  - `useDialogA11y` handles Escape, Tab trap, topmost-only handling, initial focus that skips
    unavailable controls, IME composition and focus restore. The kit `Dialog` sets role,
    `aria-modal` and its label.
  - Every modal that disables Escape has a Close button Tab can reach, so WCAG 2.1.2 holds.
  - The Settings tablist has arrow navigation. Radio groups use fieldset and legend, and the
    numeric fields have accessible names.
  - The Start/Abort path is labelled: "Job actions", "Start job", the Live Motion "ABORT JOB/MOTION",
    and the crash-screen ABORT.
  - Ctrl+. passes through menus, the workspace context bar, the connection details popover and
    ordinary dialogs.
- **Tutorials and help:** no machine actions and no `innerHTML`. The startup error is built with
  `textContent`.

## Not verified

- Real browsers: screen-reader output, WCAG 2.4.11 (whether the fixed Live Motion bar or the toasts
  hide a focused control) and colour contrast of the theme tokens. jsdom only.
- Whether the display sleeps, and whether USB or Web Serial suspends, after the wake lock is
  released (P2-2). No hardware or OS power test.
- Which shipping boards run grblHAL with networking (P2-3 reach).
- What recovery offers at the next launch after a crash-stopped checkpoint (P2-2 consequence). That
  lifecycle belongs to areas 05 and 18.
- Streaming-worker crash handling is report 19's area. Electron renderer-process crash is report
  04's.
- Packaged Windows build: no installed app was driven.

Refuter repros (`zz-27r-abort`, `zz-27r-crash`, `zz-27r-secrets`, `zz-27r-p3`) were also deleted; the grblHAL copies are in the refuter scratchpad.
Repro files (`src/ui/text/zz-27-text-abort.test.tsx`, `src/ui/image-editor/zz-27-picker-abort.test.tsx`,
`src/ui/app/zz-27-crash-lifecycle.test.tsx`, `src/ui/support/zz-27-report-secrets.test.ts`) were run
on this tree and deleted afterwards. The crash-repro log and grblHAL source copies are in this
session's scratchpad. The refuter's own repros were also run and deleted:
`src/ui/text/zz-27r-abort.test.tsx`, `src/ui/app/zz-27r-crash.test.tsx`,
`src/ui/support/zz-27r-secrets.test.ts` and `src/ui/app/zz-27r-p3.test.tsx`.

```json
[
  {"id":"P2-1","severity":"P2","area":"app-shell","file":"src/ui/text/CanvasTextEditor.tsx","line":105,"anchor":"Contract PROJECT.md non-negotiable 9 + PROJECT.md:340 + WORKFLOW.md:1738; Twin CompactConnectionControls.tsx:127-132 / menu-keyboard.ts:43; Ground truth WCAG 2.2 SC 2.1.1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Ctrl+. Abort is swallowed by unconditional keydown stopPropagation in the canvas text editor, Image Studio Adjust/Colour/Resize/Text dialogs and the desktop Editors panel; the modal ones also trap Tab, leaving no keyboard Abort during a job"},
  {"id":"P2-2","severity":"P2","area":"app-shell","file":"src/ui/app/App.tsx","line":124,"anchor":"Contract ADR-117, C3/H-U6 unload guards, ADR-549, ADR-546 item 3; Twin ErrorBoundary softwareAbort (main.tsx:94-114)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A render crash anywhere unmounts AppLifecycle while the job keeps streaming: wake lock released, checkpoint tracking stopped, web laser-off and unsaved prompt gone, autosave stopped, desktop close receiver and Support Report gone; crash screen has no Save"},
  {"id":"P2-3","severity":"P2","area":"app-shell","file":"src/ui/support/save-support-report.ts","line":71,"anchor":"Contract ADR-546 item 2 + report header (support-report.ts:49-51); Ground truth grblHAL core settings.c Format_Password (plain text unless WebUI connected), system.c $$ = all settings, ESP32 wifi.c $75/$77/$533","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Support report copies grblHAL $$ password settings ($75 WiFi STA, $77 AP, $533 MQTT, $330/$331) verbatim under a header promising no password"},
  {"id":"P3-1","severity":"P3","area":"app-shell","file":"src/ui/app/desktop-close-controller.ts","line":200,"anchor":"Twin desktop-close-runtime.ts:68-79 stopBeforeClose; Contract use-unload-stop.ts:3-8","evidence":"READ","verdict":"CONFIRMED","known":"related: 04-P3-21 (Windows session end)","summary":"Web tab close/reload during Frame, jog, Home or Probe sends no stop (bestEffortStop checks only job/Fire); desktop close aborts motion owners"},
  {"id":"P3-2","severity":"P3","area":"app-shell","file":"src/ui/app/use-autosave.ts","line":91,"anchor":"Twin confirm-discard.ts:33-41 clearAutosaveForDiscard vs electron/window-close-guard.ts:149-158 leave","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Desktop close Don't Save leaves (and on unload rewrites) the discarded project as autosave, so the next launch offers it back; in-app Don't Save clears it"},
  {"id":"P3-3","severity":"P3","area":"app-shell","file":"src/ui/common/PwaUpdateButton.tsx","line":30,"anchor":"Twin desktop update close refuses mid-job (desktop-close-runtime.ts:133-143, ADR-561 Amd 3); ADR-227 item 3","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Web Update clicked during a job reloads and aborts the burn with no warning or confirming copy; maintainer decision (ADR-227/228)"},
  {"id":"P3-4","severity":"P3","area":"app-shell","file":"src/ui/app/prepare-project-save.ts","line":51,"anchor":"Twin project-open-parser.ts:56-71 main-thread fallback","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Large-project Save and its recovery export fail outright when the preparation worker cannot start or crashes, while Open of the same project falls back to the main thread"},
  {"id":"P3-5","severity":"P3","area":"app-shell","file":"src/ui/app/use-autosave.ts","line":46,"anchor":"Ground truth WCAG 2.2 Understanding 2.2.1 (auto-dismissed toast is a time limit unless info available elsewhere); Twin SettingsGeneralSection.tsx:34-37","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Autosave failure is shown once per session as an 8 s auto-dismissing toast with no persistent indicator while Settings keeps promising 30 s autosave"}
]
```
