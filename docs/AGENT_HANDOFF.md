# Agent Handoff

This file is the current continuation note for Claude Code, Codex, or any other agent resuming LaserForge roadmap work without this chat transcript.

## Current State

- Branch: `master`.
- Always verify live state first with `git status --short --branch` and `git log --oneline -5`.
- Local `master` may be ahead of `origin/master` until the current agent pushes. Do not assume local equals remote.
- Last shipped roadmap item: **T1-252** (pause laser-off confirmation, shipped in `379e623e`).
- Current audit-fix run completed: **T1-223 through T1-252**, with T1-237 still deferred as multi-week firmware-adapter wiring.
- Next active audit-fix ticket: continue the release-readiness audit sequence with the next runtime-enforcement cap after pause laser-off confirmation: support-bundle export or signed entitlement authority.
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
| T1-245 | user report | Long GRBL jobs keep streaming by treating `ok` acknowledgements as heartbeat-alive traffic and pausing autosave work while jobs run. |
| T1-246 | release-readiness audit | Runtime `JobFingerprint` is embedded in `ValidatedJobTicket` and revalidated inside `MachineService.startValidatedJob` before G-code streams. |
| T1-247 | release-readiness audit | `MachineService.startValidatedJob` now requires no active temporary operation, laser output confirmed off, and `SafetyState === safeIdle`. |
| T1-248 | user report / GRBL streaming audit | Running-job heartbeat now warns on delayed status and hard-aborts only after sustained no-controller-RX silence. |
| T1-249 | user report / trace audit | Trace contours no longer force-close far-apart endpoints, reducing accidental straight closure burns from noisy image traces. |
| T1-250 | release-readiness audit | Autosave recovery state is separated from manual project save truth, so autosave no longer marks the user file clean. |
| T1-251 | release-readiness audit | Start now requires service-level FrameTicket proof or an explicit logged Start-without-framing override. |
| T1-252 | release-readiness audit | Pause now awaits M5 S0 laser-off confirmation and failed pause laser-off latches unsafe/unknown state. |

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

- `npx tsc --noEmit --pretty false` passed during the T1-252 close-out.
- Focused tests for T1-223 through T1-252 passed at their commits.
- Full `npm test` passed during T1-252 after updating stale source-level pins and generated audit docs.
- `npm run build`, `npx eslint . --max-warnings 0`, `npm run project-map:check`, `node scripts/exported-symbol-inventory.mjs --check`, and `git diff --check` passed during the T1-252 close-out.
- `scripts/run-tests.mjs` now names and kills timed-out per-file children instead of wedging silently.
- `npm run project-map:check` passed during T1-240 after regenerating `PROJECT_MAP.md`.
- Dependabot PRs must not be merged blindly; previous local test-merge attempts could not be safely verified.

## Next Audit-Fix Queue

Continue in this order unless a newer owner instruction says otherwise:

1. **Support bundle export** - wire the existing bundle assembler to a user-exportable ZIP.
2. **Signed entitlement authority** - replace local/cache-authoritative licensing with signed entitlement tokens.

## Known Caveats

- Hardware verification is still required before release tagging for live laser paths called out in ROADMAP and shipped-audit rows.
- The T1-229 backfill recorded several already-shipped live UI/safety tickets; it did not newly hardware-verify them.
- The T1-230 type move kept compatibility wrappers at `src/app/SafetyActionResult.ts` and `src/app/MachineSafetyState.ts`; do not remove those wrappers until all old app/UI/tests imports are intentionally migrated.
- The trace-storm diagnostic probe row still contains a historical `<TBD>` note in `docs/ROADMAP-shipped-audit.md`; do not treat that as the active audit queue.

## Current Ticket Note

T1-242 closed F-020 by wiring recovery-card actions to `MachineService.applyRecoveryAck(...)`, adding an explicit inspection action, and making recovery actions acknowledge only after success or operator confirmation. T1-243 closed F-021 by making the T3-81 end-to-end workflow suite exit naturally under the runner. T1-244 closed F-022 by moving reconnect acknowledgement to successful USB/simulator connect and making recompile recovery wait for an awaited success/failure result. T1-245 fixed the user-reported long-job stop/disconnect path by keeping heartbeat alive on `ok` acknowledgements and pausing autosave work during jobs. T1-246 closed the largest stale-output audit cap by making `JobFingerprint` part of `ValidatedJobTicket` and the service-level Start validator. T1-247 made Start require service-level safe-idle gates. T1-248 made running-job heartbeat tolerant of short status delays while still aborting true silence. T1-249 hardened trace conversion against accidental straight closure burns. T1-250 separated autosave recovery truth from manual project-file dirty state. T1-251 moved frame freshness into the final start path by requiring `FrameTicket` proof or a logged unframed-start override. T1-252 made pause-time laser-off confirmation load-bearing: `GrblController.pause()` awaits M5 S0, `operations.pauseJob()` carries the structured `SafetyActionResult`, and `MachineService.pause()` latches failed laser-off as unsafe/unknown. T1-237 remains deferred because firmware adapter wiring is multi-week architecture work.
