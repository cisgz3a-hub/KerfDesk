# KerfDesk Electron audit and local rebuild, 28 September 2026

## Verdict and scope

The existing application has a sound Electron architecture. A rewrite is not justified. This
audit found concrete defects in camera capture, operating-system file opening, installer
registration, shutdown handoff and release verification. Repairs are being qualified in an
isolated checkout. Production distribution remains a separate, incomplete qualification.

Audited base: `4ba37a94d8259dce5c67723cda96aa725582c01d`, fetched from `origin/main` on
28 September. Work branch: `codex/electron-quality-audit-20260928` in
`D:\LaserForge\electron-quality-audit-20260928`. The dirty primary checkout was preserved.
Evidence is stored in `D:\LaserForge\electron-audit-evidence-20260928`.

This report separates the unchanged base's hosted results from the repaired local build.
No release, merge, tag, signing purchase, provider setting or physical-machine action is part
of this audit. The app identity `dev.laserforge.app`, legacy `laserforge` user profile,
`app://app` origin, Preview trust boundary and ordinary Frame-before-Start contract are retained.

## Reconciliation of the forwarded messages

| Referenced work | Verified current state | What the evidence means |
| --- | --- | --- |
| [PR #984](https://github.com/cisgz3a-hub/KerfDesk/pull/984), previous desktop audit | Merged as `20d223d45f10208d95729602683a1673066c3b07` | Its shell, packaging and camera fixes are in the audited base. This does not establish every native interaction or signed update. |
| [PR #998](https://github.com/cisgz3a-hub/KerfDesk/pull/998), Electron 44 | Merged as `e9c4d83f8aa8b6fef43d3ce510c7f41da9926fcf`; checks green | The current exact pin is Electron 44.4.5. macOS 13 is the correct minimum. Windows/Linux claims apply to the existing 64-bit targets. |
| [PR #1009](https://github.com/cisgz3a-hub/KerfDesk/pull/1009), package checks and Preview cadence | Merged as `ae596a25f9f166256d9f0525b36b9aead55e9f42`; all four package lanes green | Windows installs and uninstalls; Macs launch from mounted DMGs. Per-PR file pickers are stubbed. Tagging remains manual. Historical zero billable time is not a promise for the now-private repository. |
| [PR #1015](https://github.com/cisgz3a-hub/KerfDesk/pull/1015), Mac detach retry | Merged as `9b961fa3a6d1564048b6e7f314ee5e1b7487c2f7`; all checks green | The retry/force-detach and signed-zero comparison fixes landed. The quoted wait for CI is out of date. |
| [PR #1012](https://github.com/cisgz3a-hub/KerfDesk/pull/1012), affected run | Merged; current main is its merge commit | Its earlier Mac failure does not describe the current checked main. |
| Published desktop Preview | Latest published release remains `v0.2.0-preview.13`, 23 July 2026 | Merging those PRs did not publish Preview 14. There was no open “Desktop Preview due” issue at this inspection. |

Current-base evidence: [Desktop package check 36423536368](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36423536368),
[CI 36423536340](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36423536340) and
[Browser smoke 36423536522](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/36423536522) all succeeded
at the audited base SHA. Downloaded receipts confirm Windows fresh install, installed launch
and final uninstall, macOS arm64/x64 DMG launches, and a Linux launch. The Windows receipt
explicitly records the `Launch` scenario rather than real dialogs or an installed upgrade.
The Windows runner was Server 2025; macOS 15 does not qualify the macOS 13 minimum.

The old ASAR verifier could accept unrelated crashes. The downloaded current-base Windows and
Mac logs nevertheless contain Electron's explicit `Integrity check failed for asar archive`
diagnostic, so those particular historical tamper results have attributable evidence.

## Findings and repairs

| Priority | Finding and impact | Repair / required verification |
| --- | --- | --- |
| P1 | The close path can approve exit during Home, Probe, Frame or Jog when no streamed job/Fire is active, without invoking the existing stop handoff. | Route owned operations through the existing Abort path, preserve uncertain-stop acknowledgement and reject approvals if a new operation replaces the one being stopped. Source regressions; no claim of physical stopping. |
| P1 | FFmpeg decoder/spawn error text can expose RTSP credentials and query tokens through camera UI errors. | Return app-owned messages and discard raw decoder stderr. Do not log input URLs. |
| P1 release evidence | The ASAR tamper verifier accepted arbitrary nonzero exits and failed launches as integrity enforcement. | Require a healthy launch of the original executable, an explicit Electron integrity diagnostic and completed process observation; restore the archive even on failures. |
| P2 | Frame capture settled on process `exit`, before stdout necessarily drained; timeouts freed the concurrency slot while the process could still be alive. | Settle successful capture and release the slot on `close`; retain byte/time bounds and discard late output after settlement. Hide Windows FFmpeg subprocess windows. |
| P2 | OS file-open and second-instance paths did not request creation of a closed macOS window; Finder opens did not reliably reveal an existing window. | Share a readiness/quit-aware, coalesced window reopener, preserve the pending project queue and reveal the current window. Event-path regressions reproduce the missing handling; native Finder qualification is still required. |
| P2 | electron-builder 26.16.1 writes the `.lf2` open command with the executable path unquoted. Historical Windows registry evidence confirms this. | Add the shared NSIS install hook to quote executable and document paths, preserve installation context/uninstall ownership, enforce the exact registry command and exercise a real shell-open in the disposable Full installer scenario. |
| P2 hardening | The trusted updater inherits acceptance of NSIS web-installer metadata although KerfDesk only distributes full installers. | Set `disableWebInstaller` before the first trusted update check. Dev and unsigned Preview still do not use the trusted updater. |
| P2 release correctness | Cadence and notes can confuse a tag with an actually published release, resetting reminders or omitting unshipped changes after a failed tag. | Use authenticated, non-draft published release metadata as the baseline; reserve existing tag numbers, retain manual tagging and test failed/pending-tag cases. |
| P2 evidence | Native smoke previously did not record the actual renderer isolation or clearly distinguish stubbed picker/save coverage from real dialogs. | Record actual reported web preferences and renderer Node absence, qualify disabled DevTools separately, and label the smoke's file-I/O mode explicitly. |

Camera, OS-open and ASAR regressions were demonstrated against the old behaviour before repair.
The Windows association finding was also compared with the installed builder source and real
hosted registry evidence. Regression tests use the production seams rather than duplicate
implementations. Detailed final check results and package digests are recorded below when complete.

## Standards assessment

The [primary-source research notes](2026-09-28-electron-research-notes.md) cover the pinned
Electron version, platform floor, security checklist, fuses, ASAR validation, signing,
updates, accessibility, performance and dependency maintenance. Electron 44.4.5 was the latest
stable release when checked. The current builder is 26.16.1, so v26 documentation applies.

The renderer uses context isolation, a sandbox, no Node integration, web security, controlled
navigation/window creation, scoped permissions and a local custom protocol. There is no general
preload/IPC bridge, but the custom protocol's privileged routes still require security review.
The package checks cover the runtime dependency closure, legal notices, identity and fuse bytes.
Dependencies scanned clean at this exact frozen lockfile; this is a scanner result, not a
guarantee that the app contains no vulnerabilities.

The updater remains at 6.8.9. Version 6.8.10 has relevant differential-download reliability fixes,
but was only two days old and was not identified upstream as an emergency security fix.
ADR-483 Amendment 1 chooses a one-week observation period: review eligibility is 3 October.
No future automation or dependency version change was made.

## Private-repository release blockers

The repository is now private. Existing Preview discovery requests GitHub's API anonymously,
and the download links point into this repository. Ordinary users without repository access
cannot discover/download those private releases. Shipping a GitHub token in the desktop app
would not be an acceptable repair. Private source needs an intentionally chosen public binary
distribution/feed arrangement or restricted authenticated distribution.

The workflows currently require GitHub artifact attestations. GitHub's
[attestation availability](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
requires Enterprise Cloud for private/internal repositories; Free, Pro and Team support this
feature only for public repositories. Buying Pro alone would not restore the existing private
attestation workflow. Attestations were not silently disabled in this audit.

The rulesets API returned an upgrade-or-make-public error under the current private Free plan.
The previous “only you can tag” enforcement must therefore be rechecked after choosing a plan.
No bypass was added. The source still uses a manual reminder/tag workflow.

[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
distinguishes free standard hosted runs in public repositories from private usage. The old
zero-billable claim was historical. No new paid hosted runs were dispatched for this audit.

## Qualification boundaries before production distribution

| Area | Current evidence / next concrete qualification |
| --- | --- |
| Windows signing and updates | Stable signing/publisher/feed configuration exists. Produce a signed installer and perform an installed old-to-new update with data preserved, wrong-publisher/tamper rejection and offline recovery. No certificate purchase or real stable feed mutation was made. |
| macOS distribution | Preview is deliberately unsigned/ad-hoc, with hardened runtime and notarization disabled. General distribution needs Developer ID signing, minimum entitlements, notarization/stapling and clean-machine Gatekeeper checks, including macOS 13. |
| Native dialogs and installer | Existing per-PR smoke replaces Open/Save picker interaction. Run the disposable Full qualification, including the new shell association path, against the repaired source. Do not install/uninstall over the user's working copy. |
| Accessibility | Automated app/UI tests exist. A real screen-reader, keyboard-only, high-contrast and display-scaling qualification has not been established by this audit. |
| Performance | The bundle builds, but cold-start, idle/minimised CPU, memory and representative large import/CAM budgets need a controlled measurement on named hardware. Concurrent audit/test load is not a valid benchmark. |
| Hardware | No machine was connected or operated. Close/Abort software tests do not establish physical cessation of motion or laser/spindle output. |

## Local verification and rebuilt artifact

Final integration and packaged-runtime qualification are in progress. This section will be
replaced with the completed results, exact artifact path and SHA-256 before handoff.
