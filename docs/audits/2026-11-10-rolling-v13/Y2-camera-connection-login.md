# Rolling audit v13 — Y2 Camera connection and login

- **When:** 2026-11-10, to 09:00 +0800   **Tree:** origin/main @ `4c4b98fd0`. Its camera, electron, io and support code is identical to `f61a0757a` (`git diff --stat f61a0757a 4c4b98fd0` touches rotary files only). Repros ran on the scratchpad export `j19-main` (`f61a0757a`, `node_modules` a junction).
- **Scope:** USB, RTSP, MJPEG and HTTP snapshot sources; the RTSP login probe (#1546); FFmpeg by full path (ADR-551); the bridge and camera addresses (ADR-141 Amd 2); the phone camera (ADR-448); several cameras (ADR-446); and ADR-692 ("a camera login never reaches a saved or shared file") on every save, export and share route.
  - Code read: `electron/*camera*`, `electron/rtsp-*`, `electron/ffmpeg-path.ts`, `electron/private-network-host-policy.ts`, `src/core/camera/camera-address-login.ts`, `camera-capture-binding.ts`, `model/public-camera-identity.ts`, `src/ui/camera/{frame-source,phone-camera-address,CameraSourceView,decode-jpeg}.ts(x)`, `src/ui/camera/panel/**`, `src/ui/camera/calibrate/CameraPickStep.tsx`, `src/ui/camera/helpers/{auto-start,view-reference}.ts`, `src/ui/state/camera-*.ts`, `src/platform/web/camera-bridge.ts`, the project, autosave, template, machine-profile and last-machine serializers, `src/ui/support/**`, `electron/support-log.ts`, `src/ui/remote-control/**` (camera parts), and every `navigator.clipboard.writeText` caller.
- **Lenses run:**
  - **L5 (security / trust):** synthetic logins (user `y2-user` and a password marker with a fresh random suffix per run) entered through every input route, then every save and share route run and grepped (route matrix). The real keyed bridge was driven over HTTP against RTSP handshake stubs and an impostor on the bridge's side of the trust boundary.
  - **L6 (failure paths):** silent, flooding, trickling and half-closing RTSP stubs, a port that is not a camera, nothing listening, wrong and missing logins, redirects, an MJPEG stream where a still is expected, a malformed boundary, a 100 MB declared body, a slow body, an HTML login page, an empty body, a body cut mid-frame, and 40 repeated floods for memory.
  - **L9 (entry-point parity):** the wizard's camera step and the everyday panel render the same `RtspSourceControls` and `PhoneCameraSection` (`CameraPickStep.tsx:47-52`), so they share one code path; auto-start and Reconnect were read separately.
  - **L12:** CI of #1546, #1641 and #1649 and of the main tip.
  - Not run: a browser, real cameras, any network, FFmpeg (none on PATH; the Playwright FFmpeg build here has only the `file` and `pipe` protocols).
- **Stubs:** 127.0.0.1:4811–4819 and [::1]:4812 only, all stopped at the end of each script.
- **Memory gates:** 1.1–3.1 GB free across checks. Node repros ran at every level. Vitest ran once, at 2.0 GB free, one worker.
- **Counts:** 6 raised → refuter pending → P1 0 / P2 1 / P3 5 (+ KNOWN: W4-P2-2 re-tested, W4-P3-2, v2 12-P3-3, #1546 item 7, v2 04-B-2).
  - 4 of the 6 are security findings and are **redacted until fixed** (AREAS.md, Findings and fixes). Their details are in the scratchpad file `zz-y2/SECURITY-DETAILS.md`, held by the coordinator.

## Headline

**ADR-692 holds for the login shapes it names, on every save and share route.** Six input routes, plus several cameras at once, were run through every save and share route in the matrix below. The address forms were: user and password before the host, a query login, path fields split by `_`, `&` or `;`, percent-encoded fields, an unencoded `/` in the password, an e-mail user name, an upper-case scheme and an IPv6 host. No synthetic login reached a project, autosave, recent copy, saved artwork, template, `.lfmachine` export, the remembered machine, a view-reference key, the remembered address, an undo snapshot, a bridge or panel error, the support report, G-code, the phone/MCP projections or the clipboard. The desktop keeps the full RTSP address only under OS encryption and never falls back to plain text (Linux refuses the shared fallback key).

**The re-test of the class found four security weaknesses, all redacted here:**
- Y2-P2-1, P2: credential exposure to other local processes.
- Y2-P3-1, P3: partial credential persisted in plain local storage.
- Y2-P3-2, P3: a credential-bearing address part persisted in saved and shared files.
- Y2-P3-3, P3: a credential sent in clear text on the local network.

**The bridge proves itself and camera addresses stay out of URLs (ADR-141 Amd 2): verified by REPRO.**
- An impostor that answers `/health` with no proof, or a wrong one, receives only `/health?challenge=…`. It gets no address, no login and no client token, and the operator reads the ADR's "Another program is answering…" text.
- The real bridge refuses: a request without the token, without an Origin or from a web Origin; a loopback dev Origin on a keyed bridge; a rebound Host; and `GET /probe`, `/frame.jpg?url=` and `/stream.mjpg?url=`.

**The RTSP login probe (#1546) behaves.**
- It costs one failed login per Connect press (5 presses gave 5), with no automatic retry. Auto-start runs once and only while the camera is idle.
- It never follows a redirect (a 301 to another port is not contacted).
- It is bounded against silence (2.5 s), trickle (5 s), floods (16 KiB headers) and half-closed replies. Its error texts carry no login.

**Smaller (not security):**
- A phone or snapshot camera that refuses the login reads "The camera did not send a picture…", because the bridge's "HTTP 401" is dropped on the way to the panel (Y2-P3-4).
- A phone camera that is already live and whose login then stops working is polled with that login twice a second, for as long as the preview or the hidden canvas overlay is mounted (Y2-P3-5, which extends KNOWN v2 12-P3-3).

**L12.**
- #1546's main CI, Browser smoke and Desktop package all passed.
- #1641's main CI and Desktop package failed in `electron/native-smoke.test.ts` (not camera code).
- On #1649's merge commit, CI and Browser smoke were cancelled by the next push. CI passed on `c94993aa4`.
- The tip `4c4b98fd0` is green on all three (CI 42726176907, Browser smoke 42726176892, Desktop package 42726176637).

## Route matrix

A synthetic login was entered through each input route, the calibration was bound to the live camera as the wizard binds it (`cameraCaptureBindingForFrame`), and each route below was run with the real code and grepped. "clean" means no marker and no user name. REPRO `b1-routes` unless marked.

| Input route ↓ / save or share route → | .lf2 save | autosave / recovery | recent copy, saved artwork | template | `.lfmachine` + canonical | remembered machine | view-reference key | remembered address (local) | undo snapshot | G-code, support report, phone/MCP, clipboard |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 RTSP, `user:pass@` (panel = wizard) | clean | clean | clean | clean | clean | clean | clean | clean (public form) | clean | no camera field (READ) |
| R2 RTSP, query login pasted | clean | clean | clean | clean | clean | clean | clean | clean | clean | no camera field |
| R3 RTSP, path fields (`_`; `&`, `;` and %-encoded in `a1`) | clean | clean | clean | clean | clean | clean | clean | clean | clean | no camera field |
| R5 Phone, IP Webcam `user:pass@` | clean | clean | clean | clean | clean | clean | clean | clean (`192.168.1.50:8080`) | clean | no camera field |
| R6 Phone, other app, query login | clean | clean | clean | clean | clean | clean | clean | clean | clean | no camera field |
| R7 Phone, other app, `user:pass@` | clean | clean | clean | clean | clean | clean | clean | clean | clean | no camera field |
| R8 Several cameras (ADR-446), all of the above in one profile, saved, reopened, saved | clean for R1–R3, R5–R7 | — | — | — | clean for the same | clean, restored clean | — | — | — | — |
| R9 Editing a remembered address (field shows the public form; editing it saves the edit and forgets the stored login, `camera-preference-storage.ts:49-53`) | clean (READ) | | | | | | | login forgotten, not leaked | | |
| R10 An older file with a login (repo tests `project-camera-login.test.ts`, `camera-login-local-records.test.ts`: pass) | clean on open and on save | | clean (`personal-artwork-format.ts:46`) | | clean on import | rewritten on read | renamed on read | rewritten on read | | |
| Two further address shapes | **redacted (Y2-P3-1, Y2-P3-2)** | | | | | | | | | |

Other places checked for every route:
- **Bridge and panel error texts:** app-owned, no echo (`c1`, `c2`, `c3`). The bridge's `/probe` reply echoes the full address back to the window, which already holds it and does not store it (`camera-source-actions.ts:244-285` uses only `previewUrl` and `streamSessionId`).
- **Console and logs:** no `console.*` in camera UI, state or platform code. The electron camera files log only bind failures (`camera-bridge-lifecycle.ts:23`). No camera address reaches the support report's facts (`save-support-report.ts` has no camera input).
- **URLs echoed in the UI:** the panels show the typed address in-session and only the public form after restart (`RtspSourceControls.tsx:34`, `PhoneCameraSection.tsx:73-75`). Calibrated cameras are named by host (`SavedCamerasSection.tsx:89-93`).
- **Other local processes and logs:** one redacted finding (Y2-P2-1).
- **Transport on the local network:** one redacted finding (Y2-P3-3).

## Where the login is stored (brief item 2)

- **RTSP, desktop:** the full address, only when it carries a login, in `<userData>/camera-address.v1`. It is encrypted with Electron `safeStorage` (`electron/camera-address-store.ts:33-110`): DPAPI on Windows (readable by processes of the same Windows user), the Keychain on macOS, and on Linux only a keyring key (`v11`/`v12`; the shared `v10` fallback is refused, `secure-storage-check.ts`).
  - The file is written `0o600` through a temp file and a rename.
  - With no encryption available, nothing is kept and the login is typed again (REPRO `c8`: four platform cases, never plain on disk).
  - The window reaches it only through `app://app/api/camera-address/rtsp` behind `trustedAppRequest` (`camera-address-routes.ts:21-45`).
- **RTSP, browser:** only the public form in local storage. The full address is kept in memory for this run (`camera-preference-storage.ts:39-53`).
- **Phone:** no login is remembered (ADR-448 D4). Only the public address goes to local storage.
- **Survives uninstall:** yes. The NSIS config has no `deleteAppDataOnUninstall` (`electron-builder.yml:77-88`), so `camera-address.v1` stays, still encrypted to that OS user. There is no "forget login" control: connecting to a login-less address forgets it. Not raised: ADR-692 makes no promise here, and the data stays encrypted.

## Findings

### Y2-P2-1 — SECURITY: credential exposure to other local processes

- **Class:** credential exposure to other local processes.
- **Severity:** P2.
- **Details:** redacted until fixed (AREAS.md, Findings and fixes). Where, anchor, scenario, REPRO, the case for and against, and fix direction are in the scratchpad file `zz-y2/SECURITY-DETAILS.md`.
- **Evidence:** REPRO (in the security file).
- **Novelty:** new.
- **Refuter:** PENDING.

### Y2-P3-1 — SECURITY: partial credential persisted in plain local storage

- **Class:** partial credential persisted in plain local storage.
- **Severity:** P3.
- **Details:** redacted until fixed. See `zz-y2/SECURITY-DETAILS.md`.
- **Evidence:** REPRO.
- **Novelty:** new.
- **Refuter:** PENDING.

### Y2-P3-2 — SECURITY: credential-bearing address part persisted in saved and shared files

- **Class:** credential-bearing address part persisted in saved and shared files.
- **Severity:** P3. The security file gives the case for P2.
- **Details:** redacted until fixed. See `zz-y2/SECURITY-DETAILS.md`.
- **Evidence:** REPRO.
- **Novelty:** new.
- **Refuter:** PENDING.

### Y2-P3-3 — SECURITY: credential sent in clear text on the local network

- **Class:** credential sent in clear text on the local network.
- **Severity:** P3.
- **Details:** redacted until fixed. See `zz-y2/SECURITY-DETAILS.md`.
- **Evidence:** REPRO.
- **Announced?** Partly; the security file says how.
- **Novelty:** new.
- **Refuter:** PENDING.

### Y2-P3-4 — A phone or snapshot camera that refuses the login says "The camera did not send a picture. Check the address, that the camera app is running…"; the bridge's "HTTP 401" never reaches the operator

- **Where (4c4b98fd0):**
  - `src/ui/camera/decode-jpeg.ts:16-24`: `fetchBlob` returns `null` for any non-OK reply and drops the bridge's JSON `reason`.
  - `src/ui/camera/frame-source.ts:135-139` passes the null on.
  - `src/ui/state/camera-snapshot-source.ts:15-16,51-59` then always shows `SNAPSHOT_CAMERA_NO_PICTURE`.
  - The bridge has the cause: `electron/camera-frame-proxy.ts:182-185` ("Camera returned HTTP 401."), `:190-192`, `:186-187`.
  - Second case (READ): when the RTSP probe cannot answer the camera's challenge, it counts the camera as found (`electron/rtsp-probe.ts:38-41`). If FFmpeg's own login then fails, the operator reads "RTSP preview stopped. Check the camera and bridge, then press Reconnect." (`camera-source-lifecycle.ts:18-19`).
- **Anchor:**
  - **Twin:** the RTSP section names both login failures: "The RTSP camera needs a user name and password…" and "…refused the user name or password in the address." (`electron/rtsp-probe.ts:13-16`; REPRO `c1`).
  - **Contract:** ADR-448 D2: "Starting fetches one picture first, so a wrong address or a stopped app says so instead of showing a blank preview."
- **Scenario:**
  1. IP Webcam has "Login/password" set (the app offers it), or the password was changed on the phone.
  2. The maker types the address with an old password, or none, and presses Use phone.
  3. The panel tells them to check the address, the app and the Wi-Fi, which are all fine. Nothing mentions a login.
  4. The same message appears for a video-stream address pasted where a still is expected ("Camera frame is too large." at the bridge), and for an HTML login page ("Camera did not return an image.").
- **Evidence:** REPRO `zz-y2/c3-phone-window.mts` → `c3-phone-window.out.jsonl`.
  - The real `startSnapshotSource` → `captureSourceFrame` → default fetch IO ran against a stand-in bridge whose `/frame.jpg` is the real `serveHttpFrame`, with a camera stub on 127.0.0.1:4818. Only the loopback policy was skipped.
  - Right login: live. Wrong password, login left out, video address and login page: the same sentence each time, while the bridge said "Camera returned HTTP 401." (twice), "Camera frame is too large." and "Camera did not return an image."
- **Severity:** P3.
  - **For:** the wrong cause is named, which costs a retry loop.
  - **Against P2:** nothing is burned or lost, and the camera simply does not start.
- **Announced?** No.
- **Novelty:** new. It differs from KNOWN v2 12-P3-3 (a failure after the camera is live blanks silently): this is the start message.
- **Fix direction:**
  - Let `fetchBlob` return the bridge's `{kind, reason}` for a non-OK JSON reply, and show it.
  - Map "HTTP 401/403" to the RTSP wording ("The camera refused the user name or password in the address"), and "too large" with a `multipart` type to "That is a video address; use the app's still-picture address".
  - For the RTSP case, when the probe could not answer the challenge, say that the login was not checked.
- **Refuter:** PENDING.

### Y2-P3-5 — A live phone or snapshot camera whose login stops working is fetched with the refused login twice a second, with no stop or back-off, while the panel preview or the hidden canvas overlay is mounted

- **Where (4c4b98fd0):**
  - `src/ui/camera/CameraSourceView.tsx:26-33`: `PolledJpeg` gets no `onFailure`.
  - `:61-80` and `:151-158`: it re-polls every `intervalMs` whatever the last load did.
  - `:134-137`: an error only sets a local note.
  - The canvas overlay mounts the same view hidden: `WorkspaceCameraOverlay.tsx:96-100`, "it is never seen".
  - The interval is 500 ms for a phone (`camera-snapshot-source.ts:14`).
  - The bridge queue has no back-off (`electron/camera-frame-proxy.ts:56-74`); every fetch repeats the address as it was registered, login included.
- **Anchor:**
  - **Twin:** an RTSP source is failed and stops on a `failed` status (`camera-source-lifecycle.ts:96-121`; `RtspSourceControls.tsx:104` passes `onFailure`). A USB source stops on `ended`.
  - **Contract:** the store's own failure path, `reportSourceFailure` (`camera-source-lifecycle.ts:58-76`), exists for this.
- **Scenario:**
  1. A maker uses a network camera's snapshot address with a login through "Another app with a picture address", with the overlay on.
  2. Someone changes that camera's password on the NVR or the camera.
  3. KerfDesk keeps fetching with the old login every 500 ms: 120 refused logins a minute, all through a job and with the panel closed.
  4. Cameras that lock an account or an IP after a few failures (a common NVR setting) lock the maker out of their own camera.
  5. The canvas shows only the last good picture.
- **Evidence:**
  - REPRO for the bridge side: `zz-y2/c2-http-snapshot.mts` → `c2-http-snapshot.out.jsonl`, last row. Ten seconds of 500 ms polls through `fetchFrameBytesQueued` gave 20 failed fetches and 20 refused logins at the stub (120 a minute).
  - READ for the window loop (`CameraSourceView.tsx` above).
- **Severity:** P3.
  - **For:** it can lock the operator's camera account, and the overlay keeps an old picture with no canvas notice.
  - **Against P2:** it needs a credential change while the camera is live. A first start with a wrong login fails once and stops (`c3`). Nothing is burned.
- **Announced?** No.
- **Novelty:** it extends KNOWN v2 12-P3-3 ("Machine-JPEG failure blanks silently": `PolledJpeg` gets no `onFailure`). The repeated refused logins and the lockout risk are new.
- **Fix direction:**
  - Pass `onFailure` to `PolledJpeg` and fail the source after N consecutive errors, as RTSP does after two `unavailable` readings.
  - Have the bridge remember a 401 for a source id and refuse further fetches for that id until the window registers the source again.
- **Refuter:** PENDING.

## KNOWN: status on `4c4b98fd0`

| ID | Was | Status | Evidence |
|---|---|---|---|
| W4-P2-2 (security) | redacted | **Fixed per #1649 for every login shape ADR-692 names** (route matrix, `a1`, `b1`; repo tests pass). The class re-test raised Y2-P2-1 and Y2-P3-1 to Y2-P3-3 | The W4 detail file was not read, so no claim is made about whether those four relate to W4's route |
| W4-P3-2 | Auto-start cancellation misses RTSP and phone | **Open** | `auto-start.ts:85-95`: `startAddressCamera` takes no `current()` and checks nothing after `rememberedRtspCameraUrl()` |
| v2 12-P3-3 | Machine-JPEG failure blanks silently | **Open**, now with refused logins at 2 Hz (Y2-P3-5) | `CameraSourceView.tsx:26-33` |
| #1546 item 7 | Inconsistent private-host policies | **Open** (REPRO `c1`) | `/probe` accepts a loopback RTSP host (all `c1` probes ran on 127.0.0.1); `/frame-source` refuses loopback; both refuse 169.254/16 |
| v2 04-B-2 | `/probe` on loopback is a port oracle | **Open but gated** | `c1`: needs the client token, so only KerfDesk's own window can reach it |
| W4 Not verified: IPv6 camera host | `URL.hostname` keeps brackets | **Holds** | REPRO `c7-ipv6`: `probeRtsp(new URL('rtsp://[::1]:4812/open'))` connects and completes |
| Y1 findings, v12 work, #1623 / #1626 / #1678, pro-loop audits | — | Not touched by this area | — |

## Refuted

None raised and then refuted. Candidates dropped before raising:
- **A wrong RTSP password locks the camera out.** It costs one failed login per Connect press, with no automatic retry (`c1`: 5 presses, 5 logins). Auto-start tries once, only when the source is `idle`, and an error is not idle (`auto-start.ts:49-55,97-99`). The RTSP status poll asks the bridge, not the camera.
- **The probe follows a redirect with the login.** A 301 gave "RTSP camera did not accept DESCRIBE." and the target was never contacted (`c1`). The HTTP proxy refuses redirects the same way (`c2`).
- **Memory grows under a flooding or never-ending camera.** Repeated floods and MJPEG streams through the queued fetch: RSS 85 → 102–132 → 95 MB over 40 rounds (`c6`). Every fetch stops at 8 MiB or 10 s. The probe stops at 16 KiB of headers or 256 KiB of body.
- **The support report's userinfo redaction misses some address shapes.** True, but no route puts a camera address into the report, so it is latent. It is noted in the security file and not raised.
- **The remembered login survives uninstall with no forget control.** True, but it stays encrypted to the OS user, and ADR-692 makes no promise here (see "Where the login is stored").

## Verified clean

- **ADR-692 public form** for the shapes in the repo fixture and for these additional shapes: an e-mail user, an unencoded `%` or space, an upper-case scheme, an IPv6 host, a `-`-joined path field, and an unencoded `\` in a phone address (`a1`). Every save and share route is in the matrix (`b1`).
- **The keyed identity:** HMAC-SHA256 over the address and query with a 32-byte local key. The key never enters a project (`camera-resource-identity.ts:8-30`), and fingerprints still match older records (repo test).
- **The secure store:** OS encryption only. There is no plain fallback, Linux refuses the `v10` fallback key, and writing `null` deletes the file (`c8`).
- **The bridge:** HMAC proof on `/health` (`c1`). The proof key never goes to the bridge port (`c1`: `proofKeyInBody: false`). The impostor gets nothing (`c5`). The token, Origin, Host and method gates hold. Addresses travel only in POST bodies, and the image URLs name cameras by random ids (`c1`, `c5`).
- **The RTSP probe:** the login is never in the request line (`c1`: `secretInRequestLine: false` for every case). MD5 Digest with `qop=auth` is answered correctly against an independent stub. A missing login and a refused login are named separately. The silent, flood, trickle and half-close cases are bounded, a public host is refused, and none of the texts carry the login (`c1`).
- **The HTTP snapshot fetch:** a redirect is refused and the target is never contacted. The 8 MiB cap holds, including a declared 100 MB. The timeout holds. HTML, empty and cut-off bodies are refused. The error texts are app-owned (`c2`).
- **Failure messages for RTSP:** nothing listening gives `connect ECONNREFUSED 127.0.0.1:4819` (host and port only); a port that is not a camera gives "RTSP camera did not accept DESCRIBE."; silence gives "RTSP probe timed out." after 2.5 s; a trickle gives "…exceeded the overall deadline." after 5 s (`c1`).
- **ADR-551, FFmpeg by full path:** only absolute PATH folders are searched (`ffmpeg-path.ts:53-66`). With FFmpeg missing, `/health` reports it and the panel says to install it (`CameraDiagnostics.tsx:91-95`, `camera-source-actions.ts:83-84`). The repo tests pass.
- **Entry-point parity (L9):** the wizard and the panel use the same RTSP and phone components. Auto-start uses the same store actions and the same remembered-address reader. The phone/MCP camera returns pixels only (`machine-camera.ts:18-39`), and the remote status carries only `camera.available` (`machine-projections.ts:62`).
- **Vitest** (`zz-y2/vitest-login.out.txt`, 2.0 GB free, one worker): 10 files and 182 tests passed. The files were `camera-address-login`, `project-camera-login`, `camera-login-identity`, `camera-login-local-records`, `camera-address-store`, `rtsp-probe`, `camera-bridge-keys`, `camera-frame-proxy`, `rtsp-camera-stream` and `camera-bridge.keyed`.
- **L12:**
  - #1546: merge `02c02616e`. Main CI 41461105337, Browser smoke 41461105225 and Desktop package 41461105293 all passed. Every PR check passed, including the Linux AppImage/.deb launch.
  - #1641: merge `59d66bb86`. Main CI 42579786345 failed in `electron/native-smoke.test.ts` (Unit tests 3/4), and Desktop package failed too; neither is camera code. Browser smoke was cancelled.
  - #1649: merge `751a0fc32`. CI 42590289085 and Browser smoke were cancelled by the next push; Desktop package passed. The next commit, `c94993aa4`, passed CI 42590577946 (its Browser smoke and Desktop package were cancelled).
  - Every PR head passed its required checks.
  - The tip `4c4b98fd0` passed CI, Browser smoke and Desktop package.

## Not verified

- **FFmpeg itself.** There was no RTSP-capable FFmpeg, and none was downloaded. Not checked:
  - whether FFmpeg follows an RTSP redirect after the probe passed, and with which login;
  - which auth scheme it picks;
  - how it behaves on a camera stopped mid-stream, a slow stream, an unsupported codec or a busy camera.

  The bridge side was read instead. A stall fails the stream after 10 s (`rtsp-camera-stream.ts:14,111-119`), and an exit or end fails it with an app-owned text (`:132-160`). The window then shows "RTSP preview stopped…" within about 1 s (`camera-source-lifecycle.ts:96-121`).
- **No browser run.** A renderer hang or crash under a flooding MJPEG preview was not measured, and neither were the panel's `<img>` behaviour and the hidden overlay poll. Memory allowed it at the end (2.0–2.3 GB), but the time went to the bridge and route REPROs.
- **The OS behaviour behind Y2-P2-1 was shown on Windows only.** Linux and macOS are READ.
- **Real cameras' lockout thresholds and address formats.** There was no network. The Y2-P3-5 lockout risk rests on the refused-login rate, not on a measured lockout.
- **Electron `safeStorage` on real backends, and the NSIS uninstaller.** Both were READ and checked against a stand-in.
- **USB sources.** Covered by Y1 (READ): no login is involved.

## Repro files

All files are in scratchpad `zz-y2\`. Run them from that folder with `node --import ./register.mjs <script>.mts`; scripts that stub local storage also need `--no-experimental-webstorage`. The loader is Y1's, pointed at `j19-main`. Every output masks the marker as `<S>`.

- `a1-public-form.mts` → `.out.jsonl`: the public-form functions on 25 typed shapes.
- `b1-routes.mts` → `.out.jsonl`: the route matrix. It uses the real `startRtspSource` with a fake bridge adapter, the phone source shape from `camera-snapshot-source.ts:40-45`, `cameraCaptureBindingForFrame`, and every serializer.
- `c1-bridge-rtsp.mts` → `.out.jsonl`: the real keyed bridge on 4815 against RTSP handshake stubs (4811, 4812) and a port that is not a camera (4816).
- `c2-http-snapshot.mts` → `.out.jsonl`: the bridge's HTTP snapshot fetch against camera stubs (4813, 4814).
- `c3-phone-window.mts` → `.out.jsonl`: what the panel says, through the real store action and the real `serveHttpFrame` (4817, 4818).
- `c5-impostor.mts` → `.out.jsonl`: the window's bridge client against an impostor (4819) and against the real bridge.
- `c6-flood-memory.mts` → `.out.jsonl`: 40 floods, RSS.
- `c7-ipv6.mts` → `.out.jsonl`: the probe on `[::1]`.
- `c8-address-store.mts` → `.out.jsonl`: the secure store with a stand-in `safeStorage`.
- `vitest-login.out.txt`: the focused Vitest run.
- The repro files for the redacted findings are listed in `SECURITY-DETAILS.md` only.

```json
[
  {"id":"Y2-P2-1","severity":"P2","area":"camera-connection-login","file":"redacted","line":0,"anchor":"redacted until fixed (security: credential exposure to other local processes)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"SECURITY - credential exposure to other local processes; redacted until fixed"},
  {"id":"Y2-P3-1","severity":"P3","area":"camera-connection-login","file":"redacted","line":0,"anchor":"redacted until fixed (security: partial credential persisted in plain local storage)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"SECURITY - partial credential persisted in plain local storage; redacted until fixed"},
  {"id":"Y2-P3-2","severity":"P3","area":"camera-connection-login","file":"redacted","line":0,"anchor":"redacted until fixed (security: credential-bearing address part persisted in saved and shared files)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"SECURITY - credential-bearing address part in saved and shared files; redacted until fixed"},
  {"id":"Y2-P3-3","severity":"P3","area":"camera-connection-login","file":"redacted","line":0,"anchor":"redacted until fixed (security: credential sent in clear text on the local network)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"SECURITY - credential sent in clear text on the local network; redacted until fixed"},
  {"id":"Y2-P3-4","severity":"P3","area":"camera-connection-login","file":"src/ui/camera/decode-jpeg.ts","line":19,"anchor":"Twin RTSP names missing/refused login (electron/rtsp-probe.ts:13-16); Contract ADR-448 D2 'a wrong address or a stopped app says so'","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"Phone/snapshot camera refusing the login (HTTP 401), a pasted video address or a login page all read 'The camera did not send a picture. Check the address, that the camera app is running...'; the bridge's reason is dropped by fetchBlob"},
  {"id":"Y2-P3-5","severity":"P3","area":"camera-connection-login","file":"src/ui/camera/CameraSourceView.tsx","line":28,"anchor":"Twin RTSP source fails and stops on a failed status (camera-source-lifecycle.ts:96-121); extends KNOWN v2 12-P3-3","evidence":"REPRO (bridge) + READ (window loop)","verdict":"PENDING","known":false,"summary":"A live phone/snapshot camera whose login stops working is fetched with the refused login every 500 ms (120/min) with no stop or back-off while the panel preview or the hidden canvas overlay is mounted; risks locking the camera account"}
]
```

## Refuter (2026-11-10)

- **Tree:** origin/main @ `4c4b98fd0`; repros imported the `j19-main` export (`f61a0757a`, identical camera, electron and io code). `git log 4c4b98fd0..origin/main -- electron src/core/camera src/ui/camera` is empty. Fix PR #1680 is still open and touches only the camera-moved check, none of the code behind these six findings.
- **Method:** own scripts and own synthetic marker (a fresh random value per run, masked in every output), own stubs on 127.0.0.1:4892–4894, all closed at the end of each script. No FFmpeg, camera, network, browser or Vitest run. Free memory was 2.6 GB at the start.
- **Security findings:** only the ID, class, severity, verdict and "redacted until fixed" appear here. The evidence is in the refuter's scratchpad file `zz-y2r/SECURITY-DETAILS.md`, held by the coordinator.

### Verdicts

| ID | Class | Auditor | Refuter | Evidence |
|---|---|---|---|---|
| Y2-P2-1 | Security: credential exposure to other local processes | P2 | **CONFIRMED P2.** Redacted until fixed | REPRO (own) + READ; reach and persistence by platform are in the security file |
| Y2-P3-1 | Security: partial credential persisted in plain local storage | P3 | **CONFIRMED P3.** The class is wider than reported (more input shapes, sometimes the whole credential), still local only. Redacted until fixed | REPRO (own) |
| Y2-P3-2 | Security: credential-bearing address part persisted in saved and shared files | P3 | **RE-RATED P2.** It reaches routinely shared files (project, template, machine export, including an import on another PC), the class is wider than reported, and it breaks ADR-692 D1 on its own terms. Redacted until fixed | REPRO (own) + READ. The real-world formats behind the P2 are UNVERIFIED (no network). If none ships, it returns to P3 |
| Y2-P3-3 | Security: credential sent in clear text on the local network | P3 | **RE-RATED P2,** for the part that KerfDesk could avoid. The part that is inherent to a camera's own protocol is already announced and stays KNOWN. Redacted until fixed | REPRO (own) + READ |
| Y2-P3-4 | A phone or snapshot camera that refuses the login gets the "did not send a picture" text | P3 | **CONFIRMED P3** | REPRO `r4-snapshot-login.mts` part A: the real `startSnapshotSource` → `captureSourceFrame` → default fetch IO, against a stand-in bridge whose `/frame.jpg` is the real `serveHttpFrame`, with a camera stub that answers 401. The panel state is `error` with `SNAPSHOT_CAMERA_NO_PICTURE` (no word about the login), while the bridge said "Camera returned HTTP 401." The RTSP second case (a challenge the probe cannot answer counts as found) is confirmed by READ (`rtsp-probe.ts:38-41`) |
| Y2-P3-5 | A live phone or snapshot camera whose login stops working is fetched with the old login | P3 | **CONFIRMED P3; the rate can be twice the reported 120 a minute** | REPRO `r4-snapshot-login.mts` part B; details below |

**Y2-P3-5 details.**
- **Rate.** Two 500 ms views (the panel preview and the hidden canvas overlay; the panel's main and settings views are exclusive, `CameraPanel.tsx:58-76`) ran for 6 s against a 401 stub through the real `serveHttpFrame`:
  - views in phase: 12 refused logins (120 a minute), because the bridge's in-flight de-duplication (`camera-frame-proxy.ts:56-58`) merges overlapping requests;
  - views 250 ms apart: 24 (240 a minute).
  - Every one carried the old login. The `<img>` loop itself was READ (`CameraSourceView.tsx:61-80,151-158`) and simulated with `fetch`.
- **Lockout (brief item 3).**
  - **Why it is not P2:** the lockout needs a camera that accepts the address's login on its picture address *and* a password change while the camera is live.
  - **Effect when it happens:** a camera or NVR that locks the IP or the account after a few failures (vendor behaviour from memory, UNVERIFIED) stays locked for as long as KerfDesk polls. With an account lock, another client of that camera, such as the NVR recording it, can be locked out too.
  - **Recovery:** it stops when the source is stopped or KerfDesk closes, and nothing is burned.
  - **Fix direction:** stop after N consecutive failures, as the RTSP twin does.

### Challenges to "Verified clean"

- **"ADR-692 holds for the login shapes it names, on every save and share route."** This holds for the listed shapes; the refuter's own run reproduced the route matrix for the shapes it re-tested. The public-form claim does not hold for the wider class: see the redacted re-rating of Y2-P3-2. The extra shapes and routes are in the security file.
- **"The desktop keeps the full RTSP address only under OS encryption and never falls back to plain text."** This is true for the secure store itself (not re-run; the auditor's `c8` was read). It is narrowed by Y2-P2-1 and by the wider Y2-P3-1 class. Both are redacted.
- **"The RTSP probe answers MD5 Digest correctly."** This holds as stated. A related weakness is in a redacted finding.
- **The other routes the brief asked to try, checked by READ and found clean.** None carries a camera address:
  - the window title (project name only, `use-window-title.ts:21`);
  - Windows jump lists and recent documents (no `addRecentDocument` or `setJumpList` anywhere);
  - crash dumps (no `crashReporter`);
  - the support report, whose machine facts are only name, maker, controller, bed and baud (`support-report.ts:209-215`);
  - the saved camera snapshot (fixed name `camera-snapshot.png`, pixels only, `snapshot.ts:27`);
  - the timelapse (fixed name `timelapse<ext>`, MediaRecorder output, `TimelapseResult.tsx:95`);
  - the remote and MCP projections (bed, feed and jog fields only);
  - renderer problems (the window fetches only bridge URLs, never a camera address, `decode-jpeg.ts:18`).
- **Dragging a project to another machine, and a `.lfmachine` round trip on another PC.** These are the same serializers as Save and Import. They are clean for the listed shapes and are covered by the Y2-P3-2 re-rating for the wider class (REPRO, redacted).
- **Login shapes from the brief.** All were run (REPRO) and the outcomes are in the security file:
  - a user name without a password, a token in the query string, and a Basic-auth header pasted into the address all gave a clean public form;
  - an IPv6 address with userinfo (with and without a zone id) gave a clean public form;
  - one further shape belongs to the wider Y2-P3-1 class (redacted).
  - No config field accepts an auth header (READ).

### New findings

None with a new ID. The wider classes found under Y2-P3-1, Y2-P3-2 and Y2-P3-3 have the same root cause and fix as those findings, so they are folded into them (redacted). The 240-a-minute rate is folded into Y2-P3-5.

### Not verified

- **No second Windows account.** Creating one is out of bounds, so "another standard user cannot read it" for Y2-P2-1 rests on a same-session contrast, not a user-to-user test.
- **Linux and macOS.** Their behaviour behind Y2-P2-1 is READ only.
- **Real cameras, NVRs and phone apps.** Their auth defaults, lockout thresholds and address formats were not checked (no network). They are cited from memory and marked UNVERIFIED in the security file; the Y2-P3-2 and Y2-P3-3 re-ratings depend partly on them.
- **FFmpeg's own RTSP auth choices.** No FFmpeg was run (READ from memory).
- **Not re-run.** The auditor's bridge, impostor, flood, IPv6-probe and secure-store scripts (`c1`, `c5`, `c6`, `c7`, `c8`) and the focused Vitest were not re-run; their outputs were read.
- **Browser.** There was no browser run, so the `<img>` poll loop in a real renderer was not measured.

### Repro files

- **Location:** scratchpad `zz-y2r\`.
- **How to run:** from that folder, with `node --no-experimental-webstorage --import ./register.mjs <script>.mts`.
- **Loader:** a copy of the `j19-main` TypeScript loader.
- **Committed here:** only the non-security script, `r4-snapshot-login.mts` → `r4-snapshot-login.out.jsonl` (Y2-P3-4 part A, Y2-P3-5 part B). It uses stubs on 127.0.0.1:4893 and 4894.
- **Security scripts:** four, listed in `zz-y2r/SECURITY-DETAILS.md` only.

```json
[
  {"id":"Y2-P2-1","severity":"P2","verdict":"CONFIRMED","summary":"SECURITY - credential exposure to other local processes; redacted until fixed"},
  {"id":"Y2-P3-1","severity":"P3","verdict":"CONFIRMED","summary":"SECURITY - partial credential persisted in plain local storage; class wider than reported; redacted until fixed"},
  {"id":"Y2-P3-2","severity":"P2","verdict":"RE-RATED P3->P2","summary":"SECURITY - credential-bearing address part in saved and shared files; redacted until fixed"},
  {"id":"Y2-P3-3","severity":"P2","verdict":"RE-RATED P3->P2","summary":"SECURITY - credential sent in clear text on the local network (avoidable part); redacted until fixed"},
  {"id":"Y2-P3-4","severity":"P3","verdict":"CONFIRMED","summary":"Snapshot camera login refusal reads 'did not send a picture'; bridge's HTTP 401 dropped"},
  {"id":"Y2-P3-5","severity":"P3","verdict":"CONFIRMED","summary":"Live snapshot camera with a stale login is fetched 120-240 times a minute (panel + hidden overlay) with no stop"}
]
```

Refuter counts: raised 6, refuted 0, P1 0, P2 3, P3 3, known 5
