# Electron desktop standards research, 28 September 2026

This is the primary-source research component of the desktop audit. Source and configuration
inspection began at commit `4ba37a94d8259dce5c67723cda96aa725582c01d`. Other audit work is concurrent;
this document does not claim that its suggested checks ran or that any installer is signed or
published. All sources below were checked on 28 September 2026. Where a source has no publication
date, that is a retrieval date rather than a claimed publication date.

## Assessment

The configuration has a sound Electron foundation and does not justify rebuilding the application
from scratch. It isolates the renderer, uses a custom local protocol, scopes permissions, separates
unsigned Preview notifications from trusted updates, and hardens the packaged executable. The
remaining work should improve verified behaviour and release evidence. Passing source tests or an
unsigned package launch does not establish signed distribution, installed updating, accessibility,
performance, or hardware reliability.

The most material confirmed problem found during this research was an integrity-test false
positive: at the inspected base, `integrityVerdict` in
`scripts/verify-asar-integrity-enforced.mjs` accepted an unrelated nonzero exit, and even a spawn
error with null exit/signal, as proof of ASAR enforcement. The release-audit work owns its repair.

## Versions and actual platform scope

- [Electron 44.4.5](https://releases.electronjs.org/release/v44.4.5) was released on
  22 September 2026 and was labelled Latest Stable when checked. It contains Chromium
  152.0.7977.130, Node.js 24.21.0 and V8 15.2.124.28. The manifest's exact Electron pin matches.
- Electron supports its [latest three stable major versions](https://www.electronjs.org/docs/latest/tutorial/electron-timelines),
  with security fixes applied to the latest minor of each supported line. Keep an owner and a
  review cadence for Electron updates; merely belonging to a supported major is insufficient.
- The [44.4.5 platform declaration](https://github.com/electron/electron/blob/v44.4.5/README.md)
  says macOS Ventura or newer, Windows 10 or newer, and Linux distributions supported by both
  Chromium and their distributor. Supported architectures are x64 and arm64. The
  [Electron 44 announcement](https://www.electronjs.org/blog/electron-44-0) confirms removal of
  macOS 12, Windows ia32 and Linux armv7l support. Therefore, “Windows and Linux unchanged” is
  accurate only for KerfDesk's existing 64-bit targets, not Electron generally.
- KerfDesk's stable config targets Windows x64. Preview targets Windows x64 and macOS x64/arm64;
  `minimumSystemVersion: '13.0'` is correct. Linux packaging in CI is validation, not a supported
  Linux release product. A macOS 15 runner does not by itself qualify the macOS 13 minimum.
- Use [electron-builder v26 documentation](https://www.electron.build/v26/docs/configuration/)
  for the pinned 26.16.1. The unversioned website now documents v27, including changed signing
  configuration and update features. Copying those examples into v26 is not a valid upgrade.

## Actionable qualification rubric

The “required evidence” column is this audit's acceptance proposal, not a claim that every item is
an upstream mandate.

| Priority and area | Primary standard | Current source evidence | Required evidence / remaining action |
| --- | --- | --- | --- |
| P1: renderer isolation | [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) calls for context isolation, sandboxing, disabled Node integration, strict CSP, controlled navigation and permission checks. | `desktop-window-options.ts`, `trusted-renderer-policy.ts` and `main.ts` implement these; there is no preload or general IPC bridge. | Exercise the packaged build with hostile navigation, external URLs, unexpected permissions and malformed imported files. Custom protocol routes are privileged interfaces despite the lack of IPC. |
| P1: package integrity | [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) requires the embedded header hash and integrity fuse; ASAR-only loading closes the alternate-code path. Runtime enforcement is supported on Windows and macOS, not Linux. | Both configs enable integrity and ASAR-only loading. Existing verifier inspects payload and fuses; Windows/macOS lanes attempt a tamper test. | A healthy original must launch; a modified archive must produce attributable integrity rejection; restoring the archive must restore launch. Unrelated startup crashes are not passing evidence. |
| P1: executable hardening | [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) disable unused Node launch, environment options and inspector paths before signing. | Both configs disable those and extra file-protocol privileges. Stable encrypts cookies; unsigned Preview does not. | Inspect actual packaged fuse bytes on every target after packaging. Unsigned/ad-hoc builds do not give the same OS signature protection as signed releases. |
| P1: trusted Windows updates | [Builder v26 Windows](https://www.electron.build/v26/docs/win/) verifies updates using publisher identity. [Auto-update documentation](https://www.electron.build/v26/docs/features/auto-update/) distinguishes NSIS and generic-host metadata. | Stable requires signing, verifies matching executable/installer signatures and timestamp, checks `publisherName`, and publishes the feed last. Preview is explicitly untrusted and notify-only. | Qualify an installed version upgrading to a newer signed version with existing data preserved; reject wrong-publisher, modified and missing assets; test offline fallback. A signed installer is necessary but is not end-to-end update proof. |
| P1 before general macOS distribution | [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) and [Hardened Runtime](https://help.apple.com/xcode/mac/current/en.lproj/devf87a2ac8f.html) require the correct signing identity, capabilities and notarization flow. | Mac Preview deliberately uses `identity: null`, `hardenedRuntime: false`, `notarize: false`, plus ad-hoc re-signing after fuse changes. | Suitable only as the disclosed unsigned Preview. A production Mac lane needs Developer ID signing, minimum necessary entitlements, notarization/stapling and Gatekeeper validation on a clean Mac. Enabling booleans without credentials is not a solution. |
| P2: OS lifecycle and association | [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app) documents single-instance and macOS open-file events; builder's explicit app ID avoids generated identity changes. | One primary process, early data paths, `.lf2` association, queued opens, window placement, close handoff and renderer crash recovery exist. | Exercise cold and running-instance file opens, cancel/unsaved paths, monitor removal, minimise/restore, crash/reload and uninstall/reinstall with a disposable profile. Imported path validation remains part of the security boundary. |
| P2: accessibility | [Electron accessibility](https://www.electronjs.org/docs/latest/tutorial/accessibility) inherits web accessibility and enables its tree when assistive technology is present. | Native menus and context menu exist; this research did not find packaged screen-reader qualification. | Keyboard-only core flows, focus recovery, high contrast, scaling and a real Windows screen reader/Mac VoiceOver run. Default Electron accessibility support is not evidence that the application is accessible. |
| P2: performance | [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) requires profiling real work, avoiding blocking main/renderer tasks and unnecessary dependencies. | Runtime closure excludes renderer-only packages; main still owns the RTSP bridge; background throttling is deliberately disabled. `PROJECT.md` sets desktop cold start under three seconds. | Record cold launch, idle/minimised CPU, peak memory and large import/CAM responsiveness on named hardware and fixtures. Measure the RTSP/main-process risk. Preserve active-job wake behaviour when making power/performance changes. |
| P2: supply-chain maintenance | Electron security guidance makes framework and dependency freshness part of app security. | Exact framework/build-tool pins, frozen lockfile installs, action pins, package closure tests and nightly reachability-classified dependency audit exist. | Recheck advisories for the exact dependency tree, prioritise shipped/runtime paths, and retain scanner failures as unknown rather than clean. Qualify upgrades against actual packages. |

Windows signature validation and SmartScreen reputation are separate. Microsoft explicitly says
[EV certificates no longer confer immediate positive SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
Do not promise that buying a certificate removes all first-download warnings. The Electron signing
tutorial contains broader wording about EV/SmartScreen; the OS vendor is the authority here.

Cookie encryption also needs careful channel handling: Electron documents a one-way migration;
switching from encrypted back to unencrypted cookies can corrupt that store. KerfDesk uses one legacy
profile across stable/Preview. No authentication cookies are currently claimed, so this is a
documented future constraint rather than a reproduced data-loss defect.

## electron-updater 6.8.10 applicability

The [6.8.10 release](https://github.com/electron-userland/electron-builder/releases/tag/electron-updater@6.8.10)
was published at `2026-09-26T09:52:34Z` according to the upstream GitHub release API. The clock at this
check was `2026-09-28T14:15:27Z`, making it more than 52 hours old. This satisfies a 48-hour age test,
but not the one-week observation choice recorded in ADR-483 Amendment 1. Age alone is not a quality
or security guarantee.

The release fixes multipart differential-download handling for bare LF separators and chunk-split
header endings, stale watchdog timers across large batches, and inconsistent cached installer /
blockmap pairs that caused checksum failures and full-download fallback. These are reliability,
memory and bandwidth fixes; the release notes do not classify them as an emergency security patch.

Applicability is concrete in the installed 6.8.9 source:

- `out/providerFactory.js` enables multi-range requests for generic providers unless explicitly
  disabled or the URL contains `s3.amazonaws.com`. KerfDesk's `https://dl.kerfdesk.com/desktop`
  triggers the enabled path.
- `out/AppUpdater.js` defaults `disableDifferentialDownload` to false.
- `out/NsisUpdater.js` tries differential downloads before falling back to the full installer;
  stable builds emit blockmaps. `AppUpdater.js` copies a fresh pending blockmap when present,
  but lacks the new removal of a stale cached blockmap when none was produced.
- Preview metadata disables trusted updating and its NSIS config disables differential packaging;
  this upgrade would therefore improve the future signed stable update path, not Preview launches.

Decision for this audit: retain 6.8.9 and the recorded one-week observation period. The eligible
review date is 3 October; no future automation was created by this research. Do not present 6.8.9
as unusable. When upgrading, preserve the frozen lockfile, rerun updater/closure/package checks,
and obtain an installed update result before claiming operational updater qualification. This
research did not edit dependency versions.

An additional narrow hardening fix was implemented independently of the version bump:
`electron-updater` 6.8.9 defaults `disableWebInstaller` to false. Its upstream
[AppUpdater source](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/AppUpdater.ts)
warns about unsigned web-installer package payloads, and
[NsisUpdater](https://github.com/electron-userland/electron-builder/blob/electron-updater%406.8.9/packages/electron-updater/src/NsisUpdater.ts)
rejects that path when the flag is true. KerfDesk ships full NSIS installers only.
`configureAutoUpdater` now sets the flag before its first trusted check. Dev and unsigned Preview
paths still return before touching the updater. A regression observes the flag at check time;
the updater/trust suites passed (2 files, 12 tests), and Electron TypeScript with `--noEmit` passed.
The property is part of the pinned package's common `AppUpdater` type, so no platform cast or
optional-property fallback is necessary.

[electron-builder 26.17.0](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder@26.17.0)
was also released on 26 September. Its changes include Windows pnpm workspace discovery,
dependency-collector fixes and optional store-ASAR differential packaging. These are relevant
areas for KerfDesk's pnpm 11 build, but no current KerfDesk package failure was established by
this research. Do not conflate a newer builder with a necessary rebuild, and do not enable a
different compression/update format without measuring its resulting artifacts and update path.

## Boundaries for the combined audit

The smoke was also strengthened during this audit. It now records the running window's reported
`sandbox`, `contextIsolation`, `nodeIntegration` and `webSecurity` values, checks that the renderer
does not expose Node's `require`, `process`, `module` or `Buffer`, and makes a bounded DevTools-open
attempt that must remain closed. These are packaged-runtime probes, additional to source config
checks. The pinned runtime's inspection API does not report preload, so the evidence explicitly
says `not-reported`; the source still creates the window without a preload. CSP execution blocking
was not probed here. Results now explicitly identify the smoke's open/save pickers as stubs and its
save target as memory. The smoke therefore exercises application import/serialization through the
toolbar, not a native picker or persistent operating-system file write.

This research supports a targeted repair and rebuild, not a clean-sheet rewrite. A claim of
“highest standards” should be replaced with explicit evidence: source checks, packaged runtime,
OS installer, signing, installed updates, accessibility, performance and physical-machine results
each have separate status. The research pass made no purchases, installed no certificates,
published no release and operated no machine. Current PR/release status belongs to the separate
GitHub audit rather than this source-review document.
