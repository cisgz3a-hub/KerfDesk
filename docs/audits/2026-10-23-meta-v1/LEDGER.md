# Meta audit v1: ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md) with the meta changes in [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Kinds |
|---|---|---|---|---|---|---|---|---|---|
| M1 | Rolling-v2 P1s | b9202d5aa | [M1-meta-rolling-v2-p1.md](M1-meta-rolling-v2-p1.md) | 4 | 0 | 0 | 0 (2 lowered) | 4 | stale record, contract question, known-not-raised, test gap |
| M2 | Rolling-v2 P2s | b9202d5aa / 17f4d6b68 | [M2-meta-rolling-v2-p2.md](M2-meta-rolling-v2-p2.md) | 5 (+48 stale rows) | 0 | 0 | 1 (M2-P3-3 raised) | 4 | stale record, wrong severity, fix gap, contradiction, record omission |

## Confirmed corrections (coordinator-verified)

| ID | Corrects | Kind | Summary | Coordinator evidence | Applied to |
|---|---|---|---|---|---|
| M1-P3-2 | rolling-v2 LEDGER, all six P1 rows | Stale record | The ledger still showed all six rolling-v2 P1s as open; GitHub shows every fix merged (#1340, #1352 on 2026-10-21; #1343, #1345, #1360 on 2026-10-22). M1 also found that all six P1s were genuine, rated correctly, and fixed on main, and that each fix's test fails with the fix reverted | `gh pr view` merge times; M1 and refuter fix-revert runs (13-P1-1's test fails 16/16 before its merge, 03-P1-2's fails 11/16 before #1345) | rolling-v2 LEDGER P1 rows, 2026-10-23 |
| M2-P3-1 | rolling-v2 LEDGER, all 58 P2 rows | Stale record | Every P2 row said `open`; 48 are fixed and merged, 10 have no PR. Follow-up repairs (#1384, #1387, #1397) were never recorded | M2 + refuter: 23 fix PRs merged with matching SHAs | rolling-v2 LEDGER P2 rows, 2026-10-23 |
| M2-P3-2 | 03-P2-4 | Wrong severity | A 50 % line burning at full power while Job Review showed 50 % is P1 under METHOD §3 (the P1 test has no reach clause); the original refuter wrote "P1 by effect" but kept P2. Already fixed by #1349 | Refuter re-read METHOD §3; fix holds on 17f4d6b68 | rolling-v2 LEDGER 03-P2-4 row |
| M2-P3-3 (P2) | 12-P2-2 / #1373 | Fix gap | #1373 protects new camera calibrations only; ADR-440 Amd 1 accepts the gap without telling anyone, and its remedy (Check camera) fails after a bed change: it reads the old target in today's bed frame, reports ~0 mm drift, and saving the refit stamps the wrong frame permanently. Refuter repro: a burn lands at Y210 instead of Y200, even after the bed is set back to 400. Every calibration from 1.0.21 or earlier is exposed | Refuter REPRO; `camera-bed-frame.test.ts:85` asserts the gap | rolling-v2 LEDGER 12-P2-2 row; fix card proposed |
| M2-P3-4 | 01-P2-6 | Contradiction | 01-P2-6 sat in the coordinator-verified table with only a PLAUSIBLE verdict (its refuter never returned); the mechanism is still on main, the effect window is unmeasured | Refuter confirmed from the 01 report and ledger | rolling-v2 LEDGER 01-P2-6 row |
| M2-P3-5 | 01-P2-6, 03-P2-3, 03-P2-6, 03-P2-7, 03-P2-8, 04-P2-1, 09-P2-1 | Record omission | Seven open P2s never got a PR, fix card or decision request (later rounds only re-filed them as KNOWN); none is fixed on main | Refuter searched 125 PRs by ID and keyword and re-read the code on main | rolling-v2 LEDGER rows; fix cards proposed |
