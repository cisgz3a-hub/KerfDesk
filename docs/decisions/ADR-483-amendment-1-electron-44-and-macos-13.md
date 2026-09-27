## ADR-483 Amendment 1 - Desktop moves to Electron 44, and the Mac Preview needs macOS 13 (2026-09-27)

**Status:** Implemented | **Date:** 2026-09-27

### Context

ADR-483 pinned Electron 42.11.8 and planned the move to Electron 44 before 42's security fixes end
on 20 Oct 2026, when Electron 45 ships (`docs/audits/2026-09-27-electron-desktop-audit.md`, B4
and B7). Electron 44.4.5 is the current stable release.

The breaking changes in Electron 43 and 44 were read against the desktop code:

- Electron 44 drops macOS 12 (its Chromium 152 needs macOS 13 Ventura), stops shipping 32-bit
  Windows and 32-bit ARM Linux builds, links ANGLE into the executable instead of shipping `libEGL`
  and `libGLESv2`, removes the renderer `clipboard` module, and may pass a `null` `webContents` to
  `select-client-certificate`.
- Electron 43 opens save and open dialogs in Downloads when no path is given, and makes
  `NativeImage.toBitmap` return colour-space-normalised pixels.

KerfDesk uses none of the changed pieces. Its renderer has no preload and no Electron modules,
every config builds x64 only (plus the Mac's own architecture), nothing lists the ANGLE libraries,
and main handles no client certificates, never calls `toBitmap`, and shows only message boxes, no
save or open dialogs. Electron's permission manager, serial delegate and file-access permission
context were compared between 42.11.8 and 44.4.5: the paths KerfDesk's permission handlers rely on,
including the file grant check that arrives with no window, are unchanged.

### Decision

- **Electron 44.4.5**, pinned exactly like the other desktop build tools. electron-builder stays
  26.16.1 and electron-updater 6.8.9 until 26.17.0 and 6.8.10 have been out a week.
- **Mac Preview floor.** `electron-builder.preview.yml` sets `minimumSystemVersion: '13.0'`, so
  macOS refuses to open the app on 12 with a clear message instead of a crash. The download page,
  `PROJECT.md` and `WORKFLOW.md` say macOS 13 or newer, and the Monterey-only Gatekeeper wording
  (System Preferences) is gone.
- Windows 10 and 11 and 64-bit Linux are unchanged.

### Consequences

- Macs that cannot leave macOS 12 keep the Preview they already have, and get no newer Preview.
  Stable releases stay Windows-only.
- Electron 44 gets Chromium and V8 security fixes until Electron 47 ships.

### Verification

- Typecheck, `lint:electron`, format, `test:release-integrity` and the desktop and download-page
  Vitest suites pass; the Preview workflow gate pins `minimumSystemVersion: '13.0'`.
- The Electron 44.4.5 Linux binary was checked against the release's `SHASUMS256.txt` before use.
- A Linux package of the stable config on Electron 44.4.5 passed the package check (renderer
  bundle, allowed `node_modules`, fuse wire matching `electron-builder.yml`; `app.asar` 25.3 MB)
  and the packaged native smoke with Chromium's sandbox on (launch, SVG import, project save).
- The same checks the ADR-482 fixes were proven with, run again on Electron 44: outside links open
  in the browser and open no window, clipboard write works and read stays refused, the edit menu
  appears on right-click, the crash dialog reloads the window, the window reopens where it was
  closed, and the camera bridge answers `app://app` only (403 to a rebound Host, no Origin and a
  foreign Origin). `navigator.serial` is present and a module worker loads from `app://app`.
- Not verified here: macOS and Windows packages. The macOS Preview lane and the weekly Windows
  smoke cover them.
