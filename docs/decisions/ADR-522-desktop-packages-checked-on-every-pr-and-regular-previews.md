## ADR-522 - Every pull request builds, installs and launches the desktop app on Windows and macOS, and Previews ship regularly with a changelog (2026-09-28)

**Status:** Implemented | **Date:** 2026-09-28 | **Extends:** ADR-483 (desktop package check),
ADR-248/249 (Preview release lane)

### Context

The 2026-09-27 comparison with Rayforge (its items 8 and 9) found two places where Rayforge is
ahead:

- **Per-change desktop checks.** Rayforge builds and launches its Windows installer and its
  macOS Intel and Apple silicon apps on every pull request. KerfDesk packaged and launched only
  a Linux build per pull request (ADR-483), smoke-tested Windows weekly, and checked macOS only
  when a Preview was tagged. That gap was real: the Mac Preview package check still expected
  macOS 12 after the Electron 44 move, and nothing would have noticed until the next tag failed
  (ADR-483 Amendment 1).
- **Release rhythm.** Rayforge shipped 69 releases in a year, with notes every time. KerfDesk's
  last desktop Previews are from 23 Jul 2026 (Previews 9, 10 and 13 were published), about 580
  pull requests ago, and there is no changelog. Release tags stay with the maintainer: the `v*`
  tag ruleset lets only the maintainer create them, and the maintainer re-checks release
  immutability before each tag (ADR-248, `WORKFLOW.md` F-DESK3).

### Decision

**1. The desktop package check runs on Linux, Windows and macOS** (`.github/workflows/desktop-package-check.yml`,
every pull request and every push to `main`):

- **Windows** builds the unsigned Preview installer with the Preview release lane's exact
  electron-builder flags and runs that lane's package contract, now shared as
  `scripts/verify-windows-preview-package.ps1`. It checks the fuse wire and `app.asar`, then
  installs the app per-user, checks the registration, both shortcuts, that the installed files
  are the packaged ones and that `.lf2` projects open in it, launches the installed app (SVG
  import and project save on a throwaway profile), uninstalls it and checks nothing is left.
  This is the installer qualification's new `Launch` scenario
  (`scripts/qualify-windows-installer.ps1 -Scenario Launch`); the dry run keeps the `Full`
  scenario with real file dialogs and an upgrade.
- **macOS**, on Apple silicon (`macos-15`) and Intel (`macos-15-intel`), builds the Preview DMG
  the same way, runs `scripts/verify-macos-preview-package.sh` (the tag's own contract,
  including the macOS 13 floor), checks the fuse wire in the Electron framework, and launches the
  app from inside the mounted DMG.
- **Both** prove that a modified `app.asar` stops the app
  (`scripts/verify-asar-integrity-enforced.mjs`): one hex digit of a file hash in the archive
  header is changed and the app must refuse to start. ADR-483 left this unverified; Linux has no
  embedded hash, so it runs on Windows and macOS only.
- **Both** run the desktop Vitest suites and `test:release-integrity` on their own operating
  system before packaging.
- **Linux** is unchanged: the stable config, fuse and `app.asar` check, and the sandboxed launch.
- The native smoke CLI accepts macOS as well as Windows and Linux.
- Pull request builds carry the throwaway version `0.0.0-check.<run>`, like the dry run's
  `0.0.0-dispatch.<run>`, and are uploaded only as evidence, never as a release.

The Preview workflow gate test pins the pull request builds to the release lane's flags, so the
two cannot drift apart.

**2. Every Preview has release notes, and `CHANGELOG.md` records them.**

- `CHANGELOG.md` has an Unreleased section with hand-written highlights and a generated list of
  every merged pull request, grouped into New, Faster, Fixed and Other changes, each line naming
  its area (Laser, CNC, Camera, and so on). Tests, docs and build-tooling changes are counted,
  not listed.
- `scripts/desktop-release-notes.mjs` generates the list from `main`'s first-parent history
  (`draft`, `refresh`), and `stamp <version>` turns Unreleased into that version's section
  before it is tagged. A Preview tagged without a stamp still gets its own generated section at
  the next stamp.
- The Preview release lane appends `release-body <version>` to the release notes: the version's
  CHANGELOG section when it was stamped, otherwise the Unreleased highlights and every pull
  request since the previous Preview tag. Nothing is refused when the changelog was not stamped.

**3. A daily reminder keeps Previews regular** (`.github/workflows/desktop-preview-cadence.yml`,
`scripts/desktop-preview-cadence.mjs`):

- A Preview is due when `main` has user-facing changes the newest Preview lacks and that Preview
  is at least 7 days old.
- While one is due, one issue titled `Desktop Preview due: v<next>` names the next tag, the
  newest `main` commit that CI, Browser smoke and the Desktop package check all passed on, the
  exact `git tag -a` and `git push` commands, and the drafted notes. Each day's run edits that
  issue rather than filing another, closes any second open issue with the same title as a
  duplicate, and closes the issue once a newer Preview exists. Runs queue instead of overlapping.
- The workflow reads the repository and edits that one issue. It has no `contents: write`, and
  it never tags, pushes or publishes; the maintainer tags.

None of this adds a guard (ADR-228): nothing in the app is blocked or refused. The checks are CI
evidence, and the reminder is an issue.

### Consequences

- Every pull request now waits for four desktop jobs. Public-repository runners are free, but
  macOS runners have a small concurrency limit, so desktop results can arrive later than CI's
  when many branches push at once. Superseded pull request runs are cancelled.
- A change that breaks the Windows or macOS Preview package fails on its own pull request, not
  on the next tag.
- The weekly Windows native smoke (`packaged-native-smoke.yml`) stays: it feeds the release
  readiness evidence lane, which the per-PR check does not.
- Cutting a Preview is two commands from the issue. Releases still depend on the maintainer
  running them.

### Alternatives rejected

- **Let the reminder workflow tag Previews itself.** It would need a bypass of the release-tag
  ruleset, which ADR-248 gives only to the maintainer. That is the maintainer's call; this ADR
  does not make it.
- **Run the full installer qualification on every pull request.** Its real Save and Open dialog
  automation and the second upgrade build belong in the dry run; the per-PR `Launch` scenario
  covers install, launch and uninstall.
- **Require a changelog line in every pull request.** That would be a new merge guard. The
  generated list already covers every pull request, and highlights are optional.
- **Run the whole test suite on Windows and macOS per pull request.** It takes over an hour on
  Windows; the desktop suites cover the code that differs by operating system.

### Verification

- `node --test` for the new scripts: `desktop-release-notes.test.mjs`,
  `desktop-preview-cadence.test.mjs` and `verify-asar-integrity-enforced.test.mjs`, all in
  `pnpm test:release-integrity`. The Preview workflow gate test pins the shared build flags, both
  package contracts, the release notes step and the reminder's missing write access, and fails
  when a pull request build flag differs from the release lane's.
- The release notes generator ran over the 579 first-parent commits between
  `v0.2.0-preview.13` and `main`: 496 user-facing entries, 83 maintenance changes counted. The
  reminder, run against the same history with sample green lists, picked the newest commit in
  every list and drafted `v0.2.0-preview.14`. `stamp`, `refresh` and `release-body` were run on
  a copy of `CHANGELOG.md`.
- The tamper check ran against a Linux package of Electron 44: it changed and restored the
  archive (same SHA-256 afterwards) and correctly reported that Linux ran the modified archive.
- The PowerShell changes parse under PowerShell 7.5, and the new receipt fields were exercised.
- Not verified here: the Windows and macOS jobs themselves, including whether each refuses a
  modified `app.asar`, until they run on this pull request.
