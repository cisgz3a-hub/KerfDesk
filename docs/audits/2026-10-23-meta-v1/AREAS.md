# Meta audit v1 — auditing the audits

Started 2026-10-23 at the user's request: "audit the previous audits too they might be wrong".

## Why

The rolling-v2, controller-v2, controller-v3 and controller-v4 rounds were written by AI agents. They were checked by AI refuters and re-read by an AI coordinator. That chain catches a lot, but it has blind spots of its own. Errors already caught in the record:

- D6's "grblHAL network: no banner" row was wrong (found by D7's refuter).
- A 2026-09-25 audit claim that Marlin "clamps S12000 to full output" was wrong. Marlin wraps it (found by E1's refuter).
- The C8 auditor misread a test title; its refuter corrected it.
- The E2 auditor cited the wrong ADR rule; its refuter corrected it.

Those catches show that the reports contain mistakes. This round looks for the rest systematically.

## What a meta finding is

A meta finding is any of these:

| Kind | Meaning |
|---|---|
| **False positive** | A confirmed finding that was not true when it was raised (bad repro, misread code, wrong source) |
| **Fix ineffective** | A finding marked fixed or merged whose defect still reproduces on current main, or whose fix has no regression test |
| **Wrong severity** | A rating, raise or lowering that METHOD's severity table does not support (for example a lowered P1 that should have stayed P1) |
| **Wrong clean claim** | A "Verified clean" statement that a fresh test breaks |
| **Bad citation** | A firmware file:line, URL, ADR quote or vendor quote that does not exist or does not say what the report claims |
| **Wrong disposition** | A finding wrongly marked REFUTED or KNOWN, so a real defect was dropped |
| **Stale record** | A LEDGER status (open, fix card, PR, merged) that no longer matches GitHub |
| **Contradiction** | Two reports, or a report and an ADR, that state incompatible facts |

Severity of a meta finding is the severity of the product defect it uncovers. A fix that does not work on a P1 is a P1. A bad citation that changes no verdict is P3.

## Method

The method is METHOD.md with three changes:

- **Evidence comes from current main.** Re-run the original repro, or a fresh one, against the current tree. Fetch the cited primary source again. A report's own words are not evidence.
- **Each meta auditor gets a quota.** Every P1 in scope gets a full check. For P2s, check at least a stratified sample, and say how the sample was chosen.
- **The refuter checks the meta auditor.** It tries to show that the original report was right after all.

Two auditors run at a time, interleaved with CNC v1.

## Areas

| # | Area id | Scope | Check |
|---|---|---|---|
| M1 | `meta-rolling-v2-p1` | Rolling-v2 P1s: 03-P1-1, 03-P1-2, 03-P1-3, 09-P1-1, 13-P1-1, 21-P1-1, and their fix PRs (#1340, #1345, #1343, #1352, #1360) | All six: genuine at the time? Fix merged and effective on main? Regression test present and asserting the right thing? |
| M2 | `meta-rolling-v2-p2` | The 58 rolling-v2 P2s and the 28 area reports | Reconcile every P2's status with GitHub. Fully re-verify a stratified sample of at least 15: at least one from each area that has P2s, weighted toward ones marked fixed |
| M3 | `meta-controller-v2-v3` | Controller v2 (C1–C8) and v3 (D1–D8) P1/P2s, about 25, and their fix PRs (#1376–#1403 range) | All P1s plus at least 15 P2s: genuine? Fix effective? Severity changes justified (D2-P3-3 raised, D3-P2-2 lowered, C7-P2-1 lowered)? |
| M4 | `meta-controller-v4` | Controller v4 (E1–E6) P2s and their fix PRs. The held E4 report is in the worktree, untracked; read it but never add it | All 13 P2s. Check especially the two lowerings, E4-P1-1 to P2 and E5-P2-4 to P3, and E6's "no decision reads the estimate" |
| M5 | `meta-citations` | Primary-source citations across every report in the four rounds | Sample at least 40 citations, spread over firmware (GRBL, grblHAL, FluidNC, Marlin, Smoothieware), vendor and LightBurn docs, and ADR quotes. Does each exist, and does it say what the report claims? |
| M6 | `meta-clean-and-refuted` | Every "Verified clean" section, every REFUTED finding, and every cross-report statement in the four rounds | Break at least 10 clean claims with fresh tests. Re-check every refuted finding. List contradictions between reports and between reports and ADRs |
| M7 | `meta-older-audits` | The pre-rolling audits: the 2026-09-24 to 2026-10-20 controller audits (2026-09-25 full, 10-19 behaviour, 10-20 design and protocol) and the CNC audits (09-24, 09-27, 09-29, 10-09) | Items marked fixed: still fixed on main? Items left open: still open, and recorded anywhere? Sample at least 20 |

## Output

Each area writes `Mn-<id>.md` in the METHOD template. Every meta finding names the original report and finding ID it corrects.

The coordinator then:
- applies confirmed corrections to the original LEDGERs, with a dated "Corrected by meta-v1 Mn" note, and never silently;
- proposes fix cards for any product defect the corrections uncover.
