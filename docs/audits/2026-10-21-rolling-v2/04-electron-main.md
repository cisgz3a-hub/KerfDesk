# Rolling audit v2 — Electron main process, preload and desktop adapter

- **When:** 2026-10-21   **Tree:** origin/main @ `70c01e11f`
  (re-checked against `540120845` at the end: the only in-scope changes since are licensing
  files and ADR-623 Amendment 3, which keeps the camera bridge running for the whole session
  in commercial builds. None of the findings below changes.)
- **Scope:** `electron/**` except `electron/remote-access/**` and the licensing files
  (`desktop-licensing*.ts`, `licensing-*.ts`); `src/platform/electron/**`; the renderer half
  of the camera bridge (`src/platform/web/camera-bridge.ts`); fuses, ASAR and protocol settings
  in `electron-builder*.yml`. Entry points: the one `BrowserWindow`, the `app://app` protocol
  and its `/api/*` routes (there is no preload and no `ipcMain`), the camera bridge on
  `127.0.0.1:51731`, the machine-network TCP bridge, ffmpeg, the Artcraft editors,
  `app.relaunch` of a staged installer, and four update lanes.
  Governing: ADR-024, ADR-133, ADR-135, ADR-141 (+ Amd 1), ADR-248, ADR-249, ADR-378 (+ Amds),
  ADR-482, ADR-523 (+ Amd 5), ADR-544 (+ Amd 1), ADR-546, ADR-548 (+ Amd 1), ADR-550, ADR-551,
  ADR-561 (+ Amds 3–6), ADR-571, ADR-588, ADR-601, ADR-613, ADR-623, ADR-635.
- **Lenses run:** L5 and L2 on every sub-area. L1, L4, L6 and L7 on project files and the
  window/app lifecycle. L3 (twins) wherever two paths model the same thing. Five independent
  lens passes and five independent refuters, plus a sixth refuter for a candidate one refuter
  raised itself.
- **Counts:** 33 raised. One is merged as a duplicate (E-5 into A-7), leaving 32. 2 refuted →
  **P1 0 / P2 1 / P3 27** (+ 2 KNOWN).

## Headline

The window is hardened properly: 19 of the 20 Electron checklist items pass. There is no
preload or IPC, and every `app://` route needs its own header. Fuses are set on every lane.
The MCP server binds no listener in the desktop app. The one remaining P2 is the camera bridge's
fixed loopback port: the renderer never checks that whatever answers on `127.0.0.1:51731` is
KerfDesk's own bridge. A process that takes the port first therefore receives RTSP logins, and
the operator is told the wrong reason the bridge is missing.

Updates are not notify-only everywhere, and ADR-561 does not require them to be. The live
unsigned Windows lane downloads an Ed25519-verified installer, as ADR-561 allows, and it checks
out clean. Preview, macOS and Linux are notify-only.

The latent electron-updater lanes carry three verifier weaknesses (P3-1 to P3-3). One of them
is a PowerShell injection through a file name from the update feed. They must be fixed before
any electron-updater lane is switched on.

On project files, D-1 (P3-14) becomes a P2 on the first macOS or Linux release.

## Findings

### P2-1 — The camera bridge's fixed port has no server check: a squatter gets camera logins and the operator gets a wrong reason
- **Where:**
  - The bridge binds a fixed port: `electron/rtsp-camera-bridge.ts:13` and `:251-260`.
  - A bind failure is only logged: `electron/camera-bridge-lifecycle.ts:19-21`.
  - The renderer trusts that port: `src/platform/web/camera-bridge.ts:11`, `:25` (frame URLs)
    and `:96` (`/probe?url=<full RTSP URL>`).
  - CSP allows the port: `electron/main.ts:181`, `:203`, `:205`.
- **Anchor:**
  - **Twin.** Main knows the bind failed with `EADDRINUSE`. The renderer instead tells a desktop
    user the bridge "is available only in KerfDesk Desktop or local development"
    (`camera-bridge.ts:15-16`).
  - **Contract.** ADR-141 confines network cameras to Desktop. ADR-133's Consequences defer "a
    per-session bridge token replacing Origin-header trust"; that would not stop this, because
    nothing authenticates the server to the page. The project treats camera credentials as
    secret elsewhere (2026-09-28 P1 on ffmpeg error text; `camera-frame-proxy.ts:174-176`).
  - **Ground truth.** Loopback TCP ports are shared by every user session on one PC.
- **Scenario:**
  1. Another Windows account, or any program started before KerfDesk, listens on
     `127.0.0.1:51731`.
  2. KerfDesk's bridge fails to start, and that failure reaches only the support log.
  3. The operator connects an RTSP camera. The renderer sends
     `GET /probe?url=rtsp%3A%2F%2Fadmin%3AS3cret%40192.168.1.10…` to the squatter and shows
     whatever frames it returns.
  4. If the squatter does not answer like the bridge, the operator reads that network cameras
     need KerfDesk Desktop, while running KerfDesk Desktop.
- **Evidence:** REPRO (refuter A, `refuteA\a7\squat.mjs`; real `cameraBridgeLifecycle`, the
  bridge's verbatim `listen()`, real `createHttpCameraBridge`):
  - The lifecycle reported `["RTSP camera bridge could not start: EADDRINUSE"]`.
  - `health()` returned ok.
  - The squatter logged the `/probe` URL with `admin:S3cret@`.
  - Lens E reproduced the misleading reason separately (`refuteE\e5-camera.test.ts`).
- **Refuter:** CONFIRMED by two refuters (A-7 and E-5). The coordinator checked
  `camera-bridge.ts:11-16,96`: no token, nonce or server identity check, and the URL goes in
  the query. **Partly KNOWN:** `2026-07-26-kerfdesk-electron-desktop-quality-audit.md:40`
  (KD-ELEC-004) covered two KerfDesk instances fighting over the port, not the credential or
  fake-bridge angle.
  - **Severity call:** P2 because it needs local access. Camera logins are low value, so P3 is
    defensible.
- **Fix direction:**
  - Bind an ephemeral port, or keep 51731 but have main hand the renderer a per-launch secret,
    and have the bridge prove it (an `/health` reply MAC'd with that secret) before any URL is
    sent.
  - Put a bind failure on the camera UI with its real reason.

### P3-1 — electron-updater's Windows verifier runs PowerShell code from a feed-supplied file name (latent)
- **Where:**
  - electron-updater 6.8.10 `windowsExecutableCodeSignatureVerifier.ts:45` escapes only `'`
    (U+0027), and `:48` interpolates the path into a single-quoted `-LiteralPath`.
  - `AppUpdater.ts:726-734,786` keeps `basename(decodeURIComponent(url.pathname))` from the
    feed as the temp file name.
  - KerfDesk reaches it through `electron/auto-update.ts:46-55` (free signed lane).
- **Anchor:**
  - **Contract.** ADR-135: "An unsigned release-feed compromise cannot become a silent
    code-install path".
  - **Ground truth.** The PowerShell language spec §2.3.5.2 lists U+2018/U+2019 as single
    quotes; `CharTraits.cs` `IsSingleQuote()` agrees.
- **Scenario:** a tampered free-lane `latest.yml` names `KerfDesk-9.9.9’;<cmd>;’.exe`. The
  verifier's PowerShell string ends at the curly quote and `<cmd>` runs as the user before any
  signature result exists.
- **Evidence:** REPRO (refuter, `refuteC2b\repro.js`, installed verifier, identical to 6.8.10):
  - Output: `MARKER CREATED (injection executed): true`.
  - A second repro by the lens-C refuter (`refuteC\quote-check.cjs`): `m4rk created by injected
    PowerShell: true`.
- **Refuter:** CONFIRMED.
  - **Severity:** latent today, because 1.0.20 is commercial-unsigned and no electron-updater
    lane runs (`update-channel-trust.ts:27-35`, `commercial-update.ts:224-233`), and
    `dl.kerfdesk.com/desktop/latest.yml` returns 404. P2 if the free signed lane returns.
  - **Commercial signed lane:** immune. `commercial-update.ts:127,174-193` fixes the installer
    name from the Ed25519 manifest before download.
  - **KNOWN:** not this vector. GHSA-9jxc-qjr9-vjxq (CVE-2024-39698) fixed a different
    verifier bug.
  - **Upstream:** this is an upstream library bug. Disclose it privately to electron-builder.
- **Fix direction (also fixes P3-2 and P3-3):** set a custom
  `autoUpdater.verifyUpdateCodeSignature` that:
  - runs System32 PowerShell by full path (`windowsPowerShellCommand()`) with `execFile` and no
    shell;
  - passes the path through an environment variable;
  - fails closed on every error.

### P3-2 — The updater's verifier finds `powershell.exe` and `chcp` in the current folder first (latent)
- **Where:** the same verifier (`execFile` with `shell:true`, no `cwd`, bare `powershell.exe`).
  KerfDesk never overrides it (`electron/main.ts:173`; no `verifyUpdateCodeSignature`
  assignment in `electron/` or `src/`). It is reached from `auto-update.ts:46-55` and
  `commercial-update.ts:286-305`.
- **Anchor:** **Twin.** ADR-551 and `electron/ffmpeg-path.ts:3-5` reject the current-folder
  search for this exact reason. `electron/windows-registry-command.ts` runs System32 PowerShell
  by full path. **Ground truth:** Microsoft NeedCurrentDirectoryForExePathW: cmd.exe "uses the
  path `.;%PATH%`".
- **Scenario:** KerfDesk is started by double-clicking an `.lf2` in a folder that also holds a
  downloaded `powershell.exe` or `chcp.bat`. A trusted lane then verifies an update, the
  planted program runs, and an unsigned file is reported valid.
- **Evidence:** REPRO (`refuteC\verifier-check.cjs planted`): `marker.txt: planted chcp.bat
  ran`, and the verifier returned `null` (valid) for an unsigned file. Controls were rejected.
  The test harness sets `NoDefaultCurrentDirectoryInExePath=1`; a normal Windows session does
  not.
- **Refuter:** CONFIRMED. Latent: no electron-updater lane is live. The working directory for a
  file-association launch is PLAUSIBLE, not reproduced (ADR-551's own premise). Shortcuts start
  in the install folder.
- **Fix direction:** as P3-1. Also set `process.env.NoDefaultCurrentDirectoryInExePath = '1'`
  early in main.

### P3-3 — The updater's verifier passes an unsigned file when PowerShell cannot start (latent)
- **Where:** electron-updater 6.8.10 `handleError` (verifier `:119-143`). When the
  `ConvertTo-Json test` probe also fails, it resolves `null`, which means valid.
- **Anchor:** **Contract.** ADR-135 (as P3-1).
- **Scenario:** PowerShell is blocked by AppLocker or WDAC, or is missing from PATH. A
  compromised free feed then gets an unsigned installer accepted and installed on quit. The
  free lane's sha512 comes from the same feed.
- **Evidence:** REPRO (`refuteC\verifier-check.cjs no-powershell-on-path`): `'powershell.exe'
  is not recognized` → `TREATED AS VALIDLY SIGNED`.
- **Refuter:** CONFIRMED. Latent, for the free lane only: the commercial lane pins sha512 in the
  Ed25519 manifest. KNOWN: no. The 2026-09-27 S2 covered the missing-`publisherName` skip.
- **Fix direction:** as P3-1.

### P3-4 — `app://` worker scripts run with no Content-Security-Policy
- **Where:** `electron/main.ts:280-287` (CSP only through `webRequest.onHeadersReceived`) and
  `main.ts:264` → `renderer-isolation.ts:26-34` (adds COOP/COEP to protocol responses, not
  CSP).
- **Anchor:**
  - **Twin.** `public/_headers` gives the web build's workers the CSP.
  - **Contract.** `main.ts:455` says "No remote network service is allowed by Electron CSP".
    ADR-643 §9 claims the CSP is applied "to every app:// response".
  - **Ground truth.** The HTML spec only inherits the owner's policy for local schemes;
    otherwise the policy comes from the worker script's own response.
- **Scenario:** any code running in one of KerfDesk's 44 module or classic workers can `eval`
  and send data to any internet host. Getting code into a worker would take a compromised
  dependency or an injection bug.
- **Evidence:** REPRO in Electron 44.8.0 and 44.5.1 (`refuteA\a1\main.cjs`, KerfDesk's chain
  copied verbatim):
  - In the worker: `eval` = 2; `import()` and `importScripts()` of remote code ran; the sink
    logged `/worker-leak?secret=module`.
  - The page itself was blocked.
  - webRequest never saw the worker script load.
- **Refuter:** CONFIRMED. No eval sink exists in today's worker code, so this is
  defence-in-depth plus a false contract: P3. KNOWN: no.
- **Fix direction:** add the CSP header to the protocol response in `withRendererIsolation`, and
  add a packaged check that a worker cannot eval.

### P3-5 — The support report leaks the Windows user name in `file://` stack frames
- **Where:** `electron/support-log.ts:108-123` (home-folder redaction) and `:40` (`\bKD\d+`).
- **Anchor:** **Contract.** ADR-546 item 2: the home folder is written as `~` "in either slash
  style and any case".
- **Scenario:**
  - The main process is ESM, so error stacks contain
    `file:///C:/Users/Jo%20Ann/AppData/Local/Programs/KerfDesk/…`. More than 20
    `console.warn('…', error)` sites mirror into the log, and the user name stays in the
    exported report.
  - Latent forms: 8.3 short names (`C:\Users\JOANN~1`) and a key glued to a word character.
- **Evidence:**
  - REPRO (`refuteA\a4\run.mjs` on the real `supportLogRedactor`): the file-URL and 8.3 forms
    are unchanged.
  - An Electron 44.8.0 ESM main run from a folder named `Jo Ann\Zoë` emitted
    `file:///…/Jo%20Ann/Zo%C3%AB/…`.
- **Refuter:** CONFIRMED. P3: the customer reads and sends the report themselves. KNOWN: no.
- **Fix direction:** also redact the `pathToFileURL(home)` form and the 8.3 short path. Drop
  the leading `\b` on the key pattern.

### P3-6 — "Full window" in the G-code inspector does nothing on desktop
- **Where:** the permission allowlist in `electron/trusted-renderer-policy.ts:127-133` has no
  `fullscreen`. The renderer side is `use-full-window.ts:12,26` and `InspectorViewerHeader.tsx`.
- **Anchor:** **Twin.** The renderer shows the control because `document.fullscreenEnabled` is
  true; main denies it. ADR-426 item 6.
- **Scenario:** clicking Full window leaves `requestFullscreen()` pending for ever. Electron
  never answers a denied request (`electron_api_web_contents.cc:1777`).
- **Evidence:** REPRO (`refuteA\a2a3`, Electron 44.8.0):
  - Denied: "pending after 5 s". Granting it: "resolved".
- **Refuter:** CONFIRMED. KNOWN: no.
- **Fix direction:** allow `fullscreen` for the trusted main frame, or hide the control on
  desktop.

### P3-7 — The static `app://` handler never decodes the URL path (latent)
- **Where:** `electron/main.ts:255-264`.
- **Anchor:** **Twin.** The web host serves `My%20Font.ttf` as `My Font.ttf`.
- **Scenario:** any future asset whose name has a space or a non-ASCII character fails on
  desktop only (`caf%C3%A9.txt` gives `ERR_FILE_NOT_FOUND`, a network error, not a 404). No
  shipped asset has such a name today.
- **Evidence:** REPRO (`refuteA\a1`): `fetch('/My%20Font.txt')` was served the file literally
  named `My%20Font.txt`.
- **Refuter:** CONFIRMED, latent. KNOWN: no.
- **Fix direction:** decode, then re-run the `path.relative` escape check on the decoded path.
  Not decoding is what keeps `..%2f` inert today.

### P3-8 — PROJECT.md's desktop security paragraph is out of date
- **Where:** `PROJECT.md:664`.
- **Anchor:** **Contract.** The code (`trusted-renderer-policy.ts:127-133`,
  `desktop-project-routes.ts:8,69`) and ADR-550 item 4.
- **Scenario:** the paragraph:
  - omits `local-fonts` and `clipboard-sanitized-write`;
  - calls the project routes "GET-only" (one is a PUT);
  - leaves out the `/api/desktop`, `/api/machine-network`, `/api/support`,
    `/api/artcraft-studio`, `/api/licensing` and `/api/remote` routes;
  - says `connect-src 'self'` only (the CSP also allows the bridge).
- **Evidence:** READ (two lenses agree).
- **Refuter:** CONFIRMED. **Partly KNOWN:** `2026-07-10-consolidated-audit-v2.md:357` reported
  the permission list.
- **Fix direction:** rewrite the paragraph from the code.

### P3-9 — Leading-zero IPv4 in `rtsp://` URLs passes the private-network check
- **Where:** `electron/private-network-host-policy.ts:50-61`, reached from
  `rtsp-camera-bridge-policy.ts:19` and `camera-frame-proxy-policy.ts:34`. The connections are
  made at `rtsp-describe.ts:52` and by ffmpeg (`rtsp-camera-stream.ts:63,225`).
- **Anchor:**
  - **Twin.** `falcon-pointer.ts:33-37` and ADR-635 refuse leading zeros.
  - **Contract.** S03-001: never proxy to arbitrary internet hosts.
  - **Ground truth.** glibc `getaddrinfo` calls `__inet_aton_exact`; `inet_aton(3)` reads
    "octal (with a leading 0)".
- **Scenario:** `rtsp:` is not a special scheme, so `new URL` keeps `010.010.010.010` as text.
  The policy reads it as 10.10.10.10 and allows it.
  - On Linux, `net.connect` and ffmpeg reach 8.8.8.8.
  - On Windows, the string goes to DNS lookup, so whoever answers DNS chooses the IP.
- **Evidence:** REPRO (`refuteB\b3.refuteb.test.ts`):
  - Both policies return `ok` for `rtsp://010.010.010.010/live`, while `http://010.…` is
    refused.
  - Windows `getaddrinfo ENOTFOUND 0177.0.0.1`.
  - Linux behaviour comes from glibc source; it was not run.
- **Refuter:** CONFIRMED. P3: it needs a trusted Origin, and Linux is unpublished (ADR-613
  switches off). KNOWN: no. It contradicts the "octal rejected" notes in the 2026-07-11 Codex
  re-audit (line 56) and the 2026-07-10 audit (line 363), which hold for http(s) only.
- **Fix direction:** accept only a host that `net.isIP()` accepts in canonical form, or apply
  the Falcon pointer's plain-decimal rule to every camera URL.

### P3-10 — ffmpeg follows RTSP redirects to any host; the HTTP path refuses redirects
- **Where:** `electron/rtsp-camera-stream.ts:53-75` and `:216-236` (no `-protocol_whitelist`,
  no redirect limit).
- **Anchor:** **Twin.** `camera-frame-proxy.ts:146-150` uses `redirect: 'error'` so that a
  device "must not be able to bounce the proxy to a public URL".
- **Scenario:** a private-network RTSP device answers ffmpeg with 3xx pointing at a public host,
  and ffmpeg reconnects there. `/frame.jpg` with an `rtsp://` URL needs no probe first. FFmpeg
  builds before 2026-07-22 also forward the camera login to the new host.
- **Evidence:** SOURCE. FFmpeg `libavformat/rtsp.c:2253`: `if (reply->status_code >=300 &&
  reply->status_code < 400 && s->iformat)` → `goto redirect`. Upstream commit a441a2eb38
  "clear authentication on cross-origin redirects". Not run, because ffmpeg is not installed.
- **Refuter:** CONFIRMED by source. KNOWN: no.
- **Fix direction:** pass `-max_redirects 0` where the installed FFmpeg supports it, or check
  and pin the RTSP target.

### P3-11 — Stopping the camera bridge keeps serving a connection that had a request in flight
- **Where:** `electron/rtsp-camera-bridge.ts:262-266` (`server.close()` only) and
  `camera-bridge-lifecycle.ts:24-31`.
- **Anchor:** **Contract.** ADR-623 and Amendment 1 point 2: the bridge stops until the next
  renderer acknowledges.
- **Scenario:** a client keeps a keep-alive socket busy across a stop. Its later requests are
  still answered, and `close()`, and with it the queued restart, waits until that client
  leaves.
- **Evidence:** REPRO (`refuteB\b5.refuteb.test.ts`, also under Electron's Node 24.21.0): two
  requests after `close()` got 200, and `close()` resolved at 5.4 s and 7.1 s. The idle-socket
  part of the original claim is refuted: Node ≥19 closes idle sockets.
- **Refuter:** CONFIRMED in the narrowed form. On `540120845` (ADR-623 Amd 3) the bridge no
  longer stops on renderer reload in commercial builds, which reduces this further. KNOWN: no.
- **Fix direction:** call `server.closeAllConnections()` after `close()`, and kill live ffmpeg
  children on stop.

### P3-12 — Camera bridge comments still describe the hosted site as a bridge client
- **Where:** `electron/rtsp-camera-bridge.ts:53-59` and `camera-frame-proxy.ts:5-8`.
- **Anchor:** **Contract.** ADR-141: "Hosted origins are rejected before any discovery, probe,
  proxy, or ffmpeg work".
- **Scenario:** the Private Network Access preflight answers any Origin with
  `Access-Control-Allow-Private-Network: true`. This is harmless, because no CORS header is
  sent so the browser blocks the request, but the comments mislead readers.
- **Evidence:** REPRO: a preflight from `https://kerfdesk.com` got 204 with
  `Access-Control-Allow-Private-Network: true` and no CORS header, and the real request got
  403.
- **Refuter:** CONFIRMED (drift). KNOWN: no.
- **Fix direction:** answer the preflight only for allowed origins, and correct the comments.

### P3-13 — The AI assistant sends the photo with any request; ADR-571 says material requests only
- **Where:** `electron/ai/contracts.ts:48` and `ai/provider.ts:26-27`. The renderer side is
  `AiRequestFields.tsx:55,91-96`.
- **Anchor:** **Contract.** ADR-571 line 15: "optional selected photo for material requests".
- **Scenario:** a vector request with a photo attached sends the photo to OpenAI. The UI
  discloses this, but the prompt field's title says "Only this text is sent".
- **Evidence:** REPRO (`refuteB\b7.refuteb.test.ts`): `parseAiRequest` keeps the photo for a
  vector request.
- **Refuter:** CONFIRMED (drift). KNOWN: no.
- **Fix direction:** decide which is right and align the code, the ADR and the field title.

### P3-14 — On macOS/Linux, Save replaces a read-only project and says "Saved" (P2 on the first macOS/Linux release)
- **Where:** `electron/desktop-project-save.ts:55` (temp file opened `wx` with the default
  mode) and `:85` (rename). No writability check exists anywhere on the path
  (`desktop-project-routes.ts:107-124`, `desktop-project-file-check.ts`,
  `src/platform/electron/desktop-project-files.ts:77-104`).
- **Anchor:**
  - **Contract.** ADR-550 item 5: a file that "became read-only or stays held by another
    program reports that". WORKFLOW F-A11.
  - **Ground truth.** rename(2) needs write permission only on the folder.
  - **Twin.** Chromium's File System Access writer refuses: "Cannot write to a read-only file."
- **Scenario:** `chmod 444 Sign.lf2`, open it from Finder or the file manager, press Ctrl+S.
  The protected file is replaced, the toast says Saved, and the new file is 0644, so it is not
  read-only any more.
- **Evidence:** SOURCE + READ for POSIX (no macOS/Linux available). REPRO for the Windows half,
  which refuses correctly: `saveDesktopProjectFile(read-only): failed content= OLD`. The
  coordinator read the save path and found no mode check.
- **Refuter:** CONFIRMED.
  - **Why P3 today:** no shipped macOS or Linux build contains this code. It landed in
    `e4ef5afdd` (2026-09-29); the last Mac Preview is `v0.2.0-preview.13` (July); and
    `KERFDESK_UNSIGNED_MACOS_RELEASES` / `_LINUX_RELEASES` are not set (`gh variable list`,
    checked by the coordinator).
  - KNOWN: no.
- **Fix direction:** before the rename, check that the target is still writable (`access W_OK`,
  plus the macOS `uchg` flag) and answer "read-only". Fix this before switching on the
  macOS/Linux releases.

### P3-15 — Save resets the project's permissions and attributes
- **Where:** `electron/desktop-project-save.ts:55,85`.
- **Anchor:** **Twin.** Chromium's writer moves its swap file with
  `kPreserveDestinationPermissions` (`file_system_access_file_writer_impl.cc:280-282`).
- **Scenario:**
  - **Windows (today):** a Hidden `.lf2` loses Hidden after Save.
  - **POSIX:** a 0600 file becomes 0644.
  - The change of owner is not a difference: Chromium does the same.
- **Evidence:** REPRO (`refuteD\d2-attributes.mjs`): `before save: Hidden, Archive`, then
  `after save: Archive`.
- **Refuter:** CONFIRMED for mode and attributes; REFUTED for ownership. KNOWN: no.
- **Fix direction:** copy the target's mode and attributes onto the temp file before the
  rename.

### P3-16 — One failed read of the token key file throws away every Recent Projects path
- **Where:** `electron/desktop-project-token.ts:69-75` (every error reads as "no key") and
  `:58-62` (overwrites without `wx`).
- **Anchor:**
  - **Twin.** `electron/project-seal-key.ts` treats only ENOENT as missing and creates with
    `wx`.
  - **Contract.** ADR-378 accepts only "Losing the key file".
- **Scenario:** a transient EBUSY, EACCES or EMFILE on first use creates a new key. Every
  earlier Recent entry then answers 403 for good, or, when the write also fails, for that
  session, and paths opened in that session stop working after a restart.
- **Evidence:** REPRO (`refuteD\d3-key.mjs`): `key file replaced = true | old Recent token still
  verifies after restart = false`.
- **Refuter:** CONFIRMED. Rare, and no project data is lost. KNOWN: no.
- **Fix direction:** treat only ENOENT as missing, create with `wx`, and retry or fail on other
  errors.

### P3-17 — A project file held by another program opens with raw "Failed to fetch"
- **Where:** `electron/desktop-project-open.ts:117-120` (200 is answered before the file is
  opened) and `src/platform/electron/desktop-project-files.ts:247` (uncaught `blob()`
  rejection).
- **Anchor:**
  - **Contract.** WORKFLOW F-DESK4: "Could not open <name>: KerfDesk could not read it."
  - **Twin.** The Recent Projects path (`desktop-project-files.ts:142-152`) catches the same
    failure and shows that message.
- **Scenario:** double-click an `.lf2` that another program holds open with no sharing. The
  toast reads "Could not open Sign.lf2: Failed to fetch".
- **Evidence:** REPRO in real Electron 44.5.1 (`refuteD\d4-electron`):
  `{"status":200,"ok":true,"blobError":"TypeError: Failed to fetch"}`.
- **Refuter:** CONFIRMED. KNOWN: no.
- **Fix direction:** open the file before answering 200 (answer 409/500 on failure), and catch
  the body failure in the renderer.

### P3-18 — Saving a project whose name is over 228 characters always fails, with the wrong reason
- **Where:** `electron/desktop-project-save.ts:33-36` (the temp name adds 27 characters) and
  `:41-46`. The error then becomes 500 at `desktop-project-routes.ts:122-123`, and the renderer
  message is `desktop-project-files.ts:124`.
- **Anchor:**
  - **Contract.** ADR-550 items 1 and 5 ("Failures say why").
  - **Twin.** Chromium's swap name adds only 7 characters.
- **Scenario:** a legal 229–255-character name fails every Save with "It may be read-only or
  open in another program". The same name saves through the picker.
- **Evidence:** REPRO (`refuteD\d5-longname.mjs`): 228 characters `saved`; 229 characters
  `failed code=ENOENT`.
- **Refuter:** CONFIRMED. KNOWN: no.
- **Fix direction:** use a shorter temp suffix, and report errors other than EPERM/EBUSY/EACCES
  as a plain save failure.

### P3-19 — The project-file race test can time out under load
- **Where:** `src/platform/electron/desktop-project-files.race.test.ts:194` (`vi.waitFor` with
  its 1000 ms default, over real fsync'd saves).
- **Anchor:** **Contract.** METHOD L7: a regression test must be reliable.
- **Scenario:** one lens run failed on a loaded machine (`expected 'older alias' to be 'newest
  alias'`, 1436 ms). Saves took 165–315 ms each under CPU load.
- **Evidence:** REPRO once (lens). The refuter's 3 runs passed (110–158 ms).
- **Refuter:** PLAUSIBLE. KNOWN: no.
- **Fix direction:** give `vi.waitFor` an explicit timeout, or inject the save.

### P3-20 — The renderer-crash prompt does not say a constant-power laser or spindle can stay on
- **Where:** `electron/renderer-crash-recovery.ts:44-53`.
- **Anchor:**
  - **Ground truth.** GRBL v1.1 laser mode wiki: M3 holds power "regardless if the machine is
    moving, accelerating, or stopped". `grbl/stepper.c:393-397,742-747` turn the beam off on an
    empty buffer only for M4.
  - **Twin.** `src/ui/app/desktop-session-end.ts:26-30` and ADR-548's context warn about
    exactly this.
- **Scenario:** the renderer dies mid-job on an M3 dialect (`grbl-compatible`, the built-in
  Neotronics 4040 profile, a layer with `powerMode: 'constant'`) or a CNC spindle. The buffer
  drains and the beam stays lit on one spot. The prompt says only that the machine "may still
  finish moves it already received". Reload sends no reset, so the beam stays on until Abort.
- **Evidence:** SOURCE + READ.
- **Refuter:** CONFIRMED. Upper-end P3: crashes are rare, the prompt names the E-stop, and M4
  (the default) turns the beam off. **Partly KNOWN:** OR-1
  (`2026-09-25-controller-full-audit/tracks/OR.md:24`) covers M3 leaving the beam lit at job
  end.
- **Fix direction:** reuse the session-end wording, and offer Abort as the first action after
  Reload.

### P3-21 — At Windows shutdown, Frame, Jog, Home and Probe count as idle
- **Where:** `src/ui/app/desktop-session-end.ts:48-50` and `desktop-close-controller.ts:198-203`,
  against the close stop at `desktop-close-runtime.ts:68-79`.
- **Anchor:** **Contract.** ADR-548 decision 1: "A running job or a latched Fire, the same things
  the close handoff stops". That has been false since the same commit (`e4ef5afdd`) made close
  stop motion too.
- **Scenario:** Windows restarts for updates during a Home or a Frame. Windows is not asked to
  wait, and no Abort is attempted. The tool is off, so this is bounded motion that runs to its
  end.
- **Evidence:** REPRO (`refuteE`): `report= {"busy":false}`, `bestEffortStop= 0`.
- **Refuter:** CONFIRMED (ADR drift). KNOWN: no.
- **Fix direction:** either report motion as busy at session end, or correct ADR-548's
  justification.

### P3-22 — After a cancelled Windows shutdown, "Install and close KerfDesk" closes without installing
- **Where:** `electron/manual-update-quit.ts:19-24` (`sessionEnding` latches and is never
  cleared).
- **Anchor:**
  - **Contract.** ADR-561 Amendment 3.
  - **Ground truth.** Electron 44.8.0 `native_window_views_win.cc:467-481`: WM_QUERYENDSESSION
    always emits `query-session-end`, and a cancelled shutdown never emits `session-end`.
- **Scenario:** a shutdown is cancelled; KerfDesk itself delays shutdown during a job, which is
  one way this happens. Later, Install and close quits silently with no installer and no
  message.
- **Evidence:** REPRO (`refuteE\e3-latch.test.ts`): `canInstall= false … relaunch calls= 0`.
- **Refuter:** CONFIRMED. KNOWN: no. The test pins the latch but not the cancel case.
- **Fix direction:** latch only on `session-end`, or clear the latch when the window gets focus
  or input after `query-session-end`.

### P3-23 — A network machine session outlives a crashed or reloaded page for 15 s and blocks Connect
- **Where:** `electron/machine-network-bridge.ts:20-21,60-66`. Cleanup runs only on
  `will-quit` (`machine-network-routes.ts:25`).
- **Anchor:** **Twin.** `remote-access/desktop.ts:34` releases on reload and
  `render-process-gone`. The bridge's own comment says "retain no orphan socket".
- **Scenario:** crash, Reload, Connect (network). Connect answers "Disconnect the current network
  session before opening another." for 15 s, with nothing the page can disconnect.
- **Evidence:** REPRO (`refuteE\e4-lease.test.ts`): refused at t=0 and t=14 s, then OK at
  15.1 s.
- **Refuter:** CONFIRMED. **Partly KNOWN:** ADR-601 accepts renderer leases but not the refused
  reconnect.
- **Fix direction:** close the bridge's sessions on `render-process-gone` and on navigation of
  the main frame.

### P3-24 — The window's safety wiring in main.ts has no regression test, and one close branch is dead
- **Where:**
  - Untested wiring: `electron/main.ts:381,389,393,398,409,410,415`.
  - Dead branch: `desktop-window-close.ts:27,33` (`isWorkspaceAdmitted`, never passed by
    `main.ts:398-405` or `desktop-update-close.ts:34-41`).
- **Anchor:** **Contract.** METHOD L7, and ADR-548/553/482 (the guards these lines install).
- **Scenario:**
  - Deleting the close-guard, session-end, taskbar or crash-recovery line passes every test.
  - Clicking X between the splash and the startup gate's first effect shows "KerfDesk cannot
    reach its controls… Use the physical E-stop".
- **Evidence:** READ (grep of every test). REPRO of the dialog (`refuteE\e7-close-before-receiver.test.ts`).
- **Refuter:** CONFIRMED. KNOWN: no.
- **Fix direction:** add a source-structure test like `camera-bridge-lifecycle.test.ts:49-50` for
  each guard, and pass or delete `isWorkspaceAdmitted`.

### P3-25 — A failed "busy" report to main is never retried (latent)
- **Where:** `src/ui/app/desktop-session-end.ts:109-116`.
- **Anchor:** **Contract.** ADR-548 decision 1 ("Each change goes to the main process").
- **Scenario:** if a `busy:false` report fails, Windows is asked to wait for no reason and the
  taskbar stays stuck. If a `busy:true` report for a latched Fire fails, Windows is not asked to
  wait.
- **Evidence:** REPRO (`refuteE`): `calls= 1 delivered= [] warned= 1`. Practically unreachable:
  the route is in-process.
- **Refuter:** CONFIRMED, latent. KNOWN: no.
- **Fix direction:** mark a report as sent only after a 204.

### P3-26 — Any did-fail-load shows a blocking error box (latent)
- **Where:** `electron/window-readiness-policy.ts:39-42` (no frame or error filter) and
  `main.ts:390` (`dialog.showErrorBox`, which blocks main).
- **Anchor:** **Twin.** `support-log.ts:236` ignores sub-frame and aborted loads for the same
  event.
- **Scenario:** a stopped load in the print `srcdoc` frame raises "KerfDesk could not load its
  application window" and blocks the main process, which would stall a network-bridge stream.
- **Evidence:** REPRO (`refuteE\e9-fail-load.test.ts`): `reportFailure calls= 2` for a sub-frame
  failure and a main-frame -3 failure. Electron already drops most aborted navigations.
- **Refuter:** CONFIRMED latent; partly refuted for -3. KNOWN: no.
- **Fix direction:** react only to `isMainFrame` failures with codes other than -3, and use a
  non-blocking dialog.

### P3-27 — Artcraft's PowerShell helpers find PowerShell through the SystemRoot variable
- **Where:** `electron/artcraft-process-identity.ts:21-27` and `artcraft-window-channel.ts:20-26`.
- **Anchor:** **Twin.** `electron/windows-registry-command.ts:16-22` (ADR-592) resolves System32
  from loaded modules.
- **Scenario:** a launcher that sets `SystemRoot` makes Artcraft's identity check run its own
  `powershell.exe`. The attacker already controls the environment, and Artcraft needs the
  opt-in `KERFDESK_ARTCRAFT_ROOT`, so there is no boundary to cross.
- **Evidence:** REPRO (`refuteC\artcraft-twin.mts`): `readEditorProcessIdentity` started
  `…\fake-systemroot\System32\WindowsPowerShell\v1.0\powershell.exe`.
- **Refuter:** CONFIRMED (twin drift). KNOWN: no.
- **Fix direction:** reuse `windowsPowerShellCommand()`.

## Known (not raised as new)

- **B-1 — The bridge trusts any `http://localhost:*` / `http://127.0.0.1:*` Origin, including in
  packaged builds.**
  - Where: `electron/rtsp-camera-bridge.ts:201-233`.
  - Status: CONFIRMED in a real browser. A loopback-served page got `POST /falcon/pointer` →
    200 and `/probe` with the CORS header.
  - Accepted by ADR-133 Decision 1 ("outside the S03-001 drive-by-remote threat model"),
    ADR-141 and ADR-635 ("the usual trusted Origin").
  - The pointer is not the cutting laser (ADR-635).
  - Still worth fixing with P2-1: ADR-141 Amendment 1's "a web page cannot produce a request the
    bridge accepts" is false for loopback-served pages, and packaged builds need only
    `app://app`.
- **B-2 — `/probe` and `/stream.mjpg` accept loopback RTSP targets, while `/frame.jpg` refuses
  them.**
  - Where: `rtsp-camera-bridge-policy.ts:19`, raw socket error reflected at
    `rtsp-camera-bridge.ts:247`.
  - Effect: a localhost port oracle (REPRO: closed port `ECONNREFUSED`, silent port "timed out").
  - Reported in `2026-07-10-consolidated-audit-v2.md` §A.2.3 (line ~389). ADR-133 fixed only the
    frame proxy. Still open.

## Refuted

- **A-3** (denying `persistent-storage` makes autosave evictable). Electron's
  `special_storage_policy.cc` marks every origin persistent and unlimited, and Chromium's eviction
  skips such buckets. The quota observed equals free disk. Only the comment at
  `persistent-storage-request.ts:3-4` is wrong.
- **E-6** (a hung renderer gets no recovery offer). GRBL streaming runs in a worker (ADR-354), so
  a hung page does not stop the job and a reload would kill a live stream. `unresponsive` is
  already handled by the close guard and the support log. ADR-482 scopes recovery to crashes.
- **Partly refuted, folded into the findings above:** B-5's idle-socket half (Node ≥19 closes
  idle sockets), P3-15's ownership half (Chromium does the same), and P3-26's ERR_ABORTED half.

## Verified clean

- **Window settings:** `contextIsolation`, `sandbox`, `nodeIntegration:false`, `webSecurity`;
  DevTools off when `LOCKED_DOWN`; no webview, preload, contextBridge or ipcMain.
  `will-navigate` and `will-redirect` locked to `app://app`; `setWindowOpenHandler` always denies.
  `openExternal` only for credential-free https or exact KerfDesk download URLs; `openPath` only
  for userData.
- **CSP for documents:** inline script, eval, `connect-src`, `frame-src` and `form-action` are
  enforced (Electron 44.8.0 probe). blob: and data: workers inherit the CSP.
- **`app://` path traversal:** `%2e%2e`, `..\`, `..%2f`, `..%5c`, `%00`, drive letters, UNC and
  `app://APP` all fail or stay inside `dist/web`. Other hostnames are unreachable (CSP, navigation
  policy).
- **Route guard:** Chromium sends no Origin or `Sec-Fetch-*` to `app://`, so isolation rests on
  the per-route custom header, CORS refusal for a non-CORS scheme, and `connect-src`. `<img>` and
  `<form>` cannot reach any header route. Every route's method, header and body bounds were
  checked.
- **Permissions:** serial (picked port only), `fileSystem*` (the null-WebContents branch still
  requires `app://app`), video-only media, wake lock, `local-fonts`, clipboard write. Everything
  else is denied.
- **Debug switches (ADR-544):** `--`, `-` and `/` forms in any case are refused before any
  window. Native-smoke flags run only fixed scripts with a regex-checked key.
- **Fuses on every lane:** RunAsNode, NODE_OPTIONS and inspect off; ASAR integrity and
  OnlyLoadAppFromAsar on; file-protocol privileges off. Linux has no ASAR integrity: KNOWN,
  accepted by ADR-613.
- **MCP:** `server.ts` and `stdio.ts` are absent from the packaged runtime
  (`packaged-runtime-closure.test.ts:64-66`), so there is no desktop listener. All 46 commands are
  classified; every mutating or motion command is write- or control-scoped. `apply_edits` refuses
  control commands. `jog_hold_*` is not registered.
- **Camera bridge:**
  - Host check first (DNS rebinding); Origin required; binds 127.0.0.1.
  - The http(s) URL-parser tricks are refused after WHATWG normalisation (`0x0a.1`, `10.1`,
    `[::ffff:…]`, `0.0.0.0`, 169.254/16, 100.64/10).
  - `redirect:'error'`, an 8 MiB frame cap, bounded DESCRIBE, no CRLF injection.
  - ffmpeg runs from an argv array with no shell, on an `rtsp:` URL; slots are released
    correctly; ffmpeg is found by full path only (ADR-551, UNC allowed by that ADR).
- **Falcon pointer:** plain-decimal private IPv4 only, fixed port, path and body.
- **Machine-network bridge:** only through `trustedAppRequest`; one session at a time; strict
  write sequence; bounded queues; any host allowed, which ADR-601 permits.
- **AI assistant:**
  - Fixed OpenAI endpoint, `redirect:'error'`, 1 MB response cap, no tools. Output is only
    bounded geometry that the operator applies, so there is no path to machine control.
  - The key is kept with OS encryption and no plaintext fallback; on Linux it needs a keyring
    (v11/v12 tags).
- **Project files:** tokens are HMAC-SHA256 under a random key, bound to the path and checked
  before any disk access. No arbitrary-path read or write exists. Saves are atomic
  (`wx` temp file, fsync, rename) and the old file survives a failure. LightBurn files are never
  written. The path filter handles trailing dots, ADS, `..` and NUL.
- **Close and lifecycle:**
  - Abort is awaited before Save/unload, and a new job is re-stopped. "Install and close" never
    sends Abort.
  - A cancelled shutdown sends no Abort.
  - No reload shortcut exists.
  - Window placement survives a corrupt file or a missing monitor.
  - Camera bridge start and stop are serialised.
- **Update lanes (notify-only proof):**
  - **Preview (ADR-249):** one GET of a signed manifest (Ed25519, pinned key). It returns
    `{kind, version}`, and the only action opens a download page main rebuilds itself. Nothing
    downloads or runs.
  - **macOS/Linux commercial (ADR-613):** the same; `publish: null` and
    `writeUpdateInfo: false`, so no updater metadata ships.
  - **Commercial unsigned Windows (ADR-561, live in 1.0.20):** downloads only after a click.
    - Main derives the URL and cache path: `..` and foreign names are rejected.
    - SHA-256 is checked while streaming, and signature, eligibility and bytes again when armed
      and at quit.
    - The interactive NSIS installer runs through `app.relaunch({execPath, args:[]})` only after
      an approved close, never at session end.
    - electron-updater never runs on this lane.
  - **Free signed and commercial signed (electron-updater):** download and install on quit, but
    both are latent today. Their feeds return 404, and the trust metadata is false in 1.0.20.
    P3-1 to P3-3 apply before either is switched on.

## Not verified

- **macOS and Linux behaviour** (P3-9, P3-14, P3-15 POSIX half): no machine available. The
  findings rest on glibc, man7 and Chromium sources.
- **Working directory of a file-association launch on Windows** (P3-2 reachability): not
  reproduced in this harness.
- **ffmpeg's RTSP redirect** (P3-10): ffmpeg is not installed here, so the finding rests on
  source.
- **Hardware:** serial release on renderer death, DTR, whether Abort bytes reach the controller
  before the port closes, and the Falcon pointer on a real A1 Pro. No machine was operated.
- **Packaged builds:** probes ran a verbatim copy of main's policy chain on Electron 44.5.1 and
  44.8.0, not an installed KerfDesk.
- **Web Bluetooth:** there is no `select-bluetooth-device` handler, and Electron's default picks
  the first device. Only renderer code could reach it; not tested.
- **Out of scope, handed on:**
  - To session 02 (licensing): native-smoke `--kerfdesk-native-smoke-user-data=` gives any
    launcher a fresh profile in commercial builds (trial impact?).
  - To session 02 (licensing): `project-seal-key.ts` accepts Linux's shared fallback key, unlike
    the AI store's keyring check, and sets aside a key on any decrypt failure.
  - Remote access and the relay-hosted MCP transport belong to session 01.

Repro files for every REPRO above are in this session's scratchpad (`lensA`–`lensE`,
`refuteA`–`refuteE`, `refuteC2b`) under
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk--claude-worktrees-audit-v2-electron-main-663e74\062add50-6fc2-42c0-887c-cb6f4df1c401\scratchpad\`.

```json
[
  {"id":"P2-1","severity":"P2","area":"electron-main","file":"src/platform/web/camera-bridge.ts","line":96,"anchor":"Twin (main sees EADDRINUSE vs renderer reason); Contract ADR-141/ADR-133; ground truth: loopback ports are machine-wide","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: KD-ELEC-004 (2026-07-26) port conflict only","summary":"Fixed bridge port 51731 with no server check: a squatter receives RTSP logins and the UI gives a wrong 'Desktop only' reason"},
  {"id":"P3-1","severity":"P3","area":"electron-main","file":"electron/auto-update.ts","line":46,"anchor":"Contract ADR-135; ground truth PowerShell spec 2.3.5.2 smart quotes","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"electron-updater verifier escapes only ASCII quote; a feed file name with U+2019 runs PowerShell code (latent: no updater lane live; upstream bug)"},
  {"id":"P3-2","severity":"P3","area":"electron-main","file":"electron/main.ts","line":173,"anchor":"Twin ADR-551/ffmpeg-path.ts; ground truth NeedCurrentDirectoryForExePathW","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Updater verifier resolves powershell.exe/chcp from the current folder (latent)"},
  {"id":"P3-3","severity":"P3","area":"electron-main","file":"electron/auto-update.ts","line":53,"anchor":"Contract ADR-135","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Updater verifier treats PowerShell-unavailable as validly signed (latent, free lane only)"},
  {"id":"P3-4","severity":"P3","area":"electron-main","file":"electron/main.ts","line":280,"anchor":"Twin public/_headers; Contract main.ts:455, ADR-643 s9; ground truth HTML worker policy container","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"app:// worker scripts run with no CSP: eval and remote fetch/import allowed"},
  {"id":"P3-5","severity":"P3","area":"electron-main","file":"electron/support-log.ts","line":111,"anchor":"Contract ADR-546 item 2","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Support log keeps the user name in file:// stack frames and 8.3 paths"},
  {"id":"P3-6","severity":"P3","area":"electron-main","file":"electron/trusted-renderer-policy.ts","line":127,"anchor":"Twin use-full-window.ts / ADR-426 item 6","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Fullscreen permission denied: inspector Full window button hangs on desktop"},
  {"id":"P3-7","severity":"P3","area":"electron-main","file":"electron/main.ts","line":255,"anchor":"Twin web host","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Static app:// handler does not decode the path (latent)"},
  {"id":"P3-8","severity":"P3","area":"electron-main","file":"PROJECT.md","line":664,"anchor":"Contract code + ADR-550 item 4","evidence":"READ","verdict":"CONFIRMED","known":"partly: 2026-07-10-consolidated-audit-v2.md:357","summary":"PROJECT.md desktop security paragraph out of date (permissions, routes, CSP)"},
  {"id":"P3-9","severity":"P3","area":"electron-main","file":"electron/private-network-host-policy.ts","line":51,"anchor":"Twin falcon-pointer.ts/ADR-635; ground truth glibc inet_aton octal","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Leading-zero IPv4 in rtsp:// URLs passes the private-network check (Linux: public host; Windows: DNS lookup)"},
  {"id":"P3-10","severity":"P3","area":"electron-main","file":"electron/rtsp-camera-stream.ts","line":53,"anchor":"Twin camera-frame-proxy.ts redirect:error; FFmpeg rtsp.c:2253","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"ffmpeg follows RTSP 3xx redirects to any host"},
  {"id":"P3-11","severity":"P3","area":"electron-main","file":"electron/rtsp-camera-bridge.ts","line":262,"anchor":"Contract ADR-623 + Amd 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Bridge stop keeps serving an in-flight keep-alive connection and delays restart"},
  {"id":"P3-12","severity":"P3","area":"electron-main","file":"electron/rtsp-camera-bridge.ts","line":53,"anchor":"Contract ADR-141","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Stale hosted-site comments; PNA preflight answers any Origin"},
  {"id":"P3-13","severity":"P3","area":"electron-main","file":"electron/ai/contracts.ts","line":48,"anchor":"Contract ADR-571","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"AI assistant sends the photo with vector requests; ADR says material only"},
  {"id":"P3-14","severity":"P3","area":"electron-main","file":"electron/desktop-project-save.ts","line":85,"anchor":"Contract ADR-550 item 5; ground truth rename(2); Twin Chromium FSA writer","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"macOS/Linux: Save replaces a read-only project and reports Saved (P2 at first macOS/Linux release)"},
  {"id":"P3-15","severity":"P3","area":"electron-main","file":"electron/desktop-project-save.ts","line":55,"anchor":"Twin Chromium kPreserveDestinationPermissions","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Save resets file mode/attributes (Windows Hidden lost)"},
  {"id":"P3-16","severity":"P3","area":"electron-main","file":"electron/desktop-project-token.ts","line":69,"anchor":"Twin project-seal-key.ts; Contract ADR-378","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Transient key-file read error replaces the token key and invalidates Recent Projects paths"},
  {"id":"P3-17","severity":"P3","area":"electron-main","file":"electron/desktop-project-open.ts","line":117,"anchor":"Contract WORKFLOW F-DESK4; Twin Recent path","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Locked project file opens with raw 'Failed to fetch' instead of the contract message"},
  {"id":"P3-18","severity":"P3","area":"electron-main","file":"electron/desktop-project-save.ts","line":33,"anchor":"Contract ADR-550 items 1 and 5; Twin Chromium .crswap","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Project names over 228 characters always fail to save, with a read-only message"},
  {"id":"P3-19","severity":"P3","area":"electron-main","file":"src/platform/electron/desktop-project-files.race.test.ts","line":194,"anchor":"Contract METHOD L7","evidence":"REPRO","verdict":"PLAUSIBLE","known":false,"summary":"Race test uses default 1 s waitFor over real fsync'd saves; flaky under load"},
  {"id":"P3-20","severity":"P3","area":"electron-main","file":"electron/renderer-crash-recovery.ts","line":49,"anchor":"Ground truth GRBL laser mode M3; Twin desktop-session-end.ts","evidence":"SOURCE","verdict":"CONFIRMED","known":"partly: OR-1 (2026-09-25 controller audit)","summary":"Crash prompt omits that an M3 laser or spindle stays on after the renderer dies"},
  {"id":"P3-21","severity":"P3","area":"electron-main","file":"src/ui/app/desktop-session-end.ts","line":48,"anchor":"Contract ADR-548 decision 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Windows session end treats Frame/Jog/Home/Probe as idle though close stops them"},
  {"id":"P3-22","severity":"P3","area":"electron-main","file":"electron/manual-update-quit.ts","line":19,"anchor":"Contract ADR-561 Amd 3; Electron native_window_views_win.cc","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"A cancelled shutdown latches sessionEnding: Install and close quits without installing"},
  {"id":"P3-23","severity":"P3","area":"electron-main","file":"electron/machine-network-bridge.ts","line":64,"anchor":"Twin remote-access/desktop.ts; bridge comment","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: ADR-601 accepts leases","summary":"Network machine session outlives a crashed/reloaded page for 15 s and refuses Connect"},
  {"id":"P3-24","severity":"P3","area":"electron-main","file":"electron/main.ts","line":398,"anchor":"Contract METHOD L7; ADR-548/553/482","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"main.ts safety wiring untested; dead isWorkspaceAdmitted close branch"},
  {"id":"P3-25","severity":"P3","area":"electron-main","file":"src/ui/app/desktop-session-end.ts","line":109,"anchor":"Contract ADR-548 decision 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Busy report marked sent before delivery, never retried (latent)"},
  {"id":"P3-26","severity":"P3","area":"electron-main","file":"electron/window-readiness-policy.ts","line":39,"anchor":"Twin support-log.ts did-fail-load filter","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Any did-fail-load, incl. sub-frames, raises a blocking error box (latent)"},
  {"id":"P3-27","severity":"P3","area":"electron-main","file":"electron/artcraft-process-identity.ts","line":21,"anchor":"Twin windows-registry-command.ts (ADR-592)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Artcraft PowerShell path comes from the SystemRoot variable"},
  {"id":"B-1","severity":"P3","area":"electron-main","file":"electron/rtsp-camera-bridge.ts","line":201,"anchor":"Twin trusted-renderer-policy.ts; ADR-133/141/635","evidence":"REPRO","verdict":"CONFIRMED","known":"accepted: ADR-133 Decision 1, ADR-141, ADR-635","summary":"Bridge trusts any http://localhost|127.0.0.1 Origin in packaged builds (Falcon pointer reachable)"},
  {"id":"B-2","severity":"P3","area":"electron-main","file":"electron/rtsp-camera-bridge-policy.ts","line":19,"anchor":"Twin camera-frame-proxy-policy.ts; ADR-133 Decision 2","evidence":"REPRO","verdict":"CONFIRMED","known":"2026-07-10-consolidated-audit-v2.md A.2.3 (unfixed)","summary":"/probe and /stream.mjpg accept loopback RTSP targets: localhost port oracle"},
  {"id":"A-3","severity":null,"area":"electron-main","file":"electron/trusted-renderer-policy.ts","line":127,"anchor":"Ground truth Chromium eviction","evidence":"REPRO","verdict":"REFUTED","known":false,"summary":"Denied persistent-storage does not make desktop storage evictable (Electron marks all origins persistent)"},
  {"id":"E-6","severity":null,"area":"electron-main","file":"electron/renderer-crash-recovery.ts","line":62,"anchor":"ADR-482, ADR-354","evidence":"READ","verdict":"REFUTED","known":false,"summary":"No recovery offer for a hung renderer is by design: streaming runs in a worker"}
]
```
