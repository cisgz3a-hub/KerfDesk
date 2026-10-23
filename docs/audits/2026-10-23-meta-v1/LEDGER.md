# Meta audit v1: ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md) with the meta changes in [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Kinds |
|---|---|---|---|---|---|---|---|---|---|
| M1 | Rolling-v2 P1s | b9202d5aa | [M1-meta-rolling-v2-p1.md](M1-meta-rolling-v2-p1.md) | 4 | 0 | 0 | 0 (2 lowered) | 4 | stale record, contract question, known-not-raised, test gap |

## Confirmed corrections (coordinator-verified)

| ID | Corrects | Kind | Summary | Coordinator evidence | Applied to |
|---|---|---|---|---|---|
| M1-P3-2 | rolling-v2 LEDGER, all six P1 rows | Stale record | The ledger still showed all six rolling-v2 P1s as open; GitHub shows every fix merged (#1340, #1352 on 2026-10-21; #1343, #1345, #1360 on 2026-10-22). M1 also found that all six P1s were genuine, rated correctly, and fixed on main, and that each fix's test fails with the fix reverted | `gh pr view` merge times; M1 and refuter fix-revert runs (13-P1-1's test fails 16/16 before its merge, 03-P1-2's fails 11/16 before #1345) | rolling-v2 LEDGER P1 rows, 2026-10-23 |
