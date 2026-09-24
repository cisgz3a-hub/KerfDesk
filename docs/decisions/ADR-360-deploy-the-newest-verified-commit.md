## ADR-360 - Production deploys the newest verified commit on main, not only the tip (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends ADR-311 clause 4 and its Amendment 1: the candidate phase no longer requires main's tip.
It keeps the serialized lane, the control-revision resolver, the on-main publication check and
the full release gate before publication.

### Context

On 2026-09-23 kerfdesk.com served `57a5a55a` from 16:14Z until 20:10Z while ten commits
merged. Five "Deploy to Cloudflare Pages" runs concluded **success** and published nothing;
each ran only "Record obsolete run as an intentional non-deployment". Three of them came in a
row inside that window. Run `35908116280` then published `e875fe290` at 20:10Z, and the other
two came after it. The run logs record each verdict:

| CI finished (UTC) | Validated | Main tip then | Verdict |
| --- | --- | --- | --- |
| 17:09 | `dd4488d13` | `5e4d8def4` | obsolete |
| 18:03 | `5e4d8def4` | `1e4a9a1f6` | obsolete |
| 18:36 | `1e4a9a1f6` | `e875fe290` | obsolete |
| 20:48 | `5eaa9d483` | `e461557e4` | obsolete |
| 21:29 | `e461557e4` | `025dc9b8d` | obsolete |

ADR-311 Amendment 1 fixed this failure in the **publication** phase (still on main, not
still the tip). The **candidate** phase kept the tip test and starves the same way:

- Main's CI does not cancel a run in progress. It keeps one pending run per group, so a
  queued push is superseded and CI verifies one commit at a time.
- A run takes 35-86 minutes.
- Any merge during a run leaves the commit it verified behind the tip by the time the deploy
  asks. Only a CI run with no merge during it could publish.

Two details made this hard to see:
1. A `workflow_run` deploy runs on the default branch, so `gh run list` showed main's tip,
   not the commit each run was deciding about.
2. Every no-op ended green.

CI runs superseded while still queued show as cancelled. That is the one-pending rule, not
`cancel-in-progress`, which is off on main.

### Decision

1. **The candidate phase builds the newest verified commit on main.** A `workflow_run`
   candidate that is not main's tip is built when all of these hold:
   - It is still on main (`git merge-base --is-ancestor`).
   - Main has not reverted it or anything it contains (see 2).
   - No commit newer than it on main (`git rev-list <candidate>..<main>`) is verified. A
     commit is verified if it has a successful `push` CI run on main, or a completed deploy
     run that names it in its `run-name` and whose "Publish to Cloudflare Pages" step succeeded
     in any attempt (`filter=all`), however that run ended.

   If a newer verified commit exists, the candidate is superseded and remains a provider-free
   no-op, and that commit's own run publishes it. The tip and a manual dispatch need no lookup.
2. **A revert withholds the reverted tree in both phases.** A revert adds a commit rather than
   removing one, so a reverted commit is still an ancestor of main. Under the tip-only rule it
   could never be built; under this one it could, until the revert's own run publishes.
   `scripts/list-reverted-in-candidate.mjs`, loaded from the control revision like the
   resolver, searches `<candidate>..<main>` for commits whose subject starts with `Revert "`
   (what `git revert` and GitHub revert PRs write). It takes their `This reverts commit <sha>`
   lines and withholds the candidate if a reverted SHA is the candidate or one of its
   ancestors. A squash body that merely quotes old revert lines does not count; `29c0ebfc2`
   quotes three. The revert is newer, so its own run publishes the corrected tree.
3. **Only a push to main is a candidate.** The job additionally requires
   `github.event.workflow_run.event == 'push'`. `branches: [main]` matches a triggering run's
   head branch, and a fork PR can name its branch `main`.
4. **A manual dispatch builds the tree it records.** It checks out `github.sha` (main when
   dispatched) instead of `refs/heads/main` at job start. A dispatch overtaken while queued is
   therefore an obsolete no-op, instead of publishing a newer tip than its record names. That
   mismatch would let an older candidate that is still "newest verified" publish over it.
5. **The lookup is read-only and fails loudly.**
   - The workflow gains `actions: read` and calls `gh api`.
   - It writes its lists only when it runs. A missing list, a malformed SHA, or a failed call
     fails the step instead of reading as "nothing newer is verified".
   - `resolve-web-deploy-identity.mjs` takes the lists as files and requires them for every
     non-tip `workflow_run` verdict.
6. **Runs say what they decided.**
   - `run-name` is `Deploy <sha>` for the tree the run builds.
   - A run that publishes nothing emits a `Production not published` notice with its reason.

### Why production cannot move backwards

The lane publishes only verified commits, one run at a time. Take any commit newer than a
candidate that production already serves or will serve:

- It passed push CI on main, or it was published by a run that names it and whose publish
  step succeeded in some attempt.
- Either record puts it in the verified set, unless it is older than the 100 most recent
  successful CI runs and the 100 most recent completed deploy runs. Those runs are then
  themselves newer than the candidate.

Either way the candidate is superseded. A historical rerun of an old CI, which ADR-311 was
written for, therefore stays a no-op. So does a candidate that would otherwise publish over
a newer commit whose own CI was later re-run to a failure, or whose publishing run ended red
or was re-run as a no-op: that earlier publication still counts. Built candidates publish in
lane order, and lane order follows CI completion order.

### Consequences

- **Production trails main by about one CI run plus the deploy gate.** It no longer waits for
  a quiet period that a busy merge rate never provides. Replaying the nine successful main CI
  completions of 2026-09-23 through the resolver:

  | Rule | Commits published |
  | --- | --- |
  | Old | 4 |
  | New | 9 |

- **The full `pnpm release:check` still runs inside the deploy.** ADR-311 Amendment 1 left
  removing that duplicate for its own decision, and `deploy-workflow-gate.test.ts` pins it.
  It adds about 50 minutes of lag but no longer causes starvation.
- **A lookup failure fails the deploy job visibly** for a non-tip candidate (a GitHub API
  outage or rate limit); a later run retries.
- **Residual risks:**
  - A candidate older than a change to `deploy.yml` runs the newer workflow against its own
    tree. A step that needs files the candidate lacks fails the job; it cannot publish
    silently.
  - A revert without the `This reverts commit` line is not recognized.
  - Deploy runs from before this change have no `Deploy <sha>` run-name, so only CI records
    identify them as verified.
  - A newer verified commit that is itself withheld still supersedes an older candidate. A
    commit containing B, whose revert R is still in CI, is one example. Production then waits
    for R's own run, or for the next green commit if R's CI fails. This is slower, never wrong.
  - A non-tip candidate that production already serves is rebuilt and republished. This is
    harmless but costs one gate (~50 minutes) of lane time.
  - A GitHub API blip, like the TLS handshake timeouts seen on 2026-09-24 at 00:06Z, turns a
    non-tip candidate's deploy red. The tip needs no lookup and still publishes.

### Alternatives rejected

- **Cancel nothing and keep the tip test:** starvation depends on the merge rate, not on
  cancellation.
- **Publish whatever is main's tip at publication:** it would publish a tree no run built or
  verified (ADR-311 Amendment 1).
- **Treat only first-attempt CI runs as eligible:** this relies on main CI staying
  serialized, and it wrongly refuses a legitimate rerun of the newest commit.
- **Ask Cloudflare's deployment API what production serves:** it would be a direct
  monotonicity check, but it depends on an API response shape this repository has not verified
  and on a token used before the build.
- **Remove the duplicated release gate here:** it changes what is verified before publication.
  That is a separate decision.

### Verification

- **`scripts/list-reverted-in-candidate.test.mjs` (4 tests, temporary git repositories)**
  covers a real `git revert`, a candidate that predates the reverted commit, a non-revert
  commit quoting revert lines (the `29c0ebfc2` shape), a revert of a commit outside the
  history, and the CLI output.
- **`scripts/resolve-web-deploy-identity.test.mjs` (17 tests)** covers:
  - a moved-past candidate with nothing newer verified builds;
  - a superseded one, including an old rerun, does not;
  - one that left main does not;
  - a reverted one is withheld before both build and publication;
  - every missing list or malformed SHA throws, and the CLI refuses a lookup file the workflow
    did not write;
  - the tip needs no lookup files.
- **`src/platform/web/deploy-workflow-gate.test.ts`** pins each step and resolver call
  separately:
  - the lookup guard, and the absence of pre-created empty lists;
  - the CI and published-deploy lookups;
  - the revert search in both phases;
  - the push-only condition, the dispatch checkout, `run-name` and the notices.
- **Both steps' shell ran locally** against this repository and the real GitHub API, with the
  new resolver:
  - the tip published;
  - `1e4a9a1f6` was superseded by `025dc9b8d`;
  - the reverted `a2a1faad1` was withheld at both phases;
  - an unmerged commit was refused as not on main;
  - an overtaken manual dispatch was an obsolete no-op with no API calls;
  - `1e4a9a1f6` still published at the publication phase.
- **The 2026-09-23 replay** uses the resolver, the real CI completion times, and the runs that
  had succeeded before each decision.
- **Two independent reviews (five lenses)** found the dispatch, revert, quoted-trailer,
  fork-branch, publication-attempt, dispatch-lookup, test-pinning and ADR-number issues fixed
  above.
