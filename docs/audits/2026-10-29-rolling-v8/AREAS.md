# Rolling audit v8: verify what desktop 1.0.28 shipped

**Requested by** the user on 2026-10-29 ("start loop"), after the coordinator recommended two things: a fix-verification round, and a fresh measurement of the tracer against Potrace.

**Scope.** Desktop 1.0.28 (source `33bc394c6`) ships about 30 fix PRs. These came from rolling v6, rolling v7 and the e2e repair. No independent agent has re-checked any of them since it merged. Most were written within hours and merged on the PR browser subset (ADR-647). Main's full e2e suite was red from `7a459ef2d` (2026-10-27 11:48 UTC) until #1513 merged (`33bc394c6`). Finding IDs are `N<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3 with its clarifications: P1 has no reach clause, and "Frame is not a warning".
- §4: pinned citations, and ADR quotes only from `docs/decisions` / `DECISIONS.md`.
- The design severity rules of [rolling v7](../2026-10-28-rolling-v7/AREAS.md) and the quality rules of [Q1](../2026-10-27-quality-q1/AREAS.md) apply where those areas recur.
- Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.

### Lens L10, fix verification

For each fix PR in the area:
1. Re-run the original finding's repro on current main and confirm it is fixed.
2. Check every sibling path of the finding, as listed in its report.
3. Look for any regression the fix introduced elsewhere, including its interaction with the other fixes that merged the same day.
4. Check that its ADR amendment describes what the code does.
5. Check test truth: does its regression test fail on the pre-fix commit?

## Areas (run order)

| # | Area id | Fix PRs | Original findings | Lenses |
|---|---|---|---|---|
| N1 | `fix-window-stall` | #1500 (ADR-676): Marlin and network jobs stream from a worker, and Job Review names a lit stop | v6 K1-P1-1/2/3 | L10, L6, L9 |
| N8 | `tracer-remeasure` | #1495–#1497, #1494, #1490, #1491, #1487 | Q1–Q6; the self-reported Line Art result against Potrace was 51/20/8 | L2 (Potrace 1.16, test-only), L10 |
| N2 | `fix-a1-pro` | #1499 (ADR-675, ADR-322 Amd 3, ADR-370 Amd 2) | v6 K3-P2-1/P2-2 | L10, L2 |
| N3 | `fix-geometry` | #1501 (ADR-410 Amd 3), #1502 (ADR-677, ADR-144 Amd 1, ADR-214 Amd 1, ADR-307 Amd 3), #1506 (ADR-494 Amd 2, ADR-371 Amd 1) | v7 L1, L2, L6 | L10, L9 |
| N4 | `fix-text` | #1507, #1508 (ADR-591/321/564 Amd 1) | v7 L3 | L10, L9 |
| N5 | `fix-studio-io` | #1509 (ADR-573 Amd 1, ADR-590 Amd 1), #1505 (ADR-681) | v7 L5, L7 | L10, L9 |
| N6 | `fix-canvas-keys` | #1511 (ADR-683), #1510, #1504 (ADR-678, ADR-125 Amd 4) | v7 L8, L4 | L10, L9 |
| N7 | `fix-e2e-window` | #1513 (banner wrap, plus the e2e setup changes), and every PR merged while main's e2e was red | main e2e red window | L10, L7 |

N8 runs early because it measures the maintainer's stated goal: "tracers better than potrace".

## Batching

- At most two audit subagents at a time, because the PC is low on memory.
- A refuter goes before the next auditor.
- Repros run on the scratchpad `j7-main` tree, refreshed to main `33bc394c6`. Refresh it again whenever main's source moves.
