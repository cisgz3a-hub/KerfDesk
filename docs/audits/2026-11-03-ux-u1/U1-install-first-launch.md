# U1 `install-first-launch` — auditor report

- **When:** 2026-11-03
- **Tree:** `main` 22dca0a20 (worktree branch `claude/ux-audit-u1`; `git fetch origin main` confirmed `origin/main` = 22dca0a20)
- **Scope:** a complete beginner's first contact: the download page and installer (read only, nothing installed), the desktop first launch (code, config and the CI native screenshots of 1.0.27), and the production web build opened for the first time from an empty Chrome profile. Then the first minutes with no machine: layout, Learn, first shape, Preview, Save, units, jargon and Free/Pro.
- **Counts:** raised 13 (P1 0, P2 4, P3 9; coordinator raised U1-P2-3 to P1, so P1 1 / P2 3 / P3 9), plus 6 KNOWN re-observed and 5 refuted.
- **After the refuter:** 13 raised → 0 refuted → P1 0 / P2 4 / P3 9 (+ 6 KNOWN). Confirmed 13, plausible 0. Two findings were narrowed (U1-P3-7, U1-P3-8), and U1-P2-3 is flagged for the coordinator as a possible data-loss escalation (see its Refuter line).

`SCRATCH` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u1`. Screenshots are in `SCRATCH\shots\`.

**How to rebuild what I ran.** The build tree, bundle and browser profile were deleted at the end. The scripts are kept.
- Tree: `git archive 22dca0a20 src public scripts index.html vite.config.ts package.json tsconfig.json electron | tar -x -C SCRATCH/tree`, then add a junction `SCRATCH\tree\node_modules` pointing to the repo's `node_modules`, and copy `zz-s3/zz-s3-vite.config.ts` to `tree/zz-u1-vite.config.ts`.
- Build: `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u1-vite.config.ts --outDir ../dist`. The bundle is the ordinary web build (Browser Free). There is no git in the tree, so the version label reads `v0.1.0`.
- Host: `node zz-u1-host.mjs dist 4901`. It applies `public/_headers`' production CSP, COOP and COEP.
- Driver: `node zz-u1-driver.mjs 4902`. This is a Playwright Chrome session (`channel: 'chrome'`, headless) on a fresh profile, driven by `zz-u1-d.sh '<json>'`. `ZZ_KEEP=1` keeps the profile for a "returning user" run.
- Service worker check: `node zz-u1-sw-probe.mjs http://127.0.0.1:4901/`.
- **Cleanup warning:** before deleting `tree`, remove the junction on its own (`[IO.Directory]::Delete(path, $false)`).

## Headline

A first-time web visitor gets a clear, fast start:
- the splash;
- a "Choose your workspace" card that says Free needs no account, no time limit and no install;
- an empty workspace with a starter-machine card;
- a **Learn** button whose "Make your first project" lesson matches the real UI step for step.

Drawing, Preview and the Free/Pro split all read clearly.

The beginner gets lost at the edges of that path:
- **Firefox or Safari.** Nothing says the browser can't open or save files, until Import or Save fails with "File System Access API is required…". (U1-P2-1)
- **Downloading the desktop app.** The download page's "three steps" skip the browser's own block on an unsigned, low-reputation installer. Edge hides "Keep anyway" two menus deep. (U1-P2-2)
- **Coming back.** A beginner who closes the tab comes back to an empty canvas. Their work is offered only by a small "Recover autosave" link in the status bar. (U1-P2-3)
- **Frame without a machine.** "Frame job" is disabled with a reason a beginner can't act on: "Wait for an Idle status report before framing." It should say to connect. (U1-P2-4)

The single biggest help would be to name the browser's limits, and the way back to unsaved work, on the first screen the beginner sees.

## Beginner journey

1. **Open kerfdesk.com for the first time.** (`shots/01-splash.png`) The splash shows "LASER & CNC SOFTWARE", KerfDesk, "Your ideas. Beautifully made." and "Opening your workspace…". The wording is clear. Nothing to do.
2. **First-visit card.** (`shots/02-first-paint.png`) It appears about 0.7 s after the workspace. The title is "Choose your workspace." It has two choices:
   - **KerfDesk for Windows**: "Free workspace. More possibilities with Pro.", followed by a list of Pro tools (V-carve & 3D relief, …).
   - **Continue with Free**: "No account. No time limit. No installation."

   So the beginner learns there is no account, and what Pro is. The card does not say what KerfDesk is for beyond "One workspace for your laser and CNC.", or where to start (U1-P3-9). From 127.0.0.1 the download button read "Download unavailable", because CORS blocks the catalogue from that origin (see Not verified). I chose **Continue with Free**.
3. **Empty workspace.** (`shots/03-empty-workspace.png`)
   - The canvas shows a 400 × 400 bed.
   - The starter-machine card reads "Generic 400 × 400 mm machine. The bed, power and speeds are guesses until you set up your machine…" with **Set up machine** and **Not now**.
   - The Artwork panel says "Your artwork starts here: Import or draw artwork…".
   - The Machine panel shows jog arrows, auto-focus and LED buttons while not connected.
   - The status bar reads "Free · Pro in the desktop app".

   There is no cookie, consent or telemetry prompt. The only cross-origin request was the signed download catalogue on `dl.kerfdesk.com`. The menus and panels are labelled. A beginner would plausibly spot **Learn** in the top bar.
4. **Learn.** (`shots/04-learn.png`) Tutorials open with "Make your first project" at the top, then Getting started, Drawing & editing, …, Machine & setup.
5. **Lesson step 1.** (`shots/05-tutorial-first-project.png`) "Choose File → New. Choose Draw rectangle on the left toolbar. Drag on the canvas…". The lesson is a modal over the canvas, so I closed it to follow it. Reopening Learn → the lesson resumed at step 2 (`shots/23-learn-reopened.png`, then the text read back "Step 2 of 4"). The left toolbar is icons only, but each icon has a tooltip; "Draw rectangle" is named exactly as the lesson says.
6. **Drew a rectangle.** (`shots/09-rectangle-drawn.png`)
   - An operation was created at once: **Line**, Power 30 %, Speed 1500 mm/min.
   - Hovering Line, Fill or Image gives a plain explanation, for example "Follow vector outlines. Use power, speed and passes to cut through or mark a line."
   - The red status text "Relative view — physical bed position unverified" appeared, with no explanation (U1-P3-2).
   - Nothing marks 30 % / 1500 as starter guesses (handed to U3; see Not verified).
7. **Step 2: size and operation.** (`shots/10-artwork-tab.png`) Properties → Artwork shows Width and Height, as the lesson says.
8. **Step 3: Preview.** (`shots/11-preview.png`) Preview shows the path, a play bar and "Estimated time 12s". This works with no machine, as the lesson's tip promises.
9. **Step 4: Save As.** In Chrome the native picker opens (it can't be driven headless). The desktop CI screenshot of the same dialog shows "Save as type: Files" (U1-P3-6, `shots/31-desktop-save-dialog-ci.png`).
10. **Simulated Firefox/Safari.** (`shots/13-save-no-fsa.png`, `shots/25-import-no-fsa.png`) I removed `showOpenFilePicker`, `showSaveFilePicker` and `showDirectoryPicker`. Ctrl+S then gives "Error: Could not save project: File System Access API is required to save files in the web app." Import gives "Error: Could not import artwork: File System Access API is required to open files in the web app." Both are stuck: neither message gives a next step (U1-P2-1).
11. **Tried Frame without a machine.** "Not framed — Frame this job to unlock Start", but **Frame job** is disabled. Its hover reads "Wait for an Idle status report before framing." (`shots/24-frame-disabled-no-machine.png`). Stuck: nothing will arrive (U1-P2-4).
12. **Closed the tab and came back.** The browser's own Leave-site prompt appeared first, which is good. On return (`shots/12-returning-recovery.png`, and at 1366 × 768 `shots/20-1366-returning.png`) the canvas was empty and the rectangle was gone. The only sign of it was "↶ Recover autosave" in small grey type at the right end of the status bar. Stuck, unless the beginner reads the status bar (U1-P2-3).
13. **Help menu.** (`shots/14-help-menu.png`) It holds: Find a command, About, Visual tutorials, Safety & liability, Can't connect?, Report a Problem, Save Support Report, Get Help, Pricing, the legal notices, Licence and Check for Updates.
   - About is a native alert: "KerfDesk 0.1.0 / Commit dev…". In production the web label would be `0.1.5196` (U1-P3-1).
   - Check for Updates in the web says the browser updates itself (`shots/16-check-updates-web.png`).
14. **Pro tool in the browser.** (`shots/17-pro-design-studio-web.png`) Clicking "Design Studio Pro" gives "Design Studio is a Pro tool… All Pro features are in the KerfDesk desktop app for Windows", with **Get KerfDesk Pro** and **Not now**, and "Everything else in KerfDesk stays free". This is clear. The only puzzle is the visible "Pro" pills before any click; the dialog explains them.
15. **Units.**
    - Find a command (Ctrl+K) "units" → "No command matches 'units'" (`shots/18-search-units.png`); "inch" → only "Constrained sketch…" (`shots/18-search-inch.png`).
    - Edit → Settings → General has a clear **Units** choice, Millimetres or Inches (`shots/19-settings-units.png`) (U1-P3-4).
16. **Design Library.** (`shots/22-design-library.png`) It has 67 bundled designs with Add buttons, so a beginner can make something without importing. There are no sample projects (KNOWN).
17. **Desktop first launch.** From code and `shots/30-desktop-1.0.27-first-launch-ci.png`, a native CI capture of 1.0.27 on a fresh profile.
    - The same workspace and starter-machine card; "Free · Try Pro" in the status bar. There is no licence window (ADR-623 Amendment 3) and no welcome card (the browser card is gated to non-`app:`).
    - The toolbar adds **MCP** (U1-P3-5).
    - Help adds "Open Data Folder" (settings, licence, support log). Projects go wherever the operator picks in the Save dialog.
    - The installer is NSIS assisted, per user, with no admin rights (`electron-builder.yml:82-84`). It shows a licence page.
    - The desktop opens loopback-only servers (`electron/rtsp-camera-bridge.ts:338`, `electron/artcraft-process.ts:153`), so there is no Windows Firewall prompt on first launch.

## Findings

### U1-P2-1 — In Firefox or Safari, Import, Open and Save fail with "File System Access API is required…", and nothing says so beforehand

- **Where:**
  - The errors: `src/platform/web/web-adapter.ts:39` (open) and `:64` (save).
  - The only browser check is on Connect: `src/ui/laser/ControllerConnectionControls.tsx:147`.
  - There is no first-visit notice (`src/ui/licensing/DesktopWelcomeDialog.tsx`, `src/ui/app/*`).
- **What a beginner sees:** the workspace loads and drawing works. Then Import, Open or Save gives a red toast: "Could not import artwork: File System Access API is required to open files in the web app." Save gives the same with "…to save files…".
- **Why it misleads:**
  - The beginner can't act on "File System Access API". The toast does not say "use Chrome, Edge, Brave or Arc, or the Windows app". It does not say the work is still autosaved in this browser.
  - The first-visit card offers "Continue with Free… No installation" and never mentions the browser.
  - The only actionable browser message is on Connect: "Your browser doesn't support WebSerial. Use Chrome, Edge, Brave…". A beginner who designs first reaches Save before Connect.
  - The website FAQ says Firefox and Safari "can't open or save project files", but the app never does.
- **Evidence:** REPRO (simulated). Chrome with the three picker functions removed by `page.evaluate`:
  - Ctrl+S gives the save toast (`shots/13-save-no-fsa.png`).
  - The Import button gives the import toast (`shots/25-import-no-fsa.png`; toast text read back from the DOM).
  - Not run in a real Firefox or Safari, because no Playwright Firefox or WebKit is installed. The REPRO assumes that these browsers lack the picker functions.
- **Refuter:** CONFIRMED, P2 kept.
  - *What would make it false:* a fallback (`<input type=file>`, download link), a browser check on first load, an ADR that accepts the wording, or a simulation that does not match Firefox and Safari.
  - *Fallback:* none, by design. `web-adapter.ts:3-6` says "No download-fallback path". `WORKFLOW.md:1371-1372` (F-A9 step 7) and `PROJECT.md:54` make the web app Chromium-only. That contract accepts that saving fails. It also says the failure "reports a clear error toast", and that is the part this finding disputes. Drag-and-drop import (`src/ui/app/use-import-drag-drop.ts:54-100`) reads `dataTransfer.files` and does not need the pickers, so Import has a workaround the app never mentions. Save has none.
  - *Browser check:* none. No `src` file checks the browser on load (grep for Firefox, Safari, `userAgentData` and the picker names). The only supported-browser text a visitor could meet first is in the live `download.html`, inside the Preview callout ("web app in Chrome or Edge", `public/download.html:1385-1386, 1390`). A beginner who opens kerfdesk.com directly never sees it.
  - *Simulation:* my run is more faithful than the auditor's. `context.addInitScript` deleted the three pickers from `window` and `Window.prototype` **before any page script ran**, so a check at load would also see them missing. Read back: `{"open":"undefined","save":"undefined","dir":"undefined"}`. MDN browser-compat-data v8.1.8 (`mdn/browser-compat-data@29768a4caa9a88722ef6ba4bad772eb4c3667218`, `api/Window.json`) records `showOpenFilePicker`, `showSaveFilePicker` and `showDirectoryPicker` as `"version_added": false` for Firefox and Safari, and as Chrome 86.
  - *Observed (`zz-u1r/shots/nofsa-01-first.png` … `nofsa-04-import.png`):* the welcome card and workspace say nothing about the browser. Ctrl+S shows "Error: Could not save project: File System Access API is required to save files in the web app." Import shows "Error: Could not import artwork: … required to open files in the web app."
  - *It is worse than reported:* Ctrl+O on an edited canvas opens "Save changes?". Its Save fails with the same error, which leaves Cancel or Don't Save, and Don't Save "discards the changes permanently".
  - Not verified: whether the rest of the app loads and works in a real Firefox or Safari.
- **Fix direction:**
  - Detect the missing pickers at launch. Show a passive card like the starter-machine card: "This browser can't open, import or save files. Use Chrome, Edge, Brave or Arc, or the KerfDesk Windows app. Until then your work is kept in this browser's autosave."
  - Reword both errors: "This browser can't open files. Open KerfDesk in Chrome, Edge, Brave or Arc, or use the Windows app." The save error says "save" instead of "open".

### U1-P2-2 — The download page's "Install in three steps" skip the browser's download block on the unsigned installer

- **Where:**
  - `public/download.html:986-1008`: steps "Open the installer", "Allow it in SmartScreen", "Start using KerfDesk".
  - The release is the unsigned commercial build: `electron-builder.commercial-unsigned.yml:15-17`, with `signExecutable: false`.
- **What a beginner sees:** Edge is the Windows default browser. Before the installer can be opened, Edge's download reputation check can hold an unknown file. The page talks only about the later SmartScreen run prompt ("More info", "Run anyway"), so a beginner whose download shows a warning, or seems to vanish, has no step for it.
- **Why it blocks:** a beginner reads a held download as "the download failed" or "this is malware". Microsoft documents that the way past it is hidden behind the download item's menu.
- **Evidence:** READ plus SOURCE.
  - Microsoft Learn, "Microsoft Edge support for Microsoft Defender SmartScreen", fetched 2026-11-03. Pinned source: `MicrosoftDocs/Edge-Enterprise-pr` commit `61af90debbc9ef6b316377428a7e50fa49d89e99`, `edgeenterprise/microsoft-edge-security-smartscreen.md`. It says files that are unknown "show a warning", and the bypass is "**... | Keep | Show More | Keep anyway**".
  - Not reproduced: downloading or installing was out of bounds, and the warning depends on the file's reputation at the time.
- **Refuter:** CONFIRMED (two independent lines: the live page and Microsoft's documentation), P2 kept.
  - *What would make it false:* the live page or another release document already covering the download warning, or Microsoft not documenting a warning for unknown files.
  - *Live page:* `curl -L https://www.kerfdesk.com/download/` (2026-11-03) contains "Install in three steps" and "Allow it in SmartScreen". It does not contain "Keep anyway". `public/download.html` has no "Keep", "commonly downloaded" or "blocked" text. Its only SmartScreen guidance is the run-time prompt (`:994-998`) and the Preview section (`:1542-1556`). No earlier audit raised this. The installer audits (`2026-07-26-kerfdesk-electron-desktop-quality-audit.md:84,292`, `2026-09-28-electron-research-notes.md:61-62`) cover reputation and signing, not the page's steps.
  - *Microsoft source:* I fetched it again on 2026-11-03. The quote "**... | Keep | Show More | Keep anyway**" is verbatim, and so is "Files that are unknown show a warning". The Learn page metadata gives `git_commit_id: 61af90debbc9ef6b316377428a7e50fa49d89e99` (ms.date 2026-07-08).
  - *Citation caveat:* `MicrosoftDocs/Edge-Enterprise-pr` is not public (`gh api` returns 404), so the pin cannot be opened by readers. Add the archive: `http://web.archive.org/web/20261016171212/https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-smartscreen`.
  - Not reproduced, for the same reason the auditor gives.
- **Fix direction:** add a step before "Open the installer":
  - Title: **If your browser holds the download**.
  - Text: "Edge or Chrome may say the file isn't commonly downloaded. In Edge choose **…** → **Keep** → **Show more** → **Keep anyway**; in Chrome choose **Keep**. Only do this for a file from this page whose name starts with KerfDesk-."

### U1-P2-3 — A returning beginner finds an empty canvas, and only a small status-bar link brings their work back

- **Where:**
  - `src/ui/app/AutosaveRecoveryControl.tsx:15-40`, a ghost button labelled "Recover autosave", mounted in the status bar (`src/ui/app/App.tsx:117`).
  - It moved there from a banner in ef9f5435c (#1137). No ADR or WORKFLOW flow records the move; F-C3 is still a stub (`WORKFLOW.md:3856`).
- **What a beginner sees:** they draw, close the tab ("Leave site?" → Leave) and come back. The canvas is empty and the Artwork panel says "Your artwork starts here". The work is offered only by "↶ Recover autosave" in small grey type at the right end of the status bar, among Pricing, Terms and Privacy (`shots/12-returning-recovery.png`; at 1366 × 768 `shots/20-1366-returning.png`).
- **Why it misleads:** a beginner concludes their work is lost, and starts again or gives up. Settings → General does say unsaved work is "offered back the next time KerfDesk starts" (`shots/19-settings-units.png`). A beginner reads that only after the fact, if at all. The workaround is visible but easy to miss, so this is P2.
- **Evidence:** REPRO. Driver with `ZZ_KEEP=1`: drew a rectangle, waited for the autosave and reopened the page. The status bar showed "Recover autosave", while canvas and panel read empty. The IndexedDB `curvedesk-project-autosave-v1` existed.
- **Refuter:** CONFIRMED, P2 kept. Flagged for the coordinator as a possible escalation.
  - *What would make it false:* a modal, card, toast or welcome-back notice on return, or an ADR that sets the status-bar link as the agreed design.
  - *Repro (`zz-u1r-run.mjs main`, fresh profile):* I drew a rectangle, waited 36 s, closed the tab (`runBeforeUnload`; the Leave-site dialog fired) and reopened it.
    - Objects read 0, and no dialog, card or toast mentioned the work.
    - The only text matching autosave, recover, restore or unsaved was the button "Recover autosave". It is 120 × 20 px, 12 px type, grey `rgb(107, 101, 92)`, at y = 878 in a 900 px window, with the title "An autosaved project is available. Review restore options." (`shots/main-06-returning.png`; at 1366 × 768, `shots/main-07-returning-1366.png`, it sits between Zoom and Pricing).
    - The welcome card was not shown again.
  - *Code:* recovery is offered only through `useAutosaveRecovery` → `AutosaveRecoveryControl`. `ef9f5435c` (#1137, "Move autosave recovery into a compact status-bar control") deleted `AutosaveRecoveryBanner.tsx`. No ADR records that move. ADR-305 decision 7 only requires recovery to be "truthful but nonblocking". ADR-500, ADR-500 Amendment 1 and ADR-623 Amendment 3 say nothing on recovery UI. F-C3 is still a stub (`WORKFLOW.md:3856`).
  - *Worse than reported (`zz-u1r-startover.mjs`):*
    - Session 1 drew 2 objects. Session 2 opened with 0 objects and the link showing.
    - The beginner draws a new rectangle without noticing the link. The link vanishes at once, because any edit retires the offer (`use-autosave-recovery.ts:24-34`).
    - Session 3 offers only the newest snapshot (ADR-305 decision 5 ranks by save time), and Restore brings back 1 object.
    - IndexedDB still holds 2 snapshots, but no UI reaches session 1's work.
    - So a beginner who misses the link and starts again loses their first design from the app's point of view.
  - *Severity:* under AREAS this does not stop a first burn, so it stays P2. METHOD §3 P1 includes "loses … user data", so the coordinator should decide whether this reach (a beginner who misses the link and then edits) lifts it.
- **Fix direction:**
  - When the opening project is empty and an autosave exists, show the offer in the canvas card position, like the starter-machine card. Wording: "**Your last unsaved work is here.** Saved 3 minutes ago in this browser. **Restore** · **Not now**".
  - Keep the status-bar link as the way back after Not now.

### U1-P2-4 — With no machine connected, Frame job's only explanation is "Wait for an Idle status report before framing."

- **Where:** `src/ui/laser/JobActionControls.tsx:265-266`. `frameBlockedTitle(undefined)` is used both when disconnected and when connected but not yet reporting.
- **What a beginner sees:** the panel says "Not framed — Frame this job to unlock Start". **Frame job** is greyed out, and its hover says "Wait for an Idle status report before framing." (`shots/24-frame-disabled-no-machine.png`; the title was read back from the DOM).
- **Why it misleads:** the beginner is told to Frame, can't, and is told to wait for something that will never come. "Idle status report" is controller jargon. This is the AREAS P2 case of "a message whose words a beginner cannot act on". The workaround (Connect) is in the same top bar.
- **Evidence:** REPRO in the production build: drew a rectangle with no connection; `Frame job` had `disabled=true` and `title="Wait for an Idle status report before framing."`.
- **Refuter:** CONFIRMED, P2 kept.
  - *What would make it false:* a different title when disconnected, or a nearby "connect first" message tied to Frame.
  - *Repro (`zz-u1r-run.mjs main`):* the result was `[{"text":"Frame job","disabled":true,"title":"Wait for an Idle status report before framing."}]`, with the status line "Not framed — Frame this job to unlock Start".
  - *Code:* `frameControlProps` (`JobActionControls.tsx:226-237`) passes `state === undefined` to `frameBlockedTitle` (`:265-266`) whether the app is disconnected or has not yet had a report.
  - *Twin that does say it:* the G-code Inspector's run path has `EXTERNAL_CONNECT_FIRST = 'Connect to the machine first.'` (`src/ui/gcode-inspector/external-run.ts:63`; see also `external-run-readiness.ts:24`). So the app already has the right words, only not on the main Frame button.
  - *Mitigation:* the top bar shows "Default 400×400 / Not connected" beside an orange **Connect** (`shots/main-07-returning-1366.png`). The workaround is easy to find, which is why this is P2 and not P1. AREAS puts "a message whose words a beginner cannot act on" at P2, so P2 is kept.
- **Fix direction:**
  - When not connected, say: "Connect your machine first (Connect, top right). Frame then traces the job outline with the laser off."
  - Keep the existing text for a connected controller that has not yet reported.

### U1-P3-1 — The web app calls itself `v0.1.5196`, while the desktop app and the download page use `1.0.x`

- **Where:**
  - `src/platform/web/build-info.ts:78-84`: the web version is `major.minor` from `package.json` (`"version": "0.1.0"`, `package.json:3`) plus the git commit count, 5196 at 22dca0a20.
  - Shown top right (`v0.1.0` in my git-less build, `shots/03-empty-workspace.png`) and in About.
  - The desktop uses `KERFDESK_DESKTOP_VERSION` (1.0.29). `website/pages/download.mjs:162` gives "such as 1.0.20".
- **What a beginner sees:** "v0.1.5196" in the browser and "v1.0.29" on the desktop. A beginner reading "0.1" thinks the web app is an early alpha, and a support request names a number the downloads never use.
- **Evidence:** READ, plus REPRO of the label position (`shots/15-about.png` dialog text: "KerfDesk 0.1.0 / Commit dev").
- **Refuter:** CONFIRMED, P3 kept.
  - The live web bundle carries the number. On 2026-11-03, `https://kerfdesk.com/assets/main-BJRjIsqX.js` and `ui-workbench-DjaMp3LI.js` both contain `"0.1.5196"`.
  - `appVersion` (`build-info.ts:78-84`) builds it from the commit count, which is 5202 at `origin/main` c93fbb3bc.
  - No ADR sets the web numbering (grep of `DECISIONS.md` and `docs/decisions` for "commit count", "0.1." and "web version").
- **Fix direction:** label the web build with the current release line, for example "Web · 1.0.29 + 12", or drop the 0.1 base. At least say "web build" next to the number.

### U1-P3-2 — A red "Relative view — physical bed position unverified" appears as soon as there is artwork, with no tooltip

- **Where:**
  - `src/ui/workspace/canvas-motion-badge.tsx:213`, mounted at `src/ui/workspace/Workspace.tsx:157`.
  - The CSS makes it red in the status bar. It has no `title`: the DOM read of the status bar gave an empty title.
- **What a beginner sees:** with no machine, they draw a rectangle and the status bar shows red text saying the bed position is "unverified" (`shots/09-rectangle-drawn.png`).
- **Why it misleads:** it reads as an error the beginner caused. "Relative view" means nothing to them, and there is nothing to click.
- **Evidence:** REPRO.
- **Refuter:** CONFIRMED, P3 kept.
  - `zz-u1r-badge.mjs` read the badge as a `SPAN role="status"` with colour `rgb(160, 44, 49)` and 11 px type, inside `lf-status-bar__telemetry`.
  - There is no `title` on the span or its next four ancestors, and no `aria-describedby`. Hovering it for 1.2 s showed no `role="tooltip"` (`shots/badge-hover.png`).
  - The text comes from `idleViewReason` (`canvas-motion-badge.tsx:209-219`) whenever the plan is relative with no bed.
  - Earlier audits (`2026-10-21-rolling-v2/12-camera.md:193`, `2026-10-27-rolling-v3/H6-camera-placement.md:146`) used it as a camera-placement signal, not as beginner wording. So this is not KNOWN.
- **Fix direction:** with no machine connected, show nothing, or a neutral "Position shown relative to your origin". Add a tooltip: "KerfDesk can't yet tell where on the bed this job will burn. It will know once your machine is connected and homed, or you set an origin."

### U1-P3-3 — WORKFLOW F-A1 and F-A2 describe a first run that no longer exists

- **Where:**
  - `WORKFLOW.md:71`: "Status bar shows: `Ready · No device configured · Empty workspace`". The real bar reads "Cursor: — · Nothing selected · Objects: 0 · … · Device: Default 400×400".
  - `WORKFLOW.md:72`: "**No** welcome modal". Browser Free shows "Choose your workspace", per ADR-540 Amendment 1 item 7.
  - `WORKFLOW.md:124`: the drop hint "Drag an SVG here, or use File → Import". It is absent; grep finds no such string in `src`.
- **Why it matters:** the fix cards for this round take WORKFLOW as the spec of the first run.
- **Evidence:** READ plus REPRO (`shots/03-empty-workspace.png`; DOM search for drop-hint text returned `[]`).
- **Refuter:** CONFIRMED, P3 kept.
  - `WORKFLOW.md:71-72` and `:124` read as quoted.
  - `grep -rn "Drag an SVG\|No device configured" src` finds nothing.
  - My first visit showed the welcome backdrop "Choose your workspace." (`shots/main-01-first.png`), which `ADR-540-amendment-1-…md:51` item 7 accepts.
  - A related but different drift (F-A9/F-A11 download fallback) was raised in `2026-07-10-full-sweep-audit.md:103-107` and has since been fixed in F-A9 step 7. F-A1/F-A2 were not covered there.
- **Fix direction:** rewrite F-A1 steps 2 and 3 and F-A2's drop hint to match. Name the browser welcome (ADR-540 Amd 1 item 7) and the Artwork panel's "Your artwork starts here" empty state.

### U1-P3-4 — Units can't be found by searching "units" or "inch"

- **Where:**
  - The Settings command help text `src/ui/help/settings-command-help.ts:9` lists theme, layout, recent projects, snapping, start markers, nudge distances and Labs, but not Units.
  - The Units choice itself is at `src/ui/settings/SettingsGeneralSection.tsx:89-105`.
- **What a beginner sees:** Ctrl+K "units" → "No command matches 'units'" (`shots/18-search-units.png`); "inch" → an unrelated "Constrained sketch…".
- **Evidence:** REPRO.
- **Refuter:** CONFIRMED, P3 kept.
  - *Repro (`zz-u1r-run.mjs main`):*
    - "units" → "No command matches "units". Try another word, or browse Help → Visual tutorials." (`shots/main-05-search-units.png`)
    - "inch" → only "Constrained sketch…"
    - "millimetre" → only the DXF and GeoJSON export commands
  - *Other routes:* no other unit control exists. The unit display hooks are read-only in `NumericEditsBar.tsx` and `Workspace.tsx`, and the only setter is `SettingsGeneralSection.tsx`.
- **Fix direction:**
  - Add "units (millimetres or inches)" to the Settings command's text: "Open the Settings window (Ctrl+,): units (millimetres or inches), theme, workspace layout, …".
  - Or add a command "Switch units (mm / inches)…" that opens Settings → General.

### U1-P3-5 — The desktop toolbar shows "MCP" to every new user

- **Where:** `src/ui/remote-access/RemoteToolbarButton.tsx:84` (label `MCP`; aria-label and title "Phone & MCP: …").
- **What a beginner sees:** a top-toolbar button called **MCP**, next to Learn (`shots/30-desktop-1.0.27-first-launch-ci.png`, native CI capture of 1.0.27). The source is unchanged since then.
- **Why it matters:** MCP (Model Context Protocol) is unexplained jargon, and it takes primary toolbar space on first launch.
- **Evidence:** READ plus the CI screenshot.
- **Refuter:** CONFIRMED, P3 kept.
  - `RemoteToolbarButton.tsx:84` renders `MCP`. It is gated only by `isRemoteAccessRenderer()` (`:41-43`), so it shows on every desktop launch. `shots/30-desktop-1.0.27-first-launch-ci.png` shows "MCP" next to Learn.
  - The label is deliberate: a55c74162 (#1166) and ae6749d98 (#1177, "keep MCP toolbar label visible at every width"). `WORKFLOW.md:37` names "**MCP** in the main toolbar".
  - Neither of those weighs the label for a beginner, so it is not an accepted trade-off. It is polish.
- **Fix direction:** label it **Phone**, or **Remote**, with the tooltip "Control KerfDesk from your phone or an AI assistant (MCP)".

### U1-P3-6 — Open and Save dialogs call KerfDesk projects "Files"

- **Where:** `src/platform/web/web-adapter.ts:30-35`: `description: 'Files'` for every picker. The desktop uses the same path.
- **What a beginner sees:** "Save as type: Files" in the Windows Save dialog (`shots/31-desktop-save-dialog-ci.png`, CI capture).
- **Why it matters:** the beginner can't tell from the dialog what kind of file they are saving, or that the project is a `.lf2` to keep.
- **Evidence:** READ plus the CI screenshot.
- **Refuter:** CONFIRMED, P3 kept.
  - The desktop adapter spreads `webAdapter` and does not override `pickFilesForOpen` or `pickFileForSave` (`src/ui/app/main.tsx:60-84`). `createDesktopProjectFiles` replaces only recent and handover handling. So every picker gets `description: 'Files'`.
  - The CI capture shows "Save as type: Files".
  - Mitigation: the File name box there is pre-filled with a name ending in `.lf2`, so the extension is visible. It stays P3.
- **Fix direction:** pass a per-request description: "KerfDesk project (.lf2)", "SVG drawing", "G-code", and so on.

### U1-P3-7 — No plain-language meaning for G-code, GRBL, homing, origin or kerf anywhere a beginner looks

- **Where:**
  - Lessons use the words undefined. `src/ui/tutorials/machine-setup-tutorials.ts:26`: "check the work area, origin, homing…". `src/ui/tutorials/laser-tutorials.ts:34`: "Kerf Offset".
  - Grep for a definition ("G-code is", "GRBL is", "glossary", "kerf is") in `src/ui/tutorials` and `src/ui/help` finds nothing.
  - Line, Fill and Image are explained (hover tooltips, `src/ui/layers/LaserProcessField.tsx:12-28`), and so is Air assist.
- **Why it matters:** the Learn centre is where a beginner looks. The product name itself is "Kerf".
- **Evidence:** READ plus the REPRO tooltip read.
- **Refuter:** CONFIRMED but narrowed, P3 kept. The auditor's grep covered only `src/ui/tutorials` and `src/ui/help`. Two of the five terms are explained elsewhere:
  - **Kerf** is explained where the setting lives. Kerf Offset's tooltip begins "Compensate laser beam width on closed Line cuts" (`src/ui/layers/CutSettingsCommonFields.tsx:143`).
  - **Origin** has its own lesson, "Place the job using an origin" (`src/ui/tutorials/machine-setup-tutorials.ts:151-190`). It explains the placement modes, though it never says in one line what an origin is.
  - **G-code**, **GRBL** and **homing** have no plain-language definition anywhere: grep of `src/ui` for "G-code is", "GRBL is", "Homing is" and "limit switch" finds only error and status texts.
  - The G-code Inspector's `word-glossary.ts` explains individual G-code words, not what G-code is.
  - The fix keeps its form, with the kerf and origin lines pointing to the existing tooltip and lesson.
- **Fix direction:** add a short "Words you'll see" lesson under Getting started, with one line each. For example:
  - "**G-code**: the list of moves KerfDesk sends to your machine."
  - "**GRBL**: the firmware on most hobby laser and CNC boards that reads that G-code."
  - "**Homing**: the machine drives to its switches to find a known corner."
  - "**Origin**: the point your job's position is measured from."
  - "**Kerf**: the width of material the beam or bit removes."

### U1-P3-8 — The marketing site's download and Get started copy contradicts the real install (latent: the site is not deployed)

- **Where:**
  - `website/pages/download.mjs:203-221`, the Windows install steps:
    - "Only continue if … its name contains `-preview.`". The real file is `KerfDesk-<version>-windows-x64-setup.exe`.
    - "The signed Windows edition … If Windows reports an unknown publisher for it, don't run it." The edition offered is unsigned. This also contradicts the same page's card at `:59-62`.
  - `website/pages/docs-data.mjs:56-66`:
    - "There's no sign-up, no welcome tour". The browser welcome card exists.
    - "Desktop Preview builds are available…". The main download is the commercial edition.
- **Why it matters:** a beginner who follows the site is told not to run the real installer.
- **Evidence:** READ. Reach: `https://www.kerfdesk.com/docs/` returned 404 and `https://www.kerfdesk.com/download/` served the app's `download.html` (both fetched 2026-11-03), so the `website/` build is not live. Hence P3.
- **Refuter:** CONFIRMED but narrowed, P3 kept (latent). I fetched both URLs again on 2026-11-03: `/docs/` returned 404, and `/download/` returned 200 with the `public/download.html` copy.
  - *Misread:* the "`-preview.`" step is correct. It sits in the website's **Install a desktop Preview** section (`website/pages/download.mjs:185-192`: eyebrow "Unsigned Preview"), and a Preview file's name does contain `-preview.`.
  - *What stands:*
    - "The signed Windows edition is different … If Windows reports an unknown publisher for it, don't run it." (`:217-220`) contradicts the same page's card, "The commercial Windows edition is available as an unsigned installer" (`:59-62`).
    - `docs-data.mjs:56-66` says "You land straight in the workspace", but the browser welcome card comes first.
    - It also offers "Desktop Preview builds" as the desktop download.
    - "No welcome tour" is defensible: the card is a choice, not a tour.
  - The fix direction should drop the `-preview.` item.
- **Fix direction:** before deploying `website/`:
  - Make its Windows steps those of `public/download.html:989-1007`.
  - Drop "no welcome tour".
  - Describe the commercial Windows edition as the main download.

### U1-P3-9 — Neither first-contact screen points to how to start

- **Where:**
  - `src/ui/licensing/DesktopWelcomeDialog.tsx:66-96`, the browser welcome. Its footnote is only "You can get the desktop app later from the Free / Pro button."
  - `public/download.html:1001-1006`, the last install step "Start using KerfDesk". It says only that it installs per user without an administrator password.
- **What a beginner sees:** a workspace choice, then a busy workspace. **Learn → Make your first project** is good, but nothing points to it. The website's Get started copy, which does point to Learn, is not deployed.
- **Evidence:** REPRO (`shots/02-first-paint.png`) and READ.
- **Refuter:** CONFIRMED, P3 kept.
  - `DesktopWelcomeDialog.tsx` has no "Learn", "tutorial" or "first project" text, and neither has `public/download.html`. The empty Artwork panel ("Your artwork starts here…") has no Learn link either.
  - The Learn button itself carries only the title "Learn: open a step-by-step visual lesson" (`TutorialButton.tsx:20-23`), with no first-run highlight.
  - My first-visit text read (`shots/main-01-first.png`) matches the auditor's.
- **Fix direction:**
  - Welcome card: under "Continue with Free", add "New to KerfDesk? Click **Learn** (top right) → **Make your first project**. It takes 4 minutes and needs no machine."
  - Download step 3: "Open KerfDesk from the Start menu. Click **Learn** → **Make your first project**, then **Set up machine** when you're ready to connect."

## KNOWN re-observed

- **No sample projects.** The Design Library (67 entries, `shots/22-design-library.png`) is the only ready-made content; Open template opens the user's own templates. S18 18.1/18.4 (G-S18-1, G-S18-4).
- **"Can't connect?" ends in a repository path.** Its last line is "Full guide: docs/connection-troubleshooting.md" (`src/ui/help/connection-help.ts:48`), which a user cannot open: the repo is private and nothing is shipped there. S18 18.2 (G-S18-2). U2 owns the connection help.
- **English only, no language setting.** S18 18.6 (G-S18-6).
- **Browser first-visit welcome with a Windows download and Continue with Free.** Accepted: ADR-540 Amendment 1 item 7. Raised here only as drift (U1-P3-3) and a missing pointer (U1-P3-9).
- **The starter-machine card covers the top-right corner of the bed.** Accepted: ADR-500 Consequences.
- **The desktop opens straight into KerfDesk Free with "Free · Try Pro".** The browser explains that Pro is desktop-only. Accepted: ADR-623 Amendment 3, ADR-540, ADR-544.

## Refuted

- **"The PWA service worker never installs" (my own candidate).** In the persistent-profile driver the worker went `installing > redundant`, even when registered by hand. In a fresh non-persistent context (`zz-u1-sw-probe.mjs`) it reached `active`. All 419 precache URLs returned 200. Harness artifact.
- **"Line / Fill / Image have no explanation".** The `title` sits on the hidden radio input, which covers the label. `elementFromPoint` at each segment's centre returns the INPUT with its description, so hover works.
- **"Closing a lesson loses your place".** Reopening Learn → "Make your first project" resumes at "Step 2 of 4".
- **"The website tells Windows buyers not to run the installer" as a live P2.** `website/` is not deployed (see U1-P3-8). The live `download.html` steps are correct for the unsigned build.
- **"First launch of the desktop app triggers a Windows Firewall prompt".** Both servers listen on `127.0.0.1` only.
- **(Refuter) U1-P3-8 sub-claim: the website's "`-preview.`" step contradicts the real installer.** It is in the website's "Install a desktop Preview" section (`website/pages/download.mjs:185-192`), where it is correct. The rest of U1-P3-8 stands.

## Refuter method

- **Who and when:** a fresh-context refuter, 2026-11-03. `git fetch origin main` → `c93fbb3bc`. Its only changes since `22dca0a20` are under `docs/audits/2026-11-02-*`, so no `src`, `public` or `website` file differs from the audited tree.
- **Build:** `git archive origin/main src public scripts index.html vite.config.ts package.json tsconfig.json electron` into `SCRATCH-R\tree`, where `SCRATCH-R` = `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-u1r`.
  - A `node_modules` junction was added, and `zz-s3-vite.config.ts` was copied in as `zz-u1r-vite.config.ts`.
  - Built with `node --max-old-space-size=4096 node_modules/vite/bin/vite.js build --config zz-u1r-vite.config.ts --outDir ../dist`.
  - Hosted with `node zz-u1r-host.mjs dist 4921`, a copy of the auditor's host with the production CSP, COOP and COEP.
- **Runs (Playwright `channel: 'chrome'`, headless, a new empty profile per run, deleted afterwards):**
  - `node zz-u1r-run.mjs http://127.0.0.1:4921/ nofsa` removes the pickers with `addInitScript` before any page script. It then reads the first visit, draws a rectangle, and tries Ctrl+S, Import and Ctrl+O.
  - `node zz-u1r-run.mjs http://127.0.0.1:4921/ main` covers: first visit, rectangle, the Frame title, Ctrl+K "units", "inch", "millimetre" and "mm", a 36 s autosave, closing the tab, and returning at 1440 × 900 and 1366 × 768.
  - `node zz-u1r-badge.mjs http://127.0.0.1:4921/` reads the "Relative view" element, its ancestors and the hover.
  - `node zz-u1r-startover.mjs http://127.0.0.1:4921/` runs three sessions: draw 2, return and draw 1 without restoring, then return and Restore.
- **Shots:** `SCRATCH-R\shots\` (`nofsa-0*.png`, `main-0*.png`, `badge-hover.png`). Logs: `SCRATCH-R\zz-u1r-main.log` and `zz-u1r-nofsa.log`.
- **Sources fetched 2026-11-03:**
  - Microsoft Learn's Edge SmartScreen page (`git_commit_id` 61af90de; archive `web.archive.org/web/20261016171212/…`).
  - MDN browser-compat-data v8.1.8 @ `29768a4caa9a88722ef6ba4bad772eb4c3667218` `api/Window.json`.
  - The live `www.kerfdesk.com/download/` and `/docs/` pages.
  - The live web bundle chunks, for the version string.
- **Not done:** real Firefox, Safari or Edge runs; downloading or installing; launching the installed desktop app. U1-P2-1's claim that the rest of the app works in Firefox or Safari, and the actual Edge warning for U1-P2-2, stay unreproduced.

## Verified clean

- **Splash.** Clear wording; nothing to act on (`shots/01-splash.png`).
- **No cookie, consent or telemetry prompt.** The only cross-origin request on first visit is the signed catalogue on `dl.kerfdesk.com`, from the welcome card.
- **Account and licence are clear.** "No account. No time limit. No installation.", "Free · Pro in the desktop app", and the Pro dialog's "Everything else in KerfDesk stays free" (`shots/17-pro-design-studio-web.png`).
- **"Make your first project" matches the UI.** File → New, Draw rectangle, Properties → Artwork Width/Height, Operation Line, Preview, Save As (steps 5–9 above). Preview works with no machine.
- **Unsaved work is guarded.** The browser's Leave-site prompt appears (dialog `beforeunload` caught by the driver). Settings explains autosave.
- **Units are clear once found.** Settings → General offers Millimetres or Inches, and explains that projects and G-code stay in mm.
- **The live download page matches the build.** `public/download.html` SmartScreen step ("More info", check the name starts with KerfDesk-, "Run anyway") matches the unsigned commercial build. The live page fetched 2026-11-03 matches the repo text.
- **The installer needs no admin rights.** Per user, no admin, install directory changeable (`electron-builder.yml:82-84`).
- **The desktop update prompt can't interrupt.** It is a card, not a modal, and waits for machine work (`src/ui/licensing/UpdatePrompt.tsx:1-6`, ADR-561 Amd 5).
- **Offline install works.** The service worker installs and activates on a first visit in a fresh context.

## Not verified

- **Real browsers and devices.** Not run in real Firefox or Safari (no Playwright engines installed); U1-P2-1 is simulated. The PWA "Install app" button (`src/ui/common/InstallButton.tsx`) does not fire in headless Chrome. The one-time "Ready to work offline." toast was not caught (it lasts 4 s).
- **The welcome card's download button.** From 127.0.0.1 the catalogue fetch is CORS-blocked ("Download unavailable / We couldn't check the download."). On kerfdesk.com it should resolve.
- **The real Windows installer.** Not downloaded or installed (instructions). Not checked: SmartScreen and Edge behaviour, the commercial NSIS terms text (an external file), the shortcuts it creates, the Save dialog's default folder on a fresh desktop profile, and macOS and Linux first launch. The installed KerfDesk on this PC (`%LOCALAPPDATA%\Programs\KerfDesk`) was not launched: it uses the owner's real profile and might auto-connect to a machine.
- **Hand-off to U3.** ADR-500 Amendment 1 decision 5 says "UI copy identifies these as starter values and asks the operator to choose power/speed from their material recipe or machine instructions". The laser Operation view shows Power 30 % / Speed 1500 mm/min with no such copy. A DOM search for "starter", "recipe" or "machine instructions" after drawing returned `[]` (`shots/09-rectangle-drawn.png`); grep finds only the CNC and Cut Settings strings.
- **Hand-off to U2.**
  - The website's Get started copy (`website/pages/docs-data.mjs:66-80`, "It has three stages: Machine… Essentials… Review & save") and the lesson at `src/ui/tutorials/machine-setup-tutorials.ts:26` ("all three stages") may predate ADR-637's single machine list.
  - The Machine panel's jog and LED buttons look active while not connected.

```json
{
  "area": "U1",
  "areaId": "install-first-launch",
  "tree": "22dca0a20",
  "refuterTree": "c93fbb3bc (no src/public/website change since 22dca0a20)",
  "date": "2026-11-03",
  "counts": { "raised": 13, "P1": 0, "P2": 4, "P3": 9, "known": 6, "refuted": 5, "refuterConfirmed": 13, "refuterPlausible": 0, "refuterRefuted": 0 },
  "findings": [
    { "id": "U1-P2-1", "severity": "P2", "evidence": "REPRO (simulated: pickers removed in Chrome)", "where": "src/platform/web/web-adapter.ts:39,64", "title": "Firefox/Safari: Import/Open/Save fail with 'File System Access API is required…' and nothing warns beforehand", "verdict": "CONFIRMED", "refuterNote": "pickers removed by addInitScript before load; MDN BCD v8.1.8 Firefox/Safari false; no fallback by design, no first-load notice; Ctrl+O Save-changes path also dead-ends" },
    { "id": "U1-P2-2", "severity": "P2", "evidence": "READ+SOURCE (MicrosoftDocs/Edge-Enterprise-pr@61af90de)", "where": "public/download.html:986-1008", "title": "Install steps omit the browser's download-reputation block on the unsigned installer", "verdict": "CONFIRMED", "refuterNote": "live download page has no Keep-anyway step; Microsoft Learn quote verified (archive 20261016171212); not reproduced" },
    { "id": "U1-P2-3", "severity": "P2", "evidence": "REPRO", "where": "src/ui/app/AutosaveRecoveryControl.tsx:15-40; src/ui/app/App.tsx:117", "title": "Returning beginner sees an empty canvas; only a small status-bar link restores the work", "verdict": "CONFIRMED", "refuterNote": "reproduced; starting over retires the offer and the first session becomes unreachable in-app; coordinator to weigh METHOD §3 data loss" },
    { "id": "U1-P2-4", "severity": "P2", "evidence": "REPRO", "where": "src/ui/laser/JobActionControls.tsx:265-266", "title": "Frame job disabled with 'Wait for an Idle status report' when no machine is connected", "verdict": "CONFIRMED", "refuterNote": "reproduced; G-code Inspector twin says Connect to the machine first.; Not connected + Connect visible nearby" },
    { "id": "U1-P3-1", "severity": "P3", "evidence": "READ", "where": "src/platform/web/build-info.ts:78-84; package.json:3", "title": "Web shows v0.1.<commits> while desktop and downloads use 1.0.x", "verdict": "CONFIRMED", "refuterNote": "live bundle contains 0.1.5196" },
    { "id": "U1-P3-2", "severity": "P3", "evidence": "REPRO", "where": "src/ui/workspace/canvas-motion-badge.tsx:213", "title": "Red 'Relative view — physical bed position unverified' with no tooltip", "verdict": "CONFIRMED", "refuterNote": "red 11px role=status span, no title/tooltip" },
    { "id": "U1-P3-3", "severity": "P3", "evidence": "READ+REPRO", "where": "WORKFLOW.md:71,72,124", "title": "WORKFLOW F-A1/F-A2 first-run text out of date", "verdict": "CONFIRMED" },
    { "id": "U1-P3-4", "severity": "P3", "evidence": "REPRO", "where": "src/ui/help/settings-command-help.ts:9", "title": "Units not findable via Find a command", "verdict": "CONFIRMED", "refuterNote": "units/inch/millimetre searches reproduced" },
    { "id": "U1-P3-5", "severity": "P3", "evidence": "READ+CI screenshot", "where": "src/ui/remote-access/RemoteToolbarButton.tsx:84", "title": "Desktop toolbar shows jargon label 'MCP'", "verdict": "CONFIRMED", "refuterNote": "label deliberate (#1166, #1177, WORKFLOW.md:37) but not weighed for beginners" },
    { "id": "U1-P3-6", "severity": "P3", "evidence": "READ+CI screenshot", "where": "src/platform/web/web-adapter.ts:30-35", "title": "File dialogs say 'Files' instead of 'KerfDesk project (.lf2)'", "verdict": "CONFIRMED", "refuterNote": "desktop reuses web pickers; .lf2 visible in file name mitigates" },
    { "id": "U1-P3-7", "severity": "P3", "evidence": "READ", "where": "src/ui/tutorials/machine-setup-tutorials.ts:26", "title": "No plain-language glossary for G-code, GRBL, homing, origin, kerf", "verdict": "CONFIRMED (narrowed)", "refuterNote": "kerf explained in Kerf Offset tooltip; origin has a lesson; G-code, GRBL, homing undefined" },
    { "id": "U1-P3-8", "severity": "P3", "evidence": "READ (site not deployed)", "where": "website/pages/download.mjs:203-221; website/pages/docs-data.mjs:56-66", "title": "Undeployed website copy contradicts the real Windows install", "verdict": "CONFIRMED (narrowed)", "refuterNote": "-preview. step is in the Preview section and correct; signed-edition sentence and docs-data copy stand" },
    { "id": "U1-P3-9", "severity": "P3", "evidence": "REPRO+READ", "where": "src/ui/licensing/DesktopWelcomeDialog.tsx:66-96; public/download.html:1001-1006", "title": "First-contact screens don't point to Learn → Make your first project", "verdict": "CONFIRMED" }
  ],
  "known": ["S18 18.1/18.4 no sample projects", "S18 18.2 dead docs/ path in Can't connect?", "S18 18.6 English only", "ADR-540 Amd1 item 7 browser welcome", "ADR-500 banner covers bed corner", "ADR-623 Amd3 desktop opens Free"],
  "refuted": ["SW never installs (harness artifact)", "Line/Fill/Image lack tooltips", "Lesson loses progress", "Website install contradiction live (site not deployed)", "Desktop firewall prompt (loopback only)", "(refuter) U1-P3-8 sub-claim: website -preview. step is in the Preview section and correct"],
  "handoffs": { "U2": ["Machine Setup 'three stages' copy vs ADR-637", "Machine panel controls look active while disconnected"], "U3": ["ADR-500 Amd1 decision 5 starter-value copy missing on laser Operation view"] },
  "refuterShots": "C:\\Users\\stolk\\AppData\\Local\\Temp\\claude\\C--Users-stolk-OneDrive-Desktop-KerfDesk\\34485e99-fb85-4112-957b-e0432f213833\\scratchpad\\zz-u1r\\shots",
  "screenshots": "C:\\Users\\stolk\\AppData\\Local\\Temp\\claude\\C--Users-stolk-OneDrive-Desktop-KerfDesk\\34485e99-fb85-4112-957b-e0432f213833\\scratchpad\\zz-u1\\shots"
}
```
