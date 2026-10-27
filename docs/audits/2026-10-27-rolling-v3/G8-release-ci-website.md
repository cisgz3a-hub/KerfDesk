# Rolling audit v3 — Release, CI and website

- **When:** 2026-10-27 10:30–11:20 +0800 (02:30–03:20Z)   **Tree:** origin/main @ `9a2bf6b13` (worktree HEAD `231779dcb`; `git diff 9a2bf6b13 HEAD -- . ':!docs'` is empty)
  - Live GitHub state was read with GET calls on 2026-10-27 between 02:40Z and 03:15Z: the repository, both rulesets and their history, the rule-suite log, environments, secret and variable names, workflow runs and jobs, check-run annotations and PR check rollups. No secret value was read.
  - The live kerfdesk.com pages (`/download`, `/pricing/`, `/privacy/`) and the dl.kerfdesk.com pointers were fetched in the same hour. The three pages are byte-identical to `public/` on the audited tree.
- **Scope:** `.github/**`, `scripts/**`, `website/**`, `electron-builder*.yml`.
  - `git log --first-parent --since=2026-10-21T00:00 9a2bf6b13 -- <paths>` lists 16 merges, and each diff was read in these paths.
    - **Ten after the rolling v2 trees** (`2c8d988db` for report 11, `902f1d0c0` for report 22):
      - #1339 (secret environments, ADR-651);
      - #1355 (website Pro list, privacy and `check:public-info`);
      - #1358 (Ostromoukhov notice);
      - #1346 (`no-raw-project-set-state` lint rule);
      - #1394 (one Free-build boundary line);
      - #1407 (upgrade harness);
      - #1427 (ADR amendment keys);
      - #1428 (release delivery browser);
      - #1429 (dither count copy);
      - #1431 (path-order audit scripts).
    - **Six already in those trees, re-read for L8:** #1321, #1323 (ADR-017 Amd 2), #1287, #1330, #1324 (ADR-647) and #1335.
  - **Releases:** seven, not three. 1.0.21 (`faf5a54f1`), 1.0.22 (`b9202d5aa`) and 1.0.23 (`87ecb4f24`), then 1.0.24 (`a9ad5080c`), 1.0.25 (`19ff6042a`), 1.0.26 (`19aba0456`) and 1.0.27 (`adf300522`). The last four were manual `release_now` dispatches on 2026-10-24 and 2026-10-25. `dl.kerfdesk.com/desktop/commercial-manual/latest.json` signs 1.0.27 from `adf300522`.
  - **This week's CI incident:** reconstructed from runs, jobs, annotations, the rule-suite log and PR rollups.
  - **Governing ADRs:** ADR-621; ADR-647; ADR-651; ADR-557; ADR-360; ADR-561 Amd 4; ADR-613; ADR-524 Amd 1 and Amd 3; ADR-540 Amd 5; ADR-017 Amd 2; ADR-344 (the ADR gate).
- **Lenses run:** L8 (main), L5, L1.
  - L2 only for GitHub's environment and ruleset availability by plan (cited below).
  - L4 only for the ADR gate's inputs.
  - L3, L6 and L7 were not assigned. Two of their questions were checked anyway:
    - the failure path of the four failed release dispatches;
    - whether the CI and `release:check` gates agree.
- **Counts:** 3 raised → 0 refuted → P1 0 / P2 0 / P3 3 (+ 9 KNOWN re-observed). Refuter: 3 CONFIRMED, 0 PLAUSIBLE; no severity change.

## Headline

The release and web-deploy gates held through this week's CI outage. Each one tests the exact main commit it ships. Deploy was skipped on all four red main commits, no release ran, and every one of the seven releases came from a commit whose three workflows were all green.

The merge gate did not hold. Two pull requests reached main with every required check failed, and nothing in the repository noticed (G8-P3-1):
- On 2026-10-26 the repository was private on a GitHub Free account, so the "Protect main branch" ruleset was not evaluated.
- #1442 and #1444 merged with all five required contexts FAILURE. The rule-suite log has no entry for either push, while every other main push that week shows "pass".
- Main stayed red for about 10.5 hours, until #1449.

Two smaller gate gaps were found:
- The `check:public-info` freshness check added by #1355 is missing from `release:check`, which is the gate a manual deploy runs (G8-P3-2).
- #1427's amendment-number check misses amendments written as headings inside a decision file or DECISIONS.md (G8-P3-3).

For the maintainer: by ADR-647's accepted design, Browser smoke does not gate the web deploy. This week six deploys published commits whose main Browser smoke run had failed (see Verified clean).

## Findings

### G8-P3-1 — Only the GitHub ruleset stops a merge without checks, and nothing notices when it is not enforced: #1442 and #1444 merged on 2026-10-26 with every required check failed

- **Where:**
  - Live ruleset `19573147` "Protect main branch". Its five `required_status_checks` contexts are the only merge gate, with `strict_required_status_checks_policy: false` and `required_approving_review_count: 0`. Branch protection is not used (`branches/main/protection` was already 404 in rolling v2).
  - No workflow re-checks a merged pull request.
  - `scripts/unsigned-release-plan.mjs:145-187`: `mergedPullRequestsSince` enumerates the release batch's PRs by merge commit (`:174-179`) and never reads their checks.
  - Repository settings: `allow_auto_merge: true`; the agents' standing rule merges with `gh pr merge --auto`.
- **Anchor:**
  - **Contract:** ADR-621 Decision, bullet 1: "Main's active ruleset requires the CI aggregate, browser aggregate and `Desktop packaging gate` …". Its Context names the maintainer's request that "every applicable CI check, including desktop packaging, pass before a PR can merge".
  - **Ground truth:** GitHub enforces rulesets on private repositories only on paid plans. The coordinator's incident note (ruleset API 403 while private) matches.
    - Source: the "About rulesets" page, https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets, fetched 2026-10-27; archive https://web.archive.org/web/20261017163137/https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets.
    - The fetch tool did not return the availability sentence verbatim, so this quote is **UNVERIFIED** (paraphrase only). The finding rests on the live evidence below, not on this quote.
    - The refuter later fetched the sentence verbatim from both the live page and this archive (see Refuter), so the anchor is now verified.
- **Scenario (observed):**
  1. On 2026-10-26 the repository was private and the Actions budget was exhausted. Every job of every PR and main run failed in about 2 s, annotated "The job was not started because an Actions budget is preventing further use." (check-run annotations; for example main CI run `40274113558`).
  2. #1442 merged at 05:25:12Z and #1444 at 05:47:01Z, both by the owner account. All five required contexts were FAILURE at the head of each PR (`5b9fe024d`, `062078f51`); the PR rollups are below.
  3. The rule-suite log (`GET rulesets/rule-suites?time_period=week`) shows "pass" for every push to main from `6d78e65c7` (2026-10-25 10:13Z) to `0ea15b103` (2026-10-26 17:45Z). There is no entry for `4318ea032` (#1442) or `79720dd5c` (#1444): the ruleset never evaluated those pushes.
  4. Main's CI failed at both commits. After budget returned, #1444's own CI re-run failed for real (14:21Z), and main stayed red until #1449 (`031c90b14`, CI green 15:59Z).
  5. Meanwhile #1439 merged at 15:02Z onto the red main. Its "green" CI was attempt 2 of run `40272280002`, created at 05:04Z, before #1442 landed, so it re-tested a merge commit whose base had neither #1442 nor #1444. This is an instance of KNOWN 11-P3-4 (strict off).
  6. Nothing in the repository flagged any of this. The release planner would count #1442 and #1444 in the next batch like any other PR.
  7. **Whole-week scan.** 132 PRs merged into main since 2026-10-21. Only these two lacked green or skipped required contexts completed before the merge. A GraphQL `search` over merged PRs read `statusCheckRollup` at each head; every other PR passed.
- **Evidence:** SOURCE (live, GET):
  - `gh pr view 1442|1444 --json statusCheckRollup`:
    - #1442: CI aggregate, Chrome UX smoke, the three Linux package contexts and Desktop packaging gate are all FAILURE, at 05:24Z.
    - #1444: the CI aggregate is FAILURE at 14:21Z (the re-run). Chrome UX smoke shows SUCCESS at 14:42Z, after the merge. The three Linux package contexts are FAILURE at 05:46Z.
  - `gh api repos/cisgz3a-hub/KerfDesk/rulesets/rule-suites -f time_period=week` (main entries listed above).
  - `gh api repos/cisgz3a-hub/KerfDesk/rulesets/19573147`: `enforcement: active`, last updated 2026-10-20. Ruleset history has no change during the incident.
  - `gh api …/check-runs/<id>/annotations` gives the budget message.
- **Severity note:** P3. Downstream, the deploy and release gates re-test the exact main commit (Verified clean), so no untested code reached users. The defect is a missing fail-safe under unusual conditions (an owner visibility change plus an exhausted budget). The coordinator may weigh P2 ("broken contract with a clear failure scenario"), since the contract broke twice in practice.
- **Refuter:** CONFIRMED (live check runs and rule-suite log, plus the ground truth now verified). **P3 stands.**
  - **What would make it false:**
    - the ruleset evaluated those pushes;
    - the required checks had passed at merge time;
    - some other repository mechanism was meant to stop or flag a red merge.
  - **Check runs at merge time.** `commits/062078f51/check-runs?filter=all`: all five required contexts completed `failure` at 05:46:21–25Z, before the 05:47:01Z merge. The 14:21Z and 14:42Z results are later re-runs. #1442's five were `failure` at 05:24:40–43Z, before 05:25:12Z. Annotations: "The job was not started because an Actions budget is preventing further use."
  - **Rule-suite log.** `rule-suites?time_period=week&ref=refs/heads/main` jumps from `adf300522` (2026-10-25 15:59Z) to `47c998a92` (2026-10-26 15:02Z). There is no entry for `4318ea032` or `79720dd5c`, and every listed main push is "pass". Ruleset history: the last version is `53937112` (2026-10-20), so nothing changed during the incident.
  - **Ground truth, now verified.** The live "About rulesets" page and the cited archive (`20261017163137`), both fetched 2026-10-27, carry the sentence verbatim: "Rulesets are available in public repositories with GitHub Free". It goes on to name private repositories only for the paid plans.
    - A second, independent line: a session note written at 05:46Z, while #1444 was being opened, recorded that `GET rulesets/19573147` returned 403 "Upgrade to GitHub Pro or make this repository public".
  - **Whole-week scan, re-run.** `gh pr list --state merged --search merged:>=2026-10-21` returns 132 PRs. Only #1442 and #1444 lack a green or skipped run, completed before the merge, for each of the five required contexts.
  - **Nothing else is meant to stop it:**
    - **Merge queue.** ADR-645's merge queue was the only other merge gate ever designed, and it cannot be turned on here. GitHub's "Managing a merge queue" page (fetched 2026-10-27) says queues are "available in any public repository owned by an organization", and this repository's owner type is `User`. This is already KNOWN (11-P3-4, 24-P3-8).
    - **No alert workflow.** Only `audit.yml:98` and `desktop-preview-cadence.yml:96` open issues, and neither looks at main's CI.
    - **Release planner.** `unsigned-release-plan.mjs:145-187` reads no checks.
    - **ADR-621.** Its Verification asks for a ruleset read-back only "after changing it".
  - **Corrections:**
    - #1449 merged at 15:59:46Z, but its main CI completed green only at 16:55:25Z (run `40354791715`). Main was therefore red for about 10.6 h until the fix merged, and about 11.5 h until main was green again.
    - Step 5 is confirmed: run `40272280002` attempt 2 (created 05:04:11Z, re-run from 14:14Z) re-tested the original merge commit.
  - **Severity ruling: P3.** P2's "broken contract with a clear failure scenario" does not fit:
    - ADR-621's Decision, the ruleset content, is unchanged. It stopped applying only because the owner changed the visibility on a Free account.
    - Today the repository is public (`private: false`), and the rule-suite log shows "pass" for every main push from `47c998a92` on. The gap cannot be reached again until the owner makes the repository private, so under §3 it is latent.
    - The "twice" was one 22-minute window in a single incident.
    - R3 shows that no untested code reached users.
    - P2 would fit only if the repository is to go private again while this guard is missing.
- **Fix direction:**
  - The merge procedure should require `gh pr checks <n> --required` to pass, and a read-back that the ruleset is enforced, before merging. It must not rely on `--auto` alone, which merges at once when nothing is enforced.
  - Optionally, have the release planner record or refuse a batch PR whose head checks were not green at merge.
  - Either is a new guard, so it needs maintainer approval under ADR-206.

### G8-P3-2 — `check:public-info` (#1355) runs in CI but not in `release:check`, so a manual deploy publishes the pricing, terms, refund and safety pages without their freshness check

- **Where:**
  - `package.json:58`: `release:check` has no `check:public-info`; the script itself is defined at `:66`.
  - `.github/workflows/ci.yml:76-79`: CI's static-checks job runs it.
  - `.github/workflows/deploy.yml:206-211`: a `workflow_dispatch` deploy runs `pnpm release:check` as its only gate. Its header (`:11-13`) says the manual trigger is for "re-deploys without a new commit (e.g. after editing _headers)".
  - `scripts/ci-parallel-gate.test.mjs:67-80` checks only one direction: every `release:check` command runs in CI.
  - The same weaker gate is used by the dormant desktop lanes, whose renderer bundles also carry `public/`: `release-desktop-preview.yml:84,175,251` and `release-desktop-dry-run.yml:78,149`.
- **Anchor:**
  - **Contract:** ADR-557 decision 1: "`release:check` stays the one serial command for local runs and for manual deploys." Its Consequences: "every `release:check` command runs once on that exact commit before its deploy".
  - **Contract:** ADR-524 Amendment 3 decision 2: the published pages fail "when a committed page differs from its source".
  - **Twin:** CI's static-checks job runs the check; the manual-deploy gate does not.
- **Scenario:**
  1. A change reaches main with `public/pricing/index.html`, `/terms/`, `/refunds/` or `/safety/` out of step with its source (`website/commerce.config.mjs`, `docs/legal/*`, `docs/safety.md`). Examples: a source edit without regeneration, or a hand edit of the page.
  2. Main's CI fails `check:public-info`, so no automatic deploy runs.
  3. The maintainer dispatches a deploy, the documented route for a `_headers` fix.
  4. `release:check` passes and kerfdesk.com serves the stale or hand-edited price or legal text.
  5. Reaching main needs a bypassed PR check. G8-P3-1 shows that happens.
  - The only other test of these pages, `scripts/generate-site-pages.test.mjs:202-218`, renders into a temporary directory and never compares the committed pages (KNOWN 22-P3-7).
- **Evidence:** REPRO.
  - Scratchpad script `zz-g8-gate-parity.mjs`: it parses `ci.yml` with js-yaml, collects the `pnpm …` commands of every job (excluding install, report and exec) and diffs them against `release:check` split on `&&`. Output:

    ```text
    in release:check, not in CI: []
    in CI, not in release:check: [ 'pnpm check:public-info', 'pnpm guard:repo' ]
    ```

  - `node --test scripts/ci-parallel-gate.test.mjs` passes 6/6.
  - `guard:repo` is not a gap: `deploy.yml:198-200` runs it before the gate.
- **Refuter:** CONFIRMED (REPRO plus reading the deploy path). **P3 stands.**
  - **What would make it false:**
    - `release:check` reaches the committed pages some other way;
    - a dispatched deploy also requires main's CI;
    - the build regenerates the pages.
  - **Repro re-run.** The parity diff was re-run from the scratchpad (`zz-g8r-parity.mjs`, js-yaml over `ci.yml` against `release:check` split on `&&`). Same output: `CI not in release:check: [ 'pnpm check:public-info', 'pnpm guard:repo' ]`. `node --test scripts/ci-parallel-gate.test.mjs` passes 6/6.
  - **No other check reads the committed pages:**
    - `website:test`'s copy checks (for example `website/tests/content.test.mjs:184-190`) read pages that `website/build.mjs` renders from source into a temporary directory, not `public/`.
    - `generate-site-pages.test.mjs:202-218` uses `mkdtemp`.
  - **No regeneration in the build.** `build:web` regenerates only the privacy page (`generate:privacy`), so that page refreshes itself. Pricing, terms, refunds and safety are copied as committed: Vite puts `public/` into `dist/web`, and `deploy.yml:289` publishes it (`pages deploy dist/web`).
  - **A dispatch never reads main's CI.** `resolve-web-deploy-identity.mjs:126` returns early for `workflow_dispatch`, and `deploy.yml:206-211` then runs `release:check` as the only gate. Manual dispatch is used in practice: 10 dispatched runs on 2026-10-08 to 10-11, none since #1355.
  - **Quotes verified.** The ADR-557 decision 1 and Consequences quotes and the ADR-524 Amendment 3 decision 2 quote are verbatim from `docs/decisions` at this tree.
  - **Novelty.** This is not 22-P3-7. That finding's fix direction named only `ci.yml`, and #1355 did exactly that.
  - **Severity ruling: P3.**
    - CI's required aggregate waits for the *Typecheck, lint and format* job that runs `check:public-info`. A stale page therefore reaches main only through a bypassed gate (G8-P3-1) or a semantic merge with strict mode off (11-P3-4).
    - It then also needs a manual dispatch while main is red.
    - Those are two abnormal events, so under §3 the gap is latent.
    - What would go live is page text committed through a PR, not arbitrary text.
- **Fix direction:**
  - Add `pnpm check:public-info` to `release:check`.
  - Extend `ci-parallel-gate.test.mjs` to assert the other direction too: every CI `pnpm check:*` command is in `release:check`, with `guard:repo` excepted because each deploy and release runs it separately.

### G8-P3-3 — The ADR gate keys amendment files only (#1427); an amendment written as a heading in its decision file or in DECISIONS.md is not keyed, so a new amendment file can reuse its number

- **Where:**
  - `scripts/check-adr-numbers.mjs:53-56`: an inline `## ADR-N Amendment …` heading only increments `amendmentCount`.
  - `:93-96`: only amendment *files* are keyed into `amendmentFiles`.
  - `:141`: duplicates are computed from that file map alone.
- **Inline amendments that the key map cannot see:**
  - `docs/decisions/ADR-613-commercial-macos-and-linux-downloads.md:172` (ADR-613 Amendment 1);
  - `docs/decisions/ADR-630-run-external-gcode-file.md:78` (ADR-630 Amendment 1);
  - 15 in `DECISIONS.md`, for example ADR-282 Amendments 1–5 from `:15532` and ADR-311 Amendment 1 at `:21809`.
- **Anchor:**
  - **Twin / Contract:** #1427 added the rule that "Amendment files of one decision must not share an amendment number" (`check-adr-numbers.mjs:78-80`, a code comment). The fix direction it implements was rolling v2 11-P3-6: "Key amendments by `(decision, amendment n)` taken from the file name, and from the heading where one exists".
  - **Contract:** ADR-344 keeps numbering global across DECISIONS.md and `docs/decisions/`.
- **Scenario:**
  1. An author amends ADR-613 and lists `docs/decisions/ADR-613-amendment-*`. Nothing is listed, because Amendment 1 lives inside the decision file.
  2. They add `ADR-613-amendment-1-….md`. CI's required ADR gate passes.
  3. "ADR-613 Amendment 1" now names two decisions. This week alone the coordinator renumbered amendment and decision collisions three times (ADR-375 Amd 3; ADR-630 Amd 5/6/7; ADR-672/673/674).
- **Evidence:** REPRO.
  1. `DECISIONS.md` and `docs/decisions/` were copied into the scratchpad folder `zz-g8-adr`.
  2. Two files were added there: `ADR-613-amendment-1-zz-g8-second-amendment-one.md` (`## ADR-613 Amendment 1 - …`) and `ADR-282-amendment-1-zz-g8-legacy-collision.md` (`## ADR-282 Amendment 1 - …`).
  3. `node <worktree>/scripts/check-adr-numbers.mjs` was run with that folder as the working directory. It printed "ADR number gate passed: 549 decisions (+248 amendments) across DECISIONS.md and docs\decisions/, all numbers unique. Next free number: ADR-673." and exited 0.
  4. On the unmodified tree the same gate reports +246 amendments. `grep -c "^## ADR-613 Amendment 1"` finds the heading in both the decision file and the new file.
- **Known:** partly. This is the remainder of 11-P3-6: #1427 implemented the file-name half of its fix direction.
- **Refuter:** CONFIRMED (REPRO with a control). **P3 stands.**
  - **What would make it false:** the gate keys inline amendment headings somewhere, or rejects an amendment file whose number is already used inline.
  - **Read.** `collectHeadings` (`:48-63`) only counts an inline `## ADR-N Amendment …` heading. `amendmentFiles` is filled only from file names (`:93-96`), and `:141` builds duplicates from that map alone.
  - **Repro.** `DECISIONS.md` and `docs/decisions/` were copied to the scratchpad folder `zz-g8r-adr`.
    - Baseline: the gate prints "549 decisions (+246 amendments) … Next free number: ADR-673", exit 0.
    - Three files were added, each carrying a matching `## ADR-N Amendment 1` heading: `ADR-613-amendment-1-…`, `ADR-282-amendment-1-…` and `ADR-630-amendment-1-…`. The gate prints "+249 amendments … all numbers unique", exit 0. Each "Amendment 1" heading now occurs twice: `grep` finds ADR-613's in two files and ADR-282's in `DECISIONS.md` and the new file.
  - **Control.** A second `ADR-630-amendment-2-…` file is caught ("ADR-630 Amendment 2 claimed 2x", exit 1). So only the inline half is missing.
  - **Real traps on main.**
    - ADR-630 Amendments 2–8 are files, but Amendment 1 is inline.
    - ADR-311 Amendment 1 is in `DECISIONS.md:21809`, and Amendment 2 is a file.
    - Listing `ADR-613-amendment-*` returns nothing, even though Amendment 1 exists.
  - **Severity ruling: P3.** This is a tooling gap in documentation numbering, with no effect on the app or on users.
- **Fix direction:** Key every `#{1,2} ADR-N Amendment K` heading, from any decision file and from DECISIONS.md, into the same `(N, K)` map the amendment files use. Fail when a key occurs twice.

## KNOWN (cited, not re-raised)

| ID | State on the audited tree and live (2026-10-27) |
| --- | --- |
| 11-P3-3 | Issue #1067 "Desktop Preview due: v0.2.0-preview.14" is still open (updated 2026-10-26). No `desktop-preview` environment exists. Since #1339, a tag push would auto-create it with no tag policy (ADR-651 Context says so). |
| 11-P3-4 | The ruleset still has `strict_required_status_checks_policy: false` and does not require *Desktop packaging gate*. New instance: #1439 merged onto red main after re-running a pre-#1442 merge commit (G8-P3-1 step 5). |
| 11-P3-5 | The live `third-party-notices.txt` still has 0 Workbox matches. The licence gate and notices still read `--prod` only. |
| 11-P3-7 | `verify-github-actions-pinning.mjs` is unchanged since 2026-10-21. `check:action-pins` passes. |
| 11-P3-8 | `actions/attest@36051bca…` is still pinned at `release-desktop-preview.yml:120,196,272` (refuter: also `:392`). |
| 11-P3-10 | `desktop-package-check.yml:21-24` still says "The repository is private". This week it briefly was again; the native jobs are still off for pull requests and main pushes. |
| 11-P3-11 | Unchanged: no root licence-file check. |
| 22-P3-5 / 22-P3-6 | The undeployed website pages. #1429 corrected the dither count to 12 by hand; counts are still not derived from source. |
| 24-P3-8 | The ADR gate cannot stop two open branches taking the same next free number: ADR-672/673/674 were renumbered this week (#1451, #1455, #1456). |

## Refuted

- **R1 — "While the repository was private, environment branch policies were off, so any branch workflow could read the release signing key, R2 token and Pages token."** Refuted.
  - GitHub's page ([live](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [archive 20261026101653](https://web.archive.org/web/20261026101653/https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), fetched 2026-10-27) says: "If you are using GitHub Free, environment secrets are only available in public repositories." So the secrets were unavailable, not unprotected.
  - There are 0 repository secrets (`GET actions/secrets`).
  - Every job in the window was "not started" by the budget.
  - The lanes therefore fail closed when the repository is private.
- **R2 — "A workflow reported success on main without running anything during the budget outage."** Refuted.
  - The SUCCESS conclusions for `4318ea032` and `79720dd5c` (Desktop package check, Browser smoke) are attempt 2 re-runs (14:04–14:57Z).
  - Their jobs ran 7–19 steps each.
  - Attempt 1's jobs all failed with 0 steps.
- **R3 — "The untested #1442/#1444 code reached kerfdesk.com or a release untested."** Refuted.
  - Deploy was skipped at `4318ea032`, `79720dd5c` (twice) and `47c998a92`.
  - The first deploy containing them is `031c90b14` (16:55Z). CI, Browser smoke and Desktop package check all passed on that commit.
  - The unsigned release's `workflow_run` runs were all skipped (`KERFDESK_UNSIGNED_RELEASES=off`), and its gate would also have refused a red tip.
  - Neither PR touched an in-scope path.
- **R4 — "The commercial Linux AppImage escapes ADR-017 Amendment 2."** Refuted.
  - `electron-builder.commercial-unsigned.yml` extends `electron-builder.commercial.yml`, which extends `electron-builder.yml`. That base holds `toolsets.appimage` and `artifactBuildStarted: scripts/appimage-toolset.mjs`.
  - `build-commercial-platform.sh` runs `verify-linux-package.sh … --commercial`, which refuses the three libraries and any link to them.
  - The Linux lane is off anyway (`KERFDESK_UNSIGNED_LINUX_RELEASES` unset; `latest-linux.json` returns 404).
- **R5 — "`check:secret-scopes` can be bypassed with YAML aliases, expressions in mapping keys, composite actions or `secrets['…']`."** Refuted.
  - js-yaml resolves aliases.
  - GitHub does not evaluate expressions in mapping keys.
  - Composite actions have no `secrets` context.
  - Indexed and whole-context reads fail by design (tests 9/9).
- **R6 — "Deploy trusts any workflow named CI."** Not raised. `workflow_run` matches by name and the deploy does not check `workflow_run.path`, unlike `unsigned-release-plan.mjs:45`. But only `ci.yml` is named CI, and a merged workflow could already name `environment: production` itself, so this is no escalation.
- **R7 — "Build and signing share one job (Windows `publish`, `deploy`), so a compromised build dependency could reach the key."** Not raised; it is accepted design.
  - ADR-613 decision 1 keeps "the Windows job … unchanged".
  - Rolling v2 report 11 verified the key's step scoping.
  - Since #1428 the job also runs a Playwright-downloaded Chromium before the key-bearing steps. That is noted here for the record.

## Verified clean

**This week's CI incident: what the repository's own gates did when CI could not run**
- **Timeline.**
  - A first budget block hit on 2026-10-25 from about 13:19Z. The aggregate jobs of `95bbdb922` (#1431) were "not started", and `95bbdb922`'s main CI has no green run.
  - The main block ran from about 05:20Z to about 13:50Z on 2026-10-26.
  - The ruleset evaluated `95bbdb922` (13:13Z) and `8988b97ea` (15:35Z) on 10-25, and `47c998a92` onward from 15:02Z on 10-26.
- **Deploy (Pages) requires green CI on the same SHA.** The `deploy` job's `if:` needs a `workflow_run` whose conclusion is success and whose event is push (`deploy.yml:70`), and it checks out `workflow_run.head_sha` (`:88`).
  - Deploy was skipped at every red main commit: `95bbdb922`, `4318ea032`, `79720dd5c` (twice) and `47c998a92`.
  - It does **not** wait for Browser smoke. That is ADR-647's accepted residual ("Browser smoke does not gate the web deploy (ADR-158)"); the decision stays with the maintainer under ADR-206.
  - This week six deploys published commits whose main Browser smoke had failed: `f925bd9f0`, `c16952c4f`, `d614d3a5f`, `943066650`, `6d78e65c7` and `512abc099` (deploy runs `39692367092`, `39877642163`, `39884491768`, `40161681552`, `40185139106`, `40186542981`; "Publish to Cloudflare Pages" succeeded in each).
  - Two of those (`6d78e65c7` from #1434 and `512abc099`) failed `e2e/registration-tools-audit.e2e.ts`, which #1434's PR subset did not run. #1436 fixed the test fixture, not the product.
  - Nineteen more successful deploy runs were for commits whose Browser smoke run was cancelled as superseded. Whether each of those actually published, or ended as a freshness no-op, was not checked run by run.
- **The unsigned release requires all three workflows green on the exact tip.**
  - `release-desktop-unsigned.yml:27-32` and `unsigned-release-plan.mjs:37-87` require the latest push run of `ci.yml`, `e2e.yml` and `desktop-package-check.yml` on that SHA to be completed with success. The repository and branch are checked, and `HEAD` must equal `origin/main` (rechecked in `plan()`, `:283-293`).
  - Live check of all seven releases: `faf5a54f1`, `b9202d5aa`, `87ecb4f24`, `a9ad5080c`, `19ff6042a`, `19aba0456` and `adf300522` each show success for all three workflows.
  - The four failed dispatches stopped before publication. In `39532944095` and `39847957270` the upgrade qualification failed; in `39960638656` the delivery browser failed; in `40045552515` the runtime advisory check failed. "Publish immutable installer…" was skipped in every one.
  - 1.0.24–1.0.27 used `release_now` with 15, 2, 3 and 3 PRs, which ADR-561 Amd 4 allows. The reviewed-notes baseline (`requireNotesBaseline`) was met each time: each notes file's `sinceSourceSha` is the previous release's source.
- **No live secret was exposed.**
  - 0 repository secrets.
  - `production` holds only the two Pages secrets (dated 2026-10-22) with a `main`-only branch policy.
  - `desktop-commercial` is `main`-only.
  - `check:secret-scopes` passes ("18 reviewed secrets"), and its tests pass 9/9.

**Merged changes**
- **#1339 (ADR-651) matches its ADR.**
  - The `deploy` job uses `environment: production`, `publish-preview` uses `desktop-preview`, and both qualification jobs use `desktop-commercial`.
  - The stale `codex/payment-launch-20261007` branch exception is gone.
  - The checker treats a bare `if:` as an expression, ignores string literals, matches case-insensitively, and refuses `toJSON(secrets)`, indexed reads, reusable-workflow secrets and computed environment names.
- **#1355.**
  - The live pricing page lists the nine Pro tools in `PRO_FEATURES` order, and `website/tests/commerce.test.mjs` now derives that list from `src/ui/licensing/pro-features.ts`.
  - `check:public-info` and `check:privacy` both pass on the tree.
  - The live privacy page now discloses `dl.kerfdesk.com`, grblHAL raw Telnet, Paddle's notice and Cloudflare network error reports (22-P3-1, P3-3, P3-4).
  - Every internal link on the three fetched pages answers 200.
- **#1324 (ADR-647).**
  - The scope and gate scripts behave as documented.
  - Pushes to main run every Linux packaging job and all four browser shards. Tests pass: scope 4/4, gate 7/7, merge-queue 7/7.
  - The e2e dev server runs `--mode desktop`, so Pro code is covered.
- **#1323 / #1321.** No GPL-3.0 text or library ships: `appimage-runtime-notices.test.mjs` pins it, and the commercial Linux sibling holds (R4).
- **#1427.** File-level amendment duplicates are caught (tests 28/28). The gate passes on the tree with "Next free number: ADR-673". The heading-level gap is G8-P3-3.
- **#1428.** The prepublication probe and the live page check now launch the same browser (`public-delivery-browser.mjs`; tests 3/3).
- **#1358.** The Ostromoukhov table ships with an attribution notice (`docs/licensing/ostromoukhov-error-diffusion.txt`). The source paper states a public-domain intent.
- **Dependencies and assets.** The only dependency change since 2026-10-21 is Electron 44.8.0 → 44.9.1. No new shipped assets were added under `public/`.
- **Script injection.** A YAML scan of every `run:` block finds only matrix, step-output, `env`, `github.repository`/`run_id`/`server_url` and `repository.private` expressions. No event-controlled text reaches a shell. No `pull_request_target` anywhere.
- **The website matches the app's edition on the live pages.**
  - "Free … in the browser and on the desktop" holds while ADR-623 Amd 3 keeps the licence window off.
  - Pro "In the Windows desktop app" holds: the macOS and Linux lanes are off, `latest-macos.json` and `latest-linux.json` return 404, and the download page hides those links until it verifies a signed pointer.
  - "Works on three computers" matches `electron/licensing-verification.ts:80` (`maxDevices !== 3`).
  - "Installs for your Windows account" matches `electron-builder.yml:83` (`perMachine: false`).

## Not verified

- **Visibility history.** It is not readable through the API for a personal account. The private window is inferred from the coordinator's note, the budget annotations (a Free private repository bills Actions minutes) and the rule-suite gap. The exact start and end times are approximate.
- **Cloudflare.** Whether the Pages project `laserforge` also has a Git integration that could publish on push is not visible from GitHub. The deploy history shows only `wrangler pages deploy`.
- **Not triggered.** No workflow, re-run, dispatch or release was started. The Preview, stable and release-train lanes are dormant and were read only.
- **Release-note claims.** Each claim was mapped to its PRs, not re-checked against code. The 1.0.27 line "Your camera calibration now stays when you open a project saved earlier for the same machine" overlaps G6-P2-2 (a bed-size change swaps the calibration); that is left to G6.
- **The rulesets ground-truth quote.** The auditor could not fetch it verbatim (G8-P3-1 rests on live evidence instead). The refuter has since fetched it verbatim from the live page and the archive (G8-P3-1 Refuter).
- **Same-job build and sign (R7).** No exploit was attempted.

**Refuter re-checks (2026-10-27):**
- **Releases.** For 1.0.21 (`faf5a54f1`), 1.0.24 (`a9ad5080c`) and 1.0.27 (`adf300522`), the latest main push run of `ci.yml`, `e2e.yml` and `desktop-package-check.yml` is attempt 1 and `success`. Each completed before its `release_now` dispatch: for 1.0.27, `e2e.yml` finished at 16:53:01Z and the dispatch started at 16:53:33Z.
  - The last 200 runs of `release-desktop-unsigned.yml` include six successful dispatches (1.0.22–1.0.27), each at its release's source SHA. They also include three of the four failed dispatches the report names (`39847957270`, `39960638656` and `40045552515`). The fourth, `39532944095`, and the 1.0.21 dispatch fall before that window.
  - Live `commercial-manual/latest.json` decodes to `1.0.27`, `adf300522692…`, published 2026-10-25T16:54:42Z.
  - `gh release list` holds only old Preview pre-releases, because the 1.0.x releases publish to dl.kerfdesk.com.
- **KNOWN items re-checked and still holding:**
  - 11-P3-3: #1067 is open, and only the `desktop-commercial` and `production` environments exist.
  - 11-P3-4: strict is off, and the five contexts do not include *Desktop packaging gate*.
  - 11-P3-5: the live `third-party-notices.txt` has 0 Workbox matches, and both scripts still read `--prod`.
  - 11-P3-7: the pinning script was last changed 2026-10-01.
  - 11-P3-8: still pinned, and also at `:392`.
  - 11-P3-10: the "is private" comment is at `desktop-package-check.yml:22`.
  - 24-P3-8: #1451, #1455 and #1456 merged with ADR-672, 673 and 674.

All `zz-g8-*` scratch files (repro script, ADR-gate copy, fetched pages, GraphQL output) lived in the session scratchpad and were deleted before the report was handed over.

```json
[
  {"id":"G8-P3-1","severity":"P3","area":"release-ci-website","file":"scripts/unsigned-release-plan.mjs","line":174,"anchor":"Contract: ADR-621 Decision bullet 1 (ruleset requires the CI, browser and packaging contexts) and Context (every applicable check passes before merge); Ground truth: GitHub rulesets not enforced on private Free repositories (docs quote verified verbatim by the refuter, live + archive), live rule-suite log","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Only the GitHub ruleset stops a merge without checks and nothing in the repo notices when it is not enforced: on 2026-10-26 (repo private, Actions budget exhausted) #1442 and #1444 merged with all five required contexts FAILURE; the rule-suite log has no entry for 4318ea032/79720dd5c while every other main push shows pass; main red ~10.5 h; #1439 then merged onto red main via a re-run of a pre-#1442 merge commit; release planner counts batch PRs without reading their checks; deploy/release gates held"},
  {"id":"G8-P3-2","severity":"P3","area":"release-ci-website","file":"package.json","line":58,"anchor":"Contract: ADR-557 decision 1 (release:check is the gate for manual deploys) and Consequences; ADR-524 Amendment 3 decision 2 (committed page must match its source); Twin: ci.yml:76-79","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"check:public-info (#1355) runs in CI but not in release:check, so a workflow_dispatch deploy (and the dormant Preview/dry-run lanes) publish public/pricing, terms, refunds and safety without the freshness check; ci-parallel-gate.test.mjs only checks release:check is a subset of CI"},
  {"id":"G8-P3-3","severity":"P3","area":"release-ci-website","file":"scripts/check-adr-numbers.mjs","line":93,"anchor":"Twin: #1427 rule 'amendment files of one decision must not share an amendment number' (check-adr-numbers.mjs:78-80) vs inline amendment headings; Contract: ADR-344 global numbering; 11-P3-6 fix direction","evidence":"REPRO","verdict":"CONFIRMED","known":"partly: 11-P3-6 (fix keyed file names only)","summary":"The ADR gate keys amendment files but not '## ADR-N Amendment K' headings inside decision files or DECISIONS.md (ADR-613 Amd 1, ADR-630 Amd 1, 15 in DECISIONS.md); adding ADR-613-amendment-1-*.md or ADR-282-amendment-1-*.md passes the gate (exit 0, +248 amendments)"}
]
```
