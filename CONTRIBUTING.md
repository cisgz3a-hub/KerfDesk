# Contributing to KerfDesk (LaserForge 2.0)

KerfDesk is MIT-licensed (ADR-120); by submitting a contribution you agree it is licensed under the project's MIT license. The project is shipped through Phase K (laser MVP plus text/trace/raster, drawing tools, CNC/router, multi-controller, camera, and box generator) and under active development. CI gates (`.github/workflows/ci.yml`) are live: typecheck, lint, prettier, dependency-license and vulnerability checks, Vitest, Playwright browser workflows, web/Electron builds, and file-size discipline. Deploys auto-fire to Cloudflare Pages on green CI (`.github/workflows/deploy.yml`).

## Non-negotiable: Frame is the only guard — never add a new one

**No new guard may ever be added to this codebase. Hard rule, no exceptions**
(maintainer, 2026-07-17; `CLAUDE.md` collaboration rule 7, `PROJECT.md`
non-negotiable #21, `DECISIONS.md` ADR-228 clarified by ADR-232). A *guard* is any
behavior that blocks, refuses, gates, caps, clamps, delays, hides, disables,
rewrites, or adds a confirmation before an otherwise-available action, input,
output, machine command, job start, preview, save, import, export, or G-code
emission. The single Start guard is the frame-first gate (a completed Frame for the
exact current job opens Start on laser and CNC); the Job Review dialog is the only
warning surface, and it informs — it never refuses. Do not add a guard, re-add a
deleted one, expand a refusal surface, or promote a warning into a block — not for
"safety," not for "defense in depth," not with a test or an ADR. **A PR that adds a
guard will be rejected on sight.** The only refusals permitted to exist are the
three factual categories defined in `CLAUDE.md` rule 7 — transport preconditions,
compile integrity, and handoff consistency; relabeling a policy judgment as one of
them is itself a violation. Widening any refusal, or adding a new one, requires the
maintainer's explicit prior permission in chat, which must be presumed denied.

## Before you open a PR

1. Read [`CLAUDE.md`](./CLAUDE.md) — file-size limits, naming, anti-patterns, checklists. These rules are enforced by ESLint and CI, not by reviewer judgment.
2. Read [`PROJECT.md`](./PROJECT.md) — the current phase and scope. Anything outside the current phase needs a `PROJECT.md` revision and a `DECISIONS.md` entry before code lands.
3. Read [`WORKFLOW.md`](./WORKFLOW.md) — if your change touches UI, the success / error / empty / edge states for the affected flow must already be documented (or you must update this file first).
4. Read [`DECISIONS.md`](./DECISIONS.md) — architectural changes (module boundaries, state shape, build setup) require a new ADR.
5. Read [`SECURITY.md`](./SECURITY.md) before reporting or testing a security-sensitive issue.

## Process gates

- **Scope changes:** require a `PROJECT.md` revision.
- **Architectural changes:** require a new ADR in `DECISIONS.md` (format: match ADR-017's structure — Context, Decision, Alternatives considered, Consequences, Verification).
- **New runtime dependencies:** require a `RESEARCH_LOG.md` entry (license, version, source, alternatives, evaluation date) before the PR that imports the library can merge. ADR-017 governs this policy.
- **G-code output changes:** require an explicit `Snapshot change acknowledged: <reason>` line in the PR description.

## What lands without an ADR

- Bug fixes with a failing test that demonstrates the bug, then passes after the fix.
- Refactors that change nothing user-visible and nothing in the public module API.
- Documentation polish.

If you're unsure whether your change needs an ADR, open an issue first.

## PR title

Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`.
