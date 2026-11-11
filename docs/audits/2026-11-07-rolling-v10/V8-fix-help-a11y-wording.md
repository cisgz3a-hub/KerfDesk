# Rolling audit v10 — V8 Fix: help, accessibility and wording

- **When:** 2026-11-08 07:00–08:00 (local)   **Tree:** origin/main @ `5f09e1110` (repro tree `j10-main`; own export `zz-v8/mut` for added repro tests)
- **Scope:** #1554 (U1-P2-2, U1-P2-4, U1 P3s), #1570 (U7-P2-1/2/3, ADR-207 Amd 2), #1580 (U5-P3-8..12), #1581 (U1/U3 P3s), #1588 (U2 P3s), #1598 (U6-P2-1→P3, U6-P3-1..6, ADR-604 Amd 1), #1604 (U7 P3s). Entry points: Ctrl+K (`search-entries.ts`, `CommandSearchDialog.tsx`), the dialog shell (`use-dialog-a11y.ts`, `hide-outside-modal.ts`, `recover-dialog-focus.ts`), the Live Motion bar and announcer, the status bar, the new hints, toasts, lessons and crash screen.
- **Lenses run:** L10 (fix verification), truthfulness (every new message, hint, label, lesson), L9 (Ctrl+K guards against the other entry points), accessibility (focus, `aria-hidden`, live regions, small screens). L12 (full related e2e) **not run**: the 3 GB browser gate was never met (1,990–2,160 MB available at every check); see Not verified.
- **Counts:** 6 raised → 0 refuted (refuter pending) → P1 0 / P2 1 / P3 5 (+0 KNOWN). Verdicts are PENDING until the refuter runs.

## Headline

All seven PRs do what their original findings asked: the welcome dialog takes focus, the workspace is hidden from a screen reader behind a modal while ABORT JOB, the announcer and alerts stay exposed, the live-region flood is gone, Job Review's `<summary>` rows are in the Tab cycle, and Ctrl+K's new panel entries only reveal and focus, never press (no new guard bypass; Machine Setup from Ctrl+K has the same reach as its toolbar button). The one new risk is #1570's own focus fix: Pause, Pausing… and Resume are now one button that keeps keyboard focus, and Chromium turns each auto-repeated Enter keypress into a click, so **holding Enter on Pause can resume the burn** about half a second later (V8-P2-1, a P1 candidate if Chrome reproduces it). The rest are small truthfulness slips: a status-bar hover that names a scroll gesture that does not scroll, a "normal until homed" hover that is wrong for no-homing machines and Verified Origin, laser wording on CNC Frame hints, a Ctrl+K reveal that says nothing for a disabled jog pad, and two lessons that teach Pro tools without the new Pro mark.

## Findings

### V8-P2-1 — Holding Enter on Pause resumes the job: the button now keeps focus through Pause → Resume, and Enter auto-repeats
- **Where:** `src/ui/laser/LiveMotionActionButton.tsx:51-56` (one `aria-disabled` button for Pause / Pausing… / Resume, ignores clicks only while pending); `src/ui/laser/LiveMotionBar.tsx:161-195` (the same component renders Pause, the pending state, then Resume); `src/ui/laser/use-job-start-focus.ts:12-19` (Start hands focus to that button).
- **Anchor:** Twin / Contract — ADR-207 Amendment 2 Decision 7 ("Pause → Pausing… → Resume flips in one button … so it keeps focus") against the pre-#1570 behaviour the PR replaced (pending states were separate component types, so focus fell to `<body>` and further key presses did nothing). Ground truth: Chromium activates a focused button on every Enter **keypress** with no repeat filter — `HTMLElement::HandleKeyboardActivation`, `third_party/blink/renderer/core/html/html_element.cc` at tag `130.0.6723.58` (`case '\r': DispatchSimulatedClick(&event);`, no `repeat()` check), and keypress auto-repeats while a key is held. KerfDesk's own audit C8 (`2026-10-22-controller-v2/C8-ctl-machine-ui.md:426`) already treats "held Enter on a focused arrow" as a real input.
- **Scenario:** A job runs; the operator Tabs to Pause (or focus is there because `useJobStartFocus` put it there after Start) and presses Enter, holding it a little long, as people do when they want something to stop. Keypress 1 → `pauseJob`. While the transition is pending, repeats hit the `aria-disabled` "Pausing…" and are ignored (`LiveMotionActionButton.tsx:55`). As soon as the controller confirms the hold (one 250 ms status poll after deceleration, `laser-connection-actions.ts:80`) the same focused element becomes **Resume** with no delay or confirm (`runConfirmedResumeJob`, `laser-job-pause-resume.ts:185` has no minimum paused time). Windows' default key-repeat delay is about 500 ms, so the next repeat keypress clicks Resume and the burn continues. A held Enter on Job Review's **Start job** does the same thing in the other order: focus lands on Pause by `requestAnimationFrame`, and repeats then pause and resume the job in turn. Space is not affected (activation on keyup).
- **User-visible effect:** the operator paused, and the laser starts burning again without a deliberate Resume. Before #1570 the second and later repeats went to `<body>` and did nothing.
- **Severity reasoning:** firing the laser after the operator paused is P1 by effect (METHOD §3, "can fire the laser … unexpectedly"). It is raised as **P2** because the evidence is READ + SOURCE only (METHOD §4: a READ-only finding cannot be P1 unless the refuter reproduces it) and it needs a held key past the OS repeat delay. **Refuter: reproduce in Chrome with the simulated GRBL (focus Pause, hold Enter about 1 s); if the stream resumes, raise to P1.** Pause is not the safety stop (ABORT JOB and Ctrl+. are unaffected), which is the case for keeping it at P2.
- **Evidence:** READ (main, lines above) + SOURCE (Chromium `130.0.6723.58`, quoted above). Not run: browser gate never met.
- **Novelty:** new with #1570. Not in U7 (its P3-1 asked for focus to be kept), not in V3 or V7, no open PR touches `LiveMotionActionButton.tsx`.
- **Refuter:** PENDING.
- **Fix direction:** ignore auto-repeated activations on the bar's primary action (`KeyboardEvent.repeat`, or refuse a click whose triggering key is still held since the previous state), or require a fresh keydown after the label changes; keep focus on the button.

### V8-P3-1 — Ctrl+K "Jog the head" with the jog pad disabled says nothing and focuses nothing
- **Where:** `src/ui/commands/search-entries.ts:204-208`; target `src/ui/laser/JogSettingsRow.tsx:36` (the `data-search-target="jog"` element is the **Jog step size** `<select>`, not a button).
- **Anchor:** Contract — ADR-604 Amendment 1 Decision 2 ("A disabled control stays disabled, and a notice repeats its own hover reason").
- **Scenario:** Not connected (or a job running), Ctrl+K → "jog" → Enter. The machine panel opens; `control.focus()` on a disabled `<select>` does nothing; the disabled check is `control instanceof HTMLButtonElement`, so no notice either. The select's title ("Distance moved by each jog arrow click.") is not a reason anyway, and the jog arrows carry none (#1554's own note).
- **User-visible effect:** the beginner asked to jog and gets the panel with no focus and no reason, the dead end U6 was about. Frame, Start and Set origin do give their reason.
- **Evidence:** REPRO — `zz-v8/mut/src/ui/commands/zz-v8-reveal.test.tsx` renders the real `JogSettingsRow` with `disabled`, calls `revealSearchTarget('jog', 'Jog the head')`: active element not the select, toasts `[]` (1 passed).
- **Novelty:** new (#1598). **Refuter:** PENDING.
- **Fix direction:** point the jog target at a control that carries the jog gate's reason (`jogFrameCommandBlockMessage`), or test `disabled` on any form control and push that reason.

### V8-P3-2 — The status bar's hover says it scrolls "with the mouse wheel"; nothing makes a vertical wheel scroll it
- **Where:** `src/ui/common/StatusBar.tsx:48` (title), `:170-178` (`overflowX: 'auto'`, `overflowY: 'hidden'`), `status-bar.css:3-20` (scrollbar hidden). No wheel handler (`grep wheel` in the status-bar files: none).
- **Anchor:** Contract — U7-P3-7's fix (#1604) promises a way to read the cut-off line; the hover is the only instruction.
- **Scenario:** at 1366 px the faded right edge appears; the user follows the hover and turns the mouse wheel over the strip. Chromium scrolls a horizontal-only scroller from a vertical wheel only with Shift held, so nothing moves (the page does not scroll either). The arrow-key half is true (the strip is `tabIndex={0}`).
- **Evidence:** READ; Chrome confirmation owed (browser gate).
- **Novelty:** new (#1604). **Refuter:** PENDING (check in Chrome; refute if a plain wheel scrolls it).
- **Fix direction:** say "Shift + mouse wheel", or map `deltaY` to `scrollLeft` on the strip.

### V8-P3-3 — "Relative view" hover says it is "normal until your machine is connected and homed", which is false for no-homing machines and Verified Origin
- **Where:** `src/ui/workspace/canvas-motion-badge.tsx:213-219` (hover added by #1554, U1-P3-2); the view's real causes: `src/ui/state/canvas-coordinate-frame.ts:59` (Verified Origin and unresolved placement are always relative) and `src/ui/state/native-bed-frame.ts:103` (`!device.homing.enabled` → no bed frame, ever).
- **Anchor:** Twin — the hover against `canvasCoordinateFrame` / `resolveNativeBedFrame`.
- **Scenario:** (a) A diode laser with no homing switches (common beginner machine, homing off in setup): the red "Relative view — physical bed position unverified" never goes away, and the hover tells the beginner it will once the machine is "homed", which it cannot be ("A machine without switches cannot home", #1554's own Words lesson). (b) A homed machine on Verified Origin: still relative, hover still says "until … homed".
- **User-visible effect:** the beginner is told the red line is a temporary state they can clear by homing; on (a) they may try Home and get the homing-disabled refusal.
- **Evidence:** READ (main).
- **Novelty:** new (#1554). Open #1609 edits `canvas-motion-badge.tsx` but not this hover. **Refuter:** PENDING.
- **Fix direction:** word the hover by cause: no homing ("your machine can't home, so positions are relative to the origin you set"), Verified Origin ("this start mode always draws relative to your origin"), otherwise the current text.

### V8-P3-4 — New Frame hints say "laser off" / "beam off" on a CNC
- **Where:** `src/ui/laser/JobActionControls.tsx:280` (disconnected Frame hover, #1554), `src/ui/commands/search-entries.ts:33` (Ctrl+K Frame job detail, #1598), `src/ui/tutorials/project-tutorials.ts:97` ("Words you'll see", `machine: 'all'`).
- **Anchor:** Contract — ADR-101 §7 (machine-aware nouns; the shortcut table and Materials/Recipes entry already follow it). The connected Frame hover on the same button says "with the tool off".
- **Scenario:** a CNC project, disconnected: Frame job's hover reads "Frame then traces the job outline with the laser off."; Ctrl+K "frame" says "beam off". The statement is true in substance (the spindle is off), only the noun is wrong.
- **Evidence:** READ. **Novelty:** new. **Refuter:** PENDING.
- **Fix direction:** use `jobTimeNoun`/`machineDisplayName`-style wording ("tool off") or "laser or spindle off".

### V8-P3-5 — Two lessons still teach Pro tools without the new Pro mark (U6-P3-4 siblings)
- **Where:** `src/ui/tutorials/placement-tutorials.ts:5-27` ("Use a camera to place artwork": step "Choose Set up camera", which is Pro `camera-alignment`, `CalibrateCameraControls.tsx:34`); `src/ui/tutorials/image-tutorials.ts:129` ("Try Smooth … or Sharp", which are Pro `advanced-trace`, `pro-features.ts:35-38`).
- **Anchor:** Contract — ADR-604 Amendment 1 / #1598's U6-P3-4 fix ("The 16 lessons that teach Pro tools … show a Pro badge in KerfDesk Free").
- **Scenario:** KerfDesk Free, Learn → "Use a camera to place artwork": no Pro badge, ranked among the free lessons; step 2 opens the Pro prompt. The trace lesson's Smooth/Sharp suggestion is softer (the mode list marks them "(Pro)").
- **Evidence:** READ. **Novelty:** new sibling; not in #1598's list of 16. **Refuter:** PENDING.
- **Fix direction:** add `pro: 'camera-alignment'` to the camera lesson (or split its free half), and mark the Smooth/Sharp sentence as Pro.

## Refuted

None raised and dropped by the auditor beyond these candidates checked and cleared:
- **Ctrl+K opens Machine Setup during a job (L9).** Same reach as the toolbar's Machine Setup button (`DeviceSetupControls.tsx:37`, unguarded too); the harmful step inside is V3-P2-1 (KNOWN). No parity break.
- **Ctrl+K opened over another modal would focus a control behind it.** Ctrl+K is not consulted while a dialog owns the keyboard (`command-search-shortcut.ts` header, `use-shortcuts.ts`).
- **`aria-hidden` hides ABORT JOB or Pause during a job.** The bar section and announcer carry `data-modal-reachable` (`LiveMotionBar.tsx:118`, `LiveMotionAnnouncer.tsx:146`); `collectHidden` recurses around them; a bar that mounts while a dialog is open is re-exposed by the observer (`hide-outside-modal.ts:76-88`). Ctrl+. is a window capture listener (`use-job-shortcuts.ts:40-46`).
- **Focus return after close lands on an `aria-hidden` opener.** `releaseHidden()` runs before `restoreDialogFocus()` (`use-dialog-a11y.ts:130-136`).
- **Frame preparation's `role="status"` progress counter floods like U7-P2-1.** It carries `aria-busy` while preparing (`JobActionControls.tsx:39-40`).
- **Missing-font notice fires for fonts the panel can edit.** Same test as the panel's `fontAvailable` (`use-text-dialog-fields.ts:114-116`).
- **Ctrl+Enter skips Job Review.** It runs `runStartJobFlow`, the Start button's flow (`use-job-shortcuts.ts:49-58`).

## Verified clean

- **#1554.** U1-P2-4: disconnected Frame/Start and the shared jog/Frame gate say "Connect your machine first." (`status-unknown-message.ts`, `laser-store-helpers.ts:234`); a connected controller with no report keeps the Idle wording. U1-P2-2: `download.html` has the Keep / Show more / Keep anyway and SmartScreen More info / Run anyway steps (Microsoft source not re-fetched). Ctrl+K "units"/"inch" find Settings. "Words you'll see" names real controls (Kerf Offset, Frame job; related lesson ids exist).
- **#1570.** Unit suites pass on main (`use-dialog-a11y.u7`, `LiveMotionAnnouncer`; part of a 60-test focused run). Announcer speaks only heading changes and each 10 % (`LiveMotionAnnouncer.tsx:84-96`); detail and age changes are not spoken. The status-bar run line drops `role="status"` (`canvas-motion-badge.tsx:31`). Tab trap counts top-level `<summary>` only outside closed `<details>`. ADR-207 Amendment 2 matches the code (Decisions 1–7, including `aria-keyshortcuts` and the tooltip text). Pending Pause/Resume clicks are refused (`LiveMotionActionButton.tsx:55`). Tests fail before the fix (new modules).
- **#1580.** Every named control exists: Help > Save Support Report... (`support-command-family.ts:45`), File > Save As..., the crash screen's Save project / Copy diagnostic / Try again, the text panel's Import and System fonts.... Open failure leaves the design untouched; empty files say empty; the parser text is under details.
- **#1581.** Power/Speed hovers are laser-only (`SpeedInput` used only in `LayerRowFields`); Learn is in the toolbar's right-hand utilities; Shift/Ctrl draw modifiers, Alt colour peek (`ArtworkPulseOverlay.tsx:80-82`) and the aspect lock wording are true; the raster Preview banner is display-only wording.
- **#1588.** Start-from hints match `resolveJobPlacement` (Absolute compensates known WCO; Current Position uses the head at Frame); "My machine isn't listed" is the real row name; "Port open, no answer" uses one predicate for toolbar and sidebar; preset stock shrink only touches the untouched default.
- **#1598.** Panel entries reveal and focus, never click (`search-entries.ts:189-210`; test passes); menu entries still come from `buildAppCommands` with `enabled` checked before `runCommand`; Settings entries open real sections; Keyboard Shortcuts is a Help command and the table's new F12 and Alt rows are bound; every lesson rename names a real control (Cut Planner, Apply Mask to Image, Shared by, Show on canvas, Include in output, Font size, Weld overlaps, Photo engraving, Material recipe, Auto tones, Link to operation); the fidelity test passes.
- **#1604.** Focus waits on the labelled group while Frame job / Set origin here are disabled and returns after (`use-focus-through-disable.ts`); dialogs shrink by the bar's inset, the bar stays on top; the draw-tool keyboard route names real things (Open design library, Ctrl+I import, Artwork panel **Objects**, X/Y/W/H). `accessibility-u7.test.tsx` passes.

## Not verified

- **L12 full related e2e** (`command-search-panel-actions`, `ux-shell`, `interface-simplification`, `dialog-opener-focus`, `startup-live-motion`, `workspace-responsive`, `small-document-scenarios`, `first-connect-machine-setup`): the 3 GB browser gate was never met (1,990–2,160 MB at six checks). Only focused Vitest ran (5 suites, 60 tests, plus the V8 repro).
- **V8-P2-1 in Chrome** (held Enter on Pause with the simulated GRBL) and **V8-P3-2** (wheel over the status strip): need a browser.
- Real screen readers (NVDA, JAWS, VoiceOver), and whether a toast added while a modal is open is still announced after its region is re-portalled into the dialog.
- Small-screen reachability of Start, Pause and ABORT at 375 px and 1366 × 768 after #1604's inset (CSS read only).
- The phone remote bundle (#1604): a Worker redeploy is owed (KNOWN), not checked here.
- Microsoft's SmartScreen wording on the download page was not re-fetched.

```json
[
  {"id":"V8-P2-1","severity":"P2","area":"V8","file":"src/ui/laser/LiveMotionActionButton.tsx","line":51,"anchor":"Twin/Contract: ADR-207 Amd 2 D7 vs pre-#1570 focus drop; Ground truth: Chromium 130.0.6723.58 html_element.cc HandleKeyboardActivation","evidence":"READ+SOURCE","verdict":"PENDING","known":false,"summary":"Pause/Pausing/Resume is one focused button; Chromium clicks on every auto-repeated Enter keypress, so holding Enter on Pause resumes the burn once the hold is confirmed (P1 candidate if Chrome reproduces)"},
  {"id":"V8-P3-1","severity":"P3","area":"V8","file":"src/ui/commands/search-entries.ts","line":205,"anchor":"Contract: ADR-604 Amd 1 Decision 2","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Ctrl+K Jog the head with the jog pad disabled focuses nothing and gives no reason (target is a select, disabled check is button-only)"},
  {"id":"V8-P3-2","severity":"P3","area":"V8","file":"src/ui/common/StatusBar.tsx","line":48,"anchor":"Contract: U7-P3-7 fix hover","evidence":"READ","verdict":"PENDING","known":false,"summary":"Status bar hover says scroll with the mouse wheel; a horizontal-only strip with no wheel handler does not scroll from a vertical wheel"},
  {"id":"V8-P3-3","severity":"P3","area":"V8","file":"src/ui/workspace/canvas-motion-badge.tsx","line":219,"anchor":"Twin: canvas-coordinate-frame.ts:59, native-bed-frame.ts:103","evidence":"READ","verdict":"PENDING","known":false,"summary":"Relative-view hover says normal until connected and homed; false for no-homing machines and Verified Origin"},
  {"id":"V8-P3-4","severity":"P3","area":"V8","file":"src/ui/laser/JobActionControls.tsx","line":280,"anchor":"Contract: ADR-101 section 7 machine-aware nouns","evidence":"READ","verdict":"PENDING","known":false,"summary":"New Frame hints (disconnected hover, Ctrl+K detail, Words lesson) say laser/beam off on a CNC"},
  {"id":"V8-P3-5","severity":"P3","area":"V8","file":"src/ui/tutorials/placement-tutorials.ts","line":27,"anchor":"Contract: #1598 U6-P3-4 Pro marks","evidence":"READ","verdict":"PENDING","known":false,"summary":"Camera lesson teaches Pro Set up camera, trace lesson suggests Pro Smooth/Sharp, neither carries the Pro mark"}
]
```

## Refuter (2026-11-08)

Fresh context. Tree: `git archive 5f09e1110` into scratchpad `zz-v8r/mut` (node_modules junctioned to the main checkout; `vite.zz.config.ts` aliases fflate to `node_modules/.pnpm/fflate@0.8.3/.../esm/browser.js`). Own Vite dev server (`--mode desktop`) on 127.0.0.1:4898, Playwright 1.61.1, headless, `--workers=1`, one spec (`e2e/zz-v8r-held-enter.e2e.ts`). Memory gate: 1,930–1,985 MB for about 20 min, then 2,054 MB at launch (3,135 MB before the main run). No hardware, no real port, nothing downloaded, the installed KerfDesk not launched. The Vite server was started and stopped by Playwright; no process of mine is left on 4898.

**Browser versions.** Playwright drove the cached `ms-playwright/chromium-1248` Chrome for Testing **156.0.8078.4** (UA `HeadlessChrome/156.0.0.0`). Playwright 1.61.1's own pinned build (1228, 149.0.7827.55) is not in the cache, so I used 1248 through `executablePath` and downloaded nothing. KerfDesk desktop: `package.json:122` pins `electron` **44.9.1**. The Electron in the main checkout's node_modules is 44.5.1, whose `process.versions.chrome` is **152.0.7977.130** (read with `ELECTRON_RUN_AS_NODE=1`, no app loaded). The desktop renderer is therefore Chromium 152, between the auditor's cited 130 and the 156 tested here. I did not run the packaged Electron app. That the repro carries over to 152 is an inference: the same Blink keypress activation path, with no repeat filter in any version checked.

**Simulated controller.** This is `e2e/fixtures/paced-grbl-serial.js` copied to `zz-v8r-door-grbl.js` with two changes:
1. Raw-byte decoding. The original runs `TextDecoder`, which turns 0x84 into U+FFFD, so its realtime branch never saw the door byte. In my first control run, Pause timed out after about 2 s and KerfDesk sent its fail-dark 0x18.
2. GRBL 1.1 safety-door states. 0x84 gives `Door:2` for 120 ms, then `Door:0`. `~` from `Door:0` gives `Door:3` for 40 ms, then `Run`. Laser mode skips the spindle-restore delay. Every report carries `Ov:`. Line jobs run at 30 blocks/s. The project is 12 circles on a Line operation, Start from Current Position. Connect → Frame → Start → Job Review **Start job**.

**Key events.** `Input.dispatchKeyEvent` (CDP) sends Enter as `windowsVirtualKeyCode 13`, `text "\r"`:
- one `keyDown` with `autoRepeat:false` at t=0;
- after 500 ms (the Windows default keyboard delay), `keyDown` with `autoRepeat:true` every 33 ms (about the default repeat rate of 30/s);
- `keyUp` at the end of the hold.

In-page capture listeners logged keydown, keypress, click, the bar button's label and focus, and every realtime byte the simulator received.

### V8-P2-1 → **CONFIRMED, raised to P1** (REPRO, Chromium 156; carries over to Electron 44 / Chromium 152 by inference)
Pins at 5f09e1110:
- `src/ui/laser/LiveMotionActionButton.tsx:51-56`: `aria-disabled`, and the click guard covers pending states only.
- `src/ui/laser/LiveMotionBar.tsx:138-195`: the pending, Pause and Resume branches at 163/169/190 all render the same element.
- `src/ui/laser/use-job-start-focus.ts:12-19`.
- `src/ui/state/laser-job-pause-resume.ts:185`: `runConfirmedResumeJob` has no minimum paused time and no repeat check.

`KeyboardEvent.repeat` is tested only in other handlers (jog, arrange, fire, peek). It is not tested on this button.

Observed (dt in ms from the first keydown; the Pause button had been focused by `useJobStartFocus` itself, `focusedByApp: true`):

| Hold | What happened | State after release + 2 s |
|---|---|---|
| tap 80 ms (control) | 0x84 @3 → `Pausing…` → `Resume` @254, focus kept | **paused** (`Door:0`, executed lines frozen at 31) |
| 300 ms (shorter than repeat delay) | 0x84 @5 → `Resume` @233; no repeat sent | paused |
| 600 ms | 0x84 @4 → `Resume` @350 → **first repeat clicks Resume @508 (0x7E @509)** → repeats on `Resuming…` ignored → a repeat lands on the 1-render `Resume` flash @620 (second 0x7E @621) → **KerfDesk sends 0x18 @639**, job ended | job aborted by a fail-dark reset mid-burn |
| 1000 ms | 0x84 @6 → Resume @255 → **0x7E @507** → Pause again @765 → 0x84 @770 → Resume @1006 → **0x7E @1009** | **running** (`Run`, executed 38 → 97 in 2 s) |
| 2000 ms | Pause/Resume toggled about every 250 ms: 0x84 @4, 0x7E @516, 0x84 @803, 0x7E @1038, 0x84 @1297, 0x7E @1572, 0x84 @1800 | paused (outcome depends on release phase) |
| Job Review **Start job**, 1500 ms | Start job clicked @1; bar mounts and takes focus on Pause @96 → **repeat pauses @512 (0x84)** → resumes @847 (0x7E) → 0x84 @1096 → 0x7E @1343 | running, after two uncommanded pause/resume cycles |

Every repeat produced `keydown(repeat:true)` → `keypress(repeat:true)` → `click` on the focused button. Clicks on `Pausing…` and `Resuming…` are ignored as the auditor says, but each label change re-arms the button for the next repeat.

**Minimum hold to resume:** one repeat after the confirmed hold, so about the OS repeat delay (≈500 ms by default; 250 ms at the fastest Windows setting), provided Resume is showing by then. In the simulation it showed at 233–352 ms. A slower real deceleration only moves the toggle later.

Severity: METHOD §3 P1, "can fire the laser … unexpectedly". The operator pressed Pause, and the beam resumed with no deliberate Resume. The 600 ms run also showed a second harm: an uncommanded fail-dark reset that ends the job mid-burn. The auditor's case for P2 does not hold under §3:
- "Pause is not the safety stop" changes nothing. ABORT and Ctrl+. being unaffected is not a warning to the operator before the output.
- "Needs a held key" is reach, and METHOD allows reach to lower a finding only when it is not reachable today. Here it is reachable with default focus after Start or Tab, and default OS key repeat.

The Start-job variant also needs no Tab: holding Enter on Start job is enough.

The 1-render clickable `Resume` after a confirmed Resume (`LiveMotionBar.tsx:161-195`: transition cleared while `status` is still `paused`) is folded in here, not raised separately. Its only trigger seen is the same auto-repeat, and the same fix (refuse `repeat` activations, or require a fresh keydown after a label change) closes both.

### V8-P3-1 → **CONFIRMED P3** (REPRO, browser)
`src/ui/commands/search-entries.ts:50-54` (`jog` target), `:204-205` (`focus()`, then a disabled check on `HTMLButtonElement` only); `src/ui/laser/JogSettingsRow.tsx:36-37`. In Chrome 156, disconnected: Ctrl+K → `jog` → Enter on "Jog the head" left the target `<select aria-label="Jog step size">` `disabled: true`. `document.activeElement` was `BODY`, and the Notifications region was empty. The select's title is "Distance moved by each jog arrow click.", not a reason. Nothing is sent and no harm results: polish, P3.

### V8-P3-2 → **CONFIRMED P3** (REPRO, browser)
`src/ui/common/StatusBar.tsx:48` (title), `:174-175` (`overflowX:auto`, `overflowY:hidden`); there is no wheel handler. At 1366×768 with the default project the strip did not overflow (clientWidth = scrollWidth = 1177). I narrowed the strip to 260 px (scrollWidth 696) to test the scroller itself. CDP `mouseWheel` over its centre gave:
- 5 × `deltaY:120`: scrollLeft **0 → 0** (page did not scroll either);
- 5 × Shift + `deltaY:120`: 0 → 436;
- 5 × `deltaX:120`: 0 → 436;
- focused + 5 × ArrowRight: 0 → 200.

The hover's "mouse wheel" is false for an ordinary vertical wheel, and its arrow-key half is true.

### V8-P3-3 → **CONFIRMED P3** (READ)
`src/ui/workspace/canvas-motion-badge.tsx:219` (hover text). `src/ui/state/canvas-coordinate-frame.ts:59` always returns `relative` for `verified-origin` or `bed === null`. `src/ui/state/native-bed-frame.ts:103` returns `null` whenever `!device.homing.enabled`, so a no-homing machine never leaves the relative view. The view itself is correct, and only the explanation is wrong, so P3. The same badge text ("This is normal until your machine is connected and homed.") was visible in the accessibility tree of my browser run (a `status` element).

### V8-P3-4 → **CONFIRMED P3** (READ; not raised to P2)
`src/ui/laser/JobActionControls.tsx:280`, `src/ui/commands/search-entries.ts:33`, and `src/ui/tutorials/project-tutorials.ts:97` (lesson `words`, `machine: 'all'` at :60). The connected hover at `JobActionControls.tsx:246` says "tool off".

On the question of P2: the wording is misleading only in its noun. It asserts that the output is off during Frame, which is the same claim the connected CNC hover makes ("tool off"). It gives no false assurance that would lead a CNC operator into an unsafe act, and it does not misdescribe any hazard the operator must act on. That fits §3's P3 (polish, doc/code drift) and not P2's "misleading result". Whether a CNC Frame really guarantees the spindle is off is a separate question that I did not verify. If it were false, the defect would be in Frame, not in this wording, and "tool off" would carry it too.

### V8-P3-5 → **CONFIRMED P3** (READ)
- `src/ui/tutorials/placement-tutorials.ts:4-27`: lesson `camera`, `machine: 'all'`, no `pro:` field. Its step 2 is "Choose Set up camera", which calls `requestPro('camera-alignment', …)` at `src/ui/camera/calibrate/CalibrateCameraControls.tsx:34`.
- `src/ui/tutorials/image-tutorials.ts:129` suggests Smooth and Sharp, which are Pro `advanced-trace` (`src/ui/licensing/pro-features.ts:34-37`).
- Sibling lessons that do carry the mark: `placement-tutorials.ts:54` and `:121`, and `image-tutorials.ts:161`.

The Pro prompt still gates the tool, so this is a labelling slip with no bypass: P3.

### New findings
None raised separately. The fail-dark reset caused by a double Resume, which the 600 ms hold triggered, is recorded under V8-P2-1 → P1 above (same root cause, same fix).

**Evidence files** (scratchpad `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-v8r\`):
- `mut\e2e\zz-v8r-held-enter.e2e.ts`;
- `mut\e2e\fixtures\zz-v8r-door-grbl.js`;
- `mut\playwright.zz.config.ts`;
- `out-run4.json` (control), `out-run5.json` (all holds, Start job, first wheel attempt), `out-run6.json` (wheel), `out-run7.json` (Ctrl+K jog);
- `run5.log`.

Refuter counts: raised 6, refuted 0, P1 1, P2 0, P3 5, known 0
