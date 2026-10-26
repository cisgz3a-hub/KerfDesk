## ADR-651 - Every workflow secret lives in a protected environment, and CI checks each read (2026-10-21)

**Status:** Accepted for the repository; moving the secrets is the owner's step (below) | **Date:** 2026-10-21
**Amends:** ADR-557 point 1 (the *Policy checks and builds* job also runs `check:secret-scopes`)
and the Preview provisioning contract of ADR-249 (`docs/desktop-preview-distribution.md`).
**Extends:** the `desktop-commercial` pattern of ADR-561 point 6 to every workflow secret.
**Fixes:** rolling audit v2 (2026-10-21) findings 11-P2-1 and 11-P3-2.

### Context

- The Cloudflare Pages token and account ID that publish kerfdesk.com
  (`PAGES_CLOUDFLARE_API_TOKEN`, `PAGES_CLOUDFLARE_ACCOUNT_ID`) are repository secrets, and the
  `deploy` job in `deploy.yml` named no environment. GitHub's hardening guide says "Any user with
  write access to your repository has read access to all secrets configured in your repository".
- Workflows that exist only on a branch run on a push to that branch here: `nesting-diag.yml`,
  never on main, ran six times on `claude/nesting-diag-scratch` (2026-10-18 and 19). Agents push
  many branches, and no ruleset covers branches other than main. So a pushed workflow could run
  `wrangler pages deploy … --project-name=laserforge --branch=main` and publish kerfdesk.com with
  no pull request, no CI and none of the freshness checks of ADR-360 and ADR-557, or copy the
  long-lived token.
- A `production` environment has existed since 2026-08-04 with no secrets, no branch policy and
  no job using it. `desktop-commercial` (main only) already holds the release signing key and R2
  credentials, and every job that reads them names it.
- The Preview publication job (`release-desktop-preview.yml` `publish-preview`) and both jobs of
  `qualify-desktop-upgrade.yml` read secrets with no environment. None of those secrets exists
  yet, so they could only have been provisioned as repository secrets. One of the Preview
  secrets is an account-wide R2 Admin token, and the account's only bucket also serves the
  commercial installers. The developer-licence job also allowed
  `refs/heads/codex/payment-launch-20261007`, a branch that no longer exists.
- GitHub gives an environment's secrets only to jobs that name that environment, and matches
  the environment's branch and tag patterns against the run's `GITHUB_REF`. A `workflow_run` run's
  `GITHUB_REF` is the default branch, which is why the unsigned release (`workflow_run` on main)
  already publishes through the main-only `desktop-commercial`. A job that names an environment
  that does not exist creates it with no protection rules and no secrets.

### Decision

1. **Each job that reads a secret names the environment that holds it.**

   | Environment | Deployment policy | Secrets | Jobs |
   | --- | --- | --- | --- |
   | `production` | `main` | `PAGES_CLOUDFLARE_API_TOKEN`, `PAGES_CLOUDFLARE_ACCOUNT_ID` | `deploy.yml` `deploy` |
   | `desktop-commercial` | `main` | the commercial release, checkout and signing secrets, plus `KERFDESK_NATIVE_QUALIFICATION_LICENCE` | as before, plus both `qualify-desktop-upgrade.yml` jobs |
   | `desktop-preview` | tags `v*-preview.*` | `PREVIEW_R2_API_TOKEN`, `DESKTOP_PREVIEW_MANIFEST_PRIVATE_KEY` | `release-desktop-preview.yml` `publish-preview` |
   | `desktop-production` | stable `v*` tags (ADR-248) | the `STABLE_*` secrets | `release-desktop-stable.yml` `build-windows` (unchanged) |

   The licence used by the qualification jobs is the one the unsigned release's `publish` job
   already reads in `desktop-commercial`, so they share that environment.
2. **Jobs keep their own ref guards.** Every job above already refuses other refs, in its `if:`
   or through the main or tag check of a job it needs. The developer-licence job drops the stale
   branch and runs on main only. The environment's
   policy is the guard that also holds against a workflow written on a branch, which can simply
   leave the `if:` out.
3. **CI checks every read.** `scripts/verify-workflow-secret-scopes.mjs`
   (`pnpm check:secret-scopes`) reads each workflow as YAML and fails when:
   - a secret is read outside a job (workflow `env`, `run-name` and the like reach every job);
   - a job reads a secret without naming the environment `SECRET_ENVIRONMENTS` assigns it, or
     names another one;
   - a secret is not in `SECRET_ENVIRONMENTS`, which is reviewed like the action pin list;
   - the secrets context is read whole or by index (`toJSON(secrets)`, `secrets['…']`);
   - a job hands secrets to a reusable workflow, which cannot name an environment there;
   - a job that reads secrets computes its environment name.

   `secrets.GITHUB_TOKEN` is exempt: GitHub issues it per run and `permissions:` scopes it. The
   check runs in CI's *Policy checks and builds* job and in `release:check`. Its tests, in
   `test:release-integrity`, also pin the `deploy` job's environment and main-only guard.
4. **The owner moves the secrets, after this merges** (AGENTS.md leaves GitHub settings to
   the owner). Until then the repository secrets still reach the `deploy` job, so merging first
   breaks nothing. Moving them before the merge would leave the current `deploy` job, which names
   no environment, without a token.
   1. Move `PAGES_CLOUDFLARE_API_TOKEN` and `PAGES_CLOUDFLARE_ACCOUNT_ID` into `production`, then
      delete the repository copies.
   2. Limit `production`'s deployment branches to `main`.
   3. When the Preview lane is provisioned, create `desktop-preview`, limit it to tags matching
      `v*-preview.*`, and add the two Preview secrets there. The qualification licence, once
      issued, goes in `desktop-commercial`.

### Consequences

- Once the secrets move, a workflow on any other branch cannot read the Pages, Preview or
  qualification credentials: a job naming one of those environments cannot run or read its
  secrets on a ref the policy does not match.
  This narrows the path rather than closing it: a token that can edit environment policies, or
  merge a pull request that needs no approval, still can.
- Each deploy run that passes the job's `if:` records a GitHub deployment to `production`,
  including runs that the freshness resolver turns into no-ops.
- A new secret needs an entry in `SECRET_ENVIRONMENTS` naming its environment.
- **Not decided here:**
  - The Preview R2 token still reaches the bucket that serves the commercial installers, so its
    environment is the only thing between a tag run and those files. A separate bucket or
    account for Preview objects is a later decision.
  - 11-P3-4: the live main ruleset no longer matches ADR-621. That is the owner's call.

References: GitHub, [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions),
[Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and [the `workflow_run` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
