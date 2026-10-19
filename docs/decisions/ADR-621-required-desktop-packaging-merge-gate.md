## ADR-621 - Require applicable desktop packaging before merge (2026-10-18)

**Status:** Accepted. | **Date:** 2026-10-18

### Context

PR #1267 auto-merged after the required CI and browser gates passed while its
desktop-package workflow was cancelled. Packaging subsequently passed on the
merge commit, but it had not qualified the PR before merge. The maintainer
explicitly requested that every applicable CI check, including desktop
packaging, pass before a PR can merge.

### Decision

- Main's active ruleset requires the CI aggregate, browser aggregate and
  `Desktop packaging gate`, plus the three unconditional Linux package checks.
  All required contexts must originate from GitHub Actions (integration 15368).
  Existing PR, deletion and non-fast-forward protections remain; no bypass
  actors are added. PRs must be tested against the current base branch.
- The desktop aggregate runs with `if: always()` after all packaging jobs.
  Stable Linux packaging, Linux installer qualification and the commercial Linux
  rehearsal must succeed. Windows, macOS and commercial macOS may be skipped
  only when the workflow's native-build input is false. When native builds are
  requested, they must also succeed.
- Failed, cancelled, missing or unexpected dependency results fail the gate.
  A cancelled workflow cannot supply a successful gate. A workflow regression
  test requires the aggregate's dependency list to cover every packaging job.
- Keep the desktop workflow separate from the web deployment workflow. This
  decision changes merge admission; it does not request a deployment or release.

### Verification

Focused tests exercise the gate's success, failure, cancellation, missing-job and
native-skip cases and verify complete workflow dependency coverage. Read back the
live ruleset after changing it. Existing PRs without the new gate remain blocked
until their tested source includes it; no temporary bypass is used to bootstrap.
