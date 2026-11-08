# Rolling audit v11 — W3 Electron main process and updater

- **When:** 2026-11-08   **Tree:** main @ `5f09e1110` (repro tree: scratchpad `j10-main`, an export of that SHA; its `electron/` compares equal to main. Its `node_modules` junction holds Electron 44.5.1 and electron-updater 6.8.9, while `package.json` pins 44.9.1 and 6.8.10)
- **Scope:**
  - `electron/**` except `electron/mcp/**`, `electron/remote-access/**` (W2) and the licensing files (W1). Camera bridge internals are W4; only their main-process lifecycle and the status of the v2 04 camera findings are covered here.
  - The renderer halves that main talks to: `src/ui/app/desktop-close-runtime.ts`, `desktop-close-controller.ts`, `desktop-session-end.ts`, `src/platform/electron/desktop-project-files.ts`, `src/ui/recent-projects/*` (opens during a job).
  - Packaging: the six `electron-builder*.yml`, `scripts/nsis-file-associations.nsh`, fuses, ASAR, publish feeds, secrets.
  - Governing ADRs: ADR-024, ADR-135, ADR-141 Amd 2, ADR-248, ADR-354, ADR-366, ADR-375 Amd 9, ADR-378, ADR-482, ADR-483, ADR-544 (+ Amd 1), ADR-545, ADR-548 (+ Amd 1), ADR-549, ADR-552, ADR-555, ADR-561 (+ Amds 3–6), ADR-547 Amd 1, ADR-579, ADR-601, ADR-613, ADR-623 (+ Amds).
  - L8: every first-parent merge since 2026-10-21 that touched these paths (listed below).
- **Lenses run:** L5 (IPC/route surface, openExternal, navigation, CSP, fuses, deep link, updater trust), L6 (renderer crash, unresponsive window, force close, Windows session end, update during a job, failed download), L2 (GRBL/grblHAL/FluidNC behaviour when the host stops, Electron sync dialogs), L1 and L3 where a twin showed up, L8. L4 only for the open-file and second-instance paths. L7 only as a note (no new test-truth finding; the v2 one is still open).
- **Counts:** 2 raised → refuter pending → P1 1 / P2 1 / P3 0 (+ 33 KNOWN: 25 rolling v2 04 findings still open, 1 v9 R1 item re-observed, and the camera items handed to W4)
- **Security:** no SECURITY finding. There is still no preload, no `ipcMain`, no `contextBridge` and no `webview`. Every `app://app/api/*` route checks its own header and a same-origin request; no route takes a renderer-chosen file path, program or URL; `shell.openExternal` takes only credential-free `https:` or one of three exact KerfDesk URLs; fuses are set on every lane; no secret is in any build config. No `SECURITY-DETAILS.md` was written.

## Headline

The main process is hardened as v2 found it, and the only P2 from v2 04 (the camera-bridge port squatter) is fixed by #1441. The updater still checks out: fixed feed URLs, Ed25519 pinned anchors, no downgrade, SHA-256 re-checked at arm and at quit, and an update cannot install while machine work runs.

The problem is the failure path. **When the renderer process dies mid-job, main does nothing to stop the machine (W3-P1-1).** Under M3 constant power, or with a CNC spindle, the controller finishes its buffered moves and then holds the beam lit on one spot. For a network machine, main holds the live TCP socket and could send a stop, but it sends nothing. Its 15 s lease then closes the socket without a stop, and a reconnect is refused until then. The crash prompt says the machine "may still finish moves it already received", not that the beam stays on. This is rolling v2 04-P3-20 and 04-P3-23 seen as one failure path. It is rated P1 under this round's rule, and it is not KNOWN as a P1.

**Windows shutting down while the laser is lit at Idle does nothing (W3-P2-1).** This covers a Console `M3 S…` or a file that ends without `M5`. KerfDesk does not ask Windows to wait and sends no `M5`, although an ordinary close turns that laser off (ADR-375 Amd 9) and the update close refuses to go ahead.

## Findings

### W3-P1-1 — A renderer crash mid-job leaves an M3 beam or a spindle on: main sends no stop, even on its own network socket, and the prompt implies the machine will stop
- **Where:**
  - `electron/main.ts:414-432` wires `render-process-gone` to licence admission and the camera bridge (`rendererGone`), the session-end guard (`:410`) and the crash prompt. Nothing reaches the machine.
  - `electron/renderer-crash-recovery.ts:45-55` (the prompt text) and `:62-75` (the handler only asks).
  - `electron/machine-network-bridge.ts:60-67`: the bridge holds the TCP session after the renderer dies and its 15 s lease closes it, with no stop byte. `:20-21` refuses a new session meanwhile. The same happens through `dispose()` at `:55-59`, which runs on `will-quit` (`machine-network-routes.ts:14-26`), after a forced close.
  - `electron/session-end-guard.ts:88`: the crash resets the job report to idle, so a Windows restart right after the crash is not delayed.
- **Anchor:**
  - **Ground truth:** what the controller does when the host stops sending.
    - GRBL v1.1 turns the PWM off when the segment buffer empties only for a rate-adjusted (M4) block. Under M3 it holds power "regardless if the machine is moving, accelerating, or stopped". Source: `grbl/stepper.c:393-397,742-747` and the GRBL Laser Mode wiki, as cited and verified by the v2 04-P3-20 refuter. Inherited, not re-fetched under the no-download rule.
    - Closing the socket stops nothing on grblHAL (`telnetd.c` `streamClose`, `stream.c` L524-528) or FluidNC (`TelnetClient.cpp` L47-56, `Serial.cpp` L205-213). These are pinned in rolling v9 `R1-fix-marlin-watchdog.md`, refuter section. Inherited.
  - **Twin:**
    - The ordinary close sends Fire-off, `M5` and Abort before the window goes (`src/ui/app/desktop-close-runtime.ts:77-91`). The Windows session-end path tries the same Abort (ADR-548 decision 3).
    - Since #1534, every route on which the network worker closes a session waits for the store's reset first. The worker's own comment explains why: "Closing the socket does not stop a controller" (`src/platform/web/network-serial-worker-runtime.ts:13-16`).
    - Main's lease close and `dispose()` are now the only network close routes that send no stop.
    - Main's own comment knows the hazard: "a constant-power laser still on" (`electron/session-end-guard.ts:3-5`).
  - **Contract:** ADR-482 keeps the E-stop instruction in the crash prompt and states that "nothing is sent to the machine by the reload itself". It makes no claim that the machine stops, and the prompt implies it does.
- **Scenario:**
  1. A job runs under M3. That covers the `grbl-compatible` dialect, the built-in Neotronics 4040 profile, any layer with `powerMode: 'constant'`, or a CNC spindle. The machine is on a FluidNC or grblHAL TCP connection, or on USB.
  2. The renderer process dies. Large photo work runs in the renderer, so `oom` is one way; a crash or `killed` are others. The dedicated streaming worker dies with it (ADR-354).
  3. The controller runs out its planner and RX buffer, then stops with the beam lit at S on one spot, or the spindle turning in the cut.
  4. KerfDesk shows "the machine may still finish moves it already received. Use the physical E-stop … if the machine may be unsafe".
  5. **Network:** main holds the open socket for 15 s and writes nothing. If the operator presses Reload and Connect within those 15 s, Connect is refused ("Disconnect the current network session before opening another."). Then the lease drops the socket, still with no stop.
  6. **USB:** Chromium closes the port with the renderer, and main has no serial access.
  7. Either way the beam stays lit until the operator reloads, reconnects and presses LASER OFF or Abort (the J2-P2-1 control), or uses the E-stop.
- **Evidence:** REPRO (main side) + SOURCE (firmware, inherited).
  - Command: `node node_modules/vitest/vitest.mjs run --config <scratchpad>/zz-w3/vitest.w3.config.mts zz-w3-crash`, run in `j10-main`. The test uses the real `MachineNetworkBridge`, `installRendererCrashRecovery` and `installSessionEndGuard`, with a loopback grblHAL listener. Result: `zz-w3/crash.json`:
    - `jobBytesReceivedBeforeCrash: "G90 G21\nM3 S1000\nG1 X50 F600\n…"`
    - `bytesSentByMainAfterCrash: 0`
    - `sentRealtimeReset0x18: false`, `sentFeedHold: false`, `sentM5: false`
    - `socketStillOpenAt14s: true`, `socketClosedByLeaseBy15_5s: true`
    - `reconnectAt14s: "Disconnect the current network session before opening another."`
    - `windowsShutdownDelayed: false`
    - The prompt's `detail` has no "laser", "beam", "spindle" or "stays on".
  - Not run: the physical M3 hold, and Chromium closing the serial port on renderer death (no hardware).
- **Severity: P1.**
  - The effect is a lit beam held still on one spot, which is "can fire the laser … unexpectedly". The METHOD §3 P1 test has no reach clause, and this round's rule rates a crash path that leaves the beam lit as P1.
  - The only text before the output does not name it. It says the machine "may still finish moves it already received", which implies it then stops, and gives the E-stop only conditionally ("if the machine may be unsafe"). That is not a clear warning of this hazard (METHOD §3 clarification).
  - Under M4, the default, the beam goes dark when motion stops, so this is narrower than every crash. Reach does not lower a P1.
- **Novelty:** partly KNOWN.
  - 04-P3-20 (prompt wording, P3; re-observed as K-04-P3-20 in v5 J2, and noted in v6 K1 as "the unbounded stall").
  - 04-P3-23 (the 15 s lease refusing Connect, P3).
  - New here:
    - main itself sends no stop on a socket it still owns, which is now the last network close route without one since #1534;
    - the crash resets the session-end report, so a restart is not delayed;
    - the rating as one P1 failure path.
  - No open PR touches these files.
- **Fix direction:**
  - On `render-process-gone`, and before `dispose()` after a forced close, have main write the stop the window would send on each live network session before closing it: feed hold, then `0x18`, then the session's `M5`. Then drop the lease at once, so Connect is not refused.
  - Make the crash prompt say that a constant-power laser or spindle stays on after the buffered moves, and make Reload, then Connect, then LASER OFF/Abort the first action offered (04-P3-20's direction).
- **Refuter:** PENDING.

### W3-P2-1 — Windows shutting down while the laser is lit at Idle neither waits nor sends `M5`, though an ordinary close turns it off and the update close refuses
- **Where:**
  - `src/ui/app/desktop-session-end.ts:48-55`: `jobWouldBeCutOff` counts only a job or a latched Fire, so the report to main is `{ busy: false }`.
  - `electron/session-end-guard.ts:89-90,102-103`: `query-session-end` and `session-end` return at once when not busy, so Windows is not asked to wait and the window is never told (`desktopCloseController.bestEffortStop()`, which does handle `output`, runs only on the `ending` phase at `desktop-session-end.ts:86`).
  - Twins:
    - `src/ui/app/desktop-close-runtime.ts:36` puts `unownedControllerOutput` in the close snapshot, and `:77-81` sends `M5` (or `M5 M9`) before an ordinary close.
    - `:47-71`: `updateCloseBlocked` counts the same accessory report as busy.
- **Anchor:**
  - **Twin:** the ordinary close and the update close both act on a laser the controller reports on at Idle (ADR-375 Amd 9 decisions 4 and 5). Windows session end, the third way KerfDesk is closed, ignores it.
  - **Contract:** ADR-548 decision 1 counts "A running job or a latched Fire, the same things the close handoff stops". Since ADR-375 Amd 9, the close handoff also stops a laser left on at Idle, so the reason ADR-548 gives no longer matches what it counts. ADR-375 Amd 9 does not mention session end.
- **Scenario:**
  1. On a laser profile, the operator sends `M3 S300` from the Console, or runs a G-code file that ends without `M5`.
  2. The controller reports `<Idle|…|A:S>`, and KerfDesk shows LASER OFF (J2-P2-1).
  3. Windows Update restarts the PC, or the user signs out. KerfDesk lets Windows go at once and sends nothing, so the beam stays lit on one spot after KerfDesk is gone.
  4. Had the operator closed KerfDesk instead, it would have sent `M5` first ("Turning the laser off before closing.").
- **Evidence:** REPRO.
  - Command: `zz-w3/src/ui/zz-w3-session-end.test.ts`, run with the same config. It uses the real `parseStatusReport`, `unownedControllerOutput`, `desktopJobReport` and `installSessionEndGuard`. Result: `zz-w3/session-end.json`:
    - status `A:S` parsed `spindleCw: true`;
    - `unownedOutput: "laser"`, so the close would send `M5`;
    - `reportToMain: {"busy": false}`;
    - `windowsAskedToWait: false`;
    - `windowToldSessionEnding: 0`.
  - The ordinary-close half (`M5` sent) is READ at `desktop-close-runtime.ts:77-81`; the v5 J2-P2-1 fix tests cover it.
- **Severity: P2, not P1.**
  - KerfDesk does not light the beam here. The operator's command or file did, it was already lit before Windows ended the session, and the app was already showing LASER OFF for it.
  - The defect is that one of the three close paths misses its chance to turn it off and does not ask Windows to wait, so KerfDesk disappears with the beam lit and nothing on screen.
  - This is a broken contract with a clear failure scenario and a hazardous result. If the coordinator reads this round's rule ("a close path that leaves the beam lit") literally, it is P1.
- **Novelty:** new.
  - 04-P3-21 (Frame, Jog, Home and Probe count as idle at session end) is the motion cousin, with the tool off.
  - J2-P2-1 / ADR-375 Amd 9 fixed the ordinary close, Ctrl+. and the crash screen, but not session end.
  - No open PR touches these files.
- **Fix direction:** count `unownedControllerOutput(...) !== null` as busy in `desktopJobReport`, so Windows is asked to wait and the `ending` phase's `bestEffortStop` sends `M5`. Amend ADR-548 decision 1 (and ADR-375 Amd 9) to name it.
- **Refuter:** PENDING.

## Status of earlier findings at `5f09e1110`

Rolling v2 04 (electron-main), rolling v4 H10 and rolling v3 G7/G8 items in this area. "Unchanged" means `git diff 70c01e11f 5f09e1110` over the cited file is empty.

| ID | Status | Evidence |
|---|---|---|
| 04-P2-1 camera-bridge port squatter | **Fixed** by #1441 (ADR-141 Amd 2) | `camera-bridge-keys.ts:27-50` (per-launch proof key and client token), `camera-bridge-routes.ts:80-110`, `rtsp-camera-bridge.ts:114-122`. The renderer checks the HMAC proof before sending a camera URL (`src/platform/web/camera-bridge.ts:94-130`). W4 owns the depth check |
| 04-P3-1/2/3 electron-updater verifier (quote injection, current-folder search, fail-open) | **Open, still latent** | No `verifyUpdateCodeSignature` override or `NoDefaultCurrentDirectoryInExePath` anywhere in `electron/` or `src/`. The shipped commercial-unsigned builds set `kerfdeskUpdateChannelTrusted: false` (`electron-builder.commercial-unsigned.yml:10-12`), so no electron-updater lane runs. The live feed was not contacted |
| 04-P3-4 worker scripts have no CSP | **Open** | `renderer-isolation.ts:26-34` still adds only COOP/COEP to protocol responses |
| 04-P3-5 support log keeps `file://` user names | **Open** | `support-log.ts:111-123` unchanged |
| 04-P3-6 Full window hangs on desktop | **Open** | `trusted-renderer-policy.ts:127-133` (no `fullscreen`), `use-full-window.ts:12` |
| 04-P3-7 `app://` path not decoded | **Open** (latent) | `main.ts:256-264` |
| 04-P3-8 PROJECT.md security paragraph | **Open** | `PROJECT.md:664` still says "GET-only" and `connect-src 'self'`, and omits `local-fonts`, clipboard write and most routes |
| 04-P3-9 leading-zero IPv4 in `rtsp://` | **Open** (W4) | `private-network-host-policy.ts:50-61` unchanged |
| 04-P3-10 ffmpeg follows RTSP redirects | **Open** (W4) | `rtsp-camera-stream.ts` unchanged |
| 04-P3-11 bridge stop serves in-flight keep-alive | **Open** (W4) | No `closeAllConnections` in `rtsp-camera-bridge.ts` |
| 04-P3-12 stale hosted-site comments; PNA answered for any Origin | **Open** | `rtsp-camera-bridge.ts:95-100` |
| 04-P3-13 AI photo with any request | **Open** (W8) | `electron/ai/contracts.ts` unchanged |
| 04-P3-14/15/18 save: read-only on POSIX, attributes reset, names over 228 chars | **Open** | `desktop-project-save.ts` unchanged |
| 04-P3-16 token key replaced on a transient read error | **Open** | `desktop-project-token.ts` unchanged |
| 04-P3-17 locked file opens with "Failed to fetch" | **Open** | `desktop-project-open.ts:117-120` still answers 200 before the file is opened |
| 04-P3-19 race test timeout | **Open** | test unchanged |
| 04-P3-20 crash prompt omits the M3/spindle hazard | **Open**, folded into **W3-P1-1** | `renderer-crash-recovery.ts:45-55` unchanged |
| 04-P3-21 Frame/Jog/Home/Probe idle at session end | **Open** | `desktop-session-end.ts:48-50`; its laser-at-Idle cousin is **W3-P2-1** |
| 04-P3-22 a cancelled shutdown latches `sessionEnding` | **Open** | `manual-update-quit.ts:19-24` unchanged |
| 04-P3-23 network session outlives a crash by 15 s | **Open**, folded into **W3-P1-1** | `machine-network-bridge.ts:60-67`; REPRO above |
| 04-P3-24 main.ts safety wiring untested; dead `isWorkspaceAdmitted` | **Open** | No test reads `main.ts` for the crash, session-end, taskbar or close-guard lines. `desktop-window-close.ts:8,27,33` is still never passed |
| 04-P3-25 busy report never retried | **Open** (latent) | `desktop-session-end.ts` unchanged |
| 04-P3-26 any did-fail-load raises a blocking box | **Open** (latent) | `window-readiness-policy.ts` unchanged; `main.ts:391` |
| 04-P3-27 Artcraft PowerShell via SystemRoot | **Open** | `artcraft-process-identity.ts`, `artcraft-window-channel.ts` unchanged |
| 04 B-1 bridge trusts any loopback Origin | **Fixed in packaged builds** by #1441 | A keyed bridge answers only `app://app` (`rtsp-camera-bridge.ts:278-289`). Loopback origins remain for the unkeyed dev bridge |
| 04 B-2 loopback RTSP targets on `/probe` | **Mitigated** by #1441 | The policy is unchanged, but camera-naming routes now need the client token in keyed mode (`rtsp-camera-bridge.ts:114-122`). W4 to confirm |
| v4 H10-P2-1 failed confirmation reported as "updates ended" | **Fixed** by #1475 (ADR-547 Amd 1) | `update-status.ts:28-36` `heldReleaseState`; used by `manual-update.ts:147-151` and `commercial-update.ts:266-275,292` |
| v3 G7-P3-2/P3-3 crash screen, remote session on crash | Not re-checked (renderer, W2) | — |
| v9 R1-P2-2 refuter note: a sync dialog stalls the main process | **KNOWN, re-observed** | `decideUnavailable`/`decideUnsaved`/`decideUnsavedClose` still use `showMessageBoxSync` (`desktop-window-close.ts:60,75,90`). My own Electron 44.5.1 probe (`zz-w3/eprobe`) also showed it: a worker fetching an `app://` route every 50 ms was served 29 times in 1.65 s, then **0** times for 5.3 s while `showMessageBoxSync` was open, against an uninterrupted 101 with the async `showMessageBox`. The only route found during a job is still the "App controls unavailable" box, which names the E-stop first, so R1's P2 rating and its P1 raise condition stand. No other sync dialog was found that can open during a network job: the Leave/Stay prompt needs a renderer navigation, and the desktop renderer has none during a job |

## L8 — merges since 2026-10-21 in these paths

- **#1441 (camera bridge identity, ADR-141 Amd 2).** The `main.ts` route order gains `cameraBridge.routes` inside the workspace routes. A dev renderer gets an unkeyed bridge (`main.ts:213`). This fixes 04-P2-1 and B-1, and no regression was found in main. W4 owns the bridge internals.
- **#1475 (H10-P2-1).** The `manual-update.ts` and `commercial-update.ts` diffs only add a held state for wording. Eligibility, signature and download checks are unchanged.
- **#1546 (RTSP login probe), #1386/#1296 (Falcon pointer added, then removed).** These are camera paths (W4). The Falcon pointer route no longer exists in main.
- **#1527, #1500.** Tests only (the machine-network stall probe and renderer integration).
- **#1287.** Adds the `local-fonts` permission, as v2 already listed it.
- **#1321, #1323.** Notices and the AppImage toolset hook in `electron-builder*.yml`. Fuses, `files`, `publish` and NSIS are unchanged.
- **#1335.** ADR-623 Amd 3, licence window held off; read by G7.
- **#1604.** One line in `electron/mcp` (W2).

## Refuted

None. The auditor dropped these candidates:
- **The NSIS installer kills a running KerfDesk mid-job.** It does not: `customCheckAppRunning` (`scripts/nsis-file-associations.nsh:41-65`) never ends the process (ADR-555).
- **Opening a double-clicked `.lf2` while a job runs replaces the project.** It does not: the open waits behind `PendingProjectOpenBanner` while `isActiveJobStatus` (`src/ui/recent-projects/PendingProjectOpenBanner.tsx:15,24`, `dropped-project-open.ts:24`).
- **The `kerfdesk://licence` deep link carries data.** It does not: `isLicenceLink` (`licence-link.ts:37-54`) accepts one exact form, and only a key found on the clipboard is handed to the renderer, which still needs Activate.
- **electron-updater is instantiated in untrusted builds.** True (`main.ts:173,517`), but the constructor only sets fields and listeners (electron-updater 6.8.9 `AppUpdater.js`), and no check, download or install runs unless `configureAutoUpdater` admits a packaged free trusted build (`desktop-startup.ts:35-41`). The comment at `auto-update.ts:6-7` overstates this. Not raised.

## Verified clean

- **Window and renderer.**
  - `mainWindowWebPreferences` keeps `contextIsolation`, `sandbox`, `nodeIntegration: false` and `webSecurity` (`desktop-window-options.ts:15-29`). There is no preload, `ipcMain`, `contextBridge`, `webview`, `BrowserView` or second `BrowserWindow` (grep of `electron/`).
  - DevTools stay off when `LOCKED_DOWN` (`main.ts:107,373-379`).
  - The application menu has no reload, force-reload or DevTools roles (`application-menu-policy.ts:18`), and the context menu offers edit roles only.
- **Navigation and links.**
  - `will-navigate` and `will-redirect` are locked to `app://app` (`main.ts:341-347`), and `setWindowOpenHandler` never allows a window (`trusted-renderer-policy.ts:54-56`).
  - `openExternal` is reached only through:
    - the exact Preview download URL (`official-download-page.ts:28-44`);
    - credential-free `https:` (`external-links.ts:13-24`);
    - an exact checkout or purchase page (`desktop-licensing.ts:81-92`);
    - one rebuilt platform download page (`desktop-licensing.ts:251-261`).
  - `openPath` opens only userData (`desktop-window-commands.ts:28`).
- **CSP:** the document CSP is unchanged (`main.ts:198-210`). 04-P3-4, the worker CSP, is still open.
- **Route surface:** all 13 route families call `trustedAppRequest`, or `sameOriginRequest` for the project routes, with their own header (grep of `electron/**/*.ts`).
  - No route accepts a renderer-chosen file path: project files go only through an HMAC token bound to the path.
  - No route accepts a program or a URL to open. Artcraft runs only a hash-pinned executable under an opt-in root (`artcraft-installation.ts:27-37,62-63`).
  - The machine-network route opens TCP to any host, which ADR-601 permits; v2 noted the same.
- **Permissions:** unchanged since v2. Serial covers the picked port only (ADR-366/552), `fileSystem*`, video-only media, wake lock, `local-fonts` and clipboard write, all for the `app://app` main frame.
- **Packaging:**
  - Fuses on every lane: RunAsNode, NODE_OPTIONS and inspect are off; ASAR integrity and OnlyLoadAppFromAsar are on; file-protocol privileges are off.
  - `files` ships only `dist-electron`, `dist/web`, the release modules and the main-process closure.
  - No secret, token or private key appears in any `electron-builder*.yml`, `package.json` or `public/desktop-release-keys.json` (public keys only).
  - Linux and macOS publish nothing (`publish: null`, `writeUpdateInfo: false`).
- **Updater (live lane: commercial-unsigned Windows, manual):**
  - Fixed URLs with `redirect: 'error'`, and a bounded manifest verified against pinned stable anchors only (`manual-update-manifest.ts:39-58,103-122`).
  - **Downgrade:** a version not above the current one is "up-to-date", a backdated `publishedAt` is refused, and a version that regresses or changes within a session is refused (`manual-update.ts:124-136`).
  - The download is user-initiated only. It runs under a 10 min overall and 60 s idle deadline, is size-capped, has its SHA-256 checked while streaming, and goes to a `wx` 0600 file in an `lstat`-checked folder. The partial file is removed on failure (`manual-update-download.ts:12-31,62-122`, `manual-update-transfer.ts`).
  - Signature, eligibility and bytes are verified again at arm time and immediately before quit (`manual-update.ts:196-242`).
  - The installer runs through `app.relaunch({execPath, args: []})` only after an approved, completed close (`manual-update-quit.ts:30-55`).
  - **Update during a job:** the `prepare-update` close cancels while a job, a Frame preparation, Job Review, pending writes, or a controller in Run/Jog/Home/Hold/Door or with a spindle reported on is present (`desktop-close-runtime.ts:47-71,145-157`). "Update consent never authorises force-close recovery or stopping a machine" (`window-close-guard.ts:164-168`).
  - A failed or offline check sets `failed` and nothing installs. A metered network is not detected, but the only automatic traffic is the small signed manifest GET.
- **Installer upgrade path:**
  - userData is pinned to `%APPDATA%\laserforge` on every non-sandbox build (`desktop-identity.ts:22-35`).
  - `deleteAppDataOnUninstall` is not set anywhere, and the custom NSIS include deletes no data.
  - The NSIS check never ends a running KerfDesk (ADR-555).
  - Retention across real upgrades is qualified by `qualify-desktop-upgrade.yml` (`docs/audits/2026-10-01-historical-windows-upgrade-qualification.md`).
- **Close during a job:**
  - Ordinary close: Fire off, then `M5` for a laser lit at Idle, then Abort, then save (`desktop-close-runtime.ts:77-91`).
  - An unresponsive or crashed renderer gets the "App controls unavailable" choice, which names the E-stop. Forced close happens only on "Close app" (`window-close-guard.ts:160-179`).
- **Second instance and file associations:**
  - A second launch hands its paths over through `additionalData` and raises the window (`desktop-project-open.ts:59-80`). An open during a job waits behind the banner.
  - The `.lf2` association has a quoted open command (`nsis-file-associations.nsh:5-10`).
  - Debug switches in any form are refused before any window (ADR-544).

## Not verified

- **Hardware:**
  - Whether Chromium releases a Web Serial port, and what happens to DTR, when the renderer dies.
  - The physical M3 hold after a crash (firmware sources inherited from v2 04-P3-20 and v9 R1).
  - Whether a reconnect after Reload sees `A:S` and offers LASER OFF on a real controller.
- **GPU crash:** main has no handler beyond the support log (`support-log.ts:194`). A GPU process crash was not induced; Chromium normally restarts the GPU process without touching the renderer.
- **The live update feed and installed builds:** not contacted or launched, by rule. Whether `dl.kerfdesk.com/desktop/latest.yml` (free signed lane) is still 404 was not re-checked, so 04-P3-1..3 are latent on v2's evidence plus the shipped trust metadata.
- **The `relaunch` hand-off to NSIS:** not run. The installer's `FIND_PROCESS` might briefly see the exiting Electron relauncher, which runs the same `KerfDesk.exe`, and show "KerfDesk is open… Retry". That would be a UX nit, unconfirmed.
- **The existing focused suites** (`renderer-crash-recovery`, `session-end-guard`, `machine-network-*`, `manual-update*`, `window-close-guard`) were not re-run. Free memory fell to about 1.4 GB, under the 1.5 GB Vitest gate, after the two repros. The repro tree's Electron is 44.5.1, not the pinned 44.9.1, so the sync-dialog probe ran on 44.5.1.
- **macOS and Linux lifecycle** (`open-file`, window close keeping the app alive): read only.

Repro files are in the auditor's scratchpad, `zz-w3/`:
- `vitest.w3.config.mts`;
- `electron/zz-w3-crash.test.ts` → `crash.json`;
- `src/ui/zz-w3-session-end.test.ts` → `session-end.json`;
- `eprobe/main.cjs`, `run.cjs` → `log-sync.txt`, `log-async.txt`.

```json
[
  {"id":"W3-P1-1","severity":"P1","area":"electron-main-updater","file":"electron/machine-network-bridge.ts","line":60,"anchor":"Ground truth GRBL stepper.c M3 hold (v2 04-P3-20, inherited), grblHAL/FluidNC socket close is no stop (v9 R1, inherited); Twin desktop-close-runtime.ts:77-91 stopBeforeClose and network-serial-worker-runtime.ts:13-16 (#1534); Contract ADR-482 crash prompt","evidence":"REPRO","verdict":"PENDING","known":"partly: 04-P3-20 (prompt), 04-P3-23 (15 s lease); re-observed v5 J2 K-04-P3-20, v6 K1","summary":"Renderer crash mid-job: main sends no stop (not even on its own live network socket), holds it 15 s refusing Connect, closes it with no stop, resets the session-end report; prompt implies the machine will stop; an M3 beam or spindle stays on at one spot"},
  {"id":"W3-P2-1","severity":"P2","area":"electron-main-updater","file":"src/ui/app/desktop-session-end.ts","line":48,"anchor":"Twin desktop-close-runtime.ts:36,77-81 (close sends M5) and :47-71 (update close counts it busy); Contract ADR-548 decision 1 vs ADR-375 Amd 9","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Windows shutdown/sign-out with a laser reported on at Idle (Console M3, file without M5): report busy=false, Windows not asked to wait, no M5 sent; ordinary close would send M5"},
  {"id":"K-04-P2-1","severity":"P2","area":"electron-main-updater","file":"electron/camera-bridge-keys.ts","line":27,"anchor":"rolling v2 04-P2-1","evidence":"READ","verdict":"FIXED","known":"rolling-v2 04-P2-1, fixed by #1441","summary":"Camera bridge squatter: per-launch proof key and client token now"},
  {"id":"K-H10-P2-1","severity":"P2","area":"electron-main-updater","file":"electron/update-status.ts","line":28,"anchor":"rolling v4 H10-P2-1","evidence":"READ","verdict":"FIXED","known":"rolling-v4 H10-P2-1, fixed by #1475","summary":"Failed licence confirmation now reports licence-unconfirmed, not updates ended"},
  {"id":"K-R1-P2-2-dialog","severity":"P2","area":"electron-main-updater","file":"electron/desktop-window-close.ts","line":90,"anchor":"rolling v9 R1-P2-2 refuter","evidence":"REPRO","verdict":"CONFIRMED","known":"rolling-v9 R1-P2-2 (refuter note; P1 raise condition unchanged)","summary":"showMessageBoxSync stalls every app:// route (Electron 44.5.1: 0 requests served in 5.3 s vs uninterrupted with async); only the E-stop-naming 'App controls unavailable' box opens during a job"},
  {"id":"K-04-P3-1..27","severity":"P3","area":"electron-main-updater","file":"electron/","line":0,"anchor":"rolling v2 04","evidence":"READ","verdict":"CONFIRMED","known":"rolling-v2 04-P3-1..19, 21, 22, 24..27 open; 20 and 23 folded into W3-P1-1; B-1 fixed in packaged builds and B-2 mitigated by #1441","summary":"Status table above"}
]
```

## Refuter (2026-11-08)

Fresh context; did not raise either finding. Tree: main `5f09e1110` (repro tree `j10-main`; every file cited below compared equal to `git show 5f09e1110:<file>`). Free memory stayed at 1.3–1.49 GB, under the 1.5 GB Vitest gate, so the repros ran under plain Node 25 (`--experimental-transform-types` plus a `.js`→`.ts` resolve hook) against the real modules, not under Vitest. Files in the refuter scratchpad `zz-w3r/` (not in the repo).

### W3-P1-1 — CONFIRMED, P1 kept (scope corrected and widened)

**What would make it false:** main stops the machine somewhere on `render-process-gone`; the controller blanks the output when the host goes silent; a controller-side watchdog; closing the socket or port resets the controller; or the crash prompt clearly warns of a lit beam before it matters.

- **Main sends nothing (REPRO, independent harness).** `node --experimental-transform-types --import zz-w3r/register.mjs zz-w3r/crash-repro.mjs j10-main zz-w3r/crash.json`. It uses the real `MachineNetworkBridge`, `installRendererCrashRecovery` and `installSessionEndGuard`, a loopback grblHAL-raw listener, and a job of `G90 G21`, `M3 S1000`, `G0 X10 Y10`, `G1 X50 F600`, `G1 Y50`, then a crash with reason `oom` and Reload chosen after 3 s.
  - `bytesFromMainAfterCrash: 0`; no `0x18`, no `!`, no `M5`.
  - `connectAfterReloadAt5s` and `connectAt14s`: "Disconnect the current network session before opening another."
  - A fresh page cannot reach the old session: any other id gives "Network session is unavailable…" (`machine-network-bridge.ts:68-72`), and the ids are random UUIDs (`:29`).
  - The listener saw the socket close 14,802 ms after the crash (15 s from the last touch), with no stop. `connectAt15_6s: "opened"`.
  - `busyAfterCrash: false`, and a `query-session-end` right after the crash is not delayed (`session-end-guard.ts:88-90`).
  - The forced-close route: `dispose()` (what `will-quit` runs, `machine-network-routes.ts:14-16,23-26`) wrote 0 bytes and closed the socket within 1 ms.
  - Wiring at `5f09e1110`: the only `render-process-gone` listeners in main are `main.ts:414` (licence/camera), `session-end-guard.ts:88`, `renderer-crash-recovery.ts:62`, `window-close-guard.ts:58`, `window-readiness-policy.ts:45`, `support-log.ts:202` and `remote-access/desktop.ts:34`. None reaches the module-private bridge at `machine-network-routes.ts:7`. The remote-access twin does release its session on a crash (`remote-access/desktop.ts:34`); the machine bridge does not.
- **Firmware: does M3 stay lit after the host stops?** Yes for the GRBL family. This is inherited, not re-fetched (no-download rule), so the upstream anchor is **UNVERIFIED by me**. Two independent in-repo lines agree with it:
  - `src/core/gcode/stopped-head-power.ts:6-15` (rolling v6 K1, ADR-676) pins it: an M4 block turns the PWM off when the segment buffer runs dry; "an M3 block keeps S on, with no timeout". It cites `gnea/grbl stepper.c` L392-397/L741-746, `grblHAL stepper.c` L578-586 and FluidNC v4.0.3 `Stepper.cpp` L233-241.
  - ADR-375 Amd 9 Context (lines 9-14) treats a GRBL output left on at Idle until `M5`, a reset or an alarm as real, and ships LASER OFF for it.
  - KerfDesk's own Job Review text calls the window-route version "a burn-through and fire risk" (`window-stream-lit-stop-warnings.ts:63-64`). That warning is shown only when `jobStreamHost === 'window'` (`:35`), and the crash kills the worker route too, so no Start-time warning covers this case.
  - The precedent is K1-P1-3 (v6): the same lit stop for the length of a UI stall was rated **P1**. A crash is the unbounded form.
- **Is there a watchdog on the controller side?** None for the GRBL family (same pinned sources: "no timeout"). Marlin's cutter has `LASER_SAFETY_TIMEOUT_MS`, which is 1 s in stock builds and none when a build sets 0. Marlin's fan-output laser (`M106`) has none. Smoothieware goes dark at every stop (`stopped-head-power.ts:10-17`). So on stock Marlin with the cutter, the crash leaves a ≤1 s dwell, not an unbounded one. The auditor's scenario does not mention Marlin. The finding holds for GRBL, grblHAL and FluidNC, and for Marlin fan lasers or builds with the timeout set to 0.
- **The spindle:** under M3 or M4 a spindle stays on until `M5`, a reset or an alarm (ADR-375 Amd 9 Context). A spindle turning in a stopped cut is a hazard, but it is not "fire the laser". The P1 rests on the laser case; the spindle is supporting only.
- **Serial against network (code reading only):**
  - On USB, main has no handle on the port (Web Serial lives in Chromium; main has no serial code), so on serial the defect reduces to the prompt. On network, main owns the live socket (`machine-network-session.ts:21-31`) and could write a stop. That is the half that is new.
  - KerfDesk's own comments say the browser asserts DTR when it opens the port and that closing the port drops DTR (`src/core/recovery/link-loss-restart.ts:7-11`, `src/ui/state/laser-disconnect-stop.ts:5`, `src/platform/web/web-serial.ts:253`).
  - On an Arduino-class board, the auto-reset is the DTR-asserted edge on open. A close drops DTR, which is the opposite edge and does not reset the board (my circuit reasoning, not run). So the crash itself does not reset GRBL. The next **Connect** after Reload does reset an Arduino-class board, which then goes dark; a native-USB or 32-bit board does not.
  - Either way the beam stays lit until the operator reloads and reconnects, or uses the E-stop. Whether Chromium closes the port on renderer death, and the exact DTR/RTS order on ESP32 auto-reset circuits, were not verified.
- **The prompt misleads by omission (READ).** `renderer-crash-recovery.ts:48-52` says only that the machine "may still finish moves it already received". The E-stop advice is conditional ("if the machine may be unsafe"). The app already has the right wording ("a spindle or constant-power laser can stay on until the controller is reset", `desktop-session-end.ts:26-30`) and does not use it here. No warning that a lit beam stays on reaches the operator before the dwell, so METHOD §3's condition for lowering a P1 is not met.
- **Widening (READ): a latched Fire.** Fire sends `G1 F<f> M3 S<n>` (`src/ui/state/laser-fire-actions.ts:36-51`), which is a constant-power beam held still on every GRBL-family laser profile, whatever the job's M3/M4 setting. A renderer crash while Fire is latched leaves that beam on, and main sends no `M5`. So "under M4, the default, the beam goes dark" (the auditor's reach note) does not hold for Fire. The power is usually low, but it is unbounded in time.
- **Challenge (precision):**
  - "Main's lease close and `dispose()` are now the only network close routes that send no stop" is overstated. `MachineNetworkSession.close` also destroys the socket with no stop:
    - on an out-of-order write (`machine-network-session.ts:71-74`; this is R1-P3-1 part 2);
    - on a full write or receive queue (`:45-50`, `:92-95`);
    - on invalid Telnet framing (`:53-54`).
  - These are main-side, not lease or dispose. They are KNOWN (R1-P3-1) or latent, and they do not change the rating.
- **Severity:** P1 by effect. A beam held still on one spot is "can fire the laser … unexpectedly". The crash is reachable today (OOM, `killed`, `crashed`), and there is no reach clause. The network half is a twin gap against the ordinary close (`desktop-close-runtime.ts:77-91`), the worker routes after #1534 (`network-serial-worker-runtime.ts:13-16`) and the remote-access release (`remote-access/desktop.ts:34`). The ADR-482 "contract" anchor is weak: ADR-482 promises nothing about stopping. The P1 stands on Ground truth + Twin + the inadequate warning, not on ADR-482.

### W3-P2-1 — CONFIRMED, P2 kept (scenario corrected)

**What would make it false:** the session-end report counts a lit-at-Idle output, or another path sends `M5` at session end.

- **Main half (REPRO):** `zz-w3r/session-end-repro.mjs` → `session-end.json`. With the window's report `{busy:false}`, the real `installSessionEndGuard` neither delays `query-session-end` for `shutdown`, `logoff` or `critical`, nor sends the window any script on `session-end` (`windowScriptsSent: 0`).
- **Renderer half (READ; Node cannot load the store graph):**
  - `jobWouldBeCutOff` is `isActiveJob(streamer) || fireActive` (`desktop-session-end.ts:48-50`), and `desktopJobReport` returns `{ busy }` from it (`:53-56`). Neither reads `unownedControllerOutput`.
  - That function returns `'laser'` for a connected laser profile at Idle with `A:S` and no owner (`unowned-controller-output.ts:45-57`).
  - `bestEffortStop` would send the off block for `output` (`desktop-close-controller.ts:210-215`), but it runs only on the `ending` phase (`desktop-session-end.ts:86`), and that phase is never notified.
  - The auditor's Vitest repro is the second line of evidence.
- **Does the normal close send `M5`?** Yes. `desktop-close-runtime.ts:31-45` puts `output` in the snapshot, and `:77-81` sends `outputOffCommand(output)`, which is `M5` or `M5 M9` (`unowned-controller-output.ts:61-63`), before an ordinary close. The update close refuses in this state (`:57-69`, `desktop-close-controller.ts:113-126`).
- **Scenario correction:** a bare Console `M3 S300` does **not** light the beam under `$32=1`. GRBL syncs it at power 0 in G0 mode (`laser-fire-actions.ts:36-45`, and ADR-375 Amd 9 Consequences: "`A:S` at S0, for example `M3` in G0 mode under `$32=1`"). The lit-at-Idle states that are real:
  - a G-code file whose last burn is a `G1` under M3 with no `M5`;
  - a Console `G1 F… M3 S…`;
  - any `M3 S…` under `$32=0`.
- **P1 or P2: P2.**
  - The beam was lit by the operator's own command or file, and KerfDesk was already showing LASER ON with LASER OFF.
  - Session end neither lights it nor makes the physical output worse: the beam would stay on just as long if KerfDesk simply stayed open and nobody clicked LASER OFF.
  - What it loses is the one-click off control and the chance to send the `M5` that the other two close paths send. That is a broken twin contract with a clear failure scenario (METHOD §3 P2), and the gap is unbounded in time, which is above the motion cousin 04-P3-21 (P3, bounded, tool off).
  - It is not a P1: KerfDesk does not fire the beam, and the hazard is already on screen before the session ends.
  - (A Windows restart may also cut USB power to a USB-powered Arduino and so turn it off; that is unreliable and not relied on.)

### Verified-clean spot checks

- **Confirmed:**
  - No preload, `ipcMain`, `ipcRenderer`, `contextBridge`, `webview`, `BrowserView` or `WebContentsView` in non-test `electron/**`. The only `new BrowserWindow` is `startup-window-visibility.ts:4`. `shouldAllowWindowOpen` always returns false (`trusted-renderer-policy.ts:54-56`).
  - `openExternal` call sites:
    - `main.ts:352` (canonical download URL only);
    - `main.ts:361` (`externalBrowserUrl`: `https:`, no credentials, non-empty host, `external-links.ts:13-24`);
    - `desktop-licensing.ts:85` and `:89` (exact checkout and purchase checks);
    - `:260` (exact rebuilt platform page).
    - `openPath` opens only userData (`desktop-window-commands.ts:28`).
  - Fuses: explicit on `electron-builder.yml:47-55`, `preview.yml:39-49`, `sandbox.yml:37-45` and `commercial-unsigned-macos.yml:14-22`. `commercial.yml` and `commercial-unsigned.yml` inherit through `extends` and override no fuse. RunAsNode, NODE_OPTIONS and inspect are off; ASAR integrity and OnlyLoadAppFromAsar are on; file-protocol privileges are off. Built binaries were not inspected.
  - Updater:
    - fixed URL with `redirect: 'error'` and a destination re-check (`manual-update-manifest.ts:107-116`);
    - keys only from `public/desktop-release-keys.json`, stable channel (`:39-58`);
    - version not above the current one → up-to-date, a regressed or changed candidate → refused, a backdated `publishedAt` → refused (`manual-update.ts:124-136`);
    - signature and eligibility re-checked around the staged-bytes check (`:220-242`).
    - The Ed25519 verifier inside `public/desktop-manual-download.mjs` was not read.
  - Install refused during machine work: `prepareForUpdate` cancels on an active job, Fire, owned motion, a warning or `updateBlocked` (`desktop-close-controller.ts:113-126`). `updateBlocked` covers Frame preparation, Job Review, pending writes, Run/Jog/Home/Hold/Door and any reported spindle (`desktop-close-runtime.ts:47-70`). An unavailable renderer cancels an update close (`window-close-guard.ts:164-168`).
  - The installer keeps data: no `deleteAppDataOnUninstall` in any `electron-builder*.yml` or `package.json`, and no `RMDir` or `Delete` in `scripts/nsis-file-associations.nsh` or `scripts/nsis-sandbox.nsh`. userData is pinned (`desktop-identity.ts:22-35`). The NSIS check never ends the app (`nsis-file-associations.nsh:41-65`).
  - No secret appears in any builder config (grep for token, secret, password, private and similar); `commercial.yml:27-29` publishes a plain generic URL.
- **Overstated (no finding):** "all 13 route families … with their own header" does not hold for the three GET project routes.
  - They check only the method and an exact URL: no header and no same-origin (`desktop-project-routes.ts:72,151-159`). Only the PUT save checks `X-KerfDesk-Project` and same-origin (`:126-134`).
  - This matches ADR-378 decision 7 ("ADR-249's validation (GET only, exact scheme, host and path …)").
  - No other origin loads in the session, and the file routes still need the path-bound HMAC token, so this is not a SECURITY finding. The report's sentence should be corrected.
- **Not confirmed:** the `relaunch` → NSIS hand-off. The installer is started with `args: []` (`manual-update-quit.ts:48`), so `${isUpdated}` is false, and if Electron's relauncher `KerfDesk.exe` is still alive when `FIND_PROCESS` runs, the operator gets the "KerfDesk is open… Retry" box (`nsis-file-associations.nsh:56-63`). Not run, by rule. This is the same open item as the auditor's.

### New findings

None raised. The latched-Fire case is folded into W3-P1-1 as a widening, not a new ID. No SECURITY finding: no renderer-to-main escalation, no arbitrary file or command access, no unsafe `openExternal`, no update spoofing or downgrade route, and no secret in config. No `SECURITY-DETAILS.md` was written.

### Not verified (refuter)

- Vitest runs: none. Memory stayed under the 1.5 GB gate, so the renderer half of W3-P2-1 is READ plus the auditor's Vitest repro.
- The upstream firmware sources were not fetched (no-download rule). They are UNVERIFIED by me, but agree with KerfDesk's own pinned notes (`stopped-head-power.ts`, ADR-375 Amd 9) and the v6 K1 and v9 R1 refuters.
- Hardware: the physical M3 or Fire hold after a crash, Chromium closing the Web Serial port on renderer death, and DTR/RTS order on ESP32 auto-reset boards.
- The lease firing after a long `showMessageBoxSync` stall (the `decideUnavailable` box held over 15 s while the worker streams). This is KNOWN territory (R1-P2-2 / K-R1-P2-2-dialog) and was not run in Electron.

Refuter counts: raised 2, refuted 0, P1 1, P2 1, P3 0, known 33
