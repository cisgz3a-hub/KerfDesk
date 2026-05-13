# Agent Handoff

This file is the current continuation note for Claude Code, Codex, or any other agent resuming LaserForge roadmap work without this chat transcript.

## Current State

- Branch: `master`.
- Always verify live state first with `git status --short --branch` and `git log --oneline -5`.
- Local `master` may be ahead of `origin/master` until the current agent pushes. Do not assume local equals remote.
- Last shipped roadmap item: **T1-238** (no-skip exported-symbol audit inventory, shipped in bdf928ac).
- Current audit-fix run completed: **T1-223 through T1-238**, with T1-237 still deferred as multi-week firmware-adapter wiring.
- Next active audit-fix ticket: **T1-239** - F-017 hook dependency triage.
- Do not stage `.claude/`; it is local agent state and may be untracked.

## What Just Shipped In This Run

The audit response queue from `docs/AUDIT-2026-05-12.md` has shipped these fixes:

| Ticket | Finding | Status |
|---|---|---|
| T1-223 | F-010 | Service-side placement-uncertain gate for Start. |
| T1-224 | F-011 | Production pipeline now wires profile capability overrides. |
| T1-225 | F-007 | Scene dirty hash moved from app to core scene. |
| T1-226 | F-012 | PathOptimizer no longer uses wall-clock budget for emitted order. |
| T1-227 | F-009 | PreflightContext extracted; rule files no longer import their orchestrator. |
| T1-228 | F-005 | JobCompiler runtime helpers moved out of plan layer. |
| T1-229 | F-014 | ROADMAP and shipped-audit backfilled for T1-209..T1-222. |
| T1-230 | F-006 | Controller shared safety types moved out of app layer. |
| T1-231 | F-015 | This handoff refreshed so future agents do not resume from T1-202. |
| T1-232 | F-003 | Production diagnostic breadcrumbs routed through structured logging. |
| T1-233 | F-002 | WebSerialPort catch paths typed as unknown. |
| T1-234 | F-001/F-004 | Eslint cleanup sweep removed stale disables and renamed the hook-shaped SVG helper. |
| T1-235 | F-008 | Core Date.now / Math.random callsites reviewed and pinned by a source-level guard. |
| T1-236 | F-013 | Inline core ID generators routed through deterministic-aware `generateId()`. |
| T1-238 | F-016 | No-skip exported-symbol inventory generated and pinned against drift. |

Each ticket followed the coupled-triple flow: focused code/docs change, focused verification, `docs/ROADMAP.md`, `docs/ROADMAP-shipped-audit.md`, commit, then hash-fill commit where applicable.

## Read First

1. `CLAUDE.md`
2. `.cursor/rules/laserforge.md`
3. `docs/AGENT_HANDOFF.md` (this file)
4. `docs/ROADMAP.md`
5. `docs/ROADMAP-shipped-audit.md`
6. `docs/AUDIT-2026-05-12.md`
7. `PROJECT_MAP.md` (currently stale per F-018; do not rely on it without regenerating/checking)

## Verification Baseline

- `npx tsc --noEmit --pretty false` passed during the T1-223..T1-238 run.
- Focused tests for T1-223 through T1-238 passed at their commits.
- Full `npm test` currently times out under F-019. Do not report full-suite green until F-019 is fixed.
- `tests/end-to-end-workflows/end-to-end-workflows.test.ts` passes when run directly, but the full runner can hang waiting on it.
- `npm run project-map:check` was stale under F-018 before this run; regenerate/check when reaching T1-240.
- Dependabot PRs must not be merged blindly; previous local test-merge attempts could not be safely verified.

## Next Audit-Fix Queue

Continue in this order unless a newer owner instruction says otherwise:

1. **T1-237** - firmware adapter wiring remains deferred/multi-week.
2. **T1-239** - F-017: hook dependency triage.
3. **T1-240** - F-018: regenerate/check `PROJECT_MAP.md`.
4. **T1-241** - F-019: diagnose/fix the full-suite test runner hang.

## Known Caveats

- Hardware verification is still required before release tagging for live laser paths called out in ROADMAP and shipped-audit rows.
- The T1-229 backfill recorded several already-shipped live UI/safety tickets; it did not newly hardware-verify them.
- The T1-230 type move kept compatibility wrappers at `src/app/SafetyActionResult.ts` and `src/app/MachineSafetyState.ts`; do not remove those wrappers until all old app/UI/tests imports are intentionally migrated.
- The trace-storm diagnostic probe row still contains a historical `<TBD>` note in `docs/ROADMAP-shipped-audit.md`; do not treat that as the active audit queue.

## Current Ticket Note

T1-238 closed F-016's inventory gap by adding `scripts/exported-symbol-inventory.mjs`, `docs/AUDIT-EXPORTED-SYMBOL-INVENTORY.md`, and `tests/exported-symbol-inventory.test.ts`. The inventory currently covers 2,622 exported symbols across 481 `src/` and `electron/` files and intentionally does not overclaim that each row has already received a full manual deep review. T1-237 remains deferred because firmware adapter wiring is multi-week architecture work; the next active ticket is T1-239.
