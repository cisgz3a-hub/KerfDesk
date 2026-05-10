# Agent Handoff

This file captures the current continuation state for Claude Code or any other
AI coding agent that picks up the LaserForge roadmap work without access to the
chat transcript.

## Current State

- Branch: `master`.
- Repo state at handoff: clean; local `master` equals `origin/master`.
- Current HEAD: `3b049b2` (`docs(roadmap): fill T3-42 ship hash`).
- Last shipped roadmap item: `T3-42` Dialect-specific preflight / template validators.
- Next roadmap item: `T3-43` Controller simulator / test matrix.

## What To Read First

1. `CLAUDE.md`
2. `.cursor/rules/laserforge.md`
3. `docs/ROADMAP.md`
4. `docs/ROADMAP-shipped-audit.md`
5. `PROJECT_MAP.md`

The roadmap and shipped-audit docs are current through T3-42. T3-43 is still
open in both files.

## Continuation Notes

- A paused T3-43 scratch test under `tests/controller-matrix/` was removed. No
  partial T3-43 code or docs are intentionally left in the tree.
- Do not merge Dependabot PRs blindly. Most open Dependabot PRs had failing
  checks at this handoff.
- Dependabot PR #3 was green on GitHub, but a local no-commit test merge was
  aborted because full `npm test` timed out, and a direct run of
  `tests/end-to-end-workflows/end-to-end-workflows.test.ts` also timed out.
- On clean `master`, `npm ci` completed and
  `npx tsc --noEmit --pretty false` passed.

## Expected Next Step

Continue strict roadmap order with T3-43. A reasonable T3-43 slice is a focused
controller-matrix test harness under `tests/controller-matrix/` that reuses the
existing controller contracts, simulator framework, operation gates, and
family-agnostic ticket helpers. Keep production behavior unchanged unless the
test matrix exposes a real missing seam.
