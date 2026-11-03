# U7 — Accessibility and small screens (auditor)

- **When:** 2026-11-03.
- **Tree:** `origin/main` @ `19faee6f1` (`git fetch origin main`). Production web build (Browser Free) from `git archive 19faee6f1`. The phone remote is main's committed build, `services/remote-control/public/app/`, from the same archive.
- **How:**
  - Desktop app: served on 127.0.0.1:4971 (`zz-u7-host.mjs`, the repo's COOP/COEP/CSP headers). Driven by Playwright 1.61.1 in installed Chrome from a clean context each run (`zz-u7-drive.mjs` on 4972).
  - The machine is the repo's GRBL simulator behind a fake Web Serial port (U4's `zz-u4-sim.js`, copied as `zz-u7-sim.js`). `retireMs` 300–1500 gives jobs of 30 s to 2 min.
  - The accessibility tree is Playwright's `ariaSnapshot` (Chromium's computed roles and names). Live-region traffic was logged in the page (`zz-u7-helpers.js`, `__U7.llog`).
  - Contrast is computed from `getComputedStyle` colours, blended over ancestor backgrounds, using the WCAG 2.x formula.
  - Phone remote: served by `zz-u7-phone-host.mjs` on 4973 with a stand-in relay (approved session, scopes read/edit/control, a laser job at 37 %). Viewport 375 × 812, DPR 2, touch.
  - No hardware, no desktop app, nothing installed. `@axe-core/playwright` is not in `node_modules`, so axe was not used.
- **Scope:** AREAS U7.
  - Keyboard-only first design and first burn: menus, panels, dialogs, Machine Setup, Job Review, Start, Pause, Abort.
  - Screen-reader names, roles and live regions, read from the accessibility tree.
  - Contrast in both themes.
  - 1366 × 768 at 100 / 125 / 150 %, and 1280 × 720.
  - Phone remote at 375 × 812.
  - Abort while a dialog is open during a job.
- **Counts:** 13 raised. P1 0 / P2 3 / P3 10. KNOWN 5 re-observed. Refuted 3 (candidates dropped by the auditor).
  - **After the refuter:** P1 0 / P2 3 / P3 9. Confirmed 12 (two with corrected mechanism: U7-P2-1, U7-P3-7), refuted 1 (U7-P3-6), severity changes 0. One claim inside U7-P3-3 (aria-modal hides the Live Motion bar) is refuted; the finding stands. The auditor's 3 refutations stand.

SCRATCH = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u7`. Screenshots are in `SCRATCH\shots\`.

## Headline

A keyboard-only beginner can do the whole first burn without a mouse. They:
- add a design from the Design Library;
- move it with the arrow keys and size it in W / H;
- connect, and complete Machine Setup with Tab and Enter;
- Set origin, Frame, open Job Review (Ctrl+Enter also works), Start, Pause and Abort.

**Ctrl+. aborts from anywhere,** including inside a modal dialog. The 27-P2-1 fault (capture phase) is fixed. Start and ABORT JOB stay visible and unclipped at every laptop size tried, down to 1366 × 768 at 150 % in a maximised browser (911 × 423 CSS px). On the phone, the Abort dock is on every tab and Pause is one tap on Machine. **No P1.**

Three things block or mislead:

- **U7-P2-1. During every job a screen reader is flooded.**
  - The Live Motion line count is a polite live region that changed about 4 times a second, so its announcements arrive faster than they can be spoken.
  - The status bar adds "Controller-reported • Run • Ns • 1500 mm/min" every second.
  - That is 55 announcements in 10 s, a queue a screen reader can never drain. The user can't hear anything else, including where Abort is.
- **U7-P2-2. The very first screen opens with keyboard focus nowhere.** The welcome dialog ("Choose your workspace") mounts while the app root is still `inert` behind the splash, so its focus call does nothing. Then:
  - Tab walks 57 hidden toolbar controls behind the backdrop before it reaches the dialog.
  - Enter on one of them works: **Open…** started a file pick behind the modal.
  - Escape does nothing.
- **U7-P2-3. Job Review's warning details can't be opened by keyboard.** The dialog's Tab trap only counts `button, a, input, select, textarea, [tabindex]`, so it jumps over the `<summary>` rows that come before the first button. The hidden text is the advice:
  - "Run a material test on scrap before burning final material."
  - "…must be checked at the machine."

**The single most important accessibility fix:** make the Live Motion progress and the status-bar elapsed tick quiet. Take them out of live regions, or announce only state changes (Running, Paused, Aborted, Finished, Alarm) and at most coarse progress (every 10 %). Keep ABORT JOB and its shortcut named in the accessibility tree (U7-P2-1 with U7-P3-3).

## Beginner journey

Keyboard only, 1366 × 768, light theme, fresh profile, unless a step says otherwise.

1. **First visit.** The welcome dialog is shown, but `document.activeElement` is `<body>`, and no focus event fires at all (`__U7.flog` empty) (`01-first-visit-1366.png`).
   - Tab 1–57 go to File, Search, Open…, Import…, … the status-bar links, all behind the backdrop. The focus ring is drawn under the backdrop (`02-welcome-tab3-focus-behind-backdrop.png`).
   - Tab 58 reaches "Close and continue with Free".
   - Enter on the hidden **Open…** opened the file picker.
   - Escape did nothing.
   - **Shift+Tab** reaches the dialog in one press → U7-P2-2.
2. **Continue with Free** (Shift+Tab, Enter). The dialog closes and focus goes to `<body>`. There was no opener, which is acceptable.
3. **Tab order.** File (one stop for the menubar; the arrow keys move between menus, and Escape returns to the menu) → Search → toolbar → Laser / CNC → machine chip → **Connect** → Machine Setup → tool strip → canvas tools → zoom → sheets → side-panel tabs → panel → **Frame job** → **Start** → status bar. In the side panel, **Machine** is not a Tab stop: it is a WAI-ARIA tablist, so you press → on Artwork. The accessibility tree says `tab "Machine"`.
4. **First design.** "Create artwork" opens a dialog: Constrained sketch / Parametric part. Escape returns focus to the button (`03-create-artwork-menu.png`).
   - **Draw rectangle** + Enter only arms the tool. The canvas is not focusable, so nothing can be drawn by keyboard → U7-P3-10.
   - **Open design library** → Tab to "Add CNC Profile Fit Test to canvas" → Enter. Toast: "CNC Profile Fit Test added to the canvas." in a polite region (`04-design-library.png`, `05-after-library-add.png`).
5. **Move and size.** → moved X 165 → 166 → 167. Escape deselects, and Ctrl+A selects again. The **Selection width** field: Ctrl+A, type 50, Enter → "50.0 × 45.0 mm".
6. **Connect** (Enter). The simulator's port is granted, and Machine Setup opens with focus on "Go to step 1: Machine" (`06-after-connect-enter.png`).
   - Tab ×13 reaches **Next**. Step 2's heading takes focus; Tab ×15 reaches Next. Step 3; Tab ×9 reaches **Save** (`07-setup-step3.png`).
   - Saved. Focus returns to the toolbar button, which is now **Disconnect** (`08-after-setup-save.png`).
7. **Frame.** It is 51 Tabs from the top. The first Frame was refused: "User Origin needs a custom work origin. Click "Set origin here" first." (`09-frame-pressed.png`; the library design's origin; not a U7 item).
   - Machine tab (→ on Artwork) → Tab to **Set origin here** → Enter. Focus falls to `<body>` (focus log: `out "Declare the current head position…" -> null`) → U7-P3-1.
   - Tab still continues from there (Chrome's sequential starting point) → **Frame job** → Enter → "Frame complete — press Start to review…". Focus is `<body>` again.
8. **Job Review.** Start (or Ctrl+Enter) → focus on the dialog surface, which is named "Review job before starting" (`12-job-review-1366.png`).
   - Tab cycles: Edit → Partial compiled summary → Controller facts → Machine facts → Cancel → **Start job** → the toast's Dismiss → Edit.
   - The three warning rows (with ⌄) are never reached, by Tab or by Shift+Tab → U7-P2-3 (`20-review-warning-expanded.png` shows one opened with the mouse).
9. **Start job** (Enter). The job runs. Focus is `<body>`.
   - **8 Tabs** reach ABORT JOB: status-bar group, Pricing, Terms, Privacy, Refunds, Edition, Pause, ABORT. The focus ring is visible on the red button (`21-abort-focused-after-tabs.png`).
   - The tree has `region "Live Motion"` → `group "Live machine controls"` → `button "Pause"`, `button "ABORT JOB"`.
10. **Pause** (Space). It sends 0x84; "JOB PAUSED". Focus falls to `<body>`, and the next Tab is **Resume** (`14-paused-1366.png`).
11. **Ctrl+.** sends 0x18; the bar clears. Rail: "Interrupted job saved · 84 of 88 lines" (`15-after-ctrl-period-abort.png`).
12. **Abort with a dialog open.** During a job, open Keyboard Shortcuts (`16-dialog-open-during-job.png`).
    - Tab reaches only **Close**, which is hidden under ABORT JOB → U7-P3-2 (`18-shortcuts-close-under-livemotion.png`).
    - Ctrl+. inside the dialog sends 0x18; the sim goes Run → Alarm. The dialog stays open, and "Alarm 3: Reset during motion…" is announced as `alert` (assertive) (`17-after-abort-in-dialog.png`).
13. **Screen reader during the job.** `__U7.llog` over 10 s of a 412-line job: 42 Live Motion changes and 11 status-bar ticks → U7-P2-1 (`22-running-flood.png`).
14. **Small screens.** Ready → Job Review → running, at each size (table under Verified clean): `s1366x768-*`, `s1366x768-125-*`, `s1366-125-browser-*`, `s1366-150-browser-*`, `s1280x720-*`. Start, Start job and ABORT JOB are in view and uncovered at every size. At 125 % and 150 % the Live Motion bar covers the rail's status text and Frame job (`s1366-150-browser-c-running.png`).
15. **Phone remote, 375 × 812.**
    - Design tab: the Abort dock shows with "Software stop through the PC…" (`30-phone-design-tab.png`).
    - Machine tab: "Running 37 % · Elapsed 1:35 · Remaining 2:40 · Pause" (`31-phone-machine-running.png`).
    - Tap **Pause** → "Paused … Resume", and `pause_job` was sent (`32-phone-paused.png`).
    - Tap **Abort** → `abort_job` was sent, with no confirmation; the card returns to "Run the job" (`33-phone-after-abort.png`).
    - Dark theme: `34-phone-dark-running.png`.
16. **Contrast**, measured in both themes on the ready workspace, Job Review, a running job and after Abort: `light-contrast-*.png`, `dark-contrast-*.png`, raw output `SCRATCH\contrast-light.json`, `contrast-dark.json`.

## Findings

### U7-P2-1 — During a job, the Live Motion line count and the status-bar elapsed tick talk over everything: about 5 polite announcements a second

- **Where:**
  - `src/ui/laser/LiveMotionBar.tsx:98-107`: `<div aria-live="polite">` wraps the heading, the "N / M lines · P%" detail, and the safety sentence.
  - `src/ui/workspace/canvas-motion-badge.tsx:9,27-33`: `role="status"` (implicitly atomic), re-rendered every `ELAPSED_TICK_MS = 1_000` with "Controller-reported • Run • Ns • 1500 mm/min".
  - Screen: the Live Motion bar and the status bar during any job.
- **What the user meets:** a screen-reader user starts a job. The reader then announces the new line count ("23 / 412 lines · 6%", "29 / 412 lines · 7%", …) about 4 times a second. Every second it adds "Controller-reported, Run, 1 s, 1500 mm/min". Polite announcements queue, and this queue grows faster than it can be spoken, so:
  - the user's own navigation (looking for ABORT JOB) is answered late, behind a backlog of numbers;
  - other polite messages (toasts such as "Frame complete", "Origin set") are buried.
- **Why it blocks:** the job is the moment the user must be able to find and press Abort. Assertive alarms still interrupt, but everything polite, including what the user is navigating, is drowned. Workarounds: Ctrl+. (known only from the Keyboard Shortcuts dialog), or muting the reader. P2, not P1: ABORT JOB is reachable and named, and Ctrl+. works.
- **Evidence (REPRO):** a 412-line job (`retireMs` 40), with live-region changes logged in the page for 10 s from Start.
  ```text
  total 55   Live Motion 42   status bar 11
  24192 [live/polite] JOB RUNNING 23 / 412 lines · 6% …
  24357 [live/polite] JOB RUNNING 29 / 412 lines · 7% …
  24518 [live/polite] JOB RUNNING 32 / 412 lines · 8% …
  24770 [live/polite] JOB RUNNING 35 / 412 lines · 8% …
  24922 [status/polite] Controller-reported • Run • 1s • 1500 mm/min
  ```
  The log coalesces changes at 150 ms, so 42 is a lower bound. Chromium sends the changed text node for the non-atomic Live Motion div, and the whole status for the atomic status. The 88-line job showed the same pattern at about 2 per second (`retireMs` 300).
- **Anchor:** WAI-ARIA APG and WCAG 4.1.3 (status messages should not interrupt; frequently updating content should be `aria-live="off"`, or announced on change of state). Twin: the phone remote's job card is not a live region (`machine-job.tsx:90-137`), and its toasts announce only events.
- **Fix direction:**
  - Move `aria-live` off the Live Motion status div. Add a separate visually hidden polite region that announces only state changes ("Job running", "Job paused", "Job aborted", "Job finished") and progress at most every 10 %.
  - Give the canvas-motion badge `aria-live="off"`, or drop `role="status"` while the job runs.
  - Test: mount `LiveMotionBar` with a streaming job that acks 100 lines and assert that the live region changed at most twice.

**Refuter (2026-11-03):** CONFIRMED **P2**, not P1. The rate is higher than reported. The "queue never drains, so the user can't find Abort" mechanism is wrong for NVDA: any keypress empties the queue.
- **Main's code.** No change since `19faee6f1` in the cited files (`git diff 19faee6f1 origin/main` is empty for them).
  - `LiveMotionBar.tsx:99`: `<div aria-live="polite">`, not atomic. The detail span (`:102`) is one text node: "N / M lines · P%" (`:377`).
  - `use-live-stream-progress.ts:30`: `REFRESH_MS = 120`. The line count republishes up to every 120 ms, so the cap is about 8 changes a second, not 4.
  - `canvas-motion-badge.tsx:28`: `role="status"` (implicitly polite and atomic). `:68` re-renders it every 1 s, and the elapsed seconds are in the text (`:258`).
- **Own REPRO** (`zz-u7r\zz-u7r-run.mjs` + `zz-u7r-live.js`, main `930630c3c`, host 4981). The logger records every MutationObserver batch, with no coalescing.
  - With fast acks (`retireMs` 40, the library design's 88-line job) the job finished in about 4.3 s. Live Motion changed 26 times in that time (every 125–160 ms, about 6.5 a second). The status-bar badge ticked every second, and "Frame expired…" was announced at the start (`run40.txt`).
  - With `retireMs` 300 there were 48 changes in 10 s: 33 Live Motion (one per acknowledged line), 13 status ticks, plus "Frame expired" and the pre-start notice (`run300.txt`).
  - So the rate follows the ack rate, up to the 120 ms cap. A dense raster acks far faster, so in a real burn the cap sets the rate.
- **What a real screen reader does.** NVDA source, pinned to tag `release-2024.4.2`:
  - `source/NVDAHelper.py:257-285`: a polite live-region change is queued as `speech.speakText(..., priority=Spri.NORMAL)`, so it waits behind earlier speech. Assertive gets `Spri.NEXT`.
  - `source/inputCore.py:165`: `speechEffectWhenExecuted = SPEECHEFFECT_CANCEL` by default. `:533-552`: executing a gesture queues `speech.cancelSpeech`.
  - `source/keyboardHandler.py:572-591`: an ordinary key such as Tab returns `SPEECHEFFECT_CANCEL`.
  - So while the user only listens, the backlog grows without limit: each "52 / 88 lines · 59%" takes over a second to speak and arrives every 0.12–0.3 s, so the progress heard is stale. But each Tab flushes the queue, and the newly focused control is spoken first. The user can still Tab to ABORT JOB and hear it named; the next number follows a moment later.
  - Polite toasts that land between keypresses are queued behind the numbers, or flushed unheard by the next key. That half of the claim stands.
  - WAI-ARIA 1.2 (REC 2023-06-06, https://www.w3.org/TR/2023/REC-wai-aria-1.2-20230606/, `aria-live`): polite updates are announced "at the next graceful opportunity", and an assertive change "may remove all currently queued changes". This matches the auditor's note that alarms still cut through.
  - JAWS and VoiceOver: UNVERIFIED. No pinned primary source was fetched.
- **Why not P1.** In my run ABORT JOB and Pause stayed named, in the tree and unignored (`region "Live Motion"` → `group "Live machine controls"` → `button "ABORT JOB"`). Ctrl+. inside a modal sent `0x18` (`run300.txt`), and NVDA's keypress flush means the flood can't stop the user from hearing the focused control.
- **Way out a user might find.** NVDA's "Report dynamic content changes" toggle (NVDA+5; `NVDAHelper.py:260` checks it) silences all live regions. That also silences the assertive alarms, so it is not a fix.
- **Why it is still P2.** A screen reader talks without pause through every burn, and other messages are lost. That misleads, and a beginner's way out (muting live regions) costs them the alarms.
- **Fix-direction note.** The atomic status badge needs the same fix as Live Motion: `aria-live="off"` while a run is ticking. Lines `:28` and `:68` together re-announce the whole sentence every second.

### U7-P2-2 — The first-visit welcome dialog opens with focus nowhere; Tab goes behind the modal, Enter works on hidden controls, Escape does nothing

- **Where:**
  - `src/ui/licensing/DesktopWelcomeDialog.tsx:41` (`initialFocus="surface"`) → `src/ui/common/use-dialog-a11y.ts:79` focuses the dialog on mount.
  - `src/ui/app/startup-splash.ts:43` has made `#app-root` `inert` while the splash shows, and `:36` removes it later without restoring the dialog's focus. Focusing inside an inert subtree is a no-op.
  - The dialog's Escape and Tab handler listens on the dialog node (`use-dialog-a11y.ts:104`), so keys pressed on `<body>` never reach it.
  - Screen: the browser's first visit, "Choose your workspace."
- **What the user meets:** the first screen of the app. A keyboard user presses Tab, and the focus ring lands on File, then Search, Open…, Import…, all behind the dimmed backdrop. Pressing Enter there acts on the hidden workspace. Escape does nothing.
- **Why it misleads:** it is the first thing a keyboard or screen-reader beginner meets. A screen reader announces menu items "behind" a modal dialog, and a hidden command (Open…) can be fired. The workaround is to press Shift+Tab, or Tab 57 times. P2: a plausible way out exists, and nothing burns.
- **Evidence (REPRO):**
  - Fresh profile, 1.5 s after the splash: `document.activeElement` = body, and `__U7.flog` = `[]` (no focusin since page start).
  - Tab ×57: every stop is reported `covered: div.lf-dialog-backdrop`. Tab 58: "Close and continue with Free [IN DIALOG]".
  - Tab ×3 then Enter on **Open…** → `__ZZ_OPENS = [{ types: [".lf2",".lbrn",".lbrn2"] }]`, a file open started behind the modal.
  - Escape → the dialog is still open. Shift+Tab ×1 → "Continue with Free" inside the dialog.
  - Accessibility tree: `dialog "Choose your KerfDesk workspace"` with `aria-modal="true"`.
  - Shots: `01-first-visit-1366.png`, `02-welcome-tab3-focus-behind-backdrop.png`.
- **Anchor:** the hook's own contract: "3. Initial focus lands on the first main control on mount" (`use-dialog-a11y.ts:1-13`). WCAG 2.4.3 Focus Order. Twin: every other kit dialog opened after start-up (Create artwork, Machine Setup, Job Review, Keyboard Shortcuts) received focus in the same runs.
- **Fix direction:**
  - In `releaseInput` (`startup-splash.ts:35-38`), after removing `inert`, re-run the topmost modal's initial focus (dispatch an event that `useDialogA11y` listens for, or focus `[role=dialog][aria-modal=true]:last-of-type`).
  - Or have `BrowserDesktopWelcome` mount the dialog only after the splash is gone.
  - Test: mount with `#app-root[inert]`, then release it, and assert that `activeElement` is inside the dialog.

**Refuter (2026-11-03):** CONFIRMED **P2**. It is a little worse than reported: a screen reader is not told the dialog is modal either.
- **Main's code.**
  - `BrowserDesktopWelcome.tsx:46-51` opens the dialog 700 ms after mount.
  - `startup-splash.ts:2` keeps the splash at least 4000 ms, with `#app-root` `inert` (`:43`), so the dialog always mounts inert.
  - `Dialog.tsx:50-59` renders the dialog inside `#app-root`, not in a portal.
  - `use-dialog-a11y.ts:79`'s `focus()` is a no-op. `recover-dialog-focus.ts:9` then records `focused = null`, so the recovery observer (`:20`) never steps in.
  - `releaseInput` (`startup-splash.ts:35-38`) only removes `inert`.
  - The Escape and Tab handler sits on the dialog node (`use-dialog-a11y.ts:104`).
- **Own REPRO** (`zz-u7r-run.mjs welcome`, `welcome.txt`, `welcome-ax.txt`):
  - `dialogMountedWhileInert true`. After the splash: `inert` is gone, `activeElement` = BODY, and there were no focusin events.
  - Tab 1–3 → `summary "File"`, `button "Find a command"`, `button "Open..."`. All three are outside the dialog and covered by `lf-dialog-backdrop`.
  - Escape → the dialog is still open.
  - Enter on Open… → `__ZZ_OPENS` got one call (`.lf2/.lbrn/.lbrn2`), and the welcome dialog stayed open behind the picker.
- **Worse.** Chromium's own accessibility tree (CDP `Accessibility.getFullAXTree`) keeps the whole workspace while the dialog shows: `button "Open..." ignored=false`, `menuitem "File" ignored=false`, 419 unignored nodes. Chromium did not prune for the kit's `aria-modal="true"` in either of my runs: here with focus on `<body>`, and in U7-P3-3's check with focus inside Keyboard Shortcuts. So with focus on `<body>`, nothing tells a reader a modal is open. Unless the reader itself enforces `aria-modal`, browse mode reads the workspace as if no dialog were there.
- **Can the file pick behind the dialog lose work?** No.
  - It only happens on a first visit (`BROWSER_WELCOME_KEY` not yet `dismissed`, `BrowserDesktopWelcome.tsx:11-17`), so the canvas is empty. Cancelling the picker changes nothing.
  - A dialog the user requests later from the edition button opens with a focused opener and no `inert`, so it gets focus normally.
  - Nothing moves the machine.
- **Way out.** Shift+Tab from `<body>`, a click, or about 58 Tabs. A keyboard beginner may plausibly try Shift+Tab, so P2, not P1.

### U7-P2-3 — Job Review's warning details can't be opened by keyboard: the dialog's Tab trap skips `<summary>`

- **Where:**
  - `src/ui/common/use-dialog-a11y.ts:33-40`: `FOCUSABLE_SELECTOR` has `button`, `a[href]`, `input`, `select`, `textarea` and `[tabindex]`, but not `summary`.
  - `trapTabWithin` (`:135-151`) sends Tab from the surface, and Shift+Tab from the first match, to the first or last match.
  - `src/ui/laser/job-review/JobReviewWarnings.tsx:102-108`: each warning is `<details><summary title="Show details">`, placed before the dialog's first button ("Edit").
- **What the user meets:** Job Review shows "3 warnings · none block the start", with rows cut short by "…" and a ⌄. Keyboard focus starts on the dialog, and the first Tab jumps to **Edit** in Settings. Shift+Tab from Edit jumps to **Start job**. The warning rows are never focused, so their details can't be opened.
- **Why it misleads:** the hidden halves carry the advice, which only the mouse can reveal:
  - "Operation … is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass). **Run a material test on scrap before burning final material.**"
  - "The canvas is artwork-relative; **physical bed position and no-go-zone clearance must be checked at the machine.**"
  - "…narrowest 0.03 mm. **Ignore this if the layer scores or engraves.**"

  A sighted keyboard-only beginner reads only the truncated lines on the one screen meant to check the job before Start. A screen reader in browse mode can still expand them. P2: it misleads, and a mouse is the workaround.
- **Evidence (REPRO):**
  - Tab ×8 from the surface: `Edit → Partial compiled summary → Controller facts → Machine facts → Cancel → Start job → Edit → …`. Shift+Tab from Edit: `Start job → Cancel`.
  - The DOM has 6 `summary` elements in the dialog, none with `tabindex`. The three warning summaries are before the first `FOCUSABLE_SELECTOR` match.
  - The detail texts above were read with `textContent` from the closed `<details>`.
  - Shot: `20-review-warning-expanded.png` (opened by mouse).
- **Anchor:** the hook's contract "Tab / Shift+Tab cycle within the dialog" (`use-dialog-a11y.ts:6`). WCAG 2.1.1 Keyboard. Twin: the later summaries in the same dialog (Controller, Machine) are reached, because native Tab moves between the edges.
- **Fix direction:**
  - Add `'details > summary:first-of-type'` to `FOCUSABLE_SELECTOR`, and skip summaries nested inside a closed ancestor `<details>` (they are not rendered).
  - Test: Job Review with warnings, Tab from the surface → the first warning summary; Space → `open`.
  - Every kit dialog with a leading `<details>` benefits.

**Refuter (2026-11-03):** CONFIRMED **P2**.
- **Main's code.**
  - `use-dialog-a11y.ts:33-40` has no `summary` in its selector.
  - `trapTabWithin` (`:135-151`) redirects Tab from the surface, or from the last match, to the first match, and Shift+Tab from the surface, or from the first match, to the last match.
  - `JobReviewWarnings.tsx:102-109` renders `<details><summary>` with no `tabindex`.
- **Own REPRO** (`zz-u7r-run.mjs run`, Job Review opened with Ctrl+Enter, `run40.txt`):
  - DOM order of the dialog's natively focusable elements: warning summaries at positions 0, 1 and 2, then **Edit** at 3 (the first `FOCUSABLE_SELECTOR` match).
  - Tab ×9 from the surface: `Edit → Partial compiled summary → Controller → Machine → Cancel → Start job → Dismiss (toast) → Edit → …`.
  - Shift+Tab ×9 from Edit: `Dismiss → Start job → Cancel → Machine → Controller → Partial → Edit → Dismiss …`.
  - No warning summary is ever focused, in either direction.
  - Hidden details, read from the DOM: "The canvas is artwork-relative; physical bed position and no-go-zone clearance must be checked at the machine." / "…Run a material test on scrap before burning final material." / "…Ignore this if the layer scores or engraves."
- **Way out.** The headlines stay visible, so the user knows there are warnings, but not what to do about them. A screen reader's browse mode can expand a `summary`, and a mouse can.
- **Not P1.** Nothing blocks Start that should not. The physical risk the hidden text describes (bed position, no-go zones) belongs to other findings.

### U7-P3-1 — Focus falls to `<body>` after Set origin here, Frame job, Start job and Pause

- **Where:** the pressed button becomes disabled or is replaced while focused:
  - Frame job, `JobActionControls.tsx:168` `disabled={model.frameControl.disabled}`;
  - Pause → Resume in `LiveMotionBar.tsx` `LiveMotionPrimaryAction`;
  - Job Review closes on Start job, and its opener (Start) is then disabled;
  - Set origin here.
- **What the user meets:** after each of these actions `document.activeElement` is `<body>`. The focus log shows `out button "Declare the current head position…" -> null` and `out "Trace the job's generated motion envelope…" -> null`. In Chrome the next Tab still continues from the old place (8 Tabs to ABORT after Start; 1 to Resume after Pause), so sighted keyboard users get by. A screen reader announces nothing and loses its place.
- **Fix direction:** keep focus on a stable control. Move focus to the Live Motion bar's primary action when a job starts, and to Resume after Pause. Use `aria-disabled` rather than `disabled` for buttons that are focused while they flip.

**Refuter (2026-11-03):** CONFIRMED P3.
- REPRO (`zz-u7r-run2.mjs`, `focus.txt`):
  - Enter on **Start job** → `activeElement` BODY.
  - Space on a focused **Pause** → BODY, and the next Tab → **Resume**.
- READ: `JobActionControls.tsx:168` disables Frame job while it is focused.
- `recover-dialog-focus.ts` only repairs focus inside a modal, so the workspace has no equivalent.

### U7-P3-2 — The fixed Live Motion bar hides focused controls and dialog footers at laptop heights

- **Where:** `LiveMotionBar.tsx:394-398` (`position: fixed; bottom: 34; z-index: MAXIMUM_STACKING_ORDER`, 720 px wide).
- **What the user meets:**
  - **1366 × 768:** during a job, the Keyboard Shortcuts dialog's **Close** (904, 707) is under ABORT JOB. The focused Close is fully hidden (`covered: button.lf-btn lf-btn--danger`; `18-shortcuts-close-under-livemotion.png`).
  - 10 workspace Tab stops are hidden under the bar while it shows: Toggle snapping, Snap settings, start markers, Zoom out/fit/in, Fit to selection, Fit to bed, Add sheet, Manage sheets.
  - **125 % and 150 %:** the bar also covers the rail's job status and Frame job, and at 150 % most of the rail's lower half, including the feed and power overrides (`s1366-150-browser-c-running.png`).
- **Why:** WCAG 2.2 SC 2.4.11 Focus Not Obscured. A mouse user can't click a dialog's Close during a job; Escape still works. P3: nothing safety-relevant is lost, and ABORT JOB itself is always on top.
- **Fix direction:** reserve the bar's height as a bottom inset (as the phone app does with `--abort-dock-height`, `MachineScreen.tsx:257-274`). Raise dialogs' `max-height` and the workspace panels above it while it shows.

**Refuter (2026-11-03):** CONFIRMED P3.
- REPRO (`run300.txt`): during a job at 1366 × 768, Keyboard Shortcuts opened with focus on `button "Close"`, and its centre is covered by `lf-btn lf-btn--danger` (ABORT JOB).
- Escape still closes the dialog, and ABORT JOB stays on top, so P3.

### U7-P3-3 — ABORT JOB and Pause don't name their keyboard shortcut; with a dialog open, Ctrl+. is the only keyboard and screen-reader route

- **Where:** `LiveMotionBar.tsx:110-118`. The title is "Request the controller-specific abort or reset command…", with no "Ctrl+.", no `aria-keyshortcuts`, and the same for Pause.
- **What the user meets:**
  - During a job with any modal open, Tab is trapped in the dialog: only "Close" in Keyboard Shortcuts. `aria-modal="true"` also hides the Live Motion bar from a screen reader's browse mode.
  - Ctrl+. works there (REPRO: 0x18 sent from inside the dialog). But the only place that says so is the last section ("Laser") of the Keyboard Shortcuts dialog, below the fold at 1366 × 768.
  - PROJECT non-negotiable 9 ("No modal can block it") is met for the mouse and for Ctrl+., not for Tab.
- **Fix direction:**
  - Add `aria-keyshortcuts="Control+Period"`, and " (Ctrl+.)" to the ABORT title and the Live Motion safety line.
  - Optionally, admit the Live Motion group to every dialog's Tab cycle while it is shown. Today `trapTabWithin` filters to the dialog node.

**Refuter (2026-11-03):** CONFIRMED P3. One sub-claim is refuted.
- **Confirmed.**
  - `SOFTWARE_ABORT_TITLE` (`src/ui/common/software-abort-copy.ts`) has no shortcut.
  - There is no `aria-keyshortcuts` in `LiveMotionBar.tsx`. Twin: `CommandSearchButton.tsx:21` does set `aria-keyshortcuts`.
  - Tab is trapped to the dialog (`use-dialog-a11y.ts:135-151`).
  - Ctrl+. from inside Keyboard Shortcuts sent `0x18` (`run300.txt`).
- **Refuted: "`aria-modal="true"` also hides the Live Motion bar from a screen reader's browse mode."** With Keyboard Shortcuts open and focus inside it, Chromium's tree (CDP `Accessibility.getFullAXTree`) has `ABORT JOB ignored=false` and `Pause ignored=false`. Chromium does not prune for the kit dialog's `aria-modal`. A reader that enforces `aria-modal` itself may still hide them; that was not tested.
- Either way, the bar stays reachable for the mouse, Ctrl+. and (in Chromium's tree) browse mode, so P3.

### U7-P3-4 — Dark theme: the copper focus ring is 2.79 : 1 on ~15 control families

- **Where:** `tokens.css:141-142` keeps `--lf-accent` (#a85a2a) in dark. These rules draw focus with it:
  - `tutorial-button.css:23-24` (Learn);
  - `canvas-start-points.css:41-42` (Frame start, Job start);
  - `desktop-welcome.css:245-247`;
  - `tutorials.css:36-39`;
  - `artwork-run-order.css:304-305, 336-337`;
  - `laser-operation-settings.css:385-387`;
  - `material-library-panel.css:41-42`;
  - `LaserWindow.css:220-221`;
  - `Toolbar.css:176-178`;
  - `ConnectionBar.css:46-51`;
  - `WorkspaceLayoutSelect.css:31-35`;
  - and others.
- **Evidence (REPRO):**
  - Tab walk of all 87 stops in dark: "Learn", "Frame start" and "Job start" have the ring `rgb(168, 90, 42)` at **2.79 : 1** against the bar. The global ring `--lf-focus` (#90bfff) passes.
  - In light, every stop passes (5.2–5.67 : 1 blue, 4.4–4.93 : 1 copper).
- **Fix direction:** use `var(--lf-focus)` for every focus outline, or add a dark `--lf-focus-accent` ≥ 3 : 1 (for example #e39a63, which is `--lf-accent-fg` in dark). WCAG 1.4.11.

**Refuter (2026-11-03):** CONFIRMED P3, with a scope note.
- READ:
  - The dark block `tokens.css:143-` does not re-declare `--lf-accent` (comment `:138-142`).
  - 17 `outline: … var(--lf-accent)` rules in 16 CSS files on main, including `tutorial-button.css:24` and `canvas-start-points.css:42`.
- Computed:
  - #a85a2a on dark `--lf-bg-0`/`--lf-bg-2` (#2e2b27) = **2.79 : 1**, a fail.
  - On `--lf-bg-1` (#252320) = 3.11 : 1, a narrow pass.
  - So the miss is on bg-0/bg-2 surfaces (toolbars, bars), not everywhere.
  - #e39a63 on #2e2b27 = 6.08 : 1, so the suggested fix works.

### U7-P3-5 — Dark theme: disabled buttons look enabled

- **Where:** `tokens.css:155` (dark `--lf-text-faint` = `--lf-text-muted` = #b3aca1) with `.lf-btn:disabled` (`:222-227`): same fill and same border as enabled.
- **Evidence (REPRO, computed):**

  | | Light | Dark |
  |---|---|---|
  | Disabled `.lf-btn` | #726c63 on #faf9f7 | #b3aca1 on #252320, **6.96 : 1** |
  | Enabled `.lf-btn` | #2b2823, 13.95 : 1 | #ece7df, 12.73 : 1 |
  | Fill and border | identical | identical |

  In dark, "Artwork centre & LED" (disabled) sits beside "Set up LED" (enabled) and reads the same (`dark-contrast-ready.png`).
- **Fix direction:** in dark, give disabled `.lf-btn` a dimmer text (about 3 : 1) and a dashed or lighter border, or `opacity: .55`. The hover reason (title) already explains why.

**Refuter (2026-11-03):** CONFIRMED P3.
- READ: dark `--lf-text-faint` = `--lf-text-muted` = #b3aca1 (`tokens.css:154-155`). `.lf-btn:disabled` (`:222-227`) sets only colour, `--lf-bg-1` and `--lf-border`.
- Computed: 6.96 : 1 for disabled against 12.73 : 1 for enabled text.
- The button stays inert, so this is polish.

### U7-P3-6 — The canvas's name is not exposed, and nothing points a screen-reader user to the Objects list

- **Where:** `src/ui/workspace/WorkspaceCanvasLayers.tsx:56`, `aria-label="KerfDesk workspace"` on a `<canvas>` with no role.
- **Evidence (REPRO):** the name "KerfDesk workspace" does not appear anywhere in `ariaSnapshot` (`canvasInTree: false`). Chromium ignores `aria-label` on a role-less canvas. The working alternative is `list "Design object tree"` (Objects panel), where each object is a pressed or unpressed button, with Rename and Move. Nothing names it as the canvas's text alternative.
- **Fix direction:** `role="img"` with `aria-describedby` → "N objects; use the Objects list (…) to select", or `role="application"` with that description. L8 recorded the label as present (READ); the browser doesn't expose it.

**Refuter (2026-11-03):** REFUTED.
- **The name is exposed.** Chromium's own accessibility tree (CDP `Accessibility.getFullAXTree`, `zz-u7r-run.mjs canvas`, `canvas.txt`) has `Canvas "KerfDesk workspace" ignored=false`.
- **Why the auditor missed it.** Playwright's `ariaSnapshot` is a reduced YAML view that does not print Chromium's `Canvas` role. It is not Chromium's tree, so `canvasInTree: false` was a tool artefact. L8's READ was right.
- **The remaining half** ("nothing points to the Objects list") is a suggestion, with no failure scenario beyond U7-P3-10. It is folded there.

### U7-P3-7 — Status-bar messages are cut off at 1366 px and below

- **Where:** `src/ui/common/status-bar.css:39` (`white-space: nowrap`), 11 px text.
- **Evidence (REPRO):** these messages are cut off:
  - 1366 × 768: "Relative view — physical bed p…" (`12-job-review-1366.png`), and during a job "Controller-reported • Run • 1r…";
  - 125 %: "Bed: 400 × 40…";
  - 150 %: "Devic…".

  The full text is only in `title` or `aria-label`. The contrast itself is fine (11 px, 5.03 : 1 light, 6.26 : 1 dark).
- **Fix direction:** let the motion or bed status take the space of the policy links (Pricing / Terms / Privacy / Refunds) below 1440 px, or wrap to two lines.

**Refuter (2026-11-03):** CONFIRMED P3, with the mechanism corrected.
- **Where the clipping comes from.** `status-bar.css:39` is the *policy links'* `nowrap`. The messages are clipped by the telemetry group:
  - `StatusBar.tsx:42-49`: `role="group"`, `tabIndex={0}`, "Workspace status details";
  - `status-bar.css:3-13`: horizontal scroll with the scrollbar hidden;
  - each segment is `nowrap` (`StatusBar.tsx:182`, and `canvas-motion-badge.tsx:286`).
- **The full text is reachable (READ, not re-run).** Tab to "Workspace status details", then → scrolls it (`StatusBar.tsx:89-92` keeps the arrow keys for scrolling), and a screen reader reads the whole text. So the auditor's "only in `title` or `aria-label`" is wrong.
- **Still P3.** Nothing on screen shows that the line scrolls.

### U7-P3-8 — Phone remote polish at 375 px

- **Where:** the phone app, main's build (step chips: `services/remote-control/app/src/ui/machine-jog.tsx:36`).
- **Evidence (REPRO):**
  - **Design tab:** the floating tool rail sits over the "Artwork sharing is off" notice and cuts its first words ("…s show where artwork is…"; `30-phone-design-tab.png`).
  - **Machine tab:** the step and speed chips are 40 px tall (0.1 / 1 / 10 / 50 mm, PC speed / 1k / 3k / 6k). ADR-582 item 7 promises "48 px touch targets". They are above WCAG 2.5.8's 24 px.
  - **Dark theme:** the "Laser" chip is #5b9bef on #2b3440, **4.42 : 1** at 12.5 px (`34-phone-dark-running.png`).
- **Fix direction:** offset the notice by the rail's width; use 48 px chips; lighten the dark info chip text.

**Refuter (2026-11-03):** CONFIRMED P3.
- READ:
  - `services/remote-control/app/src/ui/app.css:1276-1278`: `.steps button { min-height: 40px }`.
  - ADR-582 item 7 (`docs/decisions/ADR-582-kerfdesk-remote-app-experience.md:15`) "keeps 48 px touch targets".
- Computed: #5b9bef on #2b3440 = 4.42 : 1.
- The notice overlap was not re-run (no phone host started; READ-only for that item).

### U7-P3-9 — Two small light-theme text misses in Job Review

- **Evidence (REPRO, computed):** both pass in dark (6.11 : 1 and above).
  - "· none block the start": 12 px #926936 on #faf2e4 = **4.38 : 1**. It is the `opacity: 0.85` span in the warnings heading, `JobReviewWarnings.tsx:53`.
  - The "ESTIMATED TIME" tile label: 10 px #726c63 on #eaeff5 = **4.50 : 1**, on the line.
- **Fix direction:** drop the opacity; use `--lf-text-muted` for the tile labels.

**Refuter (2026-11-03):** CONFIRMED P3.
- Computed from the auditor's blended colours: #926936 on #faf2e4 = 4.40 : 1, and #726c63 on #eaeff5 = 4.50 : 1. The second is a pass on the line, so in practice only the first is a miss.
- READ: `JobReviewWarnings.tsx:53` is the hint span.

### U7-P3-10 — The draw tools have no keyboard route, and don't say so

- **Where:** `Draw rectangle / ellipse / polygon / star / polyline` and `Text` in the tool strip. The canvas is not focusable (`tabindex` null).
- **What the user meets:** Enter on **Draw rectangle** shows it pressed (`button "Draw rectangle" [pressed]`), and then nothing can be drawn. The keyboard routes to a first design are:
  - Design Library → Add;
  - Create artwork → Parametric part;
  - Import (Ctrl+I);
  - then arrows to move, and the X / Y / W / H / R fields to place and size.

  None of them is mentioned when a draw tool is armed by keyboard. LightBurn's drawing is mouse-only too (P3).
- **Fix direction:** when a draw tool is activated by keyboard, insert a default-size shape at the bed centre (or open the Numeric Edits fields focused on W), and say so in the tool's title.

**Refuter (2026-11-03):** CONFIRMED P3.
- REPRO (`canvas.txt`): the canvas has no `tabindex`. The titles say only "Draw a rectangle by dragging on the workspace…" and "Draw an ellipse or circle by dragging…".
- The keyboard routes the auditor lists exist, and LightBurn is mouse-only too.
- This finding absorbs U7-P3-6's remaining half (point screen-reader users to the Objects list).

## KNOWN re-observed

- **U2 (step 3): toasts sit over a dialog's title.**
  - Machine Setup at 1366 × 768 and at 125 %: "Background streaming is unavailable…" and "Machine settings detected…" cover the dialog's header (`06-after-connect-enter.png`, `40-setup-1093x508.png`).
  - Job Review at 125 %: "Frame complete" sits inside its top (`s1366-125-browser-b-review.png`).
- **U4-P3-3: "Frame expired — … Frame the job again."** It is shown during a normal run, and is also *announced* (polite) at every job start (`llog` 21546).
- **U4-P2-3: "Alarm 3: Reset during motion … Re-home the machine ($H)" after every Abort** on stock GRBL. It is announced `alert` (assertive). Re-observed with Ctrl+. inside a dialog.
- **U6-P3-2: the Keyboard Shortcuts dialog is the only place that lists Ctrl+. and Ctrl+Enter.** See U7-P3-3 for the during-a-job consequence.
- **Rolling v2 27-P2-1 (Ctrl+. swallowed by modals): fixed on main.** `use-job-shortcuts.ts:40-47` listens in the capture phase. REPRO: Ctrl+. from inside Keyboard Shortcuts during a job sent 0x18.

**Refuter (2026-11-03), KNOWN items on main `930630c3c`:**
- **U2 toasts over a dialog:** not re-run. A toast's Dismiss sits inside Job Review's Tab cycle (my Tab walk), which fits the toast layer being drawn over the dialog.
- **U4-P3-3:** CONFIRMED. "Frame expired — The controller session, position, origin…" was announced (`status`, polite) about 190–250 ms after Start in both of my runs.
- **U4-P2-3:** not re-run (Alarm 3 after Abort). My Ctrl+. sent `0x18`, then `M5`, `M9`.
- **U6-P3-2:** CONFIRMED by READ. Ctrl+. is named in no title or `aria-keyshortcuts` on the Live Motion bar.
- **27-P2-1 fixed:** CONFIRMED. Ctrl+. from inside Keyboard Shortcuts during a job sent `0x18` (`run300.txt`).

## Refuted

These candidates were dropped by the auditor.

- **"The Machine side-panel tab can't be reached by Tab."** It is a WAI-ARIA tablist (`tablist "Side panel"`, roving `tabindex`). → on the focused Artwork tab selects and focuses Machine. This is the standard pattern, so it is not a finding.
- **"ABORT JOB needs ~80 key presses after Start."** The 77 / 82 counts came from a blurred `<body>`. From the real post-Start position (keyboard Start), ABORT JOB is **8 Tabs** away (`21-abort-focused-after-tabs.png`).
- **"Start or Abort is cut off on a 1366 × 768 laptop."** Neither is cut off at any size tried (see Verified clean).

**Refuter (2026-11-03):** all three refutations stand.
- **Machine tab:** the standard roving-tabindex tablist.
- **ABORT JOB:** reached in 8 Tabs. Not re-counted, but my Enter-on-Start-job run left focus on BODY with Chrome's sequential start point kept, as the auditor describes (`focus.txt`).
- **Start or Abort cut off:** `LiveMotionBar.tsx:42`, `MAXIMUM_STACKING_ORDER`. At 1366 × 768 ABORT JOB was on top of a dialog's Close (U7-P3-2).

## Verified clean

- **Keyboard first burn, end to end:**
  - menus (File summary; ←/→ between menus, ↓ into items, Escape back);
  - Create artwork, the Design Library, Ctrl+A, the arrow-key nudge, the W field;
  - Connect → Machine Setup (each step's heading takes focus, Next / Save are reachable);
  - Set origin, Frame, Ctrl+Enter or Start → Job Review, Start job, Pause (Space), Resume, ABORT JOB, Ctrl+.
- **Dialogs return focus:** Create artwork → its button, Keyboard Shortcuts → its button, Job Review (Escape) → its opener (the Keyboard Shortcuts button when opened by Ctrl+Enter from there), Machine Setup → the connection button.
- **Focus visible:** all 87 workspace Tab stops in light have an outline ≥ 4.4 : 1. In dark, everything except U7-P3-4 passes. ABORT JOB's ring shows on red.
- **Names and roles:** no unnamed button, textbox, combobox, slider, checkbox, tab or link in the ready workspace, the Artwork panel, Job Review, the running job, or Machine Setup. The landmarks are:
  - `region "Job actions"` with `status` "Ready to start — …";
  - `region "Live Motion"` with `group "Live machine controls"`;
  - `contentinfo "Status bar"`;
  - `list "Design object tree"`.
  - The Job Review dialog is named "Review job before starting". Alarm banners are `role="alert"`, and toasts are in a polite region.
- **Contrast**, apart from U7-P3-4/5/9:
  - status bar 11 px: 5.03 : 1 light, 6.26 : 1 dark;
  - Start: white on #a85a2a, 5.05 : 1;
  - ABORT JOB: white on #b43337, 6.05 : 1;
  - "JOB RUNNING": 6.88 / 7.91 : 1;
  - warnings heading: 6.08 / 7.8 : 1;
  - Alarm 3 text: 6.3 / 7.05 : 1.
- **Small screens.** In every configuration Start, Job Review's Start job and the bar's ABORT JOB were in view, unclipped and uncovered. Job Review's body scrolls, and its footer stays fixed:

  | Configuration | CSS viewport | DPR | Job Review body (scroll / client) |
  |---|---|---|---|
  | 1366 × 768 | 1366 × 768 | 1 | 697 / 697 |
  | 1366 × 768 at 125 % (full) | 1093 × 614 | 1.25 | 697 / 585 |
  | 1366 × 768 browser, 125 % | 1093 × 508 | 1.25 | 697 / 489 |
  | 1366 × 768 browser, 150 % | 911 × 423 | 1.5 | 697 / 413 |
  | 1280 × 720 | 1280 × 720 | 1 | 697 / 680 |

  Machine Setup at 1093 × 508 keeps Next and Cancel in view.
- **Phone remote, 375 × 812:**
  - The Abort dock is on every tab (Design, Machine), with a 56 px-tall full-width button (`app.css:793-795`).
  - Pause and Resume are on Machine; neither, nor Abort, asks for confirmation.
  - All controls are named. The toasts region is `aria-live="polite"`, with errors as `role="alert"`.
  - Light contrast passes everywhere except the disabled Start (2.67 : 1, exempt).

## Not verified

- **Real screen readers** (NVDA, JAWS, Narrator, VoiceOver, TalkBack). Only Chromium's accessibility tree and live-region DOM changes were read. How fast a reader drains the U7-P2-1 queue was not measured.
- **The phone's Slide-to-start for screen-reader users.** It is `role="slider"` and confirms only on Enter / Space or a full drag (`machine-job.tsx:218-269`). Whether VoiceOver or TalkBack can operate it was not tested; starting from the phone is outside U7's "pause and stop".
- **Phone feedback after Abort or Pause with a real relay.** The stand-in has no WebSocket, so the "The job stopped. Check the machine." event toast was not seen. With polling only, nothing is announced on success.
- **The desktop app (Electron),** Windows High Contrast / `forced-colors`, `prefers-reduced-motion`, and 200 % zoom reflow.
- **Hardware.** None was operated.

## Rebuild and re-run

1. `git archive --format=tar 19faee6f1 src public scripts electron index.html package.json tsconfig.json vite.config.ts website docs/licensing` → `SCRATCH\tree`.
2. Junction `tree\node_modules` → the main checkout's `node_modules`. Copy `zz-s3\zz-s3-vite.config.ts` → `tree\zz-u7-vite.config.ts`.
3. `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u7-vite.config.ts --outDir ../dist --emptyOutDir` (3 min 49 s here).
4. Start the servers: `node zz-u7-host.mjs dist 4971`, `node zz-u7-drive.mjs` (4972), `node zz-u7-phone-host.mjs 4973`. The phone host needs `SCRATCH\remote\` (`git archive 19faee6f1 services/remote-control/app services/remote-control/public/app services/remote-control/src`).
5. Bodies: `zz-u7-setup.js` (clean profile → library design → Connect → Setup Save → Set origin → Frame), then `zz-u7-small.js` (sizes) or `zz-u7-contrast.js` (themes), posted with `sh zz-u7-d.sh`. Set `globalThis.U7 = { tag, viewport, dsf, theme, retireMs }` first.
6. Cleanup: `tree` and `dist` were deleted after the run. The junction was removed first with `cmd /c rmdir`.

## Refuter summary

**Refuter:** fresh agent, 2026-11-03.

**Tree.** origin/main @ `930630c3c`. Since the audited `19faee6f1`, main has merged only #1556 (SVG white fills, U3-P2-2). None of the files cited here changed.

**Evidence.**
- **Build.** One production bundle from `git archive origin/main` was built into `zz-u7r\dist` and served by `zz-u7r-host.mjs` on 4981 (repo COOP/COEP/CSP).
- **Driver.** `zz-u7r-run.mjs` / `zz-u7r-run2.mjs` run Playwright 1.61.1 in installed Chrome, from a clean context each run. The machine is the auditor's GRBL simulator and fake Web Serial port (`zz-u7\zz-u7-sim.js`).
- **Live-region logger.** `zz-u7r-live.js` is my own and is not coalesced: every MutationObserver batch, per outermost live region, with politeness and atomicity.
- **Accessibility tree.** Read from Chromium's own tree (CDP `Accessibility.getFullAXTree`), not from Playwright's `ariaSnapshot`.
- **Outputs.** `welcome.txt`, `welcome-ax.txt`, `run40.txt`, `run300.txt`, `focus.txt`, `canvas.txt`, all in `SCRATCH\..\zz-u7r\`.
- **Sources.**
  - NVDA, `nvaccess/nvda` at tag `release-2024.4.2`: `source/NVDAHelper.py`, `source/inputCore.py`, `source/keyboardHandler.py`.
  - WAI-ARIA 1.2 REC 2023-06-06.
  - Both were fetched as text into `zz-u7r\src`.
- **Cleanup.** The host was stopped, the junction removed with `cmd /c rmdir`, then `tree` and `dist` were deleted.
- No phone host was started, no hardware was used, and nothing was installed.

**Result.** P1 0 / P2 3 / P3 9. Confirmed 12, refuted 1, severity changes 0.

| ID | Verdict | Reason |
|---|---|---|
| U7-P2-1 | CONFIRMED P2 | Both regions are live: `aria-live="polite"` (`LiveMotionBar.tsx:99`) and `role="status"` (`canvas-motion-badge.tsx:28`). Both change text on every tick. The rate is up to about 8 a second (`REFRESH_MS = 120`), not 4: I measured 26 changes in about 4.3 s on a fast job, and 48 in 10 s on a slow one. Not P1: NVDA queues polite speech but cancels it on every keypress (`inputCore.py:165,533-552`, `keyboardHandler.py:572-591`). ABORT JOB is named and Tab-reachable, and Ctrl+. sent `0x18` from inside a modal. |
| U7-P2-2 | CONFIRMED P2 | Reproduced: the dialog mounts inert, focus stays on BODY, Tab goes behind the backdrop, Escape does nothing, and Enter on Open… opens the picker. Worse: Chromium's tree keeps the workspace unignored. No work can be lost: it is a first visit with an empty canvas, and the picker can be cancelled. |
| U7-P2-3 | CONFIRMED P2 | The selector has no `summary`. The three warning summaries come before Edit in DOM order and are never focused by Tab or Shift+Tab. |
| U7-P3-1 | CONFIRMED P3 | Start job and Pause leave focus on BODY. |
| U7-P3-2 | CONFIRMED P3 | The focused Close in Keyboard Shortcuts is covered by ABORT JOB at 1366 × 768. |
| U7-P3-3 | CONFIRMED P3 | No shortcut is named. Refuted sub-claim: Chromium does not hide the Live Motion bar behind the kit's `aria-modal`. |
| U7-P3-4 | CONFIRMED P3 | 2.79 : 1 on bg-0/bg-2, and 3.11 : 1 on bg-1. |
| U7-P3-5 | CONFIRMED P3 | — |
| U7-P3-6 | **REFUTED** | Chromium exposes `Canvas "KerfDesk workspace"`. `ariaSnapshot` just doesn't print the canvas role. |
| U7-P3-7 | CONFIRMED P3 | Mechanism corrected: the line is clipped by the hidden-scrollbar telemetry group, and the text is reachable by keyboard scroll. |
| U7-P3-8 | CONFIRMED P3 | READ and computed. The overlap was not re-run. |
| U7-P3-9 | CONFIRMED P3 | The "Estimated time" label is exactly 4.50 : 1, so only the hint span is a miss. |
| U7-P3-10 | CONFIRMED P3 | Absorbs U7-P3-6's remaining half. |

**New, for the coordinator (not raised as a separate finding).**
- **The kit `Dialog`'s `aria-modal` has no effect in Chromium's accessibility tree.**
  - In both of my runs, content outside the dialog stayed unignored: the welcome dialog with focus on `<body>`, and Keyboard Shortcuts with focus inside.
  - This is what keeps ABORT JOB reachable in browse mode during a modal, which is good for non-negotiable 9.
  - It also means every modal in the app relies on the reader's own `aria-modal` support to stop browse mode wandering behind it.
  - It touches U7-P2-2 and U7-P3-3, and any fix that adds `inert` to the workspace behind modals must exempt the Live Motion bar.
- **The live-region flood starts before the job.** "MACHINE OPERATION Verifying live controller state before Start…" and the U4-P3-3 "Frame expired" both arrive in the first 250 ms after Start job. So the first thing a screen-reader user hears after Start is that their Frame expired.

```json
[
  {"id":"U7-P2-1","severity":"P2","refuter":"CONFIRMED P2 (rate up to ~8/s via REFRESH_MS 120; NVDA flushes its speech queue on every keypress, so ABORT JOB stays findable; not P1)","area":"accessibility-small-screens","file":"src/ui/laser/LiveMotionBar.tsx","line":99,"anchor":"WCAG 4.1.3 / APG live regions; twin phone job card not live (machine-job.tsx:90)","evidence":"REPRO","known":false,"summary":"During a job the Live Motion line count (aria-live polite) and the status-bar elapsed tick (role=status, 1 s) produce ~5 polite announcements/s (55 in 10 s); a screen reader's queue never drains, burying navigation to ABORT JOB"},
  {"id":"U7-P2-2","severity":"P2","refuter":"CONFIRMED P2 (also: Chromium AX tree keeps the workspace unignored behind the dialog)","area":"accessibility-small-screens","file":"src/ui/app/startup-splash.ts","line":36,"anchor":"use-dialog-a11y.ts:1-13 contract (initial focus); WCAG 2.4.3; twin: dialogs opened after start-up get focus","evidence":"REPRO+READ","known":false,"summary":"First-visit welcome dialog mounts under the inert #app-root, so its focus() is a no-op: focus stays on body, Tab walks 57 hidden controls behind the modal, Enter on hidden Open… starts a file pick, Escape does nothing"},
  {"id":"U7-P2-3","severity":"P2","refuter":"CONFIRMED P2","area":"accessibility-small-screens","file":"src/ui/common/use-dialog-a11y.ts","line":33,"anchor":"Hook contract 'Tab / Shift+Tab cycle within the dialog'; WCAG 2.1.1","evidence":"REPRO","known":false,"summary":"Dialog Tab trap's FOCUSABLE_SELECTOR omits summary; Job Review's three warning <details> precede the first button and are never focused, hiding 'Run a material test on scrap…' and 'must be checked at the machine' from keyboard users"},
  {"id":"U7-P3-1","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"src/ui/laser/JobActionControls.tsx","line":168,"anchor":"WCAG 2.4.3","evidence":"REPRO","known":false,"summary":"Focus drops to body after Set origin here, Frame job, Start job and Pause (focused button disabled or swapped); screen readers lose their place"},
  {"id":"U7-P3-2","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"src/ui/laser/LiveMotionBar.tsx","line":394,"anchor":"WCAG 2.2 SC 2.4.11; twin phone --abort-dock-height inset","evidence":"REPRO","known":false,"summary":"Fixed Live Motion bar hides the focused Close of Keyboard Shortcuts at 1366x768, 10 workspace Tab stops, and at 125-150% the rail's job status and overrides"},
  {"id":"U7-P3-3","severity":"P3","refuter":"CONFIRMED P3 (aria-modal sub-claim refuted: ABORT JOB unignored in Chromium AX tree with a modal open)","area":"accessibility-small-screens","file":"src/ui/laser/LiveMotionBar.tsx","line":114,"anchor":"PROJECT non-negotiable 9; U6-P3-2","evidence":"REPRO","known":false,"summary":"ABORT JOB/Pause don't name Ctrl+. (no aria-keyshortcuts, title silent); with a modal open during a job Tab and aria-modal exclude the bar, so the undiscoverable Ctrl+. is the only keyboard/SR route"},
  {"id":"U7-P3-4","severity":"P3","refuter":"CONFIRMED P3 (2.79:1 on bg-0/bg-2; 3.11:1 on bg-1)","area":"accessibility-small-screens","file":"src/ui/theme/tokens.css","line":141,"anchor":"WCAG 1.4.11","evidence":"REPRO","known":false,"summary":"Dark theme: ~15 focus-visible rules use copper --lf-accent, 2.79:1 against the bars (Learn, start-point handles, Learn panel, run order, …)"},
  {"id":"U7-P3-5","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"src/ui/theme/tokens.css","line":155,"anchor":"Twin light theme distinction","evidence":"REPRO","known":false,"summary":"Dark theme: disabled .lf-btn text 6.96:1 with the same fill and border as enabled buttons; disabled controls look enabled"},
  {"id":"U7-P3-6","severity":"P3","refuter":"REFUTED (CDP AX tree: Canvas \"KerfDesk workspace\" ignored=false; Playwright ariaSnapshot omits the canvas role)","area":"accessibility-small-screens","file":"src/ui/workspace/WorkspaceCanvasLayers.tsx","line":56,"anchor":"L8 READ claimed the label; Chromium ignores aria-label on role-less canvas","evidence":"REPRO","known":false,"summary":"Canvas aria-label 'KerfDesk workspace' is not exposed; nothing points screen-reader users to the Design object tree as the canvas alternative"},
  {"id":"U7-P3-7","severity":"P3","refuter":"CONFIRMED P3 (clip is the hidden-scrollbar telemetry group, status-bar.css:3-13; the text is reachable by keyboard scroll)","area":"accessibility-small-screens","file":"src/ui/common/status-bar.css","line":39,"anchor":"Screen 1366x768 and 125/150%","evidence":"REPRO","known":false,"summary":"Status-bar messages truncated at <=1366 px ('Relative view — physical bed p', 'Controller-reported • Run • 1r', 'Bed: 400 × 40')"},
  {"id":"U7-P3-8","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"services/remote-control/app/src/ui/machine-jog.tsx","line":36,"anchor":"ADR-582 item 7 (48 px targets)","evidence":"REPRO","known":false,"summary":"Phone 375 px: tool rail overlaps the artwork-sharing notice; step/speed chips 40 px tall; dark 'Laser' chip 4.42:1"},
  {"id":"U7-P3-9","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"src/ui/laser/job-review/JobReviewWarnings.tsx","line":53,"anchor":"WCAG 1.4.3","evidence":"REPRO","known":false,"summary":"Light theme Job Review: '· none block the start' 4.38:1 (opacity span); 'Estimated time' 10 px label 4.50:1"},
  {"id":"U7-P3-10","severity":"P3","refuter":"CONFIRMED P3","area":"accessibility-small-screens","file":"src/ui/workspace/WorkspaceCanvasLayers.tsx","line":56,"anchor":"LightBurn drawing is mouse-only too","evidence":"REPRO","known":false,"summary":"Draw tools armed by keyboard can't place a shape (canvas not focusable) and don't point to the keyboard routes (Library, Parametric part, Import + Numeric Edits)"},
  {"id":"KNOWN-U2-toasts-over-dialog","known":true,"summary":"Toasts cover Machine Setup's and Job Review's header at 1366 and 125 %"},
  {"id":"KNOWN-U4-P3-3","known":true,"summary":"'Frame expired' shown, and announced, at every job start"},
  {"id":"KNOWN-U4-P2-3","known":true,"summary":"Alarm 3 'Reset during motion' after every Abort; announced assertive"},
  {"id":"KNOWN-U6-P3-2","known":true,"summary":"Keyboard Shortcuts dialog is the only place listing Ctrl+. / Ctrl+Enter"},
  {"id":"KNOWN-27-P2-1","known":true,"summary":"Ctrl+. swallowed by modals: FIXED on main (capture phase, use-job-shortcuts.ts:40-47), verified"}
]
```
