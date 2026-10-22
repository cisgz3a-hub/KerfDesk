# Rolling audit v2 — CI and release

- **When:** 2026-10-21   **Tree:** origin/main @ `2c8d988db` (the audit worktree HEAD
  `3c99e5465` is that commit plus audit documents only; `git diff --stat 2c8d988db HEAD` touches
  nothing in scope). Live GitHub state (ruleset, environments, secret *names*, variables, Actions
  settings, releases, issues) was read with GET calls on 2026-10-21. No secret value was read.
- **Scope:** `.github/**` (15 workflows, 1 composite action, 2 issue templates), `scripts/**`
  (policy, licence, packaging and release scripts), the six `electron-builder*.yml` files and the
  `package.json` scripts. Governing: ADR-017 (+ Amd 1, Amd 2), ADR-543 (+ Amd 1), ADR-206,
  ADR-248/249, ADR-360, ADR-522 (+ Amd 1), ADR-523 Amd 5, ADR-541, ADR-556, ADR-557, ADR-561
  (+ Amds), ADR-613, ADR-616, ADR-621, ADR-645, ADR-647, `AGENTS.md` Licence.
- **Lenses run:** L1, L2 (GitHub "Security hardening for GitHub Actions", OpenSSF Scorecard
  checks, GitHub Actions billing), L3 (docs and ADRs vs workflows and live settings), L5, L6, L7.
  L4 only for the policy scripts (pin checker and ADR gate inputs). One auditor pass, as the
  batch-2 runner prescribes; verdicts are left to the refuter.
- **Counts:** 11 raised → refuter: 10 confirmed, 0 plausible, 1 refuted (P3-9) → P1 0 / P2 1
  (P3-1, raised) / P3 9 (+ 0 KNOWN). The electron-updater verifier weaknesses (04-P3-1 to P3-3)
  were not re-raised. Refuter checked on 2026-10-21 against origin/main `d11a79fd3`, which
  changes nothing in scope since `2c8d988db`.

## Headline

The pipelines are in good shape where it matters most. Every third-party action is SHA-pinned,
permissions default to read, no workflow uses `pull_request_target`, and no untrusted
`github.event.*` text reaches a `run:` block. The live unsigned Windows lane releases only an
exact main commit that all three workflows passed, and it builds the macOS and Linux files
without any secret.

The weak spots are where secrets live and what the gates do not see. The production Pages token
is a repository secret, so any pushed branch can publish kerfdesk.com without CI (P3-1, raised to
P2 by the refuter). The
Preview lane's documented secrets would be repository-wide too, including an account-wide R2
admin token for the bucket that serves commercial installers (P3-2). That lane has no secrets at
all today, yet a daily issue asks the maintainer to tag a Preview (P3-3). The licence gate,
notices and SBOM read only `--prod` packages, so Workbox ships on kerfdesk.com with no notice
(P3-5). The live ruleset no longer matches ADR-621 (P3-4).

## Findings

### P3-1 — The production web-deploy token is a repository secret, so any pushed branch can publish kerfdesk.com without CI
- **Where:**
  - `.github/workflows/deploy.yml:60-69`: the `deploy` job has no `environment:`.
  - `.github/workflows/deploy.yml:280-281`: the job uses `secrets.PAGES_CLOUDFLARE_API_TOKEN` and
    `secrets.PAGES_CLOUDFLARE_ACCOUNT_ID`.
  - Live state: `GET repos/cisgz3a-hub/KerfDesk/actions/secrets` lists exactly those two
    repository secrets.
  - Live state: a `production` environment exists (created 2026-08-04) with no secrets, no
    branch policy and no protection rules. No workflow references it.
- **Anchor:**
  - **Contract:** ADR-557 and ADR-360, plus the R-H5 note in `deploy.yml:9-12`. Production may
    publish only the main commit whose CI passed, after a freshness check.
  - **Twin:** the `desktop-commercial` environment, which is limited to `main`, keeps the R2 and
    signing credentials out of branch runs. The Pages credential has no such scope.
  - **Ground truth:** GitHub's security hardening guide says: "Any user with write access to your
    repository has read access to all secrets configured in your repository."
- **Scenario:** A branch is pushed (the repository has 209 branches, most pushed by agents) with a
  workflow file whose trigger is `on: push` and whose step runs
  `wrangler pages deploy <dir> --project-name=laserforge --branch=main` with the repository
  secret. That publishes arbitrary content to kerfdesk.com, which carries the web app with Web
  Serial machine control, the download page and the published key set. No pull request is needed,
  and no required check or `deploy.yml` freshness resolver runs.
- **Evidence:** SOURCE (live secret list and environment list via `gh api`, GET) + READ.
- **Severity note:** the only collaborator is the admin account, and a stolen admin token could
  also change environment policies. Scoping the secret is therefore defence in depth against
  branch-level code and narrower tokens, hence P3.
- **Refuter:** CONFIRMED; **severity raised to P2** (ID kept for traceability).
  - **Secret and environment:** `GET …/actions/secrets` lists only the two `PAGES_*` names at
    repository level. `GET …/environments` shows `production` with `deployment_branch_policy: null`
    and `protection_rules: []`, and it has no secrets. No workflow names it.
  - **Branch workflows run on push here:** `nesting-diag.yml` has never been on main, yet it ran
    six times on `push` to `claude/nesting-diag-scratch` (2026-10-18 and 2026-10-19).
  - **No branch restriction:** the agents' token carries `repo` and `workflow` scopes. The only
    rulesets cover `~DEFAULT_BRANCH` and `refs/tags/v*`, so nothing restricts pushes to other
    branches.
  - **GitHub docs (fetched):** writers have "read access to all secrets configured in your
    repository". Environment secrets "are only available to workflow jobs that use the
    environment".
  - **Why P2:** the weakness is reachable today, so it is not latent. Its precondition is routine
    here: an autonomous agent holding the admin token pushes an unreviewed branch workflow. Such a
    run could also copy out the long-lived Pages token. That fits §3 P2, "a security weakness
    that needs … unusual conditions".
  - **Counterweight:** the same token could still edit an environment policy, or merge through a
    pull request that needs zero approvals. Scoping therefore narrows the path; it does not close
    it.
- **Fix direction:** Move both Pages secrets into the existing `production` environment, limited
  to `main`, and give the `deploy` job `environment: production`. Add a workflow test that every
  `secrets.*` reference outside `GITHUB_TOKEN` sits in a job with an environment.

### P3-2 — The Preview lane's documented secrets would be readable from every branch, including an account-wide R2 admin token for the commercial downloads bucket (latent)
- **Where:**
  - `.github/workflows/release-desktop-preview.yml:284-297`: `publish-preview` has no
    `environment:`.
  - `.github/workflows/release-desktop-preview.yml:590-600`: that job uses
    `DESKTOP_PREVIEW_MANIFEST_PRIVATE_KEY` and `PREVIEW_R2_API_TOKEN`.
  - `docs/desktop-preview-distribution.md:73-81`: the provisioning contract requires an R2 token
    with "Admin Read & Write".
  - `scripts/publish-preview-release.mjs:71-74` → `scripts/stable-release-store.mjs:68`: Preview
    publication writes to bucket `kerfdesk-downloads`, the same bucket the commercial lane uses.
  - `docs/desktop-commercial-launch.md:241-247`: "An Admin token reaches every bucket in the
    account".
  - Same class: `.github/workflows/qualify-desktop-upgrade.yml:66,116` reads
    `KERFDESK_NATIVE_QUALIFICATION_LICENCE` in jobs with no environment. Line 94 still allow-lists
    `refs/heads/codex/payment-launch-20261007`, a branch that no longer exists.
- **Anchor:**
  - **Twin / Contract:** ADR-561 keeps the release signing key and the R2 credentials in the
    protected `desktop-commercial` environment, and the commercial lane does exactly that. The
    Preview lane needs the same capability on the same bucket, with no environment.
  - **Ground truth:** the GitHub hardening quote in P3-1.
- **Scenario:**
  1. The maintainer provisions the Preview lane as documented. Because the job has no
     environment, the two values must be repository secrets.
  2. Any branch workflow can then read an account-wide R2 admin token.
  3. With it, the attacker overwrites the unsigned commercial Windows installer that new
     customers download from `dl.kerfdesk.com`. Installed apps check the Ed25519 manifest, but a
     first download has no Authenticode signature to expose the swap.
  4. The Preview signing key alone is channel-limited (`verifySignedEnvelope` requires
     `key.channel === channel`, `public/desktop-release-manifest.mjs:140-160`), so it can forge
     only Preview notices.
- **Evidence:** SOURCE + READ. `GET …/actions/secrets`, `…/actions/variables` and
  `…/environments/*/secrets|variables` show no `PREVIEW_*` or `DESKTOP_PREVIEW_*` value
  anywhere. That is why the finding is latent.
- **Severity note:** P3 because nothing is provisioned. It becomes a P2 when the Preview secrets
  are added as documented.
- **Refuter:** CONFIRMED. It is latent, so P3 stands.
  - `publish-preview` has no `environment:` and reads both Preview secrets.
  - Preview (`PREVIEW_ORIGIN`) and commercial (`COMMERCIAL_ORIGIN`) both serve from
    `https://dl.kerfdesk.com`. `createStableReleaseStore` hard-codes the bucket
    `kerfdesk-downloads`, so even a bucket-scoped token would reach the commercial installers.
  - No Preview secret or variable exists in the repository or in either environment.
  - `git ls-remote` finds no `codex/payment-launch-20261007` branch.
- **Fix direction:**
  - Give `publish-preview` its own environment, for example `desktop-preview`, whose deployment
    policy allows only `v*-preview.*` tags. Do the same for the qualification licence.
  - Keep Preview objects in a separate bucket or account, so the Preview token cannot write
    commercial installers.
  - Drop the stale branch exception.

### P3-3 — The Preview lane cannot publish (nothing is provisioned), yet the daily cadence issue asks the maintainer to tag one; following it creates an irreversible public prerelease and then fails
- **Where:**
  - `.github/workflows/desktop-preview-cadence.yml` keeps issue #1067 open: "Desktop Preview due:
    v0.2.0-preview.14", updated 2026-10-20. Its body says "ready to tag" and gives
    `git tag -a v0.2.0-preview.14 … && git push origin v0.2.0-preview.14`.
  - `.github/workflows/release-desktop-preview.yml:493-516` publishes the immutable GitHub
    prerelease before `:590-600` signs and uploads to R2.
- **Anchor:**
  - **Contract:** `docs/desktop-preview-distribution.md` "Provisioning contract" ("Before the
    first release, configure …").
  - **Contract:** ADR-249 and the workflow header: a Preview is an exact-version GitHub archive
    plus signed public R2 metadata.
  - **Contract:** ADR-522 says the cadence names the next Preview to tag.
- **Scenario:**
  1. The maintainer follows #1067. The builds and the release gate pass.
  2. `v0.2.0-preview.14` becomes an immutable public prerelease: the repository has immutable
     releases enabled, and the tag ruleset blocks reuse.
  3. The R2 step then runs with an empty account ID, token and key and fails.
     `https://dl.kerfdesk.com/desktop/previews/latest.json` stays 404, so installed Previews are
     never notified and the website Preview section stays hidden.
  4. Each retry spends another version number. The R2 step has never run: the last Preview run,
     v0.2.0-preview.13 on 2026-07-23, predates it, and its publish job has no such step.
- **Evidence:** SOURCE.
  - `gh issue view 1067` shows the tag commands.
  - `curl -I https://dl.kerfdesk.com/desktop/previews/latest.json` returns 404.
  - The secret, variable and environment listings show no Preview values.
  - `gh api …/actions/runs/29993070904/jobs` lists the steps of the last successful publish.
- **Refuter:** CONFIRMED, with one sub-claim corrected. P3 stands.
  - #1067 is open and reads "ready to tag", with the tag commands.
  - `latest.json` returns 404, and no Preview credential exists.
  - `immutable-releases` returns `enabled: true`.
  - The prerelease is made public (`:493-516`) before the R2 step. That step throws
    `configuration` when the account ID is empty.
  - **Correction:** "each retry spends another version number" does not hold for a re-run. The
    draft step sets `already_published=true` and goes straight to R2. The cadence
    (`desktop-preview-cadence.mjs:155-157`) also says to retry the failed run before creating a
    new tag. So once the lane is provisioned, a re-run recovers the same tag.
- **Fix direction:** Add a credential preflight, as `release-train.yml` has, that runs before any
  build and before the draft release, and make the cadence say "not provisioned" instead of
  "ready to tag". Alternatively, retire the cadence until the lane is provisioned.

### P3-4 — The live main ruleset differs from ADR-621: "Desktop packaging gate" is not required and branches need not be up to date
- **Where:**
  - Live ruleset `19573147` "Protect main branch" (updated 2026-10-20) requires five contexts:
    - `Lint, typecheck, license, test, build`
    - `Chrome UX smoke`
    - `Package, check and launch the desktop app`
    - `Package, install and launch the Linux AppImage and .deb`
    - `Rehearse the commercial Linux build (x64)`
  - The same ruleset sets `strict_required_status_checks_policy: false`.
  - `.github/workflows/desktop-package-check.yml:66-98`: the aggregate job.
- **Anchor:**
  - **Contract:** ADR-621 decision says the ruleset "requires the CI aggregate, browser aggregate
    and `Desktop packaging gate`, plus the three unconditional Linux package checks", and "PRs
    must be tested against the current base branch."
  - **Contract:** ADR-647 point 4 says "The required check names do not change". ADR-647 records
    strict mode as "already off" but does not amend ADR-621.
- **Scenario:**
  - (a) Two of the three required Linux contexts pass when skipped. The only check that they
    were skipped for the right reason (`scripts/desktop-packaging-gate.mjs`) is not required.
    Today the unconditional `linux-package` context blocks most cancellation cases, so this is
    mainly contract drift.
  - (b) With strict mode off and no merge queue possible (ADR-647), two pull requests that are
    each green against an older main can both merge and leave main red. Deploy and the unsigned
    release still wait for main's own runs.
- **Evidence:** SOURCE: `gh api repos/cisgz3a-hub/KerfDesk/rulesets/19573147` (GET). All five
  required names do match real job names, and all come from integration 15368.
- **Refuter:** CONFIRMED. P3 stands (contract drift).
  - **Live ruleset:** `rulesets/19573147` has `"strict_required_status_checks_policy":false`.
    Its five `required_status_checks` contexts do not include `Desktop packaging gate`.
  - **Branch protection:** `branches/main/protection` returns 404 "Branch not protected", so the
    ruleset is the only gate.
  - **`rulesets/19573147/history`** settles the coordinator's 2026-10-19 note:

    | Version | Time (UTC) | Gate required | Strict |
    | --- | --- | --- | --- |
    | 53679199 | 2026-10-18 09:22 | Yes (six contexts) | `true` |
    | 53695974 | 2026-10-18 14:41 | No | `true` |
    | 53937112 | 2026-10-20 09:46 | No | `false` |

    So the note was right when it was written. Its "desktop package" is the still-required
    `Package, check and launch the desktop app`, not the gate.
  - **ADRs:** ADR-645's Context (2026-10-20) lists the five checks with strict on. No ADR-621
    amendment exists.
- **Fix direction:** Add `Desktop packaging gate` back to the required contexts, or amend ADR-621
  to record its removal. Record the strict-mode decision as an ADR-621 amendment.

### P3-5 — Code from devDependencies that ships in the bundles escapes the licence gate, the notices and the SBOM (Workbox on kerfdesk.com)
- **Where:**
  - The licence gate and notices read production packages only: `scripts/check-licenses.mjs:44`
    and `scripts/third-party-closure.mjs:360` both run `pnpm licenses list --prod`.
  - `scripts/generate-release-integrity.mjs:138-139`: the Preview SBOM scope is "pnpm production
    dependencies, bundled fonts, and OpenClipart assets".
  - `vite-plugin-pwa` and `workbox-window` are devDependencies.
  - `vite.config.ts:75` (`VitePWA`) generates a Workbox service worker.
  - `src/ui/app/PwaUpdateWatcher.tsx:23` imports `virtual:pwa-register/react`, which imports
    `workbox-window`.
  - No ESLint `no-extraneous-dependencies` rule exists.
- **Anchor:**
  - **Contract:** ADR-017 decision 2 says `scripts/check-licenses.mjs` "is the enforced
    production-package allowlist".
  - **Contract:** `AGENTS.md` Licence says outside code must be "list[ed] … in
    `THIRD_PARTY_NOTICES.md`", and "New dependencies must pass `pnpm license-check`".
  - **Ground truth:** the MIT licence condition: "The above copyright notice and this permission
    notice shall be included in all copies or substantial portions of the Software."
- **Scenario:**
  - kerfdesk.com serves the Workbox 7.4.0 runtime, and the renderer bundles `workbox-window`.
    Neither is listed in the deployed notices, licence-checked or in the SBOM.
  - Structurally, any devDependency that renderer code imports ships unchecked. A GPL one would
    pass `pnpm license-check`.
- **Evidence:** REPRO.
  - `curl https://kerfdesk.com/sw.js` contains `define(["./workbox-271d3e69"]`.
  - `curl https://kerfdesk.com/workbox-271d3e69.js` contains `workbox:core:7.4.0`, and likewise
    `precaching`, `routing`, `strategies`, `expiration` and `cacheable-response`.
  - `curl https://kerfdesk.com/third-party-notices.txt | grep -ci workbox` returns `0` (8,144
    lines).
  - `pnpm licenses list --prod --json` in the main checkout (`96ccab88f`; Workbox is a
    devDependency on the audited SHA too) lists 69 packages, none of them Workbox.
- **Refuter:** CONFIRMED (reproduced). P3 kept.
  - **Shipped today:** `sw.js` loads `workbox-271d3e69.js`, which carries
    `workbox:{core,precaching,routing,strategies,expiration,cacheable-response}:7.4.0`.
  - **Renderer:** the main chunk `main-hN5nXMWG.js` lazy-loads
    `assets/workbox-window.prod.es5-BBnX5xw4.js` (`workbox:window:7.4.0`, HTTP 200). This also
    confirms the renderer half of the claim.
  - **No notice anywhere:** neither file contains any copyright or licence text. The deployed
    `third-party-notices.txt` (8,144 lines) and `THIRD_PARTY_NOTICES.md` have no Workbox
    matches.
  - **Gates:** both scanners run `pnpm licenses list --prod`.
  - **Licence:** MIT, "Copyright 2018 Google LLC". Checked against the GitHub licence API for
    `GoogleChrome/workbox` (SPDX `MIT`) and the installed `LICENSE` files of `workbox-core`,
    `workbox-window` and `workbox-precaching` 7.4.1.
  - **Severity:** the omission exists today, so it arguably fits P2's "broken contract" clause.
    The harm is a missing attribution for a permissive library, so P3 stands. The coordinator may
    raise it.
- **Fix direction:** Build the licence, notice and SBOM closure from what Vite actually emits (the
  module IDs in the production chunks and the service worker), or add an import rule for `src/`
  plus explicit entries for build-injected runtimes such as Workbox and Vite's preload helper.

### P3-6 — The ADR number gate does not catch amendment-number collisions; two different "ADR-378 Amendment 1" files are on main
- **Where:**
  - `scripts/check-adr-numbers.mjs:52-56`: amendments are counted but never keyed.
  - `scripts/check-adr-numbers.mjs:97-103`: only decision files must show a visible heading.
  - The colliding files, both dated 2026-09-29:
    - `docs/decisions/ADR-378-amendment-1-dropped-projects-open-like-operating-system-opens.md`
    - `docs/decisions/ADR-378-amendment-1-recent-projects-survive-a-storage-refusal.md`
  - Code cites the ambiguous "ADR-378 Amendment 1": `src/ui/app/use-import-drag-drop.ts` and
    `src/ui/recent-projects/dropped-project-open.ts`.
  - `docs/decisions/ADR-486-amendment-2-…md` uses `# ADR-486 Amendment 2:`, which the gate cannot
    see.
- **Anchor:** **Twin / Contract.** The gate's header names its purpose: stopping same-day number
  collisions (three ADR-257s on 2026-07-25). ADR-344 split the decisions into files so numbering
  stays global. Amendments are cited by number exactly like decisions.
- **Scenario:** Two branches each add `ADR-N-amendment-K-*.md` on the same day. Both pass
  `check:adr-numbers`, which is a required CI step, and "ADR-N Amendment K" then names two
  decisions. This has already happened for ADR-378.
- **Evidence:** REPRO.
  - `node scripts/check-adr-numbers.mjs` prints "ADR number gate passed: 530 decisions (+165
    amendments) … Next free number: ADR-650".
  - `ls docs/decisions | sed -nE 's/^(ADR-[0-9]+-amendment-[0-9]+)-.*/\1/p' | sort | uniq -d`
    prints `ADR-378-amendment-1`.
- **Refuter:** CONFIRMED (re-run).
  - The gate passes and prints "Next free number: ADR-650".
  - `origin/main` holds two `ADR-378-amendment-1-*` files. Both headings read
    "## ADR-378 Amendment 1".
  - `collectHeadings` only increments `amendmentCount` for an amendment.
  - `ADR-486-amendment-2` opens with "# ADR-486 Amendment 2:".
- **Fix direction:** Key amendments by `(decision, amendment n)` taken from the file name, and
  from the heading where one exists, and fail on duplicates. Renumber one of the ADR-378
  amendments and its references.

### P3-7 — The action-pin check skips `docker://` and misses non-canonical YAML forms; GitHub's own SHA-pinning policy is off
- **Where:**
  - `scripts/verify-github-actions-pinning.mjs:19`: the regex needs `uses:` right after an
    optional `-`.
  - `scripts/verify-github-actions-pinning.mjs:24-26`: every `docker://` reference is skipped.
  - Live setting: `GET …/actions/permissions` returns
    `{"allowed_actions":"all","sha_pinning_required":false}`.
- **Anchor:**
  - **Ground truth:** GitHub hardening says "Pin references to actions to a commit SHA".
  - **Ground truth:** OpenSSF Scorecard Pinned-Dependencies counts a dependency as pinned only
    when it is "explicitly set to a specific hash" (container images included).
  - **Contract:** `check:action-pins` is a required CI step that claims to cover every workflow
    and composite `uses:`.
- **Scenario:** `- uses: docker://alpine:latest`, `- uses : evil/action@v1` and
  `- { name: x, uses: evil/action@main }` all pass the required check. Each runs mutable
  third-party code.
- **Evidence:** REPRO with `scratchpad/pin-repro.mjs` calling the exported `verifyWorkflowText`:

  ```text
  docker         PASSES (not flagged)
  spacedKey      PASSES (not flagged)
  flowMap        PASSES (not flagged)
  quoted         flagged
  plainUnpinned  flagged
  ```
- **Refuter:** CONFIRMED with my own repro. It stays a latent P3.
  - **Repro:** `scratchpad/r11/pin.mjs` calls `verifyWorkflowText`. These pass:
    - `docker://alpine:latest`
    - `uses : evil/action@v1`
    - a flow-mapping step
    - `"uses": evil/action@main`
  - **Flagged:** quoted values, block scalars and `name:`-first steps.
  - **Parsing:** js-yaml reads the spaced-key and flow-map forms as an ordinary `uses` key.
  - **Live setting:** `actions/permissions` returns `sha_pinning_required:false`.
  - **Today:** no workflow uses any of these forms.
- **Fix direction:** Parse the YAML (`js-yaml` is already a devDependency) and check every `uses`
  value, requiring `docker://…@sha256:`. Consider enabling the repository's SHA-pinning policy;
  as a new guard, that needs maintainer approval (ADR-206).

### P3-8 — `actions/attest` is pinned to an annotated tag object that no upstream ref points to any more, not to a commit
- **Where:**
  - `.github/workflows/release-desktop-preview.yml:120,196,272,389` pin `actions/attest@36051bca… # v4`.
  - `scripts/verify-github-actions-pinning.mjs:11` allow-lists that SHA.
- **Anchor:** **Ground truth:** GitHub hardening says to pin to a commit SHA and to verify the SHA
  comes from the action's repository.
- **Scenario:**
  - `36051bca…` is the annotated tag object of the old `v4` tag (tagged 2026-07-16). It peels to
    commit `f7c74d28…`, which is `v4.2.0`.
  - `v4` now points straight at `1e69f48…` (`v4.2.2`), and no tag in `actions/attest` references
    the old tag object.
  - codeload still serves it, so Preview jobs resolve it today. Once GitHub prunes the
    unreferenced object, every Preview build and publish job fails at "Set up job".
  - The `# v4` comment, Dependabot and pin auditors cannot track it.
- **Evidence:** SOURCE.
  - `gh api repos/actions/attest/commits/36051bca…` returns 422 "No commit found".
  - `gh api repos/actions/attest/git/tags/36051bca…` returns `{"tag":"v4","object":{"sha":"f7c74d28…","type":"commit"}}`.
  - A paginated `git/matching-refs/tags/v` has no match for that object.
  - `curl -I codeload…/tar.gz/36051bca…` returns 200.
  - The other six action pins match upstream release tags.
- **Refuter:** CONFIRMED. P3 stands.
  - `commits/36051bca…` returns 422.
  - `git/tags/36051bca…` is tag `v4` (tagger date 2026-07-16), pointing to `f7c74d28…`.
  - `git/ref/tags/v4` now points to `1e69f48a…`.
  - A paginated `matching-refs/tags/v` finds only `refs/tags/v4.2.0`, which points straight to
    `f7c74d28…`. No ref points to the tag object.
  - codeload still returns 200.
  - A SHA still fixes the content, so the risk is availability and traceability.
- **Fix direction:** Pin `actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6 # v4.2.0`, or the
  current `v4.2.2` commit, in both the workflow and the allowlist.

### P3-10 — Windows and macOS packaging left pull requests because "the repository is private"; it is public again, so that reason no longer holds
- **Where:**
  - `.github/workflows/desktop-package-check.yml:18-24` says: "The repository is private, so these
    runners bill at 2x and 10x Linux minutes".
  - `docs/decisions/ADR-522-amendment-1-…md` Context says "The repository is now private."
  - Live state: `GET repos/cisgz3a-hub/KerfDesk` returns `"visibility":"public"`.
- **Anchor:**
  - **Ground truth:** GitHub billing docs say "GitHub Actions usage is free for self-hosted
    runners and for public repositories that use standard GitHub-hosted runners."
  - **Contract:** ADR-522 decision 1 (native checks on every pull request) was amended for a
    billing reason that is now false.
- **Scenario:**
  - Windows is the only live customer lane, yet its packaging and install run on no pull request
    and no main push.
  - It runs only in the weekly `packaged-native-smoke` (`--dir` only), a manual run, or the
    unsigned release itself, which fails closed but late.
  - The release train, which calls the native jobs, is off.
- **Evidence:** SOURCE.
- **Refuter:** CONFIRMED. P3 stands.
  - **Visibility:** `GET repos/…` returns `"visibility":"public"` and `"private":false`.
  - **Stale reason:** the workflow comment and ADR-522 Amendment 1 still give the
    private-billing reason.
  - **GitHub's billing page (fetched):** "GitHub Actions usage is free for … public repositories
    that use standard GitHub-hosted runners".
  - **Windows job:** `windows-package` is `if: ${{ inputs.native == true }}`. It was skipped on
    today's main push run, 39567801245.
  - **A real reason remains:** ADR-647's limit of about 20 concurrent jobs. No ADR records it for
    the native jobs.
- **Fix direction:** The maintainer should decide again: ADR-647's concurrency limit still
  applies, but the cost argument does not. At minimum, correct the workflow comment and record the
  current reason in an ADR-522 amendment.

### P3-11 — No check keeps licence files other than `LICENSE` out of the repository root
- **Where:**
  - Root `LICENSE` content is enforced only by `scripts/verify-linux-package.sh:76-77` (the
    packaged copy) and `scripts/unsigned-release-plan.mjs:289`.
  - Nothing inspects other files in the root.
- **Anchor:** **Contract:**
  - `AGENTS.md` Licence: "Keep MIT text out of the repository root: GitHub labels the repository
    with every licence file it finds there."
  - ADR-543 Amendment 1 decision 1, which has no regression test.
- **Scenario:** A pull request restores `LICENSE-MIT`, or adds `COPYING` or `LICENSE.md` with
  MIT text, for example from an old branch. Every required check passes, and the public
  repository is labelled MIT again. A change to `LICENSE` itself *is* caught: that path selects
  the Linux installer job, whose required package check looks for "All rights reserved".
- **Evidence:** READ plus grep. No script or test reads the root for licence-named files.
  `GET …/license` currently reports `key: other`, `NOASSERTION`.
- **Refuter:** CONFIRMED.
  - **Existing checks:** a grep of `scripts/`, `src/`, `electron/`, `.github/` and `e2e/` finds
    "All rights reserved" checks only at `unsigned-release-plan.mjs:289` and
    `verify-linux-package.sh:77`.
  - **No root scan:** no code lists root files named `LICENSE-*`, `COPYING` or `LICENSE.md`.
    `release:check` has no such step.
  - **Root today:** `git ls-tree origin/main` holds only `LICENSE` and `THIRD_PARTY_NOTICES.md`
    as licence or notice files.
- **Fix direction:** Add a small `node --test` check in `test:release-integrity`. The root should
  hold exactly one licence-named file, `LICENSE`; it must contain "All rights reserved" and no MIT
  grant text.

## Refuted

### P3-9 (refuted) — macOS packaging downloads the Electron release zip with no checksum
- **Claim:** `scripts/electron-builder-preview-after-pack.mjs:76-92` fetches
  `electron-v<version>-darwin-<arch>.zip` into `os.tmpdir()` without a hash check, and reuses
  any same-named file there. Its `LICENSE` and `LICENSES.chromium.html` then ship in the Preview
  and unsigned commercial macOS apps.
- **Why refuted:** the download is a dead fallback on every lane.
  1. `extractElectronZipNotice` runs only when `localNoticePath` finds neither
     `node_modules/electron/dist/<name>` nor `node_modules/electron/<name>`.
  2. Electron's postinstall is allowed (`pnpm-workspace.yaml` `allowBuilds: electron: true`).
     Every macOS job runs a plain `pnpm install --frozen-lockfile`.
  3. `node_modules/electron/install.js` downloads the darwin zip through `@electron/get` with
     `checksums: require('./checksums.json')`, then extracts the whole zip into `dist/`.
  4. Electron's upstream `script/zip_manifests/dist_zip.mac.arm64.manifest` at `v44.5.1` lists
     `LICENSE` and `LICENSES.chromium.html` at the zip root.
  5. So the shipped notices come from the checksum-verified local copy.
- **Residual (not a finding):** delete the fallback, so that missing notices fail closed instead
  of triggering an unchecked download.
- **Evidence:** READ plus a primary source (upstream zip manifest). No macOS packaging run in the
  recent history ran the step, so no log was available.

Candidates the auditor considered and did not raise (listed so later audits can skip them):

- **`desktop-commercial` has no required reviewer.** The stable Ed25519 key and the commercial R2
  token are protected only by the main-only branch policy. Main's pull request rule requires zero
  approvals, and agents auto-merge, so any merged workflow could read them. Not raised: ADR-561
  chooses automatic publication, which a reviewer gate would block, and ADR-561 calls this
  environment "protected" in exactly this sense. The trade-off is still worth a maintainer note.
- **`persist-credentials` is not disabled in some jobs:** the unsigned `publish` job,
  `publish-macos`, `publish-linux`, the stable lane, `audit.yml` (`issues: write`), CI, e2e,
  deploy and the dry run. Sibling jobs disable it. Not raised: the tokens are read-only except
  `audit.yml`, and no artifact upload includes `.git`.
- **`deploy.yml`'s freshness resolver counts deploy runs from any branch** as "published"
  evidence. It filters by run title and step name, not by branch. Not raised: spoofing it needs a
  modified workflow, which needs write access, and the result is only a skipped deploy of an older
  candidate.
- **`coverage-report.yml` pipes `pnpm report:coverage | tee`** without `pipefail`. That workflow
  is observability only.
- **The issue template asks users to attach a `.lf` project.** Projects are `.lf2`. This is
  cosmetic.
- **`e2e/` and `services/` files are over 600 lines.** They are outside the raw-line backstop's
  stated scope, so the script does what its name claims.

## Verified clean

**Supply chain**
- All seven third-party actions use 40-hex pins. Six resolve to upstream release tags: `checkout`
  v7, `setup-node` v6, `upload-artifact` v7, `download-artifact` v7, `wrangler-action` v4 and
  `pnpm/action-setup` v6.0.9 (peeled annotated tag). The exception is P3-8.
- The composite action is pinned too. `check:action-pins` runs inside the required CI aggregate.
- Default workflow permissions are `read`. Every workflow sets top-level `contents: read`, or `{}`
  with per-job grants (`release-train.yml`).
- The writes are:
  - `issues: write`: `audit.yml` and `desktop-preview-cadence.yml`.
  - `contents: write` plus `id-token`/`attestations`: only the Preview publish job and its
    native build jobs (attestation).
- No `pull_request_target` anywhere.
- Both `workflow_run` consumers require `event == 'push'`:
  - `deploy.yml` also requires a SHA on main and loads its resolver from `github.workflow_sha`.
  - `release-desktop-unsigned.yml` also requires `head_branch == 'main'` and the canonical
    `head_repository`.
- No pull-request-triggered workflow references a secret. Fork pull requests need approval for
  first-time contributors and run with a read-only token.
- **Script injection:** a scan of every `${{ }}` inside `run:` blocks (`scratchpad/run-exprs.mjs`)
  found 21 expressions. All are matrix values, step outputs, `github.server_url`, `run_id`,
  `repository` or `repository.private`. Tag-derived versions are interpolated only after
  `validate-release-tag.mjs` has passed its strict SemVer regex in an earlier, required job.
- **Caches:** the secret-bearing unsigned jobs use no `setup-node` cache (Windows publish,
  macOS/Linux build and publish). Main-scope caches are written only by main-context runs. No
  `pull_request_target` path exists, and the `merge_group` path is dormant (ADR-647).
- **Downloads:**
  - The eSigner CKA download is SHA-256 pinned, and so are the Artcraft archives.
  - The AppImage toolset uses electron-builder's own checksum (ADR-017 Amd 2), and the Electron
    binary uses `@electron/get` checksums.
  - The macOS Electron notices come from that checksum-verified `electron/dist` copy. P3-9 was
    refuted.

**Licence gates**
- `check-licenses.mjs` is a fail-closed allowlist: GPL, compound expressions that include a
  disallowed licence, "Unknown", custom terms and zero packages all fail. It covers the
  transitive production tree (69 packages).
- `services/remote-control` has its own `license-check` inside `check:remote-control`.
- **AppImage (ADR-017 Amd 2):**
  - `scripts/appimage-toolset.mjs` leaves out libappindicator3, libindicator3 and libgconf-2.
  - `verify-linux-package.sh` refuses those three libraries and any `usr/lib` library not on the
    allowlist, and runs `readelf` to make sure nothing links them. A readelf failure is caught by
    the non-empty check.
  - The check runs on every main push and in the required checks whenever packaging paths
    change.
- `LICENSE` says "All rights reserved". GitHub reports the repository licence as
  `other`/`NOASSERTION`, and no MIT file sits in the root; the remaining gap is P3-11.

**Release integrity**
- **Unsigned Windows lane (ADR-561):**
  - Before anything is built, the lane requires the latest run of CI, Browser smoke and Desktop
    package check to have passed on that exact main push SHA, in the canonical repository.
  - The plan re-checks that the SHA is main's tip, that `LICENSE` is the proprietary one, and
    the authenticated 10-PR batch.
  - It requires zero runtime advisories.
  - It installs, launches and uninstalls the installer, refuses a tampered `app.asar` (with the
    archive restored afterwards), and runs the historical upgrade.
  - Publication comes before the public delivery check and the signed receipt.
  - The signing key reaches only three steps, in a job whose environment allows only `main`, and
    is never written to disk (`prepare-commercial-desktop.mjs:567-579`).
  - The macOS and Linux build jobs hold no secret; `build-commercial-platform.sh:27-30` refuses
    to run if one is set.
  - The publish jobs accept only files whose SHA-256 the build jobs reported.
- **What "unsigned" packages contain:**
  - `kerfdeskUpdateChannelTrusted: false`, channel `commercial-unsigned`,
    `kerfdeskUnsignedInstaller: true`, `publish: null` (no `app-update.yml`) and
    `forceCodeSigning: false`.
  - The signed release identity is embedded. This is checked at packaging time
    (`verifyUnsignedCommercialPackage`) and on Linux by the package contract.
  - `electron-updater` is still packed but not used on this lane (see report 04).
- **Preview immutability:**
  - The flow is draft, upload, exact asset-set diff, publish as an immutable prerelease, then
    re-verify the tag object, attestations (the repository is public), checksums and the
    manifest.
  - The repository's immutable-releases setting is on.
  - `v0.2.0-preview.13` reports `immutable: true`.
- **Key channels:** a Preview key cannot sign stable or commercial manifests
  (`verifySignedEnvelope` requires a matching `channel`).
- **Retired lanes:**
  - Stable lane: `KERFDESK_LEGACY_STABLE_LANE` is unset, and neither `desktop-production` nor
    `STABLE_*` secrets exist (ADR-556).
  - Release train: its variable is unset and its eSigner secrets are absent.
  - `KERFDESK_UNSIGNED_RELEASES` is `off` between releases (flip, dispatch, flip).

**Gates**
- The five required context names match real, uniquely named jobs. Skipped matrix jobs keep
  unexpanded names that cannot collide.
- The CI and browser aggregates (`if: always()` plus `jq`) fail on any non-success. A `jq`
  failure exits under `bash -e`.
- Every `release:check` command runs in one of the parallel CI jobs (ADR-557).
- **Silent failures:**
  - No `continue-on-error` anywhere.
  - `set +e` appears only around `pnpm audit`, followed by the validated classifier and
    `runtimeCount == 0`.
  - The only `|| true` is the readelf guard described above.
  - Every multi-command PowerShell step checks `$LASTEXITCODE` or ends on the native command.
- **ADR-647 path filter:**
  - `LICENSE`, `package.json`, the lockfile, `public/`, `scripts/`, `electron/`, `src/platform/`,
    `src/ui/app/`, `src/ui/licensing/` and any unknown path select the installer jobs.
  - An empty diff or a failed scope job also selects them.
  - The skipped cases are the residual risks ADR-647 accepts.

**Scripts**
- `check-adr-numbers` catches decision collisions, misnamed files and invisible decision headings.
  It passes today, with ADR-650 as the next free number; the gap is P3-6.
- `check-file-size-policy` enforces 600 lines (900 for tests) across `src`, `electron`, `scripts`,
  `website`, `audit/scripts` and the root configs, as it claims.
- `check-soft-line-limit` is report-only by design. `check-index-exports` ratchets as documented.

## Not verified

- **No runs:** no workflow, release or deployment was triggered. Live settings are as of the GET
  calls on 2026-10-21. The Pages and R2 token scopes are not visible through the API.
- **Pruning:** whether or when GitHub prunes the unreferenced `actions/attest` tag object (P3-8).
- **Desktop bundle:** that the desktop renderer bundle carries `workbox-window` (P3-5) follows
  from the static import. Only the web bundle was confirmed, by fetching kerfdesk.com. The
  refuter also found the web renderer chunk `workbox-window.prod.es5-*.js` there.
- **Not re-read here:**
  - The internals of `qualify-windows-installer.ps1` (2026-09-19 qualification audit).
  - `resolve-web-deploy-identity.mjs` (ADR-360 and earlier audits).
  - The contents checks in `verify-windows-preview-package.ps1` and
    `verify-macos-preview-package.sh` beyond the presence of `LICENSE`.
- **Merge queue:** the paths are dormant (ADR-647: a personal account cannot enable one).
- **YAML parsing:** whether GitHub's parser accepts `uses :` with a space (P3-7). The checker
  repro does not depend on it, but exploitability of that one variant does. The refuter showed
  that js-yaml accepts it; GitHub's own parser was not run.
- **Refuter limits:** the Pages token's Cloudflare scope is not visible (P3-1). No workflow was
  triggered to prove that a branch run can read the Pages secret. The `nesting-diag.yml` runs
  show only that branch workflows run on push.

Repro helpers are in this session's scratchpad (`run-exprs.mjs`, `pin-repro.mjs`, and the fetched
`sw/` files), not in the repository.

```json
[
  {"id":"P3-1","severity":"P2","area":"ci-release","file":".github/workflows/deploy.yml","line":280,"anchor":"Contract ADR-360/ADR-557 deploy only CI-verified main; Twin desktop-commercial main-only env; Ground truth GitHub hardening (writers read all repo secrets)","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"PAGES_CLOUDFLARE_API_TOKEN is a repository secret with no environment; any pushed branch workflow can publish kerfdesk.com without PR, checks or the freshness resolver; unused 'production' env exists"},
  {"id":"P3-2","severity":"P3","area":"ci-release","file":".github/workflows/release-desktop-preview.yml","line":284,"anchor":"Twin/Contract ADR-561 secrets in protected desktop-commercial env; Ground truth GitHub hardening","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Preview publish (and native qualification) jobs have no environment, so the documented Preview Ed25519 key and account-wide R2 Admin token for kerfdesk-downloads would be repo-wide (latent: not provisioned; P2 once provisioned)"},
  {"id":"P3-3","severity":"P3","area":"ci-release","file":".github/workflows/release-desktop-preview.yml","line":590,"anchor":"Contract docs/desktop-preview-distribution.md provisioning; ADR-249; ADR-522 cadence","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Preview lane has no secrets/vars and dl.kerfdesk.com/desktop/previews/latest.json is 404, yet cadence issue #1067 says 'ready to tag'; tagging publishes an irreversible immutable prerelease before the R2 step fails"},
  {"id":"P3-4","severity":"P3","area":"ci-release","file":".github/workflows/desktop-package-check.yml","line":66,"anchor":"Contract ADR-621 (gate required, PRs tested against current base); ADR-647 point 4","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Live main ruleset omits 'Desktop packaging gate' and has strict up-to-date off, contrary to ADR-621, which no ADR amends"},
  {"id":"P3-5","severity":"P3","area":"ci-release","file":"scripts/check-licenses.mjs","line":44,"anchor":"Contract ADR-017 decision 2, AGENTS.md Licence; Ground truth MIT notice condition","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Licence gate, notices and SBOM read only --prod packages; Workbox 7.4.0 runtime and workbox-window ship on kerfdesk.com unlisted and unchecked; a GPL devDependency imported by src would pass"},
  {"id":"P3-6","severity":"P3","area":"ci-release","file":"scripts/check-adr-numbers.mjs","line":52,"anchor":"Twin/Contract gate purpose (ADR-257 collision), ADR-344","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"ADR gate never keys amendments; two different 'ADR-378 Amendment 1' files pass; amendment files with '# ' headings are invisible"},
  {"id":"P3-7","severity":"P3","area":"ci-release","file":"scripts/verify-github-actions-pinning.mjs","line":19,"anchor":"Ground truth GitHub hardening pin to SHA; OpenSSF Pinned-Dependencies; Contract check:action-pins claim","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Pin check skips docker:// and misses 'uses :' and flow-mapping steps; repo sha_pinning_required is false"},
  {"id":"P3-8","severity":"P3","area":"ci-release","file":".github/workflows/release-desktop-preview.yml","line":120,"anchor":"Ground truth GitHub hardening: pin a commit SHA from the action's repository","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"actions/attest pinned to 36051bca, an annotated v4 tag object (-> v4.2.0 f7c74d28) no upstream ref references; commits API 404; breaks Preview jobs if pruned"},
  {"id":"P3-9","severity":"P3","area":"ci-release","file":"scripts/electron-builder-preview-after-pack.mjs","line":85,"anchor":"Ground truth OpenSSF Pinned-Dependencies; Twin eSigner/Artcraft SHA-256 pins, electron checksums.json","evidence":"READ","verdict":"REFUTED","known":false,"summary":"macOS packaging downloads the Electron zip with no checksum and reuses a pre-existing tmp file; its notice files ship in the app"},
  {"id":"P3-10","severity":"P3","area":"ci-release","file":".github/workflows/desktop-package-check.yml","line":22,"anchor":"Ground truth GitHub billing (free for public repos); Contract ADR-522 decision 1 / Amd 1 premise","evidence":"SOURCE","verdict":"CONFIRMED","known":false,"summary":"Native Windows/macOS packaging was removed from PRs because the repo was private; it is public again, so the cost premise is gone while the only live customer lane goes unchecked until release"},
  {"id":"P3-11","severity":"P3","area":"ci-release","file":"scripts/verify-linux-package.sh","line":76,"anchor":"Contract AGENTS.md Licence (MIT text out of root); ADR-543 Amd 1 decision 1","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Only LICENSE content is checked (packaged copy, unsigned plan); nothing stops LICENSE-MIT/COPYING/LICENSE.md returning to the root"}
]
```
