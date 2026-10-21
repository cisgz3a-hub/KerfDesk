## ADR-613 - Commercial macOS and Linux downloads beside the unsigned Windows lane

**Status:** Accepted by the maintainer's request on 2026-10-18 ("I need full apple and Linux
integration": a normal download for every system). Implemented in source and CI; nothing is
published until the maintainer switches each system on (Consequences). Amends ADR-523 Amendment 5
(the unsigned lane was Windows only), ADR-561 decisions 1 and 2 (manual update checks were
Windows only) and ADR-561 Amendment 6 (download history), and resolves "Publishing" and the Linux
part of decision 9 left open by ADR-607 (Linux packages and macOS and Linux integration).

### Context

kerfdesk.com/download offers one verified customer download: the unsigned Windows installer of
the commercial lane (`.github/workflows/release-desktop-unsigned.yml`, ADR-523 Amendment 5,
ADR-561). A Mac had only the free, unsigned Preview (ADR-248), whose last build is months old, and
Linux had nothing. ADR-607 made the app itself ready on both systems and added the Linux AppImage
and `.deb` with CI install checks, but published nothing, because:

- **Installed Windows copies check an exact document.** Every unsigned Windows copy reads
  `desktop/commercial-manual/latest.json` and refuses it unless it names exactly one Windows
  installer (`validateManualDownload`, `commercialArtifactNames`). Adding a Mac or Linux file to
  that document, or to its per-version `download-manifest.json` or `catalog.json`, would make
  every installed copy report a failed update check.
- **Linux enforces no ASAR integrity.** Electron 44.5.1 checks the embedded `app.asar` hash on
  macOS and Windows only, so on Linux the code that checks a Pro licence can be changed by
  repacking one file (ADR-607 decision 9).
- **The Mac build is unsigned.** There is no Apple Developer ID or notarization yet (ADR-024,
  ADR-135, ADR-248). An ad-hoc-signed app passes Gatekeeper only through **Open Anyway**, and
  macOS ties its keychain items to the exact build, so it asks again after each update.

### Decision

1. **One release, three systems, Windows first.** When the unsigned lane publishes Windows
   version X.Y.Z, the same workflow run builds macOS and Linux from the same source commit and
   publishes them under the same version. The Windows job is unchanged except that, after it has
   published, it hands its release values and its already signed, public release identity
   (`commercial-release-identity.json`) to the new jobs. The macOS and Linux build jobs hold no
   signing key: `prepare-commercial-desktop.mjs --release-identity` verifies that identity
   against the pinned stable keys and writes the same licensing metadata from it. A macOS or
   Linux failure never holds, delays or withdraws the Windows release; re-running the failed jobs
   repeats the same version. Each system is switched on by its own repository variable,
   `KERFDESK_UNSIGNED_MACOS_RELEASES` and `KERFDESK_UNSIGNED_LINUX_RELEASES` (`on`); both are off
   until the maintainer sets them.
2. **The Windows documents stay exactly as they are.** `latest.json`, the per-version
   `download-manifest.json`, `catalog.json` and `release-notes.json` keep their schema, names and
   writer. The Windows publisher stays their only writer, and installed Windows copies never see
   a Mac or Linux file.
3. **A separate signed document per system.** Beside the Windows files the lane publishes:

   | System | Latest (`no-store`) | Per version, immutable | Files |
   | ------ | ------------------- | ---------------------- | ----- |
   | macOS | `desktop/commercial-manual/latest-macos.json` | `releases/X.Y.Z/download-manifest-macos.json` | `KerfDesk-X.Y.Z-macos-arm64.dmg`, `KerfDesk-X.Y.Z-macos-x64.dmg` |
   | Linux | `desktop/commercial-manual/latest-linux.json` | `releases/X.Y.Z/download-manifest-linux.json` | `KerfDesk-X.Y.Z-linux-amd64.deb`, `KerfDesk-X.Y.Z-linux-x86_64.AppImage` |

   Each is an Ed25519 envelope signed by the stable key, whose payload
   (`public/desktop-platform-download.mjs`) has the Windows identity fields plus
   `kind: "platform-download"` and `platform`, and lists exactly that system's files, in the
   order above, with size and SHA-256. `codeSigning` is `unsigned`; macOS also accepts
   `developer-id`, so the first notarized Mac build can reach unsigned Mac copies once, as
   `authenticode` does on Windows (ADR-579). The signature covers the system, so a Linux document
   cannot pass as a Mac one, and the Windows validator refuses both (different fields). The publisher
   (`scripts/publish-platform-commercial-release.mjs`) refuses unless the Windows
   `download-manifest.json` of the same version is already published with the same identity,
   which keeps one version line and guarantees the shared `release-notes.json` exists. It refuses
   rollback, backdating and conflicting immutable bytes, writes and reads back every versioned
   file, and moves `latest-<system>.json` last. The workflow's concurrency group keeps it the only
   writer. Earlier Mac and Linux versions stay downloadable by exact version
   (`download.html?version=X.Y.Z`); a listed history like Windows' `catalog.json` is not built
   yet.
4. **Packaging and qualification before anything is published.** One script,
   `scripts/build-commercial-platform.sh`, prepares, packages and qualifies each system, so a
   release and its CI rehearsal run the same commands.
   - **macOS:** `electron-builder.commercial-unsigned-macos.yml` adds the Preview's Mac packaging
     to the commercial lane: bundle ID `com.kerfdesk.app` (an installed Preview is replaced in
     place), macOS 13 or newer, an ad-hoc signature re-applied after the fuses are set, no
     notarization, and the Preview's fuse set (cookie encryption off, because an unsigned build
     cannot hold its keychain item reliably and KerfDesk keeps no login cookies). Each
     architecture builds on its own runner (Apple silicon `macos-15`, Intel `macos-15-intel`),
     then must pass the Mac package contract with `--commercial`
     (`scripts/verify-macos-preview-package.sh`: identity, legal and Electron notices, the signed
     commercial metadata in `app.asar` bound to the release identity
     (`scripts/verify-packaged-commercial-metadata.mjs`), no updater metadata, no notarization
     ticket, no Developer ID), the fuse and `app.asar` check against the Preview's fuse block, a
     launch, import and save from inside the DMG, and the ASAR tamper refusal.
   - **Linux:** the ADR-607 packages from the commercial config, then the same contract
     (`scripts/verify-linux-package.sh --commercial`), the fuse check, a `.deb` install and launch
     with Ubuntu 24.04's user-namespace restriction on, an AppImage launch without `libfuse2`,
     and removal. No tamper test runs, because Linux has none to prove (ADR-607 decision 9).
   - The publish jobs accept only files whose SHA-256 the qualifying job reported for exactly
     that file, so nothing changed in between can be published.
   - **Rehearsal.** The Desktop package check runs the same script for Linux on every pull
     request, and for macOS with the other native jobs, from a release identity signed by a
     throwaway key that `scripts/rehearse-commercial-identity.mjs` pins in that runner's checkout
     only. The publishers read the pinned keys of a clean checkout, so nothing a rehearsal signs
     can be published.
5. **In-app update notices on macOS and Linux.** A packaged commercial unsigned build on macOS
   (x64 or arm64) or Linux (x64) reads its system's `latest-<system>.json` at start and every 30
   minutes, and verifies it as Windows does: pinned stable keys, the exact system and file names,
   no rollback or backdating, and the licence's update coverage. A newer covered version shows
   the system notification, the status bar's Update available and the update card, with the
   shared release notes. Its action is **Open download page**: KerfDesk opens
   `https://kerfdesk.com/download.html?version=X.Y.Z` (built by the main process from the
   verified version) in the browser, where the page verifies the files again. KerfDesk never
   downloads or installs a Mac or Linux update itself; the operator closes KerfDesk and installs
   it. A verified in-app download for these systems is not decided here.
6. **Pro on macOS and Linux.** The Mac and Linux builds are the same commercial app: KerfDesk Free
   with no time limit, the 30-day trial and the paid licence, with every ADR-540 and ADR-592
   rule unchanged (three computers, check-ins, refunds revoke, sealed projects, Frame the only
   Start gate). No licensing code changes. What differs, and is accepted:
   - **Linux:** repacking `app.asar` defeats the local Pro check without touching the executable,
     and the device identity is `/etc/machine-id`, which an administrator can rewrite to start
     another trial. Both stay within ADR-544 and ADR-592 "What is still accepted" (patching the
     app defeats any client check): a changed copy unlocks Pro only on that computer and cannot
     create a licence key, a seat or a check-in. The service still binds every paid licence to
     three devices. Selling no Pro on Linux would leave paying Linux customers with nothing while
     barely slowing someone willing to patch the app. Revisit when abuse shows (ADR-544).
     A Linux licence needs GNOME Keyring or KWallet (`licensing-store.ts` refuses Chromium's
     plain-text fallback); without one, KerfDesk says secure storage is unavailable and stays
     Free.
   - **Unsigned Mac:** `app.asar` integrity is enforced and tested. The device identity is the
     Mac's firmware UUID (`IOPlatformUUID`), so ADR-592's separate Windows hardware ID is not
     needed there. After each update macOS asks whether KerfDesk may use its keychain item; if
     the operator denies it, KerfDesk cannot read its saved licence and needs the key entered
     again. The download page says to choose **Always Allow**.
   - The `kerfdesk://licence` link (ADR-579) stays Windows only: on a Mac or Linux computer the
     operator pastes the key in **Help > Licence**.
   - The published Software and Supplier Terms 1.2 grant Pro to "activated Windows
     installations" and a trial "once per Windows installation". Offering Pro on macOS and Linux
     needs Terms 1.3, which only the maintainer can publish (archive 1.2, notify Paddle). The
     release switches in decision 1 come after that step, and this change edits no legal text.
7. **The download page shows each system.** `public/download.html` keeps the Windows panel and
   adds a Mac panel (Apple silicon and Intel buttons) and a Linux panel (`.deb` for Ubuntu and
   Debian, recommended on Ubuntu 24.04 and newer, and the AppImage for other distributions).
   Each shows its version, size, release date and SHA-256 only after the page verified that
   system's signed document, and says plainly when none is released yet. Its install notes are
   the honest ones: Gatekeeper's **Open Anyway** and the keychain question on a Mac; on Linux
   `sudo apt install ./KerfDesk-….deb`, making the AppImage executable, and joining `dialout`
   (`uucp` on Arch) for USB, then logging out and in. The site's static download page says the
   same without version numbers.

### Not decided here

- Developer ID signing and notarization for macOS (a separate decision, which also clears the
  keychain question).
- A verified in-app download, or automatic updates, on macOS and Linux.
- Linux arm64 and other formats (RPM, Flatpak, Snap).
- A listed history of earlier Mac and Linux versions.
- The Terms 1.3 wording, and the pricing, licence and buy pages that still say Pro is Windows
  only: the maintainer's publication.

### Consequences

- The maintainer cuts the first Mac and Linux release by: publishing Terms 1.3 (and the pricing,
  licence and buy page copy) that covers macOS and Linux installations; setting the repository
  variables `KERFDESK_UNSIGNED_MACOS_RELEASES=on` and `KERFDESK_UNSIGNED_LINUX_RELEASES=on`; and
  running **Release unsigned Windows desktop** on `main` with **Release now** (or letting the
  next 10-PR batch run). No new secret is needed: the publish jobs use the existing
  `desktop-commercial` environment, which must allow these jobs.
- Mac users of the old Preview move to the commercial app by installing it over the Preview.
- Each release costs two macOS runner jobs and one more Linux job.

### Verification

Unit tests cover the platform document (exact fields, systems, files, sizes, digests, signing
values, refusal by the Windows validator), the publisher (Windows-first rule, rollback, conflicts,
readback, latest last), identity-only preparation, the macOS and Linux update service, the
renderer's download-page action, the download page per system, and the workflow's job graph and
switches. Real Macs and Linux desktops, Gatekeeper, keychain prompts, file managers and USB
adapters remain unqualified until the first release is installed on them.

---

## ADR-613 Amendment 1 - How macOS and Linux users reach the terms (2026-10-20)

**Status:** Accepted on 2026-10-20, from the maintainer's request to copy what LightBurn does |
**Amends:** decision 4 (packaging) of this ADR

### Context

The Windows installer shows the KerfDesk License & Safety Notice (`public/eula.txt`) on its
licence page: `prepare-installer-terms.mjs` encodes it for the Preview config, and the
unsigned lane copies the same file as its installer terms (`release-desktop-unsigned.yml`, and
`build-commercial-platform.sh` for macOS and Linux). Only NSIS shows that page. The Mac DMG
(drag to Applications), the `.deb` and the AppImage show no licence page, so a Mac or Linux
operator never saw the terms. Inside the app, About and Help > Safety & liability named only
the path `/eula.txt`, which the website serves but the desktop app does not open.

LightBurn, which the maintainer asked us to copy, says in its EULA that downloading, installing
or using the software accepts it, keeps the EULA in the app under the Help menu and in its
documentation, and shows no install-time prompt for its macOS DMG or Linux AppImage
(https://docs.lightburnsoftware.com/2.1/Licensing/LightBurnEULA/).

### Decision

1. **Help > License & Safety Notice** opens the notice in a scrolling dialog on Windows, macOS,
   Linux and in the browser. The item is named after the document. Its text is
   `public/eula.txt` itself, bundled into the renderer at build time
   (`src/ui/help/license-notice.ts`), so it is the text the Windows installer shows, it works
   offline, and it is the version that came with the installed app. A test fails if the two
   differ. The dialog is a React dialog, not `window.alert`: the notice is too long for a
   native alert, and an alert stalls a running job (`job-aware-dialogs.ts`).
2. About and Help > Safety & liability point to **Help > License & Safety Notice** instead of
   `/eula.txt`.
3. **No install-time or first-run prompt is added**, as with LightBurn. electron-builder could
   show the text before first use (a licence sheet when the DMG opens, from
   `build/license_en.txt`, or `appImage.license`, which asks Agree or Disagree through zenity,
   kdialog or Xdialog when one is installed and otherwise skips it), but that is a separate
   decision for the maintainer.
4. **No legal text changes.** `public/eula.txt`, `LICENSE` and the drafts in `docs/legal/` are
   unchanged. Wording that makes use of the software count as acceptance belongs in the KerfDesk
   Licence Agreement, which only the maintainer publishes.

### Not decided here

- Showing the KerfDesk Licence Agreement in the app. The signed release-train lane gives its
  Windows installer owner-approved terms fetched by hash (`KERFDESK_COMMERCIAL_TERMS_SHA256`);
  no build bundles them, and that lane builds Windows only and is switched off.

### Verification

`src/ui/help/LicenseNoticeDialog.test.tsx`: the bundled text equals `public/eula.txt` byte for
byte, the menu label is the document's name, and the Help command opens and closes the dialog.
`src/ui/commands/AppMenuBar.control-audit.test.tsx` clicks the item through the menu.
Not checked in a packaged app on a Mac or a Linux desktop.
