# Rolling audit v11 — W9 The browser build, the website and docs drift (`platform-web-docs`)

- **When:** 2026-11-09 10:05–11:10   **Tree:** origin/main @ `b047e7bb6` (repro export `scratchpad/j12-main`, `.audit-sha` = `b047e7bb6`; Vitest copy `scratchpad/zz-w9/mut`)
- **Scope:**
  - **Browser build:** `src/platform/web/**`, the web-only branches of `src/ui/**` (BrowserFilesNotice, ConfirmSaveDialog, background-streaming notice, wake lock, PWA update watcher, preload-error toast, AI, network connect, camera capability), `vite.config.ts` (VitePWA/Workbox), `public/_headers`, `public/_redirects`, `public/sw-worker-embedder-policy.js`.
  - **Website:** `website/**` and the pages that ship through `public/` (download, buy, privacy, pricing, terms, refunds, safety), the download-verification modules `public/desktop-*.mjs` and their trust anchors.
  - **Docs drift:** in-app help (`src/ui/help/**`), lessons and the "Words you'll see" glossary (`src/ui/tutorials/**`), Ctrl+K entries (`src/ui/commands/search-entries.ts`), `README.md`, `docs/safety.md`, `public/eula.txt`, `website/README.md`.
  - **Governing:** ADR-060, ADR-117, ADR-227, ADR-354 Amd 1, ADR-524, ADR-543, ADR-607, ADR-656, ADR-676, ADR-688; PROJECT.md "Delivery targets".
- **Lenses run:**
  - L1 contract, L2 ground truth (W3C Screen Wake Lock, the WebKit storage-cap post), L9 browser/desktop parity, L8 (PRs in these paths since 2026-10-27).
  - L3 for twin texts: help vs website vs docs.
  - L6 for the update and lazy-load failure paths.
  - L5 only for the website trust boundary: the download-signature verifier, the checkout redirect and secrets in config.
- **Counts:** 5 raised → refuter PENDING → P1 0 / P2 2 / P3 3 (+ 9 KNOWN). No security finding; no SECURITY-DETAILS file was written.

## Headline

The browser build is mostly honest about what it lacks, and its service worker is careful:
- Updates are prompt-only and reload only the window that clicked.
- A stale window's failed chunk load raises a toast and never reloads.
- A project from a newer KerfDesk is refused with "Update the app".
- The download page really verifies Ed25519 signatures before it shows a link.

Two gaps matter:

1. **The keep-awake lapses in a hidden tab, and nobody is told (W9-P2-1).** In a browser, the screen wake lock that ADR-117 relies on is released as soon as the tab is hidden or the window minimised, and the browser refuses to grant it again while hidden. The app says nothing about it. If the operator minimises Chrome or locks the screen during a long job, the PC can then sleep on its idle timer. The worker stops streaming, and a GRBL-family controller under M3 keeps the beam lit over the stopped head. This is P1 by effect if the refuter shows that idle sleep does fire.
2. **Firefox and Safari users are told their work is safe in autosave (W9-P2-2).** They are also told to "open KerfDesk in Chrome or Edge" to keep it as a file. Neither holds:
   - Safari deletes a site's IndexedDB after seven days of Safari use without a visit.
   - Another browser cannot see this browser's autosave.
   - There is no other way to get the work out.

## Findings

### W9-P2-1 — In a browser, a hidden or minimised KerfDesk tab loses its keep-awake mid-job, with no notice; the OS can then sleep and stall the stream with an M3 beam lit
- **Where:**
  - `src/ui/app/use-active-job-wake-lock.ts:92` (`if (env.document.visibilityState === 'hidden') return;`), `:114-121` (re-acquires only on becoming visible), `:13-15` and `:80-84`: the only operator message, "Keep-awake unavailable", is pushed only when the API is missing or a request throws. When the browser releases the lock on hiding, `onRelease` (`:114-117`) clears it silently.
  - No browser text names the gap:
    - `src/ui/state/laser-background-streaming-notice.ts:35-46` warns "keep KerfDesk visible" only when the worker is *unavailable*.
    - `src/ui/help/connection-help.ts:50-55` ("DISCONNECTS DURING A JOB?") names USB selective suspend and Windows Update, not sleep. The only keep-awake line is about the desktop app.
  - Mounted for every host at `src/ui/app/App.tsx:185`.
- **Anchor:**
  - **Ground truth:** W3C Screen Wake Lock API, Working Draft `https://www.w3.org/TR/2026/WD-screen-wake-lock-20260929/` (fetched 2026-11-09).
    - `request()` step 5: "If document's visibility state is "hidden", return a promise rejected with" NotAllowedError.
    - The page visibility change steps (§11.3) run "release a wake lock" on every screen lock when the state becomes hidden.
    - Pages are hidden when the tab is in the background or the window is minimised (Page Visibility). That quote was not fetched.
  - **Contract:** ADR-117 Decision (`DECISIONS.md:6100-6160`) keeps keep-awake a renderer concern "so OS display-sleep can't suspend the tab mid-stream". Its failure rule is "visible once … so a marathon burn is never silently trusted to a machine that will sleep". ADR-117 has no `powerSaveBlocker`, so in a browser the screen lock is the only keep-awake.
  - **Contract:** ADR-676 (`docs/decisions/ADR-676-jobs-stream-off-the-window-and-job-review-names-a-lit-stop.md:30`): "GRBL, grblHAL and FluidNC under M3: they keep S for the whole stall."
  - **Twin:** the desktop renderer keeps its page visible while minimised (`backgroundThrottling` off, ADR-354 Amd 1 / ADR-362), so it keeps the lock. In the browser the lock lapses.
- **Scenario:**
  1. A browser user Frames and Starts a long engraving with M3 constant power on a GRBL laser. Background streaming is on by default, so the job streams from the worker.
  2. They minimise Chrome or switch tabs and stay by the machine. Locking the screen probably has the same effect, but that was not verified.
  3. The browser releases the screen wake lock and refuses a new one while the page is hidden. The app pushes no notice.
  4. With no input and no power request held, the OS idle-sleep timer runs out. For example, Windows "Sleep after 30 minutes" on AC.
  5. Every process stops, the worker included. The controller drains its planner and then holds S over the stopped head until the operator hits the E-stop.
  6. Nothing at Start, in Job Review, in the connect toast or in the help warned this browser user. The single "Keep-awake unavailable" line appears only on browsers without the API.
- **Evidence:** REPRO (the app side) + SOURCE (the browser side).
  - Test: `scratchpad/zz-w9/mut/src/ui/app/zz-w9-wake-lock-hidden.test.ts`, with a copy at `scratchpad/zz-w9/zz-w9-wake-lock-hidden.test.ts`. It runs the real `installActiveJobWakeLock` and `useLaserStore` with a GRBL streamer state, and a `navigator.wakeLock` modelled on the spec: release on hidden, NotAllowedError on request while hidden.
  - Command: `node node_modules/vitest/vitest.mjs run src/ui/app/zz-w9-wake-lock-hidden.test.ts --maxWorkers=1 --reporter=verbose`. Output is in `scratchpad/zz-w9/wake-lock.out.txt`. Two tests passed. Results:
    - `visible: live locks = 1 requests = 1`
    - `hidden: live locks = 0 requests = 1 notices = []`
    - `visible again: live locks = 1`
  - The OS side is ground truth plus reasoning only. **Not reproduced:** whether Windows idle sleep fires while Chrome holds an open Web Serial port with a hidden page. No hardware or real-OS run was possible.
- **Severity reasoning:** proposed **P2**.
  - By effect this is the lit-stop class that v6 K1-P1-3 and ADR-676 treat as P1: a beam held lit over a stopped head, a burn-through and fire risk. Under METHOD §3 the narrow reach does not lower it.
  - It is held at P2 because the decisive link, OS idle sleep with a hidden tab streaming over Web Serial, is unreproduced. A READ/SOURCE chain cannot be P1 until a refuter reproduces it.
  - The refuter should raise it to P1 if they show idle sleep fires, for example with `powercfg /requests` showing no request from Chrome while a hidden tab streams.
  - What narrows it, but does not lower it: M3 is opt-in (ADR-676:49 notes M4 is the common default), and an M4 job goes dark when it stalls.
- **Related (twin, same root):** with Background streaming turned *off* in Machine Setup, the browser connect gives only a log line (`laser-connect-action.ts:308-310`). Job Review's lit-stop text names a busy window, not a hidden one (`window-stream-lit-stop-warnings.ts:24`). So the "keep KerfDesk visible" advice (`laser-background-streaming-notice.ts:37`) reaches the operator only in the *unavailable* case.
- **Novelty:** new. ADR-117's own Verification marks the long-burn behaviour "NOT verified". No audit under `docs/audits/` checked the hidden-tab release (searched for "wake lock").
- **Refuter:** PENDING.
- **Fix direction:**
  - In a browser, while a job is active and the page becomes hidden, push one notice: keep this tab visible, or turn off system sleep, or the computer may sleep mid-job.
  - Also say it once at Start in Job Review, and add one line to the connection help.

### W9-P2-2 — Firefox and Safari users are told their work "stays in this browser's autosave" and to "open KerfDesk in Chrome or Edge" to keep it; Safari deletes it after seven days of non-use and no other browser can reach it
- **Where:**
  - `src/ui/app/BrowserFilesNotice.tsx:24-26`: "your work is autosaved in this browser".
  - `src/ui/common/ConfirmSaveDialog.tsx:49-51`: "they stay in this browser's autosave. To keep them as a file, open KerfDesk in Chrome or Edge, or use the desktop app."
  - `src/ui/app/persistent-storage-request.ts:22-33` with its only caller `src/ui/app/project-save-action.ts:94`. `persist()` is asked only after a successful project save, which never happens in these browsers (`web-adapter.ts:84-86` throws `BROWSER_CANNOT_SAVE_FILES`).
- **Anchor:**
  - **Ground truth:** WebKit, "Full Third-Party Cookie Blocking and More" (`https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/`, 2020-03-24, fetched 2026-11-09; archive link not fetched).
    - The policy covers Indexed DB and LocalStorage.
    - It deletes "all of a website's script-writable storage after seven days of Safari use without user interaction on the site".
    - Home Screen web apps are exempt.
  - **Contract:** ADR-688 Consequences ("Firefox and Safari users learn the limit before they invest work, and keep it in autosave") and PROJECT.md "Delivery targets" (no download fallback, so no other way out).
  - **Ground truth:** storage is partitioned by browser profile, so Chrome cannot read Safari's or Firefox's IndexedDB.
- **Scenario:**
  1. A Safari user designs a project, sees the banner "your work is autosaved in this browser", and later closes with Cancel as the dialog advises.
  2. Following "open KerfDesk in Chrome or Edge", they open Chrome and find an empty canvas. The work is still in Safari, which has no Save, Export or download.
  3. They go back to Safari two weeks later, after at least seven days of using Safari without opening kerfdesk.com. ITP has deleted the autosave, Recover unsaved work is empty, and nothing was ever said about it.
  4. On Firefox the storage is best-effort and `persist()` was never asked, so eviction under storage pressure is possible but rarer.
- **Evidence:** READ + SOURCE.
  - Not reproduced: Safari was not run, and the 7-day ITP clock cannot be simulated here.
  - The code path is unambiguous: a Save in these browsers throws before `requestPersistentStorageOnce`.
- **Severity reasoning:** proposed **P2**.
  - It is a misleading result an ordinary Safari user will meet, and the text the app shows is the opposite of a warning.
  - It is not proposed as P1 for two reasons. The app does say up front that this browser cannot save files. And the loss happens only after a week of not using KerfDesk in Safari.
  - The coordinator may weigh it as P1 under "loses user data". The loss is silent and reachable today.
- **Novelty:** new. ADR-688 / #1564 added this text, and V7/V10 audited its recovery rows (V7-P1-1, V7-P3-2 KNOWN) but not the browser-storage ground truth. V7-P3-2 is the autosave-failure toast; this finding is about what the reassurance promises.
- **Refuter:** PENDING.
- **Fix direction:**
  - Say plainly that work kept only in this browser can be deleted by the browser (Safari after a week of not visiting) and cannot be moved to Chrome or the desktop app.
  - Ask `persist()` when the no-picker banner shows, if a prompt is acceptable there.
  - Or give these browsers one download-based export of the project, which needs a decision against "Delivery targets".

### W9-P3-1 — Help > Can't connect?'s "Full guide on kerfdesk.com" opens a page that is not deployed (404), and its camera line describes the desktop app
- **Where:**
  - `src/ui/help/connection-help.ts:10` (`CONNECTION_GUIDE_URL = 'https://kerfdesk.com/docs/#troubleshooting'`) and `:5-7` ("the published one on the website's Get started page").
  - `src/ui/help/ConnectionHelpDialog.tsx:43-47` (button "Full guide on kerfdesk.com").
  - `:57` "CAMERA: USB webcams work directly. RTSP/IP cameras need ffmpeg installed." This dialog also opens in the browser build.
  - Tests pin the URL rather than its existence: `connection-help.test.ts:37`, `DeviceSetupConnectHelp.test.tsx:68`.
- **Anchor:**
  - **Twin:** the deploy publishes only `dist/web` (`.github/workflows/deploy.yml:289`). `public/` has no `docs/`. `website/pages/docs.mjs:140-144` holds the `troubleshooting` section but is built only by `pnpm website:build` and "not deployed automatically" (`README.md:290-296`, ADR-524).
  - `public/_redirects` is empty, and `public/404.html` answers unknown paths. The service worker sends only the root to the app shell (`vite.config.ts:173`).
  - **Twin:** in a browser the camera is a desktop Pro tool (`refresh-picture.ts:79`), and an RTSP camera needs the desktop bridge (`camera-platform-capability.ts:3-10`), so "USB webcams work directly" and "ffmpeg installed" do not apply there.
- **Scenario:** A user who cannot connect opens Help > Can't connect? and clicks Full guide. They land on kerfdesk.com's 404 page, and the CH340 driver table they were promised is missing.
- **Evidence:** READ (deploy config, `public/` listing, website build scripts).
- **Severity:** P3, broken in-app help link plus doc drift.
- **Novelty:** new. Searched `docs/audits` for `docs/#troubleshooting` and `CONNECTION_GUIDE_URL`. Rolling v2 22 recorded that `/docs/` is undeployed but did not trace this app link to it.
- **Refuter:** PENDING.
- **Fix direction:**
  - Either publish the Get started page through `public/` as the safety page is, or point the button at a page that ships (for example `/support.html`).
  - Add a test that the in-app kerfdesk.com URLs resolve to files in `public/`.
  - Make the camera line say "desktop app".

### W9-P3-2 — For a FluidNC or grblHAL profile, the browser hides the network connection without saying it needs the desktop app
- **Where:** `src/ui/laser/MachineNetworkConnect.tsx:66` (`if (platform.machineNetwork === undefined || profile === null) return null;`). The web adapter has no `machineNetwork` (`src/ui/app/main.tsx:79` adds it for Electron only).
- **Anchor:**
  - **L9 twin:** the AI assistant, which is also desktop-only, says "This connection is available in the desktop app" (`src/ui/ai/AiAssistantDialog.tsx:25`).
  - Pro tools and the camera say "desktop app" too (`refresh-picture.ts:79`, `OutlinePhotoControls.tsx:46`).
  - The network connection is the one desktop-only capability that disappears without a word.
- **Scenario:** A FluidNC Wi-Fi owner who read the privacy page ("You explicitly connect a FluidNC or grblHAL network machine in the desktop app") opens the web app and sees only USB Connect. Nothing says the network form exists in the desktop app.
- **Evidence:** READ.
- **Severity:** P3, parity polish. USB still works and nothing wrong is sent.
- **Novelty:** new for the browser side. Rolling v2 22-P3-6 (KNOWN) covers the undeployed website pages that say there is no network control at all.
- **Refuter:** PENDING.
- **Fix direction:** For a network-capable profile in the browser, show one line in its place: "Wi-Fi/Ethernet connection is in the desktop app."

### W9-P3-3 — README says "Linux is web/PWA only", but ADR-607 ships a Linux AppImage and .deb and the download page offers them
- **Where:** `README.md:281-283`.
- **Anchor:** **Contract:** ADR-607 (`docs/decisions/ADR-607-linux-desktop-and-macos-integration.md`), the Linux targets at `electron-builder.yml:101-123` and the `#linux` card at `public/download.html:1268`. Linux publication is gated by `KERFDESK_UNSIGNED_LINUX_RELEASES` (`release-desktop-unsigned.yml:432`).
- **Scenario:** A contributor or Linux user reads the README and concludes there is no Linux desktop build.
- **Evidence:** READ.
- **Severity:** P3, doc drift.
- **Novelty:** new for this line. The same README's "no cloud … runs fully offline" (`README.md:52`) is KNOWN as v2 24-P3-6, and the website README's `salesOpen: false` (`website/README.md:65`; config `commerce.config.mjs:10` is `true`) is KNOWN as v2 22-P3-8. Neither is re-raised.
- **Refuter:** PENDING.
- **Fix direction:** Replace the sentence with the ADR-607 state: Linux AppImage and .deb exist, and publication is behind the release variable.

## Known (not raised again)

- **W1-P3-4:** the website's Free/Pro feature cards and camera wording.
- **W8-P3-2:** the draft privacy notice.
- **V7-P3-2:** the browser autosave-failure toast.
- **The owed Worker redeploy.**
- **v2 22-P3-6** (still open): the undeployed website pages (`docs-data.mjs:173`, `faq-data.mjs:123`, `laser.mjs:216`, `machines-data.mjs:28,61,151,182`) say KerfDesk has no Wi-Fi or network control. The desktop app has it (ADR-601).
- **v2 22-P3-8** (still open): `website/README.md:65` says the checkout is closed (`salesOpen: false`). `PROJECT.md:59` says the same.
- **v2 24-P3-1 / 24-P3-6** (still open): the PROJECT.md status line, and the "no cloud / fully offline" wording (`README.md:52`).
- **v2 19-P3-1** (still open): one non-fatal serial write error disables writing for the session (`web-serial.ts:206,215,285-289`, writer still `readonly`).
- **v2 19-P3-2** (still open): the opened-project write permission is requested after preparation, inside `write` (`web-adapter.ts:206,217-241`; `large-project-save.ts:79-83`).

## Status of earlier findings

| ID | Status at `b047e7bb6` | Evidence |
|---|---|---|
| v2 19-P2-1 save picker empties the file before preparation | **Fixed** (ADR-656 and Amendments 1–3) | `web-adapter.ts:76-79` documents truncate-at-pick. The seven v2 callers now use `pickPreparedSaveTarget` after preparing (surfacing via `CncSetupDocumentExport.tsx:217`, SVG `export-artwork-svg.ts:67`, format `export-artwork-format.ts:124`, `.rd` `save-rd-action.ts:75`, timelapse `TimelapseResult.tsx:93`, bitmap `save-processed-bitmap.ts:73`, multi-file trace `multi-file-trace-action.ts:368`) |
| v2 19-P3-1 write error disables writing | Open | see Known |
| v2 19-P3-2 permission after preparation | Open | see Known |
| v2 19-P3-3 folder save leaves a 0-byte file | **Fixed** | `web-adapter.ts:160-171` removes an entry this save created when the write fails |
| v2 22-P2-1 Pro list omits Registration Jig and Place Board | **Fixed** on the live pricing page (`commerce.config.mjs:44-54`; `public/pricing/index.html:301,317,386`). The undeployed pages remain under W1-P3-4 |
| v2 22-P3-1 privacy omits the dl.kerfdesk.com catalogue fetch | **Fixed** | `privacy.mjs:63-67` |
| v2 22-P3-2 privacy says an unconfirmed trial stops KerfDesk opening | **Fixed** | `privacy.mjs:227-233` follows `DESKTOP_LICENCE_WINDOW` |
| v2 22-P3-3 grblHAL raw TCP and Paddle link | **Fixed** | `privacy.mjs:114-116,163-168,290-293` |
| v2 22-P3-4 Cloudflare NEL undisclosed | **Fixed** (disclosed) | `privacy.mjs:148-157` |
| v2 22-P3-5 undeployed download copy contradicts the real installer | **Mostly fixed** by #1554 | `website/pages/download.mjs:216-220` now says the commercial edition is unsigned |
| v2 22-P3-6 undeployed copy under-claims | Open | see Known |
| v2 22-P3-7 no freshness check for the generated live pages | **Fixed in CI** | `ci.yml:79` runs `check:public-info`. The `release:check` gap is G8-P3-2 |
| v2 22-P3-8 README and governing docs describe a closed store | Open | see Known |
| v2 22-P3-9 "KerfDesk Licence Agreement" unpublished | Open (READ) | `website/pages/license.mjs:63`, `public/eula.txt:15` still name it |
| v2 24-P3-1 to 24-P3-8 (governing-doc drift) | Not re-audited. Spot checks: 24-P3-1 and 24-P3-6 open | `PROJECT.md:3`, `README.md:52` |
| v3 G8-P3-1 nothing notices an unenforced ruleset | Open (READ; outside W9, release/CI) | no workflow reads the ruleset state |
| v3 G8-P3-2 `check:public-info` not in `release:check` | **Open** | `package.json:59` (absent), `ci.yml:79` (present) |
| v3 G8-P3-3 ADR gate ignores inline amendment headings | Open (READ) | `check-adr-numbers.mjs:97-100` reads headings inside amendment *files* only |

## Refuted

None. The refuter has not run. Candidates the auditor dropped before raising:

- **A window still on the old build after Update in another window loads chunks that no longer exist.** Handled:
  - `preload-error-toast.ts:22-30` warns once and never reloads (ADR-060).
  - `lazy-load-failure.ts` shows the failure in the tool's boundary.
  - The streaming worker is created at connect, so a running job is not affected. A worker that fails to start falls back to the window and raises the warning toast (`laser-connect-action.ts:311-313`).
- **An older cached app opens a newer project and corrupts it.** Refused with "This project was saved with a newer KerfDesk … Update the app to open it." (`deserialize-project.ts:87`, `project-open-completion.ts:66`). A newer autosave is skipped (`autosave-inherited-slot.ts:25`).
- **A hidden tab starves window-transport streaming.** Not shown. The refill runs on read resolutions and a MessageChannel yield, not on timers (`serial-read-slice.ts:14-18`). Hidden-tab timer throttling is accounted for in the status poll and heartbeat (`laser-status-poll-schedule.ts:46-64`, ADR-356 and its amendments). The fallback toast that asks to keep KerfDesk visible is conservative, not wrong.
- **Abort cannot reach the controller from a hidden or throttled tab.** An operator can only press Abort in a visible tab. Phone and MCP control (which could act on a hidden page) are desktop-only (`remote-access/desktop-only.ts:2-4`).
- **The download page shows a link for an unverified file.** Refuted. Links appear only after `verifySignedEnvelope` (`desktop-release-manifest.mjs:140-176`: exact envelope shape, channel-bound Ed25519 key, `crypto.subtle.verify`). The page says the signature covers the "download details" and is "separate from Windows code signing" (`download.html:1150-1153`, `:1547-1550`). It does not claim the file itself was checked.

## Verified clean

- **Service worker (ADR-060/227):**
  - `registerType: 'prompt'`, with no injected inline registration.
  - The update applies only on the operator's click. `onNeedReload` reloads only the clicking window (`PwaUpdateWatcher.tsx:48-56`).
  - `sw.js` is `no-cache` (`_headers`).
  - The pages with prices, keys, releases and privacy are excluded from the precache and the navigation fallback (`vite.config.ts:145-173`).
  - The navigation fallback covers the root only.
  - `_redirects` is empty, so a missing hashed chunk is a real 404, not HTML with a 200.
  - The SW shim only adds COEP to same-origin worker scripts (`public/sw-worker-embedder-policy.js`).
- **Web CSP:** `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` limited to self, the loopback camera bridge and `dl.kerfdesk.com`; `frame-ancestors 'none'`; `form-action 'none'`. The download, buy and notice pages detach the app policy and carry their own.
- **Website secrets:** none in `website/**`, `public/**` or Pages config. The only keys are public Ed25519 SPKI anchors (`desktop-release-keys.json`, `desktop-licence-keys.json`). The Paddle client token is fetched at run time and shape-checked (`desktop-checkout-api.mjs:16-32`).
- **Website XSS:**
  - No `innerHTML`, `insertAdjacentHTML` or `document.write` in `public/*.mjs`.
  - Download links are built from verified manifest fields.
  - The checkout redirect accepts only `https://kerfdesk.com/buy.html?…` with no credentials or hash (`desktop-checkout-api.mjs:105-120`).
- **Privacy:** no cookies, analytics or third-party assets on the notice pages. The app's privacy part lists the catalogue fetch, licensing, camera loopback, relay, network machines, AI and NEL.
- **Safety copy:**
  - The in-app notice (`safety-notice.ts`), `docs/safety.md`, the live safety page (`website/pages/safety-data.mjs`), `public/eula.txt` and `README.md:42-45` all agree. Each says to use the physical E-stop or cut power, that Abort is not an E-stop, to stop the job and turn off air assist in a fire, to wear wavelength-rated glasses, never to cut PVC, and that watching remotely is not supervision.
  - The safety page's claims match the code: the Frame route is the job rectangle (`frame-lines.ts`, `buildFramePerimeter`), and Job Review warnings are advisory (no-go zones in `frame-no-go-warnings.ts`).
- **Lessons and glossary:**
  - "Words you'll see" (`project-tutorials.ts:59-124`): the G-code, GRBL, homing, origin, Frame (beam off; Start unlocks after a clean Frame) and Kerf Offset entries match the controls (`JobActionControls.tsx:125,133`, `CutSettingsCommonFields.tsx:136`).
  - The first-burn lesson: glasses, fire extinguisher, stay with it, ABORT JOB, origin front-left with User Origin. The default anchor is `front-left` (`project.ts:224`).
  - Ctrl+K: Ctrl+. aborts from any window, even inside editors (`use-job-shortcuts.ts:40-47`, capture phase). Ctrl+K panel entries never press a control (`search-entries.ts:1-6`).
- **Browser parity, honest notices:**
  - No file pickers: banner, Save dialog and error texts (ADR-688).
  - No WebSerial: `laser-command-family.ts:50`, `find-machine-phase.ts:123`.
  - AI, Pro tools and camera say "desktop app".
  - The worker fallback raises a toast; the opt-out writes a log line.
- **L8:** the PRs in these paths since 2026-10-27 were read:
  - #1483 and #1611 (`vite.config.ts` chunking only).
  - #1486 (website CNC and safety copy).
  - #1500, #1515, #1527 and #1534 (worker transports, owned by K/N/R audits).
  - #1554 (download steps and docs-data).
  - #1559, #1564 and #1581 (`web-adapter` no-picker errors and picker type labels).
  - #1598, #1604 and #1617 (no W9-path diff).
  - None introduced a W9 defect beyond those above.

## Not verified

- **W9-P2-1, the OS side:** whether Windows or macOS idle sleep fires while Chrome holds an open Web Serial port behind a hidden page, and whether locking the screen hides the page in Chrome on Windows. No real OS session or hardware run was possible. Also whether Chrome's Memory Saver can *discard* a background tab with an open serial port mid-job; Chromium's discard exclusions were not fetched.
- **W9-P2-2:** Safari and Firefox were not run, and the 7-day ITP clock was not simulated. The WebKit post was fetched live, but its archive link was not.
- **Real hidden-tab throttling** of the status poll, heartbeat and worker handover. Headless Chrome keeps pages visible (ADR-352 Amd 1 note), so no browser run was attempted. That also kept the run within the memory gate: 2.2 GB was available.
- **Lazy-loaded workers in a window that stays on the old build** (job preparation, trace) after Update elsewhere. Only the UI chunk path and the streaming worker's fallback were read.
- **The live site, Pages headers and NEL behaviour:** not contacted, by rule. All website checks are source-only.
- **Every lesson's step text against its control.** Only the safety-relevant lessons, the glossary and Ctrl+K were checked. `docs/tutorials/accuracy-audit-*.md` records an earlier full pass.
- **Frame invalidation on jog, home or origin reset** (safety page `:92`). It was taken from earlier audits and not re-run.

```json
[
  {"id":"W9-P2-1","severity":"P2","area":"platform-web-docs","file":"src/ui/app/use-active-job-wake-lock.ts","line":92,"anchor":"Ground truth W3C Screen Wake Lock WD-20260929 (request rejects while hidden; locks released on hidden); Contract ADR-117 (renderer wake lock is the only keep-awake, failure 'visible once'), ADR-676:30 (GRBL M3 keeps S for the whole stall); Twin desktop keeps page visible (ADR-354 Amd 1)","evidence":"REPRO+SOURCE","verdict":"PENDING","known":false,"summary":"In a browser a hidden or minimised tab loses the screen wake lock mid-job and cannot re-acquire it; no notice anywhere; OS idle sleep then stops the worker stream and a GRBL M3 job holds the beam over the stopped head. P1 by effect if the refuter shows idle sleep fires"},
  {"id":"W9-P2-2","severity":"P2","area":"platform-web-docs","file":"src/ui/common/ConfirmSaveDialog.tsx","line":49,"anchor":"Ground truth WebKit ITP 7-day cap on script-writable storage incl. IndexedDB (webkit.org/blog/10218, 2020-03-24); Contract ADR-688 consequences, PROJECT.md Delivery targets (no download fallback)","evidence":"READ+SOURCE","verdict":"PENDING","known":false,"summary":"Firefox/Safari banner and Save dialog say work stays in this browser's autosave and to open KerfDesk in Chrome/Edge to keep it as a file; Safari deletes the IndexedDB after 7 days of Safari use without a visit, Chrome cannot see it, persist() is only asked after a save that cannot happen"},
  {"id":"W9-P3-1","severity":"P3","area":"platform-web-docs","file":"src/ui/help/connection-help.ts","line":10,"anchor":"Twin deploy.yml:289 publishes dist/web only; public/ has no docs/; website/pages/docs.mjs undeployed (ADR-524, README:290-296)","evidence":"READ","verdict":"PENDING","known":false,"summary":"Help > Can't connect? 'Full guide on kerfdesk.com' opens https://kerfdesk.com/docs/#troubleshooting, which is not deployed (404); its camera line describes desktop-only RTSP/ffmpeg in the browser too; tests pin the URL string"},
  {"id":"W9-P3-2","severity":"P3","area":"platform-web-docs","file":"src/ui/laser/MachineNetworkConnect.tsx","line":66,"anchor":"L9 twin: AiAssistantDialog.tsx:25 and Pro/camera texts name the desktop app; network connect returns null silently","evidence":"READ","verdict":"PENDING","known":false,"summary":"For a FluidNC/grblHAL profile the browser silently omits the Wi-Fi/Ethernet connect form instead of saying it is in the desktop app"},
  {"id":"W9-P3-3","severity":"P3","area":"platform-web-docs","file":"README.md","line":282,"anchor":"Contract ADR-607 Linux desktop packages; electron-builder.yml:101-123; public/download.html:1268","evidence":"READ","verdict":"PENDING","known":false,"summary":"README says Linux is web/PWA only while ADR-607 builds a Linux AppImage and .deb and the download page offers them"}
]
```

## Refuter (2026-11-09)

- **Who / tree:** fresh refuter, `b047e7bb6` (repro export `scratchpad/j12-main`, `.audit-sha` = `b047e7bb6`). Own work in `scratchpad/zz-w9r`. No repo edits beyond this section.
- **Runs:** a headless Chrome for Testing 156.0.8078.4 (cached build) that I launched myself and drove over raw CDP, on a local page at `127.0.0.1:4899`. All other hosts were made unresolvable. The memory gate was 2041 MB, then 2360 MB. No hardware, no live site, nothing downloaded.
- **Sources fetched 2026-11-09:**
  - Microsoft Learn, SetThreadExecutionState: `https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate` (page `updated_at` 2025-07-01, git_commit_id `fa53641576e3603fa7b66d3a4ad969d3ce49d6f3`).
  - WebKit blog 10218, re-fetched. The quote matches the auditor's.
  - Neither has an archive link. Chromium source was not available locally and was not downloaded.

### Verdicts

| ID | Verdict | Severity | Evidence |
|---|---|---|---|
| W9-P2-1 | **CONFIRMED** at P2. The P1 chain is PLAUSIBLE, with one link unreproduced | P2 | REPRO in a real browser and at OS level, plus SOURCE |
| W9-P2-2 | **CONFIRMED** | P2 | READ + SOURCE (WebKit re-fetched) |
| W9-P3-1 | **CONFIRMED** | P3 | READ |
| W9-P3-2 | **CONFIRMED** | P3 | READ |
| W9-P3-3 | **CONFIRMED**, with a nuance | P3 | READ |

### W9-P2-1: the hidden or minimised tab, measured

What would make it false:
- (a) Chrome keeps the screen lock, or re-grants it, while the page is hidden.
- (b) Something else keeps the PC awake in the browser build.
- (c) The serial I/O of a streaming job resets Windows' idle timer.

Checked:

1. **The lock lapses at OS level, not only in the spec.** `zz-w9r/expC.cjs` reads the OS execution state through `CallNtPowerInformation(SystemExecutionState)` (`zz-w9r/power-state.ps1`, no admin needed). Output files: `expC-tab-headless.out.json` and `expC-minimise-headless.out.json`.

   | Step | Execution state |
   |---|---|
   | Before the lock | `0x00000000` |
   | `navigator.wakeLock.request('screen')` granted, page visible | `0x00000002` (ES_DISPLAY_REQUIRED) |
   | Another tab activated in the same window, page `hidden` | `0x00000000` |
   | Window minimised instead (`Browser.setWindowBounds` minimized), page `hidden` | `0x00000000` |
   | Visible again, no new request | `0x00000000` |
   | Re-requested | `0x00000002` |

   In the page, the `release` event fired at the moment the page was hidden, and a request made while hidden was rejected with `NotAllowedError` (`expB-tab-420s.out.json`, `wake`). So (a) is false in real Chrome, for a background tab and for a minimised window.

2. **The app's own guard is what silences ADR-117's warning.**
   - ADR-117 Decision (`DECISIONS.md:6136-6139`) makes failure "visible once" on the "first denial or missing API".
   - In a hidden page the browser's answer *is* a denial (NotAllowedError, measured above).
   - But `use-active-job-wake-lock.ts:92` returns before calling `request()` while hidden, so the `catch` at `:102-108` that would push `KEEP_AWAKE_UNAVAILABLE_MESSAGE` (`:13-15`, `:80-84`) never runs.
   - `onRelease` (`:114-117`) clears the sentinel silently.
   - So the contract is broken by line 92 itself, not only by a missing new notice. The auditor's Vitest (`zz-w9/wake-lock.out.txt`, `notices = []`) agrees.

3. **Nothing else in the browser build keeps the PC awake.**
   - `navigator.wakeLock`, `powerSaveBlocker` and keep-awake appear only in `src/ui/app/use-active-job-wake-lock.ts` and its mount at `App.tsx` (grep over `src/`).
   - ADR-117 says "No main-process `powerSaveBlocker`" (`DECISIONS.md:6125`), and the browser has no main process anyway.
   - (b) is false for KerfDesk's own code.

4. **Windows does not count serial I/O as activity.**
   - Microsoft's remark: "The system automatically detects activities such as local keyboard or mouse input, server activity, and changing window focus."
   - It then says activities "not automatically detected include disk or CPU activity and video display".
   - ES_SYSTEM_REQUIRED "Forces the system to be in the working state by resetting the system idle timer."
   - A USB-serial stream is none of the detected activities, so only an explicit request keeps the system out of idle sleep. (c) is false on the Windows side.

5. **Not reproduced, and the only link still open: does Chrome itself take a power request while a Web Serial port is open and in use?**
   - No Chromium source is cached locally.
   - A string scan of the cached `chrome.dll` (156.0.8078.4) found the `PowerSaveBlocker` and `WakeLock` machinery, a "Download in progress" blocker description and an `IsConnectedToSerialPort` symbol. It found no serial-related power or wake-lock description. This is weak negative evidence, not proof.
   - I could not open a real serial port without operating hardware. `powercfg /requests` needs elevation, which this session lacks.
   - The decisive check needs no admin and is cheap for the maintainer: during a real hidden-tab browser job, run `zz-w9r/power-state.ps1`. If it prints `0x00000000`, nothing holds the PC awake and the finding is P1 by METHOD §3 (beam lit over a stopped head, ADR-676:30 for GRBL, grblHAL and FluidNC under M3).
   - Until then, METHOD §4 keeps a chain with an unreproduced decisive link at P2. Reach is not the reason. The reason is the evidence bar.
   - What the user sees is unaffected either way: a hidden tab drops the only keep-awake KerfDesk asked for, and no text says so.

6. **Context on this PC, not a claim about defaults:** `STANDBYIDLE` is AC 0 / DC 0 (never). `VIDEOIDLE` is DC 600 s. The PC supports S0 Low Power Idle (Modern Standby), per `powercfg /q` and `/a`. So idle sleep would not fire on this machine. The scenario needs an OS sleep timer, which is common but not universal.

**Throttling of a hidden tab.** It does not starve the controller through timer throttling. Measured in `zz-w9r/expB.cjs` → `expB-tab-420s.out.json`: real Chrome, page hidden for 420 s.
- **Main-thread chained 100 ms timer:**
  - 1 s gaps for the first 5 minutes (max 1002 ms);
  - then intensive throttling: one gap of 2001 ms at 300 s, then 60000 ms at 360 s.
- **Dedicated-worker 4 ms `setInterval` → `postMessage` to the hidden page:** 0 gaps over 100 ms in 420 s, including the 2 minutes after the 5-minute mark.
- **A `MessageChannel` round trip on the hidden page** (the yield `serial-read-slice.ts:14-18,64-65` uses): 0 delays over 50 ms in 420 s.
- **What the code does with this:**
  - The default GRBL-family path (ADR-354) opens the port in the worker. The refill there is driven by read resolutions and holds no timer: `serial-worker-core.ts:1-25`, and grep finds no `setTimeout`, `setInterval` or `MessageChannel` in `serial-worker-core.ts` or `native-serial-worker-runtime.ts`.
  - The window fallback refills on reads plus a `MessageChannel` yield.
  - Only the status poll, heartbeat and start/pause helpers use timers. ADR-356 and Amendments 1–2 account for those (`laser-status-poll-schedule.ts:46-64`).
  - So the M3 lit-stop is not reached through throttling. It is reached only through OS sleep, item 5 above.
- **Not measured:**
  - The full app streaming to a simulated controller in a hidden tab. Playwright-launched pages never became hidden, even with its `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` defaults removed (`zz-w9r/expA.cjs`). And a worker-side serial mock cannot be injected without patching the worker. The paced fixture's own `setTimeout`/`setInterval` clock would also be throttled in a hidden page, which would confound a window-path run.
  - A real Web Serial read (a Mojo data pipe), as opposed to the measured task kinds.
  - ADR-354 Context's operator report ("streaming pauses when Chrome is minimised") predates the worker-owned port and is still unexplained by these measurements.
  - Chrome Energy Saver freezing, or Memory Saver discarding, of a hidden tab with an open serial port. Chromium's exclusion lists were not available.

**Challenges to the auditor:**
- The P2-1 Where should cite `:92` as the line that suppresses the ADR-117 denial warning, not only the one that skips re-acquiring.
- The "locking the screen probably has the same effect" step is still unverified. I verified minimise and background tab only.
- ADR-117 Consequences (`DECISIONS.md:6146`) says a screen lock keeps "the display (and with it, the system) awake". The measured state is `0x00000002` only: ES_DISPLAY_REQUIRED, never ES_SYSTEM_REQUIRED. Microsoft documents ES_DISPLAY_REQUIRED as resetting the *display* idle timer. Whether Windows idle-sleeps under a display-only request was not tested. That affects the visible case on both hosts, and it is listed under Not verified rather than raised.

### W9-P2-2: Firefox and Safari autosave reassurance

What would make it false: a way to get the work out of these browsers, a warning about eviction, or a `persist()` request that does fire.
- **No way out:**
  - Every Save and Export goes through `pickFileForSave`, which throws `BROWSER_CANNOT_SAVE_FILES` without `showSaveFilePicker` (`web-adapter.ts:84-86`).
  - Grep found no project or artwork download fallback (`createObjectURL`, `<a download>`, `navigator.share`). The only `download` uses are a G-code view PNG (`InspectorViewport.tsx:297`), a 3D screenshot (`Cnc3DFullPage.tsx:125`), data links inside a CNC setup document that itself needs the picker (`cnc-setup-package.ts:103`) and installer links.
  - Copy and Cut fill an in-app `sceneClipboard` only (`scene-clipboard-actions.ts:60-68`). No `clipboard.write` exists for designs.
  - Drag-out of designs exists only within the app (`use-design-hierarchy-transfer.ts:61`).
- **No eviction warning:** grep for Safari, evict and "7 days" in `src/ui` and `src/platform` finds no user text.
- **`persist()` never fires here:** its only caller is `requestPersistentStorageOnce`, from `project-save-action.ts:94`, after a save that cannot succeed in these browsers.
- **Ground truth re-fetched** (WebKit blog 10218, 2020-03-24). It deletes "all of a website's script-writable storage after seven days of Safari use without user interaction on the site". Indexed DB and LocalStorage are listed. Home Screen web apps "have their own counter".
- **Severity: P2 kept.**
  - The banner's first sentence, "This browser can't open or save files. Use Chrome or Edge, or the desktop app." (`BrowserFilesNotice.tsx:24-25`), reaches the user before any work. The loss is done by the browser's documented policy, after a week away from the site, in a browser the Delivery targets do not support for files (`PROJECT.md:54`).
  - The defect is the reassurance and the advice: "stay in this browser's autosave", and "open KerfDesk in Chrome or Edge" to keep them (`ConfirmSaveDialog.tsx:49-51`), which cannot move the work. That is a misleading result an ordinary user meets.
  - The coordinator may still weigh it as P1 "loses user data", since the reassurance undercuts the warning. I do not, because the opening warning is accurate and specific to files.
- **Not verified:** Safari and Firefox were not run.

### W9-P3-1, W9-P3-2, W9-P3-3

- **W9-P3-1 CONFIRMED (READ).**
  - `connection-help.ts:10` points at `https://kerfdesk.com/docs/#troubleshooting`, and `ConnectionHelpDialog.tsx:43-47` opens it.
  - `deploy.yml:289` deploys `dist/web` only. `public/` has no `docs/`.
  - `scripts/generate-site-pages.mjs --public-info` produces only the pricing, privacy, refunds, safety and terms pages.
  - `website/` builds to `website/dist` (`website/build.mjs:64`) and "is not deployed automatically" (`README.md:294-298`).
  - `_redirects` is empty, and the service-worker fallback is root-only (`vite.config.ts:173`).
  - The live site was not contacted, so the 404 is inferred from the deploy, not observed. If the website were hand-published elsewhere, it is not under this Pages project.
  - **Camera line (`:57`):** the RTSP/ffmpeg half is wrong in a browser. The loopback bridge is honoured only when the web app itself is served from localhost (`camera-platform-capability.ts:3-10`). The "USB webcams work directly" half is partly true, since a webcam can stream, but setup is a desktop Pro tool (`refresh-picture.ts:77-79`).
- **W9-P3-2 CONFIRMED (READ).**
  - `MachineNetworkConnect.tsx:66` returns `null` when the platform has no `machineNetwork`, and only `main.tsx:79` (Electron) supplies one.
  - No `src/ui` text tells a browser FluidNC or grblHAL user that the form is in the desktop app. The twin `AiAssistantDialog.tsx:25` does tell its user.
- **W9-P3-3 CONFIRMED (READ), with a nuance.**
  - `README.md:282-283` says "Linux is web/PWA only". `electron-builder.yml:101-123` builds an AppImage and a `.deb`, and the download page has a `#linux` card (`download.html:1268-1305`).
  - Publication is behind `vars.KERFDESK_UNSIGNED_LINUX_RELEASES == 'on'` (`release-desktop-unsigned.yml:432,492`). Its state is unknown here.
  - `PROJECT.md:58` words this correctly: until the switch is on, "Linux operators use the web/PWA". So the README is drift against both ADR-607 and PROJECT.md, not necessarily against what a Linux user can download today.

### New findings

None raised. The ADR-117 display-only lock observation above is recorded as a challenge and a Not verified item. It has no failure reproduced.

### Not verified (refuter)

- Whether Chrome holds any OS power request while a Web Serial port is open and streaming. This is the P1 link for W9-P2-1. No local Chromium source, no hardware, no admin `powercfg /requests`.
- Whether Windows idle-sleeps under a display-only (`0x00000002`) request.
- Whether locking the screen hides the page in Chrome on Windows.
- Chrome Energy Saver tab freezing and Memory Saver discarding with a serial port open.
- An app-level hidden-tab stream with a simulated controller (see the throttling notes for why).
- Safari and Firefox behaviour, and the live kerfdesk.com 404.

Refuter counts: raised 5, refuted 0, P1 0, P2 2, P3 3, known 9
