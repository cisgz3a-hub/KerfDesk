# KerfDesk Electron readiness implementation

This implements the eight findings from the 12 September 2026 Electron audit on
`25d9bef9a5defed24259acb8b1d3af69840ff983`. The branch is
`codex/electron-readiness-20260912`. The original dirty LaserForge checkout is
preserved; source changes and build evidence live in a separate worktree.

Application source is frozen at `d3afa030c263d5ff6f68ca5342cf01b20af78498`.
The full release gate, Windows installer build and packaged native smoke pass.
This report and the ledger are a subsequent documentation-only checkpoint; the
executable identifies the application source commit above.

This is a local unsigned Windows candidate. Stable signing, publication, a real
installed N-to-N+1 update, macOS qualification and physical controller operation
are separate remaining release gates. No release or provider configuration is
activated by these changes.

| Finding | Implemented outcome | Verification boundary |
| --- | --- | --- |
| E01 | `js-yaml` is pinned to 4.3.2 wherever the vulnerable transitive range occurred. Electron is pinned to 42.11.3 within the existing major line. Generated notices identify the new versions. | Production dependency scan is clean; full tooling scan remains advisory work. Package/runtime checks are recorded below. |
| E02 | Ordinary desktop close/quit owns a renderer stop handoff, shares pending attempts, keeps recovery controls available, and checks final approval before unloading. Browser unload retains an immediate best-effort fallback. | Simulated stop promises and packaged software evidence do not establish physical stopping or OS-forced shutdown behaviour. |
| E03 | All stable tags share one publication concurrency group; the publisher checks semantic version order and rereads the feed immediately before promotion. | Protects the canonical workflow; another authorised R2 writer is outside that lock. |
| E04 | A write-once publication manifest reserves exact artifact/provenance bytes and the original previous-feed snapshot. Conflicting bytes are rejected before writes. Identical interrupted work can resume; identical successful retries are read-only. | A rebuilt same-version candidate must not replace original signed bytes. There is no claim of reproducible signing timestamps. |
| E05 | Only confirmed object HTTP 404 after successful bucket access is absence. Authentication, network, server and malformed-feed failures stop publication. | Store fixtures exercise status and error handling; live R2 activation is not performed. |
| E06 | HTTP frame/discovery readers enforce 8 MiB while consuming actual decoded bytes and cancel oversized/error streams. | Synthetic streams cover missing/false lengths, boundaries and cancellation; camera devices were not accessed. |
| E07 | Session permission/serial listeners install once before the first renderer, independent of macOS window recreation. | Repeated mocked Session installation is checked; macOS native pickers remain unqualified. |
| E08 | RTSP DESCRIBE caps headers at 16 KiB, body at 256 KiB and total at 272 KiB, with a five-second deadline and the existing 2.5-second inactivity timeout. | Synthetic socket/parser cases cover fragmentation, invalid lengths, truncation and trickling peers. |

The dependency patch follows the
[js-yaml maintainer advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
The runtime target is [Electron 42.11.3](https://github.com/electron/electron/releases/tag/v42.11.3).
The publisher uses Cloudflare's documented
[R2 object API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/)
with the existing stable token/account fields. Its bounded REST transport retains
the 300 MB object limit; future larger installers need a separately reviewed
transport change before publishing. Credentials are neither included in test
fixtures nor written to logs.

Same-run Actions retries restore the original six-file artifact by exact artifact
ID, workflow run and approved source SHA. Rebuild and evidence generation are
skipped on restore. Missing/expired uploaded artifacts and failed or incomplete
history lookups fail closed. A retry may rebuild only when all previous attempts
prove upload did not succeed and publication was skipped. An interrupted alias
promotion cannot be overwritten by another candidate; the original bytes must
finish first. Immutable snapshot conflicts after an intervening release require
a new version rather than a rewritten rollback history.

## Validation record

Validation was completed on Windows 11 x64, build `10.0.26200`, using Node
`24.15.0`, pnpm `11.3.0`, Electron `42.11.3` and electron-builder `26.15.3`.
Evidence and complete command logs are retained under
`artifacts/electron-readiness/` in
`D:\CodexWorktrees\kerfdesk-electron-readiness-20260912`.

- A frozen offline install passes with the changed lockfile.
- Production dependency audit: zero advisories. Full dependency audit: 32 entries,
  comprising 19 high and 13 moderate. These tooling entries have not been silently
  treated as patched by the runtime dependency change.
- `pnpm release:check` passes, exit zero, for the frozen application commit.
  This includes both TypeScript checks/builds, root and Electron lint, formatting,
  ADR numbering, action pins, licences, tests, renderer/Electron production
  builds, the file-size backstop and the export-count gate.
- Full Vitest suite: **13,321 passed, 22 skipped**; **2,045 files passed, 14
  skipped**. Release-integrity suite: **115 passed, zero failed or skipped**.
  The aggregate run includes the desktop shutdown, camera, permission and stable
  publication regressions added for this implementation.
- The unsigned Windows x64 NSIS build passes with `--publish never`. Its
  dependency rebuild ran normally; no native-rebuild bypass was used.
- Packaged metadata, About/build-badge versions and the embedded renderer source
  SHA match the candidate. Both installer and application executable pass the
  Windows identity check. Authenticode reports **NotSigned** for both; the
  builder's generic signing-step messages are not signature evidence.
- The actual `app.asar` includes `js-yaml` **4.3.2**. All **57 packaged production
  module manifests**, including nested modules, are represented in the SBOM and
  generated notice headers.
  The broader installed inventory has 58 package/version identities; the licence
  gate groups these into 52 package entries across eight allowed licence
  expressions. The SPDX inventory has 60 entries including KerfDesk and Electron.
- The MIT licence, third-party notices, generated notices and Electron/Chromium
  runtime licence files match their source bytes in the package. Renderer notices
  also match. No local audit helpers, evidence directories or Electron source maps
  appear in the application archive.
- A native Electron 42.11.3 probe kept actual sandboxed BrowserWindows alive while
  synthetic renderer preparation was pending, joined duplicate close requests,
  then completed both ordinary window close and `app.quit()` after approval.
  This uses a minimal fixture renderer; it is distinct from the full packaged
  KerfDesk smoke and from controller qualification.
- The full packaged native smoke passes against the built `win-unpacked/KerfDesk.exe`:
  visible window, isolated user/session profile, `app://app/index.html`, SVG import
  and schema-5 project serialization (**4,489 bytes**). It exited zero naturally,
  without requested termination or captured runtime failures; stderr was empty.
  The runner removed only its verified disposable profile. Evidence is under
  `artifacts/electron-readiness/packaged-native-smoke/run-HbD076/`.

Nonfatal release-gate output includes Vite chunks above 750 kB, 193 files above
the report-only 250 counted-line limit, and 15 legacy export barrels that passed
the no-growth gate. These are retained as maintenance context, not cleared by the
eight Electron fixes.

## Candidate and evidence

The candidate directory is
`D:\CodexWorktrees\kerfdesk-electron-readiness-20260912\release\0.1.0-readiness.20260912`.
It contains:

- `KerfDesk-0.1.0-readiness.20260912-windows-x64-setup.exe` — **105,018,837 bytes**.
- `win-unpacked/KerfDesk.exe` and its packaged application/runtime files.
- `checksums.sha256`, `release-provenance.json`, `release-sbom.spdx.json` and
  `build-verification.json`.

The installer SHA-256 is
`02fcdef68b39231ebb5d6b9d086dcbd505fd5e275315d7a35c02ea344f7ac9cf`.
The application archive SHA-256 is
`f503d7a41f1def894805af0ed40e48a199c168d8c94f75e4c70f8c7eaeb06546`.
The consolidated verification receipt binds those bytes to the source commit,
test results, native smoke and companion-file hashes. These are local build
receipts, not signed CI attestations or a reproducible-build claim.

Remaining release qualification is concrete:

1. Run the installer under a standard Windows account and qualify native file
   dialogs, disk persistence, old-profile migration, repair/uninstall and offline
   installed-path operation. This run launched the builder's unpacked app; it did
   not execute the installer against an existing KerfDesk installation.
2. Configure the protected Windows signing/publication environment, then qualify
   signed installed N-to-N+1 updates, interrupted downloads, recovery and publisher
   continuity. Provider fixture tests do not replace a live publication exercise.
3. Build and qualify macOS Intel/Apple Silicon candidates, native permission and
   window-recreation behaviour, and production signing/notarization. A Windows
   build cannot establish those results.
4. Perform separately authorised controller/camera and long-running machine
   qualification. Software stop handoff does not prove physical stopping, and
   forced OS termination is outside the ordinary close/quit protocol.

## Local candidate procedure

Use an isolated checkout of the application source commit above and frozen
dependencies. Set
`KERFDESK_DESKTOP_VERSION=0.1.0-readiness.20260912` for `pnpm release:check`, then
package with `electron-builder.preview.yml`, that same `extraMetadata.version`,
Windows x64 and `--publish never`. Disable signing identity discovery. This local
version is distinct from the public strict Preview numbering and does not activate
the Preview notification or stable updater.

Validate the packaged `app.asar` metadata and both Windows executable identities.
Run `scripts/verify-windows-packaged-native-smoke.mjs` against the unpacked
`KerfDesk.exe`, with its isolated profile and evidence output enabled. That smoke
uses a real packaged renderer but substitutes file pickers; import and project
serialization success is not proof of native file-dialog persistence, installer
execution or hardware behaviour. Keep the installer and hashes alongside the
source/verification receipt. Running the build from the later report-only commit
will embed that later Git identity even though the application source is the same.
