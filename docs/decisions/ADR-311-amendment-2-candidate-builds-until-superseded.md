## ADR-311 Amendment 2 - A validated commit builds until something newer supersedes it, not only while it is the tip (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

Amendment 1 let a built commit publish while it is still on main, but kept the candidate
phase's tip test: a deploy run builds only if the commit CI validated is still main's tip when
the run starts. It rejected relaxing that test because "building a commit already known to be
superseded wastes the lane's serialized slot".

A newer tip does not supersede anything until it has passed CI. CI on main runs one at a time,
a newer push replaces the pending run, and a run took 33-54 minutes that day. When main merged again
before CI finished, the deploy run found its commit behind the tip and built nothing, reporting
success in about 20 seconds; the newer commit's CI was then overtaken by the next merge in the
same way. On 2026-09-23 production sat on `57a5a55a7` from 16:14Z to 20:10Z while eight commits
merged. The deploy runs for `dd4488d13` (17:09Z), `5e4d8def4` (18:03Z) and `1e4a9a1f6`
(18:36Z) all skipped as obsolete. Production moved only when `e875fe290`'s CI happened to finish
while it was still the tip. The next two validated commits (`5eaa9d483`, `e461557e4`) were
skipped the same way, and production reached main only at 23:16Z, after merges paused.

### Decision

1. **Main's tip builds, as before.**
2. **A commit main has moved past also builds when nothing supersedes it:** it is still on main,
   no newer commit on main has passed CI, and production serves a strict ancestor of it. A newer
   commit that has passed CI has its own deploy run queued behind this one (or already run), so
   it would supersede this build. The ancestor test means a build only ever moves production
   forward.
3. **Lane evidence.** `scripts/web-deploy-lane-evidence.mjs` gathers the facts from GitHub's
   own records with read-only `actions: read`: the 30 most recent successful CI runs on main,
   and the newest completed deploy run whose **Publish to Cloudflare Pages** step succeeded,
   identified by the commit its `release-readiness-deploy-<sha>` artifact names. Git places
   each commit relative to main. Like the resolver, it is read from the protected-main control
   revision, and it contacts no provider, so a candidate that does not build stays
   provider-free.
4. **Failures narrow, never widen.** An API error, a malformed answer, a publication that does
   not name exactly one commit, or no publication among the last 30 deploy runs is recorded, and
   the candidate then builds only if it is main's tip. The evidence script never fails the step,
   so main's tip still publishes during an outage, and it raises a workflow warning. A malformed
   evidence file makes the resolver throw, as a misspelled `--checkout-on-main` does.
5. **Unchanged:** the publication phase (Amendment 1), the serialized `queue: max` lane,
   control code from protected main, and manual dispatch of current main. A dispatch whose
   checkout raced a merge follows the same candidate rules.

### Consequences

- During a busy period production trails main by about one CI run plus one or two deploy gates,
  instead of waiting for a quiet gap in merges.
- An older candidate queued behind a newer validated commit skips in seconds, so the queue
  cannot back up.
- Each deploy run makes a few read-only GitHub API calls, usually four, and logs the evidence.
- **Remaining blind spot:** a publication outside this lane (a local `pnpm deploy:web`, a
  dashboard rollback) is not in the lane's records. A lane build can replace it with an older
  validated commit until the next deploy. Under the tip-only rule, the lane could replace it
  only with main's tip.
- If a newer validated commit's own deploy fails, production waits for the next validated
  commit or a rerun, as before.

### Alternatives rejected

- **Read production from kerfdesk.com or the Cloudflare API.** The live site exposes the
  commit only in its About text, unless the build adds a marker, and the runner must be able to
  reach the site. The Cloudflare API needs the deploy token in the candidate step, which clause
  4 keeps provider-free. The lane's own GitHub records can also be tested before merge.
- **Remove the duplicated `pnpm release:check`.** It shortens every deploy, but the candidate
  test runs when CI finishes, so a merge during CI still made the commit obsolete.
- **Build every validated commit in order.** Whenever CI finishes faster than a roughly
  50-minute deploy, the queue grows, and production lag grows with it.
- **Cancel pending deploys instead of queueing them.** Clause 4 keeps `queue: max` so an
  obsolete rerun cannot replace an eligible run before it is classified.

### Verification

- `scripts/resolve-web-deploy-identity.test.mjs` (19 tests) covers the new verdicts: a
  superseded commit, production already at or past the commit, unknown production, unavailable
  evidence, a commit that left main, missing or malformed evidence, and the command-line wiring.
  `scripts/web-deploy-lane-evidence.test.mjs` (13 tests) covers the lookups against a fake API
  and commit graph, a throwaway git repository, and a local server that answers 503.
  `src/platform/web/deploy-workflow-gate.test.ts` pins the wiring and the permissions.
- Dry run against the real API and history: `5eaa9d483` is superseded by `025dc9b8d`, which
  deploy run 35928026121 published; `025dc9b8d` builds as the tip.
- Replay of 2026-09-23 with real history: the 17:09Z and 18:03Z candidates that the tip rule
  skipped would build, and an old rerun of `dd4488d13` is still refused.
- **NOT verified:** no deploy run has yet built a commit main moved past. The next deploy run
  logs its evidence, which exercises the permissions and API reads.
