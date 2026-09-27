# KerfDesk Desktop (Electron) audit, 27 Sep 2026

## Verdict

The desktop app is built correctly at its core, and no rewrite is needed. Its security design follows Electron's own
20-point checklist on every point that applies. The gaps are around the edges: things a desktop user expects that
were never wired up, a packaged app that ships far more than it needs, missing lock-down switches on the shipped
.exe, a loose local camera server, and a Windows signing pipeline that cannot work with a certificate bought today.
All of it can be fixed in place without changing how the app works.

Method: read every file in `electron/`, both electron-builder configs and the desktop workflows; checked each point
against Electron's docs for the 42 branch, electron-builder 26 source, Microsoft Learn and the CA/B Forum; then built
the app and launched the real Electron 42.11.5 binary (Linux, driven with Playwright) to confirm each user-facing
finding. Nothing was tested on Windows hardware or a Mac.

## What is right

- No preload script and no IPC. The page has no Node.js and talks to nothing privileged, so there is no bridge to abuse.
- Sandbox and context isolation are on; `webSecurity` is untouched; no experimental Blink features.
- The page loads from its own `app://` scheme, not `file://`, with the documented path-traversal check.
- A strict Content-Security-Policy (`script-src 'self'`) that a test keeps identical to the web build's headers.
- Permission check and request handlers deny by default and only allow what the trusted page needs (serial, camera,
  wake lock, file saving).
- Navigation is locked to the app, new windows are denied, and only the official download link opens in a browser.
- One instance at a time, with `.lf2` files handed to the running window; closing waits for the page so unsaved work
  and a running job are not lost.
- `app.setPath` runs before `ready`, which ESM main processes often get wrong.
- The update feed is HTTPS and the updater's publisher check is switched on (but see S2).

## Findings

Batch letters say which fix batch covers each one.

### Things a desktop user notices (Batch A, built)

| # | Finding | How it was confirmed |
|---|---|---|
| A1 | Links that open a new tab do nothing: Help > Report a Bug, Discussions, and every other outside link. The new-window handler denied everything except the download link. | Clicked in the real app: no browser, no window. |
| A2 | Copy to clipboard fails in Desktop (copying G-code, error details, anything using the Clipboard API). The permission handler denied `clipboard-sanitized-write`. | `navigator.clipboard.writeText` rejected in the real app. |
| A3 | No right-click menu in text fields, so no Cut/Copy/Paste and no spelling suggestions. Electron shows none unless the app builds one. | Right-clicked a field in the real app. |
| A4 | Window size, position and maximized state are never remembered; it always opens at 1280 x 800 in the middle of the main screen. | Code reading and relaunch. |
| A5 | If the page process dies (out of memory on a huge image, a GPU driver fault), the window stays blank with an error box and the only way back is to kill KerfDesk. | Killed the renderer in the real app. |
| A6 | Developer mode (`LASERFORGE_DEV_URL`) shows a blank window: the CSP blocks Vite's React refresh preamble. Developers only. | Launched against the dev server. |
| A7 | `console-message` uses the old positional signature Electron deprecated in 35. | Electron 42 docs. |
| A8 | Windows taskbar identity is never set. The installer's shortcuts use `dev.laserforge.app`, and Electron only sets it for Squirrel installs, so pinned icons and notifications can group under the wrong app. | Code and docs reading; not seen on Windows. |

### Packaging and versions (Batch B, next)

| # | Finding |
|---|---|
| B1 | `app.asar` is 110 MB, and 88.6 MB of that is renderer-only `node_modules` the main process never loads (lucide-static alone is 44 MB; the renderer is already bundled into `dist/web`). The installer and every update are several times larger than they need to be. |
| B2 | No Electron fuses are set. The shipped `KerfDesk.exe` still runs as plain Node.js with `ELECTRON_RUN_AS_NODE`, honours `NODE_OPTIONS`, and accepts `--inspect`, so anything on the PC can run arbitrary code under KerfDesk's name. electron-builder writes the ASAR integrity hash into the .exe but it is not enforced until the fuses are flipped. |
| B3 | electron-builder 26.15.3 is locked. Its NSIS installer can fail to install the main .exe and native files (upstream issue #9983, fixed in 26.15.6). npm's `latest` tag still points at 26.15.3, so the fix is a pin to 26.17.0. |
| B4 | Electron 42.11.5 is three patches behind 42.11.8 (Chromium and V8 security backports). Electron 42 support ends about 20 Oct 2026 when 45 ships. |
| B5 | electron-updater 6.8.9 has multi-range differential download bugs fixed in 6.8.10. |
| B6 | Pull requests never launch the packaged app. The packaged smoke test runs weekly on Windows only, so a packaging break (like B3) is found after release. |
| B7 | The macOS preview config skips signing (`identity: null`). Once fuses are flipped, Apple Silicon refuses to launch it unless `resetAdHocDarwinSignature` is set. Electron 44 also drops macOS 12, so `minimumSystemVersion` must move to 13 then. |

### Local camera bridge (Batch C)

| # | Finding |
|---|---|
| C1 | The RTSP camera bridge on `127.0.0.1:51731` accepts any `Host` header and any request with no `Origin` header (`isAllowedBridgeOrigin` returns true for `undefined`, `electron/rtsp-camera-bridge.ts:213`). A web page open in any browser on the same PC can reach it through DNS rebinding or a plain `<img>` tag, and make it connect to RTSP addresses on the local network. Fix: accept only `Host: 127.0.0.1:<port>` or `localhost:<port>`, and refuse requests with no Origin (KerfDesk's own camera images already send one). Done in ADR-141 Amendment 1. |
| C2 | The bridge runs inside the main process. Electron recommends a `utilityProcess` for network-facing or crash-prone work, so a bad camera stream cannot take the app down. Lower priority. |

### Serial port (Batch D, proposal)

| # | Finding |
|---|---|
| D1 | Serial port permission is kept only in memory (no `setDevicePermissionHandler`), so every restart forgets it. This is known and recorded in ADR-366. Persisting it would let Connect reach the remembered machine without a picker; the Machine setup thread owns Connect, so this is a proposal for that thread. |

### Windows signing and updates (needs the maintainer)

| # | Finding |
|---|---|
| S1 | The stable release workflow signs with a `.pfx` certificate file (`WIN_CSC_LINK`). Since June 2023 certificate authorities issue code-signing keys only on hardware tokens or cloud key vaults, so no certificate bought today can come as a `.pfx`. The pipeline cannot sign with a new certificate as written. |
| S2 | Without a certificate, `app-update.yml` has no publisher name and electron-updater silently skips the publisher check, so `verifyUpdateCodeSignature: true` protects nothing: whoever controls `dl.kerfdesk.com` can push code to every install. EV certificates no longer skip SmartScreen either (Microsoft, 2024); reputation now builds per publisher. |

Options for S1/S2:

1. **Azure Artifact Signing** (about 10 USD a month). CI signs every release with no hardware. Open to companies in
   the US, Canada, EU and UK, and to individuals in the US and Canada only. electron-builder 26 supports it directly
   (`win.azureSignOptions`).
2. **Certificate on a cloud key vault** from a certificate authority (for example SSL.com eSigner or DigiCert
   KeyLocker), a yearly fee, available anywhere. CI signs through the vendor's signing tool.
3. **Stay unsigned.** Windows keeps showing "Unknown publisher" warnings and updates stay unverified.

Whichever is picked, the workflow change is small and can be made the day the account exists.

## Not verified

- Spelling dictionaries on Windows: Electron downloads them from Google on first use; it worked on Linux.
- The macOS preview build launching on Apple Silicon.
- Anything on real Windows hardware (installer, taskbar icon, SmartScreen).

## Fix plan

- **Batch A** (built, draft PR): outside links open in the browser (https only, no embedded credentials); clipboard
  write allowed for the trusted page only (read still denied); Cut/Copy/Paste/Select All and spelling right-click
  menu; window place remembered and restored only while a screen still shows it; reload offer after a page crash that
  keeps the E-stop instruction; taskbar identity set; dev mode renders; current event signatures. ADR-482.
- **Batch B**: fuses on both configs, ASAR integrity enforced, renderer-only packages out of `app.asar`, Electron
  42.11.8, electron-builder 26.17.0, electron-updater 6.8.10, and a Linux packaged-launch check on every PR that
  fails if the app does not start or the fuses are not set.
- **Batch C**: camera bridge Host check and required Origin (ADR-141 Amendment 1).
- **Batch D**: persisted serial grant, proposed to the Machine setup thread.
- **Electron 44**: its own draft PR once A and B land, before 42's support ends on 20 Oct 2026.
