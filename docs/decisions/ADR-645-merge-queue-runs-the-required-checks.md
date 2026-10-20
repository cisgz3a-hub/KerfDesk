## ADR-645 - The required checks run on GitHub's merge queue, so main can merge through it (2026-10-20)

**Status:** Accepted; the workflows run on `merge_group`. The maintainer turns the queue on in
ruleset 19573147 ("Protect main branch") after this lands. | **Date:** 2026-10-20

### Context

Main's ruleset requires five checks and requires a branch to be up to date before it merges:

- *Lint, typecheck, license, test, build* (`ci.yml`)
- *Chrome UX smoke* (`e2e.yml`)
- *Package, check and launch the desktop app*, *Package, install and launch the Linux AppImage
  and .deb* and *Rehearse the commercial Linux build (x64)* (`desktop-package-check.yml`)

A run takes about 40 minutes. Each merge leaves every other green pull request behind main, so
on 2026-10-20 more than 21 green pull requests merged one at a time, 40 minutes or more apart.
The maintainer approved moving main to GitHub's merge queue ("do it").

The queue tests each entry, merged onto main and the entries ahead of it, on a
`gh-readonly-queue/main/pr-<n>-<sha>` branch. It waits for the required checks there, and the
workflows report them only on events they trigger on. None of the three triggered on
`merge_group`, so turning the queue on would have stalled every merge.

### Decision

1. `ci.yml`, `e2e.yml` and `desktop-package-check.yml` also run on `merge_group`
   (`types: [checks_requested]`), with the jobs and check names they run on pull requests.
2. Nothing in them depends on pull request or push data. No job or step condition reads
   `github.event_name`, `github.head_ref`, `github.base_ref` or `github.event.*`, and no trigger
   has a branch or path filter that could skip a queue entry. The native Windows and macOS jobs
   stay skipped, as on pull requests, because only manual runs and the release train set
   `native`.
3. Concurrency groups stay `<workflow>-${{ github.ref }}`. Each queue entry has its own ref,
   so a queue run never shares a group with a pull request, main or another entry. GitHub
   cancels a group's runs itself when it rebuilds the queue.
4. Deploys and releases still follow pushes to main only. `deploy.yml` and
   `release-desktop-unsigned.yml` take `workflow_run` on branch `main` and require
   `workflow_run.event == 'push'`. The release train and the Preview cadence count runs with
   `--branch main --event push`. When the queue merges an entry, main gets a push and the push
   runs as before.
5. `scripts/merge-queue-workflows.test.mjs` (in `test:release-integrity`) pins all of this.

### Ruleset change (the maintainer's step)

Add a `merge_queue` rule to ruleset 19573147: merge method MERGE, grouping strategy ALLGREEN,
a maximum group size of 5 and a status check timeout of at least 90 minutes. Turn "require
branches to be up to date" (`strict_required_status_checks_policy`) off: the queue tests every
entry on the latest main, so the setting only adds manual updates.

### Consequences

- A queued pull request runs CI twice, once on its branch and once in the queue. With groups of
  up to five, entries test in parallel and merge together when all of them pass.
- A merge reaches main only after its queue run passes, so main gets the same checks as before
  on the exact tree that lands.
