# Rolling audit v10 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| V1 | Fix: job pipeline (#1575, #1574, #1572, #1576, #1562, #1565, #1585) | origin/main @ 5f09e1110 (refuter 5f09e1110; Node only, browser gate never met) | [V1-fix-job-pipeline.md](V1-fix-job-pipeline.md) | 4 | 0 | 1 (found by refuter) | 0 | 3 | 2 |
| **Total so far** | | | | **4** | **0** | **1** | **0** | **3** | **2** |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| V1-P1-1 | V1 | **Abort waits behind a whole-program re-check right after the first line**: activating the archived run re-validates the archive just built by #1574's slices (fingerprint of the whole program text, manifest, sendable-line count) in one task, so Abort, Pause and status wait 53–59 ms at 375k lines, 110–132 ms on a real 100 mm grayscale photo (838k lines) and 139–156 ms at 1.0M lines (Node, real modules). Over the 50 ms budget #1574 set itself, so S4-P2-3 is only partly fixed; not larger than 1.0.29, where the same check ran inside a 260–620 ms block. Found by the refuter; P1 by the S4-P2-3 precedent, Chrome timing owed (P2 if ordinary jobs stay under 100 ms there) | **READ** (main): `recovery-snapshot.ts:102-131` (`knownArtifactCanHydrate` → `isValidatedExecutionArtifact` → `isExecutionArtifact`, memo only after the first call), `execution-artifact.ts:305-325` (`runWorkSteps` drains the fingerprint and line count at once). Refuter REPRO `zz-v1r/activate-out.txt` (stack ends in `RecoverySnapshotCoordinator.refresh`) | fix card proposed |
