# Rolling audit v10: verify the fixes since desktop 1.0.29

**Requested by** the maintainer on 2026-11-07 ("continue looping even without merging PRs"). The coordinator chose the scope: the next check v9 and the performance and new-user audits point to.

**Scope.** Live desktop is 1.0.29 (source `df2279e26`, published 2026-11-02 16:38 UTC). Main `5f09e1110` carries about 50 further PRs (#1550–#1604) from the performance audit S1 and the new-user experience audit U1. They include fixes to Start, Abort, job preparation, photo import, the canvas, text and the controller messages. None has been re-audited, and none has shipped. Nine of them (#1593–#1595, #1598–#1600, #1602–#1604) merged on 2026-11-05 while GitHub Actions could not run on main. Their required checks were green on each PR's own head, but no CI has run on the combined result; a local run of main's unit tests passed (38,920 tests, 0 real failures). Finding IDs are `V<area>-P<n>-<k>`.

**PRs stay open.** The repository is private and its Actions are blocked (2026-11-06), so fix PRs from this round are opened and left unmerged until the maintainer restores CI.

## Method

[rolling-v2 METHOD.md](../2026-10-21-rolling-v2/METHOD.md) applies in full:
- §3 with its clarifications: P1 has no reach clause, and "Frame is not a warning".
- §4: pinned citations, and ADR quotes only from `docs/decisions` / `DECISIONS.md`.
- Each area gets an auditor, then a fresh refuter. The coordinator re-verifies every P1/P2 in main's code.
- Lens L8 (change risk) and L9 (entry-point parity) are defined in rolling v3 and v4. L10 (fix verification) is defined in [rolling v8](../2026-10-29-rolling-v8/AREAS.md), and L11 (returning user) in [rolling v9](../2026-11-02-rolling-v9/AREAS.md).
- For performance fixes, the [performance audit](../2026-11-02-performance-s1/AREAS.md) rules hold: a speed fix may not change the burn (G-code byte-identical), and timings use production builds.

### Lens L12, untested merge

For the nine PRs merged without CI on main, check what CI would have caught: the full related e2e specs (not the PR subset), the desktop build, and the interaction with the other PRs that merged in the same hour.

## Areas (run order)

| # | Area id | Fix PRs | Original findings | Lenses |
|---|---|---|---|---|
| V1 | `fix-job-pipeline` | #1575 (ADR-598 Amd 4), #1574 (ADR-337 Amd 1), #1572, #1576, #1562 and #1565 (ADR-244 Amd 1/2), #1585 | S1-P2-2, S4-P2-1/2/3, S3-P2-3, S4-P3-3 | L10, L6, L4, L12 |
| V2 | `returning-user` | Everything since 1.0.29 | Projects saved by 1.0.29 (the golden set from #1550) and 1.0.28, opened on main and compiled against the release that saved them | L11, L9 |
| V3 | `fix-controller` | #1558, #1559, #1567, #1568, #1569, #1595, #1599 | U2-P2-1/2, U4, U5, U8-P1/P2 | L10, L6, L9, L12 |
| V4 | `fix-canvas-geometry` | #1551, #1552, #1593, #1582, #1583 | S2-P2-1..4, S6-P2-1/2, S6-P3-1, S2 P3s | L10, L3, L12 |
| V5 | `fix-photo-image-trace` | #1555, #1557, #1578, #1586, #1587, #1594 | U3-P2-3, S3-P2-1/2, S5-P2-1, S5-P3-1; Potrace 1.16 remains a test-only black box | L10, L2, L12 |
| V6 | `fix-text-cnc` | #1589, #1590, #1591, #1602, #1603 | S7-P2-1/2, S7-P3-1/2, S3-P3-1, S8-P2-1 | L10, L4, L12 |
| V7 | `fix-design-burn-safety` | #1556 (ADR-686), #1561 (ADR-687), #1566, #1564 (ADR-688) | U3-P1, U3-P2, U4-P2-1, U1 | L10, L9, L11 |
| V8 | `fix-help-a11y-wording` | #1554, #1570, #1580, #1581, #1588, #1598, #1604 | U1, U5–U8 P2s and P3s | L10, L9, L12 |
| V9 | `cross-fix-journeys` | All of the above, together | Whole jobs from artwork to a simulated controller, crossing the fixes that merged in the same hours | L10, L4, L9, L12 |

V1 runs first because it decides whether Start, Abort or a running job can be harmed. V2 runs second because it is the check the fixes' own tests skip.

## Overlap with other work

The open PRs #1592, #1596, #1597, #1601 and #1605–#1612 are the P3 sweeps and audit docs of the same rounds. Check them before raising a finding, and treat anything they already fix as KNOWN. Do not audit their diffs.

## Batching

- One audit subagent at a time, and at most two agents in total: the PC is low on memory.
- A refuter goes before the next auditor.
- Repros run on the scratchpad tree `j10-main`, an export of main `5f09e1110` whose `node_modules` is a junction to the main checkout's. Refresh it whenever main's source moves.
- Never operate hardware. Controllers are simulated only. Agents never download or install software, and never launch the installed KerfDesk.
- Known local gaps: the main checkout's `node_modules` lacks `fflate`, so suites importing `src/io/tiff` fail to load locally. CI installs it.

**Status:** done 2026-11-08. All nine areas ledgered: P1 6 / P2 4 / P3 25; every P1 and P2 has a fix PR (#1614–#1620). See [LEDGER.md](LEDGER.md#round-result-2026-11-08).
