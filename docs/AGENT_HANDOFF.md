# Agent Handoff

This file is the current continuation note for Claude Code, Codex, or any other agent resuming LaserForge roadmap work without this chat transcript.

## Current State

- Branch: `master`.
- Always verify live state first with `git status --short --branch` and `git log --oneline -5`.
- Local `master` may be ahead of `origin/master` until the current agent pushes. Do not assume local equals remote.
- Last shipped roadmap item: **T1-244** (recovery reconnect/recompile acknowledgements wait for successful work, shipped in `8c34dd58`).
- Current audit-fix run completed: **T1-223 through T1-244**, with T1-237 still deferred as multi-week firmware-adapter wiring.
- Next active audit-fix ticket: none from `docs/AUDIT-2026-05-12.md`; T1-237 remains the deferred multi-week firmware-adapter wiring decision.
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
| T1-239 | F-017 | React hook dependency warnings reduced from 45 to 0 and pinned. |
| T1-240 | F-018 | `PROJECT_MAP.md` regenerated and project-map check restored. |
| T1-241 | F-019 | Full-suite runner hang fixed; per-file timeout diagnostics added; full `npm test` restored to green. |
| T1-242 | F-020 | Recovery-card buttons now acknowledge the runtime recovery checklist so Start can re-enable after real recovery. |
| T1-243 | F-021 | T3-81 end-to-end workflow suite now exits when spawned by the test runner. |
| T1-244 | F-022 | Recovery reconnect/recompile acknowledgements now wait for successful reconnect/recompile work. |

Each ticket followed the coupled-triple flow: focused code/docs change, focused verification, `docs/ROADMAP.md`, `docs/ROADMAP-shipped-audit.md`, commit, then hash-fill commit where applicable.

## Read First

1. `CLAUDE.md`
2. `.cursor/rules/laserforge.md`
3. `docs/AGENT_HANDOFF.md` (this file)
4. `docs/ROADMAP.md`
5. `docs/ROADMAP-shipped-audit.md`
6. `docs/AUDIT-2026-05-12.md`
7. `PROJECT_MAP.md` (generated; verify with `npm run project-map:check` after file additions)

## Verification Baseline

- `npx tsc --noEmit --pretty false` passed during the T1-244 close-out.
- Focused tests for T1-223 through T1-244 passed at their commits.
- Full `npm test` passed during T1-243 after the T3-81 suite natural-exit fix.
- `scripts/run-tests.mjs` now names and kills timed-out per-file children instead of wedging silently.
- `npm run project-map:check` passed during T1-240 after regenerating `PROJECT_MAP.md`.
- Dependabot PRs must not be merged blindly; previous local test-merge attempts could not be safely verified.

## Next Audit-Fix Queue

Continue in this order unless a newer owner instruction says otherwise:

1. **T1-237** - firmware adapter wiring remains deferred/multi-week.
2. Resume the normal roadmap queue after deciding whether to take T1-237 now or keep it deferred.

## Known Caveats

- Hardware verification is still required before release tagging for live laser paths called out in ROADMAP and shipped-audit rows.
- The T1-229 backfill recorded several already-shipped live UI/safety tickets; it did not newly hardware-verify them.
- The T1-230 type move kept compatibility wrappers at `src/app/SafetyActionResult.ts` and `src/app/MachineSafetyState.ts`; do not remove those wrappers until all old app/UI/tests imports are intentionally migrated.
- The trace-storm diagnostic probe row still contains a historical `<TBD>` note in `docs/ROADMAP-shipped-audit.md`; do not treat that as the active audit queue.

## Current Ticket Note

T1-242 closed F-020 by wiring recovery-card actions to `MachineService.applyRecoveryAck(...)`, adding an explicit inspection action, and making recovery actions acknowledge only after success or operator confirmation. T1-243 closed F-021 by making the T3-81 end-to-end workflow suite exit naturally under the runner. T1-244 closed F-022 by moving reconnect acknowledgement to successful USB/simulator connect and making recompile recovery wait for an awaited success/failure result. T1-237 remains deferred because firmware adapter wiring is multi-week architecture work.
