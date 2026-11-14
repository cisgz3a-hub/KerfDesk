# K5 — Camera connect and privacy (camera audit v2, `camera-connect-and-privacy`)

**Question.** Where do a network camera's address and login live, and does either reach anything saved, shared, logged or sent off the PC (#1649, ADR-692 and Amendment 1)? What will the bridge's frame proxy and RTSP probe fetch, does the bridge authenticate its window, and is a login ever sent to a host other than the one it was entered for? Are login failures named clearly, does reconnecting after a credential change work, and does a saved camera identity survive a move to another computer? In scope: the address vault and its route, the login forms and public form, the HTTP/RTSP login answerer, the RTSP probe and login relay, the Electron frame proxy, frame sources, bridge keys, routes and lifecycle, and the saved camera identity.

v13 Y2 audited this area at `4c4b98fd0` and raised four redacted security items, fixed since by ADR-692 Amendment 1. Their status is under KNOWN.

**Tree.** `origin/main` @ `ba08a81af` (read-only export `j42-main`). `git diff --stat ba08a81af origin/main -- electron src/core/camera src/ui/camera` (fetched 2026-11-14, `53393cc16`) touches only `core/camera/model/extrapolation-estimate*`, `head-camera-estimate*` and `ui/camera/calibrate/*` (K1/K3 work). No file read or run here changed, so every result stands on current main.

**Method.**
- **READ, end to end:** every file in the brief, plus `electron/rtsp-camera-bridge.ts`, `rtsp-camera-bridge-policy.ts`, `private-network-host-policy.ts`, `camera-login-answer.ts`, `rtsp-describe*.ts`, `rtsp-probe.ts`, `rtsp-camera-stream.ts`, `rtsp-camera-session.ts`, `desktop-camera-*.ts`, `app-route-guard.ts`, `support-log.ts`; on the window side `remembered-camera-addresses.ts`, `phone-camera-address.ts`, `camera-resource-identity.ts`, `camera-capture-binding.ts`, `public-camera-identity*.ts`, `camera-source-actions.ts`, `camera-snapshot-source.ts`, `platform/web/camera-bridge.ts`, `desktop-camera-address-vault.ts`, `RtspSourceControls.tsx`, `PhoneCameraSection.tsx`, `CameraDiagnostics.tsx`, `auto-start.ts`, `camera-model-frame.ts`, the support-report redaction, the remote/MCP camera projections and tools, and every `console.*`, `writeText`, crash-reporter and telemetry use (grep).
- **Synthetic login only:** user `k5user`, password `K5-secret-<random hex>` (`secret.txt`); every output masks it as `<S>`.
- **Stubs** (`stub.mjs`, its own process, 127.0.0.1 only): an HTTP camera on :5331 (open, Basic, Digest MD5, Digest SHA-256 + Basic, an unsupported Digest + Basic, a Bearer challenge, an HTML login form, a 401 with no challenge, a 302 at once and a 302 after login), a recorder standing for "another host" on :5334, an HTTPS camera with a self-signed certificate on :5333 (OpenSSL), and an RTSP camera on :5332 (Basic, Digest, open). Nothing else was contacted; policy rows for public and private addresses were run against the pure policy functions only.
- **p1** (`p1-bridge.mts`): the policy matrix; the real `fetchFrameBytes` (login answerer, redirect refusal, content checks) against the stubs; the **real keyed bridge** (`startLocalRtspCameraBridge(5335, keys)`) driven over raw HTTP as another local program would (forged Origin, wrong or missing token, rebound Host, old URL forms), and its `/probe` against the RTSP stub.
- **p3** (`p3-routes.mts`): the #1649 route matrix. 14 address shapes entered through the real panel save functions and the real `startRtspSource`, with a bridge stand-in applying the **real** bridge policies and a vault stand-in applying main's own validation; the calibration bound as the wizard binds it; every save, export and persist route run and grepped; then a "restart" (memory cleared, local storage and vault kept).
- **p4** (`p4-messages.mts`): what the operator reads at start, through the real `serveHttpFrame` reply and the real `snapshotFailureMessage`; and the saved identity under a second computer's key.
- **Limits.** One test process at a time next to the stub, `--max-old-space-size=300`, 0.5–1.1 GB free. No Vitest, browser, pnpm, FFmpeg (not installed), Electron, real camera or hardware. The stub was stopped at the end; no listener is left on 5331–5339.

## Headline

**#1649 holds: no login reached any saved, shared, exported or plain-stored artefact for any of 14 address shapes** (userinfo, query, path fields, path tokens, percent-encoding, `#`/`?`/`@` inside a password, an upper-case scheme, IPv6, phone and snapshot forms), alone or with ten calibrations on one machine, saved, reopened and saved again. Every saved name is scheme, host and port. The full address lives only in the desktop's OS-encrypted vault (by design), in the window's memory for a snapshot camera, and in the bridge's memory. The four Y2 security items are fixed.

**The bridge's gates hold against another program and against web pages.** Without this launch's client token, a forged `Origin: app://app` gets 403; a missing or web Origin, a development Origin on the keyed bridge and a rebound Host get 403; `/frame.jpg` and the preview name a camera only by a random id. The frame proxy refuses every loopback spelling tried (decimal, hex, octal, short, trailing dot, `[::1]` long form), IPv4-mapped IPv6, 0.0.0.0, link-local 169.254, CGNAT and every host name. It parses once and fetches what it parsed. A login goes only to the host that asked for it, never before a 401, never across a redirect (refused, the other port never contacted), and as Digest whenever the camera offers one the bridge can compute.

**Raised:**
- **K5-P3-1 — SECURITY (redacted):** another program on the same computer can briefly use a network camera's login through KerfDesk, without learning it. CWE-441. Details in the coordinator's security file.
- **K5-P3-2 — an `https` camera with a self-signed certificate, or a camera that redirects (for example `http` → `https`), can never connect, and the panel blames the address, the app and the Wi-Fi.** The bridge knows only "Camera frame fetch failed."
- **K5-P3-3 — a network camera's calibration never follows a project or machine file to another computer, even for the same camera at the same address.** The second computer reports "The camera calibration belongs to a different camera" and needs a new calibration. The keyed fingerprint uses a key created per computer.

**Worst outcome per area:**
- **Saved and shared files:** none found (clean matrix).
- **Other local programs:** K5-P3-1 (redacted; no password disclosed).
- **The local network:** a login goes in clear only as the camera demands it (Basic as its only offer, or a query login typed into the address), as ADR-448 and Amendment 1 announce.
- **Operator clarity:** K5-P3-2, and the remainder of KNOWN Y2-P3-4.
- **Portability:** K5-P3-3.

## Where the address and the login live

| Artefact | Credential present? | Address present? | Evidence |
|---|---|---|---|
| `.lf2` project save | no | public form only (`rtsp://192.168.1.64:554/`) | p3, all 14 routes and R-many |
| Autosave / recovery snapshot | no | public form only | p3 |
| Recent copy, saved artwork | no | public form only | p3 |
| Project template | no | public form only | p3 |
| `.lfmachine` export, canonical profile (recovery provenance) | no | public form only | p3 |
| Execution artefact (project clone kept for recovery) | no | public form only | p3 |
| Remembered machine | no | public form only, also restored | p3 R-many |
| View-reference keys (local storage) | no | public form only | p3 |
| Remembered address, plain local storage (`rtspUrl.v1`, `camera.phone.v1`) | no | public form; scheme only for an address that reads two ways | p3 (R8–R10: `rtsp://`) |
| Desktop vault `camera-address.v1` | **yes, by design**: RTSP in full; phone without its login, with its path | yes | p3 vault stand-in; OS encryption only, never a plain fallback (READ `camera-address-store.ts:48-106`; Y2 c8) |
| Window memory: RTSP source | no (public `sourceId`, bridge ids) | public form | p3 `inMemorySourceHasSecret: []` |
| Window memory: phone / snapshot source | **yes** (`cameraUrl`, memory only, never persisted) | yes | p3 R5–R7, R14; READ `camera-snapshot-source.ts:76-81` |
| Bridge memory (frame-source registry, login answers, preview sessions) | yes, memory only | yes | READ `camera-frame-sources.ts`, `camera-frame-login.ts:29`, `rtsp-camera-session.ts` |
| Bridge `/probe` reply to the window | yes (echoes the address the window sent) | yes | p1 C-probe; the window keeps only `previewUrl` and `streamSessionId` (`camera-source-actions.ts:244-285`) |
| Bridge and panel error texts | no | no (a refused connect names host:port only) | p1, p4 |
| FFmpeg's arguments | no | no (a loopback address only) | READ `rtsp-camera-stream.ts:60-82,123` and the still args |
| Support report, desktop support log | no route puts an address there | — | READ (no `console.*` in window camera code; main logs only bridge bind failures). The redaction itself would miss query, path and `#`/`?` shapes (latent, below) |
| Phone and MCP status, camera snapshot | no | no (`camera.available`; pixels) | READ `machine-projections.ts:62`, `machine-camera.ts`, `electron/mcp/machine-tool-info.ts:85-88` |
| Clipboard | no caller | — | grep `writeText` |
| Crash reports, telemetry | none exist | — | grep: no `crashReporter`, no telemetry |
| The RTSP and phone fields on screen | the typed address this session (plain `type="text"`) | public form after a restart | READ `RtspSourceControls.tsx:34,70-78`, `PhoneCameraSection.tsx:79,128-136` |

## Findings

### K5-P3-1 — SECURITY (redacted)

- **Class:** another program on the same computer can briefly use a network camera's login through KerfDesk, without learning it.
- **CWE:** CWE-441.
- **Severity:** P3. The security file gives the case for P2.
- **Evidence:** REPRO (in the security file).
- **Announced?** No.
- **Novelty:** new.
- **Details:** redacted until fixed (AREAS.md rules). Where, anchor, scenario, REPRO, the case for and against, and fix direction are in the coordinator's scratchpad file `zz-k5/SECURITY-DETAILS.md`.

### K5-P3-2 — An `https` camera with its own (self-signed) certificate, or a camera that answers with a redirect, can never connect, and the operator is told to check the address, the app and the Wi-Fi

- **Where (`ba08a81af`):**
  - The bridge:
    - `electron/camera-frame-proxy-policy.ts:56-60` accepts `https://`.
    - `camera-frame-login.ts:46-52` fetches with `redirect: 'error'` (on purpose; SSRF hardening) and the platform's certificate check.
    - `camera-frame-proxy.ts:221-232` (`publicFrameError`) turns every fetch error, whether a certificate refusal, a redirect, a refused connection or a reset, into one text: "Camera frame fetch failed."
  - The window:
    - `src/ui/state/camera-snapshot-source.ts:34-51` (`snapshotFailureMessage`) reads only the bridge's `login` field.
    - Everything else becomes `SNAPSHOT_CAMERA_NO_PICTURE` (`:19-20`): "The camera did not send a picture. Check the address, that the camera app is running, and that the phone and this computer are on the same network."
  - `phone-camera-address.ts:38` and `:57` accept `https` for both phone choices.
- **Anchor:**
  - **Contract:** ADR-448 D2: "Starting fetches one picture first, so a wrong address or a stopped app says so instead of showing a blank preview."
  - **Twin:** a login problem is now named exactly (ADR-692 Amd 1 D5; p4: `refused`, `needed`, `unsupported`). The certificate and redirect causes go through the same path but lose their cause.
- **Evidence:** **REPRO** `p4-messages.mts` → `p4-messages.out.jsonl`, real `serveHttpFrame` → real `snapshotFailureMessage`:
  - `https` with a self-signed certificate: the bridge says "Camera frame fetch failed."; the operator reads "did not send a picture… check the address…".
  - A 302: the same two texts.
  - Nothing listening: the same two texts. Correct there, so the other two are indistinguishable from an unplugged camera.
  - p1 B-http: the self-signed fetch fails in 163 ms with no request reaching the camera, so no login is exposed (correct). The redirect target port was never contacted (correct).
- **Scenario:**
  1. A maker uses an IP camera's still address. Many cameras offer `https` with a built-in self-signed certificate, and some send `http` to `https` with a 302 once "HTTPS only" is on.
  2. They type the address, with the right login, under "Another app with a picture address".
  3. KerfDesk says to check the address, the app and the Wi-Fi, all of which are fine. Nothing says that the certificate is not trusted or that the camera redirected elsewhere.
  4. There is no way to accept the camera's certificate, so `https` cameras with their own certificate cannot be used at all. The only workaround, using the camera's `http` address if it still has one, is never suggested.
- **Severity:** P3.
  - **For:** the wrong cause costs a retry loop, and the `https` address is accepted by every check and can never work.
  - **Against P2:** nothing burns, nothing is lost, and the camera simply does not start.
- **Announced?** No. Amendment 1 says only that `rtsps://` is still refused.
- **Novelty:** new causes. They join the remainder of KNOWN Y2-P3-4: an HTML page and a video address also still read as "did not send a picture" (p4 `form`).
- **Fix direction:**
  - Keep the certificate check and the redirect refusal.
  - Have the bridge report a cause code (`tls`, `redirect` with the target's public form, `refused`, `timeout`, `not-image`, `too-large`), and map each in `snapshotFailureMessage`. For example: "The camera uses https with a certificate this computer does not trust. Use its http address." and "The camera sent KerfDesk to another address (https://192.168.1.50/). Enter that address."
  - Optionally allow pinning a camera's certificate fingerprint on first use, kept in the vault.

### K5-P3-3 — A network camera's calibration never follows a project or machine file to another computer, even for the same camera at the same address: the second computer says it "belongs to a different camera"

- **Where (`ba08a81af`):**
  - `src/ui/state/camera-resource-identity.ts:3,13-29,32-48`: the fingerprint is an HMAC under `laserforge.camera.resourceIdentityKey.v1`, a random key created on first use in this computer's local storage.
  - `src/core/camera/camera-capture-binding.ts:62-68` and `saved-cameras.ts:36-43`: a network calibration matches only when the fingerprints are equal.
  - `src/ui/camera/camera-model-frame.ts:56-57`: "The camera calibration belongs to a different camera. Switch back to that camera or calibrate this one."
- **Anchor:**
  - **ADR-446:** each saved model names its camera "so the model in use follows whichever camera is running and switching cameras never needs a recalibration". Machine profiles and projects are the files that carry calibrations between computers (ADR-692 Context: "Projects and machine profiles are routinely shared").
  - **ADR-692 D2** keeps the key on the computer for privacy. What that means on a second computer is not stated.
  - **Twin:** K2 found that another computer's *different* camera is refused, which is correct. This is the *same* camera.
- **Evidence:** **REPRO** `p4-messages.mts`, part `identity-second-computer`:
  - The same address gives the same public `sourceId` (`http://192.168.1.50:8080/`) on both computers. The fingerprints differ (`fingerprintsEqual: false`), so `cameraBindingCompatibility` gives `source-mismatch` (`match` on the first computer).
  - The same holds for an RTSP address without any login (`rtspNoLoginFingerprintsEqual: false`).
  - The message is READ.
- **Scenario:**
  1. A maker calibrates a phone or RTSP overhead camera on the shop PC, then exports the machine (`.lfmachine`) or opens the project on their laptop, which is driving the same laser with the same camera.
  2. The overlay refuses to draw, and Job Review and placement say the calibration belongs to a different camera.
  3. Only a full new calibration helps.
  4. The same happens on the same PC after the app's local storage is cleared or the app is reinstalled under a new profile: every network calibration reads as another camera.
- **Severity:** P3, with a **maintainer decision**.
  - **For:** the message is false (it is the same camera), and a portable calibration is lost.
  - **Against P2:** it fails safe. Nothing is placed with the wrong lens, and recalibrating works.
- **Announced?** No.
- **Novelty:** new as a finding. K2 noted the mechanism for a different camera, where refusing is right.
- **Fix direction:**
  - Keep the keyed fingerprint for telling apart two streams on one host, and add a portable fallback.
  - When the public form matches but the fingerprint was made under another key, treat the calibration as "unverified on this computer". Offer "Use this calibration and check it" (the moved check and a target check), and re-key on success, instead of "a different camera".
  - Otherwise say "This calibration was made on another computer; calibrate here or check it", not "a different camera".
  - USB cameras behave alike (per-profile `deviceId`), so one rule could cover both.

## KNOWN: status on `ba08a81af`

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y2-P2-1 (security, redacted) | credential exposure to other local processes | **Fixed** (ADR-692 Amd 1 D3) | READ; details in the security file |
| Y2-P3-1 (security, redacted) | partial credential persisted in plain local storage | **Fixed**: `#`, `?` and `@…#` passwords now keep the scheme only (`rtsp://`), and the repo fixture has the rows (`camera-login-forms.test-fixture.ts`). Still open: such an address fails with "Camera bridge accepts only loopback or private-network RTSP hosts.", which names the wrong problem (part of its fix direction) | p3 R8–R10, R12 |
| Y2-P3-2 (security, redacted) | credential-bearing address part in saved and shared files | **Fixed**: the public form is scheme, host and port | p3 R4, R14 |
| Y2-P3-3 (security, redacted) | credential sent in clear text on the local network | **Fixed**: no login before a 401; Digest MD5 and SHA-256 chosen over Basic; an unsupported Digest offered with Basic gets no login at all | p1 B-http, C-probe |
| Y2-P3-4 | Refused login reads "did not send a picture" | **Login causes fixed** (needed, refused and unsupported named exactly). **Remainder open:** an HTML page, a video address and an over-size picture still read "did not send a picture"; K5-P3-2 adds certificate and redirect | p4 |
| Y2-P3-5 | A refused login is polled at 2 Hz | **Bridge side fixed**: a login problem holds the source until it is connected again (`camera-frame-sources.ts:66-75`), with back-off for other failures. The window side (no `onFailure` for still cameras) stays KNOWN v2 12-P3-3 | READ; K4 E4 |
| v2 12-P3-3 / W4-P3-1 | A still camera that stops leaves its last picture with no sign | Open (K4) | K4 |
| W4-P3-2 | Auto-start cancellation misses RTSP and phone | **Open**: `startAddressCamera` takes no `current()` and checks nothing after the vault read (`auto-start.ts:87-97`) | READ |
| #1546 item 7 / v2 04-B-2 | `/probe` accepts a loopback RTSP host (port oracle) | **Open but gated**: `rtspCameraUrlPolicy` still allows `127.0.0.1`, `localhost` and `[::1]` (p1 A); only the token holder can reach `/probe` (p1 C) | p1 |
| Y2 latent note | Support-report redaction misses some address shapes | Still latent: `redactSupportReportText` leaves the user or secret of query, path-field, path-token and `#`/`?` shapes (p3 `supportRedactionOfTypedAddress`). No route puts an address into the report | p3, READ |
| Y2 note | The vault survives uninstall, with no "forget login" control | Unchanged; not re-checked | READ |
| ADR-692 Amd 1 Consequences | `rtsps://` refused | As announced | p1 A |

## Refuted (candidates dropped)

- **The frame proxy can be steered to loopback or the internet with address tricks.** No. 2130706433, 0x7f000001, 0177.0.0.1, 127.1, `127.0.0.1.`, `[0:0:0:0:0:0:0:1]` and `localhost`/`LOCALHOST` all read as loopback and are refused. IPv4-mapped IPv6, 0.0.0.0, `[::]`, 169.254.169.254, 100.64/10, public addresses and every host name (`camera.local`, wildcard-DNS names) are refused without any lookup. `user:pw@a@b` and `a\@b` are judged on the host the fetch will use, because the policy's parsed URL is what is fetched (p1 A). DNS rebinding is closed by name (no host names) and by Host (p1 C).
- **A login follows a redirect to another host.** No. Both a 302 after a successful login and an immediate 302 failed, and the other port was never contacted (p1 B). The RTSP probe does not follow redirects (Y2 c1, code unchanged).
- **A login goes to a camera that did not ask.** No. An open camera given a login received no Authorization (p1 B, C). Repeated pictures after one Basic success send Basic again to the same camera only (`basic x3`).
- **A web page or another program can use the bridge.** No. See the gates in the Headline (p1 C). `/health` answers anyone, but it carries only `ffmpegAvailable` and, for a well-formed challenge, an HMAC that is useless without the key.
- **Bridge or panel texts echo a login.** No. Every reason in p1, p3 and p4 was checked (`secretInReason: false`). A refused RTSP connect names `127.0.0.1:5338` only.

## Verified clean

- **#1649 / ADR-692 on every route** in the table above, for 14 shapes plus ten calibrations on one machine, saved, reopened, saved again and restored (p3).
- **Reconnect after a restart** (p3): RTSP reconnects with the full typed address from the vault for every shape that can connect, while the field shows the public form. A phone camera reconnects without its login, query or fragment, as the panel note announces ("Login details and anything after ? or # are used for this connection only… Paste the full address again…"), and then names the login it needs (p4 `needed`).
- **Reconnect after a credential change** (READ): typing a new address saves it and replaces the vault entry (`RtspSourceControls.tsx:42-51`, `remembered-camera-addresses.ts:36-41,94-98`). The bridge forgets the old answer for the new address and resets the source's hold on Connect (`camera-frame-proxy.ts:105-106`, `camera-frame-sources.ts:39-47`). A new probe gets a new preview session.
- **The login probe** (p1 C-probe, real keyed bridge): Basic and Digest succeed with the login only in the Authorization header, never in the request line. A wrong login reads "refused the user name or password", a missing one "needs a user name and password". An open camera given a login gets none. A query login stays in the request line as typed, which is inherent to such cameras.
- **The HTTP login answerer** (p1 B): Digest MD5 and SHA-256 are answered; Bearer, a 401 without a challenge (form sites) and an unsupported Digest read "asks for its login in a form KerfDesk does not send". An HTML form page (200) is refused as "not an image".
- **The bridge's keys:** the HMAC proof matches the launch's keys; the proof key never goes to the bridge port (READ `camera-bridge.ts:94-114`); the token is compared in constant time (`camera-bridge-keys.ts:46-51`).
- **The vault:** OS encryption only, written `0o600` through a temp file and a rename, every failure read as "nothing kept", and only `rtsp(s)://` or `http(s)://` up to 4,096 characters with no control characters accepted (READ `camera-address-store.ts`; Y2 c8). The route answers only the app's own same-origin request with its header (READ `camera-address-routes.ts:26-37`, `app-route-guard.ts`).
- **Size and time bounds:** 8 MiB per picture (also when no length is declared), a 10 s fetch timeout, 16 KiB request bodies, 16 KiB RTSP headers and 256 KiB of SDP, and at most 4 FFmpeg processes (READ; K4 E1/E5 and Y2 c2/c6 measured them).

## Not verified

- **FFmpeg and Electron themselves:** no FFmpeg (not installed) and no Electron, so `safeStorage` on real backends, the `app://` protocol handler, and Chromium's own console output were READ only. Not checked: whether FFmpeg follows an RTSP redirect from a LAN camera to another host, and with what login (the relay gives it none).
- **Real cameras:** their certificates, redirects and login forms. The `https` and redirect causes in K5-P3-2 are shown on stubs only.
- **Linux and macOS:** the Windows-only parts of K5-P3-1's evidence are named in the security file.
- **The browser build's bridge** (keyless, development origins) was READ only: it trusts `http://localhost` and `127.0.0.1` pages on any port, which ADR-136 accepts for local development.
- **Vitest** was not run (memory).

## Repro files

All files are in scratchpad `zz-k5\`. Run from there with `node --max-old-space-size=300 --no-experimental-webstorage --import ./register.mjs <file>`, with the stub running for p1 and p4: `node stub.mjs "<contents of secret.txt>"` (127.0.0.1:5331–5334; HTTPS needs `tls\` from `openssl req -x509 … -subj /CN=127.0.0.1`).

- `stub.mjs`: the HTTP, HTTPS, RTSP and "other host" stubs; `GET :5331/__log` lists every request seen.
- `p1-bridge.mts` → `p1-bridge.out.jsonl`: policy matrix, HTTP logins, the real keyed bridge's gates and probe (Headline, Refuted, Verified clean, KNOWN).
- `p3-routes.mts` → `p3-routes.out.jsonl`: the #1649 route matrix and the restart (table, KNOWN Y2-P3-1/2).
- `p4-messages.mts` → `p4-messages.out.jsonl`: start messages (K5-P3-2) and identity on a second computer (K5-P3-3).
- The repro files for the redacted finding are listed in `SECURITY-DETAILS.md` only.

```json
[
  {"id":"K5-P3-1","severity":"P3","area":"camera-connect-and-privacy","file":"(redacted)","line":0,"anchor":"(redacted)","evidence":"REPRO","known":false,"summary":"SECURITY (redacted): another program on the same computer can briefly use a network camera's login through KerfDesk, without learning it. CWE-441. Details in zz-k5/SECURITY-DETAILS.md"},
  {"id":"K5-P3-2","severity":"P3","area":"camera-connect-and-privacy","file":"src/ui/state/camera-snapshot-source.ts","line":34,"anchor":"ADR-448 D2 (a wrong address says so); twin: login causes named exactly (ADR-692 Amd 1 D5)","evidence":"REPRO","known":false,"summary":"An https camera with a self-signed certificate, or one that answers with a redirect, can never connect; the bridge reports only 'Camera frame fetch failed.' and the panel says to check the address, app and Wi-Fi; joins the remainder of Y2-P3-4 (HTML page, video address)"},
  {"id":"K5-P3-3","severity":"P3","area":"camera-connect-and-privacy","file":"src/ui/state/camera-resource-identity.ts","line":32,"anchor":"ADR-446 (calibration follows its camera); ADR-692 D2 (per-computer key; consequence unannounced)","evidence":"REPRO","known":false,"summary":"The keyed fingerprint uses a per-computer key, so the same network camera at the same address gives source-mismatch on a second computer (or after local storage is cleared): 'The camera calibration belongs to a different camera'; recalibration needed; maintainer decision"}
]
```

Auditor counts: raised 3, refuted 0, P1 0, P2 0, P3 3 (1 of them a redacted security finding), known 12


## Refuter (2026-11-14)

**Tree and harness.** Same read-only export `j42-main` (`origin/main` @ `ba08a81af`). `git diff --stat ba08a81af origin/main -- electron src/core/camera src/ui/camera` at `53393cc16` touches only `core/camera/model/extrapolation-estimate*`, `head-camera-estimate*` and `ui/camera/calibrate/*`. None of these is in K5, so every result stands on current main.

My files are in `zz-k5r\`. I read the auditor's scripts for API shape only, and nothing imports a `zz-k5` file. My method differs on purpose:
- **My own stub process** (`cam-stub.mjs`, 127.0.0.1:5341-5345). It runs an RTSP camera (Basic path, Digest MD5 path, open path; it streams marker media after PLAY), an HTTP camera (open, Basic, Digest, 401 without a challenge, 302 at once, 302 after login), and a recorder standing for "another host". The "other local program" runs in this process, apart from the code under test.
- **The real code in a second process:** the real bridge fetch path (login answerer, redirect refusal) and the real `snapshotFailureMessage`, fed by the refuter's own stub. The parts used for the redacted finding are named only in the private security file.
- **#1649 by a different route from the auditor's:**
  - 35 address shapes went through the pure public forms and the real plain-storage savers. This adds no-host, scheme-typo, tab, backslash, `;param`, `%3A`, `[fe80::]`, `:80`/`:443` and double-`@` shapes to the auditor's 14.
  - **Legacy files that already carry a login:** a project, a `.lfmachine`, a remembered machine and older plain remembered addresses, each read and saved again. The auditor started from clean typed input.
- **Runs.** One test process (≤ 300 MB) beside the stub. Synthetic login `r5user` / `R5-<random hex>`, masked as `<S>`. No Vitest, browser, pnpm, FFmpeg, Electron, camera, network or hardware. Every listener on 5341-5349 was stopped.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
|---|---|---|---|
| K5-P3-1 | **SECURITY (redacted).** Another program on the same computer can briefly use a network camera's login through KerfDesk, without learning it. CWE-441. **CONFIRMED independently; raised** | **P2** (was P3; suggest ledger ID K5-P2-1) | REPRO (details in the coordinator's security file) |
| K5-P3-2 | **CONFIRMED.** Self-signed https, a 302 at once, a 302 after the login and a dead port all give the bridge "Camera frame fetch failed." and the operator "did not send a picture… check the address…" | P3 | `r2-privacy.mts` part 4 |
| K5-P3-3 | **CONFIRMED, and wider**: see K5-R-P3-4 | P3, maintainer decision | `r2-privacy.mts` part 3 |
| K5-R-P3-4 (new) | A password change on the **same** computer makes a calibration "belong to a different camera" when the login sits in the query or path | P3 | `r2-privacy.mts` part 3 |

**K5-P3-1: CONFIRMED; P2.** SECURITY (redacted). Reproduced independently; no password is disclosed. Under METHOD §3 a weakness that needs local access and is reachable today on the shipped desktop is P2. Details are in the coordinator's private security file.

**K5-P3-2: CONFIRMED; P3.**
- Real `fetchFrameBytes` → real 502 body → real `snapshotFailureMessage`. The self-signed https camera completed no TLS handshake, and the 302 targets were never contacted (correct). All four causes read the same as an unplugged camera.
- The login causes are distinct and correct: `refused`, `needed`, and `unsupported` for a 401 without a challenge.
- I agree with the auditor's grade: nothing burns, and the camera does not start.

**K5-P3-3: CONFIRMED; P3, maintainer decision.**
- With the same address under a second identity key, `cameraBindingCompatibility` gives `source-mismatch`. Under the same key it gives `match`.
- ADR-692 D2 says the key "never leaves this computer". Neither ADR-692 nor ADR-446 announces that a calibration therefore cannot move to another computer.

**K5-R-P3-4 (new, P3): a camera whose login is in its query or path loses its calibration when its password changes.**
- **Where:** `src/ui/state/camera-resource-identity.ts:23` hashes the address without userinfo but **with** the path and the query, and `camera-capture-binding.ts:68` compares the fingerprints.
- **REPRO:** on one computer, only the password changes:
  - userinfo login: `match`;
  - RTSP query login: `source-mismatch`;
  - RTSP path fields (`/user=…_password=…`): `source-mismatch`;
  - phone or snapshot `?usr=&pwd=`: `source-mismatch`.
- **Scenario:** an owner changes the camera's password, which is also what ADR-692's release note asks of camera owners. They type the new address, and the overlay, Job Review and placement say "The camera calibration belongs to a different camera". A full recalibration follows.
- **Anchor:** ADR-446 (the model follows its camera, so switching never needs a recalibration). Twin: the same change in userinfo keeps `match`.
- **Severity:** P3. It fails safe. **Fix direction:** keep this with K5-P3-3's decision. Exclude login-shaped query and path fields from the identity, or offer "check this calibration" when the public form matches.

### #1649 and the clean claims

- **Holds.** None of 35 shapes leaked the secret, its percent-encoded form, the Basic token or the user name into the public form, the binding's source id, the phone public form or plain local storage (`r2` part 1).
- **Legacy files are cleaned on read** (`r2` part 2). A project and a `.lfmachine` holding a login in five shapes (userinfo, query, path token, `#` inside a password, phone http) come back clean in memory and save clean. A remembered machine that held the login is clean when restored and rewritten clean in storage. Older plain remembered RTSP and phone addresses are rewritten to scheme, host and port on first read.
- **Error texts:** no bridge reason interpolates an address (grep of every camera, RTSP and policy file in `electron/`). The window's start errors pass bridge reasons through unchanged (READ `camera-source-actions.ts:246-273`, `camera-snapshot-source.ts:70-91`). The login texts in `r2` echo nothing.
- **Not re-run by me**, but I agree from READ: the support report (no route puts an address there; the redaction gaps stay latent as noted), MCP and phone status (`camera.available` and pixels only), crash or telemetry (none exist).
- **Proxy login policy** (spot-check, own HTTP stub): no login went to an open camera or before a 401, and none crossed a redirect (the recorder was never contacted). Digest was used where offered.

### KNOWN: confirmed

- **Y2-P3-4 remainder:** confirmed. Redirect and TLS read generic (`r2`). The HTML-page case was not re-run.
- **W4-P3-2:** confirmed by READ. `startAddressCamera` (`auto-start.ts:87-97`) takes no `current()` and checks nothing after the vault read, so RTSP and phone auto-start cannot be cancelled.
- **#1546 item 7 / v2 04-B-2:** confirmed by READ. `rtspCameraUrlPolicy` still accepts `localhost`, `::1` and `127.x` (`private-network-host-policy.ts:14,64`), with the bridge token as the only gate.
- **Other rows:** not re-checked; the auditor's status stands.

### Not verified

- FFmpeg itself, so a real FFmpeg's start-up and refusal times are not measured (a native stand-in was used).
- Real cameras, Linux and macOS.

Refuter counts: raised 4, refuted 0, P1 0, P2 1, P3 3, known 12
