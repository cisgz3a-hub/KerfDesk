## ADR-483 - The desktop package ships only what main loads, with Electron's fuses set (2026-09-27)

**Date:** 2026-09-27
**Status:** Implemented; software verification recorded below. Not yet tried on Windows hardware.

This follows ADR-482 from the same audit (`docs/audits/2026-09-27-electron-desktop-audit.md`). It
changes what electron-builder packs and flips in the executable; it changes no app behaviour and
adds no guard (ADR-228).

### Context

- **The package carried the renderer's dependencies twice.** electron-builder copies every
  production dependency into `app.asar`. KerfDesk's renderer is already bundled into `dist/web`,
  and the main process imports only `electron`, Node built-ins and `electron-updater`. In a
  packaged 42.11.5 build, 88.6 MB of the 110 MB `app.asar` was renderer packages main never
  loads (lucide-static alone was 44 MB). Every installer and every full update carried them.
- **No fuses were set.** Electron's fuses are switches baked into the executable. With the
  defaults, the shipped `KerfDesk.exe` runs as plain Node.js when `ELECTRON_RUN_AS_NODE` is set,
  honours `NODE_OPTIONS`, accepts `--inspect`, loads an app from outside `app.asar`, and never
  checks `app.asar` against the hash electron-builder writes into the executable. Any program on
  the PC could therefore run code under KerfDesk's name and signature, or swap its app code.
  Electron's security checklist item 19 asks apps to turn off what they do not use.
- **Nothing checked a packaged app on a pull request.** The packaged smoke ran weekly, on Windows
  only, and electron-builder applies file patterns and fuses silently.
- **Versions.** electron-builder 26.15.3 has an NSIS bug that can install without the main
  executable and native files (upstream #9983, fixed in 26.15.6). Electron 42.11.5 is three
  patches behind 42.11.8, which carries Chromium and V8 security backports.

### Decision

- **Only the updater's closure ships.** Both builder configs exclude `node_modules` from the
  package and re-include exactly `electron-updater` and its installed dependency tree (16
  packages). This also covers the old `pdfjs-dist` and `@napi-rs/canvas` exclusions.
  `electron/packaged-runtime-closure.test.ts` fails if main starts importing another package, or
  if the allowlist stops matching `electron-updater`'s installed dependencies.
- **Fuses.** Both configs set `electronFuses`: `runAsNode`, `enableNodeOptionsEnvironmentVariable`,
  `enableNodeCliInspectArguments`, `loadBrowserProcessSpecificV8Snapshot` and
  `grantFileProtocolExtraPrivileges` off; `enableEmbeddedAsarIntegrityValidation` and
  `onlyLoadAppFromAsar` on. `wasmTrapHandlers` keeps Electron's default (on).
  - `enableCookieEncryption` is on for the Windows stable build (DPAPI, no prompt) and off for the
    Preview, whose unsigned macOS build cannot use the Keychain reliably. KerfDesk keeps no login
    cookies either way.
  - The Preview sets `resetAdHocDarwinSignature`, because flipping fuses invalidates the ad-hoc
    signature and Apple silicon then refuses to launch the app.
  - The weekly and installed-app qualification scripts launch with `--remote-debugging-port`, a
    Chromium switch the inspect fuse does not affect.
- **Every pull request packages and launches the app.** `.github/workflows/desktop-package-check.yml`
  packages the stable config as an unpacked Linux app, runs `scripts/verify-packaged-desktop.mjs`
  (the executable's fuse wire must match the config, and `app.asar` must hold the main process,
  the renderer bundle, no main-process source maps and exactly the allowed `node_modules`), then
  runs the existing packaged native smoke (launch, SVG import, project save) under Xvfb with
  Chromium's sandbox on. It is its own workflow, so a desktop packaging failure never holds a web
  deploy. The native smoke CLI now accepts Linux as well as Windows.
- **Versions.** Electron 42.11.8 and electron-builder 26.16.1. electron-builder 26.17.0 and
  electron-updater 6.8.10 were one day old on this date; they follow once they have been out a
  week, with Electron 44 before 42's support ends on 20 Oct 2026.

### Consequences

- `app.asar` drops from about 110 MB to about 25 MB, most of it the renderer bundle.
- A main-process import of a new package fails a unit test until the allowlist names it.
- `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` no longer work on a packaged build.
  Development runs (`electron .`) use the stock Electron binary and are unaffected.
- Editing `app.asar` after packaging now stops the app at launch on Windows and macOS.

### Verification

- A Linux package of the stable config built with Electron 42.11.8 and electron-builder 26.16.1
  passed `scripts/verify-packaged-desktop.mjs` (fuse wire `010011001`, 16 node_modules packages in
  a 25.2 MB `app.asar`) and the packaged native smoke (launch, SVG import, save).
- The same settings on Electron 42.11.5 gave a package that ignored `ELECTRON_RUN_AS_NODE`,
  where the stock Electron binary ran as Node.
- Unit tests: `electron/packaged-runtime-closure.test.ts`, `scripts/verify-packaged-desktop.test.mjs`.
- Not verified here: Windows ASAR integrity enforcement (Linux has none), and the macOS Preview
  launch on Apple silicon.
