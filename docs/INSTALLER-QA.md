# Installer QA

T3-85 defines the manual release gate for installer validation. Run
this checklist before publishing a public beta, paid release, or any
build sent to users outside the development loop.

This is a manual release gate because the matrix covers operating
system behavior, user account privileges, Gatekeeper, installer upgrade
state, and offline conditions that cannot be trusted from a normal unit
test run. Automated build and smoke checks still run separately; this
file is the human release checklist that decides whether an installer
is allowed to ship.

## Release candidate record

Fill this block for each release candidate:

| Field | Value |
|---|---|
| Version |  |
| Commit |  |
| Release tag |  |
| Windows artifact |  |
| macOS artifact |  |
| SHA256SUMS |  |
| SBOM |  |
| Attestation |  |
| Tester |  |
| Date |  |

Use [docs/CODE-SIGNING.md](CODE-SIGNING.md) to produce and verify the
signed Windows and macOS artifacts, checksums, SBOMs, and GitHub
attestations before starting the matrix.

## Result states

| Result | Meaning |
|---|---|
| Pass | Scenario completed, app launched, and no release-blocking issue was found. |
| Fail | Scenario exposed a release-blocking installer, signing, launch, update, or data-loss issue. |
| Blocked | Scenario could not be run because the required OS, VM, certificate, account, or artifact was unavailable. |
| Skipped | Scenario intentionally does not apply to this release, with a written reason. |

Do not publish a release with any required row marked Fail. Do not
publish a release with Blocked rows unless the release notes and release
owner explicitly accept the missing coverage.

## Required matrix

| Platform | Scenario | Verifies | Result | Notes |
|---|---|---|---|---|
| Windows 10 | Windows 10 fresh install, admin user | Standard installer flow on the oldest supported Windows target. |  |  |
| Windows 11 | Windows 11 fresh install, admin user | Current Windows installer path, shortcuts, app launch, and uninstall entry. |  |  |
| Windows 11 | Windows 11 fresh install, non-admin user | Restricted user / per-user install behavior without admin elevation assumptions. |  |  |
| Windows 11 | Windows 11 upgrade install over previous version | Existing user data, profiles, license cache, and settings survive upgrade. |  |  |
| Windows 11 | Windows 11 uninstall / reinstall | Uninstall completes and a reinstall launches cleanly. |  |  |
| Windows 11 | Windows path with spaces | Install and launch work from a path such as `C:\Users\John Smith\Apps\LaserForge`. |  |  |
| Windows 11 | Windows path with non-ASCII characters | Unicode path handling works from a real non-ASCII Windows username or install directory. |  |  |
| macOS Intel | macOS Intel fresh install | x64 dmg opens, app copies to Applications, and launches. |  |  |
| macOS Apple Silicon | macOS Apple Silicon fresh install | ARM or universal dmg opens, app copies to Applications, and launches. |  |  |
| macOS Apple Silicon | macOS Gatekeeper before notarization | If an unsigned or unnotarized candidate is intentionally tested, the warning is expected and documented. |  |  |
| macOS Apple Silicon | macOS Gatekeeper after notarization | Signed and notarized release candidate opens without a Gatekeeper block. |  |  |
| Windows + macOS | Offline during install | Installer does not require network access. |  |  |
| Windows + macOS | App launches without internet | App starts offline and entitlement offline-grace UI behaves as expected. |  |  |

## Per-scenario checks

For every row above:

1. Install from the exact release artifact recorded in the release
   candidate record.
2. Launch LaserForge from the installed application, not from source.
3. Confirm Settings opens and the version/build text matches the
   release candidate.
4. Confirm the app can open to the main canvas without network access
   unless the row is intentionally testing online update behavior.
5. Record screenshots or terminal output for every Fail or Blocked row.

## Exit criteria

The release may proceed only when:

- all required rows are Pass, or explicitly Blocked/Skipped with owner
  acceptance,
- checksum, SBOM, and attestation verification succeeded for the
  published artifacts,
- any Gatekeeper or SmartScreen warning is expected for the release
  stage and documented in release notes,
- upgrade rows confirm user data preservation,
- restricted user and unicode path rows have either passed or have a
  documented release-owner exception.
