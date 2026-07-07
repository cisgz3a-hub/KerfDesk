# Contributing to KerfDesk (LaserForge 2.0)

KerfDesk is MIT-licensed (ADR-118); by submitting a contribution you agree it is licensed under the project's MIT license. The project is shipped through Phase K (laser MVP plus text/trace/raster, drawing tools, CNC/router, multi-controller, camera, and box generator) and under active development. CI gates (`.github/workflows/ci.yml`) are live: typecheck, lint, prettier, license-check, vitest, build, file-size discipline. Deploys auto-fire to Cloudflare Pages on green CI (`.github/workflows/deploy.yml`).

## Before you open a PR

1. Read [`CLAUDE.md`](./CLAUDE.md) — file-size limits, naming, anti-patterns, checklists. These rules are enforced by ESLint and CI, not by reviewer judgment.
2. Read [`PROJECT.md`](./PROJECT.md) — the current phase and scope. Anything outside the current phase needs a `PROJECT.md` revision and a `DECISIONS.md` entry before code lands.
3. Read [`WORKFLOW.md`](./WORKFLOW.md) — if your change touches UI, the success / error / empty / edge states for the affected flow must already be documented (or you must update this file first).
4. Read [`DECISIONS.md`](./DECISIONS.md) — architectural changes (module boundaries, state shape, build setup) require a new ADR.

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
