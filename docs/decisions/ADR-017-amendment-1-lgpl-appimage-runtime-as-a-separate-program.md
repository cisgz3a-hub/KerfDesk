## ADR-017 Amendment 1 - An LGPL program that KerfDesk does not link may ship in the AppImage (2026-10-20)

**Status:** Accepted on 2026-10-20, from the maintainer's request to copy what LightBurn does;
decision 4 settled, and libgconf-2 left out, by ADR-017 Amendment 2 |
**Amends:** ADR-017 decision 2 (licences), and the GPL-family rejection ADR-017 keeps from
ADR-008 and ADR-018 and ADR-120 restates, for the Linux AppImage only

### Context

ADR-008 rejected the "GPL family (GPL-2, GPL-3, AGPL, LGPL)", ADR-018 kept that rule, and
ADR-017 says the dependency half of ADR-008 survives: its reviewed licence list has no LGPL
entry, and `scripts/check-licenses.mjs` enforces that list for npm production packages. ADR-120
keeps GPL-family dependencies rejected. AGENTS.md allows outside code only under a licence
that allows a paid, closed-source app.

The Linux AppImage (ADR-607, ADR-613) uses electron-builder's static AppImage runtime
(`toolsets.appimage: 1.0.3`), so it starts without `libfuse2`. Reading electron-builder 26.17.0
(`app-builder-lib` `toolsets/linux.ts` and `targets/appimage/appImageUtil.ts`) and the toolset's
build scripts (electron-builder-binaries `packages/appimage`, release `appimage@1.0.3`) shows two
kinds of outside code in every AppImage, neither from npm:

1. **The runtime**, AppImage type2-runtime release 20251108: the program at the front of the
   `.AppImage` file that mounts the image and starts the AppRun launcher. It is a separate
   executable. KerfDesk's code (JavaScript in `app.asar`) and Electron never link it. It is MIT
   and statically links libfuse 3.15.0 with a one-file patch (`lib/`, LGPL-2.1), squashfuse
   (BSD-2-Clause), Zstandard (BSD-3-Clause), zlib, musl libc and mimalloc (MIT).
2. **Six Ubuntu 18.04 shared libraries** that electron-builder copies from the toolset's
   `lib/x64` into the AppImage's `usr/lib`, which AppRun puts on the library search path:
   libXss and libXtst (MIT/X11), libnotify (LGPL-2.1-or-later), GConf's libgconf-2
   (LGPL-2.0-or-later), libappindicator3 (LGPL-2.1, with GPL-3.0 files such as
   `src/generate-id.c`) and libindicator3 (GPL-3.0). KerfDesk's code does not use them.

Neither was in `THIRD_PARTY_NOTICES.md`. LGPL code that runs as a separate program, or that is
only loaded at run time as an unmodified shared library, is common in paid closed-source
products: LightBurn ships Qt under the LGPL. The LGPL asks the distributor to give the notice,
the licence text and the library's source, and to let the user rebuild with a changed library.

### Decision

1. **Allowed, narrowly.** A component under LGPL-2.1, or LGPL-2.0 or 2.1 "or any later
   version", may ship inside a KerfDesk desktop package when it is either a separate program, or
   an unmodified shared library loaded only at run time, and KerfDesk's own code, `app.asar` and
   Electron do not compile, link, import or bundle it. Today that covers the AppImage runtime
   (with its libfuse), libnotify and libgconf-2.
2. **Conditions.** Each such component is listed in `THIRD_PARTY_NOTICES.md` and, through
   `docs/licensing/appimage-runtime-notices.txt`, in the generated
   `public/third-party-notices.txt` that every package ships, with its version, its patch if any,
   the full licence text and where its complete source can be obtained (for the runtime: the
   type2-runtime commit, which holds the runtime source, the libfuse patch and the build scripts,
   and the libfuse 3.15.0 release). `scripts/verify-linux-package.sh` fails if the AppImage's
   `usr/lib` holds a library the notices do not name.
3. **Unchanged.** `pnpm license-check` still rejects LGPL npm packages. No LGPL code may be
   added to the renderer, the Electron main process, `app.asar` or a bundled web worker.
4. **Not allowed by this amendment: GPL components.** libindicator3 and libappindicator3 contain
   GPL-3.0 code. They ship in the AppImage today only because electron-builder copies the whole
   toolset folder; they are listed in the notices because they ship. Before the first Linux
   AppImage is published (ADR-613 decision 1, `KERFDESK_UNSIGNED_LINUX_RELEASES`), the
   maintainer either approves them as separate GPL-3.0 files with their source, or the build
   stops shipping them, for example by giving electron-builder a toolset folder without them
   through `APPIMAGE_TOOLS_PATH` and checking the AppImage still starts.

### Open for the maintainer

- **Where the source is offered.** The notices name the exact upstream sources. LGPL-2.1
  section 6 and GPL-3.0 section 6 expect the distributor itself to offer the corresponding source,
  for example beside each download or by a written offer; GPL-3.0 accepts another server only with
  clear directions and the distributor still ensuring it stays available. Mirroring the runtime,
  libfuse and Ubuntu source packages beside each Linux release is not done here.
- The GPL-3.0 libraries (decision 4).

### Verification

`scripts/appimage-runtime-notices.test.mjs` checks that the shipped notices carry the section,
that the package check allows exactly the six libraries the notices name, and that the runtime's
pinned source, the toolset hash and the LGPL-2.1 and GPL-3.0 texts are present.
`scripts/verify-linux-package.sh` runs in the native Linux package jobs; it was checked here with
`bash -n` and against sample folders, not on a built AppImage.
