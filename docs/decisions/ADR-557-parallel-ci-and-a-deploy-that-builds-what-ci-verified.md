## ADR-557 - CI and Browser smoke run as parallel jobs, and the deploy builds the commit CI verified without re-running its gate (2026-09-29)

**Status:** Implemented | **Date:** 2026-09-29
**Amends:** D-S02-003 (the one-worker Vitest throttle in `src/__fixtures__/vitest-workers.ts`),
ADR-158 (Browser smoke's single job) and the duplicated deploy gate that ADR-311 Amendment 1 and
ADR-360 left "for its own decision". **Implements:** TST-12 of
`docs/audits/2026-07-10-implementation-plan.md` and the scheduling half of
`docs/proposals/2026-09-06-ci-scheduling-and-artifact-reuse.md`; it does not reuse artifacts.

### Context

The maintainer asked whether CI could be faster. The runs of 2026-09-29 show where the time went:

- **CI** ran `pnpm release:check` as one serial chain. On `main` for #1019 it took 77 minutes, 69
  of them in `vitest run` (3,186 files, 23,777 tests) on one worker. Type-check, lint, format
  and both builds took about 8 minutes together.
- **Browser smoke** took 49 minutes, 45 of them running 259 Playwright tests one at a time.
- **The deploy** ran the whole `release:check` again on the commit CI had just passed (50 to 93
  minutes). A merge reached kerfdesk.com about 2 hours 15 minutes later: #1022 merged at 07:33
  and was published at 09:45, #1023 merged at 08:52 and was published at 11:11.

Vitest ran one worker because the private repository's 2-vCPU runner had starved Vitest's
orchestrator with more (D-S02-003: `Timeout calling "onTaskUpdate"`). The repository is public
now, and its `ubuntu-latest` runners have 4 vCPUs (the Browser smoke log reports
`hardwareConcurrency: 4`). They cost nothing while the repository stays public.

### Decision

1. **CI runs the release gate as parallel jobs** (`.github/workflows/ci.yml`):
   - *Typecheck, lint and format*: `typecheck`, `lint`, `lint:electron`, `format:check`.
   - *Policy checks and builds*: ADR numbers, action pins, licences, `test:release-integrity`,
     `build:web`, `build:electron-main`, and the file-size, soft-size and index-export checks.
   - *Unit tests (1/4 to 4/4)*: `pnpm test --shard=i/4`. Vitest assigns each test file to one
     shard by a hash of its path, so every file runs exactly once.
   - *Lint, typecheck, license, test, build*: needs every job above, runs even when one failed or
     was cancelled (`if: always()`), and passes only when every one of them passed. It keeps the
     old check's name, so a ruleset that requires it, and `deploy.yml`, which starts on a
     successful CI run, still mean the whole gate passed. It records the readiness report.

   `release:check` stays the one serial command for local runs and for manual deploys.
   `scripts/ci-parallel-gate.test.mjs` reads both workflows as YAML and fails when a
   `release:check` command runs in no CI job, when the gate does not wait for every job or could be
   skipped, or when the shards are not numbered 1..N.

2. **Vitest uses half a CI runner's cores**: 2 workers on the 4-vCPU public runners, 1 on a 2-vCPU
   private runner (as before), and 4 locally as before. Half leaves two cores for the orchestrator
   and V8's background threads, so a timing-sensitive test sees about the load it sees alone.

3. **Browser smoke runs the suite in four shards** (`.github/workflows/e2e.yml`), each on its own
   runner with one Playwright worker and one Vite server, as the single job had. Each shard first
   runs the cold start check, which leaves Vite's dependency cache warm as it was for the whole
   suite before. One more job runs the checks that run once: the browser test type-check and
   discovery, cold start and viewer responsiveness, and the production-bundle smoke. The job named
   *Chrome UX smoke* needs all of them and passes only when all passed. Browser smoke is still not
   a deploy dependency (ADR-158).

4. **The deploy builds a CI-verified candidate without running the gate again**
   (`.github/workflows/deploy.yml`). A `workflow_run` deploy starts only after the push CI run on
   `main` succeeded, and checks out that run's exact commit (M33, ADR-360); that run passed every
   `release:check` command. The deploy now runs `pnpm build:web` for it instead of
   `pnpm release:check`. A manual dispatch has no CI run behind it and still runs
   `pnpm release:check`. Candidate selection, both freshness checks, the serialized `queue: max`
   lane and the Pages-only credentials are unchanged. The readiness report names the CI run that
   passed the gate (`gate-ran-in=validated-run`), and a failed build reports a failed deploy.

### Consequences

- What is verified before a commit merges or publishes is unchanged: every `release:check`
  command runs once on that exact commit before its deploy, and nothing is skipped or sampled.
- Expected times: about 10 minutes for CI and 15 for Browser smoke, down from 77 and 49; a merge
  reaches production about 15 minutes after it lands, down from about 2 hours 15 minutes. The
  measured times from this change's own runs are under Verification.
- A push starts up to 12 jobs at once instead of 3 to 6. GitHub Free runs 20 jobs at a time per
  account, so two pushes in the same minute queue for a few minutes.
- If the repository goes private again, Vitest drops to 1 worker per shard and runs take longer.
  The shards still run in parallel, and each extra job adds about a minute of setup to the
  billed minutes.
- The new job names (the shards, *Typecheck, lint and format*, *Policy checks and builds*) need
  not be required checks; the two gate names cover them.
- **Residual risks:**
  - Shards are balanced by file count (Vitest) and test count (Playwright), not by duration, so
    one shard with several slow files finishes last.
  - A test that passes alone and fails under load could fail with 2 workers where it passed with
    1. Such a failure is a flaky test to fix, not a reason to drop a worker.
  - Browser shards each start their own Vite server, so the first page load in each shard pays for
    module transformation, as the first test of the single job did.

### Alternatives rejected

- **Larger paid runners.** They cost money and still leave a serial chain; the free 4-vCPU
  runners were idle for three of their four cores.
- **One worker per shard with more shards.** It needs twice the jobs for the same time, which hits
  the 20-job limit sooner.
- **Three workers per shard.** A 202-file sample ran 2.65 times faster than one worker, against
  1.87 times for two, but load-sensitive tests have failed under three workers in cloud sessions.
  Two keep the CI job shorter than Browser smoke, which sets the time anyway.
- **Reuse CI's `dist/web` in the deploy.** It saves about two minutes and needs the artifact
  provenance design in the 2026-09-06 proposal. Rebuilding the verified commit keeps the deploy's
  inputs to the commit itself.
- **Drop the duplicated early viewer check or the extra cold starts.** They run in parallel and
  cost no time on the critical path.

### Verification

- `scripts/ci-parallel-gate.test.mjs` (in `test:release-integrity`) passes, and fails for each of
  nine deliberate breakages of the workflows: a missing `release:check` command, a gate that does
  not wait for one job, a gate that runs only on success, a gate that ignores failed results, a gap
  in the shard numbers, fail-fast shards, a Browser smoke gate that skips the checks job, a missing
  production-bundle smoke and shards without the cold start.
- `deploy-workflow-gate.test.ts` pins the build-only path to `workflow_run` candidates, the full
  gate to manual dispatch and the readiness fields; `vitest-workers.test.ts` pins the worker count
  for 1, 2, 4, 5 and 8 cores.
- Vitest's own sequencer, called through its Node API, put the 3,233 test files in shards of
  809, 808, 808 and 808, with none missing and none repeated. `playwright test --list` with
  `--shard=1/4` to `4/4` listed 65, 65, 67 and 62 tests: all 259 of the suite, each once.
- The gate's verdict script passed for all-success results and failed for `failure`,
  `cancelled` and `skipped` results and for unreadable input.
- Measured locally on 4 cores, one 202-file shard: 422 s with 1 worker, 226 s with 2, 159 s
  with 3, all tests passing each time.
