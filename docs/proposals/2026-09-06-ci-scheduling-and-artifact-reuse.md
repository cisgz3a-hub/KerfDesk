# CI scheduling and artifact reuse: preserved proposal

**Status: unapplied historical proposal, pending current-main design and validation.** This document
preserves the intended CI work from `codex/faster-ci`. It does not change a workflow, establish a
speed improvement, or assign an accepted ADR. The companion `.patch.txt` is an exact historical diff
against the donor's old HEAD, not a patch approved for current main. Its old version tags, credential
names, status wording and timing estimates are archived evidence, not current instructions.

## Source and current baseline

The original task asked whether CI could finish faster without redoing the same work, then approved
implementation on 2026-07-19. The donor remained dirty at
`36aff28b0fac03e03679b443cf046a6aafed938a`, the merged
[PR299](https://github.com/cisgz3a-hub/KerfDesk/pull/299) commit. It contains seven authored paths and
13 hunks, plus two unrelated instruction copies that are excluded from the historical diff. The
source manifest records exact hashes and the disposition of every authored hunk.

The review baseline is current main `00abb56e151332a85d9f9673ed6a5e0fae3faaef`, refreshed on
2026-09-06. CI still runs the serial `pnpm release:check`. The exact-main successful
[CI run](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/34013973246) spent 2,239 seconds in its
release step, 10 seconds installing dependencies, and 2,268 seconds in the job overall. The workflow
also waited about 11 minutes before that job started. The API exposes the whole release step, not
current per-command costs. These observations do not validate the donor's old 21-minute baseline,
four-shard speed estimate, runner availability or billing assumptions.

## Preserved scheduling objective

The intended change runs static checks, four Vitest file shards, web build and Electron build in
parallel, then uses an aggregate named **Lint, typecheck, license, test, build** to require every lane
to succeed. The current `release:check` remains the serial local/manual/release authority. A future
port must preserve all 14 current commands collectively:

| Proposed lane | Current commands to preserve |
| --- | --- |
| Static/policy | `pnpm typecheck`, `pnpm lint`, `pnpm lint:electron`, `pnpm format:check`, `pnpm check:adr-numbers`, `pnpm check:action-pins`, `pnpm license-check`, `pnpm test:release-integrity`, `pnpm check:file-size`, `pnpm check:soft-size`, `pnpm check:index-exports` |
| Unit tests | `pnpm test`, with a separately proved equivalent four-shard execution |
| Web build | `pnpm build:web`, including notice generation and its current nested checks |
| Electron build | `pnpm build:electron-main` |

This is a paper mapping, not an implemented replacement. `test:release-integrity` currently invokes
12 Node test scripts outside Vitest; sharding Vitest does not cover them. The old split omitted that
command, ADR numbering and action-pin verification. It also predated SHA-correlated readiness
reporting. Preserve the full commands initially; the donor's separate removal of nested web
typechecking needs parity evidence before adoption.

Vitest documents sharding by test file rather than individual test case. Four shards therefore do
not promise equal work or a fourfold improvement. Keep the repository's existing one-worker CI
policy and prove the actual executed file union at a fixed SHA and lockfile, rather than treating a
file listing as execution evidence. [Vitest sharding](https://vitest.dev/guide/improving-performance.html).

Current main does not cancel an in-progress main CI run, following
[PR324](https://github.com/cisgz3a-hub/KerfDesk/pull/324). Keep that policy, current branch triggers and
the established aggregate check name. Do not import the donor's inherited unconditional
cancellation. The old Markdown/docs trigger exclusions remain unapplied: ADR and document-policy
checks still matter, and required workflows skipped by path filters can remain pending.
[GitHub trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The donor's blocking `audit:deps` command is superseded by
[PR403 / ADR254](https://github.com/cisgz3a-hub/KerfDesk/pull/403). Retain the separate scheduled audit
and current merge/deploy gate. No `depcheck` script exists in current package scripts, and this
proposal adds no dependency-check tool. Keep the existing reviewed full-SHA action allowlist; the
historical workflow snapshots have 22 references rejected by that current policy.

## Separate artifact-reuse objective

The historical design uploads a full-history web build and later downloads it by triggering run id
and commit SHA. Manual deploy continues to rebuild and run the complete release check. Avoiding a
second build is still a useful objective to review, but a matching artifact name and `index.html`
are insufficient provenance.

Any future reuse must preserve all [PR705](https://github.com/cisgz3a-hub/KerfDesk/pull/705) controls:

- The `deploy-production-main` serialized production lane with `queue: max`.
- Current-main control code for candidate eligibility, before candidate-tree scripts run.
- Exact candidate/validated/current-main identity and a second freshness check immediately before
  publication; obsolete or superseded runs remain provider-free non-deployments.
- Manual dispatch selecting current main and rerunning the full release check.
- Pages-only credential names and current provider scopes, reviewed action pins and canonical
  repository/project identity.
- SHA-correlated readiness reports that distinguish upstream CI evidence from a local rebuild and
  record browser, package, perceptual and hardware lanes without inventing observations.

`queue: max` is materially different from the donor's replaceable single-pending-run group and is
retained. [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The future artifact contract must bind the producing repository, workflow, run and attempt, exact
source revision, artifact identity and verified content. The old `overwrite: true` name reuse does
not establish attempt identity. Missing, expired, wrong-run, wrong-attempt or mismatched bundles
must not silently become an unverified rebuild or provider call. GitHub documents a warning on
artifact-digest mismatch, so the historical claim that the download action necessarily fails is
not established. Explicit rejecting verification needs design and tests.
[GitHub artifact validation](https://docs.github.com/actions/configuring-and-managing-workflows/persisting-workflow-data-using-artifacts?azure-portal=true).

Browser smoke remains a separate observed lane and is not added as a production-deploy dependency.
This proposal preserves the existing production policy; it does not approve new credentials,
permission scope, provider behavior or desktop-release changes.

## Validation required before active workflow publication

1. Port scheduling alone in an isolated current-main checkout. Prove the current command set is
   represented, including all release-integrity scripts, and retain pinned actions, triggers and
   readiness reporting. Use YAML-aware contract checks and the repository pin verifier; a single
   substring assertion for a file-size command is insufficient.
2. Run the actual four complete Vitest shards at the same SHA, lockfile, configuration and worker
   policy. Save per-shard executed file identities and outcomes; prove no missing or duplicate test
   files, all relevant projects, and failure propagation for failed, cancelled or skipped lanes.
   Record runtime and runner cost before making a performance claim.
3. Prove the aggregate always emits the existing named check and cannot pass while any required
   lane or shard did not succeed. Readiness evidence must identify the new distributed execution
   truthfully, including failed or cancelled runs.
4. Review artifact reuse separately. Exercise missing/expired/mismatched artifacts, full and partial
   reruns, wrong attempts, main advancing before and after verification, obsolete control code,
   manual rebuild and readiness outcomes with a provider stub. Prove content rejection and exact
   provenance; do not infer either from an artifact name or successful download.
5. Only after local contracts pass, obtain separate hosted evidence at the exact proposed head.
   Compare executed coverage, queue time, critical-path time and total runner minutes against a
   comparable serial baseline. Provider publication remains outside this preservation proposal.

The current review performed immutable source/hunk comparison, six YAML parses, a 14-command
mapping and the existing pure action-pin checker against current and donor snapshots. It inspected
published PR metadata and one successful current-main run. It did not run test shards, invoke a
remote workflow, change repository workflows, use provider credentials or deploy anything.

The historical ADR235 index/body and PROJECT shipped-status edits are preserved only in the
unapplied attachment. Current ADR235 already concerns laser Raster/Image trace output. They must
not replace current product status or be presented as an accepted CI decision.
