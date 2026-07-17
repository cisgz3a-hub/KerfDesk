# Rolling audit — Job Review Start gate (ADR-224, PR #259)

- **When:** 2026-07-17 10:10 (+08)
- **Tree:** `origin/main` @ `58cb3ae2` (audit branch rebased onto it; the nine "fix all" PRs from this session are landing around it — six merged, three CI-pending at audit time).
- **Scope:** the newest highest-stakes unaudited merge — #259's `job-review` module (`job-review-gate.ts`, `job-review-model.ts`, acknowledgement rendering) and its seams into `start-job-flow.ts`, the evidence builders, and the recovery flows audited in iteration 1.
- **Method:** static read of the gate loop, caller, and prompt plumbing. **Not verified:** no UI interaction with the rendered dialog (the module ships its own extensive dialog/store/gate/model test files); no hardware.
- **Report-only** per CLAUDE.md collaboration rule 1.

---

## Findings

None at P1/P2/P3. This is the cleanest substantive feature audited in ten iterations.

---

## Verified clean (checked, no finding)

- **ADR-206 governance is exemplary:** the commit quotes the maintainer's 2026-07-17 chat approval for this confirmation gate, recorded in DECISIONS.md ADR-224 — the pattern rule 7 demands, working as intended for a guard the maintainer requested personally.
- **Streamed bytes are provably the reviewed bytes:** `ReviewedStartBundle` is replaced only whole, by a successful re-prepare ([job-review-gate.ts:39-49](../../src/ui/laser/job-review/job-review-gate.ts)); Confirm returns the current bundle and `streamPreparedStart` consumes exactly `bundle.prepared` ([start-job-flow.ts:127-156](../../src/ui/laser/start-job-flow.ts)).
- **Cancel is side-effect-free:** the rebuild path mirrors the pre-review sequence *minus* its side effects (no StartBlocker writes, no receipt discards) so a failed in-dialog re-prepare becomes a blocker banner and Cancel leaves the app untouched ([job-review-gate.ts:122-152](../../src/ui/laser/job-review/job-review-gate.ts)).
- **Post-confirm authorization still runs against LIVE state:** `currentLaserForAuthorizedStart` re-checks the controller with `preparedAgainst: bundle.laser` after Confirm, so a mid-dialog disconnect/reset/drift refuses at the existing authorization layer rather than streaming a stale bundle ([start-job-flow.ts:135-143](../../src/ui/laser/start-job-flow.ts)).
- **The absorbed confirms cannot drift from their evidence:** the dialog renders the SAME constants the builders consume (`LASER_MODE_UNVERIFIED_START_PROMPT`, `cncSetupAttestationPrompt` — [job-review-model.ts:163-166](../../src/ui/laser/job-review/job-review-model.ts)), and Confirm feeds `() => true` into the same `confirmLaserModeStartEvidence` / `confirmCncSetup` builders, producing identical evidence objects.
- **Recovery flows are untouched, as claimed:** `cnc-pass-recovery-flow.ts` still uses its own `jobAwareConfirm` chain and `CNC_SETUP_ATTESTATION_PROMPT`; `runJobReviewGate`'s only production caller is `start-job-flow.ts` — `laser.startJob` itself is not intercepted, so the iteration-1 recovery wire-boundary architecture is unchanged.
- **Replay/checkpoint invariants hold inside the dialog loop:** each in-dialog re-prepare re-validates `replayCompilationMatches`, the execution signature, and `checkpointProgramIssue` — the same refusals the pre-review flow enforced.
- Module hygiene: 27 files averaging ~100 lines, model/store/gate/format split with sibling tests for each — comfortably inside every size rule.

## Not verified

- The rendered dialog itself (focus handling, editable cells committing through store actions) was not driven in a browser this iteration — covered by the module's own test files and the session that shipped it.
- Hardware behavior of a confirmed start is unchanged by design and remains not hardware-verified, as before.
