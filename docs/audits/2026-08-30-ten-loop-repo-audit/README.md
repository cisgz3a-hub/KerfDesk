# Ten-loop repository audit

Date started: 2026-08-30

Repository: `C:\Users\Asus\LaserForge-2.0`

Audited state at kickoff:

- branch: `claude/vcarve-stamp-subcell`
- HEAD: `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`
- inherited state: nine modified paths and four untracked paths were present before this audit
- mutation boundary: findings and audit documents only; no product fix, commit, PR, deployment, provider call, or hardware action

## Objective

Run ten materially different audits that together cover the repository. Each loop uses a distinct review method, current-tree evidence, primary external sources where an external claim is made, a blind independent second audit, and an adversarial verification pass. A loop closes only after the three views are reconciled. Closing one loop starts the next loop in the coverage map.

## Loop protocol

1. **Scope lock** — record the exact files, contracts, and external authorities in scope.
2. **Research** — read current source and tests. For external claims, use upstream specifications, vendor documentation, official advisories, or project-maintainer sources rather than secondary summaries.
3. **Primary audit** — trace the chosen risk model through production paths and tests. Record candidate findings with exact source lines and a concrete failure mechanism.
4. **Blind double audit** — a second auditor inspects the same scope independently and does not inherit the primary auditor's conclusions.
5. **Adversarial verification** — a verifier attempts to reproduce, narrow, or refute every candidate. Passing tests cannot prove perceptual fidelity or hardware behavior.
6. **Reconciliation** — classify each candidate as confirmed, narrowed, rejected, or qualification gap. Runtime findings stay separate from documentation and coverage drift.
7. **Close and advance** — record commands, limitations, remaining coverage, and the next loop. No fix is implemented during the audit.

## Evidence contract

A confirmed finding requires:

- an exact current-tree source path and line range;
- a concrete trigger and resulting behavior;
- impact stated without assuming untested hardware or perceptual behavior;
- a reproduction, focused executable check, or a second independent source trace;
- a primary external source when the finding depends on a protocol, API, security rule, accessibility criterion, G-code meaning, controller setting, version, or third-party behavior.

Evidence labels:

- **SRC** — current production source or repository contract
- **TST** — current test source or focused test execution
- **CMD** — command output from this audit session
- **EXT** — upstream primary external source
- **HW-GAP** — requires real machine or instrumented qualification
- **VIS-GAP** — requires perceptual/rendered comparison

## Finding states and severity

- **Confirmed** — the failure mechanism is supported by current evidence and survived adversarial verification.
- **Narrowed** — a real issue exists, but its trigger or impact is smaller than first claimed.
- **Rejected** — source or executable evidence disproved the candidate.
- **Qualification gap** — code evidence cannot establish the claimed physical, perceptual, OS-specific, or provider-specific outcome.

Severity describes impact, not confidence:

- **P0** — credible uncontrolled hazardous output, data destruction, or release-trust compromise on an ordinary path.
- **P1** — incorrect machine/output behavior, Start/Frame contract violation, security boundary break, or unrecoverable user-data loss.
- **P2** — material workflow failure, wrong preview/persistence result, accessibility blocker, or important verification hole.
- **P3** — localized defect, misleading state/documentation, maintainability risk, or bounded coverage drift.

## Guard-law review rule

The audit does not recommend a new guard. A concern that should inform the operator belongs in Job Review and remains non-blocking. Existing refusals are evaluated only against the three permitted factual categories: transport inability, compile integrity, and exact handoff consistency. Any candidate that would widen a refusal is reported as a contract risk, not proposed as a fix.

## Independence record

Each loop report names the primary auditor, independent auditor, and verifier evidence. Delegated audits run with `gpt-5.6-sol` at `ultra`. The primary agent reconciles claims against the current checkout before accepting them.

## Outputs

- `coverage-map.md` — the ten distinct loop designs and completion state
- `loop-01-...md` through `loop-10-...md` — reconciled loop reports
- `findings-ledger.md` — deduplicated confirmed/narrowed findings and rejected candidates
- `final-synthesis.md` — cross-loop coverage, verification, limitations, and ordered remediation recommendations
