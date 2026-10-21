## ADR-647 - Pull requests run a focused browser smoke and skip unaffected Linux packaging; main runs everything (2026-10-20)

**Status:** Accepted | **Date:** 2026-10-20
**Amends:** ADR-557 (Browser smoke runs the whole suite on every event), ADR-607 and ADR-613
(the Linux installer and commercial Linux jobs run on every pull request), and point 2 of
ADR-645 (no job condition reads `github.event_name`).

### Context

On 2026-10-20 about 20 pull requests were open at once, and merges stalled for hours. The
repository is on a personal GitHub Free account, which runs about 20 jobs at a time. A merge
queue needs an organisation, so ADR-645's queue cannot be turned on, and "require branches to
be up to date" was already off.

Eight green runs of each workflow on 2026-10-20 (median job time):

| Workflow | Jobs per pull request | Runner minutes |
| --- | --- | --- |
| CI | 9 (4 unit shards of about 16 min) | about 85 |
| Browser smoke | 6 (4 suite shards of 22 to 38 min) | about 126 |
| Desktop package check | 4 (3 Linux jobs of 3.5 to 6 min) | about 15 |
| **Total** | **19** | **about 226** |

The four browser shards run 484 tests with one Playwright worker each and set the wall time
of about 40 minutes. Dependency installs are already cached (about a minute per job), so
caching has little left to give. With about 226 runner minutes per pull request, the 20 slots
finish about five pull request runs an hour before main's own runs.

The maintainer asked for lighter pull request CI ("a smaller browser-smoke subset on PRs, full
smoke on main"), keeping a required check that still catches real UI breakage, and approved
this plan before any change.

### Decision

1. **Browser smoke on a pull request** runs one job, *Chrome UX smoke (pull request core and
   changed specs)*, in place of the four shards. It runs the cold start check and then
   `scripts/run-pr-browser-smoke.mjs`: 11 fixed core spec files (app shell, workspace, layout,
   documents, SVG import and save, project save, canvas text, first machine setup and the
   G-code preview), plus every spec Playwright's `--only-changed` finds changed since the base
   branch, which includes specs whose imported helpers changed. Because that only follows the
   test process's imports, every spec that names a changed non-spec file under `e2e/` is selected
   too, through other files that name it (a spec opens `tools-ai-audit.html`, which loads
   `tools-ai-audit.tsx`); a data file is matched by the fixture folder it sits in. The checks job still runs on
   every event (browser test type-check and discovery, cold start, viewer responsiveness and
   the production-bundle smoke).
2. **Pushes to main, merge queue entries and manual runs** still run the whole suite in four
   shards. The *Chrome UX smoke* gate needs the checks job and both suite jobs, and lets only
   the suite job its event does not use be skipped.
3. **Desktop package check on a pull request** first runs *Choose the packaging checks this
   change needs* (`scripts/desktop-packaging-scope.mjs`). If every file the pull request
   changes is renderer source outside `src/platform/`, `src/ui/app/` and `src/ui/licensing/`, a
   unit test, a browser spec, documentation or the website, the AppImage/.deb job and the
   commercial Linux rehearsal are skipped. Any other path, an unknown path or an empty diff
   selects them. A failed scope job leaves its output empty, which also selects them. Like the
   packaging gate, the scope job runs from the workflow's own revision, because a release-train
   call may package an older commit that predates the scope script.
   *Package, check and launch the desktop app* still runs on every pull request, so every
   renderer change is still packaged and launched.
4. **The required check names do not change.** A job skipped by its condition reports success
   for a required check. The commercial Linux job gets the literal name *Rehearse the
   commercial Linux build (x64)*: a skipped matrix job reports its name unexpanded, which would
   leave the required check waiting forever. The packaging gate expects the two jobs to be
   skipped exactly when the scope job chose to skip them.
5. **Conditions may test only `github.event_name == 'pull_request'`** (or `!=`). A merge queue
   entry, like a push to main, then runs everything. `scripts/merge-queue-workflows.test.mjs`
   still rejects every other event-specific condition.

### Consequences

- A typical renderer-only pull request runs about 15 jobs instead of 19, and about 110 runner
  minutes instead of 226. Its slowest job is now a unit test shard (about 17 minutes) instead of
  a browser shard (about 38). A pull request that touches packaging or desktop source adds the
  two Linux jobs back (about 12 minutes).
- Main's runs are unchanged, and the unsigned desktop release still waits for all three
  workflows to pass on a push to main.
- **Residual risk:** a UI breakage that only a spec outside the core and outside the pull
  request's changes would catch can merge. Main's full Browser smoke run reports it about
  40 minutes after the merge, and the fix is a revert or a follow-up. Browser smoke does not
  gate the web deploy (ADR-158), so such a breakage can reach kerfdesk.com until it is reverted.
  Making the deploy wait for Browser smoke would close that, at about 40 minutes per deploy;
  that remains the maintainer's decision under ADR-206.
- A packaging-relevant change that lands only in a path the scope list treats as renderer
  source (for example a renderer change that breaks only the AppImage launcher) reaches main
  before the installer jobs see it. The stable packaged launch still runs on the pull request.
- A pull request that changes a helper most specs import, such as
  `e2e/fixtures/kerfdesk-test.ts`, selects most of the suite, and its one job then runs for
  well over an hour. That is rare and is the right coverage for such a change.
- To run the whole browser suite for a pull request before merging, start Browser smoke with
  `workflow_dispatch` on its branch.
- Unit tests are unchanged on pull requests.

### Verification

- `scripts/run-pr-browser-smoke.test.mjs` pins the core list (each file exists and belongs to
  the development suite), the dedupe of changed specs, the pull request job, its `fetch-depth`
  and the gate's single allowed skip.
- `scripts/desktop-packaging-scope.test.mjs` pins which paths skip and which select the
  installer jobs, and that only a pull request reads its diff.
- `scripts/desktop-packaging-gate.test.mjs`, `scripts/ci-parallel-gate.test.mjs`,
  `scripts/merge-queue-workflows.test.mjs`, `scripts/unsigned-release-plan.test.mjs` and
  `release-desktop-preview-workflow-gate.test.ts` were updated for the new conditions and pass.
- Playwright 1.61's `test --list --reporter=json --only-changed=<base> --pass-with-no-tests`
  listed spec files relative to `e2e/` and exited 0 with no suites when nothing changed.
- This change's own pull request ran the new browser job and the packaging scope job. It
  changes scripts and workflows, so its scope selected the installer jobs; the skip path is
  covered by the scope and gate tests.
