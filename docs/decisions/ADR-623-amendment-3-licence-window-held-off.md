## ADR-623 Amendment 3 - The licence window is held off; the desktop app keeps KerfDesk Free for now (2026-10-21)

**Status:** Implemented in source; reaches installed apps with desktop release 1.0.21 | **Date:** 2026-10-21 | **Amends:** ADR-623 decisions 1, 2, 4 and 6 and its consequences for release qualification, until the owner turns the window back on | **Restores for now:** ADR-540 item 1 and the desktop Free edition

### Context

ADR-623 put the commercial desktop app behind a licence window: no workspace until this device has
an active trial or licence, and no desktop Free edition. It was merged after 1.0.20 and was meant
to reach customers with 1.0.21.

The 1.0.21 release run on `main` 6cb3dab36 failed before publishing anything. Its historical
upgrade check installs 1.0.20, upgrades to 1.0.21 and reopens the app. 1.0.21 now opened behind the
licence window, and that check can only get past the window with the developer qualification
licence (`KERFDESK_NATIVE_QUALIFICATION_LICENCE`). The repository has no such secret, and the owner
cannot issue that developer licence without the licensing admin token. The owner needs 1.0.21 out
now, so they chose to release it without the licence window: the desktop app stays Free for now.
The licensing service itself is live (license.kerfdesk.com answers its health check, and Paddle is
live), so trials and paid licences keep working.

### Decision

1. **One setting holds the window off.** `public/desktop-licence-window.mjs` exports
   `DESKTOP_LICENCE_WINDOW`, set to `false`. The renderer, the main process, its licence messages
   and the release checks all read this one value. Turning the window back on is a one-line change
   to `true` in a later release, together with the qualification licence secret and the website
   copy (#1280), and an amendment recording that.
2. **While it is off, a commercial desktop build behaves as 1.0.20 did (ADR-540).** It opens
   straight into KerfDesk Free with its workspace mounted at once, before the first licence status.
   Opening a Pro tool asks for a trial or licence (`ProFeatureDialog`); a trial or paid licence
   unlocks Pro from that prompt or from Help > Licence; the status bar says "Free · Try Pro",
   "Free", "Pro trial · N days left" or "Pro". When rights end, only new Pro choices pause
   (ADR-540 Amendment 2, ADR-592) and KerfDesk Free keeps working. The messages in the licence
   panel, the Pro prompt, the support report and the browser's desktop download card say so again.
3. **The workspace counts as admitted when it mounts.** The main process starts its desktop
   services with the app, as in 1.0.20, rather than waiting for a mounted workspace to be let in
   (`servicesAlwaysAdmitted`): the camera bridge runs, and the file-open queue, remote access and
   serial port work as soon as the workspace is there. The renderer still acknowledges each
   renderer's admission generation, so nothing in the main process changes shape. Because the
   workspace now mounts before the first licence status, while Pro is still locked for startup
   (ADR-592), a project file handed over by the operating system at launch waits for that status
   (`initialLicenceStatus()`, up to 10 seconds) before it opens, as autosave recovery already does,
   so a licensed user's Pro project is never judged against the startup lock.
4. **The licence-window code stays.** `DesktopLicenceGate`, the admission signals, the startup
   ordering, the keyring checks and their tests are unchanged. The tests that specify the window
   pin the setting to `true`; `EditionProvider.licence-window-off.test.tsx` and the main-process
   and release-script tests pin it to `false`. ADR-623 Amendments 1 and 2 still apply: Amendment 2
   (paid licences keep working offline) does not depend on the window, and Amendment 1 applies
   again when the window returns.
5. **Release qualification follows the setting, and no check is weakened.** The flag
   `--expect-licence-window` keeps its name and now means "an unlicensed commercial package": with
   the window on it must open behind the window with no workspace I/O; with the window off it must
   open its KerfDesk Free workspace, import and save a project, report commercial licensing,
   `activation-required` and no Pro, and must not report a licence window. The fresh sandbox smoke
   follows the setting the same way. The historical upgrade qualification
   (`qualify-windows-installer.ps1`) reads the setting from the source it qualifies; while the
   window is off it hands no licence key to any child and passes `-LicenceWindowHeldOff`, so
   `installed-upgrade-profile.ps1` fails if a licence window appears at all and every reopen,
   including after the upgrade, the reinstall and the uninstall-retaining-data gap, must reach the
   workspace. Its retention checks are unchanged. The release therefore passes without
   `KERFDESK_NATIVE_QUALIFICATION_LICENCE`. The separate developer-licence qualification
   (`qualify-desktop-licence.mjs`) activates from Help > Licence while the window is off and
   expects the deactivated device to show "Free · Try Pro".

### Consequences

- PROJECT non-negotiable 21 is unchanged: neither the window nor its absence touches Frame, Start,
  output or a running job.
- The website keeps describing a desktop Free edition. #1280 (no desktop Free) must stay unmerged
  until a release turns the window back on.
- The purchase email still says to paste the key "in the licence window it opens with, or in Help >
  Licence". Help > Licence is accurate while the window is off; the email changes with the service,
  not with this release.
- Linux still needs a desktop keyring to save a trial or licence key (ADR-623 Consequences); without
  one, KerfDesk Free runs and the licence panel names GNOME Keyring and KWallet.
