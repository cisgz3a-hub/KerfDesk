# Agent Handoff

This file is the current continuation note for Claude Code, Codex, or any other agent resuming LaserForge roadmap work without this chat transcript.

## Current State

- Branch: `master`.
- Always verify live state first with `git status --short --branch` and `git log --oneline -5`.
- Local `master` may be ahead of `origin/master` until the current agent pushes. Do not assume local equals remote.
- Last shipped roadmap item: **T3-91 follow-up** (unsafe-at-connect live panel wiring, implementation hash `<TBD>` until the docs hash-fill commit lands).
- Current audit-fix run completed: **T1-223 through T1-260**, with T1-237 still deferred as multi-week firmware-adapter wiring.
- Next active audit-fix ticket: finish actual entitlement server deployment/secret-store configuration outside this repo, or continue with the next release-pipeline blocker that can be completed in-repo.
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
| T1-253 | release-readiness audit | Support bundle export now creates a real ZIP through Settings -> About with Electron save and browser download fallback. |
| T1-254 | release-readiness audit | Local entitlement cache now grants Pro only when it verifies as a signed entitlement token; raw cache JSON is no longer authority. |
| T1-255 | release-readiness audit | WebCrypto ES256 public-key verifier added and wired into the production entitlement singleton via Vite env config. |
| T1-256 | release-readiness audit | WebCrypto ES256 private-key signer added for server entitlement adapters with server-only env config. |
| T1-257 | release-readiness audit | Installer workflows now generate and upload SHA256SUMS beside unsigned and signed installer artifacts. |
| T1-258 | release-readiness audit | Installer workflows now generate and upload CycloneDX SBOMs beside unsigned and signed installer artifacts. |
| T1-259 | release-readiness audit | Signed release workflows now generate GitHub provenance and SBOM attestations for installer artifacts. |
| T1-260 | release-readiness audit | Signed release workflows can opt in to draft GitHub Release publishing with platform-specific checksum/SBOM assets. |
| T3-85 | release-readiness audit | Installer QA matrix now lives in `docs/INSTALLER-QA.md` with a source-level guard. |
| T3-91-followup | tester recovery UX | Unsafe-at-connect banner is wired into the live connected drawer header, with reset/reconnect/M5 actions routed through existing safe service/coordinator paths. |

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

- `npx tsx tests/connection-panel-unsafe-at-connect-wiring.test.ts` passed during the T3-91 follow-up close-out.
- `npx tsx tests/installer-qa-matrix.test.ts` passed during the T3-85 close-out.
- `npx tsc --noEmit --pretty false` passed during the T1-260 close-out.
- Focused tests for T1-223 through T1-252 passed at their commits.
- Full `npm test` passed during T1-260.
- `npm run build`, `npx eslint . --max-warnings 0`, `npm run project-map:check`, `node scripts/exported-symbol-inventory.mjs --check`, and `git diff --check` passed during the T1-260 close-out.
- `scripts/run-tests.mjs` now names and kills timed-out per-file children instead of wedging silently.
- `npm run project-map:check` passed during T1-240 after regenerating `PROJECT_MAP.md`.
- Dependabot PRs must not be merged blindly; previous local test-merge attempts could not be safely verified.

## Next Audit-Fix Queue

Continue in this order unless a newer owner instruction says otherwise:

1. **Entitlement server deployment / signing-key custody** - deploy the server adapter with `ENTITLEMENT_SIGNING_PRIVATE_JWK` stored only in the server secret store, publish the matching public key in `VITE_ENTITLEMENT_PUBLIC_KEYS_JWK`, or continue with the next release-pipeline blocker if server rollout is handled elsewhere.

## Known Caveats

- Hardware verification is still required before release tagging for live laser paths called out in ROADMAP and shipped-audit rows.
- The T1-229 backfill recorded several already-shipped live UI/safety tickets; it did not newly hardware-verify them.
- The T1-230 type move kept compatibility wrappers at `src/app/SafetyActionResult.ts` and `src/app/MachineSafetyState.ts`; do not remove those wrappers until all old app/UI/tests imports are intentionally migrated.
- The trace-storm diagnostic probe row still contains a historical `<TBD>` note in `docs/ROADMAP-shipped-audit.md`; do not treat that as the active audit queue.

## Current Ticket Note

T1-242 closed F-020 by wiring recovery-card actions to `MachineService.applyRecoveryAck(...)`, adding an explicit inspection action, and making recovery actions acknowledge only after success or operator confirmation. T1-243 closed F-021 by making the T3-81 end-to-end workflow suite exit naturally under the runner. T1-244 closed F-022 by moving reconnect acknowledgement to successful USB/simulator connect and making recompile recovery wait for an awaited success/failure result. T1-245 fixed the user-reported long-job stop/disconnect path by keeping heartbeat alive on `ok` acknowledgements and pausing autosave work during jobs. T1-246 closed the largest stale-output audit cap by making `JobFingerprint` part of `ValidatedJobTicket` and the service-level Start validator. T1-247 made Start require service-level safe-idle gates. T1-248 made running-job heartbeat tolerant of short status delays while still aborting true silence. T1-249 hardened trace conversion against accidental straight closure burns. T1-250 separated autosave recovery truth from manual project-file dirty state. T1-251 moved frame freshness into the final start path by requiring `FrameTicket` proof or a logged unframed-start override. T1-252 made pause-time laser-off confirmation load-bearing: `GrblController.pause()` awaits M5 S0, `operations.pauseJob()` carries the structured `SafetyActionResult`, and `MachineService.pause()` latches failed laser-off as unsafe/unknown. T1-253 made support bundles user-exportable: `SupportBundleExport.ts` collects runtime diagnostics, writes a real ZIP, and Settings -> About exposes `Export Diagnostic Bundle`. T1-254 removed raw local cache authority from commercial entitlements: `EntitlementService` now accepts verified signed cache tokens, feature-scopes `canUse(...)`, and rejects forged `{ valid: true }` cache JSON. T1-255 added the real WebCrypto ES256 verifier plus `VITE_ENTITLEMENT_PUBLIC_KEYS_JWK` configuration hook, so production signed-token verification no longer depends on test stubs. T1-256 added the matching WebCrypto ES256 server signer plus `ENTITLEMENT_SIGNING_PRIVATE_JWK` private-key config hook, so server adapters can mint the token shape the client verifies without client-side private-key exposure. T1-257 wired release checksum generation into unsigned and signed installer workflows so artifacts upload with `SHA256SUMS`. T1-258 wired CycloneDX SBOM generation into the same installer workflows so artifacts also upload `sbom.cdx.json`. T1-259 wired GitHub provenance/SBOM attestations into the signed release workflows so release artifacts can be verified with `gh attestation verify`. T1-260 added explicit `publish_release` / `release_tag` dispatch inputs so signed workflows can attach installers plus platform-specific checksum/SBOM assets to a draft GitHub Release without manual local upload drift. T3-85 added the manual installer QA release gate and source-level test guard. T3-91 follow-up wires the unsafe-at-connect banner into the live connection panel so alarm/hold/door/residual-spindle states are visible before the operator tries Start; actions use existing safe service/coordinator paths. T1-237 remains deferred because firmware adapter wiring is multi-week architecture work.
