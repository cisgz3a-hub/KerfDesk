# Rolling audit v9: verify the fixes since desktop 1.0.28

**Requested by** the maintainer on 2026-11-02 ("next loop"). The coordinator chose the scope, because rolling v8 found that fixes which pass their own repro can still bring regressions and miss sibling routes.

**Scope.** Live desktop is 1.0.28 (source `33bc394c6`). Main `e617025eb` carries 14 further fix PRs (#1514–#1523, #1525–#1527; #1524 is v8's docs), all merged on the PR browser subset (ADR-647) within about 12 hours and not re-checked since. None has shipped in a desktop release, so this round runs before the next one. Finding IDs are `R<area>-P<n>-<k>`.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3 with its clarifications: P1 has no reach clause, and "Frame is not a warning".
- §4: pinned citations, and ADR quotes only from `docs/decisions` / `DECISIONS.md`.
- The design severity rules of [rolling v7](../2026-10-28-rolling-v7/AREAS.md) and the quality rules of [Q1](../2026-10-27-quality-q1/AREAS.md) apply where those areas recur.
- Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.
- Lens L10 is defined in [rolling v8](../2026-10-29-rolling-v8/AREAS.md).

### Lens L11, returning user

v8's most serious regression (N4-P1-1) only showed on a project saved by an older release. For a fix that changes layout, geometry, output or a stored field, compare against a real older build:
1. Save the project with the older code (an export of the tag or commit, kept outside the repro tree), never with a hand-written fixture alone.
2. Open it on main through the real store.
3. Compile on both, and diff the G-code. Every difference must be intended, named by an ADR, and either harmless or announced.

## Areas (run order)

| # | Area id | Fix PRs | Original findings | Lenses |
|---|---|---|---|---|
| R1 | `fix-marlin-watchdog` | #1515 (ADR-676 Amd 1), #1527 (ADR-356 Amd 2, ADR-398 Amd 6) | v8 N1-P1-1/P2-1, v6 K2; plus `in-window-stall-beam.thread.test.ts`, which has now timed out on CI at least three times (#1513, #1520, #1522) | L10, L6, L9, L4 |
| R7 | `returning-user` | Everything since the older releases | Projects saved by 1.0.23 (`87ecb4f24`, schema 18), 1.0.27 (`adf300522`, schema 18) and 1.0.28 (`33bc394c6`, schema 19), opened on main (schema 20), and compiled against the release that saved them | L11, L9 |
| R2 | `tracer-remeasure-2` | #1516 (ADR-434 Amd 3), #1517 (ADR-530 Amd 12, ADR-439 Amd 2), #1514 (ADR-257 Amd 2) | v8 N8; Potrace 1.16 re-measure, test-only | L2, L10 |
| R3 | `fix-tabs-jig` | #1522 (ADR-494 Amd 3), #1518 (ADR-144 Amd 1) | v8 N3-P1-1/P1-2/P1-3/P2-1 | L10, L9, L11 |
| R4 | `fix-text-frames` | #1523 (ADR-682 Amd 1, schema 20), #1519 (ADR-591 Amd 2) | v8 N4-P1-1/P1-2/P1-3/P2-1 | L10, L9, L11 |
| R5 | `fix-fill-canvas` | #1526 (ADR-683 Amd 1) | v8 N6-P1-1/P1-2/P2-1 | L10, L9 |
| R6 | `fix-studio-bed` | #1521, #1520 (ADR-637 Amd 4), #1525 | v8 N5-P2-1/P2-2, N2-P2-1, N7-P3-2 | L10, L9, L11 |
| R8 | `cross-fix-journeys` | All of the above, together | Whole jobs from artwork to a simulated controller, crossing the fixes that merged the same day | L10, L4, L9 |

R1 runs first because it decides whether a lit beam or a false stop remains. R7 runs second because it is the check v8 shows the fixes' own tests skip.

## Overlap with other work

Open PRs #1528, #1529 and #1530 are from another agent's live-data audit and feature work, not this round. Check them before raising a finding, and treat anything they already fix as KNOWN; do not audit their diffs.

## Batching

- At most two audit subagents at a time, because the PC is low on memory.
- A refuter goes before the next auditor.
- Repros run on the scratchpad `j7-main` tree, refreshed to main `e617025eb`. Refresh it again whenever main's source moves.
