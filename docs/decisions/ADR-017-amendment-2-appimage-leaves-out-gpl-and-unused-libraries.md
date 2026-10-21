## ADR-017 Amendment 2 - The AppImage leaves out the GPL-3.0 libraries and GConf (2026-10-20)

**Status:** Accepted on 2026-10-20 |
**Amends:** ADR-017 Amendment 1 decision 4, which left the GPL-3.0 libraries open, and its
decision 1, which no longer needs to cover libgconf-2

### Context

ADR-017 Amendment 1 found that electron-builder 26.17.0 copies six Ubuntu 18.04 libraries from
its AppImage toolset (`toolsets.appimage: 1.0.3`) into the AppImage's `usr/lib`: libXss, libXtst,
libnotify, libgconf-2, libappindicator3 and libindicator3. libindicator3 is GPL-3.0 and
libappindicator3 holds GPL-3.0 files. ADR-008, ADR-017 and ADR-120 reject GPL-family code, and
Amendment 1 allows only LGPL code that KerfDesk does not link. It left the two GPL-3.0 libraries
for a decision before the first Linux AppImage release (ADR-613).

KerfDesk does not need them. They show an icon in the desktop's tray (indicator) area, and
`electron/` never creates an Electron `Tray`. KerfDesk's only desktop notification is Electron's
`Notification` (`electron/desktop-licensing.ts`), which Electron shows through libnotify, so
libnotify stays. GConf is an old GNOME settings store; KerfDesk does not use it.

electron-builder 26.17.0 has no setting to leave one library out. Its source shows:

- `out/targets/appimage/appImageUtil.js` (`buildStaticRuntimeAppImage`) copies the toolset's
  whole `lib/<arch>` folder into `usr/lib`, then copies the app over it and runs `mksquashfs`. No
  hook runs between the copy and `mksquashfs`, so an `afterPack` hook (which runs on the app
  folder, before this) cannot remove a toolset library.
- `out/targets/appimage/AppImageTarget.js` emits `artifactBuildStarted` before it calls
  `getAppImageTools`, and awaits user hooks (`out/util/asyncEventEmitter.js`).
- `out/toolsets/linux.js` (`getAppImageTools`) reads `APPIMAGE_TOOLS_PATH` from `process.env`
  when it is called (builder-util `resolveEnvToolsetPath`). Otherwise it downloads the pinned
  `appimage@1.0.3` archive and checks its SHA-256.

### Decision

1. **The AppImage leaves out libappindicator3, libindicator3 and libgconf-2.** The
   `artifactBuildStarted` hook `scripts/appimage-toolset.mjs`, set in `electron-builder.yml` (and
   so in the commercial configs that extend it) and in `electron-builder.preview.yml`, runs for
   the AppImage target only. It asks electron-builder's own `getAppImageTools` for the toolset,
   which keeps electron-builder's download and checksum, and copies that folder, symbolic links
   unchanged, to a temporary folder without those libraries in any `lib/<arch>` folder. Then it
   sets `APPIMAGE_TOOLS_PATH` to the copy, which is deleted when the build exits. The AppImage's
   `usr/lib` then holds libXss, libXtst and libnotify. Nothing in the toolset is run by the hook;
   electron-builder runs the same `mksquashfs` as before.
2. **The package check refuses them.** `scripts/verify-linux-package.sh` fails if the AppImage
   carries any of the three, and fails if `readelf` finds a file in the AppImage (the `kerfdesk`
   executable or any `.so`) that links one. Leaving them out therefore cannot stop KerfDesk
   loading. The existing rule stays: any `usr/lib` library the notices do not list fails.
3. **The notices list what ships.** `docs/licensing/appimage-runtime-notices.txt`,
   `THIRD_PARTY_NOTICES.md` and the generated `public/third-party-notices.txt` drop the three
   libraries and the GPL-3.0 text, and say the build leaves them out. No GPL component ships in
   any KerfDesk package, so ADR-017 Amendment 1 decision 4 is settled. Its decision 1 now covers the
   AppImage runtime (with its libfuse) and libnotify.
4. **A toolset or electron-builder upgrade re-checks this.** The hook pins toolset `1.0.3`, and a
   test checks that both configs pin the same one and run the hook. Another toolset version, or an
   electron-builder that copies libraries another way, means reading its source again.

### Not decided here

- Where the LGPL sources (the runtime's libfuse and libnotify) are offered: beside each Linux
  release, or by a written offer. ADR-017 Amendment 1 leaves this to the maintainer.
- The `.deb`, which carries none of these libraries.

### Verification

`scripts/appimage-toolset.test.mjs` copies a toolset-shaped folder and checks that the hook keeps
everything except the three libraries in each `lib/<arch>`, keeps symbolic links relative (on
Linux), sets `APPIMAGE_TOOLS_PATH` for the AppImage target only, and that both configs run it.
`scripts/appimage-runtime-notices.test.mjs` checks that the package check allows exactly the
libraries the notices list and refuses, and looks for links to, exactly the ones the hook leaves
out. The CI job "Package, install and launch the Linux AppImage and .deb" and the commercial Linux
rehearsal build a real AppImage with the hook, run the package check on it and launch it on Ubuntu
24.04. Not checked on other distributions or on a desktop with a tray.
