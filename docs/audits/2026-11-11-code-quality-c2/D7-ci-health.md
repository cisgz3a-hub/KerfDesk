# D7 — CI health (code quality audit C2)

**Question.** Does CI catch failures quickly and reliably?

**Tree.** Workflows read from `origin/main` @ `dd8cf6e54`, read-only (`git show`, exported to `zz-d7\wf\`). The PR browser-smoke selector was re-run on a `git archive` of `origin/main` `e2e/` and `scripts/run-pr-browser-smoke.mjs`.

**Window.** 2026-11-05 00:00 to 2026-11-12 07:48 UTC. That is 2,981 workflow runs and 219 merged pull requests.
- Metrics use **2026-11-08 09:00 → 2026-11-12 07:48 UTC (94.8 h)**: 198 merges and 196 main commits.
- The window starts there because 2026-11-05 23:19 to 2026-11-08 09:00 is the known billing lock and private-repo outage: "The job was not started because your account is locked due to a billing issue", 78 `startup_failure` runs.

**Method.** Everything was read-only. I re-ran, cancelled or dispatched nothing and changed no settings.
1. **Runs.** `gh api actions/runs`, paged per day, 2,981 runs, saved as `runs.jsonl`.
2. **Jobs.**
   - Jobs for 579 runs (`jobs.json`): every failed run, every main-push success, the latest 60 PR successes per workflow, and cancelled runs over 40 min.
   - Earlier attempts of all 56 re-run runs (`reruns.json`).
3. **Failures.** Check-run annotations for every failed job: 46 main runs (`main-failures.json`) and 83 PR runs (`pr-failures.json`). Job logs for the failures with no annotation (`logs\`).
4. **Settings.** Ruleset 19573147 (`ruleset-main.json`). `gh pr list --state merged` (`prs-merged.json`).
5. **Analysis.** Node scripts in `..\zz-d7-scripts\`.

## Headline

- **CI finds failures, but mostly on `main`, after the merge, and late.**
  - Main's Browser smoke was red for **43.4 h of 94.8 h (46 %)**. 31.7 h of that came from five real defects that every pull request's checks passed.
  - Main's CI was red 11.8 h (12 %), mostly from infrastructure.
  - 33 of 74 completed main Browser smoke runs failed.
- **C1-P1-2 is still open (D7-P1-1).**
  - The ruleset still has `strict_required_status_checks_policy: false` and no `merge_queue` rule. It has not changed since 2026-10-20.
  - **79 %** of the 198 merges landed after at least one other merge that their last CI run never saw (median 3, p90 11, maximum 27).
  - ADR-645 waits for "the maintainer turns the queue on". GitHub offers the merge queue only to **organisation-owned** repositories, and `cisgz3a-hub` is a **User** account. The planned switch may not exist; see Not verified.
- **The PR browser smoke cannot see app-code changes.** Four of the five real red episodes were a spec outside the 11 core files, broken by a `src/` change that selected no specs: #1622, #1668, #1705 and #1719. The fifth was the boot bundle (D7-P1-1).
- **Main is mostly unverified (D7-P2-3).**
  - Only **38 %** of main commits got a completed Browser smoke run and **47 %** a completed CI run. The rest were superseded while pending.
  - The longest streaks are open now: 19 commits with no completed CI and 18 with no completed Browser smoke since 06:43 UTC.
  - Main's CI run 43170112807 sat queued or waiting on runners for **66 min**.
  - PR jobs waited **p90 77–104 min, max 140 min** for a runner on 2026-11-11/12.
- **No job hung.**
  - The "#1730 job hung 86+ min" was a PR smoke job that ran **476 tests on one runner for 2 h 13 m**. The selector over-picks specs (D7-P2-2): one fixture change selects **141 of 172** specs on today's main.
  - No `ci.yml` or `e2e.yml` job has `timeout-minutes` (D7-P3-1).
- **Flakes have code causes.**
  - The Abort-promptness guard fails whenever the CPU profiler samples a native `toString`: the counter object inherits it (`name in counts`; D7-P2-1, 3 red main runs).
  - The camera overlay guard was chance-based on GPU-less runners (9 red main runs; #1808 changed it).
  - Infrastructure: GitHub 504s on the Electron download broke unit shards (D7-P3-2), plus the 2026-11-11 DNS and apt outage.
- **Retries are off everywhere** (Playwright `retries` unset, Vitest `retry` unset), so no flake is hidden. Every required check's gate fails on a cancelled or skipped job.

## Metrics

### Outcomes (2026-11-08 09:00 → 2026-11-12 07:48 UTC)

| Workflow | Event | success | failure | cancelled | Wall p50 / p90 / max (min), first attempt, success |
|---|---|---|---|---|---|
| CI | pull_request | 224 | 49 | 89 | 41 / 139 / 174 |
| CI | push (main) | 84 | 8 | 102 | 30 / 54 / 145 |
| Browser smoke | pull_request | 267 | 27 | 72 | 28 / 113 / 161 |
| Browser smoke | push (main) | 41 | **33** | **120** | 50 / 74 / 87 |
| Desktop package check | pull_request | 309 | 7 | 50 | 15 / 104 / 171 |
| Desktop package check | push (main) | 108 | 5 | 81 | 12 / 41 / 145 |

The wall time runs from the run's creation, so it includes waiting for runners.

### Main red time

| Workflow | Red (h) | Share of 94.8 h | From real defects (h) |
|---|---|---|---|
| Browser smoke | 43.4 | 46 % | 31.7 |
| CI | 11.8 | 12 % | 4.0 (boot bundle 0.6; #1670+#1672 3.6) |
| Desktop package check | 6.6 | 7 % | 0 (504s and DNS) |

### Main commits with a completed run

| Workflow | Main commits | With a completed run | Longest streak with none |
|---|---|---|---|
| CI | 196 | 92 (47 %) | 19 (2026-11-12 06:43 →, open) |
| Browser smoke | 196 | 74 (38 %) | 18 (2026-11-12 06:43 →, open); 12 (11-11 18:31 → 11-12 00:12) |
| Desktop package check | 196 | 113 (58 %) | 18 (open) |

Streaks of 5 or more were also seen on 11-08 11:33 (8), 11-08 12:48 (7), 11-09 06:53 (6), 11-09 08:48 (7) and 11-11 11:31 (6).

### Job duration and queue (successful jobs)

Runner wait is from job creation to start.

| Job | n | Run p50 | Run p90 | Run max | Wait p50 | Wait p90 | Wait max |
|---|---|---|---|---|---|---|---|
| Chrome UX smoke (n/4), main | 258 | 33.5 | 41.5 | 46.9 | 0.3 | 22.1 | 56.4 |
| Unit tests (n/4), PR | 416 | 17.8 | 21.8 | 23.2 | 29.6 | 104.1 | 129.4 |
| Unit tests (n/4), main | 364 | 17.4 | 21.4 | 23.0 | 0.1 | 16.2 | 101.4 |
| Chrome UX smoke (PR core and changed specs) | 67 | 16.9 | 19.5 | 21.6 | 18.6 | 77.3 | 95.2 |
| Typecheck, lint and format, PR | 111 | 10.7 | 11.9 | 12.8 | 22.5 | 90.6 | 139.7 |
| Commercial Linux rehearsal, main | 110 | 6.4 | 7.8 | 11.0 | 0.1 | 5.3 | 10.9 |
| Browser test checks and production-bundle smoke, PR | 75 | 6.5 | 7.5 | 8.6 | 13.6 | 79.2 | 93.1 |
| Phone and MCP service, PR | 107 | 5.8 | 6.5 | 9.6 | 25.3 | 96.0 | 114.6 |
| Policy checks and builds, PR | 102 | 4.9 | 5.3 | 6.5 | 20.7 | 94.9 | 117.4 |
| Package, check and launch the desktop app, PR | 63 | 3.9 | 4.4 | 5.1 | 11.2 | 77.4 | 102.9 |

All times are in minutes. The PR sample is the latest 60 successful runs per workflow, so it leans toward the 2026-11-11/12 peak.

| Runner wait by day (all sampled jobs) | n | p50 | p90 | max |
|---|---|---|---|---|
| 2026-11-09 | 789 | 0.1 | 6.9 | 36 |
| 2026-11-10 | 670 | 0.1 | 7.0 | 31 |
| 2026-11-11 | 1,223 | 10.3 | 77.3 | 140 |
| 2026-11-12 | 635 | 9.3 | 78.0 | 123 |

**Shard balance.**
- Browser: (1/4) 35.2, (2/4) 36.3, (3/4) **38.2** and (4/4) **25.2** min (p50). The slowest shard sets main's time; shard 4 sits idle about 13 min.
- Unit: 17.1–19.3 min (p50). Balanced.

**Jobs over 60 min (sample).** Both were PR "core and changed specs" jobs: 135 min (run 42960008500, #1730) and 107 min (run 42967704819, `annoyance-splash-close`). Each selected 123 specs (D7-P2-2).

**Cancellations.**
- No run or job in the sample was cancelled by a timeout.
- Main: 120 of 194 Browser smoke and 102 of 194 CI runs were *superseded while pending*. `cancel-in-progress` is false on main (`ci.yml:22-24`, `e2e.yml:24-26`), so these runs never started. Some had waited 40–45 min first (for example 42644354930 and 43004059740).
- PRs: 72–89 runs per workflow were cancelled by a newer push.

## Red-main timeline

| # | Window (UTC) | Length | What broke | Kind | Introduced by | Fixed by | Merges inside | Run evidence |
|---|---|---|---|---|---|---|---|---|
| R1 | 11-09 04:17 → 07:22 | 3.1 h | `e2e/gcode-viewer-stock.e2e.ts:421`: "Cut too deep: 2 %" on a correct carving | real (stale comparison) | #1622 (relief CAM samples the surface) | #1646 | 10: #1622, #1624, #1625, #1626, #1634, #1635, #1637, #1636, #1640, #1645 | 42560980577, 42563551617, 42566329262, 42574612821 |
| — | 11-09 06:36 → 08:20 | ~1.7 h | GitHub 504 on `electron-v44.9.1-linux-x64.zip` → `electron/native-smoke*.test.ts` and the packaging jobs | infra | — | (passed) | — | CI 42574102533, 42579786345; pkg 42576861859, 42579786368 |
| R2 | 11-09 17:31 → 11-10 00:09 | 6.6 h | `workspace-responsive.e2e.ts:91` (two `role=status`); CI: `rotary-summary.test.ts`, `returning-user-rotary-1-0-30.test.ts` | real (C1-P1-1) | #1668; #1670+#1672 untested merge | #1677 | 5: #1671, #1673, #1674, #1670, #1672 | BS 42665506473 … 42693574292; CI 42693573999 |
| — | 11-10 01:23, 02:13 | single runs | Abort guard `toString` (D7-P2-1); Chrome download reset | flaky / infra | — | — | — | 42735497638, 42741205784 |
| — | 11-10 09:44 | single run | workerd "Body is unusable" (D7-P3-3) | flaky | — | — | — | 42793167503 |
| R4 | 11-10 12:19 → 11-11 09:31 (green 10:04) | **21.2 h** | `document-import-acceptance.e2e.ts:150`: legacy-Illustrator rejection, a spec stale after ADR-700 | real | #1705 | #1730 | **33**: #1709 … #1745 | 42814761574 → 42990185776 (16 red runs) |
| R3 | 11-10 14:14 → 14:53 | 0.6 h | CI `check:boot-bundle`: 2,262 KiB over the 2,256 KiB limit | real (merge combination) | #1709/#1710/#1711, each green alone | #1713 | 0 | 42831998778 |
| R5 | 11-10 19:03 → 11-11 05:00 | 9.9 h | `artwork-field-rows.e2e.ts:129`: 13 dither swatches, 12 expected | real | #1719 (3D Sliced swatch) | #1728 | 4: #1721, #1722, #1726, #1727 | 42881468988 … 42962163725 |
| R6 | 11-11 09:31 → 11-12 05:26 | 19.9 h, intermittent | camera bridge overlay guard over its CI ceiling | flaky by design | #1740 (new guard) | #1808 | 38 (#1746 … #1805) | red 42995866277, 43020998986, 43125597328, 43142759469, 43154635822; green 43000478403, 43029599683, 43077807767 |
| R7 | 11-11 13:40 → 18:26 | 4.8 h | DNS and apt: `Temporary failure resolving 'azure.archive.ubuntu.com'` (Install Chrome, Prepare the service checks, .deb install) | infra | — | recovered; #1781 adds a fallback | 4: #1758, #1762, #1763, #1761 | CI 43031269155, 43035655272, 43043176732; BS 43035655265, 43043176761; pkg 43032987073 |
| — | 11-12 02:37 | single run | `topology-repairs.e2e.ts:23` via `fixtures/gcode-save.ts:31` | flaky (one-off) | — | — | — | 43142759469 |

**Untested merges this week** (each green alone, wrong together):
- **#1670 + #1672** (R2): #1672's last CI started 20:07:58, and #1670 merged 20:08:48.
- **The boot bundle** (R3): #1711's last CI ran 13:14 on a base without #1709 or #1710.
- **K40 vs #1753's registry:**
  - #1724's last CI was at 10:57 on base `6ce535a26`; #1753's was at 11:14 on base `c3856ce06`.
  - They merged at 12:27:48 and 12:30:55, after 9 and 11 other merges.
  - No test covered the gap, so a merge queue alone would not have caught it. D4's type-level fix in #1818 does.
- **Deploys:** 27 production deploys this window went out with main's Browser smoke red. Deploy gates on CI only, under the KNOWN ADR-647 and ADR-206 decision.

## Flake and infrastructure list

| # | Spec or step | Kind | Main red runs | PR or re-run evidence | Cause | Status |
|---|---|---|---|---|---|---|
| F1 | `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts` (RTSP test `:48`, then bridge test `:311`) | timing guard | 9: 42942634275, 42971709302, 42981447930 (`[53]`, `[51]`, `[52]` ms); 42995866277, 43020998986, 43125597328, 43142759469, 43154635822 | PR 42960008500 `[54]` | 50 ms long-task budget on GPU-less runners; tasks were the job's own renders (#1808's CPU profile) | #1808 (ADR-598 Amd 7): on CI, a task fails only when camera code holds ≥ 50 % of its samples. 1 green main run since |
| F2 | `e2e/run-gcode-file-abort.e2e.ts:206` and `:232` (Ctrl+. stops a Frame or stream promptly) | **test bug** | 3: 42665506473, 42735497638, 42981447930 | PR 42567503739, 42574007300 (older lines) | `name in counts` is true for an inherited `toString`; the received object gains `"toString": "function toString() { [native code] }1"` | **open on main** (D7-P2-1) |
| F3 | `services/remote-control/test/mcp-batch-boundary.test.mjs:438` (workerd near-limit batch) | flaky | 1: 42793167503 | re-run 42736627128 failure → success | `TypeError: Body is unusable: Body has already been read` at `:488` | open, cause unverified (D7-P3-3) |
| F4 | `e2e/topology-repairs.e2e.ts:23` (save via `fixtures/gcode-save.ts:31`) | flaky | 1: 43142759469 | — | the save wait | seen once |
| I1 | `electron/native-smoke.test.ts`, `native-smoke-licence-config.test.ts`, `native-smoke-interactive.test.ts`; release test "real nested archives …"; packaging builds | infra | CI 42574102533, 42579786345; pkg 42576861859, 42579786368; re-run 42468622677 | 25 job failures in 14 re-run PR runs, 11-08 12:3x and 11-09 05:00–08:20 | GitHub 504 on the Electron download. `pnpm install` passes, then tests fail with "Electron failed to install correctly" | open (D7-P3-2) |
| I2 | Install Chrome; Prepare the service checks; Install the .deb; commercial rehearsal | infra | 8 (R7) + 42741205784 | 36 PR job failures; 9 re-runs | DNS and apt outage; a Chrome CDN reset | #1781 falls back to the runner's Chrome and installs Chromium without system packages. The .deb jobs still need apt |
| I3 | Every job, 11-05 23:19 → 11-08 | billing | 9 main merges all red | 78 `startup_failure` runs | account billing lock | KNOWN, resolved 11-08 |

**Not flakes** (real guards catching real PR mistakes):
- `src/ui/a11y/button-hover-contract.test.ts` (9 branches);
- `shared-helpers-not-copied.test.ts` (6);
- `check:boot-bundle` (6);
- `check:index-exports` (3).

**Retries.**
- Playwright: `playwright.config.ts:9-24` and `playwright-production.config.ts` set no `retries`, so 0. No spec calls `describe.configure({ retries })`.
- Vitest: `vitest.config.ts:22-41` sets no `retry`, so 0.
- `node --test` suites: none.

## Coverage: CI vs local and events

| Check | PR | Main push | Merge group | Not in CI |
|---|---|---|---|---|
| Static, policy, unit shards, Windows native, phone and MCP (`ci.yml`) | yes | yes | yes | — |
| Browser: checks job (typecheck, discovery, cold start, viewer, production bundle) | yes | yes | yes | — |
| Browser: full suite in 4 shards | **no** | yes | yes | — |
| Browser: 11 core files plus changed specs | yes | no | no | — |
| Linux stable package and launch | yes | yes | yes | — |
| Linux AppImage/.deb and commercial rehearsal | skipped for renderer-only PRs (ADR-647) | yes | yes | — |
| Windows and macOS packaging | no | no | no | release train or manual only |
| Coverage, dependency audit, packaged native smoke | no | no | no | schedule only |
| `scripts/performance-audit/worker-scheduling.test.ts` | — | — | — | **not run** (D6-P3-8, KNOWN) |
| `scripts/performance-audit/interaction.e2e.ts` and its `playwright.config.ts` | — | — | — | not run (manual performance harness; same class) |

- **Required checks** (ruleset 19573147):
  - Lint, typecheck, license, test, build;
  - Chrome UX smoke;
  - Package, check and launch the desktop app;
  - Package, install and launch the Linux AppImage and .deb;
  - Rehearse the commercial Linux build (x64).

  Every check that runs on a PR feeds one of these. The aggregate gates (`ci.yml:220-257`, `e2e.yml:214-253`) run `if: always()` and fail on a skipped or cancelled need. **No required check is missing.** What is missing is a merge queue or the up-to-date rule.
- **Does the "core and changed specs" job run the changed specs?** Yes, and too many of them.
  - Changed specs and specs whose imported helpers changed are found by `--only-changed`. Specs that name a changed fixture are found by `specsNamingChangedFixtures`.
  - App code under `src/` selects almost nothing, because specs drive the app through the browser rather than importing it. That is the R1, R2, R4 and R5 gap (D7-P1-1).
  - Fixture changes over-select (D7-P2-2).

## Findings

### D7-P1-1 — Untested combinations still reach `main` (C1-P1-2 open): no merge queue, no up-to-date rule, and a PR browser smoke that sees no app-code change

- **Where:**
  - ruleset 19573147, rule `required_status_checks`: `"strict_required_status_checks_policy": false`. There is no `merge_queue` rule, and the ruleset was last updated 2026-10-20T17:46+08:00.
  - `e2e.yml:99-101`: the full suite runs only when `github.event_name != 'pull_request'`.
  - `e2e.yml:159-201` with `scripts/run-pr-browser-smoke.mjs:15-27,95-128`: 11 core specs plus `--only-changed`.
- **Anchor:**
  - C1-P1-2 (maintainer decision, not acted on);
  - ADR-645 ("The maintainer turns the queue on");
  - ADR-647 residual risk ("a UI breakage that only a spec outside the core … would catch can merge");
  - AREAS D7 ("pull requests merged onto a red main since C1").
- **Evidence:**
  - **79 %** of 198 merges (156) landed after at least one merge their last CI run never saw: median 3, p90 11, maximum 27.
  - Five real red episodes passed every PR check:
    - R1 #1622: 4 red runs, 10 merges inside;
    - R2 #1668 and #1670+#1672: 6 red runs, 5 merges inside;
    - R3 boot bundle: 42831998778;
    - R4 #1705: 16 red runs, **33 merges in 21.2 h**;
    - R5 #1719: 6 red runs, 4 merges.
  - On 2026-11-12, 06:43:13–06:48:49, **15 PRs merged in 5.5 minutes** (#1786 … #1775), none tested with another.
  - Repo owner type: `gh api users/cisgz3a-hub` → `"type":"User"`.
- **Scenario:**
  - Two PRs that are each green, such as a K40 link store and a machine-work registry, or a toolpath change and a golden test, merge minutes apart.
  - `main` then holds a combination no check ran. A beam- or stop-relevant gap (D4-P1-1 was one) ships to the next release.
  - A spec outside the 11 core files then stays red on `main` for hours while 33 more merges land on top. That hides any second breakage behind the first.
- **Severity:** P1. It lets a job-harming defect reach `main` unchecked: D4-P1-1 reached main this way, and five more defects did this week. This re-raises C1-P1-2 with new evidence.
- **Fix direction (maintainer decision).** Recommendation: options 1 and 3, and option 4 now.
  1. **Merge queue (ADR-645).** If GitHub refuses it on a user-owned repo, move the repository into a free organisation. Then add `merge_queue`: MERGE, ALLGREEN, group size 5, a timeout of at least 90 min. The workflows already run on `merge_group`, and `merge-queue-workflows.test.mjs` pins them.
  2. **If no queue:** turn `strict_required_status_checks_policy` back on. It serialises about 50 merges a day and is costly at the current runner wait.
  3. **Run the right browser specs on a PR.** Map `src/` areas to specs (an import or coverage map), or run the 4-shard suite on PRs that touch `src/` outside the core areas.
  4. **Stop merging onto red now.** Add a small required job: "main's latest completed Browser smoke and CI are not red, or the PR names itself a fix". Add it to the ruleset. This needs no organisation.

### D7-P2-1 — The Abort-promptness browser guard fails whenever the CPU profiler samples a native `toString`

- **Where:** `e2e/run-gcode-file-abort.e2e.ts:189-198` (`wholeProgramPassSamples`), asserted at `:227` and `:263`.
- **Anchor:**
  - performance audit S1-P2-2 and S4 (the guard's purpose);
  - AREAS ("Flaky and timing-based specs").
- **Evidence:**
  - READ: `const counts: Record<string, number> = Object.fromEntries(...)`, then `if (name in counts) seen.add(name)`, then `counts[name] = (counts[name] ?? 0) + 1`.
  - `'toString' in {}` is `true`, so a sampled frame named `toString` is counted as a pass, as the string `"function toString() { [native code] }1"`.
  - `expect(passes).toEqual(NO_PASSES)` then fails.
  - Annotations: "+ "toString": "function toString() { [native code] }1"" in main runs **42665506473** (`42cb2bf50`), **42735497638** (`b43187780`) and **42981447930** (`bf1aaaa1a`, both tests).
  - The file has been unchanged since 2026-11-09 07:10 UTC, so the bug is on main.
- **Scenario:**
  - The check that Ctrl+. stops a large Frame or stream promptly goes red by chance.
  - Main's Browser smoke turns red with no defect, and operators of CI learn to ignore this guard.
  - A real regression of the Abort path, a whole-program pass on the page thread during a stream, then reads as "the usual flake".
- **Severity:** P2. A check gap on a stop rule that already produced 3 false reds on main.
- **Fix direction:**
  - count with a `Map` or `Object.hasOwn(counts, name)`;
  - add a unit test of the counter with a `toString` frame;
  - this is the only such site in `e2e/` (`git grep "name in counts"`).

### D7-P2-2 — The PR browser smoke selector picks most of the suite for a fixture change and runs it unsharded: 2 h 13 m on one runner

- **Where:**
  - `scripts/run-pr-browser-smoke.mjs:45-71`: `namesOf` and `specsNamingChangedFixtures` match bare substrings and cascade through non-spec files;
  - `e2e.yml:159-201`: one job, no shards, no `timeout-minutes`.
- **Anchor:**
  - ADR-647 ("selects most of the suite … That is rare");
  - AREAS ("a #1730 smoke job hung for over 86 minutes").
- **Evidence:**
  - Run 42960008500 (#1730, which changed `e2e/fixtures/document-import-generated/{README.md,generate.mjs,illustrator-3.ai}`) logged "11 core files and 123 more changed since HEAD^1", "Running 476 tests using 1 worker" and "2 failed, 463 passed (2.2h)". The job ran 04:38 → 06:51.
  - #1730's next run (42976306646) took 1 h 53 m.
  - Run 42967704819 (`annoyance-splash-close`) also selected 123 specs and ran 1.7 h.
  - **REPRO** `sel.mjs` on today's `origin/main` `e2e/`: `generate.mjs` alone → **141 of 172 specs**; `illustrator-3.ai` alone → 141, through the folder name and then `generate`; `README.md` → 1.
- **Scenario:**
  - A PR that touches one generated fixture holds one of the 20 runner slots for 2 hours. Every other PR's jobs wait (D7-P2-3).
  - Nothing stops such a job before the 360-min default, and it looks hung.
- **Severity:** P2. It already caused the reported "hang" and two jobs over 100 minutes.
- **Fix direction:**
  - match import specifiers and path or file names with their extension, not bare words; ignore `README*`;
  - stop cascading through generic basenames;
  - when the selection is over about 40 specs, run the 4-shard suite instead;
  - add `timeout-minutes` (D7-P3-1).

### D7-P2-3 — Main is mostly unverified, and its runs queue behind PR runs

- **Where:**
  - `ci.yml:22-24`, `e2e.yml:24-26`, `desktop-package-check.yml:54-60`: one pending run per group, so intermediate main pushes are superseded;
  - main and PR runs share one runner pool with no priority.
- **Anchor:**
  - ADR-647 Context ("the 20 slots");
  - ci.yml's own comment that "the tip always runs";
  - AREAS ("Concurrency cancellations that left main without a completed smoke run").
- **Evidence:**
  - 38 % (Browser smoke) and 47 % (CI) of 196 main commits have a completed run.
  - Streaks of 18–19 commits are open now, since 06:43 UTC, and 12 commits ran 11-11 18:31 → 11-12 00:12 with no Browser smoke.
  - Main CI run 43170112807: created 06:43:16; its unit shards started 06:45–07:25 and the gate at 07:49. That is 66 min before a verdict.
  - Superseded main runs waited up to 45 min pending (42644354930, 43004059740).
  - PR runner wait p90 77–104 min, max 140 min on 11-11/12.
  - PR CI wall time p90 is 139 min, against an execution p50 of about 18 min.
- **Scenario:**
  - A burst of merges leaves the tip with one verdict for many commits. When it is red, the culprit is unknown.
  - R1, R4 and R6 each covered 10–38 merges.
  - A deploy waits on the next CI success. A PR author waits about 2 hours for a result, so agents stack more PRs, which makes the queue longer.
- **Severity:** P2. Real slow and unattributed verdicts this week.
- **Fix direction (maintainer decision on runners and billing).** Recommendation: options 1 and 3.
  1. More capacity for main: larger or paid runners, or a separate runner group.
  2. Cap PR fan-out: a workflow-level concurrency per author, or fewer PR jobs (fold Windows-native and the phone/MCP job into others).
  3. With D7-P1-1's merge queue, main's push runs could drop to the full browser suite plus deploy, since the queue already ran the checks.

### D7-P3-1 — No job in `ci.yml` or `e2e.yml` (or the deploy job) has `timeout-minutes`, and Playwright has no `globalTimeout`

- **Where:**
  - `ci.yml:36,89,153,170,199,220`;
  - `e2e.yml:41,99,159,214`;
  - `deploy.yml:61`;
  - `playwright.config.ts:9-24`.
- **Anchor:** AREAS ("jobs with no time limit").
- **Evidence:**
  - READ: 0 of 10 jobs in those two workflows set a limit, so GitHub's default of 360 min applies.
  - `desktop-package-check.yml` sets one on every job (5–45 min).
  - The longest observed job was 135 min (D7-P2-2). No hang was found, so this is a weakness, not a defect.
- **Severity:** P3.
- **Fix direction:** limits at about 2× p90:
  - unit shards 45;
  - browser shards 75;
  - PR smoke 60, after D7-P2-2;
  - static 30, policy 20;
  - gates 10;
  - deploy 30.

### D7-P3-2 — The unit-test shards and release tests depend on downloading Electron from GitHub, and a failed download surfaces as test failures

- **Where:**
  - `pnpm-workspace.yaml` (`allowBuilds: electron: true`, which runs the postinstall download);
  - `ci.yml:193-197` and `:105-128`;
  - `electron/native-smoke*.test.ts`.
- **Evidence:**
  - Logs 129036395725 and 129017830626 show `HTTPError: Response code 504 (Gateway Time-out) for https://github.com/electron/electron/releases/download/v44.9.1/electron-v44.9.1-linux-x64.zip`.
  - The install step passed. The tests then threw "Electron failed to install correctly".
  - 25 job failures and 14 re-run PR runs on 11-08/09, and main runs 42574102533, 42579786345 and 42468622677.
- **Severity:** P3. Infrastructure; it cost re-runs, and no defect escaped.
- **Fix direction:**
  - cache `~/.cache/electron` keyed by the Electron version (`actions/cache`);
  - or fail the install step when the Electron binary is missing, so the cause is named.

### D7-P3-3 — A workerd MCP test fails at random with "Body is unusable"

- **Where:** `services/remote-control/test/mcp-batch-boundary.test.mjs:438-488`.
- **Evidence:**
  - Main run 42793167503 (`cad881878`).
  - PR run 42736627128: attempt 1 failure, attempt 2 success with no change.
  - `TypeError [Error]: Body is unusable: Body has already been read` at `:488` (`await response.text()`).
- **Severity:** P3. It has a known flake signature; whether the cause is in the test or the service is unverified.
- **Fix direction:** find who reads the body first (the `post` helper or a stream tee). Assert on the status and body once.

### D7-P3-4 — Browser shards are split by test count, not time; shard 4 runs 13 minutes shorter

- **Where:** `e2e.yml:105-109,146`.
- **Evidence:** p50 shard (3/4) 38.2 min against (4/4) 25.2 min, over 69 and 67 runs. Main's browser verdict waits on the slowest shard.
- **Severity:** P3.
- **Fix direction:**
  - move the slow responsiveness or worker specs evenly, or tag them and split them explicitly;
  - or use 5 shards.

### D7-P3-5 — The CI browser version is not pinned and changes under the suite

- **Where:**
  - `playwright.config.ts:21` (`channel: 'chrome'`);
  - `e2e.yml:60-72,126-138,183-195`: since #1781, the runner image's Chrome is used whenever install fails.
- **Evidence:**
  - Chrome 157.0.8103.50 ran in runs 42814761574, 42995866277 and 43077807767, and 157.0.8103.78 in 43125597328, with no repo change.
  - The fallback logs `google-chrome --version` but does not fail on a mismatch.
- **Severity:** P3. Not the cause of F1 (see Refuted); it is a reproducibility gap for timing guards.
- **Fix direction:** record the Chrome version in the readiness report. Pin `chromium` at the Playwright revision for timing guards, or warn when the fallback Chrome differs from the expected major version.

## KNOWN (not re-raised)

- **C1-P1-1** (main red at `f61a0757a`): fixed by #1677. It is R2 above.
- **C1-P1-2** (no merge queue): open, and **re-raised as D7-P1-1** with this week's evidence and the user-account blocker.
- **ADR-647 residual risk, ADR-206 decision:** Browser smoke does not gate the web deploy. 27 deploys went out with main's Browser smoke red, including R2's duplicate status role from #1668. This is still the maintainer's decision. Recommendation: gate deploy on Browser smoke once D7-P2-3's capacity allows, or at least block the deploy when the tip's Browser smoke is red on a spec failure (not infrastructure).
- **D6-P3-8:** `scripts/performance-audit/worker-scheduling.test.ts` runs in no CI job. `interaction.e2e.ts` in the same folder is a manual harness.
- **Billing lock and private-repo outage, 2026-11-05..08:** 78 `startup_failure` runs. Resolved.
- **2026-11-11 DNS outage:** #1781 added a fallback for Chrome and the service browser.
- **Camera overlay guard:** #1808 (ADR-598 Amd 7). On CI it judges by camera share of the profile; locally it keeps the strict 50 ms.
- **D4-P1-1 (K40 vs #1753 registry):** fixed by #1818. Used here only as untested-merge evidence.

## Refuted

- **"The camera guard broke on Chrome 157."** Chrome 157.0.8103.50 ran both green runs (43077807767 at `d52c2856b`, 43000478403) and red runs (42995866277). #1808's CPU profile found the long tasks were the job's own renders on a GPU-less runner. It failed or passed by chance, not because of the browser version.
- **"A #1730 Chrome UX smoke job hung for 86+ minutes."** It was not hung. It ran 476 tests for 2 h 13 m and failed on 2 real failures: the R5 dither count and F1. The cause is over-selection (D7-P2-2).
- **"Concurrency cancellation cancelled about 6 main runs in a row."** It is worse, by a different mechanism. Main has `cancel-in-progress: false`. The cancelled runs are pending runs GitHub superseded, so they never started. Streaks reach 18–19 commits (D7-P2-3).
- **"The #1705/#1719 breakage was flaky."** Both were deterministic stale specs, red on every run until #1730 and #1728.
- **"Runs were cancelled by timeout."** None in the sample. `ci.yml` and `e2e.yml` set no timeouts, and no desktop-package job reached its own.

## Verified clean

- **Gates:** `ci` and `chrome` fail on any skipped or cancelled need, except the one suite job the event does not use. A cancelled shard cannot pass a required check. `scripts/ci-parallel-gate.test.mjs` pins this.
- **Required checks:** all five exist and are produced by every PR event. No PR check is outside them.
- **Merge-queue readiness:** `merge_group` triggers are on `ci.yml:9`, `e2e.yml:15` and `desktop-package-check.yml:35`, pinned by `merge-queue-workflows.test.mjs`.
- **No retries** anywhere, so no flake is masked.
- **Unit shards** are balanced (17–19 min p50, n of about 190 each), and their run time is stable (p90 22 min).
- **Coverage of tests:** `src/**` and `electron/**` Vitest; all `scripts/*.test.mjs`, `services/desktop-licensing`, `scripts/download-stats` and `scripts/eslint` through `test:release-integrity`; `services/remote-control/test` through `check:remote-control`; `website/tests` through `website:test`. Only the D6-P3-8 class is outside.
- **Real guards catching real PR mistakes**, not flakes: `button-hover-contract.test.ts` (9 branches), `shared-helpers-not-copied.test.ts` (6), `check:boot-bundle` (6) and `check:index-exports` (3).
- **Current state:** main's latest completed runs at `a74e38540` are green (CI 43161455984, Browser smoke 43161455691), and `e3e578a8b`'s Browser smoke is green. CI is not broken now. CI for the 06:43 burst was still in progress at 07:49.

## Not verified

- **Merge queue availability for a user-owned repository.** GitHub's documentation limits the merge queue to organisation-owned repositories. I did not open Settings; the owner should confirm whether it can be enabled on `cisgz3a-hub/KerfDesk`.
- **The runner limit of 20 concurrent jobs.** This comes from ADR-647's text, not the API. The observed waits fit it.
- **Whether F1 is now stable:** only 2 main Browser smoke runs completed after #1808.
- **F3's root cause** (test or service race).
- **PR duration percentiles** are a sample of the latest 60 successful runs per workflow, biased toward the 2026-11-11/12 peak. Main-push numbers cover every completed run.
- **Why each PR run was cancelled:** a new push or a manual cancel; the API does not say.

## Repro and data files

Folder: `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d7\`.
- **Raw data:**
  - `runs.jsonl` and `runs-uniq.json`: all runs;
  - `jobs.json`: jobs of 579 runs;
  - `reruns.json`: earlier attempts;
  - `main-failures.json` and `main-fail-class.json`: main failures with annotations and their class;
  - `pr-failures.json`;
  - `prs-merged.json`, `ruleset-main.json`, `rulesets.json`;
  - `main-timeline.json` and `main-timeline.txt`: per-commit main verdicts;
  - `logs\`: failed job logs;
  - `wf\`: the workflows at `dd8cf6e54`;
  - `tree\`: the `e2e/` archive.
- **Scripts** (`..\zz-d7-scripts\`):
  - `a1.js` and `a2.js`: summaries and timeline;
  - `fetchjobs.js`, `attempts.js`, `mainfail.js`, `prfail.js`: read-only fetchers;
  - `classify.js`, `redwin.js`, `jobstats.js`: analysis;
  - `sel.mjs`: the D7-P2-2 repro. Run `node sel.mjs <tree>`.

No security findings.

```json
[
  {"id":"D7-P1-1","severity":"P1","area":"ci-health","file":"ruleset 19573147 (required_status_checks)","line":null,"anchor":"C1-P1-2; ADR-645; ADR-647 residual risk","evidence":"READ+RUNS","known":true,"maintainer_decision":true,"runs":[42560980577,42665506473,42693573999,42831998778,42814761574,42881468988],"summary":"strict_required_status_checks_policy false and no merge_queue (unchanged since 2026-10-20; owner is a User account, merge queue may be unavailable); 79% of 198 merges landed on combinations their CI never saw; PR browser smoke selects no spec for src/ changes; 5 real red episodes (R1-R5) passed every PR check; R4 stayed red 21.2 h under 33 merges"},
  {"id":"D7-P2-1","severity":"P2","area":"ci-health","file":"e2e/run-gcode-file-abort.e2e.ts","line":196,"anchor":"perf audit S1-P2-2/S4 Abort promptness guard","evidence":"READ+RUNS","known":false,"runs":[42665506473,42735497638,42981447930],"summary":"'name in counts' matches inherited toString, so a profiler sample in a native toString fails expect(passes).toEqual(NO_PASSES); 3 false reds on main"},
  {"id":"D7-P2-2","severity":"P2","area":"ci-health","file":"scripts/run-pr-browser-smoke.mjs","line":57,"anchor":"ADR-647 'that is rare'; AREAS #1730 86-min job","evidence":"REPRO+RUNS","known":false,"runs":[42960008500,42976306646,42967704819],"summary":"substring name matching cascades: one fixture change selects 141/172 specs on main; #1730 ran 476 tests unsharded for 2 h 13 m (the reported hang)"},
  {"id":"D7-P2-3","severity":"P2","area":"ci-health","file":".github/workflows/ci.yml","line":22,"anchor":"ADR-647 20 slots; ci.yml concurrency comment","evidence":"RUNS","known":false,"maintainer_decision":true,"runs":[43170112807,42644354930,43004059740],"summary":"only 38% (Browser smoke) / 47% (CI) of 196 main commits get a completed run; streaks of 18-19 open now; main CI 66 min to verdict; PR runner wait p90 77-104 min, max 140"},
  {"id":"D7-P3-1","severity":"P3","area":"ci-health","file":".github/workflows/e2e.yml","line":159,"anchor":"AREAS jobs with no time limit","evidence":"READ","known":false,"summary":"0 of 10 jobs in ci.yml/e2e.yml (and deploy) set timeout-minutes; default 360 min; no Playwright globalTimeout"},
  {"id":"D7-P3-2","severity":"P3","area":"ci-health","file":".github/workflows/ci.yml","line":193,"anchor":"infra reliability","evidence":"RUNS","known":false,"runs":[42574102533,42579786345,42468622677],"summary":"unit shards depend on the Electron download from GitHub; a 504 passes install then fails electron/native-smoke*.test.ts; 25 job failures, 14 re-runs"},
  {"id":"D7-P3-3","severity":"P3","area":"ci-health","file":"services/remote-control/test/mcp-batch-boundary.test.mjs","line":488,"anchor":"flake","evidence":"RUNS","known":false,"runs":[42793167503,42736627128],"summary":"workerd near-limit batch test fails at random with 'Body is unusable: Body has already been read'"},
  {"id":"D7-P3-4","severity":"P3","area":"ci-health","file":".github/workflows/e2e.yml","line":109,"anchor":"shard balance","evidence":"RUNS","known":false,"summary":"browser shard p50 38.2 min (3/4) vs 25.2 min (4/4); split by count, not time"},
  {"id":"D7-P3-5","severity":"P3","area":"ci-health","file":"playwright.config.ts","line":21,"anchor":"reproducibility","evidence":"RUNS","known":false,"runs":[42995866277,43077807767,43125597328],"summary":"CI Chrome unpinned (channel chrome; #1781 falls back to the runner image); 157.0.8103.50 -> .78 mid-week with no repo change"}
]
```

Auditor counts: raised 9, P1 1, P2 3, P3 5, known 7

## Refuter (2026-11-12)

**Tree and data.**
- `origin/main` @ `a0891e76a` (fetched 08:18 UTC), read-only through `git show`, `git log`, `git diff` and a `git archive` of `e2e/` plus `scripts/run-pr-browser-smoke.mjs` into `zz-d7r\tree\`.
- The auditor's raw `runs-uniq.json`, `jobs.json` and `prs-merged.json` were reused. Every key number was recomputed with my own scripts in `..\zz-d7r-scripts\` (`untested.js`, `untested2.js`, `maincov.js`, `sel2.mjs`, `counts.mjs`).
- Fresh read-only `gh` calls:
  - ruleset 19573147, `rules/branches/main`, `branches/main/protection`, `users/cisgz3a-hub`;
  - `pr view` file lists for #1622, #1668, #1705, #1719, #1670, #1672, #1677, #1646, #1728, #1730, #1713, #1724 and #1753;
  - job lists and annotations for the cited runs;
  - 13 job logs: the four PR smoke selections, four shard-1 Chrome version logs, four checkout logs and one re-run attempt.
- GitHub docs were read from the `github/docs` source (`data/reusables/gated-features/merge-queue.md`) and the 2023-07-12 GA changelog.
- Nothing was re-run, cancelled, dispatched or changed. No pnpm, no build.

### Verdicts

| Finding | Verdict | Severity |
|---|---|---|
| D7-P1-1 | **CONFIRMED**, with corrected evidence | P1 |
| D7-P2-1 | **CONFIRMED** (mechanism reproduced) | P2 |
| D7-P2-2 | **CONFIRMED** (141/172 reproduced on a newer main) | P2 |
| D7-P2-3 | **CONFIRMED**; one cancelled run is not "superseded while pending" | P2 |
| D7-P3-1 | CONFIRMED | P3 |
| D7-P3-2 | CONFIRMED | P3 |
| D7-P3-3 | CONFIRMED | P3 |
| D7-P3-4 | CONFIRMED | P3 |
| D7-P3-5 | CONFIRMED | P3 |
| Refuted list | all 5 upheld | — |

#### D7-P1-1: CONFIRMED P1

**Ruleset (own call, 08:2x UTC).**
- `strict_required_status_checks_policy: false`.
- Rules are `deletion`, `non_fast_forward`, `pull_request` and `required_status_checks`. There is no `merge_queue` rule.
- `updated_at 2026-10-20T17:46:09+08:00`, and `bypass_actors` is empty.
- `rules/branches/main` returns the same four rules, and classic branch protection returns 404, so nothing else applies.
- The repository is public. Its owner type is `User`.
- `allow_update_branch: false`, so the "Update branch" button is off.

**Untested combinations, recomputed with my own method.**
- Method: for each merged PR, take its last `pull_request` run on the final head SHA and find the main tip at that run's creation (first-parent history, by commit time). Then count the first-parent commits between that tip and the merge commit's first parent.
- I validated the method against the actual `HEAD is now at … Merge <head> into <base>` lines in 4 checkout logs (#1724, #1753, #1672, #1711). It matched all 4 exactly.
- Results:
  - **156 of 197 merges (79.2 %)** landed after at least one merge their last CI never saw.
  - The figure is identical for CI, Browser smoke and Desktop package check, since all three runs are created by the same push.
  - Over all merges: median 3, p90 11, max 27.
  - Over the 156 affected merges only: median **4**, p90 **13**, max 27. The report's "median 3, p90 11" is over all merges, not the affected ones.
  - My window holds 197 merges, not 198. That is immaterial.
  - Code-on-code: **107 of 197 (54 %)** were non-docs PRs that landed on at least one unseen non-docs merge.
  - The 15-merge burst is confirmed: 06:43:13–06:48:49, #1786 … #1775.

**Correction to "Untested merges this week" (K40 vs #1753).**
- The actual tested base of **#1724** was `c3856ce06`, not `6ce535a26`. Both PRs were tested on `c3856ce06`.
- They merged after **4 and 7** unseen merges, not 9 and 11.
- The conclusion does not change.

**Merge queue availability: VERIFIED, no longer "Not verified".**
- GitHub's docs source (`data/reusables/gated-features/merge-queue.md`) says merge queues "are available in any public repository owned by an organization", or in private repositories owned by organisations on Enterprise Cloud.
- The 2023 GA changelog says the same. Personal-account repositories are not eligible, so ADR-645's "maintainer turns the queue on" cannot happen on `cisgz3a-hub/KerfDesk` as owned today.

**Is "transfer to an org" or a "red-main gate job" the realistic fix?**
- **Transfer to a free organisation is the only route to a real queue.** It works only while the repository stays **public**: a private org repository needs Enterprise Cloud.
  - This repository went private during 2026-11-05..08. If that happens again, the queue disappears.
  - A transfer is a one-time owner action: rulesets, secrets and Pages environments move with it, and app installations and links need checking (not verified).
- **Option 2 (strict up-to-date) is impractical here.** GitHub auto-merge does not update a behind branch, and `allow_update_branch` is false. With about 50 auto-merged PRs a day, every PR would stall until an agent rebases it, and each rebase re-queues a 1–2 h CI run at today's runner wait.
- **Option 4 as written ("a small required job that checks main's latest verdict") does not work alone.** A PR's check runs once, at its own push. A PR that went green before main went red keeps its stale green and still merges.
  - A version that does work on a User repository: a `workflow_run` job on main's CI and Browser smoke completion writes a commit status, such as `main-is-green`, onto every open PR head. Make that context required.
  - This stops piling merges onto a red main. It does **not** test combinations, so it is a mitigation next to the transfer, not a replacement.

**PR smoke blind to `src/`: confirmed from the real job logs, not only by reproduction.** The selection line of each PR's "Chrome UX smoke (pull request core and changed specs)" job:

| PR | Run | Selection | Failing spec selected? |
|---|---|---|---|
| #1622 | 42475416423 | "11 core files and 1 more" (`laser-lead-start-reseed`) | no (`gcode-viewer-stock`) |
| #1668 | 42655781779 | "11 core files and 0 more" | no (`workspace-responsive`) |
| #1705 | 42810223314 | "11 core files and 0 more" | no (`document-import-acceptance`) |
| #1719 | 42877609238 | "11 core files and 4 more" (`artwork-panel-refresh`, `focus-test`, `installed-app-file-io`, `laser-lead-start-reseed`) | no (`artwork-field-rows`) |

- None of the four PRs changed a file under `e2e/`, so `specsNamingChangedFixtures` returns nothing.
- Nuance: 79 `e2e/` files do import `../src/…` (161 import lines, 37 of them `src/core/scene`). The selection stays tiny because most of those imports are `import type`, which the transform drops, so `--only-changed` never sees them.
  - Example: #1719 changed `src/core/scene/project.ts`, `layer.ts` and `scene-object.ts` and still selected only 4 extra specs.

**Severity basis, corrected.** The report treats R1–R5 as five job-harming defects. By their fixes:

| Episode | Fix | What it was | Job-harming? |
|---|---|---|---|
| R2 (CI part, #1670 + #1672) | #1677 changed `src/core/output/rotary-surface-feed.ts`: "rotary feed follows the taper" | a product defect in the rotary feed | **yes** |
| R1 | #1646 changed `src/ui/gcode-inspector/stock-design-target.ts` and `relief-object-to-heightmap.ts` | a false "Cut too deep" warning in the Inspector | no; user-facing, wrong advice |
| R4 | #1730: e2e only | a stale spec | no |
| R5 | #1728: e2e only | a stale spec | no |
| R3 | #1713 | a boot-bundle baseline | no |

- R2's rotary feed reached main from an untested combination: #1672 was tested 1 merge behind (gap 1). A merge queue would have run the CI unit tests that went red on main.
- With D4-P1-1 as the second instance, **P1 stands**. Its main leg is the queue and up-to-date gap.
- The `src/`-blind PR smoke leg on its own produced main reds and blocked attribution, not escaped job defects. Taken alone it would be P2.

#### D7-P2-1: CONFIRMED P2

- **Spec on current main.** `e2e/run-gcode-file-abort.e2e.ts:189-201` on `a0891e76a` is unchanged since `43c2b694f` (2026-11-09 15:10 +08). It has `if (name in counts) seen.add(name)` and `counts[name] = (counts[name] ?? 0) + 1`.
- **Node proof** (`zz-d7r-scripts\counts.mjs`, the same code with a sampled stack `[…,'toString']`):
  - it returns `{"passes":{…,"toString":"function toString() { [native code] }1"},"probe":1}`;
  - a deep-equal check against `NO_PASSES` is false;
  - with `Object.hasOwn(counts, name)`, `toString` is not matched.
- **Inherited names that match the same way:** `constructor`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` and `__proto__`.
  - A sampled frame named `__proto__` would run the setter on `counts`, a worse corruption.
- **Annotations, own calls.** Each run is a main push.

| Run | Commit | Test | Annotation |
|---|---|---|---|
| 42665506473 | `42cb2bf50` | `:206` (Frame), asserted `:227` | `+ "toString": "function toString() { [native code] }1"` |
| 42735497638 | `b43187780` | `:232` (stream), asserted `:263` | same |
| 42981447930 | `bf1aaaa1a` | both tests | same |

- **Only site.** `git grep` for `name in counts`, and a broader scan for `x in y)` lookups in `e2e/` and `scripts/performance-audit`, finds this one site.

#### D7-P2-2: CONFIRMED P2

- **Reproduced on the newer tree.** I imported main's own `specsNamingChangedFixtures` from `scripts/run-pr-browser-smoke.mjs` @ `a0891e76a` and ran it on my own walk of `e2e/`.
- On 172 spec files and 231 text files:

| Changed file(s) | Specs selected |
|---|---|
| `generate.mjs` | **141** |
| `illustrator-3.ai` | **141**: level 1 finds `document-import-acceptance`, `document-import-browser.ts` and `generate.mjs`, then cascades on "generate" |
| `README.md` | 1 |
| all three | 141 |

- **Every non-spec file changed alone** (59 files): median 2 specs. Six files select 108 or more:
  - `generate.mjs`, `png-fixture.ts` and `startup-splash.ts`: 141 each;
  - `browser-apis.js` and `kerfdesk-test.ts`: 140 each;
  - `workspace-ui.ts`: 108.
- **Some of that selection is legitimate.** Every spec imports `kerfdesk-test.ts`. The over-selection is the bare-substring cascade, as on `generate.mjs`, `png-fixture` and `startup-splash`.
- **#1730 job, own check.**
  - Log: "11 core files and 123 more", "Running 476 tests using 1 worker", "2 failed" and "463 passed (2.2h)".
  - Job timing:

| Run | Started | Finished | Run time |
|---|---|---|---|
| 42960008500 (#1730) | 04:37:13 | 06:51:52 | 2 h 15 m |
| 42967704819 (`annoyance-splash-close`) | 05:44:24 | 07:30:54 | 1 h 46 m |

  - These are the only two jobs over 60 min in `jobs.json` (own scan).

#### D7-P2-3: CONFIRMED P2

**Recomputed** (`maincov.js`, 196 main first-parent commits, 2026-11-08 09:00 → 2026-11-12 07:48 UTC):

| Workflow | Commits with a completed run | Longest streak | Streak open at end | Runs: success / failure / cancelled |
|---|---|---|---|---|
| CI | 92 (46.9 %) | 19 | 19 | 84 / 8 / 102 |
| Browser smoke | 74 (37.8 %) | 18 | 18 | 41 / 33 / 120 |
| Desktop package check | 113 (57.7 %) | 18 | 18 | 108 / 5 / 81 |

- **Main red time, recomputed two ways.**
  - Verdict-time model: Browser smoke 43.4 h, CI 11.8 h, Desktop package check 6.6 h. These match the report.
  - Commit-time model: 43.9 h, 10.8 h and 5.3 h.
- **Main CI run 43170112807:** created 06:43:16, gate finished 07:49:42, so 66 min. Its jobs started between 06:45:32 and 07:25:37. Confirmed.
- **Runner wait by day** (own pass over `jobs.json`, non-skipped jobs):

| Day | n | p50 | p90 | max |
|---|---|---|---|---|
| 2026-11-11 | 1,128 | 9.7 | 77.2 | 139.7 |
| 2026-11-12 | 710 | 13.0 | 78.8 | 123.1 |

  - PR unit shards on 11-11/12: p90 106 min, max 129 min.
  - These agree with the report within sampling.
- **Superseded versus cancel-in-progress: correctly distinguished.**
  - On main, `ci.yml:24` and `e2e.yml:26` set `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, so main runs are never cancelled in progress.
  - 302 of 303 cancelled main runs in the window had `run_started_at` equal to `created_at`.
  - In a 15-run sample, 14 have **0 jobs**, so they never started. That includes 42644354930 and 42981447782.
- **One exception: 43086100301** (Browser smoke, `93c880722`). It was a **manual re-run, attempt 2**, of a finished run:
  - Attempt 1 failed shard 1/4 on F1, `camera-overlay-mjpeg-ui-thread.e2e.ts:311`.
  - Attempt 2 re-ran shard 1, which passed, and the gate passed at 01:47:37. The run still ended as `cancelled`.
  - See D7-P3-6.
- **Effect on the coverage numbers.** That commit did have a completed red verdict, so Browser smoke coverage is 75/196 (38.3 %). Still 38 %.

#### P3s

- **D7-P3-1: CONFIRMED.**
  - Jobs at `ci.yml:36,89,153,170,199,220` and `e2e.yml:41,99,159,214` have 0 `timeout-minutes`.
  - `deploy.yml` has one, at `:331` on `payment-settings`. The `deploy` job (`:61`) has none.
  - `desktop-package-check.yml` has 8 timeouts.
  - `playwright.config.ts` has no `globalTimeout` and no `retries`, and `workers: 1`. `vitest.config.ts` has no `retry`.
- **D7-P3-2: CONFIRMED.** Log `59d66bb86-129036395725.txt` shows `HTTPError: Response code 504 (Gateway Time-out) for …electron-v44.9.1-linux-x64.zip`.
- **D7-P3-3: CONFIRMED.**
  - Run 42793167503 (CI, `cad881878`, push) logged `TypeError [Error]: Body is unusable: Body has already been read` at `mcp-batch-boundary.test.mjs:488:48`, in the `:438` test.
  - Line 488 is `results(await response.text())` on current main.
- **D7-P3-4: CONFIRMED.** Main shard p50 (own): 1/4 35.2 (n 53), 2/4 36.3, 3/4 38.2 and 4/4 25.2 min.
  - Shard 1 has fewer successes because F1 lives there.
- **D7-P3-5: CONFIRMED.** Shard-1 logs show:

| Run | Chrome | Result |
|---|---|---|
| 42995866277 | 157.0.8103.50 | F1 failed at `:311` |
| 43000478403 | 157.0.8103.50 | green |
| 43077807767 | 157.0.8103.50 | green |
| 43125597328 | 157.0.8103.78 | F1 failed |

#### Refuted list: all upheld

- **"Chrome 157 caused it": refuted.** The same 157.0.8103.50 produced both a red F1 (42995866277) and green shard-1 runs (43000478403, 43077807767), and .78 was also red.
- **"#1730 hung": refuted.** It ran 476 tests for 2 h 15 m and finished.
- **"Cancel-in-progress on main": refuted.** See the D7-P2-3 config and the 0-job runs.
- **"#1705/#1719 were flaky": refuted.** Both were fixed by spec-only PRs (#1730, #1728).
- **"Timeout cancellations": refuted.** None found.

#### Other corrections

- **F1 has 10 red main runs, not 9.** Add 43086100301 attempt 1, which the latest-attempt run list hides.
- **"No flake is hidden" is true only for automatic retries.** A manual "re-run failed jobs" on main hid that one.
- **KNOWN deploy count.** I count 32 successful deploys in the window. 23 (latest Browser smoke verdict red at deploy time) to 25 (nearest verdict at or after the deployed commit red) went out on red, not 27. Either way the KNOWN item stands.

### New findings

#### D7-P3-6 — A manual re-run of failed jobs on `main` replaces a red Browser smoke verdict, and the run history then shows no failure

- **Where:** process. Main runs 43086100301 (`93c880722`, 2026-11-11 19:19 → 2026-11-12 01:47 UTC).
- **Evidence:**
  - Attempt 1: shard 1/4 failed F1 `:311`, and the artifact upload also failed ("Failed to CreateArtifact … Unexpected token '<'").
  - Attempt 2 (re-run failed jobs, 23:43) passed shard 1, and the gate passed. The run's final conclusion is `cancelled`.
  - The runs list and the Actions UI show only the latest attempt. This audit's own dataset therefore missed the red: F1 has 10 main reds, not 9.
  - 7 main runs in the window are re-run attempts: 42468622677, 42468622656, 42566329409, 43086100301 and 43043176732/761/628.
- **Severity:** P3. It is structural, and the failure was a known flake. But a re-run on main can erase the only red verdict of a real intermittent defect.
- **Fix direction:**
  - re-run main jobs only for named infrastructure causes;
  - have the red-time and flake tooling read `actions/runs/{id}/attempts/{n}`, not the latest attempt.

### Current state (08:26 UTC)

- **The latest completed main verdicts are green.**
  - CI 43170112807 and Browser smoke 43170112541 at `e3e578a8b` (06:43);
  - Desktop package check 43173816465 at `d7e55dd71`.
- **Nothing is red now, and CI is not broken.**
- **24 first-parent commits since `e3e578a8b` have no verdict.**
  - CI 43177969096 for `58ab6dc87`, 19 commits on, has been in progress since 07:48.
  - Browser smoke for `58ab6dc87` (43177969118) was superseded while pending, after 17 min.
  - Runs for the tip `a0891e76a` are pending.
- **The temporary workflows** `nesting-diag.yml` and `zz-stall-probe.yml` are still registered as active, but neither file is on main and neither has run since 2026-11-02. No finding.

### Not verified

- The consequences of a transfer to an organisation: app installations, Cloudflare and other secrets, desktop update URLs and redirects.
- Why 43086100301 attempt 2 ended `cancelled` after its gate passed.
- The tested base of every PR. My date method matched 4 of 4 checkout logs; the other 193 were not checked against logs.
- F1's stability after #1808. Too few runs.
- F3's root cause.

```json
{"refuter":"D7","date":"2026-11-12","tree":"origin/main a0891e76a","verdicts":[
 {"id":"D7-P1-1","verdict":"CONFIRMED","severity":"P1","recomputed":{"merges":197,"unseen_merge_any":156,"pct":79.2,"median_all":3,"p90_all":11,"median_affected":4,"p90_affected":13,"max":27,"code_on_code":107},"corrections":["#1724 tested base c3856ce06 not 6ce535a26; unseen merges 4 and 7 not 9 and 11","only R2 (#1670+#1672 rotary feed, fixed in src by #1677) is a job-harming product defect; R4/R5 were spec-only, R1 an Inspector false warning, R3 a baseline","merge queue unavailable for User-owned repos (docs gated-features/merge-queue.md): VERIFIED","option 2 stalls auto-merge (allow_update_branch false); option 4 needs a status pushed to open PR heads, a PR-time check goes stale"],"runs":[42475416423,42655781779,42810223314,42877609238]},
 {"id":"D7-P2-1","verdict":"CONFIRMED","severity":"P2","runs":[42665506473,42735497638,42981447930],"note":"Node repro; __proto__ and other Object.prototype names also match"},
 {"id":"D7-P2-2","verdict":"CONFIRMED","severity":"P2","recomputed":{"generate.mjs":141,"illustrator-3.ai":141,"README.md":1,"specs":172,"files_over_100":6}},
 {"id":"D7-P2-3","verdict":"CONFIRMED","severity":"P2","recomputed":{"ci_completed":92,"bs_completed":74,"dpc_completed":113,"commits":196,"ci_streak":19,"bs_streak":18,"red_h_bs":43.4,"red_h_ci":11.8},"note":"302/303 cancelled main runs never started; 43086100301 was a manual re-run"},
 {"id":"D7-P3-1","verdict":"CONFIRMED","severity":"P3"},
 {"id":"D7-P3-2","verdict":"CONFIRMED","severity":"P3"},
 {"id":"D7-P3-3","verdict":"CONFIRMED","severity":"P3"},
 {"id":"D7-P3-4","verdict":"CONFIRMED","severity":"P3"},
 {"id":"D7-P3-5","verdict":"CONFIRMED","severity":"P3"}],
 "new":[{"id":"D7-P3-6","severity":"P3","area":"ci-health","file":"process (main re-runs)","line":null,"evidence":"RUNS","known":false,"runs":[43086100301],"summary":"manual re-run of failed main jobs replaced an F1 red verdict; run list shows only the latest attempt, so F1 has 10 main reds, not 9"}],
 "current_state":{"main_tip":"a0891e76a","last_completed":"e3e578a8b green (CI 43170112807, BS 43170112541)","unverified_commits":24}}
```

Refuter counts: raised 10, refuted 0, P1 1, P2 3, P3 6, known 7
