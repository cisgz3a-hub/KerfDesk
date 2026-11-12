## ADR-710 - A required `main-is-green` status stops merges onto a red main

**Status:** Accepted. The maintainer chose this on 2026-11-12, in place of a merge queue, in reply
to code quality audit C2 finding D7-P1-1
(`docs/audits/2026-11-11-code-quality-c2/D7-ci-health.md`, option 4 and the refuter's section on
it). It takes effect when the maintainer adds `main-is-green` to the required status checks of
main's ruleset; this change does not touch the ruleset. | **Date:** 2026-11-12

### Context

- 79 % of the week's merges (156 of 197) landed on combinations their CI never saw. main's Browser
  smoke was red 46 % of the time. One stale spec (R4, #1705) held main red for 21.2 hours while 33
  pull requests merged on top, hiding any second breakage behind the first.
- ADR-645's merge queue would test combinations, but GitHub offers merge queues only to
  organisation-owned repositories. `cisgz3a-hub/KerfDesk` is on a personal account.
- Requiring up-to-date branches (`strict_required_status_checks_policy`) stalls auto-merge, because
  `allow_update_branch` is off and every rebase re-runs a 1–2 hour CI.
- The refuter found that a check computed once, at a pull request's own push, does not work: a pull
  request that went green before main went red keeps its stale green and still merges.

### Decision 1 - A commit status on every open pull request head, re-synced whenever main's verdict may change

`.github/workflows/main-is-green.yml` runs `scripts/main-is-green.mjs`, which writes the commit
status `main-is-green` onto the head SHA of every open pull request into main.

- **success** when main's latest completed CI run and latest completed Browser smoke run both
  concluded `success`. It links to the Actions page.
- **failure** when either concluded anything else (failure, timed out, startup failure). It links to
  the red run, and the description names the red workflow and its commit.
- **error** when either workflow has no completed run on main to judge by. That blocks, as a
  missing verdict should.

"Latest completed" means the newest run on branch `main` from a `push` or `workflow_dispatch` event
whose status is `completed`, skipping runs that carry no verdict: `cancelled` (a superseded pending
run), `skipped` and `stale`. Pull request and merge queue runs test other combinations and are
ignored. A newer run still in progress does not count until it completes.

It runs on three triggers, and every run re-syncs every open pull request, so a newer run that
replaces a pending one loses nothing:

- `workflow_run`, when CI or Browser smoke completes on main. main's verdict may have changed.
- `pull_request_target` (opened, reopened, synchronize, edited, labeled, unlabeled, base main).
  A new head has no status, and a required status that is missing blocks the merge, so a newly
  opened pull request cannot merge before its first sync.
- `workflow_dispatch`, to re-sync by hand (for example right after this lands, before the ruleset
  requires the status).

One GraphQL query reads the open pull requests with their labels and each head's current
`main-is-green` status. The script writes only where the state, description or link would change,
spaced 0.8 s apart, which keeps it under GitHub's limit of about 80 content-creating requests a
minute. Runs share one concurrency group without cancelling, so they never overlap and an older
verdict cannot land after a newer one.

### Decision 2 - `fixes-main` lets the fix land

A pull request labelled `fixes-main` gets **success** while main is red, with the description
"main is red, but this pull request is labelled fixes-main." and a link to the red run. Adding or
removing the label re-syncs at once. When main is green the label changes nothing. Use it only on
the pull request that repairs main (or reverts the change that broke it). Remove it afterwards.

The label must exist in the repository (`gh label create fixes-main`).

### Decision 3 - The gate runs as it is on main, never as a pull request has it

- Both `workflow_run` and `pull_request_target` run the workflow file from main. The job checks out
  main (the default ref of both events, with no `ref` or `repository` override, credentials not
  persisted, sparse to `scripts/main-is-green.mjs`) and runs that one dependency-free Node script.
  No pull request code is checked out, installed or run.
- `pull_request` is deliberately not used. It would run the pull request's own copy of the gate,
  which a pull request could edit to pass itself, and a fork's run cannot write statuses.
- The job is skipped unless `github.ref` is `refs/heads/main`, so a manual run from another branch
  does nothing.
- It uses only `GITHUB_TOKEN`, with no new secret. Workflow permissions are `{}`; the job gets
  `statuses: write`, `pull-requests: read`, `actions: read` (main's runs) and `contents: read` (the
  checkout; not needed while the repository is public, but it keeps the job working if the
  repository goes private again, as it did on 2026-11-05..08).

`scripts/main-is-green-workflow.test.mjs` pins the triggers (including that the `workflow_run` names
match `ci.yml`'s and `e2e.yml`'s `name:`), the absence of `pull_request`, the checkout, the
permissions, the concurrency group and the script's verdict, label and write rules.

### Consequences

- While main is red, no pull request merges except one labelled `fixes-main`. A red episode like R4
  can no longer pile up 33 merges, and a second breakage cannot hide behind the first.
- A flaky red on main blocks merges until main is green again. Re-run the red run on main (a re-run
  completion re-syncs), or merge a `fixes-main` pull request.
- It does **not** test combinations. Two green pull requests can still merge minutes apart onto a
  green main and break it together; this gate then stops the next merges until it is fixed. It is a
  mitigation, not a replacement for ADR-645's queue. If the repository moves to an organisation, the
  queue becomes available and this gate can stay beside it.
- Statuses written by this workflow do not trigger other workflows.
- Until the ruleset requires `main-is-green`, the status is advisory only.
- This pull request cannot exercise the workflow on itself: `pull_request_target` and
  `workflow_run` run main's copy, which does not exist until this merges. The script was dry-run
  against the live repository with writes recorded and not sent: it found main green (CI run
  43184142233, Browser smoke run 43176625402) and would have written `success` onto the 7 open pull
  request heads.

### Turning it on (maintainer, after this merges)

1. Run "Main is green" once from the Actions tab (Run workflow, branch `main`), or wait for the
   next CI or Browser smoke completion on main. Check that open pull requests show `main-is-green`.
2. Create the label: `gh label create fixes-main --color B60205 --description "Fixes a red main; passes main-is-green (ADR-710)"`.
3. Settings → Rules → Rulesets → "Protect main branch" (ruleset 19573147) → Require status checks
   to pass → Add checks → type `main-is-green` → select it, leaving its source as "Any source"
   → Save changes.
