## ADR-606 - Linux desktop packages and macOS and Linux integration

**Status:** Accepted by the maintainer's request on 2026-10-18 ("I need full apple and Linux
integration"). Amends ADR-248 decision 1 and 3 (Linux out of scope, no Linux artifact), ADR-552
decision 5 (macOS and Linux unchanged), and PROJECT.md Phase J. Software and CI verification only;
no Mac or Linux computer with a machine attached has run it yet.

### Context

KerfDesk's desktop app ran on Windows first. The Mac build existed as an unsigned Preview, and
Linux had no desktop build at all (PROJECT.md "Phase J"), so a Linux operator could only use the
web app. An audit of the desktop shell on 2026-10-18 found these gaps on macOS and Linux:

1. No Linux package: no installer, desktop entry, icon or `.lf2` file type, although CI already
   launched an unpacked Linux build on every pull request (ADR-522).
2. A Linux file manager opens a double-clicked file through the desktop entry's `%U`, which hands
   KerfDesk a `file://` link. KerfDesk read only plain paths.
3. Menus, tooltips, command search and the Keyboard Shortcuts dialog showed "Ctrl+S" on a Mac,
   where the same shortcut is Command-S. The key handlers already took Command for Ctrl.
4. An app opened from the Finder or the Dock gets macOS's short default PATH, which leaves out
   Homebrew and MacPorts, so network (RTSP) cameras never found an installed FFmpeg (ADR-551,
   PROJECT.md "until Finder-safe FFmpeg discovery is separately designed").
5. The desktop app forgot every serial port pick at restart on macOS and Linux (ADR-366, ADR-552
   decision 5), unlike Chrome on the same computer.
6. On Linux, Chromium's "Failed to open serial port" usually means the account is not in the
   serial group (`dialout`, or `uucp` on Arch), but KerfDesk called the port busy.

### Decision

1. **Linux packages.** `electron-builder.yml` and `electron-builder.preview.yml` gain a Linux
   block: an x64 AppImage and an x64 `.deb`, executable and package name `kerfdesk`, the 512 px
   app icon, category Graphics, maintainer `support@kerfdesk.com`. The `.lf2` association gains
   the MIME type `application/x-kerfdesk-project`, so the desktop entry claims `.lf2` and nothing
   else (LightBurn files stay LightBurn's, as ADR-378 says). `desktopName` in `package.json`
   (`kerfdesk.desktop`) with `syncDesktopName` keeps the running window grouped with its entry on
   X11 and Wayland. `linux.publish: null` writes no updater metadata: no Linux update feed exists
   yet, and without it electron-builder would derive one from the git remote, or inherit the
   stable config's Windows feed.
2. **Chromium's sandbox stays on where Linux allows it.** The `.deb` keeps electron-builder's
   install scripts, which set up `chrome-sandbox` and, on Ubuntu 24.04 and newer, an AppArmor
   profile that lets the sandbox use user namespaces. electron-builder writes `--no-sandbox` into
   every AppImage desktop entry; `appImage.executableArgs: []` removes it, so the AppImage's own
   launcher drops the sandbox only where the system blocks user namespaces. On such a system the
   AppImage runs without Chromium's sandbox; the `.deb` keeps it.
3. **Linux file opens.** On a POSIX path API, a `file://` launch argument becomes its path when it
   is local (no host, or `localhost`) and has no query, fragment, or encoded slash or NUL. Every
   other check of ADR-378 applies to the result unchanged.
4. **Mac shortcut labels.** Wherever KerfDesk shows a shortcut, a Mac shows it with the Mac's own
   symbols in Apple's order (Option, Shift, Command), for example `⇧⌘V` for Ctrl+Shift+V. Keys,
   handlers and the Windows and Linux labels are unchanged.
5. **FFmpeg on a Mac.** After the folders on PATH, KerfDesk looks in `/opt/homebrew/bin`,
   `/usr/local/bin` and `/opt/local/bin` (Homebrew on Apple silicon and Intel, then MacPorts),
   always by full path. Windows and Linux still search PATH alone. The "FFmpeg not installed"
   message names the install step for each system.
6. **Remembered serial ports on macOS and Linux.** The device permission handler of ADR-552 is
   installed on macOS and Linux too, and remembers a pick by the identity Electron 44.5.1 stores
   there (`shell/browser/serial/serial_chooser_context.cc`, `PortInfoToValue`): USB vendor ID,
   product ID and serial number, plus the USB driver name on macOS. An adapter without a serial
   number (most CH340 boards) cannot be stored by Electron, so it stays a pick for the run, as in
   Chrome. Every other rule of ADR-552 (trusted origin only, Forget removes the port, 16 picks,
   bounded file) applies unchanged. The renderer's `picksEndOnRestart` is false on Windows, macOS
   and Linux.
7. **Linux serial access.** When a serial port fails to open on desktop Linux (web app or desktop
   app), the message adds the one-time step: add the account to `dialout` (`uucp` on Arch), then
   log out and back in. KerfDesk changes no system group and installs no udev rule.
8. **CI.** The Desktop package check gains a Linux job on every pull request: it builds the
   AppImage and `.deb` from the Preview config, checks their contract
   (`scripts/verify-linux-package.sh`: identity, legal files, desktop entry, MIME type, no updater
   metadata), checks fuses and `app.asar`, installs the `.deb` with Ubuntu's user-namespace
   restriction still on, launches, imports and saves in the installed app, removes it, and proves
   a modified `app.asar` stops the app. The existing unpacked Linux job now launches `kerfdesk`.

### Not decided here

- **Publishing.** No Linux file is published yet. The signed Preview manifest
  (`public/desktop-release-manifest.mjs`) and the manual commercial download
  (`public/desktop-manual-download.mjs`) each accept an exact artifact list that installed copies
  check, so adding Linux to them needs a design that keeps those copies working. The download page
  and the desktop download link keep naming Windows and macOS until then.
- **Signed and notarized Mac builds.** These need the maintainer's Apple Developer ID and
  notarization credentials (ADR-024/135/248). The Mac build stays the unsigned Preview.
- **Linux arm64** (for example a Raspberry Pi beside the machine) and other package formats (RPM,
  Flatpak, Snap).

### Consequences

- A Linux operator can build and install KerfDesk from this repository today, and every pull
  request proves the `.deb` installs and runs on Ubuntu 24.04.
- A Mac operator reads shortcuts as their keyboard shows them, and a Homebrew FFmpeg works for
  network cameras without starting KerfDesk from Terminal.
- On macOS and Linux, Connect automatically works at start for adapters with a serial number,
  as it does on Windows.
- The unpacked Linux executable is now `kerfdesk` (was `laserforge`); only CI referred to it.

### Verification

Unit tests cover the Mac shortcut labels and system detection, the Linux serial message, FFmpeg
discovery and messages per system, `file://` launch arguments (accepted and refused), and serial
identity and remembering on macOS and Linux (both Electron forms, driver and serial-number cases,
twins, Forget, restart). The Linux package contract and the install-and-launch run in CI. Real
macOS and Linux desktops, file managers and serial adapters remain unqualified.
