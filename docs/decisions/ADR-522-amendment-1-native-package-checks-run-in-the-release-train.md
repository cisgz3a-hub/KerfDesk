## ADR-522 Amendment 1 - Windows and macOS package checks run in the release train, not on every pull request (2026-09-29)

**Status:** Implemented | **Date:** 2026-09-29 | **Amends:** ADR-522 decision 1

### Context

ADR-522 made every pull request and every push to `main` build, install and launch the desktop
app on Windows and on both macOS architectures. It was written while the repository was public,
when GitHub Actions minutes on standard runners cost nothing. The repository is now private.
Private-repository minutes are billed after the free allowance, and Windows and macOS runners
bill at 2x and 10x the Linux rate, so one pull request's three native jobs cost as much as
dozens of Linux runs. On 2026-09-28 and 2026-09-29 the account's Actions budget ran out and
every job on every pull request stopped starting, including the checks that gate `main` and the
web deploy.

### Decision

- `desktop-package-check.yml` keeps its Linux job on every pull request and every push to
  `main`, unchanged.
- Its Windows and macOS jobs run only when the workflow is called by the release train
  (`workflow_call`) or started by hand (`workflow_dispatch`). Both set the `native` input; pull
  requests and pushes leave it empty, so those jobs are skipped rather than failed.
- The workflow's concurrency group uses a fixed `desktop-package-check-` prefix, so a call from
  the release train never shares the caller's group.
- The Preview and commercial release lanes keep their own package contracts, so no build reaches
  customers without the native checks running on it first.

### Consequences

A pull request that breaks only Windows or macOS packaging is caught by the next release train or
a manual run instead of on the pull request itself. Anyone changing packaging, the installer,
fuses, `app.asar` contents or the native smoke should start the workflow by hand on their branch
before asking for a merge. The workflow gate test pins which jobs are gated, so a later edit
cannot quietly put the native jobs back on every pull request.
